import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/* `api/chat.ts` is a Vercel serverless function — Vercel serves it, but plain
   `vite dev` has no concept of the `api/` convention at all, so every request
   to it 404s locally. That's not a bug in the deployed site (Vercel wires it
   up), but it did mean the chat widget was silently, unfixably broken for
   anyone testing against `npm run dev` — confirmed live: POST /api/chat
   returned a bare 404. This loads the same handler through Vite's own SSR
   module loader (so it gets the exact same TS/ESM code Vercel would run, no
   separate build step) and calls it with a minimal Vercel-shaped
   req/res shim. Dev-only — `configureServer` never runs in a production
   build, and Vercel's own routing takes over completely once deployed. */
function vercelApiDevPlugin(): Plugin {
  return {
    name: "vercel-api-dev",
    configureServer(server) {
      server.middlewares.use("/api/chat", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf-8");
          const body = raw ? JSON.parse(raw) : {};

          const mod = await server.ssrLoadModule("/api/chat.ts");
          const handler = mod.default as (req: unknown, res: unknown) => Promise<void>;

          let statusCode = 200;
          const shimRes = {
            status(code: number) {
              statusCode = code;
              return shimRes;
            },
            json(payload: unknown) {
              res.statusCode = statusCode;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(payload));
            },
          };
          await handler({ method: req.method, body }, shimRes);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Dev API proxy failed", message: (err as Error).message }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // GEMINI_API_KEY is deliberately unprefixed (server-only, never shipped to
  // the client) — Vite's own env loading only auto-exposes VITE_-prefixed
  // vars, so it has to be read from .env and assigned onto process.env by
  // hand for the dev proxy above to see it the same way Vercel's runtime
  // would. Build-time only; never bundled into client code.
  const env = loadEnv(mode, process.cwd(), "");
  if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;

  return {
  server: {
    host: "::",
    // Defaults to 8080; PORT lets a second dev server run alongside the first.
    port: Number(process.env.PORT) || 8080,
  },
  plugins: [react(), vercelApiDevPlugin()],
  optimizeDeps: {
    esbuildOptions: {
      /* WITHOUT THIS THE DEV SERVER DOES NOT START AT ALL. It dies during
         dependency prebundling with 919 copies of

           Transforming destructuring to the configured target environment
           ("chrome87", "edge88", "es2020", "firefox78", "safari14" + 2
           overrides) is not supported yet

         and exits 1, so `npm run dev` prints "ready in 591 ms" and then the
         port answers ERR_CONNECTION_REFUSED. The misleading "ready" line is
         why this survived: every other gate -- tsc, eslint, vitest, and the
         production build -- passes, because none of them use the optimizer.

         The single offending entry is `safari14`. Probed against the esbuild
         actually installed: es2020, chrome87, es2015 and esnext all transform
         destructuring happily; safari14 alone refuses. esbuild learned about
         a real Safari 14 destructuring bug and, having no lowering for it,
         errors rather than emitting something wrong.

         It is our own `overrides` block that puts us here: `"esbuild":
         ">=0.25.0"` was added in f06fef6 to clear a Dependabot alert, and
         being open-ended it now resolves to 0.28.2 while vite 5.4 asks for
         ^0.21.3. So the break arrived on an ordinary `npm install`, with no
         commit to blame it on.

         Fixing it HERE rather than by pinning esbuild down keeps that
         security override intact and touches nothing outside dev: this target
         governs prebundled dependencies only, and those only ever run in the
         browser of whoever is running the dev server. `build.target` is
         'es2015' and is set separately below, so what ships is unchanged. */
      target: 'es2020',
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Optimize for mobile devices
    target: 'es2015', // Support older devices
    minify: 'esbuild', // Faster than terser
    cssMinify: true,
    rollupOptions: {
      output: {
        // Add hash to filenames for cache busting
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
        // Manual chunk splitting for better code splitting
        /* The object form of manualChunks assigns only the modules you NAME.
           Their dependencies are placed by Rollup's own algorithm, which put
           this config's chunks nowhere near where their names claimed:

             react-vendor  held only react-router. React and ReactDOM were
                           inside ui-vendor, because the Radix packages
                           imported them first.
             supabase-vendor became the root of the module graph -- esbuild's
                           shared helper prelude landed there, so 180kB of
                           Supabase had to be downloaded AND evaluated before
                           React could evaluate, on every route, including
                           ones that touch no data.

           So the intended "React caches independently of UI code" split never
           happened: any Radix bump invalidated React for every returning
           visitor. The function form assigns by resolved module id, which is
           the only way to place a transitive dependency deliberately.

           Packages that were absent from the old map and therefore landed in
           the 454kB main chunk are named here too: @tanstack/react-query,
           lucide-react, sonner, and the Radix packages beyond the original
           four (tooltip, label, slot). */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;

          // Order matters: react-dom and scheduler must be tested before the
          // bare /react/ check, and before anything that depends on them.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (id.includes('react-router')) return 'router-vendor';
          if (id.includes('@supabase')) return 'supabase-vendor';
          if (id.includes('@tanstack')) return 'query-vendor';
          if (id.includes('framer-motion')) return 'motion-vendor';
          // KaTeX is ~250kB and only the paper reader needs it. Naming it
          // keeps it out of whatever route chunk happens to import it first.
          if (id.includes('katex')) return 'katex-vendor';
          if (id.includes('dompurify')) return 'dompurify-vendor';
          if (id.includes('fuse.js')) return 'search-vendor';
          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('sonner')) return 'ui-vendor';
        },
      },
    },
    // Optimize chunk size warnings
    chunkSizeWarningLimit: 1000,
  },
  };
});
