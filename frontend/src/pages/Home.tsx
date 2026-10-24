import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { ErrorBox } from "@/components/Shell";

interface DemoRepo {
  label: string;
  hint: string;
  repoUrl: string;
  subdir?: string;
}

const DEMO_REPOS: DemoRepo[] = [
  {
    label: "Haunted FastAPI",
    hint: "Seeded app: every finding type, plus traps that must stay alive",
    repoUrl: "https://github.com/Avishi2511/dead-code-hunter",
    subdir: "fixtures/haunted-fastapi",
  },
  {
    label: "Full-stack FastAPI template",
    hint: "The official template's backend",
    repoUrl: "https://github.com/fastapi/full-stack-fastapi-template",
    subdir: "backend",
  },
];

export function Home() {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [subdir, setSubdir] = useState("");

  const start = useMutation({
    mutationFn: (body: { repoUrl: string; ref?: string; subdir?: string }) => api.createScan(body),
    onSuccess: ({ scanId }) => navigate(`/scans/${scanId}`),
  });

  const submit = (body: { repoUrl: string; ref?: string; subdir?: string }) =>
    start.mutate({ repoUrl: body.repoUrl.trim(), ref: body.ref?.trim() || undefined, subdir: body.subdir?.trim() || undefined });

  return (
    <div className="mx-auto max-w-2xl pt-10">
      <h1 className="text-4xl font-semibold tracking-tight">Find the code nobody calls.</h1>
      <p className="mt-4 text-muted">
        Point it at a public Python / FastAPI repository on GitHub. It builds a code graph, shows which functions,
        classes, imports, routes and dependencies are unreachable, explains why, and prepares a patch you can review.
        Nothing from the repository is ever executed.
      </p>

      <form
        className="card mt-8 space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ repoUrl, ref, subdir });
        }}
      >
        <div>
          <label className="label" htmlFor="repo">
            GitHub repository
          </label>
          <input
            id="repo"
            className="input mt-1.5 font-mono"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ref">
              Branch, tag or SHA <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input id="ref" className="input mt-1.5 font-mono" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="subdir">
              Subdirectory <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="subdir"
              className="input mt-1.5 font-mono"
              placeholder="backend"
              value={subdir}
              onChange={(e) => setSubdir(e.target.value)}
            />
          </div>
        </div>
        {start.error && <ErrorBox message={start.error.message} />}
        <button className="btn btn-primary" type="submit" disabled={!repoUrl.trim() || start.isPending}>
          {start.isPending ? "Starting…" : "Start the hunt"}
        </button>
      </form>

      <div className="mt-8">
        <p className="label">Or try a demo</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {DEMO_REPOS.map((demo) => (
            <button
              key={demo.label}
              className="card p-4 text-left transition-colors hover:border-accent disabled:opacity-50"
              disabled={start.isPending}
              onClick={() => submit(demo)}
            >
              <div className="text-sm font-medium">{demo.label}</div>
              <div className="mt-1 text-xs text-muted">{demo.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
