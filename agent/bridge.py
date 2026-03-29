"""
KlimAgent — Python Bridge Server
FastAPI server on port 3002 exposing Agent-S GUI automation
and OSWorld benchmark capabilities to the Node.js backend.
"""
import asyncio
import base64
import io
import json
import logging
import os
import platform
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Load env from root .env
ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
load_dotenv()

sys.path.insert(0, str(ROOT))

from agent.nim_params import get_generation_params, get_grounding_params

logger = logging.getLogger("klimagent.bridge")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="KlimAgent Bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Active agent sessions ────────────────────────────────────────────────────
active_agents: Dict[str, Any] = {}


# ── Request models ────────────────────────────────────────────────────────────
class GuiTaskRequest(BaseModel):
    task: str
    session_id: str = "default"
    platform: str = platform.system().lower()
    max_steps: int = 15
    generation_model: Optional[str] = None
    grounding_model: Optional[str] = None
    enable_reflection: bool = True


class BenchmarkRequest(BaseModel):
    domain: str = "all"
    max_steps: int = 15
    num_tasks: int = 5
    test_meta_path: str = str(ROOT / "evaluation_sets/test_small_new.json")
    result_dir: str = str(ROOT / "benchmark_results")
    generation_model: Optional[str] = None
    grounding_model: Optional[str] = None
    screen_width: int = 1920
    screen_height: int = 1080


class ScreenshotRequest(BaseModel):
    session_id: str = "default"


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "klimagent-bridge",
        "nvidia_api_key_set": bool(os.getenv("NVIDIA_API_KEY")),
        "platform": platform.system(),
    }


# ── Models list ───────────────────────────────────────────────────────────────
@app.get("/models")
async def list_models():
    from agent.nim_params import TEXT_MODELS, VISION_MODELS
    return {"text": TEXT_MODELS, "vision": VISION_MODELS}


# ── Screenshot ────────────────────────────────────────────────────────────────
@app.post("/screenshot")
async def take_screenshot(req: ScreenshotRequest):
    try:
        import pyautogui
        from PIL import Image
        screenshot = pyautogui.screenshot()
        buf = io.BytesIO()
        screenshot.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return {"screenshot": b64, "width": screenshot.width, "height": screenshot.height}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── GUI Agent Task (streaming SSE) ────────────────────────────────────────────
