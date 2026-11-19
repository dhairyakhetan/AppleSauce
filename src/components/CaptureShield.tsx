import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hide protected text the moment a capture looks likely.
 *
 * READ THIS BEFORE TRUSTING IT.
 *
 * A web page CANNOT block a screenshot. Not on desktop, not on mobile, not in
 * any browser. The capture is performed by the operating system, below the
 * browser, and the page is not asked for permission and often not even told.
 * Android's FLAG_SECURE and iOS's screenshot notification are native-app APIs;
 * a website has neither. iOS Safari in particular gives a page no signal at
 * all when the side-button chord fires.
 *
 * So this is not a block. It is three things that genuinely work, and it is
 * worth knowing which is which:
 *
 *   1. REACT TO THE CHORDS WE CAN SEE (desktop). PrintScreen on Windows and
 *      Cmd+Shift+3/4/5 on macOS reach the page as key events. The shield goes
 *      up immediately. On Windows PrintScreen the keydown arrives BEFORE the
 *      capture is composited often enough to be worth doing, so this sometimes
 *      lands in the image. Sometimes. Not reliably.
 *
 *   2. OVERWRITE THE CLIPBOARD (Windows PrintScreen only). Bare PrintScreen
 *      puts the screen on the clipboard rather than in a file. Writing over it
 *      immediately is a real mitigation for that one path -- the image is gone
 *      before it can be pasted. Best-effort: it needs clipboard permission,
 *      and a keydown does not always count as the user gesture browsers want.
 *
 *   3. HIDE ON FOCUS LOSS. Snipping Tool, Win+Shift+S, macOS Cmd+Shift+5 and
 *      every screen-sharing tool take focus from the page first. Protected
 *      text hides for AS LONG AS the page is away and comes back the instant
 *      it returns, so a capture composed after that point gets the shield
 *      instead of the questions however long it takes to compose. This is the
 *      most effective of the three and the only one that covers the tools that
 *      never send a key event at all.
 *
 * What none of it touches: a phone camera pointed at the monitor, a second
 * device, a VM, or a browser with JavaScript disabled. Those always work and
 * always will. The thing that actually limits the damage is that a signed-out
 * reader is SENT two questions, so there is nothing else on the page to
 * photograph.
 *
 * Mobile: (3) fires when the tab is backgrounded, which a screenshot does NOT
 * do on iOS or Android. So on a phone this is close to no protection, and
 * pretending otherwise would be the kind of claim that gets believed until it
 * matters. Genuinely blocking mobile screenshots requires a native app.
 */

/* How long the shield stays up after a CAPTURE CHORD. It does not govern focus
   loss any more -- that is held for the duration of the absence, because a
   timer there was expiring while the page was still out of sight. */
const SHIELD_MS = 2200;

export function CaptureShield({
  label = 'Screenshots of this page are not permitted. Share the link instead.',
}: {
  label?: string;
}) {
  const [shielded, setShielded] = useState(false);
  const timer = useRef<number | null>(null);
  /* True while the page is unfocused or hidden. The shield is then held open
     rather than timed, so the timer must not take it down underneath us. */
  const away = useRef(false);

  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  /* For the key chords, where the page KEEPS focus and so the reader is
     watching: up now, down shortly after. */
  const raiseBriefly = useCallback(() => {
    setShielded(true);
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (!away.current) setShielded(false);
    }, SHIELD_MS);
  }, []);

  /* For focus loss, where the reader CANNOT SEE THE PAGE, which changes the
     whole calculation. This used to raise on a 2,200ms timer like the chords,
     which was wrong in both directions at once: a Win+Shift+S selection or a
     screen-share that ran longer than 2.2s got the questions back while the
     page was still not in front of anyone, and a reader who simply alt-tabbed
     to check something returned to a blanked page and had to wait out the
     remainder of a timer that was never counting anything meaningful.

     The noted fix for this was "a short grace period before blanking". That
     would have been the wrong end: nobody is looking at the page during the
     grace period either, so it only gives the capture tools a window. Holding
     for exactly as long as the page is away, and dropping the instant it
     returns, is both more protective and the thing the reader actually
     noticed. */
  const holdWhileAway = useCallback(() => {
    away.current = true;
    clearTimer();
    setShielded(true);
  }, []);

  const releaseOnReturn = useCallback(() => {
    away.current = false;
    clearTimer();
    setShielded(false);
  }, []);

  /* Toggled on <html> rather than passed down, so any [data-protected] region
     anywhere on the page responds without threading state through it. The CSS
     is in index.css next to the print rules. */
  useEffect(() => {
    const root = document.documentElement;
    if (shielded) root.setAttribute('data-capture-shield', '');
    else root.removeAttribute('data-capture-shield');
    return () => root.removeAttribute('data-capture-shield');
  }, [shielded]);

  useEffect(() => {
    const overwriteClipboard = () => {
      /* Windows PrintScreen writes the screen to the clipboard. Replacing it
         immediately is the one place where a page can actually undo a capture.
         Silently best-effort: without permission or a recognised user gesture
         this rejects, and there is nothing useful to do about that. */
      navigator.clipboard?.writeText(label).catch(() => {});
    };

    const onKey = (e: KeyboardEvent) => {
      // PrintScreen: Windows reports it on keyup far more reliably than on
      // keydown, so both are watched.
      if (e.key === 'PrintScreen') {
        raiseBriefly();
        overwriteClipboard();
        return;
      }
      // macOS capture chords.
      if (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(e.key)) {
        raiseBriefly();
        return;
      }
      // Windows Snipping Tool. Usually swallowed by the shell before the page
      // sees it, so this is opportunistic rather than dependable.
      if (e.shiftKey && (e.metaKey || e.getModifierState?.('Meta')) && e.key.toLowerCase() === 's') {
        raiseBriefly();
      }
    };

    /* The important one. Every capture tool that does not send a key event
       still has to take focus first. */
    const onBlur = () => holdWhileAway();
    const onFocus = () => releaseOnReturn();
    /* Both events are watched in both directions because neither fires
       everywhere: switching browser tabs changes visibility without always
       firing focus, and clicking another window blurs without hiding. */
    const onVisibility = () => (document.hidden ? holdWhileAway() : releaseOnReturn());

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [raiseBriefly, holdWhileAway, releaseOnReturn, label]);

  if (!shielded) return null;

  return (
    /* aria-hidden and pointer-events-none: this is a visual shield over
       content the reader is legitimately allowed to read, so it must not
       steal focus, interrupt a screen reader, or block a click. It covers the
       viewport for the couple of seconds a capture takes and then leaves. */
    <div
      aria-hidden
      /* Solid, and set inline rather than through a Tailwind token.
         This was `bg-panel/95` and rendered fully TRANSPARENT: `panel` resolves
         to `var(--panel-dark)`, a raw hex, and Tailwind's `/opacity` modifier
         cannot operate on a colour in that form -- so it silently emitted no
         background at all and the "shield" was an invisible box with a caption.
         Caught by reading the computed backgroundColor rather than by looking
         at a screenshot, where the paper reader's own dark chrome behind it
         made the overlay appear to be working.
         Opaque rather than 95%: this exists to be in the way of a capture, and
         letting 5% of the page through is 5% more than nothing. */
      style={{ backgroundColor: '#1B1A18' }}
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center px-6 text-center"
    >
      <p className="max-w-sm font-display text-[19px] font-black leading-[1.25] tracking-[-0.03em] text-background">
        {label}
      </p>
    </div>
  );
}
