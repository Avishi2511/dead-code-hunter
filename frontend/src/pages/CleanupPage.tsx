import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, patchUrl, reportUrl, type Action } from "@/api/client";
import { useCleanup } from "@/api/hooks";
import { DiffView } from "@/components/DiffView";
import { ErrorBox, PageTitle } from "@/components/Shell";
import { TypeBadge } from "@/components/Badges";
import { pluralize } from "@/lib/format";
import { useScanSelection, useSelection } from "@/state/selection";

export function CleanupPage() {
  const { id = "" } = useParams();
  const selection = useScanSelection(id);
  const { set, clear } = useSelection.getState();
  const [cleanupId, setCleanupId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const ids = Object.keys(selection);
  const { data: findings } = useQuery({ queryKey: ["findings", id, {}], queryFn: () => api.findings(id) });
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

  if (ids.length === 0 && !cleanupId) {
    return (
      <>
        <PageTitle title="Cleanup" />
        <p className="text-sm text-muted">
          Nothing selected yet. Pick findings on the{" "}
          <Link to="../findings" relative="path" className="underline">
            findings page
          </Link>{" "}
          — "Select all High" is a good start.
        </p>
      </>
    );
  }

  return (
    <>
      <PageTitle title="Cleanup">
        <div className="flex gap-2">
          <button className="btn" onClick={() => clear(id)} disabled={ids.length === 0}>
            Clear selection
          </button>
          <button className="btn btn-primary" onClick={() => prepare.mutate()} disabled={ids.length === 0 || prepare.isPending}>
            {prepare.isPending ? "Preparing…" : "Preview & validate"}
          </button>
        </div>
      </PageTitle>

      <section className="space-y-4">
        {grouped.map(([type, group]) => (
          <div key={type} className="card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <TypeBadge type={type} />
              <span className="text-xs text-muted">{pluralize(group.length, "finding")}</span>
            </div>
            <ul className="divide-y divide-border">
              {group.map((findingId) => {
                const finding = byId.get(findingId);
                return (
                  <li key={findingId} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <Link to={`../findings/${encodeURIComponent(findingId)}`} relative="path" className="min-w-0 flex-1 truncate font-mono hover:underline">
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
                      <option value="mark_alive">Mark as alive</option>
                    </select>
                    <button className="text-xs text-muted hover:text-text" onClick={() => set(id, findingId, null)}>
                      Drop
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {prepare.error && (
        <div className="mt-6">
          <ErrorBox message={prepare.error.message} />
        </div>
      )}
      {cleanupId && result && (
        <Result
          result={result}
          cleanupId={cleanupId}
          confirmed={confirmed}
          onConfirm={() => setConfirmed(true)}
          onRetry={() => void api.runCleanup(cleanupId).catch(() => undefined)}
        />
      )}
    </>
  );
}

function Result({
  result,
  cleanupId,
  confirmed,
  onConfirm,
  onRetry,
}: {
  result: NonNullable<ReturnType<typeof useCleanup>["data"]>;
  cleanupId: string;
  confirmed: boolean;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  if (result.status === "failed") {
    return (
      <div className="mt-8">
        <ErrorBox message={result.error ?? "The cleanup failed."} onRetry={onRetry} />
      </div>
    );
  }
  if (result.status !== "done" || !result.summary || !result.validation) {
    return <p className="mt-8 text-sm text-muted">Applying changes and validating…</p>;
  }
  const { summary, validation } = result;
  const issues = [...(validation.ruff_new_issues ?? []), ...(validation.typecheck_new_errors ?? [])];
  const command = `curl -sL ${window.location.origin}${patchUrl(cleanupId)} | git apply`;

  return (
    <div className="mt-8 space-y-6">
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Findings" value={summary.findings} />
        <Stat label="Files changed" value={summary.files_changed} />
        <Stat label="Lines removed" value={summary.lines_removed} />
        <Stat label="Lines added" value={summary.lines_added} />
      </section>
      {((summary.covered ?? []).length > 0 || (summary.manual ?? []).length > 0) && (
        <p className="text-sm text-muted">
          {pluralize((summary.covered ?? []).length, "selected finding")} already covered by a larger removal
          {(summary.manual ?? []).length > 0 && `; ${pluralize((summary.manual ?? []).length, "finding")} need a manual change`}.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Validation</h2>
        <div className="card divide-y divide-border text-sm">
          <Check label="Compiles (compileall)" value={validation.compileall} />
          <Check label="No new ruff F401 / F811 / F821 issues" value={validation.ruff} />
          <Check label="No new type errors" value={validation.typecheck} />
        </div>
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
        <p className="mt-2 text-xs text-muted">Validation is static. Your project's tests are not run.</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Files changed</h2>
        <DiffView diff={result.diff ?? ""} />
      </section>

      <section className="card p-5">
        {confirmed ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <a className="btn btn-primary" href={patchUrl(cleanupId)} download>
                Download .patch
              </a>
              <a className="btn" href={reportUrl(cleanupId)} download>
                Download report
              </a>
              <CopyButton text={command} label="Copy git apply command" />
            </div>
            <p className="break-all font-mono text-xs text-muted">{command}</p>
            <p className="text-xs text-muted">Run it from the root of your clone. The patch is also valid for git am.</p>
          </div>
        ) : (
          <ConfirmDialog onConfirm={onConfirm} />
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-2xl">{value.toLocaleString()}</div>
    </div>
  );
}

function Check({ label, value }: { label: string; value: string }) {
  const text = value === "pass" ? "Passed" : value === "fail" ? "Needs attention" : "Skipped";
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span>{label}</span>
      <span className={value === "fail" ? "text-accent-hover" : "text-muted"}>{text}</span>
    </div>
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
      {copied ? "Copied" : label}
    </button>
  );
}

function ConfirmDialog({ onConfirm }: { onConfirm: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <Dialog.Root>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Review the diff above before you take the patch.</p>
        <Dialog.Trigger asChild>
          <button className="btn btn-primary">Confirm & get the patch</button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70" />
        <Dialog.Content className="card fixed left-1/2 top-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 p-6">
          <Dialog.Title className="text-lg font-semibold">Before you apply this</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">
            These changes come from static analysis. Nothing has been changed in your repository, and the patch
            is yours to review and apply.
          </Dialog.Description>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 accent-[#7a1e2c]" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            I reviewed the diff and understand it may remove code used outside static analysis's view.
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="btn">Cancel</button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <button className="btn btn-primary" disabled={!acknowledged} onClick={onConfirm}>
                Get the patch
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


