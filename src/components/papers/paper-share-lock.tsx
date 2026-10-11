import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Link2, Share2 } from 'lucide-react';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { attachCopyGuard, protectedClass, PROTECTED_ATTR } from '@/lib/copy-guard';

/* Copying a paper is redirected into sharing it.
 *
 * WHAT THIS ACTUALLY DOES, precisely, because the gap between the ask and the
 * web platform matters here:
 *
 *   Copy / cut / right-click   PREVENTED. The clipboard write is cancelled and
 *                              this panel opens instead.
 *   Text selection             PREVENTED (CSS, applied to the question list
 *                              only -- see paperLockClass).
 *   Print / save as PDF        PREVENTED. The questions are blanked in the
 *                              print stylesheet, so Ctrl+P yields a page with
 *                              the paper's title and nothing to read.
 *   Screenshots                *** NOT PREVENTABLE ***. No web API can block a
 *                              screenshot -- it happens in the OS, below the
 *                              browser, and a page is never told. PrintScreen
 *                              and the macOS Cmd+Shift+3/4/5 chords are watched
 *                              only so the share prompt still appears; by the
 *                              time it does, the capture already succeeded.
 *                              A phone camera pointed at the screen defeats
 *                              every line of this file, and always will.
 *
 * So this is a deterrent for readers, and it is honest about being one. The
 * thing that actually protects the bank is the server-side gate: anon SELECT on
 * bank_questions is revoked and the RPC hands a signed-out visitor five
 * questions, so there is no sixth question on the page to copy, print or
 * photograph in the first place.
 *
 * Deliberately NOT blocked: keyboard selection for assistive tech, and the
 * five free questions remain real text in the DOM rather than images, so a
 * screen reader still reads them. Locking those out would cost a blind reader
 * the paper to inconvenience someone who can still hold up a camera.
 */

/** Applied to the question list. Selection off, and the long-press "copy"
    callout suppressed on iOS. Not applied page-wide: the paper's title, school
    and the sign-in prompt stay selectable, because nothing is gained by making
    a heading un-copyable and a reader may legitimately want to paste the
    paper's name to a friend. */
/* Kept as a re-export so BankPaper's existing usage is untouched. The
    definition now lives in lib/copy-guard beside the handlers that depend on
    it, so the CSS half and the JS half cannot drift apart. */
export const paperLockClass = protectedClass;

type Trigger = 'copy' | 'print' | 'capture';

const COPY: Record<Trigger, { title: string; body: string }> = {
  copy: {
    title: 'Share it instead',
    body: 'These questions belong to the school that set them, so they are not ours to hand out as copied text. Send the paper instead. Whoever opens the link gets the whole thing, properly credited.',
  },
  print: {
    title: 'Share it instead',
    body: 'Printing is off on this paper. Send the link instead and it opens for them the same way it opened for you, on any device.',
  },
  capture: {
    title: 'Rather send the paper?',
    body: 'A screenshot is one blurry question. The link is the whole paper, searchable, on their phone.',
  },
};

export function PaperShareLock({ paperTitle }: { paperTitle?: string }) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [copied, setCopied] = useState(false);
  /* One prompt per page view. Firing it on every keystroke of a held Ctrl+C, or
     on each of the three events a single print can raise, turns a nudge into a
     pest. */
  const spent = useRef<Set<Trigger>>(new Set());

  const raise = useCallback((t: Trigger) => {
    if (spent.current.has(t)) return;
    spent.current.add(t);
    setTrigger(t);
  }, []);

  /* The listeners live in lib/copy-guard so the teacher pages can use exactly
     the same rules. Two behaviour changes came with the move, both fixes:

     Copy is now SCOPED to the protected region instead of cancelling every
     copy on the page. This file's own header claimed the paper's title stayed
     selectable, and it did not -- the old document-wide handler also swallowed
     copy and cut inside the paper's search box and the report form's textarea,
     which protects nothing and is just a page that feels broken.

     Ctrl+A followed by Ctrl+C is caught. A sweep that starts above the
     question list has its common ancestor outside it, so checking only that
     node missed the one shortcut most likely to be used. */
  useEffect(() => attachCopyGuard({
    onBlocked: () => raise('copy'),
    onPrint: () => raise('print'),
    onCapture: () => raise('capture'),
  }), [raise]);

  useEffect(() => {
    const onBeforePrint = () => raise('print');
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, [raise]);

  const url = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = paperTitle ? `${paperTitle} on Shikshaq` : 'This past paper on Shikshaq';

  /* The one copy this component allows, and the reason it exists: the reader
     wanted to take something away, so it hands them the shareable thing. */
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable. The link is on screen and
      // selectable below, so there is still a way to take it.
    }
  };

  const nativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: shareText, url });
    } catch {
      // Cancelled by the user, or dismissed. Nothing to recover.
    }
  };

  const t = trigger ? COPY[trigger] : null;

  return (
    <Dialog open={trigger !== null} onOpenChange={(next) => { if (!next) setTrigger(null); }}>
      <DialogContent
        aria-describedby="paper-share-lock-body"
        className="w-[calc(100vw-2rem)] overflow-hidden rounded-[28px] p-5 sm:max-w-md sm:p-6"
      >
        <DialogHeader className="items-start text-left">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-blue-subtle">
            <Share2 size={20} strokeWidth={2.2} className="text-brand-blue-deep" aria-hidden="true" />
          </div>
          <DialogTitle className="font-display text-[23px] font-black leading-[1.1] tracking-[-0.035em] text-foreground">
            {t?.title ?? 'Share it instead'}
          </DialogTitle>
        </DialogHeader>
        <p id="paper-share-lock-body" className="mb-4 text-[15px] leading-[1.6] text-warm-prose">
          {t?.body}
        </p>

        {/* The link, shown as text and selectable, so the offer is real even if
            the clipboard API is blocked. */}
        <p className="mb-4 select-all break-all rounded-[14px] bg-muted px-3 py-2 text-[13px] leading-[1.5] text-warm-meta">
          {url}
        </p>

        <div className="flex flex-col gap-2">
          <Button onClick={copyLink} variant="primary" size={52} className="w-full">
            {copied ? (
              <>
                <Check size={17} strokeWidth={2.4} aria-hidden="true" />
                Link copied
              </>
            ) : (
              <>
                <Link2 size={17} strokeWidth={2.4} aria-hidden="true" />
                Copy the link
              </>
            )}
          </Button>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setTrigger(null)}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-whatsapp text-[15px] font-bold text-whatsapp-text transition-transform duration-tap hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <WhatsAppIcon className="h-[18px] w-[18px]" />
            Send on WhatsApp
          </a>

          {/* navigator.share is mobile-mostly; offered only where it exists
              rather than rendering a button that silently does nothing. */}
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button onClick={nativeShare} variant="muted" size={44} className="w-full">
              More ways to share
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PaperShareLock;
