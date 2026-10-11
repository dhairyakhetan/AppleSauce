import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';
import { claimFirstVisitPopup } from '@/lib/first-visit-popup';

/* Owner ask: a one-time popup, shown the first time a visitor opens ANY
   paper page (BankPaper.tsx's ~193 bank papers and PaperReader.tsx's regular
   Supabase papers both render this same component), stating the same facts
   as DisclaimerStrip below the reader header — school ownership, no
   ownership claimed by Shikshaq, contributed by students, exam-prep only —
   in fuller, more explicit language than that strip's single line.

   One shared localStorage key, not one per reader type: the owner's ask was
   "whenever I open a papers page for the first time", not "the first time
   in each reader" — a visitor who has already dismissed this on a bank
   paper should not see it again on a regular paper. */
const SEEN_KEY = 'shikshaq.paperDisclaimerSeen';

function hasSeenDisclaimer(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'true';
  } catch {
    return true; // localStorage unavailable (private mode, etc.) -- fail open, never block reading
  }
}

function markDisclaimerSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'true');
  } catch {
    // ignore -- worst case it shows again next visit
  }
}

export function PaperDisclaimerDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    /* Wins the slot on a paper page (the tour waits a beat), so the notice is
       the one thing a first-time reader meets here. */
    if (!hasSeenDisclaimer() && claimFirstVisitPopup()) setOpen(true);
  }, []);

  const dismiss = () => {
    markDisclaimerSeen();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        aria-describedby="paper-disclaimer-body"
        className="w-[calc(100vw-2rem)] overflow-hidden rounded-[28px] p-5 sm:max-w-md sm:p-6"
      >
        <DialogHeader className="items-start text-left">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <Info size={20} strokeWidth={2.2} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <DialogTitle className="font-display text-[23px] font-black leading-[1.1] tracking-[-0.035em] text-foreground">
            Before you open this paper
          </DialogTitle>
        </DialogHeader>
        <p id="paper-disclaimer-body" className="mb-5 text-[15px] leading-[1.6] text-warm-prose">
          Every paper on Shikshaq is the property of the school that set it. Shikshaq claims no
          ownership over any paper, and these were all contributed by students. They are shared
          here solely to assist with exam preparation.
        </p>
        <Button onClick={dismiss} variant="primary" size={52} className="w-full">
          Understood
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export default PaperDisclaimerDialog;
