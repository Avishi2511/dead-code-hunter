import { Link, Outlet } from "react-router-dom";
import { Logo } from "./Brand";

export const DISCLAIMER =
  "Findings come from static analysis. They are strong signals, not proof — always review before removing.";

export function Shell() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link to="/" aria-label="Dead Code Hunter home">
            <Logo />
          </Link>
          <span className="hidden font-mono text-xs text-muted sm:block">Python · FastAPI</span>
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

export function PageTitle({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="title text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
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
