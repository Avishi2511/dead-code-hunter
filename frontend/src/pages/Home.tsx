import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Boxes, Shovel, Skull, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Ruins } from "@/components/Brand";
import { Intro } from "@/components/Intro";
import { SampleScan } from "@/components/SampleScan";
import { Container, ErrorBox } from "@/components/Shell";
import { TYPE_ICONS } from "@/lib/icons";
import { Reveal, usePrefersReducedMotion } from "@/lib/motion";
import { greeting } from "@/lib/time";

interface DemoRepo {
  label: string;
  hint: string;
  tag: string;
  tagClass: string;
  icon: LucideIcon;
  repoUrl: string;
  subdir?: string;
}

const DEMO_REPOS: DemoRepo[] = [
  {
    label: "Haunted FastAPI",
    hint: "A seeded app with every kind of dead code, plus traps that must stay alive.",
    tag: "Full of remains",
    tagClass: "chip-high",
    icon: Skull,
    repoUrl: "https://github.com/Avishi2511/dead-code-hunter",
    subdir: "fixtures/haunted-fastapi",
  },
  {
    label: "Full-stack FastAPI template",
    hint: "The official template's backend. A real project, mostly healthy.",
    tag: "Mostly alive",
    tagClass: "chip-plain",
    icon: Boxes,
    repoUrl: "https://github.com/fastapi/full-stack-fastapi-template",
    subdir: "backend",
  },
];

const KINDS: { type: string; name: string; blurb: string; height: number }[] = [
  { type: "unused_function", name: "Function", blurb: "Defined, never called", height: 300 },
  { type: "unused_class", name: "Class", blurb: "Declared, never used", height: 336 },
  { type: "unused_method", name: "Method", blurb: "A method nothing calls", height: 282 },
  { type: "unused_variable", name: "Variable", blurb: "Assigned, never read", height: 346 },
  { type: "unused_import", name: "Import", blurb: "Brought in, never touched", height: 294 },
  { type: "unused_module", name: "Module", blurb: "A module no one imports", height: 326 },
  { type: "unused_dependency", name: "Dependency", blurb: "Listed, never imported", height: 274 },
  { type: "unused_route", name: "Route", blurb: "A path nothing reaches", height: 340 },
  { type: "unreachable_code", name: "Unreachable", blurb: "Lines that can never run", height: 298 },
];

const FRAGMENTS: { text: string; style: CSSProperties }[] = [
  { text: "def calculate_legacy_tax(order, region):", style: { left: "4%", top: 190, transform: "rotate(-4deg)" } },
  { text: "import pandas as pd", style: { left: "7%", top: 430, transform: "rotate(3deg)" } },
  { text: '@router.get("/v1/export")', style: { right: "4%", top: 210, transform: "rotate(3deg)" } },
  { text: "class LegacyCache:", style: { right: "7%", top: 450, transform: "rotate(-3deg)" } },
  { text: "    return 0  # unreachable", style: { left: "36%", top: 560, transform: "rotate(-1deg)" } },
];

const dots = (alpha: number, size: number, x: number, y: number) =>
  `radial-gradient(rgba(237,230,225,${alpha}) 1px,transparent 1.6px) ${x}px ${y}px/${size}px ${size}px`;
const flecks = (alpha: number, r: number, w: number, h: number, x: number, y: number) =>
  `radial-gradient(rgba(122,30,44,${alpha}) ${r}px,transparent ${r + 1}px) ${x}px ${y}px/${w}px ${h}px`;

const RIDGE_A = "polygon(0 6px,7% 0,19% 8px,33% 2px,48% 9px,61% 1px,77% 7px,90% 0,100% 5px,100% 100%,0 100%)";
const RIDGE_B = "polygon(0 3px,9% 8px,22% 0,36% 7px,52% 1px,66% 9px,81% 2px,93% 8px,100% 0,100% 100%,0 100%)";

