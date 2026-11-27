import { useCallback, useEffect, useState } from 'react';
import type { GamesApi } from '@/lib/games/api';
import { EXAMPLE, format } from '@/lib/games/format';
import type { BankQuestion } from '@/lib/games/rows';
import { Revise, type ReviseQuestion } from './Revise';
import { Loading, LoadFailed } from './shared';

/* Try the games: what students will get, played by the team for now, made from the approved questions only. With none
   approved yet, it plays the page's own example (its good questions: 13 over three topics, enough for all five games),
   and says it is a demo. */

/** The example's questions that the checker passes, as questions in the bank. */
const DEMO: ReviseQuestion[] = (() => {
  const { rows, issues } = format(EXAMPLE);
  const bad = (r: (typeof rows)[number]) => issues.some((x) => x.level === 'error' && x.line >= r.line && x.line <= (r.end ?? r.line));
  return rows.filter((r) => !bad(r)).map((r, i) => ({ ...r, id: `demo-${i + 1}` }));
})();

export function TryGames({ api }: { api: GamesApi }) {
  const [bank, setBank] = useState<{ data?: BankQuestion[]; error?: string }>({});
  const load = useCallback(() => {
    setBank((b) => ({ data: b.data }));
    api.loadQuestionBank().then((data) => setBank({ data }), (e: Error) => setBank((b) => ({ data: b.data, error: e.message })));
  }, [api]);
  useEffect(load, [load]);

  if (!bank.data) return bank.error ? <LoadFailed what="The question bank" error={bank.error} onRetry={load} /> : <Loading label="Loading the questions" />;
  // the demo plays when nothing approved has a game to play yet
  return <Revise questions={bank.data} demoQuestions={DEMO} />;
}
