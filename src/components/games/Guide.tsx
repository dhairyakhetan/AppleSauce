import type { ReactNode } from 'react';
import { MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_CHAPTER, MAX_PER_TOPIC, MIN_OPTIONS } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import './games.css';

/* "How to write your questions": the guide for people, at the bottom of Write questions. The same rules the checker
   applies and the chatbot prompt states (src/lib/games/prompt.ts), said for people; the limits come from the code, so
   they can't drift, and prompt.test.ts checks that the sample reads with no problems. */

const CODE = 'rounded-md bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground';

function Card({ title, span = 1, children }: { title: string; span?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <article className={cn('flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-border sm:p-6', span === 2 && 'lg:col-span-2', span === 3 && 'lg:col-span-3')}>
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      {children}
    </article>
  );
}

const B = ({ children }: { children: ReactNode }) => <b className="text-foreground">{children}</b>;
const C = ({ children }: { children: ReactNode }) => <code className={CODE}>{children}</code>;

export function Guide() {
  return (
    <section id="guide" tabIndex={-1} aria-labelledby="guide-h" className="scroll-mt-24 outline-none">
      <h2 id="guide-h" className="mb-4 text-lg font-bold text-foreground">How to write your questions</h2>
      <div className="grid grid-cols-1 gap-3 text-[14px] leading-relaxed text-warm-prose lg:grid-cols-3">
        <Card title="The format" span={2}>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li><B>Fill in Board, Class, Subject and Chapter,</B> then add a topic.</li>
            <li>
              <B>Write each question as a block of lines,</B> each starting with its label, with a blank line between questions:{' '}
              <C>Q:</C> the question, <C>A:</C> the answer, <C>Also:</C> another answer that counts (one per line, only if there is one),{' '}
              <C>Fill:</C> the same fact as a sentence with <C>___</C> where the answer goes, <C>Wrong:</C> {MIN_OPTIONS} wrong options separated by{' '}
              <C>;</C>, and <C>Level:</C> easy, medium or hard.
            </li>
            <li><B>True/False:</B> only <C>Q:</C> with a statement, and <C>A: True</C> or <C>A: False</C>.</li>
            <li><B>Fix every red or amber line,</B> then send. A question with a problem isn't sent.</li>
          </ol>
          <pre data-testid="guide-sample" className="mt-1 overflow-x-auto whitespace-pre rounded-xl bg-muted p-3 font-mono text-[13px] leading-relaxed text-foreground">{`Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations
Topic 2: Types of Chemical Reactions

Q: Reaction in which a single reactant breaks down into simpler products
A: Decomposition reaction
Also: Decomposition
Fill: A reaction in which a single reactant breaks down into simpler products is called a ___.
Wrong: Combination reaction; Displacement reaction; Neutralisation reaction
Level: easy

Q: Gas given off when zinc reacts with dilute sulphuric acid
A: Hydrogen
Also: H2
Fill: Zinc reacts with dilute sulphuric acid to give off ___ gas.
Wrong: Oxygen; Chlorine; Nitrogen
Level: medium

Q: Rusting of iron is a chemical change
A: True`}</pre>
        </Card>

        <Card title="Writing good questions">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li><B>One fact, one right answer.</B> The question makes sense on its own: no <i>this</i>, <i>the above</i>, <i>of the following</i>, figure or passage. It never contains its answer.</li>
            <li><B>The answer is exactly what a student types:</B> at most {MAX_ANSWER_WORDS} words, no brackets or notes. Units go in the question (<i>in degrees Celsius</i>).</li>
            <li><B>Also</B> lists every other answer that is just as right (at most {MAX_ALSO}): a short form (<C>CPU</C>), another name (<C>Calcutta</C>), a number in words (<C>Six</C>). Nothing else counts, but a small spelling slip gets half marks.</li>
            <li><B>Fill:</B> one <C>___</C> that stands for the whole answer; the rest of the sentence doesn't repeat it.</li>
            <li><B>Wrong options</B> ({MIN_OPTIONS} to {MAX_OPTIONS}): believable, and the same kind as the answer (a year for a year). Never <i>All of the above</i>.</li>
            <li><B>Any symbol is fine</B> in a question. If an answer needs one a keyboard doesn't have (<C>x²</C>), add an Also line typed with ordinary keys (<C>x^2</C>).</li>
            <li><B>At most {MAX_PER_TOPIC} questions per topic</B> and {MAX_PER_CHAPTER} per chapter, no two the same.</li>
          </ul>
        </Card>
      </div>
    </section>
  );
}
