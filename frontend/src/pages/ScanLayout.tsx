import clsx from "clsx";
import { Check, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, ApiError, type ScanView } from "@/api/client";
import { useFindings, useScan } from "@/api/hooks";
import { Container, ErrorBox } from "@/components/Shell";
import { JourneyBar } from "@/components/JourneyBar";
import { repoLabel, repoTitle, shortSha } from "@/lib/format";
import { NAV } from "@/lib/lexicon";
import { STAGES, stageStates } from "@/lib/stages";
import { relativeTime } from "@/lib/time";
import { useScanSelection } from "@/state/selection";

export function useScanContext(): ScanView {
  return useOutletContext<ScanView>();
}

export function ScanLayout() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const { data: scan, error } = useScan(id);
  const { data: findings } = useFindings(id, {}, scan?.status === "done");
  const started = useRef(false);
  const selected = Object.keys(useScanSelection(id)).length;
  const navigate = useNavigate();
  const rescan = useMutation({
    mutationFn: () =>
      api.createScan({ repoUrl: scan!.repo_url, ref: scan!.ref ?? undefined, subdir: scan!.subdir ?? undefined }),
    onSuccess: ({ scanId }) => navigate(`/scans/${scanId}`),
  });

  const run = () => {
    // The request returns when the job ends on the inline runner; progress comes from polling.
    api
      .runScan(id)
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 409)) console.error("Starting the scan failed", e);
      })
      .finally(() => queryClient.invalidateQueries({ queryKey: ["scan", id] }));
    // A retried scan is cached as "failed", which stops polling; refetch once it has been claimed.
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["scan", id] }), 400);
  };

  useEffect(() => {
    if (scan?.status === "pending" && !started.current) {
      started.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.status]);

  if (error)
    return (
      <Container className="pt-10">
        <ErrorBox message={error instanceof ApiError && error.status === 404 ? "Scan not found." : error.message} />
      </Container>
    );
  if (!scan)
    return (
      <Container className="pt-10">
        <p className="text-muted">Loading…</p>
      </Container>
    );

  if (scan.status === "failed") {
    return (
      <Container className="pt-10">
        <h1 className="display text-4xl">{repoLabel(scan.repo_url)}</h1>
        <div className="mt-6">
          <ErrorBox
            message={scan.error ?? "The scan failed."}
            onRetry={() => {
              started.current = true;
              run();
            }}
          />
        </div>
      </Container>
    );
  }

  if (scan.status !== "done") return <Progress scan={scan} />;

  const overview = pathname.replace(/\/+$/, "") === `/scans/${id}`;
  const [lead, last] = repoTitle(scan.repo_url);
  const meta = [repoLabel(scan.repo_url), scan.subdir, scan.ref, shortSha(scan.commit_sha)].filter(Boolean).join(" · ");
  const lastScanned = scan.finished_at ? `Last scanned ${relativeTime(scan.finished_at)}` : "";

  const tabs = [
    { to: "", label: NAV.graveyard.label, end: true, count: 0 },
    { to: "findings", label: NAV.remains.label, count: findings?.total ?? 0 },
    { to: "graph", label: NAV.catacombs.label, count: 0 },
    { to: "cleanup", label: NAV.burial.label, count: selected },
  ];

  const rescanButton = (
    <button className="btn" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
      <RefreshCw size={16} className={rescan.isPending ? "animate-spin" : ""} />
      Scan again
    </button>
  );

  return (
    <>
      {overview ? (
        <section className="relative overflow-hidden border-b border-[#1f1a1b]">
          <div
            aria-hidden="true"
            className="fog-drift pointer-events-none absolute -bottom-[70px] -left-[10%] h-40 w-[70%] rounded-full bg-[rgba(150,60,72,0.16)] blur-[50px]"
          />
          <Container className="relative flex flex-wrap items-end justify-between gap-x-10 gap-y-6 pb-11 pt-[52px]">
            <div className="min-w-0 flex-1 basis-[420px]">
              <p className="eyebrow">Survey of</p>
              <h1 className="display mt-3 break-words text-[clamp(40px,5.4vw,76px)]">
                {lead}
                <em>{last}</em>
              </h1>
              <p className="mt-3.5 font-mono text-[13px] text-muted">{[meta, lastScanned].filter(Boolean).join(" · ")}</p>
            </div>
            {rescanButton}
          </Container>
        </section>
      ) : (
        <Container className="pt-9">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-[18px] gap-y-2">
              <h1 className="display text-[34px] leading-[1.1]">
                {lead}
                <em>{last}</em>
              </h1>
              {lastScanned && <span className="font-mono text-xs text-muted">{lastScanned}</span>}
            </div>
            {rescanButton}
          </div>
        </Container>
      )}

      <Container className={overview ? "pt-9" : "pt-6"}>
        {overview && <JourneyBar scanId={id} />}
        <nav aria-label="Scan sections" className={clsx("flex flex-wrap gap-2.5", overview && "mt-[30px]")}>
          {tabs.map(({ to, label, end, count }) => (
            <NavLink key={label} to={to} end={end} className={({ isActive }) => clsx("pill", isActive && "pill-on")}>
              {label}
              {count > 0 && <span className="font-mono text-xs text-rose">{count}</span>}
            </NavLink>
          ))}
        </nav>
      </Container>

      <Outlet context={scan} />
    </>
  );
}

/** The scan in progress, drawn as a depth gauge: each stage is a layer further down. */
function Progress({ scan }: { scan: ScanView }) {
  const states = stageStates(scan.stage, scan.status);
  const depths = ["0.0 m", "0.5 m", "2.0 m", "3.5 m", "5.0 m"];
  return (
    <Container className="pt-16">
      <div className="mx-auto max-w-lg">
        <p className="eyebrow">Survey of {repoLabel(scan.repo_url)}</p>
        <h1 className="display mt-3 text-5xl">
          Digging <em>in…</em>
        </h1>
        <p className="mt-3 text-soft">Nothing here is executed. We only read.</p>

        <div className="mt-8 rounded-[20px] border border-border bg-[#100d0e] p-7">
          <div className="label">Depth gauge</div>
          <ol className="relative mt-6 flex flex-col gap-6">
            <span aria-hidden="true" className="absolute bottom-3 left-2.5 top-3 w-px bg-[#2f292a]" />
            {STAGES.map((stage, index) => (
              <li key={stage.key} className="relative flex items-start gap-4">
                <span
                  className={clsx(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
                    states[index] === "done" && "border-accent-hover bg-accent",
                    states[index] === "active" && "animate-pulse border-rose bg-bg",
                    states[index] === "todo" && "border-strong bg-bg",
                  )}
                >
                  {states[index] === "done" && <Check size={12} strokeWidth={3} />}
                </span>
                <div>
                  <div
                    className={clsx(
                      "title text-xl leading-tight",
                      states[index] === "done" && "text-soft",
                      states[index] === "todo" && "text-muted",
                    )}
                  >
                    {stage.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] tracking-[0.1em] text-muted">
                    {depths[index]} · {states[index] === "done" ? "done" : states[index] === "active" ? "digging" : "waiting"}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <div className="bar-track !h-1">
              <div className="bar-fill !bg-rose transition-all duration-500" style={{ width: `${Math.max(scan.progress, 3)}%` }} />
            </div>
            <div className="mt-2.5 font-mono text-[11px] tracking-[0.14em] text-muted">{scan.progress}% EXCAVATED</div>
          </div>
        </div>
      </div>
    </Container>
  );
}
