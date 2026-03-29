# KlimAgent

**Autonomous AI workspace combining [open-claude-cowork](https://github.com/ComposioHQ/open-claude-cowork) + [Agent-S](https://github.com/simular-ai/Agent-S), powered entirely by NVIDIA NIM.**

Three capabilities in one Electron desktop app:
1. **Text Chat** — streaming chat with file/shell tool use (NVIDIA NIM)
2. **GUI Agent** — Agent-S2.5 controlling your desktop via screenshots + pyautogui (NVIDIA NIM vision)
3. **OSWorld Benchmark** — evaluate KlimAgent against the OSWorld leaderboard

---

## Quick Start

```bash
git clone https://github.com/Da-Coder-Jr/KlimAgent
cd KlimAgent
bash setup.sh        # installs deps, creates .env, links CLI
klimagent            # launches everything
```

Get a **free** NVIDIA API key at [build.nvidia.com](https://build.nvidia.com/).

---

## Architecture

```
KlimAgent/
├── bin/klimagent.js          # CLI: starts server + bridge + Electron
├── main.js                   # Electron main process
├── preload.js                # contextBridge IPC
├── renderer/                 # UI (3 panels: Chat / GUI / Benchmark)
│   ├── index.html
│   ├── renderer.js
│   └── style.css
├── server/                   # Node.js Express API (port 3001)
│   ├── server.js             # SSE streaming + bridge proxy
│   └── providers/
│       ├── base-provider.js
│       ├── nvidia-nim-provider.js   # NVIDIA NIM text chat
│       └── index.js
├── agent/                    # Python FastAPI bridge (port 3002)
│   ├── bridge.py             # Agent-S HTTP API + OSWorld runner
│   └── nim_params.py         # NVIDIA NIM engine param helpers
├── gui_agents/               # Agent-S source (all providers → NIM)
│   ├── s2/, s2_5/, s3/       # Agent-S generations
│   └── **/core/engine.py     # + LMMEngineNvidiaNIM added to each
└── osworld_setup/
    └── s2_5/
        └── run_klimagent.py  # CLI benchmark runner
```

---

## Providers

**Every** model call goes through NVIDIA NIM — no Anthropic, OpenAI, or Composio keys needed.

| Use | Model | NIM Endpoint |
|-----|-------|-------------|
| Text chat | `meta/llama-3.3-70b-instruct` | `integrate.api.nvidia.com/v1` |
| GUI planning | `nvidia/llama-3.1-nemotron-70b-instruct` | same |
| Vision grounding | `nvidia/llama-3.2-90b-vision-instruct` | same |

Switch any model from the sidebar dropdown without restarting.

---

## Configuration

```env
NVIDIA_API_KEY=nvapi-...
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_NIM_VISION_MODEL=nvidia/llama-3.2-90b-vision-instruct
PORT=3001
BRIDGE_PORT=3002
```

---

## Services

| Service | Port | Start |
|---------|------|-------|
| Node.js API | 3001 | `cd server && npm start` |
| Python bridge | 3002 | `python agent/bridge.py` |
| Electron app | — | `npm start` |
| **All-in-one** | — | **`klimagent`** |

---

## OSWorld Benchmark

```bash
# Dry-run (no VM needed, queries NIM for planning quality)
python osworld_setup/s2_5/run_klimagent.py \
  --dry_run \
  --num_tasks 10 \
  --model meta/llama-3.3-70b-instruct

# Full evaluation (requires OSWorld VM setup)
python osworld_setup/s2_5/run_klimagent.py \
  --num_tasks 50 \
  --domain all \
  --model nvidia/llama-3.1-nemotron-70b-instruct \
  --vision_model nvidia/llama-3.2-90b-vision-instruct
```

### Published Scores (Agent-S2.5, OSWorld)
| Model | Success Rate |
|-------|-------------|
| GPT-4o | 27.0% |
| Claude 3.7 Sonnet | 38.8% |
| **KlimAgent (NIM)** | *run to find out* |

---

## License

MIT
