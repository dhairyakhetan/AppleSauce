import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { attachCopyGuard } from '@/lib/copy-guard';

/**
 * Copy protection for pages that are not the paper reader.
 *
 * The paper reader has PaperShareLock, which interrupts a copy with a share
 * dialog because on that page the reader almost certainly wanted to send
 * someone the paper. Everywhere else that framing does not fit -- nobody
 * copies a teacher's qualifications in order to share them -- so this is the
 * quieter form: the copy is cancelled and a one-line toast says why.
 *
 * Mount it once per page. Mark the text with `data-protected` and
 * `protectedClass`; see src/lib/copy-guard.ts for exactly what is and is not
 * preventable, and why none of it is an anti-scraping measure.
 */
export function ContentGuard({
  message = 'This text belongs to the teacher who wrote it, so it is not copyable. Share the page instead.',
}: {
  message?: string;
}) {
  /* One toast per page view. A held Ctrl+C fires the event repeatedly, and a
     stack of identical toasts turns a explanation into a scolding. */
  const spent = useRef(false);

  useEffect(() => attachCopyGuard({
    onBlocked: () => {
      if (spent.current) return;
      spent.current = true;
      toast(message, { duration: 5000 });
    },
    onPrint: () => {
      if (spent.current) return;
      spent.current = true;
      toast(message, { duration: 5000 });
    },
  }), [message]);

  return null;
}
