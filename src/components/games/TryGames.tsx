import { useCallback, useEffect, useState } from 'react';
import type { GamesApi } from '@/lib/games/api';
import type { BankQuestion } from '@/lib/games/rows';
import { Revise } from './Revise';
import { Empty, Loading, LoadFailed } from './shared';

/* Try the games: what students will get, played by the team for now, made from the approved questions only. */

export function TryGames({ api }: { api: GamesApi }) {
  const [bank, setBank] = useState<{ data?: BankQuestion[]; error?: string }>({});
  const load = useCallback(() => {
    setBank((b) => ({ data: b.data }));
    api.loadQuestionBank().then((data) => setBank({ data }), (e: Error) => setBank((b) => ({ data: b.data, error: e.message })));
  }, [api]);
  useEffect(load, [load]);

  if (!bank.data?.length) {
    return bank.error ? <LoadFailed what="The question bank" error={bank.error} onRetry={load} />
      : !bank.data ? <Loading label="Loading the questions" />
      : (
        <Empty>No approved questions yet.</Empty>
      );
  }
  return <Revise questions={bank.data} />;
}
