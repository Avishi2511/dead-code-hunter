from __future__ import annotations

import subprocess
from pathlib import Path

from conftest import FIXTURE, scan_fixture, wait_for


def high_findings(client, scan_id):
    items = client.get(f"/api/scans/{scan_id}/findings", params={"level": "high"}).json()["items"]
    return [f for f in items if not f["manual"] and not f["covered_by"]]


def test_cleanup_flow_produces_a_patch_that_applies(client, tmp_path):
    scan_id = scan_fixture(client)
    selections = [{"findingId": f["id"], "action": "remove"} for f in high_findings(client, scan_id)]
    created = client.post(f"/api/scans/{scan_id}/cleanups", json={"selections": selections})
    assert created.status_code == 201
    cleanup_id = created.json()["cleanupId"]

    pending = client.get(f"/api/cleanups/{cleanup_id}").json()
    assert pending["status"] == "pending" and pending["diff"] is None
    assert client.get(f"/api/cleanups/{cleanup_id}/patch").status_code == 409

    done = client.post(f"/api/cleanups/{cleanup_id}/run").json()
    assert done["status"] == "done"
    assert done["summary"]["findings"] == len(selections) and done["summary"]["files_changed"] > 0
    assert done["validation"]["compileall"] == "pass"
    assert client.post(f"/api/cleanups/{cleanup_id}/run").status_code == 409

    patch = client.get(f"/api/cleanups/{cleanup_id}/patch")
    assert patch.headers["content-disposition"].endswith('dead-code-cleanup.patch"')
    report = client.get(f"/api/cleanups/{cleanup_id}/report")
    assert "Dead code cleanup" in report.text or "cleanup" in report.text.lower()

    target = tmp_path / "repo"
    subprocess.run(["git", "init", "-q", str(target)], check=True)
    for path in FIXTURE.rglob("*"):
        if path.is_file() and "__pycache__" not in path.parts:
            dest = target / path.relative_to(FIXTURE)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(path.read_bytes())
    patch_file = Path(tmp_path / "x.patch")
    patch_file.write_bytes(patch.content)
    applied = subprocess.run(
        ["git", "apply", "--check", str(patch_file)], cwd=target, capture_output=True, text=True
    )
    assert applied.returncode == 0, applied.stderr


def test_cleanup_validation_errors(client):
    pending = client.post("/api/scans", json={"repoUrl": "acme/haunted"}).json()["scanId"]
    body = {"selections": [{"findingId": "x"}]}
    assert client.post(f"/api/scans/{pending}/cleanups", json=body).status_code == 409

    scan_id = scan_fixture(client)
    assert client.post(f"/api/scans/{scan_id}/cleanups", json=body).status_code == 422
    assert client.post(f"/api/scans/{scan_id}/cleanups", json={"selections": []}).status_code == 422
    assert client.get("/api/cleanups/nope").status_code == 404


def test_mark_alive_and_background_cleanup(make_client):
    client = make_client(job_runner="background")
    scan_id = client.post("/api/scans", json={"repoUrl": "acme/haunted"}).json()["scanId"]
    client.post(f"/api/scans/{scan_id}/run")
    wait_for(client, f"/api/scans/{scan_id}")
    finding = high_findings(client, scan_id)[0]
    cleanup_id = client.post(
        f"/api/scans/{scan_id}/cleanups",
        json={"selections": [{"findingId": finding["id"], "action": "mark_alive"}]},
    ).json()["cleanupId"]
    client.post(f"/api/cleanups/{cleanup_id}/run")
    done = wait_for(client, f"/api/cleanups/{cleanup_id}")
    assert done["status"] == "done"
    assert ".deadcodehunter.toml" in done["diff"]
