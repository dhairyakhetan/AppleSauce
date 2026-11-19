import type { ReactNode } from 'react';
import { setDummyMode } from '@/lib/dummy-mode';

/* The "you are looking at made-up data" strip every dummy admin page shows
   (same look as AdminPipelineDummy's). Test builds only. */
export function DummyBanner({ leaveTo, children }: { leaveTo: string; children?: ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="mx-1.5 my-2 flex flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      {children ? <span className="text-fuchsia-200">{children}</span> : null}
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign(leaveTo);
        }}
        className="ml-auto min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Leave dummy mode
      </button>
    </div>
  );
}
