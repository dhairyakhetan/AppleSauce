import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetGrabHandle, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* R3 — Redesign Reviews.dc.html "Leaving one", restyled to Handoff O-006.
   Wraps the same submit logic TeacherComments already has (teacher_comments
   insert, anonymous → pending approval). copy.md §12's privacy line is
   reproduced verbatim.

   O-006 says "no star rating, no numeric score — teacher_comments has no
   rating column." That premise is out of date: teacher_comments.rating is a
   real column this sheet already writes to (confirmed with the owner in an
   earlier phase of this same redesign, when the identical claim surfaced
   for TeacherComments.tsx's display side — "Keep ratings, apply the rest").
   The star row stays; everything else in O-006 (chrome, textarea sizing,
   the new confirmation row, button) is applied.

   O-006 also describes an optional free-text "name" field defaulting to
   Anonymous. This app's reviews are tied to the signed-in account — there
   is no free-text name column, `is_anonymous` is a boolean that toggles
   whether the account's real name displays, and the submit handler (not
   touched here) only ever inserts that boolean. The existing "Post as
   anonymous" checkbox is the real equivalent and stays as-is instead.

   The confirmation row IS new: "I actually took classes with this teacher"
   gates the submit button client-side only — it writes nothing new, so it
   doesn't touch the protected submit handler, just adds an honesty
   precondition before calling it. */

const RATING_WORDS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very good",
  5: "Excellent",
};

const PRIVACY_LINE =
  "Your first name and class show; your number never does. Reviews cannot be edited by the teacher, and we do not delete honest ones.";

export interface WriteReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: (comment: string, isAnonymous: boolean, rating: number | null) => Promise<void> | void;
}

export function WriteReviewSheet({ open, onOpenChange, submitting, error, onSubmit }: WriteReviewSheetProps) {
  const [comment, setComment] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || !confirmed) return;
    await onSubmit(comment.trim(), isAnonymous, rating || null);
    setComment("");
    setIsAnonymous(false);
    setRating(0);
    setHovered(0);
    setConfirmed(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto border-0 px-5 pb-[26px]">
        <SheetGrabHandle />
        {/* SheetTitle labels the dialog for assistive tech (Radix requires
            one); visually it IS the heading O-006 specifies. */}
        <SheetTitle className="font-display text-[21px] font-black tracking-[-0.035em] text-foreground">
          How were the classes?
        </SheetTitle>
        <SheetDescription className="mt-1.5 text-[14px] leading-[1.55] text-warm-prose">
          Only students who have actually taken classes with this teacher may review.
        </SheetDescription>

        <form onSubmit={handleSubmit} className="mt-[18px] flex flex-col gap-[14px]">
          {/* R3's rating row. Optional by design, so it carries no required
              marker and no validation — the submit button is gated on words,
              not stars.

              micro-05: tapping the third star fills one through three, and
              tapping the star that is already the current value clears back
              one, which is how a mis-tap gets undone without a separate
              "clear" link. Hover previews on pointer devices only; on touch,
              `hovered` never fires, so what is filled is what was chosen. */}
          <fieldset className="flex flex-col gap-2" disabled={submitting}>
            <legend className="text-[13px] font-bold text-foreground">
              Rating <span className="font-medium text-warm-meta">(optional)</span>
            </legend>
            <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
              {[1, 2, 3, 4, 5].map((value) => {
                const filled = value <= (hovered || rating);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(rating === value ? value - 1 : value)}
                    onMouseEnter={() => setHovered(value)}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    aria-pressed={value <= rating}
                    className="flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none"
                  >
                    <Star
                      className={cn(
                        "h-[26px] w-[26px] transition-colors duration-150",
                        filled ? "fill-brand text-brand" : "fill-transparent text-border",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
              {/* The word carries the meaning for anyone who cannot see which
                  stars are filled. Reserved height, so choosing a rating does
                  not shove the textarea down the sheet. */}
              <span className="ml-1 min-h-[18px] text-[13px] font-semibold text-warm-meta" aria-live="polite">
                {rating ? RATING_WORDS[rating] : ""}
              </span>
            </div>
          </fieldset>

          <div>
            <label htmlFor="write-review-comment" className="mb-1 block text-[12px] font-bold uppercase tracking-[0.07em] text-warm-label">
              Review
            </label>
            <Textarea
              id="write-review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your thoughts about this teacher..."
              className="min-h-[132px] resize-none rounded-2xl bg-muted px-4 py-[14px] text-base leading-[1.6]"
              disabled={submitting}
            />
          </div>

          <div>
            {/* "Your name (optional)" per O-006 is a free-text field this
                app's account-tied review model doesn't have (see file header
                comment) — the real equivalent is this anonymous toggle. */}
            <label htmlFor="write-review-anonymous" className="mb-1 block text-[12px] font-bold uppercase tracking-[0.07em] text-warm-label">
              Your name <span className="font-medium normal-case tracking-normal text-warm-meta">(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="write-review-anonymous"
                checked={isAnonymous}
                onCheckedChange={(checked) => setIsAnonymous(checked === true)}
                disabled={submitting}
              />
              <label htmlFor="write-review-anonymous" className="cursor-pointer text-sm font-medium text-foreground">
                Post as anonymous
              </label>
            </div>
          </div>

          <p className="rounded-2xl bg-muted p-4 text-[12px] leading-[1.5] text-warm-meta">{PRIVACY_LINE}</p>

          {/* Handoff O-006: confirmation row — client-side gate only, writes
              nothing new, the submit handler stays untouched. */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="write-review-confirm"
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              disabled={submitting}
              className="mt-0.5 h-5 w-5 rounded-[6px]"
            />
            <label htmlFor="write-review-confirm" className="cursor-pointer text-sm leading-relaxed text-foreground">
              I actually took classes with this teacher
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            variant="primary"
            size={54}
            className="rounded-full text-[16px] font-extrabold"
            disabled={!comment.trim() || !confirmed || submitting}
            busy={submitting}
          >
            Post review
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default WriteReviewSheet;
