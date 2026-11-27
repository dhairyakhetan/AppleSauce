import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

/**
 * Shown when the account could not be read (a bad connection), as opposed to "this account has no role yet".
 *
 * The two used to look the same, so a teacher on a poor connection was sent to "Student or Guardian?" and could lose the
 * teacher dashboard by answering it (site-wide audit B1, 27 Nov 2026). A failed read must never offer the role choice:
 * it says so and offers a retry.
 */
export function ProfileLoadFailed({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6" data-testid="profile-load-failed">
        <Logo size="lg" className="mb-6" />
        <h1 className="mb-3 text-page-title text-foreground">We could not load your account.</h1>
        <p role="alert" className="mb-6 max-w-md text-[15px] text-warm-secondary">
          This is usually a weak connection. Nothing was changed. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="min-h-12 rounded-lg bg-foreground px-6 text-base font-bold text-background transition-transform duration-150 hover:-translate-y-0.5 active:scale-press disabled:opacity-disabled"
        >
          {busy ? 'Trying again...' : 'Try again'}
        </button>
        <Link to="/" className="mt-4 inline-flex min-h-11 items-center px-2 text-[14px] font-semibold text-brand-blue hover:text-brand-blue-deep">
          Go to the home page
        </Link>
      </main>
    </div>
  );
}
