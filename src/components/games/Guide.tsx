import type { ReactNode } from 'react';
import { MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_CHAPTER, MAX_PER_TOPIC, MIN_OPTIONS } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import { lineKind } from './helpers';
import { Coloured } from './shared';
import './games.css';

/* "How to write your questions": the guide for people, at the bottom of Write questions. The same rules the checker
   applies and the chatbot prompt states (src/lib/games/prompt.ts), said for people; the limits come from the code, so
   they can't drift, and prompt.test.ts checks that the sample reads with no problems. */

/** The example: the checker reads it with no problems (prompt.test.ts). */
const SAMPLE = `Board: CBSE
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
A: True
Level: easy`;

const CODE = 'rounded-md bg-muted px-1 py-0.5 font-mono text-[13px]';

function Card({ title, span = 1, children }: { title: string; span?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <article className={cn('flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-border sm:p-6', span === 2 && 'lg:col-span-2', span === 3 && 'lg:col-span-3')}>
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      {children}
    </article>
  );
}

const B = ({ children }: { children: ReactNode }) => <b className="text-foreground">{children}</b>;
/** Text as written in the Questions box; a label ("Q:", "A: True", "Topic") in that line's colour there. */
const C = ({ children }: { children: ReactNode }) => {
  const kind = typeof children === 'string' ? lineKind(/:/.test(children) ? children : `${children}: x`) : null;
  return <code className={cn(CODE, kind ? `gl-${kind}` : 'text-foreground')}>{children}</code>;
};

export function Guide() {
  return (
    <section id="guide" tabIndex={-1} aria-labelledby="guide-h" className="scroll-mt-24 outline-none">
      <h2 id="guide-h" className="mb-4 text-lg font-bold text-foreground">How to write your questions</h2>
      <div className="grid grid-cols-1 gap-3 text-[14px] leading-relaxed text-warm-prose lg:grid-cols-3">
        <Card title="The format" span={2}>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li><B>Choose Board, Class, Subject and Chapter</B> in the boxes above the Questions box (they go in as its first lines), then put a <C>Topic</C> line above each part's questions: press one of the chapter's topic buttons, or, when the list leaves the topics open, write your own, numbered from 1.</li>
            <li>
              <B>Write each question as a block of lines,</B> each starting with its label, with a blank line between questions:{' '}
              <C>Q:</C> the question, <C>A:</C> the answer, <C>Also:</C> another answer that counts (one per line, only if there is one),{' '}
              <C>Fill:</C> the same fact as a sentence with <C>___</C> where the answer goes, <C>Wrong:</C> {MIN_OPTIONS} wrong options separated by{' '}
              <C>;</C>, and <C>Level:</C> easy, medium or hard.
            </li>
            <li><B>True/False:</B> only <C>Q:</C> with a statement, <C>A: True</C> or <C>A: False</C>, and <C>Level:</C>.</li>
            <li><B>Fix every red or amber line,</B> then send. A question with a problem isn't sent.</li>
          </ol>
          <p>
            <B>The box tidies small things for you</B> a second after you stop typing: capitals in labels and in Board, Class and
            Subject (<C>cbse</C> becomes <C>CBSE</C>), the chapter's and topics' names as the list writes them, <C>;</C> for
            commas in a Wrong line, and a blank line before each question. It never changes the words of a question or an
            answer, and Ctrl+Z undoes it. If you delete a chapter line, it comes back at the top once you move on. Each kind of
            line has its own colour, and Clear removes the questions but keeps the chapter lines.
          </p>
          <pre data-testid="guide-sample" className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-[13px] leading-relaxed"><Coloured text={SAMPLE} /></pre>
        </Card>

        <Card title="Writing good questions">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li><B>One fact, one right answer.</B> The question makes sense on its own: no "this", "the above", "of the following", figure or passage. It never contains its answer.</li>
            <li><B>The answer is exactly what a student types:</B> at most {MAX_ANSWER_WORDS} words, no brackets or notes. Units go in the question ("in degrees Celsius").</li>
            <li><B>Also</B> lists every other answer that is just as right (at most {MAX_ALSO}): a short form (<C>CPU</C>), another name (<C>Calcutta</C>), a number in words (<C>Six</C>). Nothing else counts, but a small spelling slip gets half marks.</li>
            <li><B>Fill:</B> one <C>___</C> that stands for the whole answer; the rest of the sentence doesn't repeat it. Read it with the answer in the gap: "becomes ___" takes "One-fourth", not "Becomes one-fourth".</li>
            <li><B>Wrong options</B> ({MIN_OPTIONS} to {MAX_OPTIONS}): believable, and the same kind as the answer (a year for a year). Never "All of the above".</li>
            <li><B>Any symbol is fine</B> in a question. If an answer needs one a keyboard doesn't have (<C>x²</C>), add an Also line typed with ordinary keys (<C>x^2</C>).</li>
            <li><B>At most {MAX_PER_TOPIC} questions per topic</B> and {MAX_PER_CHAPTER} per chapter, no two the same.</li>
          </ul>
        </Card>

        <Card title="Writing them with a chatbot" span={3}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li><B>Copy chatbot prompt</B> gives ChatGPT, Gemini or Claude your chapter, its topics and a link to Shikshaq's rules. Add your notes at the end of it.</li>
            <li><B>Your notes come first.</B> The chatbot checks them against the chapter before it writes anything: if part of them is from another chapter, or says something the textbook doesn't, it asks you whether to use it, leave it out or correct it, and waits for your answer.</li>
            <li><B>Its reply says where the facts came from</B> on a line starting <C>Source:</C> after its questions: your notes, or its general knowledge of the textbook. Check facts that come from general knowledge before you send them.</li>
            <li><B>Paste its whole reply</B> into the Questions box. The page reads only the questions and leaves out the chatbot's own sentences.</li>
          </ul>
        </Card>
      </div>
    </section>
  );
}
