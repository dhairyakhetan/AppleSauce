# Shikshaq — working notes

Kolkata tuition-teacher marketplace with a past-papers library.
React 18 + Vite + TypeScript + Tailwind + shadcn/ui, Supabase behind it.

**The product exists so a parent reaches a teacher.** Papers are the traffic
engine that brings them. Every decision below reads better with that in mind.

**Other documents carry the rest of the context:**

| | |
|---|---|
| `docs/GUARDRAILS.md` | the living checklist: what protects this product, what does not yet, what is deliberately accepted. Every claim there was measured, not inferred. **Section 11 is the short list of things blocked on a login, a phone or real traffic rather than on work** -- start there if you have account access. |
| `docs/LAUNCH.md` | merging to `main` IS the public launch. The rehearsal, the rollback, the post-launch checks. |
| `docs/CRAFT.md` | the craft bar: speed budgets, motion, visual system, affordances, flows, content truth, stakeholders. Audits and fixes are judged against it. |
| `docs/SUPABASE_RUNBOOK.md` | what is left to run against the database, and what is deliberately not a migration. |

---

## Two remotes, ONE branch

```
origin    kushalsethia/Shikshaq        public,  LIVE      -> real users
kanitest  kaxx4/shikshaqkanitest       private, TEST      -> Vercel preview
```

Working branch: `shikshaq-2.0`. Both remotes get **the same commits**.

```bash
npm run push:all          # commits -> origin, then mirrors to kanitest/main
```

**The branches must never diverge.** Test-only behaviour is switched by an
environment variable at build time, never by different code in different repos.
Two repos with different code is two codebases, and every future change would
have to be applied and merged twice.

`main` is a protected branch: it only moves through merged PRs from
`shikshaq-2.0` (merge commits, not fast-forwards; the 2.0 launch went out this
way on 26 September 2026). The pre-2.0 build is tagged `pre-2.0-live` for
rollback. See `docs/LAUNCH.md`.

If a fresh clone is missing the test remote:

```bash
git remote add kanitest https://github.com/kaxx4/shikshaqkanitest.git
```

## What differs between the two deployments

Only environment variables. Nothing else.

| Variable | live | test | effect |
|---|---|---|---|
| `VITE_SUPABASE_URL` | set | set | same project — see below |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | set | set | same project |
| `VITE_PREVIEW_TOOLS` | **unset** | `true` | role/auth preview toggle |
| `VITE_PREVIEW_*_EMAIL` / `_PASSWORD` | unset | set | the toggle's two accounts |

### The preview role toggle

`src/components/PreviewRoleToggle.tsx`, bottom-left, test build only. Switches
between signed-out, student and teacher by really signing in, so what you see is
what RLS actually returns.

It is **compiled out** of the live bundle, not hidden. Verify after a build:

```bash
grep -rl "PreviewRoleToggle\|IntentDebugPanel\|TEST BUILD\|preview-student@" dist/assets/*.js   # empty = good
```

To reproduce a live-shaped build locally, write a temporary
`.env.production.local` with `VITE_PREVIEW_TOOLS=false` and the preview
credentials blank, build, then delete it. The live bundle is ~11 kB smaller,
which is the tooling genuinely compiling out rather than being hidden.

**Admin is deliberately not one of the roles**, and `PreviewRole` has no
`'admin'` member so re-adding it is a type error. Its password would ship in the
bundle in plain text, and admin reaches every teacher application and the phone
number of all 148 listed teachers (counted 8 October 2026). Teacher reviewers
(see the security model below) reach the same contacts through `reviewer_*`
functions, so they are not a preview role either. Sign in normally for admin.

**Both deployments share ONE Supabase project** (`uvtifolnsneitetzohtn`).
Confirmed as intended. The test site reads and writes **live** data. Treat any
write from the test site as a write to production.

The live site deploys from a Vercel account **we do not have access to**. This
is the single largest constraint on the project and it shapes real decisions:
no build logs (a failed deploy is diagnosed by guessing), no env vars, no deploy
hooks, no firewall, no image optimization. Several choices below exist only
because of it.

### `VITE_` variables are PUBLIC

Vite inlines them into the JS bundle as plain text. Proven:
`grep -o "sb_publishable_[A-Za-z0-9_-]*" dist/assets/*.js` finds the key.

Never put a password, service key or anything secret behind a `VITE_` prefix.
`SUPABASE_SERVICE_ROLE_KEY` is deliberately unprefixed and server-side only
(`scripts/import-bank.ts`); it must never reach Vercel.

## Standing constraints

These have been decided. Do not relitigate them, and do not quietly undo them.

