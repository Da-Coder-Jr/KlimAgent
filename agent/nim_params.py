"""
KlimAgent — NVIDIA NIM Engine Parameters
Centralised helpers to build engine_params dicts for Agent-S components.
"""
import os

NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Vision-capable models for grounding (screenshot analysis)
VISION_MODELS = [
    "nvidia/llama-3.2-90b-vision-instruct",
    "nvidia/llama-3.2-11b-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct",
    "microsoft/phi-3.5-vision-instruct",
]

# Text-only models for reasoning/planning
TEXT_MODELS = [
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "meta/llama-3.1-405b-instruct",
    "mistralai/mixtral-8x22b-instruct-v0.1",
]


def get_generation_params(model: str = None) -> dict:
    """Engine params for text generation (planning, reasoning)."""
    return {
        "engine_type": "nvidia_nim",
        "base_url": NVIDIA_NIM_BASE_URL,
        "api_key": os.getenv("NVIDIA_API_KEY", ""),
        "model": model or os.getenv("NVIDIA_NIM_MODEL", TEXT_MODELS[0]),
    }


def get_grounding_params(model: str = None, width: int = 1920, height: int = 1080) -> dict:
    """Engine params for vision grounding (screenshot → action)."""
    return {
        "engine_type": "nvidia_nim",
        "base_url": NVIDIA_NIM_BASE_URL,
        "api_key": os.getenv("NVIDIA_API_KEY", ""),
        "model": model or os.getenv("NVIDIA_NIM_VISION_MODEL", VISION_MODELS[0]),
        "grounding_width": width,
        "grounding_height": height,
    }
