import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileText, Loader2, ShieldCheck, Upload, X } from 'lucide-react';

import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { Field, FieldInput, FieldSelect } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { usePageMeta } from '@/hooks/usePageMeta';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { SUBJECTS, CLASSES, BOARDS } from '@/utils/searchFacets';
import {
  ACCEPT,
  MAX_FILES,
  UPLOAD_TIMEOUT_MS,
  mergeFiles,
  uploadProgressLabel,
  withTimeout,
} from '@/lib/submit-paper-files';

/* Submit a paper: pick the file, tell us what it is, we review it, it goes up.

   The first version of this page handed off to WhatsApp instead of taking the
   file, because there was nowhere to put one. That was the wrong shape for the
   job: sending a stranger to another app to attach a photo is not "submitting
   a paper", it is asking them to do the work twice.

   So this uploads. `paper-submissions` (storage) and `paper_submissions`
   (table) are where it puts things, both created by the migration
   20260829072445_paper_submissions.sql and live.

   The upload is insert-only to the public: a submission carries the sender's
   contact details, so nothing here can be read back without an admin. If the
   write fails anyway (offline, or storage having a bad day) the form falls
   back to the WhatsApp handoff with the same details prefilled, so nobody is
   ever left at a dead end holding a file they cannot send. */

const EXAM_TYPES = ['Prelim / Pre-board', 'Half-yearly', 'Annual / Final', 'Unit test', 'Other'];
const BUCKET = 'paper-submissions';

type Stage = 'form' | 'sending' | 'done' | 'fallback';

