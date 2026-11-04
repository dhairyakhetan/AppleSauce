import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { VerifierDetailsForm, type VerifierDetailsFormProps } from '@/components/hod/VerifierDetailsForm';
import { ProfileRow } from '@/components/hod/VerifiersTab';
import type { HodApi, HodVerifierProfile } from '@/lib/hod-api';
import { draftFromProfile } from '@/lib/verifier-profile-edit';

/* No jsdom here: each state is rendered to markup from the props that produce it.
   The form is a plain view, so "saving", "server refusal" and "length problem" are
   just different props. The collapsed row is rendered with a query client. */

const profile = (over: Partial<HodVerifierProfile> = {}): HodVerifierProfile => ({
  user_id: 'u1',
  email: 'asha@example.com',
  name: 'Asha',
  active: true,
  full_name: 'Asha Rao',
  grade: 10,
  school: 'Sample Hill School',
  board: 'ISC',
  valid_until: '2027-03-31',
  expired: false,
  missing: false,
  preferred_subjects: ['Mathematics'],
  requested_subjects: [],
  requested_at: null,
  ...over,
});

function formProps(over: Partial<VerifierDetailsFormProps> = {}): VerifierDetailsFormProps {
  const p = profile();
  return {
    idBase: 'verifier-details-u1',
    name: 'Asha Rao',
    draft: draftFromProfile(p),
    onDraft: () => {},
    subjects: ['Mathematics'],
    choices: ['Chemistry', 'Mathematics', 'Physics'],
    onSubjects: () => {},
    problem: null,
    error: null,
    busy: false,
    onSave: () => {},
    onCancel: () => {},
    formId: 'verifier-details-u1-form',
    ...over,
  };
}

const html = (props: VerifierDetailsFormProps) => renderToStaticMarkup(<VerifierDetailsForm {...props} />);

describe('VerifierDetailsForm, expanded', () => {
  it('shows the five details and the preferred subjects, filled from the saved profile', () => {
    const out = html(formProps());
    expect(out).toContain('data-testid="verifier-details-form"');
    expect(out).toContain('value="Asha Rao"');
    expect(out).toContain('value="Sample Hill School"');
    expect(out).toContain('type="date"');
    expect(out).toContain('value="2027-03-31"');
    expect(out).toContain('>Grade<');
    expect(out).toContain('>Board<');
    expect(out).toContain('Preferred subjects');
  });

  it('ticks exactly the selected subjects and offers every choice', () => {
    const out = html(formProps());
    expect(out).toContain('Chemistry');
    expect(out).toContain('Physics');
    expect(out.match(/type="checkbox"/g)).toHaveLength(3);
    expect(out.match(/checked=""/g)).toHaveLength(1);
    expect(out).toMatch(/checked=""[^>]*>Mathematics<\/label>/);
  });

  it('says so when there are no subjects to choose from yet', () => {
    expect(html(formProps({ choices: [], subjects: [] }))).toContain('No subjects to choose from yet');
  });

  it('shows the plain Save and Cancel buttons with no alert when nothing is wrong', () => {
    const out = html(formProps());
    expect(out).toContain('>Save<');
    expect(out).toContain('>Cancel<');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain('aria-busy="true"');
  });
});

describe('VerifierDetailsForm, saving', () => {
  it('shows Saving..., disables the fields and buttons, and marks the form busy', () => {
    const out = html(formProps({ busy: true }));
    expect(out).toContain('Saving...');
    expect(out).toContain('aria-busy="true"');
    expect(out.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });
});

describe('VerifierDetailsForm, server refusal', () => {
  it('shows the server sentence as written, in an alert, and keeps the form', () => {
    const out = html(formProps({ error: 'No papers in Astrology. Subjects with papers: Mathematics, Physics' }));
    expect(out).toContain('data-testid="details-error"');
    expect(out).toContain('role="alert"');
    expect(out).toContain('No papers in Astrology. Subjects with papers: Mathematics, Physics');
    expect(out).toContain('data-testid="verifier-details-form"');
  });
});

describe('VerifierDetailsForm, length-limit problem', () => {
  it('counts the name against the limit and marks it invalid when over', () => {
    const p = profile();
    const out = html(formProps({ draft: { ...draftFromProfile(p), full_name: 'a'.repeat(121) } }));
    expect(out).toContain('121 of 120 characters');
    expect(out).toContain('aria-invalid="true"');
  });

  it('shows the plain-words problem in an alert', () => {
    const out = html(formProps({ problem: 'The name is too long (120 characters at most).' }));
    expect(out).toContain('data-testid="details-problem"');
    expect(out).toContain('The name is too long (120 characters at most).');
  });

  it('leaves the name unmarked and the count off at exactly the limit', () => {
    const p = profile();
    const out = html(formProps({ draft: { ...draftFromProfile(p), full_name: 'a'.repeat(120) } }));
    expect(out).not.toContain('aria-invalid');
    expect(out).not.toContain('data-testid="name-length"');
  });
});

describe('ProfileRow, collapsed', () => {
  const api = {} as HodApi;
  const row = (p: HodVerifierProfile) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ProfileRow p={p} api={api} scope="test" choices={['Mathematics', 'Physics']} />
      </QueryClientProvider>,
    );

  it('shows an always-reachable Edit details button that is closed, and no form', () => {
    const out = row(profile());
    expect(out).toContain('>Edit details<');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('aria-controls');
    expect(out).not.toContain('data-testid="verifier-details-form"');
  });

  it('lists the preferred subjects in the collapsed row', () => {
    expect(row(profile({ preferred_subjects: ['Mathematics', 'Physics'] }))).toContain('Preferred subjects: Mathematics, Physics');
    expect(row(profile({ preferred_subjects: [] }))).toContain('Preferred subjects: none yet');
  });

  it('adds the auto-assign note under a verifier with no grade', () => {
    const out = row(profile({ grade: null, missing: true }));
    expect(out).toContain('data-testid="grade-not-set"');
    expect(out).toContain('Grade not set, so any paper can be given');
  });

  it('leaves the auto-assign note off when a grade is set', () => {
    expect(row(profile())).not.toContain('data-testid="grade-not-set"');
  });

  it('does not show the auto-assign note for an expired verifier, who gets no new papers', () => {
    expect(row(profile({ grade: null, missing: true, expired: true }))).not.toContain('Grade not set, so any paper can be given');
  });
});
