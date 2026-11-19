# Supabase runbook

## State of the migrations, 2026-10-08

**Applied to the live project** (checked against `supabase_migrations.schema_migrations`
on 2026-10-08; the live version stamp is the apply time, not the file name):
every migration from `20261002090000` through `20261008160000`, that is
`20261007100000` (checker assignments and the HOD) to `20261008160000` (skip for
later), which includes `20261008120000_teacher_reviewers.sql`,
`20261008140000_verifier_undo_last.sql` and
`20261008150000_verifier_or_alternatives.sql`.

**Pending rehearsal:** `20261008170000_cascade_undo_skip_or.sql`. Not applied.
It moves the remaining counters onto the counted views, gives
`checker_settle_current` the one skip rule, carries the OR link through the
publish paths, lets an unknown class go to any verifier, and marks undone rows in
the history readers. It changes no table. Rehearse it inside one transaction that
raises at the end (see the technique in the maintainers' notes), run the verify
and grants blocks, then apply with the owner's yes. One function is dropped and
created again (`hod_action_history`, one more column), so open it as an HOD
afterwards and check the History tab.

Not a migration, and not reversible by one: the 2026-10-08 reroute of 5,151
AI-only questions to verifiers (backup in `public._reroute_backup_20261008`).
See docs/GUARDRAILS.md.

---

## Applied, 2026-10-02: `20261002090000_checker_versions_and_activity.sql` (site PR D)

*(Historical. Applied since; kept for what it added.)* Was: needs the owner's yes. Rehearsed against live inside one
transaction that raised at the end, so nothing was kept. Apply it **before**
merging PR D: the new checker sends the version it saw, and without this
migration the questions carry no version, so the site falls back to the old
unlocked save and refuses printed-typo corrections (by design, see
`src/lib/checker-save.ts`).

What it adds: `version` on `checker_next_question()`; `checker_fix_locked` /
`checker_pass_locked` (40001 on a stale version, fixes through
`apply_fix_locked`, printed-typo corrections logged as `checker_printed_typo`
and kept in `content_versions`); `admin_activity_feed` (ids and labels only,
no names, emails masked); `admin_version_history` (no `answer_key`); two
indexes on `audit_review_log(at)`. Rollback is written at the top of the file.

After applying, from the SQL editor: query 4b-style check that `anon` cannot
execute any of the five functions (`has_function_privilege`), then open
`/checker` as a checker and save one fix.

---

Everything that does not touch the database is done, tested and deployed.

**`supabase/RUN_THIS_ONE.sql` has been applied and verified.** Everything still
owed to the database is now in ONE file:

### [`supabase/RUN_THIS_LAST.sql`](../supabase/RUN_THIS_LAST.sql)

Paste the whole thing into the SQL editor. After it there is no pending SQL,
and the only database items left on this page are decisions for you rather than
statements to run.

| section | what | risk |
|---|---|---|
| 1 | ~~Gives 218 reviews their authors back.~~ **APPLIED AND VERIFIED 2026-09-19.** 206 = 206, anonymity intact, `/rpc/get_public_profile_data` still 42501, and the named review renders as a name signed in and signed out. | done |
| 2 | ~~Makes two admin-only guards reject anon.~~ **APPLIED AND VERIFIED 2026-09-19.** | done |
| 3 | Three read-only diagnostics. **Ran, but the verdicts were still not read back**, so the three questions remain open. Section 3 changes nothing and can be re-run on its own at any time. | none |
| 4 | Verification. | done |

Each writing section is its own transaction, so a failure applies none of that
section rather than half of it. Every rollback is inline beside the thing it
undoes. Re-running the whole file is safe.

The two migration files it consolidates
(`20260919120000_restore_public_profiles_view.sql` and
`20260919090000_fix_definer_guards_for_anon.sql`) are now marked **superseded**
and should not be run separately -- the second one's `alter function ... rename
to` is not repeatable, so running it after `RUN_THIS_LAST.sql` would fail.

**STATE, 2026-09-19: `RUN_THIS_LAST.sql` has been applied. There is no pending
SQL.** Sections 1 and 2 were verified from outside the database, against
production, using the app's own anon client:

- Section 1: the view returns 206 rows, equal to the 206 distinct named review
  authors; no anonymous-only profile is exposed; `/rpc/get_public_profile_data`
  still answers 42501, so the bulk dump did not reopen; and a named review
  renders as a name both signed in and signed out while the anonymous one
  beside it still reads "Anonymous".
- Section 2: `check_existing_users_for_teacher_role_unguarded` now answers
  42501 rather than PostgREST's PGRST202 "could not find the function". That
  name only comes into existence through section 2's rename, so its existence
  is the proof the section ran. A deliberately fake function name was probed in
  the same call as a control, and returned PGRST202 as expected -- without that
  control, 42501 alone would not have distinguished "exists and is closed" from
  "does not exist".

**Still unanswered: the three section 3 diagnostics.** They print as NOTICE
messages rather than result rows, which is easy to miss. Re-run section 3 alone
and read the Messages pane to settle whether `ip_hash` carries real values,
whether `check_user_exists` is a working enumeration oracle or simply broken
(sign-in depends on the answer), and which papers claim a `question_count` that
does not match their rows.

**There is no test database.** Both deployments share `uvtifolnsneitetzohtn`, so
this is production the moment it runs. Prefer Kolkata off-hours.

---

## Why it is urgent

Verified by curl against production on 2026-09-18, as an anonymous caller
holding only the publishable key that ships inside the JS bundle:

| Endpoint | Response |
|---|---|
| `POST /rpc/get_public_profile_data` | **200, 52,753 bytes, 206 rows** |
| `POST /rpc/purge_read_events` | **200** |

The first returns every profile with `full_name`, `school_college`, `grade` and
`avatar_url`. Many are school students at named Kolkata schools, downloadable as
one list by anyone.

**The claim that used to sit here was wrong, and it cost the site 218 reviews.**
It read: "It has no call sites in `src/` ... so closing it breaks nothing." It
has three, all of them indirect. `public_profiles` is a view declared
`security_invoker = on` over `select * from get_public_profile_data()`, so the
caller needs EXECUTE on the function to read the view at all. Revoking it
turned every read into 42501 and rendered 218 of 376 approved reviews as
"Anonymous" — on teacher profiles, the homepage quote rail and the teacher's
own dashboard — for signed-in visitors as well as anonymous ones, because the
revoke covered `authenticated` too. Grepping for the function name was not
enough; the dependency was in the database, not the code. Fixed by
[`20260919120000_restore_public_profiles_view.sql`](../supabase/migrations/20260919120000_restore_public_profiles_view.sql),
which rebuilds the view directly over `profiles` so the function stays shut.

The second is an unauthenticated DELETE against the audit table.

Neither was introduced by the redesign. The cause is that
`revoke ... from public` does not remove Supabase's **direct** `anon` grant, so
`20260918100000` left them open. Section 1 of the file closes both.

## What the file does

1. **Security.** Revokes EXECUTE by role name, not just from `PUBLIC`, and
   re-grants explicitly to the three functions that are meant to be public, so
   the intent is chosen rather than inherited from a default nobody picked.
2. **Retention.** The 90-day purge existed but nothing ever called it, so real
   retention was "forever" on a table recording what minors read. Installs two
   mechanisms: `pg_cron` if this project can enable it, and an insert trigger
   that needs no scheduler and no extension. The privacy policy now states 90
   days, so this had to become true.
3. **Diagnostics.** Read-only. Prints its own verdict on three things nobody had
   established: whether `ip_hash` is real, whether `check_user_exists` is inert
   or broken, and whether `question_count` matches the actual question rows.

## After it runs

Section 4 of the file is the verification, with the expected answer written
beside each query. The two that matter most:

- Query **4b** lists every function `anon` can still execute. Read it and agree
  with each line. Only the three gates belong there.
- Query **4d** must show `enforcing = false`.

Then in the app: a teacher opens their dashboard, sees their own number, **and
saves successfully** — that is the regression that matters, because the failure
mode is silent rather than loud. Admin's teacher table shows contacts. A paper
opens signed in and signed out. `select count(*) from public.read_events;` rises
as you browse.

## Then leave the quotas alone

`enforcing` defaults to `false` and should stay false at launch. Every threshold
is a guess — there were 3 rows of read telemetry when they were written — and the
first person a bad guess stops is a Class 10 student working through past papers
the week before boards.

After two to four weeks of real traffic:

```sql
-- what a real reader looks like
select percentile_cont(0.50) within group (order by n) p50,
       percentile_cont(0.99) within group (order by n) p99, max(n)
from (select user_id, date_trunc('day', created_at) d, count(*) n
      from public.read_events where kind='paper' group by 1,2) daily;

-- who these limits would have stopped
select limit_hit, count(distinct user_id) from public.read_quota_breaches group by 1 order by 2 desc;

-- anything obviously automated
select * from public.read_suspicion order by score desc limit 20;
```

Set the limits above the observed p99, then
`update public.read_quota_config set enforcing = true;`.

---

## Not a migration, and deliberately left to you

**Google-only sign-in.** Disable the Email provider in Authentication →
Providers, and drop the email/password branch from `src/pages/Auth.tsx`. Contact
the 9 password accounts first — 545 of 553 are already on Google. The query is at
the bottom of `RUN_THIS_ONE.sql`. Do this **after** quotas are enforced; its
whole value is making per-account limits expensive to evade.

**An `updated_at` column on `teachers_list` and `bank_papers`.** The sitemap
now sends each page its row's own `created_at` as `lastmod`, instead of
stamping all 1,830 with the build date. That is a large improvement -- the
field was previously being ignored by Google, since a site that claims every
page changed on every deploy is not telling the truth -- but `created_at` is
not `last modified`. It understates for a teacher who later edits their
profile: the page changed and the date did not move.

Neither table has an `updated_at`. Adding one with a `before update` trigger
would make the field exactly right. It is left as a decision rather than
written as a migration because it is a schema change on two live tables for an
SEO signal that is already most of the way fixed, and the failure mode of
getting it wrong (a trigger that fires on the bulk importer) is worse than the
understatement it cures. `scripts/generate-sitemap.ts` reads `created_at` by
name, so switching it over is a one-line change once the column exists.

**Canary teacher rows.** `teachers_list` is anon-readable in bulk, so a decoy row
with a number you control is picked up by any directory scrape, and `read_events`
says which account pulled it. Set `is_paused = true` so it stays out of Browse.
Left as a decision rather than a migration because it inserts fake data into a
live directory.

Canary *questions* do not work and I would not build them: a canary paper has to
be published to be reachable, which puts a fake paper in the catalogue, and a
canary question inside a real paper breaks the byte-exact rule. Watermarking has
the same problem — it belongs in surrounding DOM or per-account figure variants,
never in the text.

---

## Still open, deliberately

| | |
|---|---|
| Paper figures not resized | 25 MB, largest 312 kB, painted at 300px. Dimensions are set so there is no layout shift, but real resizing needs `sharp` or a CDN and someone able to watch the build |
| ~376 `text-[Npx]` sizes | browser text scaling is inert. Gated as "top 20, measure, decide" |
| Footer `page_content` fallback | three sequential queries per new route; collapsible, but the specificity ordering is subtle and it is already cached per route |
| Teacher reviews not copy-protected | they are other people's words; your call whether they should be |
| `home_facet_counts()` paper fields wrong table | Live RPC returns `paper_boards: {}` and `paper_classes: {}` unconditionally -- almost certainly counting the empty `papers` table (18 rows, the submit-a-paper flow) instead of `bank_papers` (~1,960 rows, the library), the exact "counted the wrong table" bug class this repo has hit twice before. `teacher_boards` from the same RPC is unaffected and still used as-is. There is no migration file for this function anywhere in `supabase/migrations/` -- its current SQL is not checked in, so it cannot be audited or redefined from a migration, and anon cannot read `pg_proc` to recover it. Worked around client-side in `src/pages/Index.tsx` (2026-09-26): `paper_boards` is now derived from `loadPaperIndex()` (the same cached, paged bank_papers fetch PastPapers.tsx uses) instead of the RPC field. `paper_classes` is unused by any page today, so it was left alone rather than derived speculatively. Someone with SQL access should redefine `home_facet_counts()` against `bank_papers` (`is_published`, `board`, `cls`, counting `needs_review` rows too per the 2026-09-26 inclusive-count decision) and commit its definition as a migration so this stops being invisible. |
