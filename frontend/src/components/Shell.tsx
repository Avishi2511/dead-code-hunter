import clsx from "clsx";
import { ArrowUp } from "lucide-react";
import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Logo } from "./Brand";

export const DISCLAIMER =
  "Findings come from static analysis. They are strong signals, not proof — always review before removing.";

/** The page's content column, shared so every screen lines up with the header. */
export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("mx-auto w-full max-w-[1360px] px-5 sm:px-10", className)}>{children}</div>;
}

export function Shell() {
  const { pathname } = useLocation();
  const home = pathname === "/";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="relative flex min-h-full flex-col overflow-x-clip">
      <div className="ruler" aria-hidden="true" />
      <header className={clsx(home ? "absolute inset-x-0 top-0 z-20" : "border-b border-[#1f1a1b]")}>
        <Container className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-[18px]">
          <Link to="/" aria-label="Dead Code Hunter home">
            <Logo />
          </Link>
          {!home && <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-muted">Python · FastAPI</span>}
        </Container>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer home={home} />
    </div>
  );
}

function Footer({ home }: { home: boolean }) {
  return (
    <footer className={clsx("border-t border-border bg-[#0a0708]", !home && "mt-20")}>
      <Container className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-6">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Static analysis · Nothing executed</span>
        <button
          className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-[#b3a9a5] transition-colors hover:text-text"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp size={15} /> Back to the surface
        </button>
        <p className="w-full text-xs text-muted">{DISCLAIMER}</p>
      </Container>
    </footer>
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

/** Eyebrow plus big serif heading, the opening of every page section. `children` is the right-hand side. */
export function SectionHead({
  eyebrow,
  children,
  aside,
  className,
}: {
  eyebrow: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap items-end justify-between gap-x-10 gap-y-5", className)}>
      <div className="min-w-0 flex-1 basis-[420px]">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="display mt-3 text-[clamp(40px,5vw,68px)]">{children}</h2>
      </div>
      {aside}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-accent-hover p-5">
      <p className="text-sm">{message}</p>
      {onRetry && (
        <button className="btn mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