- **Question-paper text is never altered.** Not cleaned, retyped, re-cased or
  "fixed". It is read from `bank_questions.body` and rendered verbatim. Any
  change to how it is stored or moved must be proven byte-exact, not assumed.
  One owner-requested exception (8 October 2026): a verifier splitting at the
  word OR drops only that OR separator (`OR`, `Or`, with a comma or full stop it
  may carry) and keeps every other character. It goes through the versioned fix
  path (`apply_fix_locked`), so the whole question as it was stays in history.
- **No em or en dashes** in site copy, terms, teacher bios or meta text. The
  bios were normalised on 2026-08-31 (`supabase/normalise-bio-dashes.sql`,
  originals in `public._dash_backup`). Teacher reviews and question text are
  deliberately exempt — those are other people's words.
- **Papers are soft-gated, not locked.** **Two** questions read free (five until
  20260918100000). The number lives in `src/lib/free-preview.ts` and a test
  asserts the word matches the digit, because seven copy sites read from it and
  they were once all promising five while the gate served two.
- **Submit-a-paper is a real upload and review flow**, not a WhatsApp handoff.
- **Screenshots cannot be blocked on the web.** The capture shield blanks text
  on detectable chords and focus loss; a phone camera defeats all of it. Glyph
  substitution is a reversible cipher, and screen readers announce protected
  prose as Cyrillic — the owner's explicit decision, recorded in
  `src/lib/glyph-substitution.ts`.

## The security model, and the trap inside it

Anon and authenticated both reach question bodies and teacher contacts **only**
through SECURITY DEFINER functions. Direct table reads are revoked.

Teacher reviewers (8 October 2026) are a third group with contact access: an
admin or the HOD grants the role, and a reviewer reads applications and listed
teachers (phone and email included) and edits details **only** through the
`reviewer_*` functions, each of which checks the role inside and writes to
`admin_audit_log`. No RLS policy was widened for them. See docs/GUARDRAILS.md.

**Two things will bite anyone who touches this:**

**1. `revoke ... from public` is not enough on Supabase.** Supabase ships
`alter default privileges ... grant execute on functions to anon, authenticated`,
so every new function is granted EXECUTE **by role name**. Revoking from PUBLIC
leaves the direct role grant untouched. A function is closed only when revoked
from all three. This was exploitable in production:
`get_public_profile_data()` returned 206 named students' profiles to anyone.

Audit with `has_function_privilege`, never by string-matching `proacl` — a NULL
`proacl` means "the default applies", which for a function is EXECUTE TO PUBLIC,
so a string match silently misses every function nobody has touched.

```sql
select p.proname, p.prosecdef,
       case when p.proacl is null then 'DEFAULT (execute to public)'
            else pg_catalog.array_to_string(p.proacl, ' | ') end as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.prosecdef desc, p.proname;
```

**2. PostgREST expands `select('*')` to the columns a role MAY read, and does
not error on the rest.** A column revoke therefore turns a query into a silently
smaller row — no failure, fields just become `undefined`. Seven queries named a
revoked column and blanked every teacher card for every signed-out visitor.
Prefer explicit column lists. Re-swept on 8 October 2026: the only table with
column-level grants is `Shikshaqmine` (31 of 34 columns readable by anon and
authenticated), and no `select('*')` reaches it any more; `admin/teachers.tsx`
and `TeacherDashboard.tsx` both name their columns and are paired with
`admin_teacher_contacts()` / `teacher_own_contact()`. The `select('*')` calls
that remain (`teacher_applications`, `subjects`, `profiles`, `page_content`,
`teacher_recommendations`, `teacher_upvote_stats`, `admin_audit_log`) hit tables
whose table-level SELECT is intact, where Row Level Security, not columns,
decides what a role sees.

A *named* forbidden column fails the ENTIRE request with 401. `select('*')` does
not. That difference is the whole bug class.

**Refusals look like 401 with a `42501` body, not 404.** Read the body, not the
status.

## Architecture worth knowing

- **Papers live in Supabase**, in `bank_papers` (1,960 rows as of 2026-09-29: 1,063 verified, 424 live but `needs_review`, 473 hidden; 893 `needs_review` in all) and `bank_questions` —
  not in the repo. `data/question-bank.json` is a 6,912-question subset for
  re-imports, deliberately outside `public/` so it is never served. It is **not**
  the whole bank; do not audit data quality from it.
