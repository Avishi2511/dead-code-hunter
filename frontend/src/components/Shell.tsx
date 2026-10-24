import { Link, Outlet } from "react-router-dom";

export const DISCLAIMER =
  "Findings come from static analysis. They are strong signals, not proof — always review before removing.";

export function Shell() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
            Dead Code Hunter
          </Link>
          <span className="font-mono text-xs text-muted">Python · FastAPI</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-6xl px-5 py-3 text-xs text-muted">{DISCLAIMER}</p>
      </footer>
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-accent p-5">
      <p className="text-sm">{message}</p>
      {onRetry && (
        <button className="btn mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
