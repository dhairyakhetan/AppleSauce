import { useEffect, useState, type ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';
import DOMPurify from 'dompurify';
import { ExternalLink, Upload, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/use-confirm';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { validateImageSrc } from '@/utils/imageSanitizer';
import { convertClassesToRoman } from '@/utils/romanNumerals';
import { AREAS, BOARDS, CLASSES, CLASS_SIZE, MODE_OF_TEACHING, SIR_MAAM, SUBJECTS } from '@/lib/teacher-options';
import { CONTACTS_FAILED_WORDS, buildTeacherUpdate, closeWithGuard, contactsFailed, formIsDirty, initialTeacherForm, publicProfilePath, sanitizeImageUrl, type TeacherData, type TeacherForm } from '@/lib/admin-teachers';

/* The edit form for a listed teacher, in six groups: Identity, Teaching, Where
   and fees, Contact, Photo and video, Reviews. Save and Cancel stay on screen
   (sticky footer), and closing with unsaved changes asks first. What a save
   writes is built by buildTeacherUpdate, the same fields as before. */

const FIELD = 'h-auto border border-warm-hairline bg-card focus-visible:ring-1 focus-visible:ring-ring';
const OPTION = 'cursor-pointer text-[13px] text-warm-prose';

const norm = (v: string) => v.trim().toLowerCase();
const listHas = (s: string | null | undefined, value: string) => (s ? s.split(',').map(norm).includes(norm(value)) : false);

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-warm-hairline pt-5 first:border-t-0 first:pt-1">
      <h3 className="text-[16px] font-extrabold tracking-[-0.02em] text-foreground">{title}</h3>
      {hint ? <p className="mt-0.5 text-[13px] text-warm-secondary">{hint}</p> : null}
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

function CheckGroup({
  idPrefix,
  legend,
  options,
  value,
  onToggle,
  scroll,
  display,
  hint,
}: {
  idPrefix: string;
  legend: string;
  options: readonly string[];
  value: string | null | undefined;
  onToggle: (option: string, on: boolean) => void;
  scroll?: boolean;
  display?: (o: string) => string;
  hint?: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {hint ? <p className="mt-0.5 text-xs text-warm-label">{hint}</p> : null}
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-2.5 ${scroll ? 'max-h-48 overflow-y-auto' : ''}`}>
        {options.map((o) => (
          <div key={o} className="flex items-center space-x-2">
            <Checkbox id={`${idPrefix}-${o}`} checked={listHas(value, o)} onCheckedChange={(c) => onToggle(o, c === true)} />
            <Label htmlFor={`${idPrefix}-${o}`} className={OPTION}>
              {display ? display(o) : o}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export interface TeacherEditDialogProps {
  /** The teacher being edited; null keeps the dialog closed. */
  teacher: TeacherData | null;
  saving: boolean;
  /** Called with exactly what buildTeacherUpdate produced. */
  onSave: (teacher: TeacherData, update: Record<string, unknown>) => void;
  onClose: () => void;
  uploadHero: (teacherId: number, file: File) => Promise<string>;
}

export function TeacherEditDialog({ teacher, saving, onSave, onClose, uploadHero }: TeacherEditDialogProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<TeacherForm>({});
  const [initial, setInitial] = useState<TeacherForm>({});
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const teacherId = teacher?.id ?? null;
  // The contact details did not load: the three fields would show blanks that are
  // not the real values, so they are locked until the page is reloaded.
  const noContacts = contactsFailed(teacher);

  // Start the form from the teacher whenever a different one is opened. Saving
  // the same teacher again (a refreshed row) must not wipe what is being typed.
  useEffect(() => {
    if (!teacher) {
      setForm({});
      setInitial({});
      setImagePreview(null);
      return;
    }
    const start = initialTeacherForm(teacher);
    setForm(start);
    setInitial(start);
    const hero = teacher['Hero Image'];
    setImagePreview(hero ? sanitizeImageUrl(hero) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  const dirty = formIsDirty(initial, form);

  const set = (field: keyof TeacherData, value: unknown) => {
    setForm((prev) => {
      const next: TeacherForm = { ...prev, [field]: value } as TeacherForm;
      if (field === 'Classes Taught for Backend') next['Classes Taught'] = convertClassesToRoman(value as string | null);
      return next;
    });
  };

  const toggle = (field: keyof TeacherData) => (option: string, on: boolean) => {
    const current = form[field] as string | null | undefined;
    const arr = current ? current.split(',').map((v) => v.trim()) : [];
    const next = on ? [...arr, option].filter((v) => v !== '') : arr.filter((v) => v !== option);
    set(field, next.join(', ') || null);
  };

  const requestClose = async () => {
    if (await closeWithGuard({ dirty, saving, confirm })) onClose();
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !teacher) return;
    if (!file.type.startsWith('image/')) {
      sonnerToast.error('Please select an image file');
      return;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.heic') || lower.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif') {
      sonnerToast.error('HEIC images are not supported. Please upload a JPG or PNG image instead.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      sonnerToast.error('Image size must be less than 5MB');
      return;
    }
    try {
      setUploading(true);
      const url = await uploadHero(teacher.id, file);
      const safe = sanitizeImageUrl(url);
      if (safe) {
        set('Hero Image', safe);
        setImagePreview(safe);
        sonnerToast.success('Image uploaded successfully');
      } else {
        sonnerToast.error('Failed to generate valid image URL');
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error uploading image:', error);
      sonnerToast.error('Image upload failed. Please use a URL instead.');
    } finally {
      setUploading(false);
    }
  };

  const profile = teacher ? publicProfilePath(teacher) : null;

  const footer = (
    <div className="flex w-full flex-wrap items-center gap-2">
      {profile ? (
        <a
          href={profile}
          target="_blank"
          rel="noopener noreferrer"
          className="mr-auto inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-brand-blue hover:bg-brand-blue-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View public profile
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <span className="mr-auto text-[13px] text-warm-secondary">No public page yet</span>
      )}
      {dirty ? <span className="text-[12px] font-semibold text-warm-secondary">Unsaved changes</span> : null}
      <AdminPillButton variant="quiet" size="sm" disabled={saving} onClick={() => void requestClose()}>
        Cancel
      </AdminPillButton>
      <AdminPillButton variant="primary" size="sm" busy={saving} onClick={() => teacher && onSave(teacher, buildTeacherUpdate(form))}>
        {saving ? 'Saving...' : 'Save changes'}
      </AdminPillButton>
    </div>
  );

  const heroUrl = (() => {
    if (!imagePreview) return null;
    const safe = sanitizeImageUrl(imagePreview);
    if (!safe) return null;
    return DOMPurify.sanitize(validateImageSrc(safe), { ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true }) || null;
  })();

  return (
    <>
      <AdminDialog
        open={teacher !== null}
        onOpenChange={(o) => { if (!o) void requestClose(); }}
        title={teacher?.Title || 'Edit teacher'}
        description="Changes show on the site as soon as you save."
        size="xl"
        footer={footer}
      >
        {teacher ? (
          <div className="space-y-5">
            <Group title="Identity">
              <div>
                <Label htmlFor="title">Name</Label>
                <Input id="title" value={form.Title || ''} onChange={(e) => set('Title', e.target.value)} className={FIELD} />
              </div>
              <div>
                <Label htmlFor="sirMaam">Sir or Ma'am</Label>
                <Select value={form["Sir/Ma'am?"] || 'none'} onValueChange={(v) => set("Sir/Ma'am?", v === 'none' ? null : v)}>
                  <SelectTrigger id="sirMaam" className={FIELD}>
                    <SelectValue placeholder="Select Sir or Ma'am" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {SIR_MAAM.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2 md:col-span-2">
                <Checkbox id="featured" checked={form.Featured || false} onCheckedChange={(c) => set('Featured', c)} />
                <Label htmlFor="featured" className="cursor-pointer text-sm font-semibold">Featured: show in the featured teachers on the home page and Browse</Label>
              </div>
            </Group>

            <Group title="Teaching">
              <div>
                <Label htmlFor="featuredSubject">Featured subject</Label>
                <Select value={form['Featured Subject'] ? form['Featured Subject'] : 'none'} onValueChange={(v) => set('Featured Subject', v === 'none' ? null : v)}>
                  <SelectTrigger id="featuredSubject" className={FIELD}>
                    <SelectValue placeholder="Select featured subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="yearsStarted">Year they started teaching</Label>
                <Input id="yearsStarted" value={form['Years they started teaching'] || ''} onChange={(e) => set('Years they started teaching', e.target.value)} className={FIELD} />
              </div>
              <CheckGroup idPrefix="subject" legend="Subjects" options={SUBJECTS} value={form.Subjects} onToggle={toggle('Subjects')} scroll />
              <CheckGroup idPrefix="class" legend="Classes taught" hint="Select the classes. The display form is worked out for you." options={CLASSES} value={form['Classes Taught for Backend']} onToggle={toggle('Classes Taught for Backend')} />
              <CheckGroup idPrefix="board" legend="School boards" options={BOARDS} value={form['School Boards Catered']} onToggle={toggle('School Boards Catered')} />
              <CheckGroup idPrefix="mode" legend="Mode of teaching" options={MODE_OF_TEACHING} value={form['Mode of Teaching']} onToggle={toggle('Mode of Teaching')} />
              <CheckGroup idPrefix="classSize" legend="Structure of classes" options={CLASS_SIZE} value={form['Class Size (Group/ Solo)']} onToggle={toggle('Class Size (Group/ Solo)')} display={(o) => (o === 'Solo' ? 'One-on-one' : o)} />
              <div className="md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={form.Description || ''} onChange={(e) => set('Description', e.target.value)} rows={5} className={FIELD} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="qualifications">Qualifications</Label>
                <Textarea id="qualifications" value={form['Qualifications etc'] || ''} onChange={(e) => set('Qualifications etc', e.target.value)} rows={3} className={FIELD} />
              </div>
            </Group>

            <Group title="Where and fees">
              <div className="md:col-span-2">
                <Label htmlFor="locationV2">Where lessons happen</Label>
                <Select value={form['LOCATION V2'] || 'none'} onValueChange={(v) => set('LOCATION V2', v === 'none' ? null : v)}>
                  <SelectTrigger id="locationV2" className={FIELD}>
                    <SelectValue placeholder="Select where lessons happen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="TEACHER'S HOME TUTORING">At the teacher's home only</SelectItem>
                    <SelectItem value="STUDENT'S HOME TUTORING ONLY">At the student's home only</SelectItem>
                    <SelectItem value="BOTH OPTIONS LISTED">Either the teacher's home or the student's home</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <CheckGroup idPrefix="student-area" legend="Areas they visit (student's home)" options={AREAS} value={form["STUDENT'S HOME IN THESE AREAS"]} onToggle={toggle("STUDENT'S HOME IN THESE AREAS")} scroll />
              <CheckGroup idPrefix="tutor-area" legend="Areas they teach in (teacher's home)" options={AREAS} value={form["TUTOR'S HOME IN THESE AREAS"]} onToggle={toggle("TUTOR'S HOME IN THESE AREAS")} scroll />
              <div>
                <Label htmlFor="minFees">Lowest fee per month (Rs)</Label>
                <Input
                  id="minFees"
                  type="tel"
                  value={form['Min Fees']?.toString() || ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    set('Min Fees', digits ? parseInt(digits) : null);
                  }}
                  placeholder="e.g., 2000"
                  maxLength={6}
                  inputMode="numeric"
                  className={FIELD}
                />
              </div>
              <div>
                <Label htmlFor="maxFees">Highest fee per month (Rs)</Label>
                <Input
                  id="maxFees"
                  type="tel"
                  value={form['Max Fees']?.toString() || ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    set('Max Fees', digits ? parseInt(digits) : null);
                  }}
                  placeholder="e.g., 5000"
                  maxLength={6}
                  inputMode="numeric"
                  className={FIELD}
                />
              </div>
            </Group>

            <Group title="Contact" hint="Only staff see these. Parents reach the teacher through the site.">
              {noContacts ? (
                <p role="alert" className="text-[13px] font-semibold text-destructive md:col-span-2">
                  {CONTACTS_FAILED_WORDS}
                </p>
              ) : null}
              <div>
                <Label htmlFor="phoneNumber">Phone number</Label>
                <Input id="phoneNumber" value={form['Phone Number'] || ''} disabled={noContacts} onChange={(e) => set('Phone Number', e.target.value)} className={FIELD} />
              </div>
              <div>
                <Label htmlFor="emailId">Email</Label>
                <Input id="emailId" type="email" value={form['Email ID'] || ''} disabled={noContacts} onChange={(e) => set('Email ID', e.target.value)} className={FIELD} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="link">WhatsApp link</Label>
                <Input id="link" value={form.Link || ''} disabled={noContacts} onChange={(e) => set('Link', e.target.value)} className={FIELD} />
              </div>
            </Group>

            <Group title="Photo and video">
              <div className="md:col-span-2">
                <Label htmlFor="heroImage">Profile photo</Label>
                <div className="space-y-3">
                  {heroUrl ? (
                    <div className="relative w-full max-w-md">
                      <img
                        src={heroUrl}
                        alt="Profile photo preview"
                        className="h-48 w-full rounded-[14px] object-cover shadow-border"
                        onError={() => setImagePreview(null)}
                        crossOrigin="anonymous"
                      />
                      <button
                        type="button"
                        aria-label="Remove the profile photo"
                        className="absolute right-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-foreground hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          set('Hero Image', null);
                          setImagePreview(null);
                        }}
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="heroImageUpload"
                      className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-foreground shadow-border transition-colors hover:bg-black/[.04]"
                    >
                      <Upload className="h-4 w-4" aria-hidden />
                      {uploading ? 'Uploading...' : 'Upload image'}
                      <input
                        id="heroImageUpload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          void onFile(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                        disabled={uploading}
                      />
                    </label>
                    <span className="text-xs text-warm-label">or</span>
                  </div>

                  <Input
                    id="heroImage"
                    placeholder="Or enter image URL"
                    value={form['Hero Image'] || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const clean = v ? sanitizeImageUrl(v) : null;
                      if (clean !== null || !v) {
                        set('Hero Image', clean || '');
                        setImagePreview(clean);
                      } else {
                        sonnerToast.error('Please enter a valid image URL (http:// or https://)');
                      }
                    }}
                    className={FIELD}
                  />
                  <p className="text-xs text-warm-label">Upload an image file or paste an image URL. Max file size: 5MB</p>
                </div>
              </div>
              <div>
                <Label htmlFor="video">Intro video</Label>
                <Input id="video" value={form.Video || ''} onChange={(e) => set('Video', e.target.value)} className={FIELD} />
              </div>
              <div>
                <Label htmlFor="videoLink">Intro video, page link</Label>
                <Input id="videoLink" value={form['Video Link'] || ''} onChange={(e) => set('Video Link', e.target.value)} className={FIELD} />
              </div>
            </Group>

            <Group title="Reviews" hint="What parents said, shown on the teacher's page. These are their words, so edit with care.">
              {(['Review 1', 'Review 2', 'Review 3'] as const).map((r, i) => (
                <div key={r} className="md:col-span-2">
                  <Label htmlFor={`review${i + 1}`}>{r}</Label>
                  <Textarea id={`review${i + 1}`} value={form[r] || ''} onChange={(e) => set(r, e.target.value)} rows={3} className={FIELD} />
                </div>
              ))}
            </Group>
          </div>
        ) : null}
      </AdminDialog>
      {confirmDialog}
    </>
  );
}
