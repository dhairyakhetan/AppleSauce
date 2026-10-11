import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useRequireRole } from '@/hooks/use-require-role';
import { toast } from 'sonner';
import { z } from 'zod';
import { usePageMeta } from '@/hooks/usePageMeta';
import { logger } from '@/utils/logger';
import { Button } from '@/components/ui/button';
import { Field, FieldInput, FieldSelect, FieldTextarea, useBlurValidation } from '@/components/ui/field';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { Chip } from '@/components/ui/chip';
import { SUBJECTS } from '@/utils/searchFacets';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

const recommendSchema = z.object({
  teacherName: z.string().trim().min(1, "Please enter the teacher's name").max(100, "Teacher's name is too long"),
  subject: z.string().trim().max(100, 'Subject is too long').optional(),
  area: z.string().trim().max(100, 'Area is too long').optional(),
  contact: z.string().trim().max(50, 'Contact is too long').optional(),
  reason: z.string().trim().max(1000, 'Please keep this under 1000 characters').optional(),
});

export default function RecommendTeacher() {
  usePageMeta(
    'Recommend a Tuition Teacher in Kolkata | Shikshaq',
    'Know a great tuition teacher in Kolkata? Recommend them to Shikshaq so other students and parents can find them. Free to submit, takes under a minute.'
  );

  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [formData, setFormData] = useState({
    teacherName: '',
    subject: '',
    area: '',
    contact: '',
    reason: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Ensure user has selected a role
  useRequireRole();

  // Handoff RC-001: this route renders its own eyes panel, replacing
  // AppShell's default pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  const nameValidation = useBlurValidation(formData.teacherName, (v) =>
    v.trim().length === 0 ? "Please enter the teacher's name" : undefined
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if user is signed in
    if (!user) {
      toast.error('Please sign in to submit a recommendation');
      navigate('/auth');
      return;
    }

    const result = recommendSchema.safeParse(formData);
    if (!result.success) {
      setError(result.error.errors[0]?.message || "Please enter the teacher's name");
      return;
    }

    setLoading(true);
    setError('');

    try {
      const notesParts: string[] = [];
      if (formData.subject.trim()) notesParts.push(`Subject: ${formData.subject.trim()}`);
      if (formData.area.trim()) notesParts.push(`Area: ${formData.area.trim()}`);
      if (formData.reason.trim()) notesParts.push(`Why: ${formData.reason.trim()}`);

      // Submit to Supabase with user_id; recommender identity comes from the
      // signed-in account since the form itself only collects details about
      // the teacher being recommended.
      const { error: submitError } = await supabase
        .from('teacher_recommendations')
        .insert({
          user_id: user.id,
          recommender_name: profile?.full_name || user.email || 'Shikshaq user',
          recommender_contact: user.email || user.phone || '',
          teacher_name: formData.teacherName.trim(),
          teacher_contact: formData.contact.trim(),
          status: 'pending',
          notes: notesParts.length ? notesParts.join('\n') : null,
        });

      if (submitError) {
        logger.error('RecommendTeacher.submit', submitError);
        if (submitError.message?.includes('RATE_LIMIT_EXCEEDED')) {
          throw new Error("You've reached the daily limit for recommendations. Please try again tomorrow.");
        }
        throw new Error(submitError.message || 'Failed to submit recommendation');
      }

      setSubmitted(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit recommendation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff RC-001: dark header. The mockup's "Step 2 of 3" pill
              assumes this route is part of a wizard shared with /join/apply
              — it isn't (it's always been a standalone single-page form), so
              rendering a step count here would fabricate progress that
              doesn't exist. Copy is otherwise unchanged.

              The mockup measures this header 14px 22px 24px. The sides and
              the bottom are taken; the top is not, because the 14px there is
              clearance for the step pill this route deliberately omits — with
              no pill, `pt-1.5` plus the h1's own `mt-3.5` gives the same 20px
              above the headline. */}
          <BentoPanel fill="dark" edge="top" className="px-[22px] pt-1.5 pb-[24px]">
            <h1 className="mt-3.5 font-display text-[30px] font-black leading-[1.05] tracking-[-0.04em] text-background">
              Know a teacher worth listing?
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.55] text-background/70">
              Three fields. We verify before anything goes live.
            </p>
          </BentoPanel>

          <BentoPanel fill="card" className="p-[22px]">
          {submitted ? (
            <div className="animate-fade-slide-up rounded-bento bg-brand p-6 text-center sm:p-8">
              <p className="text-body font-semibold text-brand-foreground">
                Thanks. We will reach out to them this week.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-3" noValidate>
              <Field
                label="Teacher's name"
                required
                error={nameValidation.error}
              >
                {(controlProps) => (
                  <FieldInput
                    {...controlProps}
                    name="teacherName"
                    placeholder="e.g. Ananya Ghosh"
                    value={formData.teacherName}
                    onChange={handleChange}
                    onBlur={nameValidation.onBlur}
                    maxLength={100}
                    autoComplete="name"
                  />
                )}
              </Field>

              {/* A select, not the chip row. The chips were the right call on
                  the vocabulary question — free text had admins reconciling
                  "maths"/"Mathematics"/"Math" by hand — and this keeps that
                  exactly: the options ARE the canonical SUBJECTS list the
                  filters and hero search use. What changes is the shape. Thirty
                  44px chips wrapped to a wall of colour that dominated a form
                  whose required fields are two short text boxes, and the field
                  is optional. One 56px control, same as the fields around it.
                  Empty option kept so "not sure" stays reachable. */}
              <Field label="Subject">
                {(controlProps) => (
                  <FieldSelect
                    {...controlProps}
                    name="subject"
                    value={formData.subject}
                    onChange={(e) => setFormData((prev) => ({ ...prev, subject: e.target.value }))}
                  >
                    <option value="">Not sure / any subject</option>
                    {SUBJECTS.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </FieldSelect>
                )}
              </Field>

              <Field label="Area they teach in">
                {(controlProps) => (
                  <FieldInput
                    {...controlProps}
                    name="area"
                    placeholder="e.g. Ballygunge"
                    value={formData.area}
                    onChange={handleChange}
                    maxLength={100}
                  />
                )}
              </Field>

              <Field label="Their contact, if you have it" hint="Phone or WhatsApp, we verify, we never publish it.">
                {(controlProps) => (
                  <FieldInput
                    {...controlProps}
                    type="tel"
                    name="contact"
                    placeholder="e.g. +91 98300 00000"
                    value={formData.contact}
                    onChange={handleChange}
                    maxLength={50}
                    autoComplete="tel"
                  />
                )}
              </Field>

              <Field label="Why you would recommend them">
                {(controlProps) => (
                  <FieldTextarea
                    {...controlProps}
                    name="reason"
                    rows={4}
                    placeholder="A line or two is enough."
                    value={formData.reason}
                    onChange={handleChange}
                    maxLength={1000}
                  />
                )}
              </Field>

              {error ? (
                <p role="alert" className="text-meta text-facet-destructive">
                  {error}
                </p>
              ) : null}

              <Button type="submit" variant="primary" size={54} busy={loading} className="mt-1 w-full">
                Send recommendation
              </Button>
            </form>
          )}
          </BentoPanel>

          {/* Handoff RC-001: the privacy note is load-bearing copy, not
              decoration — it must render on the same screen as the phone
              field, which the form panel above already satisfies. */}
          <BentoPanel fill="brandTint" className="px-[22px] py-5">
            <p className="text-[14px] leading-[1.55] text-warm-prose">
              We never publish a teacher&rsquo;s details without their consent, and we do not tell
              them who recommended them unless you ask us to.
            </p>
          </BentoPanel>

          {/* Shared tail. */}
          <EyesPanel
            mode={builderMode}
            onModeChange={setBuilderMode}
            heading={(
              <>
                Still deciding? <span className="font-extrabold">We&rsquo;re watching out for you.</span>
              </>
            )}
            subline="Fill in the blanks and we'll take you straight there."
            slots={builderSlots}
            onSlotChange={handleSlotChange}
            onSubmit={handleBuilderSubmit}
          />
        </BentoStack>
      </main>
    </div>
  );
}
