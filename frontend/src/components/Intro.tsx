import { ArrowRight, Skull } from "lucide-react";
import { useEffect, useRef } from "react";

const STARS: [number, number, number, number][] = [
  [86, 64, 1.2, 0.5], [212, 138, 1, 0.4], [340, 52, 1.4, 0.55], [470, 116, 1, 0.35], [588, 44, 1.2, 0.5],
  [820, 70, 1.3, 0.45], [940, 34, 1, 0.4], [1120, 60, 1.2, 0.45], [1270, 30, 1, 0.35], [1366, 96, 1.3, 0.5],
  [40, 260, 1, 0.3], [156, 330, 1.1, 0.3], [1400, 280, 1, 0.3], [1010, 160, 1, 0.3],
];

/** The one-time entrance: a closed cemetery gate with a plaque. The home page's gates swing open once it is dismissed. */
export function Intro({ onEnter }: { onEnter: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome"
      className="fixed inset-0 z-[60] isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 z-0 h-full w-full"
      >
        <g fill="#ede6e1">
          {STARS.map(([cx, cy, r, opacity]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity={opacity} />
          ))}
        </g>
        <path
          fill="#0e0a0b"
          d="M0 900V760h48V722l16-6v-24l28-4 6 30 28 6v36h88v-18l30-8 4 28h82l6-16 36-2 6 18h142v-32l18-12 22 12v32h130l6 12h124l4-28 38-8 4 36h114l4-44 16-18 20-4 10 22 4 44h116l4-30 36-4 4 34h66l2-52 14-10 4-28 26-4 6 34 18 6 2 56h108v100z"
        />
      </svg>

      <div
        aria-hidden="true"
        className="moon-glow absolute left-1/2 top-1/2 z-[1] aspect-square w-[clamp(340px,44vw,620px)] -translate-x-1/2 -translate-y-[56%] rounded-full"
        style={{ background: "radial-gradient(circle at 40% 34%,#d85a69 0,#b0303f 48%,#7a1e2c 100%)" }}
      />
      <div
        aria-hidden="true"
        className="fog-a absolute -left-[12%] bottom-[30px] z-[2] h-[170px] w-[70%] rounded-full bg-[rgba(150,60,72,0.18)] blur-[50px]"
      />

      <div aria-hidden="true" className="gate-leaf left-0 border-r border-[#4a3a3c]" />
      <div aria-hidden="true" className="gate-leaf right-0 border-l border-[#4a3a3c]" />

      <div className="absolute left-1/2 top-7 z-[5] flex -translate-x-1/2 items-center gap-3">
        <span className="flex h-[42px] w-[34px] items-center justify-center rounded-b-md rounded-t-[17px] border border-[#5a2630] bg-accent/[0.28] text-rose">
          <Skull size={18} strokeWidth={1.75} />
        </span>
        <span className="font-mono text-xs font-semibold leading-[1.35] tracking-[0.24em]">
          DEAD CODE
          <br />
          HUNTER
        </span>
      </div>

      <div className="relative z-[5] mb-[60px] mt-[90px] w-[min(400px,calc(100%-32px))] rounded-b-2xl rounded-t-[200px] border border-[#3a2f30] bg-surface px-10 pb-[52px] pt-24 text-center shadow-[inset_0_0_0_9px_var(--surface),inset_0_0_0_10px_#33292b,0_40px_100px_rgba(0,0,0,0.75)]">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="absolute left-1/2 top-11 -translate-x-1/2 text-rose"
        >
          <circle cx="12" cy="10" r="3" />
          <path d="M12 13v5" />
          <path d="M12 3a7 7 0 0 1 7 7v10H5V10a7 7 0 0 1 7-7z" />
        </svg>
        <p className="font-mono text-[11px] tracking-[0.34em] text-muted">CODE ARCHAEOLOGY</p>
        <h1 className="display mt-[18px] text-[44px] leading-[1.02] tracking-[-0.025em]">
          Every codebase has a <em>graveyard.</em>
        </h1>
        <p className="mx-auto mt-4 max-w-[290px] text-[15px] leading-relaxed text-soft">
          Find the code nobody calls anymore, and lay it to rest.
        </p>
        <button ref={button} type="button" onClick={onEnter} className="enter-button mt-[30px]">
          Enter the graveyard <ArrowRight size={18} />
        </button>
      </div>

      <p className="absolute inset-x-0 bottom-[26px] z-[5] text-center font-mono text-[11px] tracking-[0.26em] text-muted">
        PYTHON · FASTAPI · STATIC ANALYSIS
      </p>
    </div>
  );
}
