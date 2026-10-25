import { useMemo, useState } from "react";
import { Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import clsx from "clsx";
import { diffFileName, fileStats, parseUnifiedDiff } from "@/lib/diff";

type ViewType = "unified" | "split";

export function DiffView({
  diff,
  showCopy = true,
  defaultView = "unified",
}: {
  diff: string;
  showCopy?: boolean;
  defaultView?: ViewType;
}) {
  const [viewType, setViewType] = useState<ViewType>(defaultView);
  const [copied, setCopied] = useState(false);
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (files.length === 0) {
    return <p className="text-sm text-muted">No textual change to show.</p>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <div className="inline-flex overflow-hidden rounded-full border border-border text-xs">
          {(["unified", "split"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setViewType(type)}
              className={clsx("px-3.5 py-1.5 capitalize", viewType === type ? "bg-accent/[0.32] text-text" : "text-soft hover:text-text")}
            >
              {type}
            </button>
          ))}
        </div>
        {showCopy && (
          <button className="btn !px-3.5 !py-1.5 text-xs" onClick={copy}>
            {copied ? "Copied" : "Copy diff"}
          </button>
        )}
      </div>
      {files.map((file) => {
        const stats = fileStats(file);
        return (
          <div key={`${file.oldPath}->${file.newPath}`} className="overflow-hidden rounded-[20px] border border-border bg-[#100d0e]">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface-2 px-[22px] py-3.5">
              <span className="font-mono text-[13px]">{diffFileName(file)}</span>
              <span className="flex items-center gap-3 font-mono text-xs">
                {file.type === "delete" && <span className="text-muted">file removed</span>}
                {file.type === "add" && <span className="text-muted">file added</span>}
                <span>
                  <span className="text-rose">−{stats.removed}</span> <span className="text-ok">+{stats.added}</span>
                </span>
              </span>
            </div>
            <div className="overflow-x-auto py-2">
              <Diff viewType={viewType} diffType={file.type} hunks={file.hunks}>
                {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
              </Diff>
            </div>
          </div>
        );
      })}
    </div>
  );
}
