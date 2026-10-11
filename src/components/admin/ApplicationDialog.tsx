import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';
import { ImageOff } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { AdminStatusPill } from '@/pages/admin/AdminTable';
import { validateImageSrc } from '@/utils/imageSanitizer';
import { formatFeeRange } from '@/lib/fee-range';
import { APPLICATION_STATUS_LABEL, docsLabel } from '@/lib/teacher-review-api';
import { STATUS_TONE, TEXTED_OPTIONS, type TeacherApplication, type TextedStatus } from '@/lib/admin-applications';
import { cn } from '@/lib/utils';

/* One application, read in full. Everything that approving publishes is here
   (fees, areas, structure of classes, teaching since, featured subject,
   WhatsApp), so the decision is made on what parents will actually see.

   Waiting applications get Previous / Next and, after a decision, the page
   opens the next waiting one. The outreach control (Not texted / Texted /
   Follow up) is the admin's own note and changes nothing on the site. */

const NOT_SAID = 'Not said';

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    sonnerToast.success(`${what} copied`);
  } catch {
    sonnerToast.error(`Could not copy the ${what.toLowerCase()}. Select it and copy by hand.`);
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-warm-label">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] leading-[1.5] text-warm-prose">{children}</dd>
    </div>
  );
}

function Section({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={cn(wide && 'md:col-span-2')}>
      <h3 className="mb-2 text-[15px] font-bold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <button
      type="button"
      onClick={() => void copyText(text, what)}
      aria-label={`Copy ${what.toLowerCase()}`}
      className="relative ml-2 inline-flex min-h-10 items-center rounded-full bg-muted px-3 text-[12px] font-bold text-warm-secondary hover:bg-warm-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Copy
    </button>
  );
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export interface ApplicationDialogProps {
  app: TeacherApplication | null;
  /** Where this application sits in the list on screen. */
  position: { index: number; total: number } | null;
  prevId: string | null;
  nextId: string | null;
  reviewerName?: string;
  /** A decision is being written. */
  busy: boolean;
  /** The outreach state is being written. */
  outreachBusy: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onApprove: (app: TeacherApplication) => void;
  onReject: (app: TeacherApplication, reason: string) => void;
  onTexted: (app: TeacherApplication, status: TextedStatus) => void;
}

export function ApplicationDialog({ app, position, prevId, nextId, reviewerName, busy, outreachBusy, onClose, onOpen, onApprove, onReject, onTexted }: ApplicationDialogProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const rejectRef = useRef<HTMLTextAreaElement | null>(null);
  const appId = app?.id ?? null;

  // The reason box and a failed photo reset when Previous, Next or "the next
  // waiting one" moves to another person. The dialog itself stays mounted.
  useEffect(() => {
    setRejecting(false);
    setReason('');
    setImageFailed(false);
  }, [appId]);

  useEffect(() => {
    if (rejecting) rejectRef.current?.focus();
  }, [rejecting]);

  const pending = app?.status === 'pending';

  const footer = app ? (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className="flex w-full items-center gap-2 sm:mr-auto sm:w-auto">
        <AdminPillButton variant="secondary" size="sm" disabled={!prevId || busy} onClick={() => prevId && onOpen(prevId)}>
          Previous
        </AdminPillButton>
        <AdminPillButton variant="secondary" size="sm" disabled={!nextId || busy} onClick={() => nextId && onOpen(nextId)}>
          Next
        </AdminPillButton>
      </div>
      <div className="ml-auto flex items-center gap-2">
      {pending && rejecting ? (
        <>
          <AdminPillButton variant="quiet" size="sm" disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}>
            Cancel
          </AdminPillButton>
          <AdminPillButton variant="destructive" size="sm" busy={busy} disabled={!reason.trim()} onClick={() => onReject(app, reason.trim())}>
            Confirm rejection
          </AdminPillButton>
        </>
      ) : pending ? (
        <>
          <AdminPillButton variant="primary" size="sm" busy={busy} onClick={() => onApprove(app)}>
            Approve
          </AdminPillButton>
          <AdminPillButton variant="destructive" size="sm" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </AdminPillButton>
        </>
      ) : (
        <AdminPillButton variant="secondary" size="sm" onClick={onClose}>
          Close
        </AdminPillButton>
      )}
      </div>
    </div>
  ) : null;

  return (
    <AdminDialog
      open={app !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={app?.name ?? 'Application'}
      description={position && position.index >= 0 ? `${position.index + 1} of ${position.total} in this list` : undefined}
      size="xl"
      footer={footer}
    >
      {app ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 pt-1 md:grid-cols-2">
          {pending && rejecting ? (
            <section className="rounded-[18px] bg-destructive/10 p-4 md:col-span-2">
              <label htmlFor="reject-reason" className="text-[13px] font-bold text-foreground">
                Why is this application being rejected? The teacher can read this.
              </label>
              <Textarea
                id="reject-reason"
                ref={rejectRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Say why in a sentence or two"
                aria-required="true"
                className="mt-2 min-h-[88px] bg-card"
              />
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <AdminStatusPill status={STATUS_TONE[app.status]} label={APPLICATION_STATUS_LABEL[app.status]} />
            <span className="text-[13px] text-warm-secondary">Applied {new Date(app.created_at).toLocaleString()}</span>
          </div>

          <Section title="Contact">
            <dl className="space-y-3">
              <Field label="Phone">
                <a href={`tel:+91${app.phone_number}`} className="font-semibold text-brand-blue hover:underline">+91 {app.phone_number}</a>
                <CopyButton text={app.phone_number} what="Phone number" />
              </Field>
              <Field label="Email">
                <a href={`mailto:${app.email}`} className="break-all font-semibold text-brand-blue hover:underline">{app.email}</a>
                <CopyButton text={app.email} what="Email" />
              </Field>
              <Field label="WhatsApp">
                {app.whatsapp_link ? (
                  isHttp(app.whatsapp_link) ? (
                    <a href={app.whatsapp_link} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-brand-blue hover:underline">{app.whatsapp_link}</a>
                  ) : (
                    app.whatsapp_link
                  )
                ) : (
                  NOT_SAID
                )}
              </Field>
              <Field label="Sir or Ma'am">{app.sir_maam}</Field>
              <Field label="Reference">
                {app.reference_name ? `${app.reference_name}${app.reference_number ? `, +91 ${app.reference_number}` : ''}` : NOT_SAID}
              </Field>
            </dl>
          </Section>

          <Section title="What parents will see">
            <dl className="space-y-3">
              <Field label="Subjects">{app.subjects || NOT_SAID}</Field>
              <Field label="Featured subject">{app.featured_subject || NOT_SAID}</Field>
              <Field label="Classes">{app.classes_taught_for_backend || NOT_SAID}</Field>
              <Field label="Boards">{app.school_boards_catered || NOT_SAID}</Field>
              <Field label="Fees per month">{formatFeeRange(app.min_fees, app.max_fees)}</Field>
              <Field label="Structure of classes">{app.class_size || NOT_SAID}</Field>
              <Field label="Teaching since">{app.years_started_teaching || NOT_SAID}</Field>
              <Field label="Mode of teaching">{app.mode_of_teaching || NOT_SAID}</Field>
            </dl>
          </Section>

          <Section title="Where they teach" wide>
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Location option">{app.location_v2 || NOT_SAID}</Field>
              <Field label="Areas, student's home">{app.students_home_areas || NOT_SAID}</Field>
              <Field label="Areas, teacher's home">{app.tutors_home_areas || NOT_SAID}</Field>
            </dl>
          </Section>

          {app.description ? (
            <Section title="Description" wide>
              <p className="whitespace-pre-line text-[14px] leading-[1.55] text-warm-prose">{app.description}</p>
            </Section>
          ) : null}
          {app.qualifications_etc ? (
            <Section title="Qualifications" wide>
              <p className="whitespace-pre-line text-[14px] leading-[1.55] text-warm-prose">{app.qualifications_etc}</p>
            </Section>
          ) : null}

          <Section title="Profile photo" wide>
            {app.hero_image_url ? (
              imageFailed ? (
                <div className="flex h-48 w-full max-w-md flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-warm-label shadow-border">
                  <ImageOff className="h-6 w-6" aria-hidden />
                  <span className="text-[13px]">The photo could not be loaded</span>
                </div>
              ) : (
                <img
                  src={validateImageSrc(app.hero_image_url)}
                  alt={`${app.name}, as sent with the application`}
                  onError={() => setImageFailed(true)}
                  className="h-48 w-full max-w-md rounded-2xl object-cover shadow-border"
                />
              )
            ) : (
              <p className="text-[14px] text-warm-secondary">{docsLabel(app)}</p>
            )}
          </Section>

          <Section title="Outreach" wide>
            <p className="mb-2 text-[13px] text-warm-secondary">Your own note on whether you have messaged this teacher. Parents never see it.</p>
            <div role="group" aria-label="Outreach" className="flex flex-wrap gap-1.5">
              {TEXTED_OPTIONS.map((o) => {
                const on = app.texted_status === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={on}
                    disabled={outreachBusy}
                    onClick={() => { if (!on) onTexted(app, o.key); }}
                    className={cn(
                      'inline-flex min-h-10 items-center rounded-full px-3.5 text-[13px] transition-colors duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      on ? 'bg-panel font-bold text-background' : 'bg-muted font-semibold text-warm-secondary hover:bg-warm-hairline',
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {app.reviewed_at || app.rejection_reason ? (
            <Section title="Decision" wide>
              <div className="space-y-1 text-[14px] text-warm-prose">
                {app.reviewed_at ? (
                  <p>
                    {APPLICATION_STATUS_LABEL[app.status]} on {new Date(app.reviewed_at).toLocaleString()}
                    {app.reviewed_by ? ` by ${reviewerName || 'an admin'}` : ''}.
                  </p>
                ) : null}
                {app.rejection_reason ? <p><strong className="text-foreground">Reason given:</strong> {app.rejection_reason}</p> : null}
              </div>
            </Section>
          ) : null}
        </div>
      ) : null}
    </AdminDialog>
  );
}
