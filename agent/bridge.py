"""
KlimAgent — Python Bridge Server (port 3002)
Exposes Agent-S2.5 GUI automation to the Node.js backend via SSE.
Powered exclusively by NVIDIA NIM.
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
from typing import Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
load_dotenv()
sys.path.insert(0, str(ROOT))

from agent.nim_params import get_generation_params, get_grounding_params

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("klimagent.bridge")

app = FastAPI(title="KlimAgent Bridge", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Active sessions ────────────────────────────────────────────────────────────
_active: dict = {}


# ── Request models ─────────────────────────────────────────────────────────────
class GuiTaskRequest(BaseModel):
    task: str
    session_id: str = "default"
    platform: str = platform.system().lower()
    max_steps: int = 15
    generation_model: Optional[str] = None
    grounding_model: Optional[str] = None
    enable_reflection: bool = True


# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "klimagent-bridge",
        "nvidia_api_key_set": bool(os.getenv("NVIDIA_API_KEY")),
        "platform": platform.system(),
    }


# ── Screenshot ─────────────────────────────────────────────────────────────────
@app.post("/screenshot")
async def take_screenshot():
    try:
        import pyautogui
        shot = pyautogui.screenshot()
        buf = io.BytesIO()
        shot.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return {"screenshot": b64, "width": shot.width, "height": shot.height}
    except Exception as e:
        return {"error": str(e)}


# ── GUI Agent (SSE stream) ─────────────────────────────────────────────────────
@app.post("/gui-agent/run")
async def run_gui_agent(req: GuiTaskRequest):
    async def stream():
        sid = req.session_id
        try:
            engine_params    = get_generation_params(req.generation_model)
            grounding_params = get_grounding_params(req.grounding_model)

            yield _sse({"type": "status", "text": "Initializing Agent-S2.5 with NVIDIA NIM…"})
            yield _sse({"type": "status", "text": f"Generation: {engine_params['model']}"})
            yield _sse({"type": "status", "text": f"Grounding:  {grounding_params['model']}"})

            # Import Agent-S2.5
            from gui_agents.s2_5.agents.agent_s import AgentS2_5

            # Build grounding agent
            try:
                from gui_agents.s2_5.agents.grounding import OSWorldACI
                grounding = OSWorldACI(
                    platform=req.platform,
                    engine_params_for_generation=engine_params,
                    engine_params_for_grounding=grounding_params,
                    width=1920,
                    height=1080,
                )
                yield _sse({"type": "status", "text": "Using OSWorldACI grounding"})
            except Exception as e:
                from gui_agents.s2_5.agents.grounding import ACI
                grounding = ACI()
                yield _sse({"type": "warn", "text": f"Fallback to local ACI ({e})"})

            agent = AgentS2_5(
                engine_params=engine_params,
                grounding_agent=grounding,
                platform=req.platform,
                max_trajectory_length=req.max_steps,
                enable_reflection=req.enable_reflection,
            )
            _active[sid] = agent

            yield _sse({"type": "ready", "text": f"Agent ready · task: {req.task}"})

            for step in range(1, req.max_steps + 1):
                if sid not in _active:
                    yield _sse({"type": "stopped", "text": "Stopped by user"})
                    break

                yield _sse({"type": "step", "step": step, "total": req.max_steps})

                # Capture screen
                obs = {"screenshot": None}
                try:
                    import pyautogui
                    from PIL import Image as PILImage
                    shot = pyautogui.screenshot()
                    buf  = io.BytesIO()
                    shot.save(buf, format="PNG")
                    b64  = base64.b64encode(buf.getvalue()).decode()
                    yield _sse({"type": "screenshot", "data": b64, "step": step})
                    obs  = {"screenshot": shot}
                except Exception as e:
                    yield _sse({"type": "warn", "text": f"Screenshot error: {e}"})

                # Generate next action
                try:
                    info, actions = await asyncio.to_thread(agent.predict, req.task, obs)
                    yield _sse({"type": "actions", "actions": actions})

                    if not actions or set(actions) <= {"DONE", "WAIT", "FAIL"}:
                        status = actions[0] if actions else "DONE"
                        yield _sse({"type": "done", "text": f"Agent signalled: {status}"})
                        break

                    # Execute
                    for action in actions:
                        yield _sse({"type": "action", "action": str(action)})
                        try:
                            exec(action, {"time": time, "__builtins__": __builtins__})
                            await asyncio.sleep(0.8)
                        except Exception as e:
                            yield _sse({"type": "error", "text": f"Exec error: {e}"})

                except Exception as e:
                    yield _sse({"type": "error", "text": f"Step {step} error: {e}"})
                    logger.error(traceback.format_exc())
                    break

            else:
                yield _sse({"type": "done", "text": f"Reached max steps ({req.max_steps})"})

        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})
            logger.error(traceback.format_exc())
        finally:
            _active.pop(sid, None)
            yield _sse({"type": "end"})

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/gui-agent/stop")
async def stop_gui_agent(body: dict):
    sid = body.get("session_id", "default")
    _active.pop(sid, None)
    return {"stopped": True, "session_id": sid}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


if __name__ == "__main__":
    port = int(os.getenv("BRIDGE_PORT", "3002"))
    print(f"\n  KlimAgent Bridge v1.0.0  —  NVIDIA NIM")
    print(f"  Agent-S2.5 GUI automation")
    print(f"  http://localhost:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
