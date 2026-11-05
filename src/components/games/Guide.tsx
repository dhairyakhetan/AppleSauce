import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_SEND, MAX_PER_TOPIC, MAX_QUESTION, MIN_OPTIONS } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import './games.css';

/* "How to write a good question", at the bottom of Write questions: for people, not chatbots. The Topic line and one
   question taken apart line by line, a whole example, the usual mistakes each shown wrong and then right with why, and the limits. The same
   rules the checker applies and the chatbot prompt states (src/lib/games/prompt.ts); the numbers come from the code, and
   prompt.test.ts checks that the example reads with no problems. */

const CODE = 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground';
const C = ({ children }: { children: ReactNode }) => <code className={CODE}>{children}</code>;

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <article className={cn('flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-border sm:p-6', className)}>
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      {children}
    </article>
  );
}

/** The lines of a question: the label, what to write, when it is needed, and an example. */
const LINES: { label: string; what: ReactNode; when: string; eg: string }[] = [
  { label: 'Topic:', what: <>Above each topic's questions: the part of the chapter they are about, by its name. A chatbot decides how many topics; the page numbers them.</>, when: 'Above each topic', eg: 'Transfer of Heat' },
  { label: 'Q:', what: <>The question, or a clue. It asks about <b>one fact</b> with <b>one right answer</b>, and makes sense on its own.</>, when: 'Always', eg: 'Gas that green plants take in to make their food' },
  { label: 'A:', what: <>The answer, <b>exactly as a student would type it</b>: a word, a name or a short phrase. Up to {MAX_ANSWER_WORDS} words.</>, when: 'Always', eg: 'Carbon dioxide' },
  { label: 'Fill:', what: <>The same fact as a sentence, with <C>___</C> (three underscores) where the answer goes.</>, when: 'Always *', eg: 'Green plants take in ___ to make their food.' },
  { label: 'Wrong:', what: <>{MIN_OPTIONS} wrong answers that sound believable, separated by <C>;</C>. They are the other choices in multiple choice.</>, when: 'Always *', eg: 'Oxygen; Nitrogen; Hydrogen' },
  { label: 'Also:', what: <>Another answer that is <b>just as right</b>: a short form, another name, a number in words. One per line.</>, when: 'Only if there is one', eg: 'CO2' },
  { label: 'Level:', what: <>easy (remembering a fact), medium (understanding it) or hard (using it).</>, when: 'If you like', eg: 'easy' },
];

/** The usual mistakes: what was written, what to write instead, and why. */
const MISTAKES: { bad: string; good: string; why: string }[] = [
  { bad: 'Q: Which of the following is a noble gas?', good: 'Q: Noble gas used in glowing advertising signs', why: 'Most games show no options, so "of the following" points at nothing.' },
  { bad: 'Q: Photosynthesis is how plants make food. What is it called?', good: 'Q: Process by which green plants make food using sunlight', why: 'The question must not give the answer away.' },
  { bad: 'A: Carbon dioxide (CO2)', good: 'A: Carbon dioxide\nAlso: CO2', why: 'Students would have to type the brackets too. Another right answer goes on an Also: line.' },
  { bad: 'Q: Boiling point of water\nA: 100 °C', good: 'Q: Boiling point of water, in degrees Celsius\nA: 100', why: 'Most keyboards can\'t type °. The unit goes in the question.' },
  { bad: 'A: It is the gas that plants give out in sunlight', good: 'A: Oxygen', why: `Answers are typed into a crossword or a box: up to ${MAX_ANSWER_WORDS} words, never a sentence.` },
  { bad: 'Wrong: All of the above; None of these; Both a and b', good: 'Wrong: Oxygen; Nitrogen; Hydrogen', why: 'The choices are shuffled, so these make no sense. Write real wrong answers.' },
  { bad: 'Fill: Plants take in carbon dioxide from the air.', good: 'Fill: Plants take in ___ from the air.', why: 'The ___ marks the gap a student fills in.' },
  { bad: 'Q: Is the Sun a star?\nA: Yes', good: 'Q: The Sun is a star\nA: True', why: 'Yes or No can\'t be an answer: write a statement, and True or False.' },
  { bad: 'Topic 1: MCQs', good: 'Topic: Transfer of Heat', why: 'A topic is a part of the chapter, named as the textbook names it: not a kind of question. No number needed.' },
];

export function Guide() {
  return (
    <section id="guide" tabIndex={-1} aria-labelledby="guide-h" className="scroll-mt-24 outline-none">
      <h2 id="guide-h" className="text-lg font-bold text-foreground">How to write a good question</h2>
      <p className="mb-4 mt-1 max-w-prose text-[14px] text-warm-prose">
        The questions are grouped under Topic lines, and each question is a short block of lines, every line starting with a label.
        Leave a blank line between questions. A chatbot given the prompt from step 2 writes them this way; this is what to check, or
        to follow when you write your own.
      </p>

      <div className="grid grid-cols-1 gap-3 text-[14px] leading-relaxed text-warm-prose lg:grid-cols-5">
        <Card title="Each line, and what to write" className="lg:col-span-3">
          <dl className="flex flex-col divide-y divide-border">
            {LINES.map((l) => (
              <div key={l.label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <dt className="pt-0.5"><span className="inline-block rounded-md bg-panel px-1.5 py-0.5 font-mono text-[13px] font-bold text-background">{l.label}</span></dt>
                <dd className="flex min-w-0 flex-col gap-1">
                  <span>{l.what} <span className="whitespace-nowrap text-[12px] font-semibold text-warm-meta">({l.when})</span></span>
                  <span className="break-words font-mono text-[13px] text-foreground">{l.label} {l.eg}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-warm-secondary">* Not for a True or False question: that has only <C>Q:</C>, a statement, and <C>A: True</C> or <C>A: False</C>.</p>
        </Card>

        <Card title="A whole example" className="lg:col-span-2">
          <p>Two topics, as the box takes them:</p>
          <pre data-testid="guide-sample" className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-[13px] leading-relaxed text-foreground">{`Topic: Photosynthesis

Q: Gas that green plants take in to make their food
A: Carbon dioxide
Also: CO2
Fill: Green plants take in ___ to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen
Level: easy

Topic: Transpiration

Q: Tiny pores on leaves through which water vapour escapes
A: Stomata
Fill: Water vapour escapes from leaves through tiny pores called ___.
Wrong: Xylem; Phloem; Root hairs
Level: easy

Q: Transpiration helps pull water up from the roots
A: True`}</pre>
        </Card>

        <Card title="Common mistakes, and what to write instead" className="lg:col-span-5">
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {MISTAKES.map((m) => (
              <li key={m.bad} className="flex flex-col gap-1.5 rounded-xl bg-muted p-3">
                <p className="flex items-start gap-2"><X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Not this" />
                  <span className="whitespace-pre-wrap break-words font-mono text-[13px] text-foreground line-through decoration-destructive/60">{m.bad}</span></p>
                <p className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-subtle-text" aria-label="This" />
                  <span className="whitespace-pre-wrap break-words font-mono text-[13px] text-foreground">{m.good}</span></p>
                <p className="pl-6 text-[13px] text-warm-secondary">{m.why}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="The limits" className="lg:col-span-2">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>An answer: up to {MAX_ANSWER_WORDS} words.</li>
            <li>Wrong answers: {MIN_OPTIONS} to {MAX_OPTIONS}.</li>
            <li>Also lines: up to {MAX_ALSO}.</li>
            <li>A question: up to {MAX_QUESTION} characters, on one line.</li>
            <li>A topic: up to {MAX_PER_TOPIC} questions.</li>
            <li>One send: up to {MAX_PER_SEND} questions, all from one chapter.</li>
          </ul>
        </Card>

        <Card title="When something needs fixing" className="lg:col-span-3">
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>The list beside the box says what is wrong with each question, and the line is marked red in the box.</li>
            <li>Fix it in the box yourself, or press <b>Copy a prompt to fix them</b> in step 4.</li>
            <li>Paste that prompt into the same chat, then paste the chatbot's whole answer over the text in the box.</li>
            <li>You can send the ready questions first: the ones to fix stay in the box.</li>
          </ol>
        </Card>
      </div>
    </section>
  );
}
