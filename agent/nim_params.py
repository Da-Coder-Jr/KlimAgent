"""
KlimAgent — NVIDIA NIM engine parameter helpers.
The single source of truth for all engine_params dicts used by Agent-S.
"""
import os

NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Curated NIM text models (reasoning / planning)
TEXT_MODELS = [
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "meta/llama-3.1-405b-instruct",
    "mistralai/mixtral-8x22b-instruct-v0.1",
    "mistralai/mistral-large",
    "qwen/qwen2.5-72b-instruct",
]

# Curated NIM vision models (grounding / screenshot analysis)
VISION_MODELS = [
    "nvidia/llama-3.2-90b-vision-instruct",
    "nvidia/llama-3.2-11b-vision-instruct",
    "microsoft/phi-3.5-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct",
]


def _api_key() -> str:
    key = os.getenv("NVIDIA_API_KEY", "")
    if not key:
        raise ValueError("NVIDIA_API_KEY is not set. Add it to .env or export it.")
    return key


def get_generation_params(model: str = None) -> dict:
    """engine_params for text generation (Agent-S planning / reasoning)."""
    return {
        "engine_type": "nvidia_nim",
        "base_url": NVIDIA_NIM_BASE_URL,
        "api_key": _api_key(),
        "model": model or os.getenv("NVIDIA_NIM_MODEL", TEXT_MODELS[0]),
    }


def get_grounding_params(model: str = None, width: int = 1920, height: int = 1080) -> dict:
    """engine_params for vision grounding (screenshot → coordinates)."""
    return {
        "engine_type": "nvidia_nim",
        "base_url": NVIDIA_NIM_BASE_URL,
        "api_key": _api_key(),
        "model": model or os.getenv("NVIDIA_NIM_VISION_MODEL", VISION_MODELS[0]),
        "grounding_width": width,
        "grounding_height": height,
    }