export default function SubmitPaper() {
  usePageMeta(
    'Submit a Past Paper from Your School | Shikshaq',
    'Upload a question paper from your school so the next batch can revise from it. We check it and credit your school.',
  );

  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  // The latest list, readable inside addFiles without making it re-create.
  const filesRef = useRef<File[]>([]);
  const [stage, setStage] = useState<Stage>('form');
  const [error, setError] = useState<string | null>(null);
  // 1-based index of the file being uploaded while stage is 'sending'.
  const [uploading, setUploading] = useState<number | null>(null);
  const [form, setForm] = useState({
    school: '', board: '', cls: '', subject: '', year: '', examType: '', name: '', contact: '',
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  /* Picking and dropping share this, so a dropped .docx is refused exactly as
     the picker's accept filter would have refused it. Anything left out (wrong
     type, over 25MB, past the tenth file) is named in one message: nothing is
     dropped silently. Pure rules in lib/submit-paper-files.ts. */
  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const { files: merged, notice } = mergeFiles(filesRef.current, incoming);
    filesRef.current = merged;
    setFiles(merged);
    setError(notice);
  }, []);

  const removeFile = (i: number) => {
    const next = filesRef.current.filter((_, n) => n !== i);
    filesRef.current = next;
    setFiles(next);
  };

  const ready = files.length > 0 && form.school.trim() !== '' && form.subject !== '';

  /* The same details as a message, for the fallback and for anyone who would
     simply rather send it on WhatsApp. */
  const waHref = useMemo(() => {
    const lines = [
      'Hi Shikshaq, I have a past paper to share.',
      '',
      form.school && `School: ${form.school}`,
      form.board && `Board: ${form.board}`,
      form.cls && `Class: ${form.cls}`,
      form.subject && `Subject: ${form.subject}`,
      form.year && `Year: ${form.year}`,
      form.examType && `Exam: ${form.examType}`,
      '',
      'I will attach the paper here.',
    ].filter(Boolean);
    return `${getWhatsAppLink('8240980312')}?text=${encodeURIComponent(lines.join('\n'))}`;
  }, [form]);

  const submit = useCallback(async () => {
    if (!ready) return;
    setStage('sending');
    setError(null);
    // Declared outside the try so the catch block can still see which
    // uploads (if any) succeeded before a later step failed.
    const paths: string[] = [];
    try {
      const stamp = Date.now();
      for (const [i, file] of files.entries()) {
        const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
        const path = `${stamp}-${i}-${safe}`;
        setUploading(i + 1);
        const { error: upErr } = await withTimeout(
          supabase.storage.from(BUCKET).upload(path, file, {
            cacheControl: '3600',
            upsert: false,
          }),
          UPLOAD_TIMEOUT_MS,
        );
        if (upErr) throw upErr;
        paths.push(path);
      }

      const { error: rowErr } = await supabase.from('paper_submissions' as never).insert({
        school: form.school.trim(),
        board: form.board || null,
        class: form.cls || null,
        subject: form.subject,
        year: form.year.trim() || null,
        exam_type: form.examType || null,
        submitter_name: form.name.trim() || null,
        submitter_contact: form.contact.trim() || null,
        file_paths: paths,
        status: 'pending',
      } as never);
      if (rowErr) throw rowErr;

      setStage('done');
    } catch (err) {
      /* Not provisioned yet, the reader is offline, or an upload stalled past
         its timeout. Either way they should not lose what they typed, so hand
         them the WhatsApp route with it.
         Any files that made it to storage before the failure are now orphaned:
         no paper_submissions row references them. They are NOT cleaned up from
         here. The public may only insert into the bucket (no delete policy, by
         design: nobody outside admin can touch what strangers uploaded), so a
         remove() from this page is refused and would only look like cleanup.
         They sit in the private bucket until an admin sweeps it. */
      logger.error('SubmitPaper.submit', err);
      setStage('fallback');
    } finally {
      setUploading(null);
    }
  }, [ready, files, form]);

  const missingHintId = 'submit-paper-missing-hint';
  const showMissingHint = !ready && stage === 'form';

  if (stage === 'done') {
    return (
      <div className="min-h-screen bg-background">
        <main id="main-content">
          <BentoStack>
            <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[26px]">
              {/* Success-moment delight (CRAFT §2: "delight sits at moments of
                  success"). animate-pop is the existing sticker/badge overshoot
                  keyframe; card-reveal is the existing settle-in for the
                  heading and body. motion-reduce drops the movement per
                  tailwind.config.ts's own convention, keeping the fade. */}
              <span className="flex h-12 w-12 animate-pop items-center justify-center rounded-full bg-brand-blue-subtle motion-reduce:animate-none">
                <CheckCircle2 className="h-6 w-6 text-brand-blue" aria-hidden="true" />
              </span>
              <h1 className="mt-3 animate-card-reveal font-display text-[30px] font-normal leading-[1.08] tracking-[-0.045em] text-foreground motion-reduce:animate-none">
                Got it. <span className="font-extrabold text-brand-blue">Thank you.</span>
              </h1>
              <p className="mt-3 max-w-prose animate-card-reveal text-[15px] leading-[1.6] text-warm-prose motion-reduce:animate-none">
                A person reads every submission before it goes up, so it will not appear straight
                away. We check the pages are legible, tag the school, board and year, and credit
                the school that set it. If something is unclear we will come back to you.
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Button asChild variant="indigo" size={46}>
                  <Link to="/past-papers">
                    Read the papers already here
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  variant="muted"
                  size={46}
                  onClick={() => { filesRef.current = []; setFiles([]); setStage('form'); }}
                >
                  Submit another
                </Button>
              </div>
            </BentoPanel>
          </BentoStack>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main id="main-content">
        <BentoStack>
          <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[26px]">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-brand-blue">
              Students helping students
            </span>
            <h1 className="mt-1.5 font-display text-[32px] font-normal leading-[1.06] tracking-[-0.045em] text-foreground lg:text-[44px]">
              Send us a paper you{' '}
              <span className="font-extrabold text-brand-blue">already sat</span>.
            </h1>
            <p className="mt-3 max-w-prose text-[15px] leading-[1.6] text-warm-prose">
              Every past paper on Shikshaq arrived this way, from someone who had finished with it
              and thought the next batch should not have to hunt for it. Photograph the pages or
              upload the PDF. It takes a minute.
            </p>
          </BentoPanel>

          {/* ---------------------------------------------------------- upload */}
          <BentoPanel fill="card" className="p-[22px]">
            <span className="mb-2 block text-[12px] font-bold uppercase tracking-[0.04em] text-warm-label">
              The paper
            </span>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              className="rounded-[18px] border-[1.5px] border-dashed border-warm-hairline bg-muted p-5 text-center"
            >
              <Upload className="mx-auto h-6 w-6 text-warm-label" aria-hidden="true" />
              <p className="mt-2 text-[15px] font-semibold text-foreground">
                Drop the pages here, or choose files
              </p>
              <p className="mt-1 text-[13px] text-warm-secondary">
                PDF or photos. Up to {MAX_FILES} files, 25MB each.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                /* The visible Choose files button is the one keyboard stop;
                   this input has no focus ring, so tabbing onto it highlighted
                   nothing. */
                tabIndex={-1}
                onChange={(e) => {
                  addFiles(e.target.files);
                  // Lets the same photo be picked again after it was removed.
                  e.target.value = '';
                }}
              />
              <Button
                variant="muted"
                size={44}
                className="mt-3"
                onClick={() => fileInput.current?.click()}
              >
                Choose files
              </Button>
            </div>

            {files.length > 0 && (
              <>
                <p className="mt-3 text-[12px] font-semibold tabular-nums text-warm-meta">
                  {files.length} of {MAX_FILES} files
                </p>
                <ul className="mt-1 grid gap-2">
                  {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-3 rounded-[14px] bg-muted px-3.5 py-2.5"
                  >
                    <FileText className="h-4 w-4 flex-none text-brand-blue" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{f.name}</span>
                    <span className="flex-none text-[12px] tabular-nums text-warm-meta">
                      {(f.size / 1048576).toFixed(1)}MB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                      className="tap-44 flex-none rounded-full p-1 text-warm-label hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                  ))}
                </ul>
              </>
            )}

            {error && (
              <p role="alert" className="mt-2 text-[13px] font-medium text-destructive">
                {error}
              </p>
            )}
          </BentoPanel>

          {/* -------------------------------------------------------- metadata */}
          <BentoPanel fill="card" className="p-[22px]">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="School the paper is from" required>
                  {(controlProps) => (
                    <FieldInput
                      {...controlProps}
                      name="school"
                      value={form.school}
                      placeholder="e.g. Birla High School"
                      onChange={(e) => set('school')(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <Field label="Board">
                {(controlProps) => (
                  <FieldSelect {...controlProps} name="board" value={form.board} onChange={(e) => set('board')(e.target.value)}>
                    <option value="">Not sure</option>
                    {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </FieldSelect>
                )}
              </Field>

              <Field label="Class">
                {(controlProps) => (
                  <FieldSelect {...controlProps} name="class" value={form.cls} onChange={(e) => set('cls')(e.target.value)}>
                    <option value="">Not sure</option>
                    {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </FieldSelect>
                )}
              </Field>

              <Field label="Subject" required>
                {(controlProps) => (
                  <FieldSelect {...controlProps} name="subject" value={form.subject} onChange={(e) => set('subject')(e.target.value)}>
                    <option value="">Choose a subject</option>
                    {SUBJECTS.map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                  </FieldSelect>
                )}
              </Field>

              <Field label="Exam">
                {(controlProps) => (
                  <FieldSelect {...controlProps} name="examType" value={form.examType} onChange={(e) => set('examType')(e.target.value)}>
                    <option value="">Not sure</option>
                    {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </FieldSelect>
                )}
              </Field>

              <Field label="Year (optional)">
                {(controlProps) => (
                  <FieldInput
                    {...controlProps}
                    name="year"
                    inputMode="numeric"
                    value={form.year}
                    placeholder="e.g. 2024-25"
                    onChange={(e) => set('year')(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Your name (optional)">
                {(controlProps) => (
                  <FieldInput
                    {...controlProps}
                    name="name"
                    value={form.name}
                    placeholder="So we can thank you"
                    onChange={(e) => set('name')(e.target.value)}
                  />
                )}
              </Field>

              <div className="sm:col-span-2">
                <Field label="Email or WhatsApp (optional)">
                  {(controlProps) => (
                    <FieldInput
                      {...controlProps}
                      name="contact"
                      value={form.contact}
                      placeholder="Only if you want us to come back to you"
                      onChange={(e) => set('contact')(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </div>

            <Button
              variant="indigo"
              size={52}
              disabled={!ready || stage === 'sending'}
              aria-describedby={showMissingHint ? missingHintId : undefined}
              onClick={submit}
              className="mt-5 w-full rounded-[16px]"
            >
              {stage === 'sending' ? (
                <>
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                  {uploadProgressLabel(uploading, files.length)}
                </>
              ) : (
                <>
                  <Upload className="h-[18px] w-[18px]" aria-hidden="true" />
                  Submit for review
                </>
              )}
            </Button>

            {showMissingHint && (
              <p id={missingHintId} className="mt-2 text-[13px] text-warm-secondary">
                Add the pages, the school and the subject to submit.
              </p>
            )}

            {stage === 'fallback' && (
              <div className="mt-3 rounded-[16px] bg-brand-subtle p-4">
                <p className="text-[14px] font-bold text-brand-deep">Upload could not go through</p>
                <p className="mt-1 text-[14px] leading-[1.55] text-brand-deep/85">
                  Nothing you typed is lost. Send it over WhatsApp instead and we will take it from
                  there, or try the upload again in a moment.
                </p>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2.5 inline-flex min-h-11 items-center gap-2 rounded-full bg-whatsapp px-4 text-[14px] font-bold text-whatsapp-text"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                  Send on WhatsApp
                </a>
              </div>
            )}
          </BentoPanel>

          <BentoPanel fill="card" className="p-[22px]">
            <h2 className="text-[17px] font-extrabold tracking-[-0.03em] text-foreground">
              What happens to it
            </h2>
            <ul className="mt-3 grid gap-3">
              {[
                {
                  icon: FileText,
                  head: 'A person reads it first',
                  body: 'Nothing goes up automatically. We check the pages are legible and tag the school, board, class and year so it is findable.',
                },
                {
                  icon: ShieldCheck,
                  head: 'The school keeps the copyright',
                  body: 'Every paper names the school that set it and stays free to read.',
                },
              ].map((row) => (
                <li key={row.head} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-blue-subtle">
                    <row.icon className="h-4 w-4 text-brand-blue" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold text-foreground">{row.head}</span>
                    <span className="mt-0.5 block text-[14px] leading-[1.55] text-warm-secondary">{row.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </BentoPanel>
        </BentoStack>
      </main>
    </div>
  );
}
