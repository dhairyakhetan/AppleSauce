import { useEffect, useRef, useState } from 'react';
import { tweenValue } from '@/lib/pipeline-route';

const DURATION_MS = 700;

/** A number that counts from what it showed to the new value instead of jumping. With `animate` false it just follows the target. `tweening` is true while it is mid-count. */
export function useTweenedNumber(target: number, animate: boolean): { value: number; tweening: boolean } {
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  shown.current = value;

  useEffect(() => {
    if (!animate || shown.current === target) {
      setValue(target);
      return;
    }
    const from = shown.current;
    const start = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const p = (t - start) / DURATION_MS;
      setValue(tweenValue(from, target, p));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return { value, tweening: value !== target };
}