const STRATA: { range: string; title: string; text: string; out: string; bg: string; clip: string; pad: string }[] = [
  {
    range: "0.0 – 0.5 m",
    title: "Surveying the grounds",
    text: "The repository is fetched and every Python file, route table and requirements list is catalogued.",
    out: "→ file inventory",
    bg: `${dots(0.05, 26, 0, 0)},${flecks(0.18, 2, 73, 53, 13, 9)},#120d0e`,
    clip: RIDGE_A,
    pad: "76px 0 64px",
  },
  {
    range: "0.5 – 2.0 m",
    title: "Digging in and mapping the graves",
    text: "Every function, class, import and route is parsed into a map of who defines what, and who refers to whom.",
    out: "→ symbol and reference map",
    bg: `${dots(0.05, 28, 7, 3)},${flecks(0.2, 2, 67, 59, 30, 14)},#150f10`,
    clip: RIDGE_B,
    pad: "76px 0 64px",
  },
  {
    range: "2.0 – 3.5 m",
    title: "Examining the remains",
    text: "Symbols that nothing refers to are lifted out of the map as candidates, and listed dependencies are checked against the imports that actually exist.",
    out: "→ candidate remains",
    bg: `${dots(0.05, 24, 0, 11)},${flecks(0.22, 2, 79, 47, 20, 0)},#181112`,
    clip: RIDGE_A,
    pad: "76px 0 64px",
  },
  {
    range: "3.5 – 5.0 m",
    title: "Checking for a pulse",
    text: "Each candidate is searched for signs of life, evidence that it is still used somewhere. Anything with a pulse is spared or marked low confidence.",
    out: "→ signs of life, weighed",
    bg: `${dots(0.055, 27, 5, 8)},${flecks(0.24, 2, 71, 57, 9, 21)},#1b1314`,
    clip: RIDGE_B,
    pad: "76px 0 64px",
  },
  {
    range: "5.0 – 6.0 m",
    title: "Writing the death certificates",
    text: "Every finding is written up with a confidence level, a cause of death and its signs of life, ready to review and bury as a diff.",
    out: "→ findings with evidence",
    bg: `${dots(0.055, 25, 0, 0)},${flecks(0.26, 2, 75, 49, 17, 5)},#1e1517`,
    clip: RIDGE_A,
    pad: "76px 0 72px",
  },
];

/** A fixed set of embers so the hero looks the same on every load. */
const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  left: `${[6, 13, 19, 27, 34, 41, 48, 55, 62, 69, 76, 83, 90, 95][i]}%`,
  bottom: 30 + ((i * 37) % 120),
  size: 2 + (i % 3),
  duration: 7 + ((i * 1.7) % 6),
  delay: -((i * 1.3) % 9),
  drift: (i % 2 ? 1 : -1) * (14 + ((i * 7) % 26)),
}));

const ENTERED_KEY = "dch-entered";
const readEntered = () => {
  try {
    return sessionStorage.getItem(ENTERED_KEY) === "1";
  } catch {
    return false;
  }
};

