import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Boxes, Eye, Lock, Map as MapIcon, Radar, Search, Shovel, Skull, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { GithubMark, IconTile, Ruins } from "@/components/Brand";
import { ErrorBox } from "@/components/Shell";
import { TILE_LABELS, TYPE_ICONS } from "@/lib/icons";
import { greeting } from "@/lib/time";

interface DemoRepo {
  label: string;
  hint: string;
  tag: string;
  icon: LucideIcon;
  repoUrl: string;
  subdir?: string;
}

const DEMO_REPOS: DemoRepo[] = [
  {
    label: "Haunted FastAPI",
    hint: "A seeded app with every kind of dead code, plus traps that must stay alive.",
    tag: "Full of remains",
    icon: Skull,
    repoUrl: "https://github.com/Avishi2511/dead-code-hunter",
    subdir: "fixtures/haunted-fastapi",
  },
  {
    label: "Full-stack FastAPI template",
    hint: "The official template's backend. A real project, mostly healthy.",
    tag: "Mostly alive",
    icon: Boxes,
    repoUrl: "https://github.com/fastapi/full-stack-fastapi-template",
    subdir: "backend",
  },
];

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: MapIcon, title: "Survey", text: "We take a read-only snapshot of the repository. Nothing is installed or executed." },
  { icon: Radar, title: "Examine", text: "Every module, route and dependency is mapped into a graph, then checked for a pulse." },
  { icon: Shovel, title: "Bury", text: "What nothing reaches is marked dead, with the evidence. A patch you review removes it." },
];

const PROMISES: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Read-only: your code is never run" },
  { icon: Eye, text: "Every finding comes with its evidence" },
  { icon: Search, text: "Static analysis, no guesswork from a model" },
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
    <div className="space-y-10">
      <section className="hero relative overflow-hidden rounded-xl border border-border px-6 pb-28 pt-12 sm:px-10">
        <Ruins className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full text-bg" />
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#d98a96]">Code archaeology</p>
        <h1 className="title mt-3 text-4xl sm:text-6xl">{greeting()}</h1>
        <p className="mt-3 max-w-xl text-lg text-muted">
          Every codebase has a graveyard: the functions, routes and packages nobody calls anymore. Let's find yours,
          examine the remains, and lay them to rest.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <form
          className="card flex flex-col p-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ repoUrl, ref, subdir });
          }}
        >
          <h2 className="title text-2xl">Begin the survey</h2>
          <p className="mt-1 text-sm text-muted">Paste a public GitHub repository. Python and FastAPI projects work best.</p>

          <label className="label mt-6" htmlFor="repo">
            GitHub repository
          </label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
              <GithubMark size={18} />
            </span>
            <input
              id="repo"
              className="input !py-3 !pl-11 font-mono"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              autoFocus
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ref">
                Branch, tag or SHA <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input id="ref" className="input mt-1.5 font-mono" placeholder="main" value={ref} onChange={(e) => setRef(e.target.value)} />
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

          {start.error && (
            <div className="mt-4">
              <ErrorBox message={start.error.message} />
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-xs text-muted">A scan usually takes under a minute.</p>
            <button className="btn btn-primary !px-5 !py-2.5" type="submit" disabled={!repoUrl.trim() || start.isPending}>
              <Search size={16} />
              {start.isPending ? "Starting…" : "Start the hunt"}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-3">
          <div>
            <h2 className="title text-2xl">Or visit a known grave</h2>
            <p className="mt-1 text-sm text-muted">Two demo repositories, one click each.</p>
          </div>
          {DEMO_REPOS.map((demo) => (
            <button
              key={demo.label}
              className="card group flex flex-1 items-center gap-4 p-4 text-left transition-colors hover:border-accent disabled:opacity-50"
              disabled={start.isPending}
              onClick={() => submit(demo)}
            >
              <IconTile icon={demo.icon} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{demo.label}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                    {demo.tag}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">{demo.hint}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-muted transition-all group-hover:translate-x-0.5 group-hover:text-text" />
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="title text-2xl">What we dig up</h2>
          <p className="text-sm text-muted">Nine kinds of remains, each with its own evidence.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
          {Object.keys(TYPE_ICONS).map((type) => (
            <div key={type} className="card flex flex-col items-center gap-3 px-2 py-4 text-center">
              <IconTile type={type} />
              <span className="text-xs capitalize leading-tight text-muted">{TILE_LABELS[type]}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="title mb-5 text-2xl">How the dig works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="relative">
              {index < STEPS.length - 1 && (
                <span className="absolute left-[3.25rem] right-[-1rem] top-5 hidden border-t border-dashed border-border md:block" />
              )}
              <div className="relative flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-b-md rounded-t-full border border-accent/70 bg-surface text-[#d98a96]">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="font-mono text-xs text-muted">0{index + 1}</span>
              </div>
              <h3 className="title mt-3 text-xl">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <ul className="grid gap-3 border-t border-border pt-6 sm:grid-cols-3">
        {PROMISES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5 text-sm text-muted">
            <Icon size={16} className="shrink-0 text-[#d98a96]" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
