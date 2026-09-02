"""Streaming Python access to verified Hexmend preference groups."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence


PREFERENCE_GROUP_SCHEMA = "hexmend-agent-gym-preference-group/v2"
PREFERENCE_PAIR_SCHEMA = "hexmend-agent-gym-preference-pair/v2"
PREFERENCE_VERIFIER_PROTOCOL = "hexmend-agent-gym-preference-verifier/v2"
EXPECTED_POLICY_IDS = {
    "grounded-reference",
    "mutate-before-explain",
    "diagnosis-only",
    "constraint-violating",
    "memorized-canonical-ids",
}
MAX_DATASET_BYTES = 64 * 1024 * 1024
MAX_GROUP_BYTES = 4 * 1024 * 1024
MAX_GROUPS = 256
PAIR_CONTEXT_FIELDS = (
    "environmentProtocol",
    "observationSchema",
    "actionManifest",
    "familyId",
    "scenarioId",
    "split",
    "variantIndex",
    "seed",
    "task",
    "initialObservation",
    "initialStateKey",
)


class HexmendPreferenceError(ValueError):
    """Raised when a preference artifact violates its versioned contract."""


def _record(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise HexmendPreferenceError(f"{label} must be a JSON object")
    return value


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HexmendPreferenceError(f"{label} must be numeric")
    return float(value)


def _optional_filter(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise HexmendPreferenceError(f"{label} filter must be a non-empty string")
    return value


def _validate_group(value: Any, line_number: int) -> Mapping[str, Any]:
    prefix = f"preference group on line {line_number}"
    group = _record(value, prefix)
    if group.get("schema") != PREFERENCE_GROUP_SCHEMA:
        raise HexmendPreferenceError(f"{prefix} has an unsupported schema")
    if not isinstance(group.get("scenarioId"), str) or not group["scenarioId"]:
        raise HexmendPreferenceError(f"{prefix} requires scenarioId")
    if not isinstance(group.get("familyId"), str) or not group["familyId"]:
        raise HexmendPreferenceError(f"{prefix} requires familyId")
    if not isinstance(group.get("split"), str) or not group["split"]:
        raise HexmendPreferenceError(f"{prefix} requires split")
    if any(field not in group for field in PAIR_CONTEXT_FIELDS):
        raise HexmendPreferenceError(f"{prefix} is missing trainer context")

    candidates = group.get("candidates")
    pairs = group.get("preferencePairs")
    if not isinstance(candidates, list) or len(candidates) != 5:
        raise HexmendPreferenceError(f"{prefix} must contain five candidates")
    if not isinstance(pairs, list) or len(pairs) != 10:
        raise HexmendPreferenceError(f"{prefix} must contain ten preference pairs")

    candidate_by_policy: dict[str, Mapping[str, Any]] = {}
    for expected_rank, candidate_value in enumerate(candidates, start=1):
        candidate = _record(candidate_value, f"candidate {expected_rank} on line {line_number}")
        policy_id = candidate.get("policyId")
        if not isinstance(policy_id, str) or policy_id not in EXPECTED_POLICY_IDS or policy_id in candidate_by_policy:
            raise HexmendPreferenceError(f"{prefix} contains an unknown or duplicate policy")
        if candidate.get("rank") != expected_rank:
            raise HexmendPreferenceError(f"{prefix} candidate ranks are not contiguous")
        _number(candidate.get("reward"), f"{prefix} candidate reward")
        _number(candidate.get("advantage"), f"{prefix} candidate advantage")
        if not isinstance(candidate.get("transitions"), list):
            raise HexmendPreferenceError(f"{prefix} candidate transitions must be an array")
        termination_reason = candidate.get("terminationReason")
        expected_violation = termination_reason == "constraint-violated"
        expected_preserved = (
            False if expected_violation else True if termination_reason == "goal-verified" else None
        )
        if candidate.get("constraintViolation") is not expected_violation:
            raise HexmendPreferenceError(f"{prefix} contains an inconsistent constraint violation label")
        if candidate.get("constraintPreserved") is not expected_preserved:
            raise HexmendPreferenceError(f"{prefix} contains an inconsistent constraint preservation label")
        candidate_by_policy[policy_id] = candidate

    if set(candidate_by_policy) != EXPECTED_POLICY_IDS:
        raise HexmendPreferenceError(f"{prefix} does not contain the expected policy controls")
    rewards = [_number(candidate["reward"], f"{prefix} candidate reward") for candidate in candidates]
    if any(left <= right for left, right in zip(rewards, rewards[1:])):
        raise HexmendPreferenceError(f"{prefix} rewards are not strictly descending")
    mean_reward = sum(rewards) / len(rewards)
    if abs(_number(group.get("groupMeanReward"), f"{prefix} group mean") - mean_reward) > 1e-9:
        raise HexmendPreferenceError(f"{prefix} group mean does not match its rewards")
    for candidate in candidates:
        if abs(_number(candidate["advantage"], f"{prefix} candidate advantage") - (_number(candidate["reward"], f"{prefix} candidate reward") - mean_reward)) > 1e-9:
            raise HexmendPreferenceError(f"{prefix} contains an inconsistent centered advantage")

    expected_pairs = {
        (candidates[chosen]["policyId"], candidates[rejected]["policyId"])
        for chosen in range(len(candidates))
        for rejected in range(chosen + 1, len(candidates))
    }
    observed_pairs: set[tuple[str, str]] = set()
    for pair_value in pairs:
        pair = _record(pair_value, f"preference pair on line {line_number}")
        chosen_id = pair.get("chosenPolicyId")
        rejected_id = pair.get("rejectedPolicyId")
        if not isinstance(chosen_id, str) or not isinstance(rejected_id, str):
            raise HexmendPreferenceError(f"{prefix} pair policy IDs must be strings")
        identity = (chosen_id, rejected_id)
        if identity not in expected_pairs or identity in observed_pairs:
            raise HexmendPreferenceError(f"{prefix} contains an unknown or duplicate pair")
        expected_margin = (
            float(candidate_by_policy[chosen_id]["reward"])
            - float(candidate_by_policy[rejected_id]["reward"])
        )
        if _number(pair.get("rewardMargin"), f"{prefix} preference margin") != expected_margin or expected_margin <= 0:
            raise HexmendPreferenceError(f"{prefix} contains an inconsistent preference margin")
        observed_pairs.add(identity)
    if observed_pairs != expected_pairs:
        raise HexmendPreferenceError(f"{prefix} does not contain every ranked pair")
    return group


class HexmendPreferenceDataset:
    """Bounded, repeatable streaming view over preference-group JSONL.

    Call :meth:`verify` before training to rerun the canonical TypeScript
    verifier. Calls to :meth:`groups` and :meth:`pairs` then stream one JSONL
    group at a time, so pair iteration never loads the complete corpus.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _validate_size(self) -> None:
        size = self.path.stat().st_size
        if size == 0:
            raise HexmendPreferenceError("preference dataset is empty")
        if size > MAX_DATASET_BYTES:
            raise HexmendPreferenceError("preference dataset exceeds the 64 MiB limit")

    def verify(
        self,
        command: Sequence[str] | None = None,
        cwd: str | Path | None = None,
    ) -> Mapping[str, Any]:
        """Regenerate every labeled policy with the production verifier."""

        self._validate_size()
        repository = Path(__file__).resolve().parents[1]
        selected_command = list(command or (
            str(repository / "node_modules" / ".bin" / "tsx"),
            "scripts/verify-agent-gym-preferences.ts",
        ))
        with self.path.open("r", encoding="utf-8") as source:
            result = subprocess.run(
                selected_command,
                cwd=Path(cwd) if cwd is not None else repository,
                stdin=source,
                capture_output=True,
                text=True,
                check=False,
            )
        try:
            receipt = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            detail = result.stderr.strip() or "verifier returned no JSON receipt"
            raise HexmendPreferenceError(detail) from error
        if result.returncode != 0 or receipt.get("valid") is not True:
            issue = receipt.get("issues", [{}])[0].get("message", "verification failed")
            raise HexmendPreferenceError(str(issue))
        if receipt.get("protocol") != PREFERENCE_VERIFIER_PROTOCOL:
            raise HexmendPreferenceError("verifier returned an unsupported protocol")
        return receipt

    def groups(
        self,
        *,
        split: str | None = None,
        family: str | None = None,
    ) -> Iterator[Mapping[str, Any]]:
        """Yield validated groups in file order, optionally restricting a curriculum."""

        self._validate_size()
        selected_split = _optional_filter(split, "split")
        selected_family = _optional_filter(family, "family")
        seen_scenarios: set[str] = set()
        group_count = 0
        matched_count = 0
        with self.path.open("r", encoding="utf-8") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                if len(line.encode("utf-8")) > MAX_GROUP_BYTES:
                    raise HexmendPreferenceError(
                        f"preference group on line {line_number} exceeds the 4 MiB limit"
                    )
                group_count += 1
                if group_count > MAX_GROUPS:
                    raise HexmendPreferenceError("preference dataset exceeds 256 groups")
                try:
                    decoded = json.loads(line)
                except json.JSONDecodeError as error:
                    raise HexmendPreferenceError(
                        f"preference group on line {line_number} is not valid JSON"
                    ) from error
                group = _validate_group(decoded, line_number)
                scenario_id = str(group["scenarioId"])
                if scenario_id in seen_scenarios:
                    raise HexmendPreferenceError(f"duplicate scenarioId {scenario_id}")
                seen_scenarios.add(scenario_id)
                if selected_split is not None and group["split"] != selected_split:
                    continue
                if selected_family is not None and group["familyId"] != selected_family:
                    continue
                matched_count += 1
                yield group
        if group_count == 0:
            raise HexmendPreferenceError("preference dataset is empty")
        if matched_count == 0:
            filters = ", ".join(
                value
                for value in (
                    f"split={selected_split!r}" if selected_split is not None else "",
                    f"family={selected_family!r}" if selected_family is not None else "",
                )
                if value
            )
            raise HexmendPreferenceError(f"no preference groups match {filters}")

    def pairs(
        self,
        *,
        split: str | None = None,
        family: str | None = None,
    ) -> Iterator[Mapping[str, Any]]:
        """Project a filtered group stream into chosen/rejected records."""

        for group in self.groups(split=split, family=family):
            candidate_by_policy = {
                candidate["policyId"]: candidate for candidate in group["candidates"]
            }
            for pair in group["preferencePairs"]:
                yield {
                    "schema": PREFERENCE_PAIR_SCHEMA,
                    **{field: group[field] for field in PAIR_CONTEXT_FIELDS},
                    "chosen": candidate_by_policy[pair["chosenPolicyId"]],
                    "rejected": candidate_by_policy[pair["rejectedPolicyId"]],
                    "rewardMargin": pair["rewardMargin"],
                }