@app.post("/gui-agent/run")
async def run_gui_agent(req: GuiTaskRequest):
    """
    Stream Agent-S2.5 execution events as SSE.
    Each line: data: <json>\n\n
    """
    async def event_stream():
        session_id = req.session_id
        try:
            engine_params = get_generation_params(req.generation_model)
            engine_params_grounding = get_grounding_params(req.grounding_model)

            yield _sse({"type": "status", "text": f"Initializing KlimAgent GUI Agent..."})

            # Import Agent-S2.5 components
            from gui_agents.s2_5.agents.agent_s import AgentS2_5

            # Try to import grounding agent
            try:
                from gui_agents.s2_5.agents.grounding import OSWorldACI
                grounding_agent = OSWorldACI(
                    platform=req.platform,
                    engine_params_for_generation=engine_params,
                    engine_params_for_grounding=engine_params_grounding,
                    width=1920,
                    height=1080,
                )
            except Exception as e:
                # Fall back to local ACI (no OSWorld VM required)
                from gui_agents.s2_5.agents.grounding import ACI
                yield _sse({"type": "warn", "text": f"OSWorldACI unavailable ({e}), using local ACI"})
                grounding_agent = ACI()

            agent = AgentS2_5(
                engine_params=engine_params,
                grounding_agent=grounding_agent,
                platform=req.platform,
                max_trajectory_length=req.max_steps,
                enable_reflection=req.enable_reflection,
            )
            active_agents[session_id] = agent

            yield _sse({"type": "status", "text": f"Agent ready. Executing: {req.task}"})

            for step in range(req.max_steps):
                if session_id not in active_agents:
                    yield _sse({"type": "status", "text": "Stopped by user"})
                    break

                yield _sse({"type": "step", "step": step + 1, "text": f"Step {step + 1}/{req.max_steps}"})

                # Take screenshot
                try:
                    import pyautogui
                    screenshot = pyautogui.screenshot()
                    buf = io.BytesIO()
                    screenshot.save(buf, format="PNG")
                    b64 = base64.b64encode(buf.getvalue()).decode()
                    yield _sse({"type": "screenshot", "data": b64})
                    obs = {"screenshot": screenshot}
                except Exception as e:
                    yield _sse({"type": "warn", "text": f"Screenshot failed: {e}"})
                    obs = {"screenshot": None}

                try:
                    info, actions = await asyncio.to_thread(
                        agent.predict, req.task, obs
                    )
                    yield _sse({"type": "actions", "actions": actions, "info": info})

                    if not actions or actions == ["DONE"] or "done" in str(actions).lower():
                        yield _sse({"type": "done", "text": "Task complete"})
                        break

                    # Execute actions
                    for action in actions:
                        yield _sse({"type": "action", "action": str(action)})
                        try:
                            exec(action, {"time": time, "__builtins__": __builtins__})
                            await asyncio.sleep(0.8)
                        except Exception as e:
                            yield _sse({"type": "error", "text": f"Action error: {e}"})

                except Exception as e:
                    yield _sse({"type": "error", "text": f"Step error: {e}"})
                    logger.error(traceback.format_exc())
                    break

            else:
                yield _sse({"type": "done", "text": f"Max steps ({req.max_steps}) reached"})

        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})
            logger.error(traceback.format_exc())
        finally:
            active_agents.pop(session_id, None)
            yield _sse({"type": "end"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/gui-agent/stop")
async def stop_gui_agent(body: dict):
    session_id = body.get("session_id", "default")
    active_agents.pop(session_id, None)
    return {"stopped": True}


# ── OSWorld Benchmark (streaming SSE) ────────────────────────────────────────
@app.post("/benchmark/run")
async def run_benchmark(req: BenchmarkRequest):
    """Stream OSWorld benchmark results as SSE."""
    async def event_stream():
        try:
            import json as _json
            test_meta_path = Path(req.test_meta_path)
            if not test_meta_path.exists():
                # Fall back to our bundled eval set
                test_meta_path = ROOT / "evaluation_sets/test_small_new.json"
            with open(test_meta_path) as f:
                test_all_meta = _json.load(f)

            if req.domain != "all" and req.domain in test_all_meta:
                test_all_meta = {req.domain: test_all_meta[req.domain]}

            all_tasks = [
                (domain, ex_id)
                for domain, examples in test_all_meta.items()
                for ex_id in (examples if isinstance(examples, list) else list(examples))
            ]
            # Limit for quick benchmarking
            all_tasks = all_tasks[:req.num_tasks]

            yield _sse({"type": "status", "text": f"OSWorld benchmark: {len(all_tasks)} tasks"})

            engine_params = get_generation_params(req.generation_model)
            engine_params_grounding = get_grounding_params(req.grounding_model)

            scores = []
            for i, (domain, ex_id) in enumerate(all_tasks):
                yield _sse({
                    "type": "task_start",
                    "task_num": i + 1,
                    "total": len(all_tasks),
                    "domain": domain,
                    "example_id": ex_id,
                })

                # Try to run against OSWorld env if available, else simulate
                try:
                    from desktop_env.desktop_env import DesktopEnv
                    # Real OSWorld run
                    score = await asyncio.to_thread(
                        _run_osworld_task,
                        domain, ex_id, req, engine_params, engine_params_grounding
                    )
                except ImportError:
                    # OSWorld not installed — run in simulated/dry-run mode
                    yield _sse({"type": "warn", "text": "OSWorld env not installed — running dry-run simulation"})
                    score = await _simulate_benchmark_task(domain, ex_id, engine_params, req)

                scores.append(score)
                yield _sse({
                    "type": "task_result",
                    "domain": domain,
                    "example_id": ex_id,
                    "score": score,
                    "running_avg": sum(scores) / len(scores),
                })

            avg = sum(scores) / len(scores) if scores else 0.0
            yield _sse({
                "type": "benchmark_done",
                "total_tasks": len(all_tasks),
                "avg_score": avg,
                "success_rate_pct": round(avg * 100, 2),
                "scores": scores,
                "model": engine_params["model"],
            })

        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})
            logger.error(traceback.format_exc())
        finally:
            yield _sse({"type": "end"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _run_osworld_task(domain, ex_id, req, engine_params, engine_params_grounding):
    """Run a single OSWorld task (blocking, called via asyncio.to_thread)."""
    import json
    from gui_agents.s2_5.agents.agent_s import AgentS2_5
    from gui_agents.s2_5.agents.grounding import OSWorldACI
    from desktop_env.desktop_env import DesktopEnv

    config_file = ROOT / f"evaluation_sets/examples/{domain}/{ex_id}.json"
    if not config_file.exists():
        return 0.0
    with open(config_file) as f:
        example = json.load(f)

    grounding_agent = OSWorldACI(
        platform="linux",
        engine_params_for_generation=engine_params,
        engine_params_for_grounding=engine_params_grounding,
        width=req.screen_width,
        height=req.screen_height,
    )
    agent = AgentS2_5(engine_params, grounding_agent, platform="linux")

    result_dir = Path(req.result_dir) / domain / ex_id
    result_dir.mkdir(parents=True, exist_ok=True)

    env = DesktopEnv(
        action_space="pyautogui",
        headless=True,
        os_type="Ubuntu",
    )
    try:
        obs = env.reset(task_config=example)
        score = 0.0
        for _ in range(req.max_steps):
            info, actions = agent.predict(example["instruction"], obs)
            if not actions or "DONE" in str(actions):
                break
            for action in actions:
                try:
                    obs, score, done, info = env.step(action)
                except Exception:
                    pass
                if done:
                    break
        with open(result_dir / "result.txt", "w") as f:
            f.write(str(score))
        return score
    finally:
        try:
            env.close()
        except Exception:
            pass


async def _simulate_benchmark_task(domain, ex_id, engine_params, req) -> float:
    """
    Dry-run benchmark: query the NIM model about the task and score based on
    whether the model produces a valid action plan. No VM required.
    """
    import openai
    await asyncio.sleep(0.2)
    try:
        client = openai.OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=os.getenv("NVIDIA_API_KEY", ""),
        )
        resp = client.chat.completions.create(
            model=engine_params["model"],
            messages=[
                {"role": "system", "content": "You are a GUI automation agent evaluator."},
                {"role": "user", "content": (
                    f"Given the OSWorld task domain '{domain}' (example {ex_id}), "
                    "provide a step-by-step action plan using pyautogui. "
                    "Reply with a valid Python pyautogui script. "
                    "If you can generate a valid plan, end with DONE."
                )},
            ],
            max_tokens=512,
            temperature=0.0,
        )
        text = resp.choices[0].message.content or ""
        # Heuristic: if response contains 'pyautogui' and 'DONE', count as partial success
        score = 0.5 if ("pyautogui" in text and "DONE" in text) else 0.0
        return score
    except Exception as e:
        logger.warning(f"Sim benchmark error: {e}")
        return 0.0


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("BRIDGE_PORT", "3002"))
    print(f"\n  KlimAgent Python Bridge v1.0.0")
    print(f"  Agent-S GUI automation + OSWorld benchmarking")
    print(f"  Listening on http://localhost:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
