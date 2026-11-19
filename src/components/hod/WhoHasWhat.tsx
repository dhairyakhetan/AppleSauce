import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { PaperStatusPill } from '@/components/PaperStatus';
import { EmptyNote, ago } from '@/components/hod/HodShared';
import { stageOfAssignment } from '@/lib/paper-status';
import { CHIP } from '@/lib/checker-button-styles';
import { paperLabel } from '@/lib/checker-progress';
import type { HodAssignment } from '@/lib/hod-api';
import { cn } from '@/lib/utils';
import {
  CHIPS,
  PAPERS_PAGE,
  PEOPLE_PAGE,
  SORTS,
  applyView,
  buildPeople,
  loadViewState,
  moreLabel,
  personLine,
  questionsLeftText,
  saveViewState,
  summarise,
  tabStorage,
  toggleChip,
  windowRows,
  type ChipKey,
  type IdlePerson,
  type PaperFlags,
  type PersonEntry,
  type SortKey,
} from '@/lib/who-has-what';

/* "Who has what", built for a long list: a summary line, a search, a sort, filter chips, one line per
   person (closed until opened), and one line per paper inside an opened person. The buttons that act on
   a paper (Take it myself, Move, Unassign) and "Why this paper?" / "Where this paper has been" appear only
   when a paper is opened. The actions themselves stay in AssignmentsTab and are handed in. */

const flagChip = 'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold';

function PersonFlags({ stuck, waiting }: { stuck: number; waiting: number }) {
  return (
    <>
      {stuck > 0 ? <span className={cn(flagChip, 'bg-destructive/10 text-destructive')}>{stuck} stuck</span> : null}
      {waiting > 0 ? <span className={cn(flagChip, 'bg-card text-warm-secondary shadow-button')}>{waiting} waiting for an HOD</span> : null}
    </>
  );
}

