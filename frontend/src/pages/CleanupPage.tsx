import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, Copy, Download, FileText, Minus, Shovel, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, patchUrl, reportUrl, type Action, type CleanupView } from "@/api/client";
import { useCleanup, useFindings } from "@/api/hooks";
import { EmptyState, IconTile } from "@/components/Brand";
import { DiffView } from "@/components/DiffView";
import { Container, ErrorBox, SectionHead } from "@/components/Shell";
import { diffFileName, fileStats, parseUnifiedDiff, splitDiffByFile } from "@/lib/diff";
import { pluralize, typeLabel } from "@/lib/format";
import { EPITAPHS } from "@/lib/lexicon";
import { useScanSelection, useSelection } from "@/state/selection";

export function CleanupPage() {
  const { id = "" } = useParams();
  const selection = useScanSelection(id);
  const { set, clear, markBuried } = useSelection.getState();
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
      <Container className="pt-12">
        <ErrorBox message={result.error ?? "The burial failed."} onRetry={retry} />
        <button className="btn mt-4" onClick={backToSelection}>
          <ArrowLeft size={15} /> Back to selection
        </button>
      </Container>
    );
  }

  if (cleanupId && result?.status === "done" && result.summary && result.validation) {
    return confirmed ? (
      <Ready result={result} cleanupId={cleanupId} />
    ) : (
      <Plan
        result={result}
        onBack={backToSelection}
        onConfirm={() => {
          markBuried(id);
          setConfirmed(true);
        }}
      />
    );
  }

  if (cleanupId) {
    return (
      <Container className="pt-14">
        <p className="eyebrow">Burial plan</p>
        <h2 className="display mt-3 text-[clamp(40px,5vw,68px)]">
          Digging<em>…</em>
        </h2>
        <p className="mt-4 text-soft">Applying the changes to a copy and checking for a pulse.</p>
      </Container>
    );
  }

  if (ids.length === 0) {
    return (
      <Container className="pt-14">
        <SectionHead eyebrow="The Burial">
          Nothing is <em>marked yet.</em>
        </SectionHead>
        <div className="mt-9">
          <EmptyState epitaph={EPITAPHS.nothingMarked}>
            <Link to="../findings" relative="path" className="btn btn-primary inline-flex">
              Examine the remains
            </Link>
            <p className="mt-3 text-xs text-muted">"Mark all certified dead" is a good start.</p>
          </EmptyState>
        </div>
      </Container>
    );
  }

  return (
    <Container className="pt-14">
      <SectionHead
        eyebrow="The Burial"
        aside={
          <div className="flex gap-3">
            <button className="btn btn-lg" onClick={() => clear(id)}>
              Clear selection
            </button>
            <button className="btn btn-primary btn-lg" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
              <Shovel size={18} />
              {prepare.isPending ? "Digging…" : "Preview the burial"}
            </button>
          </div>
        }
      >
        Review <em>what you marked.</em>
      </SectionHead>
      {prepare.error && (
        <div className="mt-6">
          <ErrorBox message={prepare.error.message} />
        </div>
      )}
      <section className="mt-9 space-y-4">
        {grouped.map(([type, group]) => (
          <div key={type} className="overflow-hidden rounded-[20px] border border-border bg-surface">
            <div className="flex items-center gap-3.5 border-b border-border bg-surface-2 px-6 py-3">
              <IconTile type={type} size="sm" />
              <span className="title text-xl">{typeLabel(type)}</span>
              <span className="font-mono text-xs text-muted">{pluralize(group.length, "finding")}</span>
            </div>
            <ul>
              {group.map((findingId) => {
                const finding = byId.get(findingId);
                return (
                  <li key={findingId} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#231e1f] px-6 py-3 text-sm first:border-t-0">
                    <Link
                      to={`../findings/${encodeURIComponent(findingId)}`}
                      relative="path"
                      className="min-w-0 flex-[1_1_220px] truncate font-mono hover:underline"
                    >
                      {finding?.name ?? findingId}
                    </Link>
                    <span className="hidden truncate font-mono text-xs text-muted md:block">{finding?.file}</span>
                    <select
                      className="btn !appearance-none !bg-bg !py-1.5 !text-[13px]"
                      value={selection[findingId]}
                      aria-label={`Action for ${finding?.name ?? findingId}`}
                      onChange={(e) => set(id, findingId, e.target.value as Action)}
                    >
                      <option value="remove">Remove</option>
                      <option value="mark_alive">Mark as safe</option>
                    </select>
                    <button className="text-muted hover:text-text" aria-label="Drop" onClick={() => set(id, findingId, null)}>
                      <X size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </Container>
  );
}

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function Plan({ result, onBack, onConfirm }: { result: CleanupView; onBack: () => void; onConfirm: () => void }) {
  const summary = result.summary!;
  const validation = result.validation!;
  const files = useMemo(() => parseUnifiedDiff(result.diff ?? ""), [result.diff]);
  const chunks = useMemo(() => splitDiffByFile(result.diff ?? ""), [result.diff]);
  const [current, setCurrent] = useState(0);
  const file = files[Math.min(current, Math.max(files.length - 1, 0))];
  const name = file ? diffFileName(file) : "";
  const failed = [validation.compileall, validation.ruff, validation.typecheck].includes("fail");
  const fileCount = summary.files_changed;
  const fileWord = NUMBER_WORDS[fileCount] ?? fileCount.toLocaleString();

  return (
    <Container className="pt-14">
      <p className="eyebrow">Burial plan</p>
      <h2 className="display mt-3 text-[clamp(40px,5vw,68px)]">
        {fileWord} {fileCount === 1 ? "file" : "files"}, <em>{summary.lines_removed.toLocaleString()} lines</em> laid to rest.
      </h2>

      {((summary.covered ?? []).length > 0 || (summary.manual ?? []).length > 0) && (
        <p className="mt-4 text-sm text-soft">
          {pluralize((summary.covered ?? []).length, "selected finding")} already covered by a larger removal
          {(summary.manual ?? []).length > 0 && `; ${pluralize((summary.manual ?? []).length, "finding")} need a manual change`}.
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-start gap-7">
        <div className="min-w-0 max-w-[380px] flex-[1_1_300px]">
          <div className="label">Files affected</div>
          <div className="mt-3.5 flex flex-col gap-2.5">
            {files.map((f, index) => {
              const stats = fileStats(f);
              return (
                <button
                  key={diffFileName(f)}
                  type="button"
                  aria-pressed={index === current}
                  onClick={() => setCurrent(index)}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors hover:border-[#4a4041]",
                    index === current ? "border-accent-hover bg-accent/20" : "border-border",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[13px] [overflow-wrap:anywhere]">{diffFileName(f)}</span>
                    <span className="mt-0.5 block text-xs text-muted">{f.type === "delete" ? "whole file removed" : "lines removed"}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[13px] text-rose">−{stats.removed}</span>
                </button>
              );
            })}
          </div>
          <ValidationList validation={validation} />
        </div>

        <div className="min-w-0 flex-[3_1_640px]">
          {files.length > 0 ? (
            <DiffView key={name} diff={chunks[name] ?? result.diff ?? ""} defaultView="split" />
          ) : (
            <p className="text-sm text-muted">No textual change to show.</p>
          )}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-[18px] border border-border bg-surface px-[26px] py-[22px]">
        <p className="max-w-[640px] text-[15px] leading-normal text-soft">
          Nothing is changed in your repository. You get a patch to apply yourself.
        </p>
        <div className="flex gap-3">
          <button className="btn btn-lg" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <ConfirmDialog failed={failed} lines={summary.lines_removed} files={fileCount} onConfirm={onConfirm} />
        </div>
      </div>
    </Container>
  );
}

const CHECKS = [
  ["compileall", "Syntax check", "Every patched file still parses."],
  ["ruff", "Static checks", "No new undefined names after removal."],
  ["typecheck", "Type check", "No new type errors after removal."],
] as const;

function ValidationList({ validation }: { validation: NonNullable<CleanupView["validation"]> }) {
  const issues = [...(validation.ruff_new_issues ?? []), ...(validation.typecheck_new_errors ?? [])];
  return (
    <section>
      <div className="label mt-[34px]">Validation</div>
      <ul className="mt-3.5 flex flex-col gap-3">
        {CHECKS.map(([key, label, detail]) => {
          const value = validation[key];
          return (
            <li key={key} className="flex items-start gap-3">
              <span
                className={clsx(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border",
                  value === "pass" && "border-ok bg-ok/[0.18] text-[#b6cdb3]",
                  value === "fail" && "border-accent-hover bg-accent/40 text-rose",
                  value !== "pass" && value !== "fail" && "border-strong text-muted",
                )}
              >
                {value === "pass" ? <Check size={12} strokeWidth={3} /> : value === "fail" ? <TriangleAlert size={12} /> : <Minus size={12} />}
              </span>
              <span className="text-sm leading-normal">
                <strong className="font-semibold">
                  {label} {value === "pass" ? "passed" : value === "fail" ? "needs attention" : "skipped"}
                </strong>
                <br />
                <span className="text-muted">{detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {issues.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 font-mono text-xs text-muted">
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
      <p className="mt-3 text-xs text-muted">Checks are static. Your project's own tests are not run.</p>
    </section>
  );
}

function Ready({ result, cleanupId }: { result: CleanupView; cleanupId: string }) {
  const summary = result.summary!;
  const validation = result.validation!;
  const failed = [validation.compileall, validation.ruff, validation.typecheck].includes("fail");
  const command = `curl -sL ${window.location.origin}${patchUrl(cleanupId)} | git apply`;

  return (
    <>
      <section className="relative mt-14 overflow-hidden border-t border-[#1f1a1b] pb-24 pt-[88px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-[140px] left-1/2 -ml-[260px] h-[520px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(circle,rgba(184,57,74,.3),transparent 65%)" }}
        />
        <Container className="relative flex flex-wrap items-center gap-x-[72px] gap-y-14">
          <div className="min-w-0 flex-[1_1_420px]">
            <p className="eyebrow">{failed ? "The burial is postponed" : "The burial is done"}</p>
            <h2 className="display mt-4 text-[clamp(64px,9vw,136px)] font-light leading-[0.9] tracking-[-0.04em]">
              {failed ? (
                <>
                  <em>Not</em> yet.
                </>
              ) : (
                <>
                  <em>Rest</em> in peace.
                </>
              )}
            </h2>
            <p className="mt-6 max-w-[460px] text-[17px] leading-relaxed text-soft">
              {failed
                ? "Some checks found new problems. Read them below before applying anything."
                : `${summary.lines_removed.toLocaleString()} lines across ${pluralize(summary.files_changed, "file")}, ready to leave your codebase. Take the patch with you.`}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="btn btn-primary btn-lg" href={patchUrl(cleanupId)} download>
                <Download size={18} /> Download patch
              </a>
              <a className="btn btn-lg" href={reportUrl(cleanupId)} download>
                <FileText size={18} /> Download report
              </a>
            </div>
          </div>

          <div className="max-w-[520px] flex-[1_1_380px] rounded-b-[14px] rounded-t-[200px] border border-[#33292b] bg-surface px-11 pb-12 pt-[84px] shadow-[inset_0_0_0_8px_var(--surface),inset_0_0_0_9px_var(--border)]">
            <div className="label text-center">Next steps</div>
            <ol className="mt-[22px] flex flex-col gap-5">
              <Step n={1}>Download the patch into the root of your repository.</Step>
              <Step n={2}>
                Apply it with <span className="font-mono text-[13px] text-text">git apply dead-code-cleanup.patch</span>
                <span className="mt-2 flex items-center gap-2">
                  <CopyButton text={command} label="Copy one-line command" />
                </span>
              </Step>
              <Step n={3}>Run your tests before you commit anything.</Step>
            </ol>
          </div>
        </Container>
      </section>
      <Container>
        <ValidationList validation={validation} />
      </Container>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="title w-6 shrink-0 text-[28px] leading-none text-rose">{n}</span>
      <span className="text-[14.5px] leading-normal text-soft">{children}</span>
    </li>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn !px-3 !py-1.5 !text-xs"
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
      <Copy size={13} />
      {copied ? "Copied" : label}
    </button>
  );
}

function ConfirmDialog({
  onConfirm,
  failed,
  lines,
  files,
}: {
  onConfirm: () => void;
  failed: boolean;
  lines: number;
  files: number;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="btn btn-primary btn-lg">
          <Shovel size={18} /> Begin the burial
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(5,4,4,0.82)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[92vh] w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-b-2xl rounded-t-[270px] border border-[#4a2330] bg-surface px-12 pb-12 pt-24 text-center shadow-[inset_0_0_0_8px_var(--surface),inset_0_0_0_9px_var(--border),0_40px_100px_rgba(0,0,0,0.7),0_0_80px_rgba(122,30,44,0.25)]">
          <Dialog.Title className="title text-[42px] leading-[1.05] tracking-[-0.015em]">Before the burial</Dialog.Title>
          <Dialog.Description className="mx-auto mt-4 max-w-[380px] text-[15px] leading-relaxed text-soft">
            You are about to lay <span className="font-mono text-text">{lines.toLocaleString()} lines</span> to rest across{" "}
            {pluralize(files, "file")}.{" "}
            {failed ? "Some validation checks reported new problems." : "Syntax and static checks have passed."} Nothing in
            your repository changes; the patch is yours to review and apply.
          </Dialog.Description>
          <label className="mx-auto mt-5 flex max-w-[380px] items-start gap-2.5 text-left text-[13.5px] text-soft">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-rose"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I reviewed the diff and understand it may remove code used outside static analysis's view.
          </label>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Dialog.Close asChild>
              <button className="btn btn-lg">Not yet</button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <button className="btn btn-primary btn-lg" disabled={!acknowledged} onClick={onConfirm}>
                Rest in peace
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
