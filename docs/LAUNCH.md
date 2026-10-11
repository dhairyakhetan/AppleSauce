# Launch runbook

Merging `shikshaq-2.0` into `main` **is** the public launch. Vercel builds the
live site from `main`, so the moment that push lands, real users get the
redesign. There is no staging step between the two.

---

## The good news, verified rather than assumed

```
git merge-base --is-ancestor origin/main HEAD   # exit 0
git push --dry-run origin HEAD:main             # 593c447..ef862f8
```

`origin/main` is **an ancestor of** `shikshaq-2.0`. The launch is a
**fast-forward**, not a merge:

- **Zero conflict risk.** There is nothing to resolve, because `main` has no
  commits we do not already have.
- Nothing on `main` is discarded, so nothing can be lost in a conflict
  resolution done under pressure.
- `main` held the **13 July 2026** build (`593c447`, tagged `pre-2.0-live`)
  until the launch itself, which went out on **26 September 2026** as a merged
  PR. `main` has moved since, only ever through merged PRs from
  `shikshaq-2.0` (#53, #72, #76 and #77 so far).

`main` gains **449 commits** (re-verified 2026-09-26 via
`git rev-list --count origin/main..shikshaq-2.0`; this number moves every
session that adds commits, so treat it as a snapshot, not a constant): **279**
files under `src/`, **24** migrations, and (after the 2026-09-26 figures
migration to Supabase Storage removed `public/paper-figures/`) just **5**
files under `public/` rather than the 1,028 an earlier snapshot of this doc
claimed.

## Before you merge

1. **The database is not a single pending step any more.** Earlier snapshots
   of this session applied migrations directly to production as they were
   written, verified each one, and confirmed with `git merge-base
   --is-ancestor` that nothing on `main` conflicts — there is no batch of SQL
   waiting to run at merge time. Confirm the same before you merge: every
   migration under `supabase/migrations/` with a timestamp newer than the last
   launch should already show as applied in the Supabase dashboard, not
   pending.
2. **Check the live Vercel env vars are unchanged.** The build needs
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, which live already
   has, and needs `VITE_PREVIEW_TOOLS` to stay **absent**.
3. **Off-hours.** The first request after deploy is the slowest, and Kolkata
   evening is when students are reading.

## The merge

`main` on `kushalsethia/Shikshaq` is a **GitHub-protected branch** — a direct
`git push origin shikshaq-2.0:main` is rejected with "Protected branch update
failed... Changes must be made through a pull request." (Confirmed the hard
way on 2026-09-26; the command below is what actually failed.) The real flow:

```bash
git push origin shikshaq-2.0:shikshaq-2.0   # or npm run push:all, which also mirrors to kanitest
gh pr create --repo kushalsethia/Shikshaq --base main --head shikshaq-2.0 --title "..." --body "..."
# wait for the PR's required checks (CI, CodeQL, the Vercel preview build) to go green,
# then:
gh pr merge <number> --repo kushalsethia/Shikshaq --merge
```

No review is required by the branch protection rule as configured today, only
passing checks — but that's a repo setting, not a promise; re-check
`gh pr view <number> --json mergeStateStatus,reviewDecision` before merging
rather than assuming.

## If the build fails, nothing breaks

Worth knowing so nobody panics: **a failed build does not take the site down.**
Vercel keeps serving the last successful deployment. The two ways this build can
fail are both loud and both safe:

- `prebuild` generates the sitemap and now **exits non-zero** when the Supabase
  env vars are missing, rather than shipping a silently truncated file.
- `postbuild` prerenders 1,700 routes and **fails the build** if any question
  text reaches `dist/`.

Either way the old site stays up and you fix forward.

## Rollback

The live Vercel account is not reachable from here, so its dashboard rollback is
not an option. Rolling back means moving `main`. The commit that was live for
the whole pre-launch period is tagged, so this needs no SHA:

```bash
git push --force-with-lease origin pre-2.0-live:main
```

`--force-with-lease`, not `--force`: it refuses if someone else has pushed to
`main` since you last fetched, which is exactly the case where a blind force
would destroy their work.

Rolling back the **code** does not roll back the **database**, and it does not
need to. Every schema change is additive or a privilege revoke. The 13 July
build does not read `read_events`, does not call the new functions, and reads
teacher contacts through columns it still has access to. Two things to know
(as of 8 October 2026): the old build shows **five** free questions in its copy
while the gate now serves **two**, so a rollback reintroduces the mismatch this
launch fixed; and `pre-2.0-live` now sits behind many later merges (verifiers,
HOD, teacher reviewers, undo, the paper library changes), so rolling `main`
back to it would take all of that off the live site while their migrations stay
in the database. Prefer reverting the one bad merge over resetting to the tag.

## After the push, check these in order

1. `https://www.shikshaq.in/` loads and shows the new home page.
2. A paper page at its bare path — `/past-papers/<id>` — returns its **own**
   title and canonical, which proves the prerendered files are being served
   rather than the SPA catch-all.
3. Signed out, **a Maths paper** shows **two** questions and says "two" in the
   copy. Deliberately not "a paper": as of 2026-09-26 the entire English
   subject is flagged `needs_review` pending further audit, so an English
   paper correctly shows a "Coming soon" notice and zero questions — that is
   expected, not a regression. Picking a random paper for this check can land
   on English and look like a false alarm.
4. Sign in, and the same paper shows all of them.
5. A teacher opens their dashboard, sees their own number, **and saves**. This
   is the regression that matters most, because its failure mode is silent.
6. `select count(*) from public.read_events;` rises as you browse.
7. The live bundle contains none of `PreviewRoleToggle`, `IntentDebugPanel`,
   `TEST BUILD`, `preview-student@`.

## What launch does not fix, and is fine

- **Pages are frozen at build time.** Publishing a paper needs a redeploy for it
  to appear in the prerendered HTML and the sitemap. Deploy hooks are not
  available, so that redeploy is manual.
- **Quotas stay off.** `enforcing = false` until `read_events` has two to four
  weeks of real traffic. Do not turn them on for launch day.
- **Nobody can read the live build logs.** That constraint shaped several
  decisions above, including why both build steps fail loudly rather than
  degrading quietly.
