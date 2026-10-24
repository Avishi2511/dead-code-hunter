"""``dch`` command line interface."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from dch.cleanup.engine import run_cleanup
from dch.result import ScanResult, Selection
from dch.scan import scan_tree
from dch.source.base import GitHubTarballSource, LocalDirSource, SourceError, SourceTree
from dch.verify.run import VERIFIER_CHOICES

logger = logging.getLogger("dch")


def load_tree(args: argparse.Namespace) -> SourceTree:
    if args.github:
        owner, _, name = args.github.partition("/")
        if not name:
            raise SourceError("--github expects owner/repo")
        return GitHubTarballSource(
            owner, name, ref=args.ref, subdir=args.subdir, token=os.environ.get("GITHUB_TOKEN")
        ).load()
    if not args.path:
        raise SourceError("Provide a directory or --github owner/repo")
    return LocalDirSource(Path(args.path), subdir=args.subdir, repo=args.repo).load()


def print_summary(result: ScanResult, limit: int) -> None:
    stats = result.stats
    print(
        f"{result.repo}: {stats.python_files} Python files, {stats.modules} modules, "
        f"{stats.symbols} symbols ({stats.duration_s}s)"
    )
    for warning in result.warnings:
        print(f"  warning: {warning}")
    print(f"{len(result.findings)} findings, ~{stats.potential_cleanup_lines} lines of potential cleanup")
    for finding in result.findings[:limit]:
        print(
            f"  {finding.confidence:>3}% {finding.level:<6} {finding.type:<17} "
            f"{finding.file}:{finding.line}  {finding.name}"
        )
    if len(result.findings) > limit:
        print(f"  ... {len(result.findings) - limit} more (use -o to write the full JSON)")


def add_source_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("path", nargs="?", help="local project directory")
    parser.add_argument("--github", metavar="OWNER/REPO", help="scan a public GitHub repository")
    parser.add_argument("--ref", help="branch, tag or SHA (with --github)")
    parser.add_argument("--subdir", help="project subdirectory inside the repository")
    parser.add_argument("--repo", help="repository identifier used in graph ids")


def add_scan_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--verifier",
        choices=VERIFIER_CHOICES,
        default=os.environ.get("VERIFIER", "auto"),
        help="type checker used to double-check candidates (env: VERIFIER)",
    )
    parser.add_argument(
        "--time-budget",
        type=float,
        default=float(os.environ.get("SCAN_TIME_BUDGET_S", 0)) or None,
        help="seconds after which optional stages are skipped (env: SCAN_TIME_BUDGET_S)",
    )


def cmd_scan(args: argparse.Namespace) -> int:
    result = scan_tree(
        load_tree(args),
        include_graph=args.graph,
        verifier=args.verifier,
        time_budget_s=args.time_budget,
    )
    if args.output:
        Path(args.output).write_text(result.model_dump_json(indent=2), encoding="utf-8")
    print_summary(result, args.limit)
    return 0


LEVEL_ORDER = {"high": 0, "medium": 1, "low": 2}


def parse_selection(text: str) -> Selection:
    finding_id, _, action = text.partition(":")
    return Selection(finding_id=finding_id, action=action or "remove")  # type: ignore[arg-type]


def cmd_cleanup(args: argparse.Namespace) -> int:
    tree = load_tree(args)
    scan = scan_tree(tree, verifier=args.verifier, time_budget_s=args.time_budget)
    if args.select:
        selections = [parse_selection(s) for s in args.select]
    else:
        wanted_types = set(args.types.split(",")) if args.types else None
        limit = LEVEL_ORDER[args.min_level]
        selections = [
            Selection(finding_id=f.id)
            for f in scan.findings
            if LEVEL_ORDER[f.level] <= limit
            and not (f.suggestion and f.suggestion.manual)
            and (wanted_types is None or f.type in wanted_types)
        ]
    selections += [Selection(finding_id=i, action="mark_alive") for i in args.mark_alive or []]
    result = run_cleanup(
        tree, scan, selections, typecheck="none" if args.no_typecheck else "auto",
        validate=not args.no_validate, time_budget_s=args.time_budget,
    )  # fmt: skip
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "dead-code-cleanup.patch").write_text(result.patch, encoding="utf-8", newline="")
    (out / "CLEANUP_REPORT.md").write_text(result.report_md, encoding="utf-8")
    summary, validation = result.summary, result.validation
    print(f"{summary.findings} findings applied across {summary.files_changed} files "
          f"(-{summary.lines_removed} +{summary.lines_added} lines)")  # fmt: skip
    print(f"validation: compileall={validation.compileall} ruff={validation.ruff} "
          f"typecheck={validation.typecheck}")  # fmt: skip
    for issue in [*validation.ruff_new_issues, *validation.typecheck_new_errors]:
        print(f"  new issue: {issue}")
    print(f"wrote {out / 'dead-code-cleanup.patch'} and {out / 'CLEANUP_REPORT.md'}")
    return 0


def cmd_schema(args: argparse.Namespace) -> int:
    print(json.dumps(ScanResult.model_json_schema(), indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dch", description="Dead Code Hunter")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="scan a project and list dead-code findings")
    add_source_args(scan)
    scan.add_argument("-o", "--output", help="write the full ScanResult JSON here")
    scan.add_argument("--graph", action="store_true", help="include the code graph in the output")
    add_scan_args(scan)
    scan.add_argument("--limit", type=int, default=40, help="findings to print")
    scan.set_defaults(func=cmd_scan)

    cleanup = sub.add_parser(
        "cleanup", help="build a patch removing selected findings (never touches the repo)"
    )
    add_source_args(cleanup)
    add_scan_args(cleanup)
    cleanup.add_argument("--min-level", choices=["high", "medium", "low"], default="high")
    cleanup.add_argument("--types", help="comma separated finding types to include")
    cleanup.add_argument("--select", nargs="+", metavar="ID[:ACTION]", help="explicit finding ids")
    cleanup.add_argument("--mark-alive", nargs="+", metavar="ID", help="findings to record as alive")
    cleanup.add_argument("--out-dir", default="dch-out")
    cleanup.add_argument("--no-validate", action="store_true")
    cleanup.add_argument("--no-typecheck", action="store_true")
    cleanup.set_defaults(func=cmd_cleanup)

    schema = sub.add_parser("schema", help="print the ScanResult JSON schema")
    schema.set_defaults(func=cmd_schema)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s"
    )
    try:
        return args.func(args)
    except SourceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
