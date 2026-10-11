import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FieldTextarea } from '@/components/ui/field';
import { Blob, type BlobMood } from '@/components/ui/blob';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// F6 (changelog C-045). The mood picker is the Blob family (flat shapes, no
// emoji) instead of lucide face icons — one rating scale, still 1-5, still
// lands in `feedback.rating` exactly as before, so the write shape and the
// `feedback` table are untouched.
//
// Only three of the five blobs, though: code.md's mood-to-use map is binding
// — "rough = error states only · meh = empty-after-filters · fine/good/great
// = feedback sheet and tour" — and pages.md spells it out for this exact
// screen ("Sheet shows three blobs... not five — the five exist in the
// family, the sheet uses three"). Rough and meh are reserved for surfaces
// this component doesn't own.
const MOODS: { rating: number; mood: BlobMood; label: string; highlight?: boolean }[] = [
  { rating: 3, mood: 'fine', label: 'Fine' },
  { rating: 4, mood: 'good', label: 'Good' },
  { rating: 5, mood: 'great', label: 'Great', highlight: true },
];

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const { user } = useAuth();
  /* Starts unset. It used to default to 3 ("Fine"), which meant the Send button
     was enabled before anyone had chosen anything — so a person who typed a
     comment and pressed Send silently submitted a middling rating they never
     picked. micro-05-writing-confirming.png says "Picking a blob face enables
     Send", and the reason to follow it is stronger than fidelity: a default
     rating puts an opinion in the user's mouth and then reports it as theirs. */
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // "Auto-dismisses after 2.5s" (pages.md §20). Only while the sheet is open
  // and showing the thanks panel — closing manually or reopening clears it.
  useEffect(() => {
    if (!open || !sent) return;
    const timer = setTimeout(() => onOpenChange(false), 2500);
    return () => clearTimeout(timer);
  }, [open, sent, onOpenChange]);

  const reset = () => {
    // null, not 3. Closing and reopening previously re-armed a preselected 3/5
    // with the Send button already enabled, so an untouched form submitted a
    // rating nobody chose — the exact bug the comment above the initial state
    // warns about, reintroduced on the second open.
    setSelectedRating(null);
    setComment('');
    setGuestEmail('');
    setSent(false);
  };

  const handleSubmit = async () => {
    if (!selectedRating) {
      toast.error('Please select a rating');
      return;
    }

    setSubmitting(true);

    try {
      const feedbackData: {
        user_id: string | null;
        rating: number;
        comment: string | null;
        is_guest: boolean;
        guest_email?: string | null;
      } = {
        user_id: user?.id || null,
        rating: selectedRating,
        comment: comment.trim() || null,
        is_guest: !user,
        ...(user ? {} : { guest_email: guestEmail.trim() || null }),
      };

      const { error } = await supabase.from('feedback').insert([feedbackData]);

      if (error) {
        if (import.meta.env.DEV) {
          console.error('Error submitting feedback:', error);
        }
        toast.error('Failed to submit feedback. Please try again.');
        return;
      }

      setSent(true);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error submitting feedback:', error);
      }
      toast.error('Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="w-[calc(100vw-2rem)] overflow-hidden rounded-[28px] p-0 sm:max-w-md"
      >
        {sent ? (
          // F6c — sent
          <div className="flex flex-col items-center bg-brand p-[30px] text-center text-brand-foreground">
            <DialogHeader className="sr-only">
              <DialogTitle>Feedback sent</DialogTitle>
            </DialogHeader>
            <Blob mood="great" size={104} label="A happy face" className="mb-[26px]" />
            <h2 className="mb-[10px] font-display text-[30px] font-black leading-[1.02] tracking-[-0.04em] sm:text-[34px] text-balance">
              Got it, thank you.
            </h2>
            <p className="mb-[26px] max-w-[30ch] text-[15px] leading-[1.55] text-brand-foreground/90 sm:text-[16px]">
              Sourav or Ankit will read this today. If it is something we can fix quickly, we
              usually do.
            </p>
            <Button
              variant="dark"
              size={52}
              className="!bg-card !text-foreground"
              onClick={() => onOpenChange(false)}
            >
              Back to looking
              <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          // F6b — picking a face
          <div className="p-5 sm:p-6">
            <DialogHeader className="items-start text-left">
              <DialogTitle className="font-display text-[27px] font-black leading-[1.05] tracking-[-0.04em] text-foreground text-balance">
                How was that?
              </DialogTitle>
            </DialogHeader>
            <p className="mb-5 text-[15px] leading-[1.55] text-warm-prose">
              Goes straight to the two people who run this. No ticket number, no bot.
            </p>

            <div role="radiogroup" aria-label="How was that?" className="mb-[18px] flex gap-[10px]">
              {MOODS.map(({ rating, mood, label, highlight }) => {
                const isSelected = selectedRating === rating;
                return (
                  <button
                    key={rating}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedRating(rating)}
                    /* "Others drop to 45%" once a face is chosen, so the sheet
                       keeps showing what you said while you type the comment.
                       Before a choice they all sit at full strength — nothing is
                       being de-emphasised yet. */
                    className={`flex min-h-11 flex-1 flex-col items-center gap-[10px] rounded-[20px] px-2 py-[16px] pb-[13px] transition-[background-color,opacity] duration-150 active:scale-[0.97] ${
                      isSelected
                        ? highlight
                          ? 'bg-brand-subtle ring-2 ring-brand'
                          : 'bg-card shadow-border ring-2 ring-brand'
                        : selectedRating !== null
                          ? 'bg-card opacity-45 shadow-border'
                          : 'bg-card shadow-border'
                    }`}
                  >
                    <Blob mood={mood} size={64} label={label} />
                    <span
                      className={`text-[14px] font-extrabold ${
                        isSelected ? (highlight ? 'text-brand-deep' : 'text-foreground') : 'text-warm-prose'
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            {!user && (
              <div className="mb-[14px]">
                <label
                  htmlFor="feedback-guest-email"
                  className="mb-[7px] block text-[12px] font-bold uppercase tracking-[0.07em] text-warm-label"
                >
                  Email (optional)
                </label>
                <input
                  id="feedback-guest-email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  className="h-14 w-full rounded-[16px] bg-card px-4 text-base text-foreground shadow-border outline-none transition-shadow duration-150 placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            )}

            <label
              htmlFor="feedback-comment"
              className="mb-[7px] block text-[12px] font-bold uppercase tracking-[0.07em] text-warm-label"
            >
              Anything you want to add?
            </label>
            <FieldTextarea
              id="feedback-comment"
              placeholder="Optional. Filters were fine, but I could not tell which teachers travel to my area…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mb-[14px]"
            />

            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedRating}
              variant="primary"
              size={52}
              className="mb-[10px] w-full"
            >
              {submitting ? 'Sending…' : 'Send it'}
              {!submitting && <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />}
            </Button>
            <p className="text-[12px] leading-[1.5] text-warm-label">
              We read every one. If you left a number we might reply on WhatsApp.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
