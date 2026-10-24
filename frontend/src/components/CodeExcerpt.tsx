import { useEffect, useState } from "react";
import type { Schemas } from "@/api/client";

type Highlighter = Awaited<ReturnType<typeof loadHighlighter>>;
let highlighterPromise: Promise<Highlighter> | null = null;

async function loadHighlighter() {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, python, theme] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/langs/python.mjs"),
    import("shiki/themes/github-dark.mjs"),
  ]);
  return createHighlighterCore({
    themes: [theme.default],
    langs: [python.default],
    engine: createJavaScriptRegexEngine(),
  });
}

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= loadHighlighter();
  return highlighterPromise;
}

interface Props {
  excerpt: Schemas["CodeExcerpt"];
  file: string;
}

export function CodeExcerpt({ excerpt, file }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const isPython = file.endsWith(".py");

  useEffect(() => {
    let cancelled = false;
    if (!isPython) return;
    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const result = highlighter.codeToHtml(excerpt.lines.join("\n"), {
          lang: "python",
          theme: "github-dark",
          transformers: [
            {
              line(node, line) {
                const number = excerpt.start_line + line - 1;
                node.properties["data-line"] = number;
                if (number >= excerpt.highlight_start && number <= excerpt.highlight_end) {
                  this.addClassToHast(node, "hl");
                }
              },
            },
          ],
        });
        setHtml(result);
      })
      .catch(() => setHtml(null));
    return () => {
      cancelled = true;
    };
  }, [excerpt, isPython]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-muted">{file}</div>
      <div className="code-excerpt overflow-x-auto py-2 font-mono text-[12.5px] leading-5">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>
            {excerpt.lines.map((text, index) => {
              const number = excerpt.start_line + index;
              const hl = number >= excerpt.highlight_start && number <= excerpt.highlight_end;
              return (
                <span key={number} className={`line${hl ? " hl" : ""}`} data-line={number}>
                  {text}
                  {"\n"}
                </span>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
