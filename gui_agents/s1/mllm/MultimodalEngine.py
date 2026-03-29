"""
KlimAgent — NVIDIA NIM LMM Engine (s1)
The ONLY inference backend. All other providers removed.
"""
import os
import backoff
from openai import OpenAI, APIConnectionError, APIError, RateLimitError

NVIDIA_NIM_BASE_URL  = "https://integrate.api.nvidia.com/v1"
DEFAULT_TEXT_MODEL   = "meta/llama-3.3-70b-instruct"
DEFAULT_VISION_MODEL = "nvidia/llama-3.2-90b-vision-instruct"


class LMMEngine:
    pass


class LMMEngineNvidiaNIM(LMMEngine):
    """NVIDIA NIM OpenAI-compatible engine — text and vision."""

    def __init__(self, model=None, api_key=None, base_url=None,
                 temperature=None, engine_type=None, rate_limit=-1, **kwargs):
        self.model       = model or os.getenv("NVIDIA_NIM_MODEL", DEFAULT_TEXT_MODEL)
        self.api_key     = api_key or os.getenv("NVIDIA_API_KEY", "")
        self.base_url    = base_url or NVIDIA_NIM_BASE_URL
        self.temperature = temperature
        self._client     = None

    @property
    def client(self):
        if not self._client:
            if not self.api_key:
                raise ValueError("NVIDIA_API_KEY is required.")
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        return self._client

    @backoff.on_exception(backoff.expo, (APIConnectionError, APIError, RateLimitError), max_time=60)
    def generate(self, messages, temperature=0.0, max_new_tokens=None, **kwargs):
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

    def generate_with_thinking(self, messages, temperature=0.0, max_new_tokens=None, **kwargs):
        return self.generate(messages, temperature=temperature, max_new_tokens=max_new_tokens)


# Aliases for any remaining imports
LMMEngineOpenAI = LMMEngineNvidiaNIM
LMMEngine       = LMMEngineNvidiaNIM


class OpenAIEmbeddingEngine:
    """Embeddings via NVIDIA NIM."""

    def __init__(self, model=None, api_key=None, base_url=None, **kwargs):
        self.model    = model or "nvidia/nv-embedqa-e5-v5"
        self.api_key  = api_key or os.getenv("NVIDIA_API_KEY", "")
        self.base_url = base_url or NVIDIA_NIM_BASE_URL
        self._client  = None

    @property
    def client(self):
        if not self._client:
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        return self._client

    def get_embeddings(self, texts):
        resp = self.client.embeddings.create(model=self.model, input=texts, encoding_format="float")
        return [item.embedding for item in resp.data]
