"""Dependency-free Python client for the Hex Machina JSONL rollout bridge."""

from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
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
        self._command = list(command or (
            str(repository / "node_modules" / ".bin" / "tsx"),
            "scripts/serve-agent-gym.ts",
        ))
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

    def reset(
        self,
        split: str | None = None,
        index: int | None = None,
        family: str | None = None,
    ):
        values: dict[str, Any] = {}
        if split is not None:
            values["split"] = split
        if index is not None:
            values["index"] = index
        if family is not None:
            values["family"] = family
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


class HexMachinaVectorEnv:
    """Parallel, isolated Hex Machina environments with vector-style returns.

    Each slot owns a separate production rollout subprocess. Calls execute in
    parallel, preserve slot order, and never share graph or episode state.
    """

    def __init__(
        self,
        num_envs: int,
        command: Sequence[str] | None = None,
        cwd: str | Path | None = None,
    ) -> None:
        if not isinstance(num_envs, int) or isinstance(num_envs, bool) or num_envs < 1:
            raise ValueError("num_envs must be a positive integer")
        self.num_envs = num_envs
        self._environments = [
            HexMachinaEnv(command=command, cwd=cwd) for _ in range(num_envs)
        ]
        self._executor = ThreadPoolExecutor(
            max_workers=num_envs,
            thread_name_prefix="hex-machina-rollout",
        )
        self._closed = False

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("Vector environment is closed")

    def _require_batch(self, values: Sequence[Any], label: str) -> list[Any]:
        selected = list(values)
        if len(selected) != self.num_envs:
            raise ValueError(
                f"{label} must contain exactly {self.num_envs} items; received {len(selected)}"
            )
        return selected

    def describe(self) -> list[Mapping[str, Any]]:
        self._ensure_open()
        return list(self._executor.map(lambda env: env.describe(), self._environments))

    def reset(
        self,
        split: str | None = None,
        indices: Sequence[int] | None = None,
        family: str | None = None,
        families: Sequence[str] | None = None,
    ):
        self._ensure_open()
        if indices is None:
            selected_indices: list[int | None] = (
                list(range(self.num_envs)) if split is not None else [None] * self.num_envs
            )
        else:
            if split is None:
                raise ValueError("split is required when indices are provided")
            selected_indices = self._require_batch(indices, "indices")

        if family is not None and families is not None:
            raise ValueError("family and families are mutually exclusive")
        selected_families: list[str | None] = (
            self._require_batch(families, "families")
            if families is not None
            else [family] * self.num_envs
        )

        def reset_slot(values: tuple[HexMachinaEnv, int | None, str | None]):
            env, index, selected_family = values
            return env.reset(split=split, index=index, family=selected_family)

        results = list(self._executor.map(
            reset_slot,
            zip(self._environments, selected_indices, selected_families),
        ))
        observations, infos = zip(*results)
        return list(observations), list(infos)

    def step(self, actions: Sequence[Mapping[str, Any]]):
        self._ensure_open()
        selected_actions = self._require_batch(actions, "actions")
        if any(not isinstance(action, Mapping) for action in selected_actions):
            raise ValueError("every action must be a mapping")

        def step_slot(values: tuple[HexMachinaEnv, Mapping[str, Any]]):
            env, action = values
            return env.step(action)

        results = list(self._executor.map(
            step_slot,
            zip(self._environments, selected_actions),
        ))
        observations, rewards, terminated, truncated, infos = zip(*results)
        return (
            list(observations),
            list(rewards),
            list(terminated),
            list(truncated),
            list(infos),
        )

    def snapshots(self) -> list[Mapping[str, Any]]:
        self._ensure_open()
        return list(self._executor.map(lambda env: env.snapshot(), self._environments))

    def close(self) -> None:
        if self._closed:
            return
        list(self._executor.map(lambda env: env.close(), self._environments))
        self._executor.shutdown(wait=True)
        self._closed = True

    def __enter__(self) -> "HexMachinaVectorEnv":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
