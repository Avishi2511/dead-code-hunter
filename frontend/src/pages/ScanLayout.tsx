import clsx from "clsx";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { api, ApiError, type ScanView } from "@/api/client";
import { useScan } from "@/api/hooks";
import { ErrorBox, PageTitle } from "@/components/Shell";
import { repoLabel, shortSha } from "@/lib/format";
import { STAGES, stageStates } from "@/lib/stages";
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
    { to: "", label: "Dashboard", end: true },
    { to: "findings", label: "Findings" },
    { to: "graph", label: "Graph" },
    { to: "cleanup", label: `Cleanup${selected ? ` (${selected})` : ""}` },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-sm">{repoLabel(scan.repo_url)}</div>
          <div className="font-mono text-xs text-muted">
            {[scan.subdir, scan.ref, shortSha(scan.commit_sha)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                clsx("rounded-md px-3 py-1.5 text-sm", isActive ? "bg-accent text-text" : "text-muted hover:text-text")
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet context={scan} />
    </>
  );
}

function Progress({ scan }: { scan: ScanView }) {
  const states = stageStates(scan.stage, scan.status);
  return (
    <div className="mx-auto max-w-lg pt-10">
      <h1 className="text-xl font-semibold tracking-tight">Hunting through {repoLabel(scan.repo_url)}…</h1>
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
