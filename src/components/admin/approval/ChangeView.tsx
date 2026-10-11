import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  TEXT_FIELDS,
  fieldLabel,
  shortChangeWords,
  valueWords,
  wordDiff,
  type FieldChange,
} from '@/lib/history-labels';

/* Before and after, as a person reads it: the visible text with the old words
   struck through and the new words highlighted. Never json. Question text is
   shown exactly as stored, so a diff shows the raw characters, not a render. */

export function WordDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className={cn('whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-foreground', className)}>
      {parts.map((p, i) =>
        p.kind === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === 'removed' ? (
          <del key={i} className="rounded-[2px] bg-[#F9E2E2] text-[#8C2A2A] decoration-[#8C2A2A]">
            <span className="sr-only">removed: </span>
            {p.text}
          </del>
        ) : (
          <ins key={i} className="rounded-[2px] bg-mint font-semibold text-[#24603D] no-underline">
            <span className="sr-only">added: </span>
            {p.text}
          </ins>
        ),
      )}
    </p>
  );
}

function textOf(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v) && v.length === 0) return '';
  return valueWords(field, v);
}

export function ChangeView({ change }: { change: FieldChange }) {
  if (TEXT_FIELDS.has(change.field)) {
    return (
      <div className="rounded-[12px] bg-card px-3 py-2">
        <p className="mb-1 text-[12px] font-semibold text-warm-label">
          {fieldLabel(change.field).replace(/^the /, '').replace(/^\w/, (c) => c.toUpperCase())}
        </p>
        <WordDiff before={textOf(change.field, change.before)} after={textOf(change.field, change.after)} />
      </div>
    );
  }
  const words = shortChangeWords(change);
  return (
    <p className="rounded-[12px] bg-card px-3 py-2 text-[14px] text-foreground">
      {words.charAt(0).toUpperCase() + words.slice(1)}
    </p>
  );
}

export function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (!changes.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {changes.map((c, i) => (
        <ChangeView key={`${c.field}-${i}`} change={c} />
      ))}
    </div>
  );
}
