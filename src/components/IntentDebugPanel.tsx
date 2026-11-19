/* The intent index, made inspectable.
 *
 * An adaptive system that cannot explain itself is not debuggable, it is just
 * unpredictable. This panel is the thing that makes the rest of the work safe
 * to trust: it shows every slot and where it came from, the stage and what put
 * it there, the confidence and each term that built it, and which experience
 * won and why.
 *
 * Gated on PREVIEW_TOOLS, the same build-time constant that already keeps
 * PreviewRoleToggle out of the live bundle. `import.meta.env.VITE_PREVIEW_TOOLS`
 * is inlined by Vite, the comparison folds to false, and everything below is
 * dropped by tree-shaking. Verify after a live build:
 *
 *   grep -r IntentDebugPanel dist/assets/*.js    -> nothing
 *
 * Bottom-RIGHT, because PreviewRoleToggle already owns bottom-left.
 */

import { useState } from 'react';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { useIntent } from '@/lib/intent-context';
import { adaptationLevel, THRESHOLD } from '@/lib/intent/guardrails';
import { readSession, readStore, resetAll } from '@/lib/intent/store';
import { FACET_SLOT_KEYS } from '@/lib/intent/types';
import type { FacetSlotKey, Slot } from '@/lib/intent/types';
import {
  MIN_SUPPORT,
  modelStats,
  predictNextSlot,
  predictSlotValue,
  resetModel,
} from '@/lib/intent/predict';

