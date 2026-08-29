"""Dependency-free Python client for the Hex Machina JSONL rollout bridge."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence


class HexMachinaProtocolError(RuntimeError):
    """Raised when the rollout subprocess rejects a transport operation."""


class HexMachinaEnv:
    """Small Gymnasium-shaped adapter over the production Agent Gym handlers.

    Actions are dictionaries shaped as ``{"tool": "inspect_spell", "input": {}}``.
    No gymnasium dependency is required; reset and step use its familiar return
    signatures so trainers can wrap this class directly.
    """

    def __init__(
        self,
        command: Sequence[str] | None = None,
        cwd: str | Path | None = None,
    ) -> None:
        repository = Path(__file__).resolve().parents[1]
        self._cwd = Path(cwd) if cwd is not None else repository
        self._command = list(command or ("npm", "run", "--silent", "gym:serve"))
        self._process: subprocess.Popen[str] | None = None
        self._request_id = 0

    def _start(self) -> subprocess.Popen[str]:
        if self._process is None:
            self._process = subprocess.Popen(
                self._command,
                cwd=self._cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        return self._process

    def _request(self, op: str, **values: Any) -> Any:
        process = self._start()
        if process.stdin is None or process.stdout is None:
            raise HexMachinaProtocolError("Rollout subprocess streams are unavailable")
        self._request_id += 1
        request = {"id": self._request_id, "op": op, **values}
        process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        process.stdin.flush()
        line = process.stdout.readline()
        if not line:
            detail = process.stderr.read().strip() if process.stderr is not None else ""
            raise HexMachinaProtocolError(
                f"Rollout subprocess ended without a response{': ' + detail if detail else ''}"
            )
        response = json.loads(line)
        if response.get("id") != self._request_id:
            raise HexMachinaProtocolError("Rollout response id does not match request id")
        if not response.get("ok"):
            error = response.get("error", {})
            raise HexMachinaProtocolError(str(error.get("message", "Rollout operation failed")))
        return response["payload"]

    def describe(self) -> Mapping[str, Any]:
        return self._request("describe")

    def reset(self, split: str | None = None, index: int | None = None):
        values: dict[str, Any] = {}
        if split is not None:
            values["split"] = split
        if index is not None:
            values["index"] = index
        payload = self._request("reset", **values)
        info = dict(payload["info"])
        info["task"] = payload["task"]
        info["episode"] = payload["episode"]
        return payload["observation"], info

    def step(self, action: Mapping[str, Any]):
        payload = self._request("step", action=dict(action))
        info = dict(payload["info"])
        info["episode"] = payload["episode"]
        if "result" in payload:
            info["result"] = payload["result"]
        if "error" in payload:
            info["error"] = payload["error"]
        return (
            payload["observation"],
            payload["reward"],
            payload["terminated"],
            payload["truncated"],
            info,
        )

    def snapshot(self) -> Mapping[str, Any]:
        return self._request("snapshot")

    def close(self) -> None:
        if self._process is None:
            return
        if self._process.stdin is not None:
            self._process.stdin.close()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.terminate()
            self._process.wait(timeout=5)
        self._process = None

    def __enter__(self) -> "HexMachinaEnv":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
