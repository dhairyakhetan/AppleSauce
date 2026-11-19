import { useEffect, useMemo, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Row } from '@/lib/games/rows';
import { chip } from './helpers';
import { Revise, type ReviseQuestion } from './Revise';

/* "See how it plays": Try the games, scaled down, made from the questions in the Questions box as they are written
   (the same view and the same engine, so it is exactly what a student would get from these questions). Every topic is
   in to start with; tap a topic to leave it out. Nothing here is saved or sent. "Full size" opens it as students see it. */

/** The value, once it has stopped changing for `ms`: the games aren't rebuilt on every key press. */
function useSettled<T>(value: T, key: string, ms = 450): T {
  const [settled, setSettled] = useState({ value, key });
  useEffect(() => {
    if (key === settled.key) return;
    const t = setTimeout(() => setSettled({ value, key }), ms);
    return () => clearTimeout(t);
  }, [key, value, ms, settled.key]);
  return settled.value;
}

/** Rows as questions a puzzle can use. A chapter without its ID yet (a detail missing) still groups its questions. */
const asQuestions = (rows: Row[]): ReviseQuestion[] =>
  rows.map((r) => ({
    ...r,
    id: `L${r.line}`,
    chapter_id: r.chapter_id ?? `draft|${r.board}|${r.class}|${r.subject}|${r.chapter_no}|${r.chapter}`,
  }));

export function GamePreview({ rows }: { rows: Row[] }) {
  const sig = rows.map((r) => [r.line, r.chapter_id, r.chapter_no, r.chapter, r.topic_no, r.topic, r.question, r.answer, r.also.join(';'), r.fill, r.wrong_options.join(';')].join('|')).join('\n');
  const settled = useSettled(rows, sig);
  const questions = useMemo(() => asQuestions(settled), [settled]);
  const [big, setBig] = useState(false);

  return (
    <section aria-labelledby="preview-h" className="flex flex-col gap-3">
      <h2 id="preview-h" className="text-[15px] font-bold text-foreground">3. See how it plays</h2>
      {!rows.length && <p className="text-[14px] text-warm-secondary">A game made from your questions shows here.</p>}
      {questions.length > 0 && (
        <Revise compact written questions={questions}
          extra={() => <button type="button" className={chip('card')} onClick={() => setBig(true)}><Maximize2 aria-hidden /> Full size</button>} />
      )}
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-2xl bg-card">
          <DialogTitle>See how it plays</DialogTitle>
          <DialogDescription className="sr-only">Full size, as students see it.</DialogDescription>
          {big && <Revise written questions={questions} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
