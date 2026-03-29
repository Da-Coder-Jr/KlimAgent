"""
KlimAgent — LMMAgent
Multimodal agent wrapper using NVIDIA NIM exclusively.
Uses OpenAI message format throughout (NIM is OpenAI-compatible).
"""
import base64
import numpy as np

# Import is module-relative; the path is patched per-version below
from gui_agents.s2_5.core.engine import LMMEngineNvidiaNIM


class LMMAgent:
    """
    Manages conversation history and delegates inference to LMMEngineNvidiaNIM.
    Supports text-only and vision (screenshot) messages in OpenAI format.
    """

    def __init__(self, engine_params: dict = None, system_prompt: str = None, engine=None):
        if engine is not None:
            self.engine = engine
        elif engine_params is not None:
            # Strip engine_type key — we always use NIM
            params = {k: v for k, v in engine_params.items() if k != "engine_type"}
            self.engine = LMMEngineNvidiaNIM(**params)
        else:
            raise ValueError("engine or engine_params must be provided")

        self.messages: list = []
        self.system_prompt: str = system_prompt or "You are a helpful assistant."
        self.add_system_prompt(self.system_prompt)

    # ── Image encoding ─────────────────────────────────────────────────────

    def encode_image(self, image_content) -> str:
        if isinstance(image_content, str):
            with open(image_content, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        return base64.b64encode(image_content).decode("utf-8")

    # ── Message management ─────────────────────────────────────────────────

    def reset(self):
        self.messages = [
            {"role": "system", "content": [{"type": "text", "text": self.system_prompt}]}
        ]

    def add_system_prompt(self, system_prompt: str):
        self.system_prompt = system_prompt
        if self.messages:
            self.messages[0] = {
                "role": "system",
                "content": [{"type": "text", "text": system_prompt}],
            }
        else:
            self.messages.append(
                {"role": "system", "content": [{"type": "text", "text": system_prompt}]}
            )

    def remove_message_at(self, index: int):
        if index < len(self.messages):
            self.messages.pop(index)

    def replace_message_at(self, index: int, text_content: str, image_content=None, image_detail: str = "high"):
        if index >= len(self.messages):
            return
        self.messages[index] = {
            "role": self.messages[index]["role"],
            "content": [{"type": "text", "text": text_content}],
        }
        if image_content is not None:
            b64 = self.encode_image(image_content)
            self.messages[index]["content"].append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}", "detail": image_detail},
            })

    def add_message(
        self,
        text_content: str,
        image_content=None,
        role: str = None,
        image_detail: str = "high",
        put_text_last: bool = False,
    ):
        # Infer role from conversation history (alternating user/assistant)
        if role != "user":
            last = self.messages[-1]["role"] if self.messages else "system"
            role = "user" if last in ("system", "assistant") else "assistant"

        message = {
            "role": role,
            "content": [{"type": "text", "text": text_content}],
        }

        # Attach image(s) — NIM vision models use image_url format
        if image_content is not None or (
            isinstance(image_content, np.ndarray) and image_content.size > 0
        ):
            imgs = image_content if isinstance(image_content, list) else [image_content]
            for img in imgs:
                if img is None:
                    continue
                b64 = self.encode_image(img)
                message["content"].append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{b64}",
                        "detail": image_detail,
                    },
                })

        if put_text_last:
            text_part = message["content"].pop(0)
            message["content"].append(text_part)

        self.messages.append(message)

    # ── Inference ──────────────────────────────────────────────────────────

    def get_response(
        self,
        user_message: str = None,
        messages: list = None,
        temperature: float = 0.0,
        max_new_tokens: int = None,
        use_thinking: bool = False,
        **kwargs,
    ) -> str:
        msgs = messages if messages is not None else self.messages
        if user_message:
            msgs = msgs + [
                {"role": "user", "content": [{"type": "text", "text": user_message}]}
            ]
        if use_thinking:
            return self.engine.generate_with_thinking(
                msgs, temperature=temperature, max_new_tokens=max_new_tokens
            )
        return self.engine.generate(
            msgs, temperature=temperature, max_new_tokens=max_new_tokens
        )
