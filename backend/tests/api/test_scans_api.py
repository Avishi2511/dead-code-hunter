from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import update

from conftest import scan_fixture, wait_for
from dch_api.db.models import Scan, utcnow
from dch_api.services.github_url import InvalidRepo, parse_repo


def test_scan_lifecycle_and_read_endpoints(client):
    scan_id = scan_fixture(client)
    scan = client.get(f"/api/scans/{scan_id}").json()
    assert scan["status"] == "done" and scan["progress"] == 100
    assert scan["stats"]["python_files"] > 5 and scan["repo_url"] == "https://github.com/acme/haunted"

    listing = client.get(f"/api/scans/{scan_id}/findings").json()
    assert listing["total"] == len(listing["items"]) > 10
    confidences = [f["confidence"] for f in listing["items"]]
    assert confidences == sorted(confidences, reverse=True)

    only_high = client.get(f"/api/scans/{scan_id}/findings", params={"level": "high"}).json()
    assert 0 < only_high["total"] < listing["total"]
    assert {f["level"] for f in only_high["items"]} == {"high"}
    deps = client.get(f"/api/scans/{scan_id}/findings", params={"type": "unused_dependency"}).json()
    assert {f["type"] for f in deps["items"]} == {"unused_dependency"}
    assert client.get(f"/api/scans/{scan_id}/findings", params={"q": "zzz-nothing"}).json()["total"] == 0

    function = next(
        f
        for f in client.get(f"/api/scans/{scan_id}/findings", params={"type": "unused_function"}).json()[
            "items"
        ]
    )
    detail = client.get(f"/api/scans/{scan_id}/findings/{function['id']}").json()
    assert detail["evidence"] and detail["suggestion"]["diff"]
    assert detail["excerpt"]["lines"] and detail["excerpt"]["highlight_start"] == function["line"]
    assert client.get(f"/api/scans/{scan_id}/findings/nope").status_code == 404

    file = client.get(f"/api/scans/{scan_id}/files", params={"path": function["file"]}).json()
    assert file["content"]
    assert client.get(f"/api/scans/{scan_id}/files", params={"path": "nope.py"}).status_code == 404


def test_graph_endpoints(client):
    scan_id = scan_fixture(client)
    function = client.get(f"/api/scans/{scan_id}/findings", params={"type": "unused_function"}).json()[
        "items"
    ][0]
    detail = client.get(f"/api/scans/{scan_id}/findings/{function['id']}").json()
    focus = detail["node_ids"][0]

    sub = client.get(f"/api/scans/{scan_id}/graph", params={"focus": focus, "hops": 2}).json()
    assert focus in {n["id"] for n in sub["nodes"]} and len(sub["nodes"]) <= 60
    ids = {n["id"] for n in sub["nodes"]}
    assert all(e["src"] in ids and e["dst"] in ids for e in sub["edges"])

    modules = client.get(f"/api/scans/{scan_id}/graph", params={"view": "modules"}).json()
    assert {n["kind"] for n in modules["nodes"]} == {"module"}
    assert modules["edges"] and all("count" in e["attrs"] for e in modules["edges"])
    assert any(n["attrs"]["finding_count"] for n in modules["nodes"])

    assert client.get(f"/api/scans/{scan_id}/graph").status_code == 422
    assert client.get(f"/api/scans/{scan_id}/graph", params={"focus": "nope"}).status_code == 404


def test_neighborhood_is_capped_and_reports_hidden_neighbours():
    from dch.result import GraphData, GraphEdge, GraphNode
    from dch_api.services.graph_queries import neighborhood

    nodes = [GraphNode(id=f"n{i}", kind="function", name=f"n{i}") for i in range(200)]
    edges = [GraphEdge(src="n0", dst=f"n{i}", kind="calls") for i in range(1, 200)]
    view = neighborhood(GraphData(nodes=nodes, edges=edges), ["n0"], hops=2)
    assert len(view.nodes) == 60
    assert view.hidden["n0"] == 140


def test_invalid_and_non_github_urls_are_rejected(client):
    for bad in ("https://gitlab.com/a/b", "https://github.com/onlyowner", "ftp://github.com/a/b", ""):
        assert client.post("/api/scans", json={"repoUrl": bad}).status_code == 422
    assert client.post("/api/scans", json={"repoUrl": "a/b", "subdir": "../etc"}).status_code == 422
    assert client.post("/api/scans", json={}).status_code == 422


def test_url_parsing():
    spec = parse_repo("https://github.com/fastapi/full-stack-fastapi-template/tree/master/backend")
    assert (spec.owner, spec.name, spec.ref, spec.subdir) == (
        "fastapi",
        "full-stack-fastapi-template",
        "master",
        "backend",
    )
    assert parse_repo("acme/app.git", ref="v1").name == "app"
    with pytest.raises(InvalidRepo):
        parse_repo("https://evilgithub.com/a/b")


def test_rate_limit_applies_to_scan_creation(make_client):
    client = make_client(scan_rate_limit_per_hour=2)
    for _ in range(2):
        assert client.post("/api/scans", json={"repoUrl": "a/b"}).status_code == 201
    assert client.post("/api/scans", json={"repoUrl": "a/b"}).status_code == 429


def test_one_active_run_per_scan_and_source_errors_are_reported(client):
    scan_id = scan_fixture(client)
    assert client.post(f"/api/scans/{scan_id}/run").status_code == 409

    missing = client.post("/api/scans", json={"repoUrl": "acme/missing"}).json()["scanId"]
    body = client.post(f"/api/scans/{missing}/run").json()
    assert body["status"] == "failed" and "not found" in body["error"]
    assert client.post(f"/api/scans/{missing}/run").status_code == 200  # failed scans can be retried
    assert client.get("/api/scans/does-not-exist").status_code == 404


def test_stale_running_scan_is_marked_failed(client):
    scan_id = client.post("/api/scans", json={"repoUrl": "acme/haunted"}).json()["scanId"]
    db = client.app.state.db
    with db.session() as session:
        session.execute(
            update(Scan)
            .where(Scan.id == scan_id)
            .values(status="running", last_progress_at=utcnow() - timedelta(hours=1))
        )
    body = client.get(f"/api/scans/{scan_id}").json()
    assert body["status"] == "failed" and "stopped responding" in body["error"]


def test_background_runner_returns_immediately_and_progress_is_pollable(make_client):
    client = make_client(job_runner="background")
    created = client.post("/api/scans", json={"repoUrl": "acme/haunted"}).json()["scanId"]
    started = client.post(f"/api/scans/{created}/run").json()
    assert started["status"] in ("running", "done")
    assert wait_for(client, f"/api/scans/{created}")["status"] == "done"


def test_health_and_purge(client, make_client):
    assert client.get("/api/health").json() == {"status": "ok", "database": "ok"}
    scan_id = scan_fixture(client)
    old = {"Authorization": "Bearer s3cret"}
    assert client.post("/api/maintenance/purge").status_code == 401
    assert client.post("/api/maintenance/purge", headers={"Authorization": "Bearer x"}).status_code == 401
    assert client.get("/api/maintenance/purge", headers=old).json() == {"scans_deleted": 0}
    with client.app.state.db.session() as session:
        session.execute(update(Scan).values(created_at=utcnow() - timedelta(days=30)))
    assert client.post("/api/maintenance/purge", headers=old).json() == {"scans_deleted": 1}
    assert client.get(f"/api/scans/{scan_id}").status_code == 404
    assert make_client().app.state.settings.maintenance_token == "s3cret"
