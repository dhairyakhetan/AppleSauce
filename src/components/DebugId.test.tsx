import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DebugId, AdminDebugToggle } from '@/components/DebugId';

// Owner, 2026-09-28: "add a debug mode in admin ... a toggle visible ONLY
// to admins ... must not appear in any non-admin render". This mocks
// useAdminDebugOn directly (rather than the admin-check network call it is
// built on) so the test pins the one contract every consumer relies on:
// DebugId renders nothing at all -- not a hidden element -- when debug mode
// is off, exactly the state a non-admin is always in.
//
// Rendered with renderToStaticMarkup (no jsdom / testing-library in this
// project's test setup) so the assertion is on the actual HTML a non-admin
// would receive, not just a React tree shape.
const mockUseAdminDebugOn = vi.fn();
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugOn: () => mockUseAdminDebugOn(),
}));

describe('DebugId', () => {
  it('renders nothing when debug mode is off (the non-admin / admin-off state)', () => {
    mockUseAdminDebugOn.mockReturnValue(false);
    const html = renderToStaticMarkup(<DebugId label="question" value="abc-123" />);
    expect(html).toBe('');
    expect(html).not.toContain('abc-123');
  });

  it('renders the id chip when debug mode is on', () => {
    mockUseAdminDebugOn.mockReturnValue(true);
    const html = renderToStaticMarkup(<DebugId label="question" value="abc-123" />);
    expect(html).toContain('abc-123');
    expect(html).toContain('question');
  });

  it('renders nothing for a null/undefined/empty value even when debug mode is on', () => {
    mockUseAdminDebugOn.mockReturnValue(true);
    expect(renderToStaticMarkup(<DebugId label="paper" value={null} />)).toBe('');
    expect(renderToStaticMarkup(<DebugId label="paper" value={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<DebugId label="paper" value="" />)).toBe('');
  });
});

describe('AdminDebugToggle', () => {
  it('renders nothing when canToggle is false, regardless of on', () => {
    const html = renderToStaticMarkup(<AdminDebugToggle on={true} canToggle={false} toggle={() => {}} />);
    expect(html).toBe('');
  });

  it('shows the "Debug mode on" pill only when on and toggleable', () => {
    const html = renderToStaticMarkup(<AdminDebugToggle on={true} canToggle={true} toggle={() => {}} />);
    expect(html).toContain('Debug mode on');
  });

  it('shows the off label when toggleable but off', () => {
    const html = renderToStaticMarkup(<AdminDebugToggle on={false} canToggle={true} toggle={() => {}} />);
    expect(html).toContain('Debug mode');
    expect(html).not.toContain('Debug mode on');
  });
});
