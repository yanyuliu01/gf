"""Minimal Concordia sandbox sidecar for GF.

This service intentionally exposes only the AgentWorld contract:
  POST /v1/observe
  POST /v1/resolve
  POST /v1/advance

It is a POC sandbox, not the final deterministic world authority. GF remains the
only owner of cognition, memory, belief, affect and Policy.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
import re
import threading
import urllib.error
import urllib.request
from typing import Any

import numpy as np

from concordia.associative_memory import basic_associative_memory
from concordia.components.game_master import event_resolution
from concordia.components.game_master import next_acting
from concordia.environment.engines import sequential
from concordia.language_model import language_model
from concordia.prefabs.game_master import situated_in_time_and_place
from concordia.typing import entity as entity_lib


DEFAULT_PREMISE = (
    "特里蒙，莱茵生命重组过渡期。缪尔赛思正在正常生活和工作。"
    "中央生态园、生态科办公室、会议区与附近街区持续运行；"
    "世界不是为了制造剧情而存在。"
)
DEFAULT_LOCATIONS = """
- 中央生态园：植物、培养区、灌溉与环境设备持续运行。
- 生态科办公室：日常记录、数据、同事协作与行政事务发生在这里。
- 会议区与公共走廊：共享空间，存在会议、偶遇、改期与等待。
- 住所与附近街区：私人生活、休息、购物与往返发生在这里。
移动需要时间；不允许无过场瞬移。NPC 可以拒绝、改期或暂时不可用。
""".strip()
DEFAULT_CLOCK = (
    "世界时间以显式 ISO 时间推进。时间会影响正在进行的工作、约定、开放时段和环境，"
    "但不为了戏剧性自动生成重大事件。"
)


class DeepSeekConcordiaModel(language_model.LanguageModel):
    """Small OpenAI-compatible adapter that only sends DeepSeek-safe fields."""

    def __init__(self, api_key: str, model: str, base_url: str) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")

    def sample_text(
        self,
        prompt: str,
        *,
        max_tokens: int = language_model.DEFAULT_MAX_TOKENS,
        terminators: Collection[str] = language_model.DEFAULT_TERMINATORS,
        temperature: float = language_model.DEFAULT_TEMPERATURE,
        top_p: float = language_model.DEFAULT_TOP_P,
        top_k: int = language_model.DEFAULT_TOP_K,
        timeout: float = language_model.DEFAULT_TIMEOUT_SECONDS,
        seed: int | None = None,
    ) -> str:
        del top_k
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": min(2.0, max(0.0, temperature)),
            "top_p": min(1.0, max(0.01, top_p)),
            "max_tokens": min(max_tokens, 4000),
        }
        if seed is not None:
            payload["seed"] = seed
        content = self._chat(payload, timeout)
        for terminator in terminators:
            if terminator and terminator in content:
                content = content.split(terminator, 1)[0]
        return content.strip()

    def sample_choice(
        self,
        prompt: str,
        responses: Sequence[str],
        *,
        seed: int | None = None,
    ) -> tuple[int, str, Mapping[str, Any]]:
        if not responses:
            raise language_model.InvalidResponseError("No responses supplied")
        options = "\n".join(f"{i}: {value}" for i, value in enumerate(responses))
        choice_prompt = (
            f"{prompt}\n\nChoose exactly one option.\n{options}\n"
            "Return only the integer index."
        )
        for attempt in range(6):
            answer = self.sample_text(
                choice_prompt,
                max_tokens=12,
                temperature=0.0,
                seed=None if seed is None else seed + attempt,
            )
            match = re.search(r"\d+", answer)
            if match:
                index = int(match.group(0))
                if 0 <= index < len(responses):
                    return index, responses[index], {"attempt": attempt + 1}
            if answer in responses:
                index = list(responses).index(answer)
                return index, responses[index], {"attempt": attempt + 1}
        raise language_model.InvalidResponseError(f"Invalid choice response: {answer!r}")

    def _chat(self, payload: Mapping[str, Any], timeout: float) -> str:
        request = urllib.request.Request(
            f"{self._base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"DeepSeek world model failed ({exc.code}): {detail}") from exc
        choices = body.get("choices") or []
        if not choices:
            raise RuntimeError(f"DeepSeek world model returned no choices: {body}")
        return str(choices[0].get("message", {}).get("content") or "")


class ExternalGFActor:
    """A named Concordia player whose actual cognition lives outside Concordia."""

    def __init__(self, name: str) -> None:
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    def observe(self, observation: str) -> None:
        del observation

    def act(self, action_spec: entity_lib.ActionSpec = entity_lib.DEFAULT_ACTION_SPEC) -> str:
        # This actor should not normally be solicited by the sidecar. If the GM
        # asks whether GF voluntarily takes an additional action, default to No
        # instead of inventing cognition on the world side.
        if action_spec.options:
            if "No" in action_spec.options:
                return "No"
            return action_spec.options[0]
        return ""


@dataclass
class StoredObservation:
    cursor: int
    event_id: str
    observed_at: str
    text: str
    source: str


class ConcordiaSandboxWorld:
    def __init__(self) -> None:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is required by the Concordia sandbox")

        self.actor_id = os.environ.get("GF_WORLD_ACTOR_ID", "muelsyse")
        self.world_time = os.environ.get("GF_WORLD_START_TIME", "2026-08-26T09:00:00+08:00")
        self._cursor = 0
        self._observations: list[StoredObservation] = []
        self._lock = threading.RLock()

        model = DeepSeekConcordiaModel(
            api_key=api_key,
            model=os.environ.get("GF_WORLD_MODEL", os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")),
            base_url=os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
        )
        actor = ExternalGFActor(self.actor_id)
        memory = basic_associative_memory.AssociativeMemoryBank(
            sentence_embedder=hash_embed,
            allow_duplicates=True,
        )
        prefab = situated_in_time_and_place.GameMaster(
            params={
                "name": "GF sandbox world",
                "clock_description": DEFAULT_CLOCK,
                "start_time": self.world_time,
                "locations": os.environ.get("GF_WORLD_LOCATIONS", DEFAULT_LOCATIONS),
                "extra_event_resolution_steps": "attempt_to_most_likely_outcome",
            },
            entities=(actor,),
        )
        self._actor = actor
        self._gm = prefab.build(model=model, memory_bank=memory)
        self._engine = sequential.Sequential()

        self._gm.observe(f"{event_resolution.EVENT_TAG} {os.environ.get('GF_WORLD_PREMISE', DEFAULT_PREMISE)}")
        self._set_active_actor()
        self._append_observation(self._make_observation(), "environment")

    def observe(self, after_cursor: str | None) -> dict[str, Any]:
        with self._lock:
            try:
                cursor = int(after_cursor or 0)
            except ValueError:
                cursor = 0
            rows = [item for item in self._observations if item.cursor > cursor]
            return {
                "actorId": self.actor_id,
                "worldTime": self.world_time,
                "cursor": str(self._cursor),
                "observations": [
                    {
                        "id": item.event_id,
                        "observedAt": item.observed_at,
                        "text": item.text,
                        "source": item.source,
                    }
                    for item in rows
                ],
            }

    def resolve(self, proposal: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            action_id = str(proposal.get("id") or f"action-{self._cursor + 1}")
            actor_id = str(proposal.get("actorId") or "")
            intent = str(proposal.get("intent") or "").strip()
            if actor_id != self.actor_id:
                raise ValueError(f"Unknown actorId: {actor_id}")
            if not intent:
                raise ValueError("intent is required")

            self._set_active_actor()
            self._gm.observe(
                f"{event_resolution.PUTATIVE_EVENT_TAG} {self.actor_id}: {intent}"
            )
            result = self._gm.act(
                entity_lib.ActionSpec(
                    call_to_action=sequential.DEFAULT_CALL_TO_RESOLVE,
                    output_type=entity_lib.OutputType.RESOLVE,
                )
            )
            self._gm.observe(f"{event_resolution.EVENT_TAG} {result}")
            observation = self._append_observation(self._make_observation(), "environment")
            return {
                "actionId": action_id,
                "actorId": self.actor_id,
                "status": classify_resolution(result),
                "happened": result,
                "startedAt": str(proposal.get("proposedAt") or self.world_time),
                "endedAt": self.world_time,
                "committedEventIds": [observation.event_id],
                "observations": [self._wire_observation(observation)],
            }

    def advance(self, to: str) -> dict[str, Any]:
        with self._lock:
            if not to:
                raise ValueError("to is required")
            old = self.world_time
            self.world_time = to
            self._gm.observe(
                f"{event_resolution.EVENT_TAG} World time advances from {old} to {to}. "
                "Existing activities, appointments, environments and NPC situations may evolve accordingly."
            )
            observation = self._append_observation(self._make_observation(), "system")
            return {
                "from": old,
                "to": to,
                "committedEventIds": [observation.event_id],
            }

    def _set_active_actor(self) -> None:
        component = self._gm.get_component(
            next_acting.DEFAULT_NEXT_ACTING_COMPONENT_KEY,
            type_=next_acting.NextActing,
        )
        component.set_state({"currently_active_player": self.actor_id})

    def _make_observation(self) -> str:
        return self._engine.make_observation(self._gm, self._actor).strip()

    def _append_observation(self, text: str, source: str) -> StoredObservation:
        self._cursor += 1
        row = StoredObservation(
            cursor=self._cursor,
            event_id=f"world-{self._cursor:06d}",
            observed_at=self.world_time,
            text=text,
            source=source,
        )
        self._observations.append(row)
        return row

    @staticmethod
    def _wire_observation(item: StoredObservation) -> dict[str, Any]:
        return {
            "id": item.event_id,
            "observedAt": item.observed_at,
            "text": item.text,
            "source": item.source,
        }


def classify_resolution(text: str) -> str:
    lower = text.lower()
    if any(token in lower for token in ("refus", "cannot", "can't", "failed", "unable", "拒绝", "失败", "无法")):
        return "rejected"
    if any(token in lower for token in ("partial", "部分", "只完成")):
        return "partial"
    if any(token in lower for token in ("later", "delay", "wait", "延期", "稍后", "等待")):
        return "deferred"
    return "accepted"


def hash_embed(text: str, dimensions: int = 192) -> np.ndarray:
    """Cheap deterministic lexical embedder for sandbox GM event memory."""
    vector = np.zeros(dimensions, dtype=float)
    tokens = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]", text.lower())
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(float(np.dot(vector, vector)))
    if norm > 0:
        vector /= norm
    return vector


class Handler(BaseHTTPRequestHandler):
    world: ConcordiaSandboxWorld

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self._read_json()
            if self.path == "/v1/observe":
                body = self.world.observe(payload.get("afterCursor"))
            elif self.path == "/v1/resolve":
                body = self.world.resolve(payload)
            elif self.path == "/v1/advance":
                body = self.world.advance(str(payload.get("to") or ""))
            else:
                self._send(404, {"error": "not_found"})
                return
            self._send(200, body)
        except Exception as exc:  # sandbox boundary: return errors to TS bridge
            self._send(400, {"error": type(exc).__name__, "message": str(exc)})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "backend": "concordia-sandbox"})
        else:
            self._send(404, {"error": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[concordia] {format % args}")

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length) if length else b"{}"
        return json.loads(data.decode("utf-8"))

    def _send(self, status: int, payload: Mapping[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    host = os.environ.get("GF_CONCORDIA_HOST", "127.0.0.1")
    port = int(os.environ.get("GF_CONCORDIA_PORT", "8765"))
    world = ConcordiaSandboxWorld()
    Handler.world = world
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"GF Concordia sandbox listening on http://{host}:{port}")
    print("This is a generative sandbox world, not the final deterministic authority.")
    server.serve_forever()


if __name__ == "__main__":
    main()