- **Figures live in the `paper-figures` Storage bucket**, not the repo either
  (as of 2026-09-25). `public/paper-figures/` is a local staging directory an
  import batch populates temporarily — resize with `scripts/resize-paper-figures.ts`,
  run `npm run generate-figure-dimensions` (reads local files one last time to
  capture intrinsic sizes into the committed `src/content/figure-dimensions.ts`),
  upload, then delete the local copies. `BankPaper.tsx` reads the bucket via
  `supabase.storage.from('paper-figures').getPublicUrl(...)`, never a local path.
- **`papers` and `bank_papers` are different tables.** `papers` has 0 rows (2026-09-29) and
  is the submit-a-paper flow; `bank_papers` has 1,960 published and is the library.
  Counting the wrong one has now caused the same user-visible bug twice.
  **Use `useSiteCounts()`** — the one hook — for teachers/papers/schools.
- **Prerendering is build-time HTML injection, not SSG.** `scripts/prerender.ts`
  runs as `postbuild` and writes `dist/<route>/index.html` for 1,700 routes.
  React still uses `createRoot`, so there is no hydration risk. It uses the
  **anon key**, which is a structural guarantee that it cannot read question
  bodies or contacts. It asserts no question text reaches `dist/` and fails the
  build if any does.
- **Pages freeze at build time.** Publishing a paper needs a manual redeploy
  before it appears in the prerendered HTML or the sitemap. Deploy hooks are not
  available to us.
- School names are resolved **at import time** (`scripts/school-names.ts`) and
  stored in `bank_papers.school`. Renaming a school is an `UPDATE`, not a deploy.
- The sitemap is generated at build time from Supabase (`prebuild`) and now
  **exits non-zero** when credentials are missing, rather than shipping a
  silently truncated file.
- **Caching splits by domain**: teacher data in `src/utils/cache.ts`
  (localStorage, 5 min–24 h TTLs), papers and counts in React Query (in-memory,
  5 min stale). Two smaller hand-rolled localStorage caches remain in
  `upvotes-context.tsx` and `use-toggle-relation.ts`.
- **The funnel is instrumented.** `recordSignal` is the chokepoint every
  meaningful action passes through, and `src/lib/intent/analytics-mirror.ts`
  forwards a curated allowlist to GA4 and Clarity. It sends facets and a slug,
  never query text, names or paths.

## Testing and CI

```bash
npm test          # vitest 2, pinned to match vite 5 -- vitest 5 needs vite 6+
npx tsc -b        # NOT --noEmit, see gotchas
npx eslint .
```

CI (`.github/workflows/ci.yml`) gates on all three, all blocking. There is no
build step in CI: the build needs live Supabase credentials, and putting a key
in CI to work around that trades a real secret for a weaker check.

`no-explicit-any` is a **warning**, not an error, because tsconfig already sets
`strict: false` and `noImplicitAny: false` — erroring on the honest annotation
while permitting the silent one is incoherent.

## Gotchas that have already cost time

- **`npx tsc --noEmit` checks nothing here.** The root config is `"files": []`
  with project references. Use **`npx tsc -b`**.
- **eslint used to lint `.claude/worktrees`** — stale copies of the whole
  codebase — which made the backlog look ~7× larger than it was. Now ignored.
- `npm run preview` uses **port 4180** (`.claude/launch.json`), deliberately not
  vite's default 4173, because a stale server there answers happily and you end
  up testing old code.
- Measuring the DOM before data loads gives false readings. Settle ~3s.
- **`innerWidth` is not `clientWidth`.** innerWidth includes the scrollbar and
  inside an emulated viewport can report 518 where the layout is 375. Use
  `matchMedia`, which is the same source CSS breakpoints use.
- **Stale console buffers persist across navigations.** Errors you are reading
  may belong to a page you already left. Check in a fresh tab before believing
  them.
- **Instrumenting `fetch` breaks Supabase** if you call the original with
  `apply(this, …)` — it calls fetch detached, so `this` is undefined and Chrome
  throws "Illegal invocation" on every request. Bind it.
- When search results look identical for every query, you are reading the page
  *behind* the search overlay, not the results panel.
- **Tailwind `/opacity` cannot operate on a `var(--x)` raw-hex colour** — it
  silently emits nothing, which is how the capture shield shipped invisible.
- **The design scale is deliberate now.** Radii are 2, 6, 8, 10, 12, 14, 16, 18,
  20, 24, 28, 30 (`rounded-bento`), 32. There are **no half-pixel font sizes**;
  don't reintroduce one. Concentric corners hold: an inner radius should be its
  parent's radius minus the inset.
- **`sharp` is deliberately absent from `package.json`.** Vercel installs
  devDependencies, so an entry there would put a native build in the deploy path
  of a site whose logs nobody here can read. `scripts/resize-paper-figures.ts`
  is local-only and excluded from `tsconfig.node.json` for that reason.
