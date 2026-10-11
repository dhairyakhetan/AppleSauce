import { ChevronDown } from 'lucide-react';
import { addVerifierSteps, NO_ACCOUNT_EXPLAINED } from '@/lib/checker-onboarding';

/* A short, collapsed-by-default guide on /admin/checkers: how to get a
   person started as a verifier. Plain words, three steps, and what the
   "no account with that email" error means. The words live in
   src/lib/checker-onboarding.ts. */

export function AddStudentGuide() {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <details className="group mx-[18px] mb-4 rounded-2xl bg-muted" data-testid="add-student-guide">
      <summary className="tap-44 flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-[14px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
        How to add a verifier
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-3">
        <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-snug text-foreground">
          {addVerifierSteps(origin).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-pretty text-[13px] leading-snug text-warm-secondary">{NO_ACCOUNT_EXPLAINED}</p>
      </div>
    </details>
  );
}
