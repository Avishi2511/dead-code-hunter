import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Boxes, Check, Eye, Lock, Map as MapIcon, Radar, Search, Shovel, Skull, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { GithubMark, IconTile, Ruins } from "@/components/Brand";
import { SampleScan } from "@/components/SampleScan";
import { ErrorBox } from "@/components/Shell";
import { TILE_LABELS, TYPE_ICONS } from "@/lib/icons";
import { Reveal, usePrefersReducedMotion } from "@/lib/motion";
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

const SAMPLE_POINTS = [
  "Each stage is real: survey, map, examine, check for a pulse.",
  "Every remain gets a confidence and a verdict, not just a name.",
  "You choose what is buried. Nothing changes until you apply the patch.",
];

/** A fixed set of embers so the hero looks the same on every load. */
const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  left: `${6 + ((i * 37) % 88)}%`,
  size: 2 + (i % 3),
  duration: 9 + ((i * 5) % 8),
  delay: -((i * 3) % 11),
  drift: ((i % 2 ? 1 : -1) * (14 + ((i * 7) % 26))),
}));

export function Home() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [subdir, setSubdir] = useState("");
  const [leaving, setLeaving] = useState(false);

  const start = useMutation({
    mutationFn: (body: { repoUrl: string; ref?: string; subdir?: string }) => api.createScan(body),
    onSuccess: ({ scanId }) => {
      setLeaving(true);
      setTimeout(() => navigate(`/scans/${scanId}`), reduced ? 0 : 320);
    },
  });

  const submit = (body: { repoUrl: string; ref?: string; subdir?: string }) =>
    start.mutate({
      repoUrl: body.repoUrl.trim(),
      ref: body.ref?.trim() || undefined,
      subdir: body.subdir?.trim() || undefined,
    });

  const busy = start.isPending || leaving;

  const onHeroMove = (event: MouseEvent<HTMLElement>) => {
    if (reduced) return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", String((event.clientX - box.left) / box.width - 0.5));
    event.currentTarget.style.setProperty("--my", String((event.clientY - box.top) / box.height - 0.5));
  };
  const onHeroLeave = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--mx", "0");
    event.currentTarget.style.setProperty("--my", "0");
  };

  const delay = (ms: number): CSSProperties => ({ "--delay": `${ms}ms` }) as CSSProperties;

  return (
    <div className={clsx("space-y-10 transition-opacity duration-300", leaving && "opacity-0")}>
      <section
        className="hero relative overflow-hidden rounded-xl border border-border px-6 pb-28 pt-12 sm:px-10"
        onMouseMove={onHeroMove}
        onMouseLeave={onHeroLeave}
      >
        <div className="hero-parallax-far pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="hero-moon" />
        </div>
        <div
          className="hero-fog"
          style={{ bottom: "2.5rem", height: "8rem", transform: "translate3d(calc(var(--mx, 0) * 22px), 0, 0)" }}
          aria-hidden="true"
        >
          <div />
        </div>
        <div
          className="hero-fog"
          style={{ bottom: "0.5rem", height: "6rem", opacity: 0.8, transform: "translate3d(calc(var(--mx, 0) * -30px), 0, 0)" }}
          aria-hidden="true"
        >
          <div style={{ animationDirection: "alternate-reverse", animationDuration: "31s" }} />
        </div>
        {EMBERS.map((ember, index) => (
          <span
            key={index}
            className="ember"
            aria-hidden="true"
            style={
              {
                left: ember.left,
                "--size": `${ember.size}px`,
                "--dur": `${ember.duration}s`,
                "--delay": `${ember.delay}s`,
                "--drift": `${ember.drift}px`,
              } as CSSProperties
            }
          />
        ))}
        <Ruins className="hero-ruins pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full text-bg" />

        <div className="relative z-10">
          <p className="rise font-mono text-xs uppercase tracking-[0.25em] text-[#d98a96]">Code archaeology</p>
          <h1 className="title rise mt-3 text-4xl sm:text-6xl" style={delay(120)}>
            {greeting()}
          </h1>
          <p className="rise mt-3 max-w-xl text-lg text-muted" style={delay(280)}>
            Every codebase has a graveyard: the functions, routes and packages nobody calls anymore. Let's find yours,
            examine the remains, and lay them to rest.
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <form
          className="card rise flex flex-col p-6"
          style={delay(420)}
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
            <button className="btn btn-primary !px-5 !py-2.5" type="submit" disabled={!repoUrl.trim() || busy}>
              {busy ? <Shovel size={16} className="animate-dig" /> : <Search size={16} />}
              {busy ? "Digging…" : "Start the hunt"}
            </button>
          </div>
        </form>

        <div className="rise flex flex-col gap-3" style={delay(540)}>
          <div>
            <h2 className="title text-2xl">Or visit a known grave</h2>
            <p className="mt-1 text-sm text-muted">Two demo repositories, one click each.</p>
          </div>
          {DEMO_REPOS.map((demo) => (
            <button
              key={demo.label}
              className="card lift group flex flex-1 items-center gap-4 p-4 text-left hover:border-accent disabled:opacity-50"
              disabled={busy}
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

      <Reveal>
        <section className="grid items-center gap-8 lg:grid-cols-[2fr_3fr]">
          <div>
            <h2 className="title text-3xl">Watch a hunt unfold</h2>
            <p className="mt-2 text-sm text-muted">This is what happens when you paste a repository, on a made-up project.</p>
            <ul className="mt-5 space-y-3">
              {SAMPLE_POINTS.map((point) => (
                <li key={point} className="flex gap-2.5 text-sm">
                  <Check size={16} className="mt-0.5 shrink-0 text-[#d98a96]" />
                  {point}
                </li>
              ))}
            </ul>
            <button
              className="btn mt-6"
              onClick={() => {
                document.getElementById("repo")?.focus({ preventScroll: false });
                document.getElementById("repo")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
              }}
            >
              Try it on your repo <ArrowRight size={15} />
            </button>
          </div>
          <SampleScan />
        </section>
      </Reveal>

      <section>
        <Reveal>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="title text-2xl">What we dig up</h2>
            <p className="text-sm text-muted">Nine kinds of remains, each with its own evidence.</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
          {Object.keys(TYPE_ICONS).map((type, index) => (
            <Reveal key={type} rise delay={index * 70}>
              <div className="card lift flex h-full flex-col items-center gap-3 px-2 py-4 text-center">
                <IconTile type={type} />
                <span className="text-xs capitalize leading-tight text-muted">{TILE_LABELS[type]}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section>
        <Reveal>
          <h2 className="title mb-5 text-2xl">How the dig works</h2>
        </Reveal>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <Reveal key={title} as="li" delay={index * 160} className="relative">
              {index < STEPS.length - 1 && (
                <span className="draw-line absolute left-[3.25rem] right-[-1rem] top-5 hidden border-t border-dashed border-accent/60 md:block" />
              )}
              <div className="relative flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-b-md rounded-t-full border border-accent/70 bg-surface text-[#d98a96]">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="font-mono text-xs text-muted">0{index + 1}</span>
              </div>
              <h3 className="title mt-3 text-xl">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <Reveal>
        <ul className="grid gap-3 border-t border-border pt-6 sm:grid-cols-3">
          {PROMISES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-sm text-muted">
              <Icon size={16} className="shrink-0 text-[#d98a96]" />
              {text}
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
