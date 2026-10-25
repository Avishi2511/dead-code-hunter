import clsx from "clsx";
import { Network, RefreshCw, Scissors, Search, Skull } from "lucide-react";
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, ApiError, type ScanView } from "@/api/client";
import { useScan } from "@/api/hooks";
import { GithubMark } from "@/components/Brand";
import { ErrorBox, PageTitle } from "@/components/Shell";
import { repoLabel, shortSha } from "@/lib/format";
import { STAGES, stageStates } from "@/lib/stages";
import { NAV } from "@/lib/lexicon";
import { relativeTime } from "@/lib/time";
import { JourneyBar } from "@/components/JourneyBar";
import { useScanSelection } from "@/state/selection";

export function useScanContext(): ScanView {
  return useOutletContext<ScanView>();
}

export function ScanLayout() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: scan, error } = useScan(id);
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

  if (error) return <ErrorBox message={error instanceof ApiError && error.status === 404 ? "Scan not found." : error.message} />;
  if (!scan) return <p className="text-muted">Loading…</p>;

  if (scan.status === "failed") {
    return (
      <>
        <PageTitle title={repoLabel(scan.repo_url)} />
        <ErrorBox
          message={scan.error ?? "The scan failed."}
          onRetry={() => {
            started.current = true;
            run();
          }}
        />
      </>
    );
  }

  if (scan.status !== "done") return <Progress scan={scan} />;

  const tabs = [
    { to: "", label: NAV.graveyard.label, icon: Skull, end: true },
    { to: "findings", label: NAV.remains.label, icon: Search },
    { to: "graph", label: NAV.catacombs.label, icon: Network },
    { to: "cleanup", label: `${NAV.burial.label}${selected ? ` (${selected})` : ""}`, icon: Scissors },
  ];

  return (
    <>
      <header className="hero-slim card mb-4 flex flex-wrap items-center gap-4 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-2">
          <GithubMark size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-base font-medium">{repoLabel(scan.repo_url)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>Python · FastAPI</span>
            {[scan.subdir, scan.ref, shortSha(scan.commit_sha)].filter(Boolean).map((part) => (
              <span key={part} className="font-mono">
                · {part}
              </span>
            ))}
            {scan.finished_at && <span>· Last scanned {relativeTime(scan.finished_at)}</span>}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
          <RefreshCw size={15} className={rescan.isPending ? "animate-spin" : ""} />
          Scan again
        </button>
      </header>
      <JourneyBar scanId={id} />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                "-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition-colors",
                isActive ? "border-accent-hover text-text" : "border-transparent text-muted hover:text-text",
              )
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={scan} />
    </>
  );
}

function Progress({ scan }: { scan: ScanView }) {
  const states = stageStates(scan.stage, scan.status);
  return (
    <div className="mx-auto max-w-lg pt-10">
      <h1 className="title text-3xl">Surveying {repoLabel(scan.repo_url)}…</h1>
      <p className="mt-1 text-sm text-muted">Nothing here is executed. We only read.</p>
      <div className="mt-6 h-1.5 overflow-hidden rounded bg-surface-2">
        <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.max(scan.progress, 3)}%` }} />
      </div>
      <ol className="mt-6 space-y-2.5">
        {STAGES.map((stage, index) => (
          <li key={stage.key} className="flex items-center gap-3 text-sm">
            <span
              className={clsx(
                "h-2.5 w-2.5 rounded-full border",
                states[index] === "done" && "border-accent bg-accent",
                states[index] === "active" && "animate-pulse border-accent-hover bg-accent-hover",
                states[index] === "todo" && "border-border",
              )}
            />
            <span className={states[index] === "todo" ? "text-muted" : ""}>{stage.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
