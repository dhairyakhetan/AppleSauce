/* One automatic first-visit pop-up per visit.

   A new reader arriving on a paper used to meet three overlays in a row: the
   product tour, the "papers are live" announcement and the copyright notice.
   Each has its own "seen" flag, so each is shown at most once ever, but nothing
   stopped them stacking on the same first visit.

   Whichever pop-up asks first this visit gets the slot; the others are simply
   not shown, and because their own "seen" flag is still unset they appear on a
   later visit, one at a time. A tap on the logo (the tour's manual trigger) is
   not an automatic pop-up and does not use the slot.

   "Visit" is the browser tab session (sessionStorage), with a module flag as
   the fallback where storage is blocked. */

const KEY = 'shikshaq.firstVisitPopup';
let claimedInMemory = false;

export function claimFirstVisitPopup(): boolean {
  if (claimedInMemory) return false;
  try {
    if (sessionStorage.getItem(KEY) === '1') {
      claimedInMemory = true;
      return false;
    }
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: the module flag alone still limits a page load to one */
  }
  claimedInMemory = true;
  return true;
}

/** Test seam. */
export function resetFirstVisitPopup(): void {
  claimedInMemory = false;
  try { sessionStorage.removeItem(KEY); } catch { /* ok */ }
}
