"""Minimal LSP client for ``basedpyright-langserver`` (find-references only)."""

from __future__ import annotations

import json
import logging
import queue
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from dch.verify.base import RefLocation, Verifier

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 30.0


def find_langserver() -> str | None:
    scripts = Path(sys.executable).parent
    for candidate in (scripts / "basedpyright-langserver.exe", scripts / "basedpyright-langserver"):
        if candidate.exists():
            return str(candidate)
    return shutil.which("basedpyright-langserver")


class LspError(RuntimeError):
    pass


class BasedPyrightVerifier(Verifier):
    name = "basedpyright"

    def __init__(self, root: Path, executable: str) -> None:
        self.root = root
        self._next_id = 0
        self._inbox: queue.Queue[dict] = queue.Queue()
        self._opened: set[str] = set()
        self._proc = subprocess.Popen(
            [executable, "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        threading.Thread(target=self._read_loop, daemon=True).start()
        self._initialize()

    # ---- transport -------------------------------------------------------------------------

    def _read_loop(self) -> None:
        stream = self._proc.stdout
        assert stream is not None
        while True:
            headers = {}
            while True:
                line = stream.readline()
                if not line:
                    self._inbox.put({"eof": True})
                    return
                line = line.strip()
                if not line:
                    break
                key, _, value = line.decode("ascii", "replace").partition(":")
                headers[key.lower()] = value.strip()
            body = stream.read(int(headers.get("content-length", "0")))
            try:
                self._inbox.put(json.loads(body))
            except json.JSONDecodeError:
                logger.debug("Dropping malformed LSP message")

    def _send(self, message: dict) -> None:
        data = json.dumps(message).encode()
        assert self._proc.stdin is not None
        self._proc.stdin.write(b"Content-Length: %d\r\n\r\n%s" % (len(data), data))
        self._proc.stdin.flush()

    def _notify(self, method: str, params: dict) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def _request(self, method: str, params: dict) -> object:
        self._next_id += 1
        request_id = self._next_id
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        while True:
            try:
                message = self._inbox.get(timeout=REQUEST_TIMEOUT_S)
            except queue.Empty as exc:
                raise LspError(f"basedpyright did not answer {method}") from exc
            if message.get("eof"):
                raise LspError("basedpyright exited unexpectedly")
            if "method" in message and "id" in message:  # server -> client request
                self._answer_server_request(message)
            elif message.get("id") == request_id:
                if "error" in message:
                    raise LspError(str(message["error"]))
                return message.get("result")

    def _answer_server_request(self, message: dict) -> None:
        result: object = None
        if message["method"] == "workspace/configuration":
            result = [{} for _ in message.get("params", {}).get("items", [])]
        self._send({"jsonrpc": "2.0", "id": message["id"], "result": result})

    # ---- protocol --------------------------------------------------------------------------

    def _initialize(self) -> None:
        uri = self.root.as_uri()
        self._request(
            "initialize",
            {
                "processId": None,
                "rootUri": uri,
                "workspaceFolders": [{"uri": uri, "name": self.root.name}],
                "capabilities": {"workspace": {"configuration": True}, "textDocument": {"references": {}}},
            },
        )
        self._notify("initialized", {})

    def references(self, file: str, source: str, line: int, column: int) -> list[RefLocation] | None:
        path = (self.root / file).resolve()
        uri = path.as_uri()
        if file not in self._opened:
            self._opened.add(file)
            self._notify(
                "textDocument/didOpen",
                {"textDocument": {"uri": uri, "languageId": "python", "version": 1, "text": source}},
            )
        result = self._request(
            "textDocument/references",
            {
                "textDocument": {"uri": uri},
                "position": {"line": line - 1, "character": column},
                "context": {"includeDeclaration": False},
            },
        )
        if result is None:
            return None
        found = []
        for item in result:  # type: ignore[union-attr]
            target = Path(_uri_to_path(item["uri"]))
            try:
                rel = target.resolve().relative_to(self.root.resolve()).as_posix()
            except ValueError:
                continue
            found.append(RefLocation(rel, item["range"]["start"]["line"] + 1))
        return found

    def close(self) -> None:
        try:
            self._request("shutdown", {})
            self._notify("exit", {})
        except LspError:
            pass
        finally:
            self._proc.kill()


def _uri_to_path(uri: str) -> str:
    from urllib.parse import unquote, urlparse

    path = unquote(urlparse(uri).path)
    return path.lstrip("/") if len(path) > 2 and path[2] == ":" else path
