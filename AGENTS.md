# Agent instructions

**Read [CLAUDE.md](CLAUDE.md) first and follow it.** It is the single source of
truth for how this repository is worked on. This file exists so tools that look
for `AGENTS.md` rather than `CLAUDE.md` still find their way there.

The three things most likely to be got wrong, in short:

1. **Two remotes, one branch.** This folder pushes to `origin`
   (`kushalsethia/Shikshaq`, LIVE) and `kanitest`
   (`kaxx4/shikshaqkanitest`, TEST). They must hold identical code. Use
   `npm run push:all`. Never let them diverge; test-only behaviour is switched
   by an environment variable at build time, never by different code.

2. **`npx tsc --noEmit` checks nothing here.** The root config is
   `"files": []` with project references. Use `npx tsc -b`.

3. **Question-paper text is never altered.** Not cleaned, retyped or
   re-cased. Any change to how it is stored or moved must be proven
   byte-exact, not assumed.

Both deployments share one **live** Supabase project. A write from the test
site is a write to production.