export function Home() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const [entered, setEntered] = useState(readEntered);
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [subdir, setSubdir] = useState("");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (entered) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [entered]);

  const enter = () => {
    try {
      sessionStorage.setItem(ENTERED_KEY, "1");
    } catch {
      /* private mode: the gates simply show again next visit */
    }
    setEntered(true);
  };

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
  const [hello] = greeting().split(", ");
  const toForm = () => {
    const field = document.getElementById("repo");
    field?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    field?.focus({ preventScroll: true });
  };

  return (
    <div className={clsx("transition-opacity duration-300", leaving && "opacity-0")}>
      {!entered && <Intro onEnter={enter} />}

      {/* ============ HERO: the horizon ============ */}
      <section className="relative isolate bg-bg">
        {entered && (
          <>
            <div aria-hidden="true" className="gate gate-l" />
            <div aria-hidden="true" className="gate gate-r" />
          </>
        )}

        <div className="relative z-[1] h-[540px] overflow-hidden">
          <svg aria-hidden="true" viewBox="0 0 1440 540" preserveAspectRatio="xMidYMin slice" className="absolute inset-0 h-full w-full">
            <g fill="#ede6e1">
              {[
                [86, 64, 1.2, 0.5], [212, 138, 1, 0.4], [340, 52, 1.4, 0.55], [470, 116, 1, 0.35], [588, 44, 1.2, 0.5],
                [702, 150, 1, 0.3], [820, 70, 1.3, 0.45], [940, 34, 1, 0.4], [1120, 60, 1.2, 0.45], [1270, 30, 1, 0.35],
                [1366, 96, 1.3, 0.5], [40, 210, 1, 0.3], [156, 290, 1.1, 0.3], [1400, 230, 1, 0.3], [1010, 180, 1, 0.3],
                [260, 40, 1, 0.4],
              ].map(([cx, cy, r, opacity]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity={opacity} />
              ))}
            </g>
          </svg>

          <div
            aria-hidden="true"
            className="moon-glow absolute bottom-0 left-1/2 aspect-square w-[clamp(230px,31vw,440px)] -translate-x-1/2 translate-y-1/2 rounded-full"
            style={{ background: "radial-gradient(circle at 40% 34%,#d85a69 0,#b0303f 48%,#7a1e2c 100%)" }}
          />
          <div aria-hidden="true" className="fog-a absolute -bottom-5 -left-[12%] h-[150px] w-[70%] rounded-full bg-[rgba(150,60,72,0.17)] blur-[46px]" />
          <div aria-hidden="true" className="fog-b absolute -bottom-[30px] -right-[14%] h-[130px] w-[64%] rounded-full bg-[rgba(237,230,225,0.08)] blur-[50px]" />

          {EMBERS.map((ember, index) => (
            <span
              key={index}
              className="ember"
              aria-hidden="true"
              style={
                {
                  left: ember.left,
                  bottom: ember.bottom,
                  "--size": `${ember.size}px`,
                  "--dur": `${ember.duration}s`,
                  "--delay": `${ember.delay}s`,
                  "--drift": `${ember.drift}px`,
                } as CSSProperties
              }
            />
          ))}

          <Ruins className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[120px] w-full text-[#0e0a0b]" />

          <div className="absolute inset-x-0 top-28 z-[3] px-6 text-center">
            <p className="rise eyebrow !tracking-[0.34em]">Code archaeology</p>
            <h1 className="display rise mt-4 text-[clamp(40px,6.6vw,96px)] leading-[0.98] tracking-[-0.03em]" style={{ "--delay": "120ms" } as CSSProperties}>
              {hello}, <em>Hunter.</em>
            </h1>
          </div>
        </div>

        {/* two known graves stand on the horizon, either side of the moon */}
        {DEMO_REPOS.map((demo, index) => (
          <button
            key={demo.label}
            type="button"
            disabled={busy}
            onClick={() => submit(demo)}
            className={clsx(
              "lift absolute z-[6] flex w-[clamp(150px,17vw,250px)] flex-col items-center gap-2 rounded-b-[10px] rounded-t-[125px] border border-border bg-surface px-4 pb-6 pt-[52px] text-center shadow-[inset_0_0_0_6px_var(--surface),inset_0_0_0_7px_var(--border)] hover:border-[#5a2630] disabled:opacity-60",
              index === 0 ? "left-[clamp(14px,6.5vw,110px)] top-[296px] min-h-[268px]" : "right-[clamp(14px,6.5vw,110px)] top-[316px] min-h-[250px]",
            )}
          >
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted">KNOWN GRAVE № {index + 1}</span>
            <demo.icon size={24} strokeWidth={1.6} className={index === 0 ? "text-rose" : "text-soft"} />
            <span className="title text-[22px] leading-[1.15]">{demo.label}</span>
            <span className={clsx("chip", demo.tagClass)}>{demo.tag}</span>
            <span className="hidden text-[13px] leading-normal text-muted min-[760px]:block">{demo.hint}</span>
          </button>
        ))}

        {/* below the surface */}
        <div
          className="relative z-[1] overflow-hidden px-5 pb-[130px] pt-[104px] sm:px-10"
          style={{ background: `${dots(0.045, 26, 0, 0)},${flecks(0.18, 2, 73, 53, 13, 9)},#0e0a0b` }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[120px]"
            style={{ background: "radial-gradient(ellipse 36% 100% at 50% 0,rgba(184,57,74,.32),transparent 72%)" }}
          />
          <svg aria-hidden="true" viewBox="0 0 1440 700" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <path d="M0 150C240 130 480 170 720 150S1200 130 1440 154" fill="none" stroke="#1d1517" strokeWidth="2" />
            <path d="M0 330C300 350 520 308 760 332S1220 352 1440 326" fill="none" stroke="#1a1315" strokeWidth="2" />
            <path d="M0 520C260 500 560 540 800 516S1240 496 1440 524" fill="none" stroke="#171113" strokeWidth="2" />
          </svg>
          {FRAGMENTS.map((fragment) => (
            <span key={fragment.text} aria-hidden="true" className="frag hidden min-[1100px]:block" style={fragment.style}>
              {fragment.text}
            </span>
          ))}

          <p className="relative mx-auto max-w-[640px] text-center text-[19px] leading-relaxed text-soft [text-wrap:pretty]">
            Every codebase has a graveyard: the functions, routes and packages nobody calls anymore. Let's find yours,
            examine the remains, and lay them to rest.
          </p>

          {/* the form is a trench cut into the soil */}
          <form
            id="survey"
            className="relative mx-auto mt-12 max-w-[1080px] rounded-[10px] border border-[#2a2223] bg-[#060404] px-5 pb-[26px] pt-[30px] shadow-[inset_0_20px_44px_rgba(0,0,0,0.9),0_1px_0_rgba(237,230,225,0.06),0_-1px_0_#3a2f30] sm:px-[34px]"
            onSubmit={(event) => {
              event.preventDefault();
              submit({ repoUrl, ref, subdir });
            }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
              <h2 className="title text-4xl leading-[1.1] tracking-[-0.01em]">Begin the survey</h2>
              <span className="text-[14.5px] text-muted">Paste a public GitHub repository. Python and FastAPI projects work best.</span>
            </div>
            <div className="mt-6 flex flex-wrap items-end gap-4">
              <div className="min-w-0 flex-[3_1_380px]">
                <label htmlFor="repo" className="label mb-2 block">
                  GitHub repository
                </label>
                <input
                  id="repo"
                  className="input !h-[60px] !text-lg font-mono"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </div>
              <div className="min-w-0 flex-[1_1_130px]">
                <label htmlFor="ref" className="label mb-2 block">
                  Branch, tag or SHA
                </label>
                <input id="ref" className="input !h-[60px] !text-base font-mono" placeholder="main" value={ref} onChange={(e) => setRef(e.target.value)} />
              </div>
              <div className="min-w-0 flex-[1_1_130px]">
                <label htmlFor="subdir" className="label mb-2 block">
                  Subdirectory
                </label>
                <input id="subdir" className="input !h-[60px] !text-base font-mono" placeholder="backend" value={subdir} onChange={(e) => setSubdir(e.target.value)} />
              </div>
              <button className="btn btn-primary btn-lg !h-[60px] flex-[1_1_200px]" type="submit" disabled={!repoUrl.trim() || busy}>
                <Shovel size={19} className={busy ? "animate-dig" : ""} />
                {busy ? "Digging…" : "Start the hunt"}
              </button>
            </div>
            {start.error && (
              <div className="mt-4">
                <ErrorBox message={start.error.message} />
              </div>
            )}
            <p className="mt-4 text-[13px] text-muted">A scan usually takes under a minute.</p>
          </form>

          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[150px]" style={{ background: "linear-gradient(transparent,#0b0a0a)" }} />
        </div>
      </section>

      {/* ============ SAMPLE DIG ============ */}
      <section id="sample" className="pb-10 pt-[72px]">
        <Container>
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
              <div className="min-w-0 flex-[1_1_460px]">
                <p className="eyebrow">Field log</p>
                <h2 className="display mt-3.5 text-[clamp(40px,5vw,68px)]">
                  Watch a dig, <em>start to finish.</em>
                </h2>
                <p className="mt-[18px] max-w-[520px] text-[17px] leading-relaxed text-soft">
                  A scripted run on a sample repository. Each stage digs a little deeper, and the remains turn up one by one.
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-lg shrink-0" onClick={toForm}>
                Try it on your repo <ArrowRight size={18} />
              </button>
            </div>
          </Reveal>
          <div className="mt-12">
            <Reveal>
              <SampleScan />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ============ KINDS OF REMAINS ============ */}
      <section id="kinds" className="pt-24">
        <Container>
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
              <div className="flex-[1_1_420px]">
                <p className="eyebrow">Specimens</p>
                <h2 className="display mt-3.5 text-[clamp(40px,5vw,68px)]">
                  Nine kinds of <em>remains</em>
                </h2>
              </div>
              <p className="max-w-[420px] flex-[1_1_320px] text-[17px] leading-relaxed text-soft">
                Each one gets its own headstone, so you can see at a glance what is buried where.
              </p>
            </div>
          </Reveal>
          <div className="mt-16 flex flex-wrap items-end justify-center gap-x-3.5 gap-y-[18px]">
            {KINDS.map((kind, index) => {
              const Icon = TYPE_ICONS[kind.type];
              return (
                <Reveal key={kind.type} rise delay={index * 70} className="max-w-[156px] flex-[1_1_124px]">
                  <div
                    className="lift flex flex-col items-center gap-2.5 rounded-b-lg rounded-t-[100px] border border-border bg-surface px-3 pb-4 pt-[46px] text-center hover:border-[#5a2630]"
                    style={{ height: kind.height }}
                  >
                    <Icon size={28} strokeWidth={1.6} className="text-rose" />
                    <span className="title text-xl leading-[1.1]">{kind.name}</span>
                    <span className="text-[12.5px] leading-snug text-muted">{kind.blurb}</span>
                    <span className="mt-auto font-mono text-[10.5px] tracking-[0.14em] text-muted">№ {String(index + 1).padStart(2, "0")}</span>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
        <div
          aria-hidden="true"
          className="h-14 border-t border-[#33292b]"
          style={{ background: "radial-gradient(rgba(237,230,225,.06) 1px,transparent 1.6px) 0 0/22px 22px,linear-gradient(#120d0e,#0b0a0a)" }}
        />
      </section>

      {/* ============ HOW THE DIG WORKS: strata ============ */}
      <section id="dig" className="pt-[104px]">
        <Container className="pb-[72px]">
          <Reveal>
            <p className="eyebrow">Stratigraphy</p>
            <h2 className="display mt-3.5 text-[clamp(44px,6vw,84px)] leading-[0.98] tracking-[-0.025em]">How the dig works</h2>
            <p className="mt-[18px] max-w-[520px] text-[17px] leading-relaxed text-soft">
              Five layers down. Each one leaves something behind for the next.
            </p>
          </Reveal>
        </Container>

        {STRATA.map((layer, index) => (
          <div
            key={layer.title}
            className="relative"
            style={{ marginTop: index === 0 ? 0 : -8, padding: layer.pad, background: layer.bg, clipPath: layer.clip }}
          >
            <Reveal>
              <div className="mx-auto flex max-w-[1360px] flex-wrap items-start gap-x-12 gap-y-6 pl-[clamp(20px,6vw,88px)] pr-5 sm:pr-10">
                <div className="w-[150px] shrink-0">
                  <div className="font-mono text-sm text-rose">{layer.range}</div>
                  <div className="mt-1.5 font-mono text-[11px] tracking-[0.2em] text-muted">LAYER {String(index + 1).padStart(2, "0")}</div>
                </div>
                <div className="min-w-0 flex-[1_1_380px]">
                  <h3 className="title text-[clamp(28px,3vw,40px)] leading-[1.1]">{layer.title}</h3>
                  <p className="mt-3.5 max-w-[560px] text-[16.5px] leading-[1.65] text-soft">{layer.text}</p>
                </div>
                <div className="flex-[0_1_230px]">
                  <div className="inline-block rounded-md border border-dashed border-[#4a4041] px-3.5 py-[9px] font-mono text-xs tracking-[0.06em] text-soft">
                    {layer.out}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        ))}

        <div
          className="relative px-5 pb-[104px] pt-24 sm:px-10"
          style={{
            marginTop: -8,
            background: `${dots(0.04, 30, 0, 0)},radial-gradient(rgba(122,30,44,.3) 3px,transparent 4px) 22px 12px/97px 61px,#0a0708`,
            clipPath: "polygon(0 4px,8% 9px,21% 1px,35% 8px,50% 0,64% 7px,79% 2px,92% 9px,100% 3px,100% 100%,0 100%)",
          }}
        >
          <Reveal>
            <div className="mx-auto max-w-[1360px] text-center">
              <p className="eyebrow">Bedrock</p>
              <h2 className="display mx-auto mt-[18px] max-w-[900px] text-[clamp(44px,6.4vw,92px)] leading-[0.98] tracking-[-0.025em]">
                <em>Your code is read,</em> never run.
              </h2>
              <div className="mt-10 flex flex-wrap justify-center gap-3 font-mono text-xs tracking-[0.14em]">
                {["STATIC ANALYSIS", "NOTHING EXECUTED", "NO AI IN THE LOOP"].map((label) => (
                  <span key={label} className="rounded-full border border-[#4a2330] bg-accent-soft px-[18px] py-[9px] text-[#f3c4cc]">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
