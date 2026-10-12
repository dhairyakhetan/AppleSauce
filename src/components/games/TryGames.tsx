import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GamesApi } from '@/lib/games/api';
import type { BankQuestion } from '@/lib/games/rows';
import { btn } from './helpers';
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
        <Empty>
          <p><b className="text-foreground">The question bank is empty.</b> Questions appear here once the team sends them and an HoD approves them.</p>
          <Link className={btn('card', 'mt-3')} to="/games">Go to Write questions</Link>
        </Empty>
      );
  }
  return (
    <Revise
      questions={bank.data}
      heading={<p className="max-w-prose text-[14px] text-warm-secondary">What students will get: pick the topics they studied, and play a short puzzle made from the approved questions.</p>}
    />
  );
}
