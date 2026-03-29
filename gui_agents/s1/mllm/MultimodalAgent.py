"""
KlimAgent — LMMAgent (s1)
NIM-only multimodal agent. All other providers removed.
"""
import base64
import numpy as np
from gui_agents.s1.mllm.MultimodalEngine import LMMEngineNvidiaNIM


class LMMAgent:
    def __init__(self, engine_params=None, system_prompt=None, engine=None):
        if engine is not None:
            self.engine = engine
        elif engine_params is not None:
            params = {k: v for k, v in engine_params.items() if k != "engine_type"}
            self.engine = LMMEngineNvidiaNIM(**params)
        else:
            raise ValueError("engine or engine_params must be provided")

        self.messages = []
        self.system_prompt = system_prompt or "You are a helpful assistant."
        self.add_system_prompt(self.system_prompt)

    def encode_image(self, image_content):
        if isinstance(image_content, str):
            with open(image_content, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        return base64.b64encode(image_content).decode("utf-8")

    def reset(self):
        self.messages = [{"role": "system", "content": [{"type": "text", "text": self.system_prompt}]}]

    def add_system_prompt(self, system_prompt):
        self.system_prompt = system_prompt
        if self.messages:
            self.messages[0] = {"role": "system", "content": [{"type": "text", "text": system_prompt}]}
        else:
            self.messages.append({"role": "system", "content": [{"type": "text", "text": system_prompt}]})

    def remove_message_at(self, index):
        if index < len(self.messages):
            self.messages.pop(index)

    def replace_message_at(self, index, text_content, image_content=None, image_detail="high"):
        if index >= len(self.messages):
            return
        self.messages[index] = {"role": self.messages[index]["role"], "content": [{"type": "text", "text": text_content}]}
        if image_content is not None:
            b64 = self.encode_image(image_content)
            self.messages[index]["content"].append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}", "detail": image_detail}})

    def add_message(self, text_content, image_content=None, role=None, image_detail="high", put_text_last=False):
        if role != "user":
            last = self.messages[-1]["role"] if self.messages else "system"
            role = "user" if last in ("system", "assistant") else "assistant"

        message = {"role": role, "content": [{"type": "text", "text": text_content}]}
        if image_content is not None:
            imgs = image_content if isinstance(image_content, list) else [image_content]
            for img in imgs:
                if img is None:
                    continue
                b64 = self.encode_image(img)
                message["content"].append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}", "detail": image_detail}})

        if put_text_last:
            text_part = message["content"].pop(0)
            message["content"].append(text_part)

        self.messages.append(message)

    def get_response(self, user_message=None, messages=None, temperature=0.0, max_new_tokens=None, use_thinking=False, **kwargs):
        msgs = messages if messages is not None else self.messages
        if user_message:
            msgs = msgs + [{"role": "user", "content": [{"type": "text", "text": user_message}]}]
        if use_thinking:
            return self.engine.generate_with_thinking(msgs, temperature=temperature, max_new_tokens=max_new_tokens)
        return self.engine.generate(msgs, temperature=temperature, max_new_tokens=max_new_tokens)