export function WhoHasWhat({
  scope,
  assignments,
  idle,
  reasonsOf,
  renderActions,
  renderMore,
}: {
  scope: string;
  assignments: HodAssignment[];
  idle: IdlePerson[];
  reasonsOf: (a: HodAssignment) => PaperFlags;
  /** Take it myself, Move to another verifier, Unassign. */
  renderActions: (a: HodAssignment) => ReactNode;
  /** "Why this paper?" and "Where this paper has been". */
  renderMore: (a: HodAssignment) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [chips, setChips] = useState<ChipKey[]>([]);
  const [remembered] = useState(() => loadViewState(tabStorage(), scope));
  const [sort, setSort] = useState<SortKey>(remembered.sort);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(remembered.expanded));
  const [searchClosed, setSearchClosed] = useState<Set<string>>(() => new Set());
  const [openPapers, setOpenPapers] = useState<Set<number>>(() => new Set());
  const [peopleShown, setPeopleShown] = useState(PEOPLE_PAGE);
  const [papersShown, setPapersShown] = useState<Record<string, number>>({});

  useEffect(() => saveViewState(tabStorage(), scope, { sort, expanded: [...expanded] }), [scope, sort, expanded]);
  useEffect(() => {
    setSearchClosed(new Set());
    setPeopleShown(PEOPLE_PAGE);
  }, [query, chips, sort]);

  // A few hundred rows at most: working the list out on every render is cheap, and only a page of it is drawn.
  const now = new Date();
  const everyone = buildPeople(assignments, idle, reasonsOf, now);
  const totals = summarise(everyone);
  const view = applyView(everyone, { query, chips, sort }, reasonsOf, now);
  const searching = query.trim().length > 0;
  const filtering = searching || chips.length > 0;
  const isOpen = (p: PersonEntry) => (searching ? !searchClosed.has(p.user_id) : expanded.has(p.user_id));
  const toggle = (id: string) => {
    const flip = (s: Set<string>) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    };
    if (searching) setSearchClosed(flip);
    else setExpanded(flip);
  };
  const { visible, hidden } = windowRows(view, peopleShown);
  const openable = view.filter((p) => !p.idle);

  if (everyone.length === 0) return <EmptyNote>No paper is assigned to anyone right now.</EmptyNote>;

  return (
    <div data-testid="who-has-what">
      <p role="status" aria-live="polite" className="mb-3 rounded-2xl bg-muted px-4 py-3 text-[14px] text-foreground" data-testid="who-summary">
        <span className="font-bold">{totals.holding}</span> {totals.holding === 1 ? 'person holds' : 'people hold'} <span className="font-bold">{totals.papers}</span>{' '}
        {totals.papers === 1 ? 'paper' : 'papers'} · <span className="font-bold">{totals.questionsLeft}</span> questions left
        {totals.people > totals.holding ? ` · ${totals.people - totals.holding} with no paper` : ''}
        {totals.stuck > 0 ? <span className="ml-2 font-semibold text-destructive">{totals.stuck} stuck</span> : null}
        {totals.waiting > 0 ? <span className="ml-2 font-semibold text-warm-secondary">{totals.waiting} waiting for an HOD</span> : null}
      </p>

      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search people or papers</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-meta" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a person, subject, class or school"
            className="min-h-11 w-full rounded-xl bg-muted pl-9 pr-3 text-[16px] sm:text-[14px] text-foreground outline-none placeholder:text-warm-meta focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-warm-secondary">
          <span className="shrink-0">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="min-h-11 min-w-0 flex-1 rounded-xl bg-muted px-3 text-[16px] sm:text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus sm:flex-none"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {CHIPS.map((c) => {
          const on = chips.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              title={c.hint}
              onClick={() => setChips((cur) => toggleChip(cur, c.key))}
              className={cn(CHIP, on ? 'bg-panel text-background' : 'bg-card text-foreground')}
            >
              {c.label}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className={cn(CHIP, 'bg-card text-foreground')} onClick={() => setExpanded(new Set(openable.map((p) => p.user_id)))}>
            Open all
          </button>
          <button type="button" className={cn(CHIP, 'bg-card text-foreground')} onClick={() => { setExpanded(new Set()); setSearchClosed(new Set(view.map((p) => p.user_id))); }}>
            Close all
          </button>
        </span>
      </div>

      {filtering ? (
        <p className="mb-2 text-[13px] text-warm-secondary" role="status" data-testid="who-showing">
          Showing {view.length} of {everyone.length} {everyone.length === 1 ? 'person' : 'people'}
        </p>
      ) : null}

      {view.length === 0 ? (
        <EmptyNote>No one matches. Clear the search or a filter.</EmptyNote>
      ) : (
        <ul className="space-y-2">
          {visible.map((p) => {
            const open = isOpen(p);
            const panel = `who-${p.user_id}`;
            if (p.idle) {
              return (
                <li key={p.user_id} className="rounded-[18px] bg-muted px-4 py-3 shadow-card" data-testid="verifier-load">
                  <p className="text-[15px] font-bold text-foreground">
                    {p.name} <span className="ml-1 text-[12px] font-normal text-warm-meta">{personLine(p).toLowerCase()}</span>
                  </p>
                  {p.why ? (
                    <p className="mt-0.5 text-[13px] text-warm-secondary" data-testid="idle-reason">
                      {p.why}
                    </p>
                  ) : null}
                </li>
              );
            }
            const page = papersShown[p.user_id] ?? PAPERS_PAGE;
            const shown = windowRows(p.papers, page);
            return (
              <li key={p.user_id} className="rounded-[18px] bg-muted shadow-card" data-testid="verifier-load">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panel}
                  onClick={() => toggle(p.user_id)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {open ? <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-warm-secondary" /> : <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-warm-secondary" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-foreground">{p.name}</span>
                    <span className="block text-[13px] text-warm-secondary">{personLine(p)}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <PersonFlags stuck={p.stuckCount} waiting={p.waitingCount} />
                  </span>
                </button>
                {open ? (
                  <div id={panel} className="px-2 pb-3">
                    <ul className="space-y-1.5">
                      {shown.visible.map((a) => {
                        const flags = reasonsOf(a);
                        const paperOpen = openPapers.has(a.assignment_id);
                        const detail = `who-paper-${a.assignment_id}`;
                        const togglePaper = () =>
                          setOpenPapers((s) => {
                            const next = new Set(s);
                            if (!next.delete(a.assignment_id)) next.add(a.assignment_id);
                            return next;
                          });
                        return (
                          <li key={a.assignment_id} className="rounded-2xl bg-card" data-testid="assignment-row">
                            <button
                              type="button"
                              aria-expanded={paperOpen}
                              aria-controls={detail}
                              onClick={togglePaper}
                              className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
                            >
                              {paperOpen ? <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-warm-secondary" /> : <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-warm-secondary" />}
                              <span className="min-w-0 flex-1">
                                <span className="block text-[14px] font-semibold text-foreground">{paperLabel(a)}</span>
                                <span className="block text-[12px] text-warm-meta">
                                  {questionsLeftText(a.remaining)}
                                  {a.assigned_at ? ` · given ${ago(a.assigned_at)}` : ''}
                                </span>
                              </span>
                              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {flags.stuck ? <span className={cn(flagChip, 'bg-destructive/10 text-destructive')}>Stuck</span> : null}
                                {flags.waiting ? <span className={cn(flagChip, 'bg-muted text-warm-secondary')}>Waiting for an HOD</span> : null}
                                <PaperStatusPill stage={stageOfAssignment()} />
                              </span>
                            </button>
                            {paperOpen ? (
                              <div id={detail} className="px-3 pb-3">
                                <p className="text-[12px] text-warm-meta">
                                  {!a.given_by_name || a.given_by_name === 'Automatic' ? 'Given automatically' : `Given by ${a.given_by_name}`}
                                </p>
                                {flags.stuck ? (
                                  <p className="mt-1 text-[13px] font-semibold text-destructive" data-testid="stuck-reason">
                                    {flags.stuck}
                                  </p>
                                ) : null}
                                {flags.waiting ? (
                                  <p className="mt-1 text-[13px] font-semibold text-warm-meta" data-testid="waiting-for-hod-reason">
                                    {flags.waiting}
                                  </p>
                                ) : null}
                                <div className="mt-2 flex flex-wrap items-center gap-2">{renderActions(a)}</div>
                                {renderMore(a)}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    {shown.hidden > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPapersShown((m) => ({ ...m, [p.user_id]: page + PAPERS_PAGE }))}
                        className={cn(CHIP, 'mt-2 bg-card text-foreground')}
                      >
                        {moreLabel(shown.hidden, PAPERS_PAGE)} papers
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 ? (
        <button type="button" onClick={() => setPeopleShown((n) => n + PEOPLE_PAGE)} className={cn(CHIP, 'mt-3 bg-card text-foreground')} data-testid="who-more">
          {moreLabel(hidden, PEOPLE_PAGE)} people ({hidden} not shown)
        </button>
      ) : null}
    </div>
  );
}
