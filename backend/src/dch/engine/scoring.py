"""Confidence scoring and structured evidence for each candidate."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from dch.engine.detectors import Candidate
from dch.engine.index import StringIndex, TextIndex
from dch.graph.model import CodeGraph, Edge
from dch.python.model import ModuleInfo, ProjectIndex
from dch.python.resolve import Resolver
from dch.result import Evidence, Finding, Level, Location, Reference

BASE_SCORES = {
    "unused_import": 95,
    "unused_function": 90,
    "unused_class": 90,
    "unused_method": 75,
    "unused_variable": 80,
    "unused_module": 85,
    "unused_dependency": 92,
    "unused_route": 90,
}
TEST_ONLY_BASE = {
    "unused_function": 70,
    "unused_class": 70,
    "unused_method": 60,
    "unused_variable": 60,
    "unused_module": 70,
}
BENIGN_DECORATORS = {
    "staticmethod",
    "classmethod",
    "property",
    "abstractmethod",
    "dataclass",
    "lru_cache",
    "cache",
    "cached_property",
    "wraps",
    "contextmanager",
    "asynccontextmanager",
    "overload",
    "final",
    "override",
    "total_ordering",
    "setter",
    "getter",
    "deleter",
    "abstractproperty",
}
NOISE_EDGES = {"contains", "auto_live"}
LOW_CONFIDENCE_DIRS = ("scripts/", "tools/")
MAX_REFS = 20


def level_for(confidence: int) -> Level:
    return "high" if confidence >= 85 else "medium" if confidence >= 65 else "low"


def finding_id(kind: str, node_id: str) -> str:
    return hashlib.sha1(f"{kind}:{node_id}".encode()).hexdigest()[:12]


@dataclass
class ScoringContext:
    project: ProjectIndex
    resolver: Resolver
    strings: StringIndex
    text: TextIndex
    any_dynamic_import: bool = False
    verified_no_refs: set[str] = field(default_factory=set)
    verifier_hits: dict[str, list[Location]] = field(default_factory=dict)

    @property
    def graph(self) -> CodeGraph:
        return self.project.graph


class Scorer:
    def __init__(self, ctx: ScoringContext) -> None:
        self.ctx = ctx
        self.g = ctx.graph

    def score(self, cand: Candidate) -> Finding:
        evidence: list[Evidence] = []
        score = (
            TEST_ONLY_BASE[cand.type]
            if cand.test_only and cand.type in TEST_ONLY_BASE
            else BASE_SCORES.get(cand.type, 80)
        )
        summary = ""
        if cand.type == "unreachable_code":
            score, summary = self.unreachable(cand, evidence)
        elif cand.type == "unused_route":
            score, summary = self.route(cand, evidence)
        elif cand.type == "unused_dependency":
            score, summary = self.dependency(cand, evidence)
        else:
            score += self.supporting_evidence(cand, evidence)
            score += self.weakening_evidence(cand, evidence)
            summary = self.summary(cand)
        score = max(5, min(99, score))
        return Finding(
            id=finding_id(cand.type, cand.node_id),
            type=cand.type,
            name=cand.name,  # type: ignore[arg-type]
            node_ids=cand.node_ids,
            file=cand.file,
            line=cand.line,
            end_line=cand.end_line,
            confidence=score,
            level=level_for(score),
            summary=summary,
            evidence=evidence,
            references=self.references(cand),
            impact_lines=cand.end_line - cand.line + 1,
        )

    # ---- summaries -------------------------------------------------------------------------

    def summary(self, cand: Candidate) -> str:
        labels = {
            "unused_function": "Function",
            "unused_class": "Class",
            "unused_method": "Method",
            "unused_variable": "Variable",
            "unused_import": "Import",
            "unused_module": "Module",
        }
        label = labels.get(cand.type, "Item")
        if cand.test_only:
            return f"{label} `{cand.name}` is only used by tests."
        if cand.type == "unused_import":
            return f"Import `{cand.name}` is never used in this file."
        return f"{label} `{cand.name}` is never reached from production code."

    # ---- evidence --------------------------------------------------------------------------

    def incoming(self, cand: Candidate) -> list[Edge]:
        """Incoming reference edges, looking through import bindings to the code that uses them."""
        edges: list[Edge] = []
        seen: set[str] = set()
        stack = list(cand.node_ids)
        while stack:
            node_id = stack.pop()
            if node_id in seen:
                continue
            seen.add(node_id)
            for e in self.g.in_edges(node_id):
                if e.kind in NOISE_EDGES or e.src not in self.g.nodes:
                    continue
                if self.g.nodes[e.src].kind == "import":
                    stack.append(e.src)
                else:
                    edges.append(e)
        return edges

    def supporting_evidence(self, cand: Candidate, evidence: list[Evidence]) -> int:
        delta = 0
        if cand.type == "unused_import":
            evidence.append(
                Evidence(
                    polarity="supports",
                    code="no_usage",
                    text=f"`{cand.name}` is imported but never used in {cand.file}",
                    locations=[Location(file=cand.file, line=cand.line)],
                )
            )
            return 0
        incoming = self.incoming(cand)
        dead_sources = sorted({e.src for e in incoming if self.g.nodes[e.src].liveness == "dead"})
        live_sources = [e for e in incoming if self.g.nodes[e.src].liveness == "live"]
        test_sources = [e for e in incoming if self.g.nodes[e.src].liveness == "test_only"]
        what = "imports" if cand.type == "unused_module" else "references"
        if not incoming:
            code = "no_imports" if cand.type == "unused_module" else "no_calls"
            evidence.append(
                Evidence(
                    polarity="supports", code=code, text=f"No {what} to `{cand.name}` anywhere in the project"
                )
            )
        elif not live_sources:
            if test_sources and not dead_sources:
                evidence.append(
                    Evidence(
                        polarity="supports", code="only_test_refs", text="Only referenced from test code"
                    )
                )
            else:
                names = ", ".join(f"`{self.g.nodes[s].name}`" for s in dead_sources[:4])
                evidence.append(
                    Evidence(
                        polarity="supports",
                        code="only_dead_refs",
                        text=f"Only referenced by dead code: {names} (also dead)",
                    )
                )
        if not test_sources and cand.type != "unused_module":
            evidence.append(
                Evidence(polarity="supports", code="no_test_refs", text="Not referenced by any test")
            )
        mod = self.module_of(cand)
        short = cand.name.rsplit(".", 1)[-1]
        if mod and mod.exports is not None and cand.type != "unused_module":
            if short in mod.exports:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="in_all",
                        text=f"`{short}` is listed in `__all__` (public API)",
                    )
                )
                delta -= 10
            else:
                evidence.append(
                    Evidence(
                        polarity="supports", code="not_in_all", text=f"`{short}` is not exported in `__all__`"
                    )
                )
        if cand.node_id in self.ctx.verified_no_refs:
            evidence.append(
                Evidence(
                    polarity="supports", code="verifier_no_refs", text="Type checker found no references"
                )
            )
            delta += 4
        return delta

    def weakening_evidence(self, cand: Candidate, evidence: list[Evidence]) -> int:
        if cand.type == "unused_import":
            mod = self.module_of(cand)
            if mod and mod.has_getattr:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="module_getattr",
                        text="Module defines `__getattr__`, so names may be resolved dynamically",
                    )
                )
                return -20
            return 0
        delta = 0
        mod = self.module_of(cand)
        short = cand.name.rsplit(".", 1)[-1]
        node = self.g.nodes.get(cand.node_id)
        if cand.type == "unused_module":
            dotted_name = mod.name if mod else ""
            hits = self.ctx.strings.find_module(dotted_name) if dotted_name else []
            if hits:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="string_literal_match",
                        text=f"Module path `{dotted_name}` appears in a string at {hits[0].file}:{hits[0].line}",
                        locations=hits[:5],
                    )
                )
                delta -= 15
            config_hits = self.ctx.text.find_text(dotted_name) if dotted_name else []
            if config_hits:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="config_mention",
                        text=f"Module name appears in {config_hits[0].file}:{config_hits[0].line}",
                        locations=config_hits[:5],
                    )
                )
                delta -= 15
            if cand.file.startswith(LOW_CONFIDENCE_DIRS):
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="script_directory",
                        text="Modules under scripts/ or tools/ are often run by hand",
                    )
                )
                delta -= 20
            if self.ctx.any_dynamic_import:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="dynamic_access",
                        text="The project imports modules dynamically (importlib / __import__)",
                    )
                )
                delta -= 15
            return delta
        hits = self.ctx.strings.find_name(short)
        if hits:
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="string_literal_match",
                    text=f"Name `{short}` appears in a string at {hits[0].file}:{hits[0].line}",
                    locations=hits[:5],
                )
            )
            delta -= 15
        config_hits = self.ctx.text.find_word(short)
        if config_hits and len(short) > 3:
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="config_mention",
                    text=f"Name `{short}` appears in {config_hits[0].file}:{config_hits[0].line}",
                    locations=config_hits[:5],
                )
            )
            delta -= 15
        if mod and mod.dynamic:
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="dynamic_access",
                    text="Module uses dynamic attribute access (getattr/importlib/globals)",
                    locations=mod.dynamic[:3],
                )
            )
            delta -= 20
        if node is not None:
            unknown = [
                d for d in node.attrs.get("decorators", []) if d.rsplit(".", 1)[-1] not in BENIGN_DECORATORS
            ]
            if unknown:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="unknown_decorator",
                        text=f"Decorated with `@{unknown[0]}`, which may register or wrap it",
                    )
                )
                delta -= 25
        if cand.type == "unused_method" and node is not None:
            cls_id = node.attrs.get("class_id", "")
            if cls_id and self.ctx.resolver.has_unknown_base(cls_id):
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="external_base",
                        text="Class inherits from an external or unresolved base; the method may override it",
                    )
                )
                delta -= 20
            attr_hits = self.ctx.project.unresolved_attrs.get(short, [])
            if attr_hits:
                evidence.append(
                    Evidence(
                        polarity="weakens",
                        code="unresolved_attribute",
                        text=f"`.{short}` is accessed on objects whose type could not be resolved",
                        locations=attr_hits[:5],
                    )
                )
                delta -= 15
        if short.startswith("_") and not short.startswith("__"):
            delta += 3
        return delta

    def unreachable(self, cand: Candidate, evidence: list[Evidence]) -> tuple[int, str]:
        block = cand.extra["block"]
        loc = Location(file=cand.file, line=block.start)
        evidence.append(
            Evidence(
                polarity="supports",
                code="unreachable",
                text=block.reason.capitalize(),
                locations=[Location(file=cand.file, line=block.anchor), loc],
            )
        )
        score = (
            98
            if block.kind == "after_terminator"
            and not block.reason.startswith(("follows `while", "follows `if"))
            else 94
        )
        return score, f"Lines {block.start}-{block.end} can never run: {block.reason}."

    def dependency(self, cand: Candidate, evidence: list[Evidence]) -> tuple[int, str]:
        names = ", ".join(f"`{n}`" for n in cand.extra["names"])
        score = BASE_SCORES["unused_dependency"]
        evidence.append(
            Evidence(
                polarity="supports",
                code="no_imports",
                text=f"No Python file imports {names}",
            )
        )
        evidence.append(
            Evidence(
                polarity="supports",
                code="no_cli_usage",
                text="Not used by a Dockerfile, CI workflow, script or tool configuration",
            )
        )
        if cand.extra["guessed"]:
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="heuristic_mapping",
                    text="The import name was guessed from the distribution name (not in the curated map)",
                )
            )
            score -= 20
        if cand.extra["weak"]:
            weak = cand.extra["weak"]
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="config_mention",
                    text=f"The name appears in {weak[0].file}:{weak[0].line}",
                    locations=weak[:5],
                )
            )
            score -= 15
        return score, f"Dependency `{cand.name}` is declared in {cand.file} but never used."

    def route(self, cand: Candidate, evidence: list[Evidence]) -> tuple[int, str]:
        shadowed_by = cand.extra.get("shadowed_by")
        router = self.g.nodes[cand.extra["router"]]
        delta = 0
        if shadowed_by:
            other = self.g.nodes[shadowed_by]
            location = Location(file=other.file or "", line=other.line or 1)
            evidence.append(
                Evidence(
                    polarity="supports",
                    code="shadowed_route",
                    text=f"`{other.name}` is registered first ({location.file}:{location.line}), so FastAPI never reaches this handler",
                    locations=[location],
                )
            )
            score = 95
            summary = f"Route `{cand.name}` is shadowed by an earlier route with the same method and path."
        else:
            what = "Sub-application" if router.kind == "fastapi_app" else "Router"
            evidence.append(
                Evidence(
                    polarity="supports",
                    code="unmounted_router",
                    text=f"{what} `{router.name}` in {router.file} is never included in or mounted on a live application",
                    locations=[Location(file=router.file or "", line=router.line or 1)],
                )
            )
            score = 70 if cand.test_only else 90
            summary = f"Route `{cand.name}` is registered on a router that is never mounted."
        state = self.ctx.project.extras.get("fastapi")
        if state is not None and state.dynamic_includes and not shadowed_by:
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="dynamic_include",
                    text="Some include_router() calls could not be resolved; this router may be mounted dynamically",
                    locations=state.dynamic_includes[:3],
                )
            )
            delta -= 25
        mod = self.ctx.project.by_path.get(router.file or "")
        if mod and mod.dynamic and not shadowed_by:
            evidence.append(
                Evidence(
                    polarity="weakens",
                    code="dynamic_access",
                    text="The router module uses dynamic attribute access",
                    locations=mod.dynamic[:3],
                )
            )
            delta -= 15
        return score + delta, summary

    # ---- references ------------------------------------------------------------------------

    def module_of(self, cand: Candidate) -> ModuleInfo | None:
        return self.ctx.project.by_path.get(cand.file)

    def references(self, cand: Candidate) -> list[Reference]:
        refs: list[Reference] = []
        for e in self.incoming(cand):
            refs.append(
                Reference(
                    direction="incoming",
                    kind=e.kind,
                    node_id=e.src,
                    liveness=self.g.nodes[e.src].liveness,
                    locations=e.locations[:3],
                )
            )
        for node_id in cand.node_ids:
            for e in self.g.out_edges(node_id):
                if e.kind in NOISE_EDGES or e.kind == "contains" or e.dst not in self.g.nodes:
                    continue
                refs.append(
                    Reference(
                        direction="outgoing",
                        kind=e.kind,
                        node_id=e.dst,
                        liveness=self.g.nodes[e.dst].liveness,
                        locations=e.locations[:3],
                    )
                )
        return refs[:MAX_REFS]
