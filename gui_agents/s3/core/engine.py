"""
KlimAgent — NVIDIA NIM LMM Engine
The ONLY inference backend. All other providers removed.
Uses NVIDIA NIM's OpenAI-compatible API.
"""
import os
import backoff
from openai import OpenAI, APIConnectionError, APIError, RateLimitError

NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_TEXT_MODEL  = "meta/llama-3.3-70b-instruct"
DEFAULT_VISION_MODEL = "nvidia/llama-3.2-90b-vision-instruct"


class LMMEngineNvidiaNIM:
    """
    NVIDIA NIM inference engine — OpenAI-compatible endpoint.
    Supports both text-only and vision (multimodal) NIM models.

    engine_params example:
        {
            "engine_type": "nvidia_nim",
            "model": "meta/llama-3.3-70b-instruct",
            "api_key": "nvapi-...",          # or set NVIDIA_API_KEY
        }
    """

    def __init__(
        self,
        model: str = None,
        api_key: str = None,
        base_url: str = None,
        temperature: float = None,
        grounding_width: int = None,
        grounding_height: int = None,
        engine_type: str = None,   # accepted but ignored (always NIM)
        rate_limit: int = -1,
        **kwargs,
    ):
        self.model           = model or os.getenv("NVIDIA_NIM_MODEL", DEFAULT_TEXT_MODEL)
        self.api_key         = api_key or os.getenv("NVIDIA_API_KEY", "")
        self.base_url        = base_url or NVIDIA_NIM_BASE_URL
        self.temperature     = temperature
        self.grounding_width  = grounding_width
        self.grounding_height = grounding_height
        self._client         = None

    @property
    def client(self) -> OpenAI:
        if not self._client:
            if not self.api_key:
                raise ValueError(
                    "NVIDIA_API_KEY is required. Set it in .env or pass api_key= to engine_params."
                )
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        return self._client

    @backoff.on_exception(
        backoff.expo, (APIConnectionError, APIError, RateLimitError), max_time=60
    )
    def generate(self, messages, temperature: float = 0.0, max_new_tokens: int = None, **kwargs) -> str:
        temp = self.temperature if self.temperature is not None else temperature
        return (
            self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=max_new_tokens or 4096,
                temperature=temp,
                top_p=0.7,
            )
            .choices[0]
            .message.content
        )

    def generate_with_thinking(self, messages, temperature: float = 0.0, max_new_tokens: int = None, **kwargs) -> str:
        """NIM does not have a separate thinking budget — falls back to generate()."""
        return self.generate(messages, temperature=temperature, max_new_tokens=max_new_tokens)


# Backwards-compat alias used internally by module.py / worker.py
LMMEngine = LMMEngineNvidiaNIM
