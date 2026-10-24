import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { GithubMark, Ruins } from "@/components/Brand";
import { ErrorBox } from "@/components/Shell";
import { greeting } from "@/lib/time";

interface DemoRepo {
  label: string;
  hint: string;
  repoUrl: string;
  subdir?: string;
}

const DEMO_REPOS: DemoRepo[] = [
  {
    label: "Haunted FastAPI",
    hint: "Seeded app: every kind of dead code, plus traps that must stay alive",
    repoUrl: "https://github.com/Avishi2511/dead-code-hunter",
    subdir: "fixtures/haunted-fastapi",
  },
  {
    label: "Full-stack FastAPI template",
    hint: "The official template's backend, mostly healthy",
    repoUrl: "https://github.com/fastapi/full-stack-fastapi-template",
    subdir: "backend",
  },
];

const STEPS = [
  ["Download", "A read-only snapshot of the repository. Nothing is installed or executed."],
  ["Map", "Every module, symbol, route and dependency becomes a node in a code graph."],
  ["Bury", "Whatever nothing reaches is marked dead, with the evidence for and against."],
];

export function Home() {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [subdir, setSubdir] = useState("");

  const start = useMutation({
    mutationFn: (body: { repoUrl: string; ref?: string; subdir?: string }) => api.createScan(body),
    onSuccess: ({ scanId }) => navigate(`/scans/${scanId}`),
  });

  const submit = (body: { repoUrl: string; ref?: string; subdir?: string }) =>
    start.mutate({
      repoUrl: body.repoUrl.trim(),
      ref: body.ref?.trim() || undefined,
      subdir: body.subdir?.trim() || undefined,
    });

  return (
    <div className="space-y-8">
      <section className="hero relative overflow-hidden rounded-xl border border-border px-6 pb-28 pt-12 sm:px-10">
        <Ruins className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full text-bg" />
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#d98a96]">Code archaeology</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{greeting()}</h1>
        <p className="mt-3 max-w-xl text-lg text-muted">
          Let's find what's buried in your codebase: the functions, routes and packages nobody calls anymore.
        </p>
      </section>

      <form
        className="card -mt-24 relative mx-auto max-w-2xl space-y-4 p-5 shadow-2xl shadow-black/60"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ repoUrl, ref, subdir });
        }}
      >
        <div>
          <label className="label" htmlFor="repo">
            GitHub repository
          </label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <GithubMark size={18} />
            </span>
            <input
              id="repo"
              className="input !pl-10 font-mono"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ref">
              Branch, tag or SHA <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input id="ref" className="input mt-1.5 font-mono" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="subdir">
              Subdirectory <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="subdir"
              className="input mt-1.5 font-mono"
              placeholder="backend"
              value={subdir}
              onChange={(e) => setSubdir(e.target.value)}
            />
          </div>
        </div>
        {start.error && <ErrorBox message={start.error.message} />}
        <button className="btn btn-primary" type="submit" disabled={!repoUrl.trim() || start.isPending}>
          <Search size={16} />
          {start.isPending ? "Starting…" : "Start the hunt"}
        </button>
      </form>

      <section className="mx-auto max-w-2xl">
        <p className="label">Or try a demo</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {DEMO_REPOS.map((demo) => (
            <button
              key={demo.label}
              className="card group flex items-start justify-between gap-3 p-4 text-left transition-colors hover:border-accent disabled:opacity-50"
              disabled={start.isPending}
              onClick={() => submit(demo)}
            >
              <span>
                <span className="block text-sm font-medium">{demo.label}</span>
                <span className="mt-1 block text-xs text-muted">{demo.hint}</span>
              </span>
              <ArrowRight size={16} className="mt-0.5 shrink-0 text-muted transition-colors group-hover:text-text" />
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-3">
        {STEPS.map(([title, text], index) => (
          <div key={title} className="px-1">
            <span className="font-mono text-xs text-[#d98a96]">0{index + 1}</span>
            <h3 className="mt-1 text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
