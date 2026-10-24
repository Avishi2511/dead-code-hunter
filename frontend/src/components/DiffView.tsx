import { useMemo, useState } from "react";
import { Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import clsx from "clsx";
import { diffFileName, parseUnifiedDiff } from "@/lib/diff";

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
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {(["unified", "split"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setViewType(type)}
              className={clsx("px-2.5 py-1 capitalize", viewType === type ? "bg-accent text-text" : "text-muted")}
            >
              {type}
            </button>
          ))}
        </div>
        {showCopy && (
          <button className="btn !px-2.5 !py-1 text-xs" onClick={copy}>
            {copied ? "Copied" : "Copy diff"}
          </button>
        )}
      </div>
      {files.map((file) => (
        <div key={`${file.oldPath}->${file.newPath}`} className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5 font-mono text-xs">
            <span>{diffFileName(file)}</span>
            {file.type === "delete" && <span className="text-muted">file removed</span>}
            {file.type === "add" && <span className="text-muted">file added</span>}
          </div>
          <div className="overflow-x-auto">
            <Diff viewType={viewType} diffType={file.type} hunks={file.hunks}>
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </div>
        </div>
      ))}
    </div>
  );
}
