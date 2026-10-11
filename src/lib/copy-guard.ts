/**
 * Block clipboard copying of protected content.
 *
 * WHAT THIS DOES AND DOES NOT DO, stated plainly because the gap between the
 * ask and the web platform is where this kind of feature usually disappoints:
 *
 *   Select, copy, cut, right-click   BLOCKED on marked regions.
 *   Ctrl+P / Cmd+P, Ctrl+S           BLOCKED, and the print stylesheet blanks
 *                                    the protected text anyway.
 *   Drag-out of text                 BLOCKED.
 *   Screenshots                      NOT PREVENTABLE. No web API exists. The
 *                                    capture happens in the OS, below the
 *                                    browser, and the page is never told.
 *   View Source / devtools / JS off  NOT PREVENTABLE. Whatever the browser was
 *                                    sent is in the browser.
 *   A script calling the API         IRRELEVANT to this file. A scraper never
 *                                    opens a browser, so none of this code
 *                                    runs. That path is closed server-side, in
 *                                    the migrations under supabase/.
 *
 * So this is a deterrent against a person copying text by hand, which is a
 * real and common way data walks out. It is not, and cannot be, an
 * anti-scraping measure. The two get conflated constantly and it is worth
 * keeping them apart: the thing that actually protects the bank is that a
 * signed-out reader is SENT only two questions, so there is no third question
 * on the page to copy in the first place.
 *
 * SCOPED, not global. The handlers fire only when the selection (or the
 * right-clicked element) is inside a [data-protected] region. A page-wide
 * clipboard block also breaks copying out of a search box, a form field or a
 * teacher's own dashboard, which annoys real users and protects nothing.
 *
 * DELIBERATELY NOT BLOCKED: keyboard navigation and screen-reader access. The
 * text stays real text in the DOM rather than images or scrambled glyphs, so
 * assistive technology still reads it. Locking that out would cost a blind
 * student the paper in order to inconvenience someone who can still point a
 * phone at the screen.
 */

/** Marks a region as protected. Pair with `protectedClass` for the CSS half. */
export const PROTECTED_ATTR = 'data-protected';

/** Selection off, plus iOS's long-press "Copy / Look Up" callout suppressed. */
export const protectedClass = 'select-none [-webkit-touch-callout:none]';

function isProtectedNode(node: Node | null): boolean {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el) {
    if (el.hasAttribute?.(PROTECTED_ATTR)) return true;
    el = el.parentElement;
  }
  return false;
}

/** True when the current selection touches any protected region. */
export function selectionTouchesProtected(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  for (let i = 0; i < sel.rangeCount; i += 1) {
    const r = sel.getRangeAt(i);
    if (isProtectedNode(r.commonAncestorContainer)) return true;
    // A selection that starts outside and sweeps through (Ctrl+A, or a drag
    // from the heading down past the questions) has a common ancestor above
    // the protected region, so the endpoints have to be checked too.
    if (isProtectedNode(r.startContainer) || isProtectedNode(r.endContainer)) return true;
    const protectedRegions = document.querySelectorAll(`[${PROTECTED_ATTR}]`);
    for (const region of protectedRegions) {
      if (r.intersectsNode(region)) return true;
    }
  }
  return false;
}

export function eventTouchesProtected(e: Event): boolean {
  return isProtectedNode(e.target as Node) || selectionTouchesProtected();
}

export interface CopyGuardHandlers {
  /** Called when a copy/cut/right-click on protected content was blocked. */
  onBlocked: () => void;
  /** Called on Ctrl+P / Ctrl+S. */
  onPrint?: () => void;
  /** Called when a screenshot chord is seen. The capture already happened. */
  onCapture?: () => void;
}

/**
 * Attaches the listeners. Returns a cleanup function.
 *
 * Plain DOM rather than a React hook so it can be used from a component's
 * effect or from anywhere else without dragging in a render cycle.
 */
export function attachCopyGuard(h: CopyGuardHandlers): () => void {
  const onCopy = (e: Event) => {
    if (!eventTouchesProtected(e)) return;
    e.preventDefault();
    h.onBlocked();
  };

  const onContextMenu = (e: Event) => {
    if (!isProtectedNode(e.target as Node)) return;
    e.preventDefault();
    h.onBlocked();
  };

  // Dragging selected text out of the page is a clipboard path of its own.
  const onDragStart = (e: Event) => {
    if (!eventTouchesProtected(e)) return;
    e.preventDefault();
    h.onBlocked();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (meta && (key === 'p' || key === 's')) {
      // Unconditional: a print or save takes the whole document, so there is
      // no selection to test against.
      if (document.querySelector(`[${PROTECTED_ATTR}]`)) {
        e.preventDefault();
        h.onPrint?.();
      }
      return;
    }

    /* Screenshot chords. Watched, never prevented -- by the time this fires
       the capture has already succeeded. PrintScreen on Windows, Cmd+Shift+3/4/5
       on macOS. Noted so the share prompt can still appear, not because it
       stops anything. */
    if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key))) {
      h.onCapture?.();
    }
  };

  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('dragstart', onDragStart);
    document.removeEventListener('keydown', onKeyDown);
  };
}
