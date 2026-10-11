import { useState } from 'react';
import { GraduationCap, FileText, Users, ShieldAlert, ArrowRight } from 'lucide-react';
import { useChromeConfig } from '@/components/layout/AppShell';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { AnnotatedStatement, AnnotatedHighlight } from '@/components/marketing/annotated-statement';
import { NumberedHeading } from '@/components/ui/numbered-heading';
import { Field, FieldInput, FieldTextarea, useBlurValidation } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { usePageMeta } from '@/hooks/usePageMeta';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { toast } from 'sonner';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';

// S22 — new route. Same annotation device as About (C-058) so the two pages
// read as a pair (changelog C-059): a statement + rising dome, tilted pills,
// an orange band with the direct contact details, then a reason-first form.
//
// There is no backend "contact" table in this codebase (checked: only
// teacher_recommendations exists), so "send it" composes a mailto: to
// ngo.aquaterra@gmail.com with the reason pre-filled in the subject line, per the
// changelog note ("reason chip pre-fills the subject line") — it does not
// silently do nothing, and it does not invent a fake success state that isn't
// backed by a real send.
//
// DO NOT change this address to hello@shikshaq.in, hello@shikshaq.com,
// join.shikshaq@gmail.com, or support@shikshaq.com. Every one of those
// appeared somewhere in this codebase at some point (including in this exact
// file) and got consolidated here on the OWNER'S EXPLICIT confirmation mid-
// session: "ngo.aquaterra@gmail.com is the real email ID." The design
// handoff's contact-01-mobile.png export shows hello@shikshaq.in — that PNG
// predates the correction and is wrong for this one specific fact. A design
// export is not authoritative over the person who owns the inbox.
const REASONS = [
  { id: 'teacher', label: 'Finding a teacher', icon: GraduationCap },
  { id: 'paper', label: 'A paper', icon: FileText },
  { id: 'list', label: 'I teach, list me', icon: Users },
  { id: 'wrong', label: 'Something is wrong', icon: ShieldAlert },
] as const;

type ReasonId = (typeof REASONS)[number]['id'];

export default function Contact() {
  // Handoff CT-001: this route renders its own eyes panel, replacing
  // AppShell's default pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  usePageMeta(
    'Contact Shikshaq | Talk to a real person',
    // Was 178 chars, truncated in the SERP snippet. 149 now.
    'Reach the two people who run Shikshaq directly for teacher search, past papers, or listing yourself. A real person replies, usually the same day.'
  );

  // Handoff CT-003: one topic is always selected (defaults to the first) —
  // the form used to stay hidden until a reason was picked.
  const [reason, setReason] = useState<ReasonId>(REASONS[0].id);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const nameField = useBlurValidation(name, (v) => (v.trim() ? undefined : 'Tell us your name'));
  const contactField = useBlurValidation(contact, (v) =>
    v.trim() ? undefined : 'A WhatsApp number or email so we can reply'
  );
  const messageField = useBlurValidation(message, (v) => (v.trim() ? undefined : 'What do you need?'));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    nameField.onBlur();
    contactField.onBlur();
    messageField.onBlur();
    if (!nameField.isValid || !contactField.isValid || !messageField.isValid) return;

    const reasonLabel = REASONS.find((r) => r.id === reason)?.label ?? 'General';
    const subject = encodeURIComponent(`Shikshaq - ${reasonLabel}`);
    const body = encodeURIComponent(
      `Name: ${name}\nReach me on: ${contact}\n\n${message}`
    );
    window.location.href = `mailto:ngo.aquaterra@gmail.com?subject=${subject}&body=${body}`;
    setSent(true);
    toast('Opening your email app');
  };

  const statement = (
    <>
      <span className="block">Tell us what</span>{' '}
      <span className="block">you need. <AnnotatedHighlight tone="block-dark">We reply.</AnnotatedHighlight></span>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff CT-002: the annotated statement, now inside a bone header panel. */}
          <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[26px]">
            <AnnotatedStatement
              statement={statement}
              align="left"
              statementClassName="text-[36px] leading-[1.05] tracking-[-0.05em]"
              className="mt-5"
              pills={[
                { label: 'a real person replies', anchor: 'bottom-left', tone: 'brand', tilt: -9, dot: false },
                { label: 'same day, usually', anchor: 'bottom-right', tone: 'bone', tilt: 7, dot: false },
              ]}
            />
          </BentoPanel>

          {/* Handoff CT-003: topic picker — the reason a message arrives now
              travels with it (as the mailto subject line), so a takedown
              request and a tutoring question no longer look identical. */}
          <BentoPanel fill="card" className="p-[22px]">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-warm-label">
              What is it about
            </span>
            {/* Same "flex-col stack never got a desktop treatment" gap as
                Index.tsx's board pills: at 1280px each button stretched to
                the full ~680px panel width with nothing to constrain it. */}
            <div className="mt-3 flex flex-col gap-2 lg:grid lg:grid-cols-2">
              {REASONS.map((r) => {
                const on = reason === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setReason(r.id)}
                    aria-pressed={on}
                    className={`flex h-[52px] items-center gap-2.5 rounded-[18px] px-4 text-[15px] transition-colors duration-tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      on ? 'bg-panel font-bold text-background' : 'bg-muted font-semibold text-foreground'
                    }`}
                  >
                    <r.icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                    {r.label}
                  </button>
                );
              })}
            </div>
          </BentoPanel>

          {/* Handoff CT-004: the form itself — same four fields, same handler. */}
          <BentoPanel fill="card" className="p-[22px]">
            <NumberedHeading
              line1="Send us a note"
              ordinal="01"
              line2="four fields, no login"
              size="compact"
            />

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-[14px]">
              <div className="grid gap-[14px] sm:grid-cols-2">
                <Field label="Your name" error={nameField.error} required>
                  {(cp) => (
                    <FieldInput
                      {...cp}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={nameField.onBlur}
                      placeholder="Priya Sharma"
                    />
                  )}
                </Field>
                <Field label="WhatsApp number or email" error={contactField.error} required>
                  {(cp) => (
                    <FieldInput
                      {...cp}
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      onBlur={contactField.onBlur}
                      placeholder="+91 …"
                    />
                  )}
                </Field>
              </div>

              <Field label="What do you need?" error={messageField.error} required>
                {(cp) => (
                  <FieldTextarea
                    {...cp}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onBlur={messageField.onBlur}
                    placeholder="Class 10 ICSE Maths, somewhere near Ballygunge, evenings after 6…"
                  />
                )}
              </Field>

              <Button type="submit" variant="primary" size={52}>
                Open my email app
                <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
              </Button>
              <span className="text-[13px] leading-[1.55] text-warm-label">
                This opens an email to the two people who run Shikshaq. No newsletter, and we never
                pass your number to a teacher without asking.
              </span>
              {sent ? (
                <p role="status" className="text-body-secondary text-brand-deep">
                  Opening your email app. Nothing is sent until you press send there. If nothing
                  opens, write to ngo.aquaterra@gmail.com or WhatsApp us below.
                </p>
              ) : null}
            </form>
          </BentoPanel>

          {/* Handoff CT-005: the real published WhatsApp number, or nothing. */}
          <BentoPanel fill="mint" className="px-[22px] py-[18px]">
            <a
              href={getWhatsAppLink('8240980312')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-whatsapp">
                <WhatsAppIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-bold text-[#24603D]">or just WhatsApp</p>
                <p className="mt-0.5 text-[14px] text-[#3E6F53]">+91 82409 80312</p>
              </div>
            </a>
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
