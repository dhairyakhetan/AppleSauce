import { useEffect, useMemo, useState } from 'react';
import { Copy, Trash2, TriangleAlert } from 'lucide-react';
import type { GamesApi } from '@/lib/games/api';
import { changeCount, readBulk, readBulkRemove, toSave } from '@/lib/games/list-draft';
import { bulkPrompt } from '@/lib/games/prompt';
import type { AdminChapter } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, copyText, FIELD, plural } from './helpers';
import { ActionIcon } from './shared';

/* Bulk add, at the bottom of the Chapters page: chapters for any boards, classes and subjects at once, pasted from
   anywhere or from a chatbot's reply. It is read as it is typed (readBulk): what it would add is shown, marked New, with
   every problem on its line. "Save changes" saves all the subjects in it together, or none of them
   (games.admin_save_chapters with a list).
   Its other mode, Bulk remove (the red button), takes the same lines and deletes the chapters named, or every chapter of a
   subject with none under it (readBulkRemove), skipping those with questions; it is red throughout and asks twice. */

const EXAMPLE = 'Board: ICSE\nClass: 9\nSubject: Physics\n1. Measurements and Experimentation\n2. Motion in One Dimension\n- Distance and Displacement\n- Speed and Velocity';

export function BulkAdd({ api, list, blocked, onSaved }: {
  api: GamesApi;
  /** The whole list, as loaded. */
  list: AdminChapter[];
  /** The list above has changes not saved yet: saving here would drop them, so it waits. */
  blocked: boolean;
  onSaved: (changes: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [text, setText] = useState('');
  /** Bulk remove's own text: a list written to add chapters is never read as chapters to delete. */
  const [removeText, setRemoveText] = useState('');
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

  const switchTo = (m: 'add' | 'remove') => { setMode(m); setError(''); };
  if (mode === 'remove') return <BulkRemove api={api} list={list} blocked={blocked} onSaved={onSaved} text={removeText} setText={setRemoveText} onBack={() => switchTo('add')} />;

  return (
    <section aria-labelledby="bulk-h" className="mt-4 flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bulk-h" className="text-[15px] font-bold text-foreground">Bulk add</h2>
        <button type="button" className={btn('card', 'text-destructive ring-1 ring-destructive/40 hover:bg-destructive hover:text-destructive-foreground')} onClick={() => switchTo('remove')}>
          <Trash2 aria-hidden />Switch to Bulk remove
        </button>
      </div>
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

const REMOVE_EXAMPLE = 'Board: CBSE\nClass: 9\nSubject: Mathematics\n(no chapters under it: removes them all)\n\nBoard: CBSE\nClass: 10\nSubject: Science\n4\nHeat\n7. Life Processes';

/** Bulk add's other mode: red throughout, removes chapters, asks twice. */
function BulkRemove({ api, list, blocked, onSaved, text, setText, onBack }: {
  api: GamesApi; list: AdminChapter[]; blocked: boolean; onSaved: (changes: number) => Promise<void>;
  text: string; setText: (t: string) => void; onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** The first press arms the button; the second removes. Any change to the text or the list disarms it. */
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [text, list]); // and any change to the list (a save above may renumber chapters)

  const read = useMemo(() => readBulkRemove(text, list), [text, list]);
  const groups = read.groups.filter((g) => g.removed.length > 0);
  const kept = read.groups.reduce((n, g) => n + g.kept.length, 0);
  const total = groups.reduce((n, g) => n + g.removed.length, 0);
  const tooMany = groups.length > 200;

  const remove = async () => {
    if (!armed) { setArmed(true); return; }
    setSaving(true);
    setError('');
    try {
      const r = await api.saveChapters(groups.map((g) => toSave(g.group, g.loaded, g.draft)));
      setText('');
      setArmed(false);
      await onSaved(r.changes);
    } catch (e) {
      setError((e as Error).message);
      setArmed(false); // a failed delete asks twice again
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="bulk-h" className="mt-4 flex flex-col gap-3 rounded-[24px] bg-destructive/10 p-4 ring-2 ring-destructive sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bulk-h" className="flex items-center gap-2 text-[15px] font-bold text-destructive"><Trash2 aria-hidden className="size-5" />Bulk remove</h2>
        <button type="button" className={btn('card')} disabled={saving} onClick={onBack}>Back to Bulk add</button>
      </div>
      <p role="note" className="flex items-start gap-2 rounded-[18px] bg-destructive px-4 py-3 text-[14px] font-semibold text-destructive-foreground">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        <span>This deletes chapters from the list, for everyone. Chapters with questions can't be deleted and are skipped. Check the list below before you remove anything.</span>
      </p>
      <ul id="bulk-how" className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] text-foreground marker:text-destructive">
        <li><b>Board:</b>, <b>Class:</b> and <b>Subject:</b> lines, as in Bulk add, then the chapters to remove, by number, name or both (<b>4</b>, <b>Heat</b>, <b>4. Heat</b>).</li>
        <li>A subject with <b>no chapters under it</b> loses <b>all</b> its chapters.</li>
        <li>Nothing is removed until you press the red button twice.</li>
      </ul>

      <label htmlFor="bulk-text" className="text-[12px] font-semibold text-destructive">Chapters to remove</label>
      <textarea id="bulk-text" aria-describedby="bulk-how" rows={8} value={text} spellCheck={false} placeholder={REMOVE_EXAMPLE} disabled={saving}
        onChange={(e) => { setText(e.target.value); setError(''); }}
        className={cn(FIELD, 'min-h-[180px] py-2 font-mono text-[14px] ring-2 ring-destructive focus-visible:ring-destructive sm:text-[14px]')} />

      {read.problems.length > 0 && (
        <ul role="alert" aria-label="Lines to fix" className="flex flex-col gap-1 rounded-[18px] bg-card px-4 py-3 text-[13px]">
          {read.problems.slice(0, 30).map((p) => <li key={p.line}><b className="text-destructive">Line {p.line}:</b> {p.text}</li>)}
          {read.problems.length > 30 && <li className="text-warm-secondary">and {plural(read.problems.length - 30, 'more line')}.</li>}
        </ul>
      )}

      {read.groups.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="To be removed">
          {read.groups.map((g) => (
            <div key={`${g.group.board}|${g.group.class}|${g.group.subject}`} className="flex flex-col gap-1.5 rounded-[18px] bg-card px-4 py-3 ring-1 ring-destructive/40">
              <p className="text-[14px] font-semibold text-foreground">
                {g.group.board} class {g.group.class} {g.group.subject}
                <span className="font-normal tabular-nums">
                  {' · '}<span className="font-semibold text-destructive">{plural(g.removed.length, 'chapter')} to remove</span>
                  {g.removed.length === g.loaded.length && g.removed.length > 0 && <span className="text-destructive"> (all of them)</span>}
                  {g.kept.length > 0 && <span className="text-warm-meta">{` · ${g.kept.length} kept`}</span>}
                </span>
              </p>
              <ul className="flex flex-col gap-1 text-[13px] text-foreground">
                {g.removed.map((c) => (
                  <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="inline-flex min-h-6 items-center rounded-full bg-destructive px-2 text-[12px] font-semibold text-destructive-foreground">Remove</span>
                    <span className="tabular-nums line-through decoration-destructive">{c.chapter_no}. {c.name}</span>
                  </li>
                ))}
                {g.kept.map((c) => (
                  <li key={`k${c.chapter_no}`} className="text-warm-secondary">
                    <span className="tabular-nums">{c.chapter_no}.</span> {c.name} · has {plural(c.questions, 'question')}, so it stays
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {text.trim() && !read.problems.length && !total && (
        <p className="text-[13px] text-warm-secondary" role="status">{kept ? 'Everything named here has questions, so nothing can be removed.' : 'Nothing to remove yet: write Board, Class and Subject lines, then the chapters.'}</p>
      )}

      {total > 0 && !read.problems.length && (
        <div className="sticky bottom-4 z-30 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
          <div role="region" aria-label="Bulk remove not saved yet"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[28px] bg-destructive px-4 py-3 text-destructive-foreground shadow-[0_18px_44px_rgba(0,0,0,.28)] sm:px-5">
            <div className="min-w-[180px] flex-1">
              <p className="text-[14px] font-semibold tabular-nums">{plural(total, 'chapter')} will be deleted</p>
              <p className="text-[12px] opacity-90">
                {blocked ? 'Save or revert the changes in the list above first.' : tooMany ? 'At most 200 subjects at once: split the text.' : armed ? 'Press again to delete them for good.' : `In ${plural(groups.length, 'subject')}, all together.${kept ? ` ${kept} with questions stay.` : ''}`}
              </p>
              {error && <p role="alert" className="mt-1 text-[13px] font-semibold">{error}</p>}
            </div>
            <button type="button" className={btn('card')} disabled={saving} onClick={() => { if (armed) setArmed(false); else { setText(''); setError(''); } }}>{armed ? 'Cancel' : 'Clear'}</button>
            <button type="button" disabled={saving || blocked || tooMany} onClick={() => void remove()}
              className={btn('card', cn('font-bold text-destructive ring-2 ring-destructive-foreground', armed && 'bg-panel text-destructive-foreground'))}>
              <Trash2 aria-hidden />{saving ? 'Deleting' : armed ? `Yes, delete ${plural(total, 'chapter')}` : `Delete ${plural(total, 'chapter')}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

