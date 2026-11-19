import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import type { GamesApi } from '@/lib/games/api';
import { changeCount, readBulk, toSave } from '@/lib/games/list-draft';
import { bulkPrompt } from '@/lib/games/prompt';
import type { AdminChapter } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, copyText, FIELD, plural } from './helpers';
import { ActionIcon } from './shared';

/* Bulk add, at the bottom of the Chapters page: chapters for any boards, classes and subjects at once, pasted from
   anywhere or from a chatbot's reply. It is read as it is typed (readBulk): what it would add is shown, marked New, with
   every problem on its line. "Save changes" saves all the subjects in it together, or none of them
   (games.admin_save_chapters with a list). */

const EXAMPLE = 'Board: ICSE\nClass: 9\nSubject: Physics\n1. Measurements and Experimentation\n2. Motion in One Dimension\n- Distance and Displacement\n- Speed and Velocity';

export function BulkAdd({ api, list, blocked, onSaved }: {
  api: GamesApi;
  /** The whole list, as loaded. */
  list: AdminChapter[];
  /** The list above has changes not saved yet: saving here would drop them, so it waits. */
  blocked: boolean;
  onSaved: (changes: number) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const read = useMemo(() => readBulk(text, list), [text, list]);
  const groups = read.groups.filter((g) => g.chapters + g.topics > 0);
  const changes = groups.reduce((n, g) => n + changeCount(g.draft), 0);
  const already = read.groups.reduce((n, g) => n + g.already, 0);

  const copy = async () => {
    if (!(await copyText(bulkPrompt()))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await api.saveChapters(groups.map((g) => toSave(g.group, g.loaded, g.draft)));
      setText('');
      await onSaved(r.changes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="bulk-h" className="mt-4 flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
      <h2 id="bulk-h" className="text-[15px] font-bold text-foreground">Bulk add</h2>
      <ul id="bulk-how" className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] text-warm-secondary marker:text-warm-meta">
        <li>Start with <b className="text-foreground">Board:</b>, <b className="text-foreground">Class:</b> and <b className="text-foreground">Subject:</b> lines, then one chapter per line, like <b className="text-foreground">4. Heat</b>. The number is optional.</li>
        <li>A line starting with <b className="text-foreground">-</b> under a chapter adds a topic to it.</li>
        <li>Chapters already on the list are skipped. Nothing is kept until you save.</li>
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className={btn('card', 'w-fit')} onClick={() => void copy()}>
          <ActionIcon done={copied}><Copy /></ActionIcon>Copy chatbot prompt
        </button>
        <span className="text-[13px] text-warm-secondary">Paste it into ChatGPT, Gemini or Claude, say which boards, classes and subjects, then paste its reply below.</span>
        <span className="sr-only" aria-live="polite">{copied ? 'Prompt copied.' : ''}</span>
      </div>

      <label htmlFor="bulk-text" className="text-[12px] font-semibold text-warm-secondary">Chapters to add</label>
      <textarea id="bulk-text" aria-describedby="bulk-how" rows={8} value={text} spellCheck={false} placeholder={EXAMPLE} disabled={saving}
        onChange={(e) => { setText(e.target.value); setError(''); }}
        className={cn(FIELD, 'min-h-[180px] py-2 font-mono text-[14px] sm:text-[14px]')} />

      {read.problems.length > 0 && (
        <ul role="alert" aria-label="Lines to fix" className="flex flex-col gap-1 rounded-[18px] bg-card px-4 py-3 text-[13px]">
          {read.problems.slice(0, 30).map((p) => <li key={p.line}><b className="text-destructive">Line {p.line}:</b> {p.text}</li>)}
          {read.problems.length > 30 && <li className="text-warm-secondary">and {plural(read.problems.length - 30, 'more line')}.</li>}
        </ul>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="To be added">
          {groups.map((g) => {
            const fresh = g.draft.filter((c) => !c.was);
            const grown = g.draft.filter((c) => c.was && c.topics.some((t) => t.was === null));
            return (
              <div key={`${g.group.board}|${g.group.class}|${g.group.subject}`} className="flex flex-col gap-1.5 rounded-[18px] bg-card px-4 py-3">
                <p className="text-[14px] font-semibold text-foreground">
                  {g.group.board} class {g.group.class} {g.group.subject}
                  <span className="font-normal text-warm-meta tabular-nums">
                    {' · '}{[g.chapters && plural(g.chapters, 'new chapter'), g.topics && plural(g.topics, 'new topic')].filter(Boolean).join(', ')}
                    {g.already ? ` · ${g.already} already on the list` : ''}
                  </span>
                </p>
                <ul className="flex flex-col gap-1 text-[13px] text-foreground">
                  {fresh.map((c) => (
                    <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="inline-flex min-h-6 items-center rounded-full bg-mint px-2 text-[12px] font-semibold ring-1 ring-border">New</span>
                      <span className="tabular-nums">{c.chapter_no}.</span> {c.name}
                      {c.topics.length > 0 && <span className="text-warm-secondary">· {c.topics.map((t) => `${t.topic_no} ${t.name}`).join(', ')}</span>}
                    </li>
                  ))}
                  {grown.map((c) => (
                    <li key={c.key}>
                      <span className="tabular-nums">{c.chapter_no}.</span> {c.name}
                      <span className="text-warm-secondary"> · new topics: {c.topics.filter((t) => t.was === null).map((t) => `${t.topic_no} ${t.name}`).join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {text.trim() && !read.problems.length && !groups.length && (
        <p className="text-[13px] text-warm-secondary" role="status">{already ? 'Everything here is on the list already.' : 'Nothing to add yet: write Board, Class and Subject lines, then the chapters.'}</p>
      )}

      {changes > 0 && !read.problems.length && (
        <div className="sticky bottom-4 z-30 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
          <div role="region" aria-label="Bulk add not saved yet"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[28px] bg-panel px-4 py-3 text-background shadow-[0_18px_44px_rgba(0,0,0,.28)] sm:px-5">
            <div className="min-w-[180px] flex-1">
              <p className="text-[14px] font-semibold tabular-nums">{plural(changes, 'change')} not saved yet</p>
              <p className="text-[12px] opacity-70">{blocked ? 'Save or revert the changes in the list above first.' : `In ${plural(groups.length, 'subject')}, saved together.`}</p>
              {error && <p role="alert" className="mt-1 text-[13px] font-semibold text-brand">{error}</p>}
            </div>
            <button type="button" className={btn('quiet')} disabled={saving} onClick={() => { setText(''); setError(''); }}>Clear</button>
            <button type="button" className={btn('brand')} disabled={saving || blocked} onClick={() => void save()}>{saving ? 'Saving' : 'Save changes'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
