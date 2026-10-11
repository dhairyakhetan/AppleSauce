import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a piece of UI mounted for `duration` ms after `open` goes false, so its
 * exit animation can play instead of an instant unmount. Pair with a CSS
 * animation on the consumer that branches on `closing` (see SearchControl's
 * shikshaq-search-rise/-fall for the reference pattern).
 */
export function useExitPresence(open: boolean, duration = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number>();

  useEffect(() => {
    if (open) {
      window.clearTimeout(timerRef.current);
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      timerRef.current = window.setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, duration);
    }
    return () => window.clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { mounted, closing };
}
