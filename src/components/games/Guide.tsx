import type { ReactNode } from 'react';
import { MAX_ANSWER, MAX_QUESTION } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import './games.css';

/* "How to write your questions": the guide for people, at the bottom of Write questions. The format and what makes a
   good question, nothing more; the limits come from the code, so they can't drift. (Chatbots get their own
   instructions in the copied prompt, src/lib/games/prompt.ts.) */

const CODE = 'rounded-md bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground';

function Card({ title, span = 1, children }: { title: string; span?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <article className={cn('flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-border sm:p-6', span === 2 && 'lg:col-span-2', span === 3 && 'lg:col-span-3')}>
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      {children}
    </article>
  );
}

export function Guide() {
  return (
    <section id="guide" tabIndex={-1} aria-labelledby="guide-h" className="scroll-mt-24 outline-none">
      <h2 id="guide-h" className="mb-4 text-lg font-bold text-foreground">How to write your questions</h2>
      <div className="grid grid-cols-1 gap-3 text-[14px] leading-relaxed text-warm-prose lg:grid-cols-3">
        <Card title="The format" span={2}>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li><b className="text-foreground">Fill in Board, Class, Subject and Chapter.</b></li>
            <li><b className="text-foreground">Add a topic, then one question per line:</b> the question, a bar <code className={CODE}>|</code>, then the answer. To say how hard it is, add another bar and <i>easy</i>, <i>medium</i> or <i>hard</i>.</li>
            <li><b className="text-foreground">Multiple choice:</b> after the answer, add a bar and the wrong options, separated by <code className={CODE}>;</code>.</li>
            <li><b className="text-foreground">Fix anything underlined</b>, then send.</li>
          </ol>
          <pre data-testid="guide-sample" className="mt-1 overflow-x-auto whitespace-pre rounded-xl bg-muted p-3 font-mono text-[13px] leading-relaxed text-foreground">{`Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations
Topic 1: Chemical Equations
Law that requires a chemical equation to be balanced | Law of conservation of mass | medium
Equation with the same number of atoms of each element on both sides | Balanced equation
Topic 2: Types of Chemical Reactions
Reaction in which a single reactant breaks down into simpler products | Decomposition reaction | easy
Gas given off when zinc reacts with dilute sulphuric acid | Hydrogen | Oxygen; Chlorine; Nitrogen | medium`}</pre>
        </Card>

        <Card title="Writing good questions">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li><b className="text-foreground">One fact per question</b>, with exactly one correct answer.</li>
            <li><b className="text-foreground">Short answers:</b> a word, a short phrase or a number (at most {MAX_ANSWER} characters). Puzzles need them short, and crosswords and word searches need letters.</li>
            <li><b className="text-foreground">Questions that stand alone:</b> no <i>this</i>, <i>the above</i> or <i>as mentioned</i>. At most {MAX_QUESTION} characters.</li>
            <li><b className="text-foreground">Fill in the blank:</b> write <code className={CODE}>___</code> where the answer goes: <code className={CODE}>The ___ is the powerhouse of the cell | Mitochondria</code>.</li>
            <li><b className="text-foreground">No <code className={CODE}>|</code> inside</b> a question or answer: it separates them. Use <code className={CODE}>/</code>.</li>
            <li><b className="text-foreground">Optional words</b> go in square brackets: <code className={CODE}>Decomposition [reaction]</code>. A short form goes in round brackets after the answer: <code className={CODE}>Central Processing Unit (CPU)</code>.</li>
            <li><b className="text-foreground">No repeats:</b> the same question twice in a chapter is left out.</li>
          </ul>
        </Card>
      </div>
    </section>
  );
}