function age(at: number): string {
  if (!at) return 'never';
  const ms = Date.now() - at;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const SOURCE_COLOUR: Record<string, string> = {
  explicit: '#34B268',
  derived: '#4351FF',
  inferred: '#A39A90',
};

const SLOT_LABEL: Record<FacetSlotKey, string> = {
  subject: 'subject',
  classLevel: 'class',
  area: 'area',
  board: 'board',
  classSize: 'size',
  teachingMode: 'online',
  placeOfTeaching: 'place',
  school: 'school',
  examType: 'exam',
  experience: 'exp',
};

function SlotRow({ name, slot }: { name: string; slot: Slot<string> }) {
  /* Shows the whole list, not just the primary: a slot holding
     Maths + Physics is the case most worth being able to see. */
  const extra = slot.values.length > 1 ? ` +${slot.values.length - 1}` : '';
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', lineHeight: 1.5 }}>
      <span style={{ width: 54, opacity: 0.55 }}>{name}</span>
      <span style={{ fontWeight: 600, flex: 1 }} title={slot.values.join(', ')}>
        {slot.value ?? '—'}
        {extra}
      </span>
      {slot.value && (
        <>
          <span style={{ color: SOURCE_COLOUR[slot.source] ?? '#fff', fontSize: 10 }}>
            {slot.source}
          </span>
          <span style={{ opacity: 0.4, fontSize: 10 }}>{age(slot.at)}</span>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          opacity: 0.45,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export function IntentDebugPanel() {
  const [open, setOpen] = useState(false);
  const { intent, experience, adaptive, refresh } = useIntent();

  if (!PREVIEW_TOOLS) return null;

  /* The effective level, after the route cap — what the page actually does.
     adaptationLevel(intent) alone (confidence only) is shown beside it so a
     capped route is visibly different from an uncertain one. */
  const level = experience.level;
  const earnedLevel = adaptationLevel(intent);
  const session = (() => {
    try {
      return readSession();
    } catch {
      return null;
    }
  })();
  const store = (() => {
    try {
      return readStore();
    } catch {
      return null;
    }
  })();
  const model = modelStats();
  const nextSlots = predictNextSlot(intent);

  const pct = Math.round(intent.confidence * 100);
  const barColour =
    level === 'none' ? '#A39A90' : level === 'copy' ? '#FF8000' : '#34B268';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 12,
          // 80, not 12: same overlap PreviewRoleToggle had — BottomNav is
          // fixed inset-x-3 bottom-3 at ~72px tall on mobile (lg:hidden), so
          // 12px put this button right on top of BottomNav's rightmost icon.
          bottom: 80,
          // 40, not 9998: above the app's own Sheet/Dialog system (z-50) is
          // backwards — an open sheet should always outrank a floating debug
          // button, not sit underneath it.
          zIndex: 40,
          minHeight: 44,
          minWidth: 44,
          padding: '0 14px',
          borderRadius: 999,
          border: 'none',
          background: '#1c1a18',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 2px 12px rgba(0,0,0,.28)',
        }}
        aria-label="Open intent debug panel"
      >
        {experience.profile} · {pct}%
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 80,
        zIndex: 40,
        width: 320,
        maxHeight: '78vh',
        overflowY: 'auto',
        padding: 14,
        borderRadius: 14,
        background: '#1c1a18',
        color: '#fff',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        boxShadow: '0 6px 30px rgba(0,0,0,.4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 12, flex: 1 }}>Intent index</strong>
        <button
          type="button"
          onClick={refresh}
          style={{
            minHeight: 28,
            padding: '0 8px',
            borderRadius: 6,
            border: '1px solid #4a443e',
            background: 'transparent',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 10,
          }}
        >
          re-resolve
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            minHeight: 28,
            minWidth: 28,
            borderRadius: 6,
            border: '1px solid #4a443e',
            background: 'transparent',
            color: '#fff',
            cursor: 'pointer',
          }}
          aria-label="Close intent debug panel"
        >
          ×
        </button>
      </div>

      {!adaptive && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            borderRadius: 6,
            background: '#3a2f1c',
            color: '#FFC98A',
            fontSize: 10,
            lineHeight: 1.45,
          }}
        >
          This route has no visitor scenario (admin, sandbox, or a redirect
          interstitial). It still feeds signals; it never reads them.
        </div>
      )}
      {adaptive && experience.seoCapped && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            borderRadius: 6,
            background: '#1c2f3a',
            color: '#9AD4FF',
            fontSize: 10,
            lineHeight: 1.45,
          }}
        >
          SEO route: capped at copy-level. CTA label/destination and chip
          suggestions may follow intent; headline, H1, meta and intro prose
          stay static so every visitor, crawler included, sees the same DOM.
        </div>
      )}

      <Section title="Confidence">
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: '#332e29',
            overflow: 'hidden',
            marginBottom: 4,
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: barColour }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7 }}>
          <span>
            {intent.confidence.toFixed(3)} · adapts: {level}
            {earnedLevel !== level ? ` (earned ${earnedLevel})` : ''}
          </span>
          <span style={{ opacity: 0.5 }}>
            gates {THRESHOLD.copy} / {THRESHOLD.emphasis}
          </span>
        </div>
      </Section>

      <Section title="Experience">
        <div style={{ fontWeight: 700, fontSize: 13 }}>{experience.profile}</div>
        <div style={{ opacity: 0.6, lineHeight: 1.45 }}>{experience.reason}</div>
      </Section>

      <Section title="Slots">
        {FACET_SLOT_KEYS.map((key) => (
          <SlotRow key={key} name={SLOT_LABEL[key]} slot={intent[key]} />
        ))}
        {(intent.budget.min !== null || intent.budget.max !== null) && (
          <div style={{ display: 'flex', gap: 6, lineHeight: 1.5 }}>
            <span style={{ width: 54, opacity: 0.55 }}>budget</span>
            <span style={{ fontWeight: 600, flex: 1 }}>
              {intent.budget.min ?? '0'} to {intent.budget.max ?? 'any'}
            </span>
          </div>
        )}
      </Section>

      <Section title="Learned model">
        <div style={{ opacity: 0.7, lineHeight: 1.6 }}>
          {model.observations} observation{model.observations === 1 ? '' : 's'} ·{' '}
          {model.contexts} context{model.contexts === 1 ? '' : 's'} · {model.pairs} pair
          {model.pairs === 1 ? '' : 's'}
        </div>
        {nextSlots.length === 0 && (
          <div style={{ opacity: 0.4, lineHeight: 1.45, marginTop: 2 }}>
            No prediction yet. Needs {MIN_SUPPORT} observations of the same
            move before it will guess, by design.
          </div>
        )}
        {nextSlots.map((p) => {
          const likely = predictSlotValue(intent, p.value);
          return (
            <div key={p.value} style={{ display: 'flex', gap: 6, lineHeight: 1.5 }}>
              <span style={{ flex: 1 }}>
                next: {SLOT_LABEL[p.value]}
                {likely ? ` = ${likely.value}` : ' (no value yet)'}
              </span>
              <span style={{ opacity: 0.6 }}>
                p{p.p.toFixed(2)} n{p.support}
              </span>
            </div>
          );
        })}
      </Section>

      <Section title="State">
        <div style={{ lineHeight: 1.6 }}>
          <div>stage · {intent.stage}</div>
          <div>mode · {intent.mode ?? '—'}</div>
          <div>primary · {intent.primaryIntent ?? '—'}</div>
          <div>familiarity · {intent.familiarity}</div>
          <div>price · {intent.priceSensitivity}</div>
          {session && (
            <div style={{ opacity: 0.6 }}>
              session · {session.teacherSlugs.length} teacher
              {session.teacherSlugs.length === 1 ? '' : 's'}
              {session.saved ? ', saved' : ''}
              {session.contactStarted ? ', contact started' : ''}
            </div>
          )}
          {store && (
            <div style={{ opacity: 0.6 }}>
              visits · {store.visitCount}, best stage {store.stage}
            </div>
          )}
        </div>
      </Section>

      <Section title={`Evidence (${intent.evidence.length})`}>
        {intent.evidence.length === 0 && <div style={{ opacity: 0.4 }}>nothing observed yet</div>}
        {intent.evidence.map((e, i) => (
          <div
            key={`${e.kind}-${e.at}-${i}`}
            style={{ display: 'flex', gap: 6, lineHeight: 1.5, opacity: e.weight === 0 ? 0.4 : 1 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                marginTop: 4,
                flex: 'none',
                background:
                  e.strength === 'strong'
                    ? '#34B268'
                    : e.strength === 'medium'
                      ? '#4351FF'
                      : '#6b635b',
              }}
            />
            <span style={{ flex: 1 }}>{e.note}</span>
            <span style={{ opacity: 0.55 }}>
              {e.weight === 0 ? 'weight 0' : `+${e.weight.toFixed(2)}`}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 6, opacity: 0.4, lineHeight: 1.45 }}>
          Weak signals show at weight 0 by design. They are recorded so a journey
          reads end to end, and can never move the stage.
        </div>
      </Section>

      <button
        type="button"
        onClick={() => {
          resetAll();
          resetModel();
          refresh();
        }}
        style={{
          marginTop: 12,
          width: '100%',
          minHeight: 34,
          borderRadius: 8,
          border: '1px solid #5a2f2f',
          background: 'transparent',
          color: '#ff9a9a',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        Forget everything, model included
      </button>
    </div>
  );
}
