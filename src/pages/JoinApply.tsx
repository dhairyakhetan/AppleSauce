import { useState, useEffect, useRef } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field, FieldInput, FieldTextarea, useBlurValidation } from '@/components/ui/field';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ProgressSteps } from '@/components/join/progress-bar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { toast } from 'sonner';
import { Loader2, Upload, X, CheckCircle2, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import DOMPurify from 'dompurify';
import { sanitizeImageUrl, validateImageSrc } from '@/utils/imageSanitizer';
import { getSubjectColors } from '@/utils/subjectColors';
import { Link } from 'react-router-dom';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';

/* Redesign C-060 (changelog) — five-step teacher listing form (mockup J1–J5).
   Rewritten on top of the shared Field/FieldInput/FieldTextarea/useBlurValidation
   primitives and the new ProgressSteps segmented bar (C14). Every field this form
   collected before is still collected here — the approve_teacher_application RPC
   reads ~22 columns off teacher_applications, so nothing was dropped, only
   regrouped into the J1–J5 step order. See the task report for the full field
   inventory and the O-07 note on why no ID/degree upload was added. */

const SUBJECTS = [
  'Accounts', 'ACT', 'AP', 'Bengali', 'Biology', 'Business Studies', 'CA', 'CAT', 'Chemistry',
  'CLAT', 'Commerce', 'Computers', 'Drawing & Painting', 'Economics', 'English', 'Environmental Science',
  'Geography', 'Hindi', 'History & Civics', 'Home Science', 'JEE', 'Legal Studies', 'Maths',
  'NEET', 'NMAT', 'Physics', 'Political Science', 'Psychology', 'SAT', 'Science',
  'Sanskrit', 'Social Studies', 'Sociology'
];

const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG'];

const BOARDS = ['ICSE/ISC', 'CBSE', 'IGCSE', 'IB', 'State', 'N/A'];

const AREAS = [
  'Alipore', 'Ballygunge', 'Behala', 'Bhowanipore', 'Gariahat', 'Garia', 'Jadavpur', 'Kasba',
  'New Alipore', 'Southern Avenue', 'Tollygunge', 'Hazra',
  'Baguihati', 'Belur', 'Howrah', 'Joka', 'Newtown', 'Rajarhat', 'Salt Lake', 'Science City',
  'Dum Dum', 'Entally', 'Girish Park', 'Nagarbazar', 'Sealdah', 'Shyam Bazar', 'Tangra',
  'Camac Street', 'College Street', 'Elgin', 'Minto Park', 'Park Street', 'Park Circus',
  'Kankurgachi', 'Laketown', 'Phoolbagan', 'Ultadanga',
  'Anandapur', 'Parnasree', 'Rabindra Nagar',
  'Hooghly'
].sort();

const MODE_OF_TEACHING = ['Online', 'Offline'];

const CLASS_SIZE = ['Group', 'Solo'];

const SIR_MAAM = ['Sir', "Ma'am"];

// J1–J5: head + lede, verbatim from copy.md §8.
const STEPS = [
  { label: 'Who you are', head: "Let's get you listed", lede: 'Free to list, free to stay. We never take a cut of your fee.' },
  { label: 'What you teach', head: 'What do you teach?', lede: 'Pick everything you genuinely teach. Guardians filter on this, so be honest.' },
  { label: 'Where you teach', head: 'Where do you teach?', lede: 'Travel radius matters more than an address. Nobody sees your exact address.' },
  { label: 'Your fee, your terms', head: 'What do you charge?', lede: 'You set it, you keep it. Shikshaq takes nothing and never handles the money.' },
  { label: 'Verify & consent', head: 'One quick check', lede: 'A student we can call to confirm you teach, then your consent to go live.' },
];

// J5 copy (copy.md §8) — belongs to the post-submission waiting-review screen,
// not the pre-submission verify-and-consent step above. Was previously shown
// prematurely on step 5's form (which still required two fields and a
// checkbox before the actual submit), which read as if the application had
// already been sent. Moved to the `submitted` view where it's actually true.
const WAITING_ON_REVIEW = {
  head: 'With us now',
  lede: 'A person reads every application. Usually the same day, at worst two.',
  note: 'Nothing goes live until a human has read it. If something is missing we message you on WhatsApp instead of rejecting you.',
};

// Handoff JA-004: multi-select chips — h44 px-4 r999, selected in the
// subject tint/text with a trailing check, unselected bg-muted/text-warm-secondary.
function Pill({
  label,
  selected,
  onClick,
  tintClass,
  dynamicTint,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  tintClass?: string;
  dynamicTint?: { bg: string; color: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
        selected ? (dynamicTint ? 'font-bold' : `font-bold ${tintClass ?? 'bg-panel text-background'}`) : 'bg-muted font-semibold text-warm-secondary'
      }`}
      style={selected && dynamicTint ? { background: dynamicTint.bg, color: dynamicTint.color } : undefined}
    >
      {label}
      {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : null}
    </button>
  );
}

// Handoff JA-004: number grid (classes) — grid-cols-6 gap-2, h-11 rounded-[14px],
// selected bg-panel/#FCFAF7, unselected bg-muted/text-foreground, numeral
// 15px/800 tabular-nums.
function NumberGridOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex h-11 items-center justify-center rounded-[14px] text-[15px] font-extrabold tabular-nums transition-colors duration-150 active:scale-[0.97] ${
        selected ? 'bg-panel text-background' : 'bg-muted text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

interface FormData {
  name: string;
  email: string;
  phone_number: string;
  sir_maam: 'Sir' | "Ma'am" | '';
  subjects: string;
  classes_taught_for_backend: string;
  school_boards_catered: string;
  location_v2: string;
  students_home_areas: string;
  tutors_home_areas: string;
  mode_of_teaching: string;
  class_size: string;
  description: string;
  qualifications_etc: string;
  years_started_teaching: string;
  featured_subject: string;
  hero_image_url: string;
  reference_name: string;
  reference_number: string;
  min_fees: string;
  max_fees: string;
  free_first_class: boolean;
  mou_consent: boolean;
}

export default function JoinApply() {
  usePageMeta(
    'Teacher Application Form | Shikshaq',
    'Complete your tuition teacher profile in five steps. Name, subjects, location and fees, then a quick verification.',
  );

  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    phone_number: '',
    sir_maam: '',
    subjects: '',
    classes_taught_for_backend: '',
    school_boards_catered: '',
    location_v2: '',
    students_home_areas: '',
    tutors_home_areas: '',
    mode_of_teaching: '',
    class_size: '',
    description: '',
    qualifications_etc: '',
    years_started_teaching: '',
    featured_subject: '',
    hero_image_url: '',
    reference_name: '',
    reference_number: '',
    min_fees: '',
    max_fees: '',
    free_first_class: false,
    mou_consent: false,
  });

  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Step content otherwise keeps whatever scroll offset the previous step left
  // behind — a user who reads to the bottom of a long step (J4/J5) and taps
  // "Save and continue" would land mid-way down the next, shorter step instead
  // of at its heading. Reset both possible scroll owners: the window (desktop,
  // where the step body scrolls with the page) and the internal container
  // (mobile, where the step body is its own overflow-y-auto region). Instant,
  // not smooth — matches ScrollToTop.tsx's convention for a screen change
  // rather than a user-initiated scroll.
  const stepScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepScrollRef.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [step]);

  const valueExistsInString = (str: string | null, value: string): boolean => {
    if (!str) return false;
    const values = str.split(',').map((v) => v.trim().toLowerCase());
    return values.includes(value.trim().toLowerCase());
  };

  const handleInputChange = (field: keyof FormData, value: FormData[keyof FormData]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleMultiSelectChange = (field: keyof FormData, value: string, checked: boolean) => {
    const currentValue = formData[field] as string;
    const currentArray = currentValue ? currentValue.split(',').map((v) => v.trim()) : [];

    let newArray: string[];
    if (checked) {
      newArray = [...currentArray, value].filter((v) => v !== '');
    } else {
      newArray = currentArray.filter((v) => v !== value);
    }

    const newValue = newArray.join(', ') || '';
    if (field === 'subjects') {
      const currentFeatured = formData.featured_subject;
      if (currentFeatured && !newArray.includes(currentFeatured)) {
        setFormData((prev) => ({ ...prev, [field]: newValue, featured_subject: '' }));
        return;
      }
    }
    handleInputChange(field, newValue);
  };

  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedImageFile(null);
      setImagePreview(null);
      handleInputChange('hero_image_url', '');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isHeicLike =
      lowerName.endsWith('.heic') ||
      lowerName.endsWith('.heif') ||
      file.type === 'image/heic' ||
      file.type === 'image/heif';
    if (isHeicLike) {
      toast.error('HEIC images are not supported. Please upload a JPG or PNG image instead.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }

    setSelectedImageFile(file);
    const previewUrl = URL.createObjectURL(file);

    if (!previewUrl.startsWith('blob:')) {
      toast.error('Failed to create image preview');
      return;
    }

    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }

    setImagePreview(previewUrl);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      setUploadingImage(true);

      const { default: imageCompression } = await import('browser-image-compression');
      const compressedFile = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: 'image/jpeg',
      });

      if (import.meta.env.DEV) {
        logger.log(`Image compressed from ${file.size / 1024 / 1024} MB to ${compressedFile.size / 1024 / 1024} MB`);
      }

      // Path is relative to bucket root — this is the storage location the app
      // has always used for application photos. Unrelated to O-07 (verification
      // documents); this bucket only ever holds the profile photo.
      const fileExt = compressedFile.name.split('.').pop();
      const fileName = `application-${Date.now()}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('hero-images')
        .upload(fileName, compressedFile, { cacheControl: '3600', upsert: false });

      if (error) {
        logger.error('JoinApply.uploadImage', error);
        throw new Error('Image upload failed');
      }

      const { data: { publicUrl } } = supabase.storage.from('hero-images').getPublicUrl(data.path);

      const sanitizedUrl = sanitizeImageUrl(publicUrl);
      if (!sanitizedUrl) {
        throw new Error('Failed to generate valid image URL');
      }

      return sanitizedUrl;
    } catch (error) {
      logger.error('JoinApply.uploadImage.catch', error);
      throw error;
    } finally {
      setUploadingImage(false);
    }
  };

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      toast.error('Please enter your name');
      return false;
    }
    if (formData.name.length > 200) {
      toast.error('Name must be at most 200 characters');
      return false;
    }
    if (!formData.email.trim()) {
      toast.error('Please enter your email');
      return false;
    }
    if (formData.email.length > 254) {
      toast.error('Email must be at most 254 characters');
      return false;
    }
    const emailTrimmed = formData.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      toast.error('Please enter a valid email address');
      return false;
    }
    if (!formData.phone_number.trim()) {
      toast.error('Please enter your WhatsApp number');
      return false;
    }
    const phoneDigits = formData.phone_number.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      toast.error('WhatsApp number must be exactly 10 digits');
      return false;
    }
    if (!formData.sir_maam) {
      toast.error("Please select Sir or Ma'am");
      return false;
    }
    if (!formData.subjects.trim()) {
      toast.error('Please select at least one subject');
      return false;
    }
    if (!formData.classes_taught_for_backend.trim()) {
      toast.error('Please select at least one class');
      return false;
    }
    if (!formData.school_boards_catered.trim()) {
      toast.error('Please select at least one school board');
      return false;
    }
    if (!formData.mode_of_teaching.trim()) {
      toast.error('Please select at least one mode of teaching');
      return false;
    }
    if (!formData.class_size.trim()) {
      toast.error('Please select at least one structure of classes option');
      return false;
    }
    if (!formData.location_v2) {
      toast.error('Please select a location option');
      return false;
    }
    if (formData.location_v2 === "STUDENT'S HOME TUTORING ONLY") {
      if (!formData.students_home_areas.trim()) {
        toast.error("Please select at least one area for Student's Home Tutoring");
        return false;
      }
    } else if (formData.location_v2 === "TEACHER'S HOME TUTORING") {
      if (!formData.tutors_home_areas.trim()) {
        toast.error("Please select at least one area for Teacher's Home Tutoring");
        return false;
      }
    } else if (formData.location_v2 === 'BOTH OPTIONS LISTED') {
      if (!formData.students_home_areas.trim()) {
        toast.error("Please select at least one area for Student's Home Tutoring");
        return false;
      }
      if (!formData.tutors_home_areas.trim()) {
        toast.error("Please select at least one area for Teacher's Home Tutoring");
        return false;
      }
    }
    if (!formData.reference_name.trim()) {
      toast.error("Please enter the reference student's name");
      return false;
    }
    if (formData.reference_name.length > 200) {
      toast.error('Student name (for verification) must be at most 200 characters');
      return false;
    }
    if (!formData.reference_number.trim()) {
      toast.error("Please enter the reference student's phone number");
      return false;
    }
    if (formData.years_started_teaching.trim()) {
      const yearDigits = formData.years_started_teaching.replace(/\D/g, '');
      if (yearDigits.length > 4) {
        toast.error('Years of experience must be at most 4 digits');
        return false;
      }
      if (yearDigits.length > 0 && !/^\d{1,4}$/.test(yearDigits)) {
        toast.error('Years of experience must contain only numbers');
        return false;
      }
    }
    const referenceDigits = formData.reference_number.replace(/\D/g, '');
    if (referenceDigits.length !== 10) {
      toast.error('Student number must be exactly 10 digits');
      return false;
    }
    const monthlyFee = parseInt(formData.min_fees.replace(/\D/g, ''), 10);
    if (!formData.min_fees.trim() || Number.isNaN(monthlyFee) || monthlyFee <= 0) {
      toast.error('Please enter a monthly fee greater than ₹0');
      return false;
    }
    if (formData.description.length > 1000) {
      toast.error('Profile introduction must be at most 1000 characters');
      return false;
    }
    if (formData.qualifications_etc.length > 500) {
      toast.error('Educational qualifications must be at most 500 characters');
      return false;
    }
    if (!formData.mou_consent) {
      toast.error('You must consent to the Memorandum of Understanding to proceed');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      setSubmitting(true);

      let heroImageUrl = formData.hero_image_url;
      if (selectedImageFile) {
        try {
          heroImageUrl = await uploadImage(selectedImageFile);
          if (!heroImageUrl) {
            toast.error('Failed to upload image. Please try again.');
            return;
          }
        } catch {
          toast.error('Failed to upload image. Please try again.');
          return;
        }
      }

      const { error } = await supabase.from('teacher_applications').insert({
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone_number: formData.phone_number.replace(/\D/g, ''),
        sir_maam: formData.sir_maam,
        subjects: formData.subjects.trim() || null,
        classes_taught_for_backend: formData.classes_taught_for_backend.trim() || null,
        school_boards_catered: formData.school_boards_catered.trim() || null,
        location_v2: formData.location_v2 || null,
        students_home_areas: formData.students_home_areas.trim() || null,
        tutors_home_areas: formData.tutors_home_areas.trim() || null,
        mode_of_teaching: formData.mode_of_teaching.trim() || null,
        class_size: formData.class_size.trim() || null,
        description: formData.description.trim() || null,
        qualifications_etc: formData.qualifications_etc.trim() || null,
        years_started_teaching: formData.years_started_teaching.trim() || null,
        featured_subject: formData.featured_subject || null,
        hero_image_url: heroImageUrl || null,
        reference_name: formData.reference_name.trim() || null,
        reference_number: formData.reference_number.replace(/\D/g, '') || null,
        min_fees: formData.min_fees ? parseInt(formData.min_fees.replace(/\D/g, '')) || null : null,
        max_fees: formData.max_fees ? parseInt(formData.max_fees.replace(/\D/g, '')) || null : null,
        mou_consent: true,
        mou_consent_timestamp: new Date().toISOString(),
        status: 'pending',
      });

      if (error) {
        logger.error('JoinApply.submit', error);
        if (error.message?.includes('DUPLICATE_PENDING_APPLICATION')) {
          toast.error('You already have an application under review with this email. We will get back to you soon.');
        } else {
          toast.error('Failed to submit application. Please try again.');
        }
        return;
      }

      setSubmitted(true);
      toast.success('Application submitted successfully! We will review it and get back to you soon.');
    } catch (error) {
      logger.error('JoinApply.submit.catch', error);
      toast.error('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Blur-only validators for the plain text fields (Field primitive contract).
  const nameV = useBlurValidation(formData.name, (v) => (!v.trim() ? 'Enter your name.' : v.length > 200 ? 'Name must be at most 200 characters.' : undefined));
  const emailV = useBlurValidation(formData.email, (v) =>
    !v.trim() ? 'Enter your email.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? 'That email address does not look right.' : undefined,
  );
  const phoneV = useBlurValidation(formData.phone_number, (v) => (v.replace(/\D/g, '').length !== 10 ? 'Enter a 10-digit WhatsApp number.' : undefined));
  const refNameV = useBlurValidation(formData.reference_name, (v) => (!v.trim() ? "Enter the student's name." : undefined));
  const refNumberV = useBlurValidation(formData.reference_number, (v) => (v.replace(/\D/g, '').length !== 10 ? 'Enter a 10-digit number.' : undefined));

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-12 pb-16">
          <div className="rounded-bento bg-card p-6 text-center sm:p-10">
            <div className="w-16 h-16 rounded-full bg-mint flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-8 h-8 text-foreground" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-3">
              {WAITING_ON_REVIEW.head}
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground mb-2">
              {WAITING_ON_REVIEW.lede} {WAITING_ON_REVIEW.note}
            </p>
            <p className="text-sm text-warm-meta">
              You will be notified via email once your application has been reviewed.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const isLastStep = step === STEPS.length - 1;

  const validateStep = (stepIndex: number): boolean => {
    if (stepIndex === 0) {
      if (!formData.name.trim()) {
        toast.error('Please enter your name');
        return false;
      }
      if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
        toast.error('Please enter a valid email address');
        return false;
      }
      if (!formData.sir_maam) {
        toast.error("Please select Sir or Ma'am");
        return false;
      }
      if (formData.phone_number.replace(/\D/g, '').length !== 10) {
        toast.error('WhatsApp number must be exactly 10 digits');
        return false;
      }
      // Photo is encouraged (copy: "doubles replies"), not required — pages.md
      // §13 J1 lists it as a field but the spec's validation column only
      // requires name + phone. It used to hard-block here; it no longer does.
      return true;
    }
    if (stepIndex === 1) {
      if (!formData.subjects.trim()) {
        toast.error('Please select at least one subject');
        return false;
      }
      if (!formData.school_boards_catered.trim()) {
        toast.error('Please select at least one school board');
        return false;
      }
      if (!formData.classes_taught_for_backend.trim()) {
        toast.error('Please select at least one class');
        return false;
      }
      if (!formData.class_size.trim()) {
        toast.error('Please select at least one structure of classes option');
        return false;
      }
      return true;
    }
    if (stepIndex === 2) {
      if (!formData.location_v2) {
        toast.error('Please select a location option');
        return false;
      }
      if (formData.location_v2 === "STUDENT'S HOME TUTORING ONLY" && !formData.students_home_areas.trim()) {
        toast.error("Please select at least one area for Student's Home Tutoring");
        return false;
      }
      if (formData.location_v2 === "TEACHER'S HOME TUTORING" && !formData.tutors_home_areas.trim()) {
        toast.error("Please select at least one area for Teacher's Home Tutoring");
        return false;
      }
      if (formData.location_v2 === 'BOTH OPTIONS LISTED') {
        if (!formData.students_home_areas.trim()) {
          toast.error("Please select at least one area for Student's Home Tutoring");
          return false;
        }
        if (!formData.tutors_home_areas.trim()) {
          toast.error("Please select at least one area for Teacher's Home Tutoring");
          return false;
        }
      }
      if (!formData.mode_of_teaching.trim()) {
        toast.error('Please select at least one mode of teaching');
        return false;
      }
      return true;
    }
    if (stepIndex === 3) {
      const monthlyFee = parseInt(formData.min_fees.replace(/\D/g, ''), 10);
      if (!formData.min_fees.trim() || Number.isNaN(monthlyFee) || monthlyFee <= 0) {
        toast.error('Please enter a monthly fee greater than ₹0');
        return false;
      }
      if (!formData.mou_consent) {
        // MOU lives on the final step, but fee/terms is where we ask them to read it isn't blocking here.
      }
      return true;
    }
    return true;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const showStudentAreas = formData.location_v2 === "STUDENT'S HOME TUTORING ONLY" || formData.location_v2 === 'BOTH OPTIONS LISTED';
  const showTutorAreas = formData.location_v2 === "TEACHER'S HOME TUTORING" || formData.location_v2 === 'BOTH OPTIONS LISTED';

  const currentStep = STEPS[step];

  return (
    <div className="flex h-[100dvh] flex-col gap-seam bg-background">
      {/* Handoff JA-001/002/003: fixed three-region shell — this route is
          chromeless (App.tsx), so h-[100dvh] is the true viewport, not a
          page that also has to fit a floating bottom nav underneath. */}
      <BentoPanel fill="dark" edge="top" className="flex-none px-5 pt-1.5 pb-5">
        <div className="flex h-12 items-center gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={goBack}
              aria-label="Back to the previous step"
              /* C-013: a 40px painted disc carries `before:-inset-[2px]` so the
                 hit box is 44×44 — the changelog names these discs explicitly. */
              className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/10 text-background transition-colors before:absolute before:-inset-[2px] before:content-[''] hover:bg-white/20"
            >
              <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : (
            <Link
              to="/join"
              aria-label="Back to why join Shikshaq"
              /* C-013: a 40px painted disc carries `before:-inset-[2px]` so the
                 hit box is 44×44 — the changelog names these discs explicitly. */
              className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/10 text-background transition-colors before:absolute before:-inset-[2px] before:content-[''] hover:bg-white/20"
            >
              <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={2.4} aria-hidden="true" />
            </Link>
          )}
          <ProgressSteps steps={STEPS.length} current={step} label={currentStep.label} tone="dark" hideCaption className="flex-1" />
          <span className="flex-none whitespace-nowrap text-[13px] font-bold text-background/60">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="mt-3 text-[12px] font-bold uppercase tracking-[0.04em] text-background/50">{currentStep.label}</div>
        <h1 className="mt-1.5 font-display text-[30px] font-black leading-[1.02] tracking-[-0.04em] text-background">{currentStep.head}</h1>
        <p className="mt-2 text-[15px] leading-[1.5] text-background/65">{currentStep.lede}</p>
      </BentoPanel>

      <BentoPanel fill="card" className="min-h-0 flex-1 overflow-y-auto p-5">
        <form
          id="join-apply-form"
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            // pages.md §13: "`Enter` advances." On every step but the last,
            // Enter in a text field should move to the next step rather than
            // submit the (incomplete) form. On the last step, let the native
            // submit happen. Textareas keep their own newline behaviour.
            if (e.key === 'Enter' && !isLastStep && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
              e.preventDefault();
              goNext();
            }
          }}
        >
          <div ref={stepScrollRef}>
            {/* J1 — who you are */}
            {step === 0 && (
              <div className="animate-fade-slide-up">
                <div className="grid gap-4">
                  <Field label="Full name" required error={nameV.error}>
                    {(p) => (
                      <FieldInput
                        {...p}
                        autoComplete="name"
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        onBlur={nameV.onBlur}
                        placeholder="e.g. Ananya Ghosh"
                        maxLength={200}
                      />
                    )}
                  </Field>

                  <Field label="Email" required error={emailV.error}>
                    {(p) => (
                      <FieldInput
                        {...p}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        onBlur={emailV.onBlur}
                        placeholder="e.g. name@example.com"
                        maxLength={254}
                      />
                    )}
                  </Field>

                  <div>
                    <Eyebrow as="p" className="mb-2">Sir or Ma'am <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                    <div className="flex gap-2">
                      {SIR_MAAM.map((option) => (
                        <Pill key={option} label={option} selected={formData.sir_maam === option} onClick={() => handleInputChange('sir_maam', option)} />
                      ))}
                    </div>
                  </div>

                  <Field label="WhatsApp number" required error={phoneV.error} hint="Shown only once a guardian taps WhatsApp. Never on the open page, never in search results.">
                    {(p) => (
                      <FieldInput
                        {...p}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={formData.phone_number}
                        onChange={(e) => handleInputChange('phone_number', e.target.value.replace(/\D/g, '').slice(0, 10))}
                        onBlur={phoneV.onBlur}
                        placeholder="10-digit number"
                        maxLength={10}
                      />
                    )}
                  </Field>

                  <Field label="Years of experience" hint="Optional">
                    {(p) => (
                      <FieldInput
                        {...p}
                        value={formData.years_started_teaching}
                        onChange={(e) => handleInputChange('years_started_teaching', e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="e.g. 12"
                        maxLength={4}
                        inputMode="numeric"
                      />
                    )}
                  </Field>

                  {/* Photo — moved up from the old final-step location to match J1
                      ("who you are: name, WhatsApp, years, photo"). */}
                  <div>
                    <Eyebrow as="p" className="mb-2">Photo</Eyebrow>
                    <div className="grid gap-3">
                      {imagePreview && (() => {
                        const validatedUrl = validateImageSrc(imagePreview);
                        if (!validatedUrl) return null;
                        const safeSrc = DOMPurify.sanitize(validatedUrl, { ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true });
                        if (!safeSrc) return null;
                        return (
                          <div className="relative w-full max-w-[340px]">
                            <img
                              src={safeSrc}
                              alt="Photo preview"
                              className="w-full h-[190px] object-cover rounded-2xl ring-1 ring-inset ring-warm-hairline"
                              onError={() => setImagePreview(null)}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
                                setSelectedImageFile(null);
                                setImagePreview(null);
                                handleInputChange('hero_image_url', '');
                              }}
                              className="absolute top-2 right-2 flex items-center justify-center w-10 h-10 rounded-full bg-card/90 shadow-border"
                            >
                              <X className="w-4 h-4 text-foreground" />
                            </button>
                          </div>
                        );
                      })()}
                      <label
                        htmlFor="heroImageUpload"
                        className="inline-flex items-center gap-2 w-fit min-h-11 px-4 rounded-lg text-sm font-semibold text-foreground ring-1 ring-inset ring-warm-hairline cursor-pointer"
                      >
                        <Upload className="w-4 h-4" />
                        {selectedImageFile ? 'Change photo' : 'Select photo'}
                        <input
                          id="heroImageUpload"
                          type="file"
                          accept="image/*"
                          aria-label="Upload profile photo, optional, up to 5MB"
                          className="hidden"
                          onChange={handleImageFileChange}
                          disabled={submitting}
                        />
                      </label>
                      <p className="text-meta text-warm-meta">
                        {selectedImageFile ? 'Uploaded when you submit the form. Max 5MB.' : 'Optional, but a photo doubles replies. Max 5MB.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* J2 — what you teach */}
            {step === 1 && (
              <div className="animate-fade-slide-up">

                <div className="mb-6">
                  <Eyebrow as="p" className="mb-3">Subjects <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {SUBJECTS.map((subject) => {
                      const selected = valueExistsInString(formData.subjects, subject);
                      const sc = getSubjectColors(subject);
                      return (
                        <Pill
                          key={subject}
                          label={subject}
                          selected={selected}
                          dynamicTint={{ bg: sc.tint, color: sc.titleText }}
                          onClick={() => handleMultiSelectChange('subjects', subject, !selected)}
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="mb-6">
                  <Eyebrow as="p" className="mb-3">Boards catered <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {BOARDS.map((board) => {
                      const selected = valueExistsInString(formData.school_boards_catered, board);
                      return (
                        <Pill
                          key={board}
                          label={board}
                          selected={selected}
                          tintClass="bg-brand-blue-subtle text-brand-blue-deep"
                          onClick={() => handleMultiSelectChange('school_boards_catered', board, !selected)}
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="mb-6">
                  <Eyebrow as="p" className="mb-3">Classes <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                  <div className="grid grid-cols-6 gap-2">
                    {CLASSES.map((cls) => {
                      const selected = valueExistsInString(formData.classes_taught_for_backend, cls);
                      return (
                        <NumberGridOption key={cls} label={cls} selected={selected} onClick={() => handleMultiSelectChange('classes_taught_for_backend', cls, !selected)} />
                      );
                    })}
                  </div>
                </div>

                <div className="mb-6">
                  <Eyebrow as="p" className="mb-3">Structure of classes <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {CLASS_SIZE.map((size) => {
                      const selected = valueExistsInString(formData.class_size, size);
                      return (
                        <Pill
                          key={size}
                          label={size === 'Solo' ? 'One-on-one' : size}
                          selected={selected}
                          onClick={() => handleMultiSelectChange('class_size', size, !selected)}
                        />
                      );
                    })}
                  </div>
                </div>

                <Field label="Featured subject" hint="Choose one of your selected subjects to feature on your profile">
                  {(p) => (
                    <Select
                      value={(() => {
                        const selectedSubjects = (formData.subjects || '').split(',').map((s) => s.trim()).filter(Boolean);
                        const current = formData.featured_subject;
                        return current && selectedSubjects.includes(current) ? current : 'none';
                      })()}
                      onValueChange={(value) => handleInputChange('featured_subject', value === 'none' ? '' : value)}
                    >
                      <SelectTrigger id={p.id} className={p.className}>
                        <SelectValue placeholder="Select featured subject" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {(formData.subjects || '').split(',').map((s) => s.trim()).filter(Boolean).map((subject) => (
                          <SelectItem key={subject} value={subject}>
                            {subject}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </div>
            )}

            {/* J3 — where you teach */}
            {step === 2 && (
              <div className="animate-fade-slide-up">

                <Field label="Location" required className="mb-6">
                  {(p) => (
                    <Select value={formData.location_v2 || '__none__'} onValueChange={(value) => handleInputChange('location_v2', value === '__none__' ? '' : value)}>
                      <SelectTrigger id={p.id} className={p.className}>
                        <SelectValue placeholder="Select location option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        <SelectItem value="TEACHER'S HOME TUTORING">Teacher's home tutoring only</SelectItem>
                        <SelectItem value="STUDENT'S HOME TUTORING ONLY">Student's home tutoring only</SelectItem>
                        <SelectItem value="BOTH OPTIONS LISTED">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>

                {showStudentAreas && (
                  <div className="mb-6">
                    <Eyebrow as="p" className="mb-3">Areas you teach in (student's home) <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                    <div className="flex flex-wrap gap-2">
                      {AREAS.map((area) => {
                        const selected = valueExistsInString(formData.students_home_areas, area);
                        return (
                          <Pill
                            key={area}
                            label={area}
                            selected={selected}
                            tintClass="bg-brand-subtle text-brand-deep"
                            onClick={() => handleMultiSelectChange('students_home_areas', area, !selected)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {showTutorAreas && (
                  <div className="mb-6">
                    <Eyebrow as="p" className="mb-3">Areas you teach in (your home) <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                    <div className="flex flex-wrap gap-2">
                      {AREAS.map((area) => {
                        const selected = valueExistsInString(formData.tutors_home_areas, area);
                        return (
                          <Pill
                            key={area}
                            label={area}
                            selected={selected}
                            tintClass="bg-brand-subtle text-brand-deep"
                            onClick={() => handleMultiSelectChange('tutors_home_areas', area, !selected)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                <p className="mb-2 text-meta text-warm-meta">We show your locality and radius, like "Doranda, travels 5 km", and nothing more precise than that.</p>

                <div className="mb-6">
                  <Eyebrow as="p" className="mb-3">Mode of teaching <span aria-hidden="true" className="text-facet-destructive">*</span><span className="sr-only"> required</span></Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {MODE_OF_TEACHING.map((mode) => {
                      const selected = valueExistsInString(formData.mode_of_teaching, mode);
                      return (
                        <Pill key={mode} label={mode} selected={selected} onClick={() => handleMultiSelectChange('mode_of_teaching', mode, !selected)} />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* J4 — your fee, your terms */}
            {step === 3 && (
              <div className="animate-fade-slide-up">

                {/* pages.md §13 — required disclosure, verbatim. */}
                <p className="mb-6 rounded-2xl bg-background p-4 text-sm leading-relaxed text-warm-prose ring-1 ring-inset ring-warm-hairline">
                  Listing is free. We take no commission, ever. Guardians and teachers settle fees between themselves. We never invoice, never hold a deposit, and never show a "platform price".
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <Field label="Monthly fee ₹" required>
                    {(p) => (
                      <FieldInput
                        {...p}
                        type="tel"
                        value={formData.min_fees}
                        onChange={(e) => handleInputChange('min_fees', e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="₹3,000"
                        maxLength={6}
                        inputMode="numeric"
                      />
                    )}
                  </Field>
                  <Field label="Maximum fee / month" hint="Optional">
                    {(p) => (
                      <FieldInput
                        {...p}
                        type="tel"
                        value={formData.max_fees}
                        onChange={(e) => handleInputChange('max_fees', e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="₹5,000"
                        maxLength={6}
                        inputMode="numeric"
                      />
                    )}
                  </Field>
                </div>

                {/* Free-first-class toggle — pages.md §13 J4 field list. No
                    backend column exists yet for it (O-07 covers verification
                    docs, not this), so it stays local UI state and is not part
                    of the teacher_applications insert below. */}
                <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl bg-background p-4 ring-1 ring-inset ring-warm-hairline">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Offer a free first class</p>
                    <p className="mt-0.5 text-meta text-warm-meta">Shown on your profile. Helps guardians decide.</p>
                  </div>
                  <Switch
                    checked={formData.free_first_class}
                    onCheckedChange={(checked) => handleInputChange('free_first_class', checked)}
                    aria-label="Offer a free first class"
                  />
                </div>

                <div className="grid gap-6">
                  <Field label="Profile introduction, in your own words" hint={`${formData.description.length}/1000`}>
                    {(p) => (
                      <FieldTextarea
                        {...p}
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                        rows={5}
                        placeholder="Tell us about yourself and your teaching approach..."
                        maxLength={1000}
                      />
                    )}
                  </Field>

                  <Field label="Educational qualifications" hint={`${formData.qualifications_etc.length}/500`}>
                    {(p) => (
                      <FieldTextarea
                        {...p}
                        value={formData.qualifications_etc}
                        onChange={(e) => handleInputChange('qualifications_etc', e.target.value)}
                        rows={3}
                        placeholder="Your educational qualifications, certifications, etc."
                        maxLength={500}
                      />
                    )}
                  </Field>
                </div>
              </div>
            )}

            {/* Verify & consent — collects the two legacy verification fields
                (reference_name/reference_number) and MOU consent that the J1–J5
                mockup has no slot for. This is where the real "Send" happens,
                so its copy must not borrow J5's post-submission "With us now"
                language (see WAITING_ON_REVIEW above, used on the submitted
                screen instead). */}
            {step === 4 && (
              <div className="animate-fade-slide-up">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <Field label="Student name (for verification)" required error={refNameV.error} hint="We will call them to verify you're a teacher">
                    {(p) => (
                      <FieldInput
                        {...p}
                        value={formData.reference_name}
                        onChange={(e) => handleInputChange('reference_name', e.target.value)}
                        onBlur={refNameV.onBlur}
                        placeholder="Name of a student we can contact"
                        maxLength={200}
                      />
                    )}
                  </Field>

                  <Field label="Student number (for verification)" required error={refNumberV.error}>
                    {(p) => (
                      <FieldInput
                        {...p}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="off"
                        value={formData.reference_number}
                        onChange={(e) => handleInputChange('reference_number', e.target.value.replace(/\D/g, '').slice(0, 10))}
                        onBlur={refNumberV.onBlur}
                        placeholder="10-digit number"
                        maxLength={10}
                      />
                    )}
                  </Field>
                </div>

                <div className="rounded-2xl bg-background ring-1 ring-inset ring-warm-hairline p-4 grid gap-4">
                  <p className="text-sm font-semibold text-foreground">Memorandum of Understanding</p>
                  <p className="text-sm leading-relaxed text-warm-prose">
                    This Memorandum of Understanding confirms that you grant Shikshaq permission to display your submitted profile (name, locality, place of
                    teaching, subjects, boards, classes, photo, and WhatsApp link) on our platform for the sole purpose of connecting you with students and
                    enhancing their learning experience.
                  </p>
                  <div className="text-sm text-warm-prose">
                    <p className="font-semibold mb-2">I have read and understood the above Memorandum of Understanding and consent to:</p>
                    <ol className="list-decimal list-inside grid gap-1.5 ml-2">
                      <li>Shikshaq displaying my educator profile as previously submitted;</li>
                      <li>The use of my WhatsApp link to let students land directly on my WhatsApp chat through Shikshaq for communication;</li>
                      <li>The use of my provided information for student outreach and internal communication;</li>
                      <li>This digital form serving as a legally binding agreement.</li>
                    </ol>
                  </div>
                  <div className="flex items-start gap-3 pt-4 border-t border-warm-hairline">
                    <Checkbox id="mou_consent" checked={formData.mou_consent} onCheckedChange={(checked) => handleInputChange('mou_consent', checked === true)} required />
                    <label htmlFor="mou_consent" className="text-sm leading-relaxed cursor-pointer">
                      <span className="font-semibold text-foreground">I consent. *</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        </form>
      </BentoPanel>

      {/* Handoff JA-005: pinned action row — Back (omitted on step 1) then
          Save and continue / Send for review, both h54. The primary button
          targets the form by `id` so it submits correctly despite sitting
          outside the <form> (JoinApply's action panel is a sibling of the
          body panel, not a descendant). */}
      <BentoPanel fill="card" edge="bottom" className="flex-none p-[16px_20px_26px]">
        <div className="flex gap-2.5">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="flex h-[54px] flex-none items-center rounded-full bg-muted px-[22px] text-[15px] font-bold text-foreground transition-transform duration-tap active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Back
            </button>
          )}
          {!isLastStep ? (
            <Button type="button" onClick={goNext} variant="primary" size={54} className="flex-1 text-[15px] font-extrabold">
              Save and continue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              form="join-apply-form"
              disabled={submitting}
              busy={submitting}
              variant="primary"
              size={54}
              className="flex-1 text-[15px] font-extrabold"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send for review'
              )}
            </Button>
          )}
        </div>
      </BentoPanel>
    </div>
  );
}
