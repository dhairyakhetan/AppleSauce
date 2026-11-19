import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { claimStaleChunkReload } from "@/components/ErrorBoundary";

/* Vite's own signal that a dynamic import (a lazy route's chunk) failed to
   load, fired on `window` BEFORE the same failure reaches React as a thrown
   render error. Handling it here, ahead of ErrorBoundary, is what actually
   prevents "Something went wrong" from ever painting on a stale-chunk
   navigation: reloading from this listener races the browser to the fix
   before React commits the error UI at all. ErrorBoundary's own recovering
   state (see its componentDidCatch) is the fallback for whatever this misses
   -- a non-Vite import failure, or a browser that does not dispatch this
   event -- so the fix holds even if this listener never fires.
   claimStaleChunkReload is shared with ErrorBoundary so both draw on the same
   one-reload-per-minute budget rather than each getting their own. */
window.addEventListener("vite:preloadError", () => {
  if (claimStaleChunkReload()) window.location.reload();
});

/* scripts/prerender.ts writes a crawlable copy of each route's content into a
   #prerender div beside #root, so the ~1,857 indexable URLs have real HTML
   before any JavaScript runs. It is removed here, synchronously and BEFORE the
   first render, so it never appears alongside the real UI -- removing it after
   render() would leave a window where both are in the document.
   Absent on a dev server and on any route that was not prerendered, hence the
   optional chaining rather than a non-null assertion. */
document.getElementById("prerender")?.remove();

createRoot(document.getElementById("root")!).render(<App />);
