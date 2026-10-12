import type { ReactNode } from 'react';
import { ALL_BOARDS, MAX_NAME, MAX_NO, SUBJECTS } from '@/lib/games/details';
import { MAX_ANSWER, MAX_QUESTION } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import './games.css';

/* "How to write your questions": the guide for people, at the bottom of Write questions. It teaches the one format
   only. The board and subject lists and the limits come from the code, so they can't drift. (Chatbots get their own
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
            <li><b className="text-foreground">Fill in Board, Class, Subject and Chapter.</b> They are written at the top of the Questions box for you, and you can edit them in either place.</li>
            <li><b className="text-foreground">Add a Topic line, then one question per line:</b> the question, a bar <code className={CODE}>|</code>, then the answer. To say how hard it is, add another bar and <i>easy</i>, <i>medium</i> or <i>hard</i>.</li>
            <li><b className="text-foreground">Fix anything underlined</b>, check the table and the game, then <b className="text-foreground">send it for approval</b> (or download it). Your HoD approves it on Approve questions; only approved questions are used in the games.</li>
          </ol>
          <pre data-testid="guide-sample" className="mt-1 overflow-x-auto whitespace-pre rounded-xl bg-muted p-3 font-mono text-[13px] leading-relaxed text-foreground">{`Board: CBSE
Class: 10
Subject: Science
Chapter 1: Chemical Reactions and Equations
Topic 1: Chemical Equations
Law that requires a chemical equation to be balanced | Law of conservation of mass | medium
Equation with the same number of atoms of each element on both sides | Balanced equation
Topic 2: Types of Chemical Reactions
Reaction in which a single reactant breaks down into simpler products | Decomposition reaction | easy`}</pre>
        </Card>

        <Card title="Detail lines">
          <p>Each one applies to every question below it, until it is changed.</p>
          <dl className="grid grid-cols-1 gap-1">
            <dt><code className={CODE}>Board: CBSE</code></dt>
            <dd className="mb-1 text-warm-secondary">CBSE, ICSE, ISC, IB, IGCSE, Cambridge, Edexcel, NIOS, a state board such as <i>Maharashtra</i>, or another board on the list.</dd>
            <dt><code className={CODE}>Class: 10</code></dt>
            <dd className="mb-1 text-warm-secondary">1 to 12.</dd>
            <dt><code className={CODE}>Subject: Chemistry</code></dt>
            <dd className="mb-1 text-warm-secondary">The textbook's subject, as in the list.</dd>
            <dt><code className={CODE}>Chapter 3: Acids, Bases and Salts</code></dt>
            <dd className="mb-1 text-warm-secondary">Number and name, as on the team's list of chapters. Once board, class and subject are filled in, the Chapter box offers the chapters on it.</dd>
            <dt><code className={CODE}>Topic 2: Indicators</code></dt>
            <dd className="text-warm-secondary">Number and name, as on the list for that chapter (press a topic under the boxes to add its line). Its questions go under it. A chapter with no topics on the list has no Topic lines.</dd>
          </dl>
          <p className="text-[13px] text-warm-secondary">Names are capitalised for you: <i>acids, bases and salts</i> becomes <i>Acids, Bases and Salts</i>. Questions and answers are never changed.</p>
        </Card>

        <Card title="Writing good questions">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li><b className="text-foreground">One fact per question</b>, with exactly one correct answer.</li>
            <li><b className="text-foreground">Short answers:</b> a word, a short phrase or a number (at most {MAX_ANSWER} characters). Puzzles need them short, and crosswords and word searches need letters.</li>
            <li><b className="text-foreground">Questions that stand alone:</b> no <i>this</i>, <i>the above</i> or <i>as mentioned</i>. At most {MAX_QUESTION} characters.</li>
            <li><b className="text-foreground">Fill in the blank:</b> write <code className={CODE}>___</code> where the answer goes: <code className={CODE}>The ___ is the powerhouse of the cell | Mitochondria</code>.</li>
            <li><b className="text-foreground">No <code className={CODE}>|</code> inside</b> a question or answer: it separates them. Use <code className={CODE}>/</code>.</li>
            <li><b className="text-foreground">No repeats:</b> the same question twice in a chapter is left out.</li>
          </ul>
        </Card>

        <Card title="Underlines and warnings">
          <p><span className="games-mark error">Red</span>: the line is <b className="text-foreground">left out</b>. It has no answer, no question, an empty part, too many parts, is too long, is a repeat, the class is not 1 to 12, the board or subject isn't on the site's list, or the chapter or topic isn't on the team's list under that name. Questions under a red line can't be sent.</p>
          <p><span className="games-mark warn">Amber</span>: the line is <b className="text-foreground">kept, but check it</b>. A chapter with no number or name, a topic with no questions, a detail set twice, or the same chapter number with two different names.</p>
          <p className="text-[13px] text-warm-secondary">You can write first: a line is only checked once you move on from it, and a box once you leave it or pause. Put the cursor on an underlined line to see why, or click a line number in the list.</p>
        </Card>

        <Card title="Chapter and topic IDs">
          <p>Every question gets the ID of its chapter and topic, made from the details, so the same chapter always gets the same ID:</p>
          <p className="flex flex-wrap gap-1" aria-label="CBSE, class 10, Science, chapter 1, topic 2">
            {[['CBSE', 'board'], ['10', 'class'], ['SCI', 'subject'], ['01', 'chapter'], ['T02', 'topic']].map(([v, k]) => (
              <span key={k} className="flex flex-col items-center rounded-xl bg-muted px-2.5 py-1.5 text-[11px] text-warm-secondary">
                <b className="font-mono text-[15px] text-foreground">{v}</b>{k}
              </span>
            ))}
          </p>
          <p className="text-[13px] text-warm-secondary">A question needs a board, class, subject and chapter number to get a chapter ID, and a topic number too for a topic ID. Chapter and topic numbers go up to {MAX_NO}; names up to {MAX_NAME} characters.</p>
          <details className="rounded-xl bg-muted px-3 py-2">
            <summary className="cursor-pointer font-semibold text-foreground">Board codes</summary>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{ALL_BOARDS.map((b) => <span key={b.code}><b className="font-mono">{b.code}</b> {b.name}</span>)}</p>
          </details>
          <details className="rounded-xl bg-muted px-3 py-2">
            <summary className="cursor-pointer font-semibold text-foreground">Subject codes</summary>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{SUBJECTS.map((s) => <span key={s.code}><b className="font-mono">{s.code}</b> {s.name}</span>)}</p>
            <p className="mt-2 text-[13px] text-warm-secondary">Only boards and subjects on these lists can be used. If yours is missing, tell a games admin.</p>
          </details>
        </Card>

        <Card title="Starting from notes" span={3}>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>Press <b className="text-foreground">Copy chatbot prompt</b>.</li>
            <li>Paste it into ChatGPT, Gemini or Claude, and add your notes, or just the class, subject and chapter.</li>
            <li>Paste its reply into the Questions box, and check the answers before you use them.</li>
          </ol>
        </Card>
      </div>
    </section>
  );
}
