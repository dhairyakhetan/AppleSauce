import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20260929160000_maths_admin_to_checkers_page_images.sql cannot run in CI (no
   database), so its load-bearing lines are pinned here: the grant trap from
   CLAUDE.md, Maths only, English excluded, the logged and undoable move, and
   that checker_next_question is left alone on purpose. */

const raw = readFileSync('supabase/migrations/20260929160000_maths_admin_to_checkers_page_images.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('maths admin to checkers migration', () => {
  it('revokes the routing function from public, anon AND authenticated, and grants nobody', () => {
    expect(sql).toContain(
      'revoke all on function public.route_maths_admin_to_checkers(boolean, text[]) from public, anon, authenticated;',
    );
    expect(sql).not.toMatch(/grant\s+execute[^;]*route_maths_admin_to_checkers/i);
  });

  it('keeps the page registry closed to direct access', () => {
    expect(sql).toContain('alter table public.audit_paper_pages enable row level security;');
    expect(sql).toContain('revoke all on table public.audit_paper_pages from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant\s+(select|insert|update|all)[^;]*audit_paper_pages/i);
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it('pins the registry path to the one the site derives', () => {
    expect(sql).toContain("object_path = 'pages/' || audit_paper_id::text || '/' || page::text || '.jpg'");
  });

  it('routes Maths only, never English, never a red or blank question', () => {
    expect(sql).toContain("ap.subject ilike 'Math%'");
    expect(sql).toContain("coalesce(aq.source ->> 'pipeline', '') = 'english_w14'");
    expect(sql).toContain("coalesce(aq.status, '') <> 'red'");
    expect(sql).toContain("btrim(coalesce(aq.body, '')) <> ''");
    expect(sql).toContain("default array['possible_duplicate', 'ocr_dropout', 'script_unsupported']");
    // hard-coded too, so a caller passing p_skip_reasons => '{}' cannot route them
    expect(sql).toMatch(/&&\s*array\['possible_duplicate', 'ocr_dropout', 'script_unsupported', 'board_class_mismatch'\]/);
    // the move itself re-checks them, and the page cast is guarded
    expect(sql.match(/'script_unsupported', 'board_class_mismatch'\]/g)?.length).toBe(2);
    expect(sql).toContain("then (aq.source ->> 'page')::integer end");
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  it('needs a registered page image, and only counts unless asked to apply', () => {
    expect(sql).toContain('from public.audit_paper_pages pg');
    expect(sql).toContain('p_apply boolean default false');
    expect(sql).toContain('if p_apply and');
  });

  it('logs every move as a reclassify, in the shape the earlier undo expects', () => {
    expect(sql).toContain("'reclassify', 'review_bucket'");
    expect(sql).toContain("jsonb_build_object('review_bucket', 'admin')");
    expect(sql).toContain("jsonb_build_object('review_bucket', 'kid')");
    expect(sql).toContain('route_maths_admin_to_checkers');
  });

  it('does not touch the checker queue functions or use an em or en dash', () => {
    expect(sql).not.toMatch(/create or replace function public\.checker_/);
    expect(raw).not.toMatch(/[–—]/);
  });
});
