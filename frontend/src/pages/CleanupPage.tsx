import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, CircleCheck, Copy, Download, FileText, GitMerge, Minus, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, patchUrl, reportUrl, type Action, type CleanupView } from "@/api/client";
import { useCleanup, useFindings } from "@/api/hooks";
import { IconTile } from "@/components/Brand";
import { DiffView } from "@/components/DiffView";
import { ErrorBox, PageTitle } from "@/components/Shell";
import { diffFileName, fileStats, parseUnifiedDiff, splitDiffByFile } from "@/lib/diff";
import { pluralize, typeLabel } from "@/lib/format";
import { TILE_LABELS } from "@/lib/icons";
import { useScanSelection, useSelection } from "@/state/selection";

export function CleanupPage() {
  const { id = "" } = useParams();
  const selection = useScanSelection(id);
  const { set, clear } = useSelection.getState();
  const [cleanupId, setCleanupId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const ids = Object.keys(selection);
  const { data: findings } = useFindings(id);
  const byId = useMemo(() => new Map((findings?.items ?? []).map((f) => [f.id, f])), [findings]);
  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const findingId of ids) {
      const type = byId.get(findingId)?.type ?? "unknown";
      groups.set(type, [...(groups.get(type) ?? []), findingId]);
    }
    return [...groups.entries()];
  }, [ids, byId]);

  const prepare = useMutation({
    mutationFn: async () => {
      const created = await api.createCleanup(
        id,
        ids.map((findingId) => ({ findingId, action: selection[findingId] })),
      );
      setCleanupId(created.cleanupId);
      setConfirmed(false);
      // Inline runners answer when the job is done; background runners answer at once. Polling covers both.
      void api.runCleanup(created.cleanupId).catch(() => undefined);
      return created;
    },
  });
  const cleanup = useCleanup(cleanupId);
  const result = cleanup.data;
  const retry = () => cleanupId && void api.runCleanup(cleanupId).catch(() => undefined);
  const backToSelection = () => {
    setCleanupId(null);
    setConfirmed(false);
  };

  if (cleanupId && result?.status === "failed") {
    return (
      <>
        <PageTitle title="Cleanup" />
        <ErrorBox message={result.error ?? "The cleanup failed."} onRetry={retry} />
        <button className="btn mt-4" onClick={backToSelection}>
          <ArrowLeft size={15} /> Back to selection
        </button>
      </>
    );
  }

  if (cleanupId && result?.status === "done" && result.summary && result.validation) {
    return confirmed ? (
      <Ready result={result} cleanupId={cleanupId} />
    ) : (
      <Plan
        result={result}
        grouped={grouped}
        onBack={backToSelection}
        onConfirm={() => setConfirmed(true)}
      />
    );
  }

  if (cleanupId) {
    return (
      <>
        <PageTitle title="Cleanup Plan" subtitle="Applying the changes to a copy and validating them…" />
        <p className="text-sm text-muted">Working on it…</p>
      </>
    );
  }

  if (ids.length === 0) {
    return (
      <>
        <PageTitle title="Cleanup" />
        <div className="card px-5 py-10 text-center">
          <p className="text-sm text-muted">Nothing selected yet.</p>
          <Link to="../findings" relative="path" className="btn btn-primary mt-4 inline-flex">
            Pick findings
          </Link>
          <p className="mt-3 text-xs text-muted">"Select all High" on the findings page is a good start.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title="Cleanup" subtitle="Review what you selected, then preview the changes.">
        <div className="flex gap-2">
          <button className="btn" onClick={() => clear(id)}>
            Clear selection
          </button>
          <button className="btn btn-primary" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
            {prepare.isPending ? "Preparing…" : "Preview & validate"}
          </button>
        </div>
      </PageTitle>
      {prepare.error && (
        <div className="mb-4">
          <ErrorBox message={prepare.error.message} />
        </div>
      )}
      <section className="space-y-4">
        {grouped.map(([type, group]) => (
          <div key={type} className="card">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <IconTile type={type} size="sm" />
              <span className="text-sm font-medium">{typeLabel(type)}</span>
              <span className="text-xs text-muted">{pluralize(group.length, "finding")}</span>
            </div>
            <ul className="divide-y divide-border">
              {group.map((findingId) => {
                const finding = byId.get(findingId);
                return (
                  <li key={findingId} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <Link
                      to={`../findings/${encodeURIComponent(findingId)}`}
                      relative="path"
                      className="min-w-0 flex-1 truncate font-mono hover:underline"
                    >
                      {finding?.name ?? findingId}
                    </Link>
                    <span className="hidden truncate font-mono text-xs text-muted md:block">{finding?.file}</span>
                    <select
                      className="input !w-auto !py-1"
                      value={selection[findingId]}
                      aria-label={`Action for ${finding?.name ?? findingId}`}
                      onChange={(e) => set(id, findingId, e.target.value as Action)}
                    >
                      <option value="remove">Remove</option>
                      <option value="mark_alive">Mark as safe</option>
                    </select>
                    <button className="text-muted hover:text-text" aria-label="Drop" onClick={() => set(id, findingId, null)}>
                      <X size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

function Plan({
  result,
  grouped,
  onBack,
  onConfirm,
}: {
  result: CleanupView;
  grouped: [string, string[]][];
  onBack: () => void;
  onConfirm: () => void;
}) {
  const summary = result.summary!;
  const validation = result.validation!;
  const files = useMemo(() => parseUnifiedDiff(result.diff ?? ""), [result.diff]);
  const chunks = useMemo(() => splitDiffByFile(result.diff ?? ""), [result.diff]);
  const [current, setCurrent] = useState(0);
  const file = files[Math.min(current, Math.max(files.length - 1, 0))];
  const name = file ? diffFileName(file) : "";

  return (
    <div className="space-y-6">
      <PageTitle title="Cleanup Plan" subtitle="Review the proposed changes before applying them.">
        <div className="flex gap-2">
          <button className="btn" onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </button>
          <ConfirmDialog failed={validation.compileall === "fail" || validation.ruff === "fail" || validation.typecheck === "fail"} onConfirm={onConfirm} />
        </div>
      </PageTitle>

      <section className="card grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="label">{pluralize(summary.findings, "finding")} selected</p>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            {grouped.map(([type, group]) => (
              <div key={type} className="flex items-center gap-3">
                <IconTile type={type} size="sm" />
                <span>
                  <span className="block font-mono text-lg leading-none">{group.length}</span>
                  <span className="text-xs text-muted">{TILE_LABELS[type] ?? typeLabel(type)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-8 border-border sm:border-l sm:pl-8">
          <Figure label="Files affected" value={summary.files_changed} />
          <Figure label="Lines removed" value={summary.lines_removed} prefix="~" />
        </div>
      </section>

      {((summary.covered ?? []).length > 0 || (summary.manual ?? []).length > 0) && (
        <p className="text-sm text-muted">
          {pluralize((summary.covered ?? []).length, "selected finding")} already covered by a larger removal
          {(summary.manual ?? []).length > 0 && `; ${pluralize((summary.manual ?? []).length, "finding")} need a manual change`}.
        </p>
      )}

      {files.length > 0 && (
        <section className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <div className="card self-start">
            <p className="label border-b border-border px-4 py-2.5">Changes</p>
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
              {files.map((f, index) => {
                const stats = fileStats(f);
                return (
                  <li key={diffFileName(f)}>
                    <button
                      onClick={() => setCurrent(index)}
                      className={clsx(
                        "flex w-full items-center gap-2 px-4 py-2 text-left font-mono text-xs transition-colors hover:bg-surface-2",
                        index === current && "bg-accent-soft",
                      )}
                    >
                      <FileText size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">{diffFileName(f)}</span>
                      <span className="shrink-0 text-[#d98a96]">
                        <Minus size={10} className="mb-0.5 inline" />
                        {stats.removed}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0">
            <p className="label mb-2">Proposed changes</p>
            <DiffView key={name} diff={chunks[name] ?? result.diff ?? ""} defaultView="split" />
          </div>
        </section>
      )}

      <ValidationList validation={validation} />
    </div>
  );
}

function Figure({ label, value, prefix = "" }: { label: string; value: number; prefix?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl">
        {prefix}
        {value.toLocaleString()}
      </p>
    </div>
  );
}

const CHECKS = [
  ["compileall", "Python syntax check"],
  ["ruff", "Import and undefined-name analysis"],
  ["typecheck", "Type check"],
] as const;

function ValidationList({ validation }: { validation: NonNullable<CleanupView["validation"]> }) {
  const issues = [...(validation.ruff_new_issues ?? []), ...(validation.typecheck_new_errors ?? [])];
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Validation checks</h2>
      <ul className="card divide-y divide-border text-sm">
        {CHECKS.map(([key, label]) => {
          const value = validation[key];
          return (
            <li key={key} className="flex items-center gap-3 px-4 py-2.5">
              {value === "pass" ? (
                <Check size={16} className="text-[#8fb09d]" />
              ) : value === "fail" ? (
                <TriangleAlert size={16} className="text-[#d98a96]" />
              ) : (
                <Minus size={16} className="text-muted" />
              )}
              <span className="flex-1">{label}</span>
              <span className={value === "fail" ? "text-[#d98a96]" : "text-muted"}>
                {value === "pass" ? "passed" : value === "fail" ? "needs attention" : "skipped"}
              </span>
            </li>
          );
        })}
      </ul>
      {issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 font-mono text-xs text-muted">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {(validation.notes ?? []).map((note) => (
        <p key={note} className="mt-2 text-xs text-muted">
          {note}
        </p>
      ))}
      <p className="mt-2 text-xs text-muted">Checks are static. Your project's own tests are not run.</p>
    </section>
  );
}

function Ready({ result, cleanupId }: { result: CleanupView; cleanupId: string }) {
  const summary = result.summary!;
  const validation = result.validation!;
  const failed = [validation.compileall, validation.ruff, validation.typecheck].includes("fail");
  const command = `curl -sL ${window.location.origin}${patchUrl(cleanupId)} | git apply`;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <span
          className={clsx(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2",
            failed ? "border-accent-hover text-[#d98a96]" : "border-[#8fb09d] text-[#8fb09d]",
          )}
        >
          {failed ? <TriangleAlert size={26} /> : <CircleCheck size={28} />}
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{failed ? "Cleanup needs review" : "Cleanup Ready"}</h1>
          <p className="mt-1 text-sm text-muted">
            {failed
              ? "Some checks found new problems. Read them below before applying anything."
              : "Your changes were checked statically and are ready to apply. Nothing in your repository has been touched."}
          </p>
        </div>
      </div>

      <section className="card grid grid-cols-3 gap-4 p-5">
        <Figure label="Findings selected" value={summary.findings} />
        <Figure label="Files affected" value={summary.files_changed} />
        <Figure label="Lines removed" value={summary.lines_removed} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ValidationList validation={validation} />
        <section>
          <h2 className="mb-3 text-sm font-semibold">Next steps</h2>
          <ul className="space-y-3">
            <Step
              icon={GitMerge}
              title="Apply changes locally"
              text="Run from the root of your clone; the patch is also valid for git am."
              badge={failed ? undefined : "Recommended"}
              action={<CopyButton text={command} label="Copy command" />}
              code={command}
            />
            <Step
              icon={Download}
              title="Download patch"
              text="Get the .patch file and apply it yourself."
              action={
                <a className="btn" href={patchUrl(cleanupId)} download>
                  Download
                </a>
              }
            />
            <Step
              icon={FileText}
              title="Download cleanup report"
              text="What was removed, the evidence, and validation results."
              action={
                <a className="btn" href={reportUrl(cleanupId)} download>
                  Download
                </a>
              }
            />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  text,
  badge,
  action,
  code,
}: {
  icon: typeof Download;
  title: string;
  text: string;
  badge?: string;
  action: React.ReactNode;
  code?: string;
}) {
  return (
    <li className="card flex items-start gap-3 p-4">
      <IconTile icon={Icon} size="sm" muted />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge && <span className="rounded border border-[#8fb09d]/50 px-1.5 py-0.5 text-[10px] text-[#8fb09d]">{badge}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted">{text}</p>
        {code && <p className="mt-2 break-all font-mono text-[11px] text-muted">{code}</p>}
      </div>
      {action}
    </li>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard not available */
        }
      }}
    >
      <Copy size={14} />
      {copied ? "Copied" : label}
    </button>
  );
}

function ConfirmDialog({ onConfirm, failed }: { onConfirm: () => void; failed: boolean }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="btn btn-primary">Validate &amp; Continue</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70" />
        <Dialog.Content className="card fixed left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 p-6">
          <Dialog.Title className="text-lg font-semibold">Before you apply this</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">
            These changes come from static analysis. Nothing has been changed in your repository, and the patch is yours
            to review and apply.
            {failed && " Some validation checks reported new problems."}
          </Dialog.Description>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#7a1e2c]"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I reviewed the diff and understand it may remove code used outside static analysis's view.
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="btn">Cancel</button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <button className="btn btn-primary" disabled={!acknowledged} onClick={onConfirm}>
                Continue
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
