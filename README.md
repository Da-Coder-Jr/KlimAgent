# KlimAgent

**Autonomous AI workspace powered by NVIDIA NIM.**

KlimAgent turns natural language into real actions on your computer — reading and writing files, running shell commands, searching codebases, and more. Built on Electron + Node.js with NVIDIA NIM as the exclusive inference backend.

## Features

- **NVIDIA NIM inference** — Uses NVIDIA's OpenAI-compatible API with models like Llama 3.3 70B, Nemotron Ultra 253B, Mixtral, and more
- **Agentic loop** — Automatically uses tools (read/write files, run commands, search) to complete multi-step tasks
- **Real-time streaming** — SSE-based streaming with live token output
- **Persistent chats** — Conversation history stored locally
- **Model selector** — Switch between 10+ NVIDIA NIM models from the UI
- **Electron desktop app** — Runs on macOS, Windows, and Linux

## Quick Start

```bash
git clone https://github.com/da-coder-jr/klimagent
cd klimagent
bash setup.sh
```

Then in two terminals:

```bash
# Terminal 1
cd server && npm start

# Terminal 2
npm start
```

## Configuration

Copy `.env.example` to `.env` and add your NVIDIA API key:

```env
NVIDIA_API_KEY=nvapi-your-key-here
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
```

Get a free API key at [build.nvidia.com](https://build.nvidia.com/).

## Available Models

| Model | Provider | Notes |
|-------|----------|-------|
| `meta/llama-3.3-70b-instruct` | Meta | Default, fast |
| `nvidia/llama-3.1-nemotron-70b-instruct` | NVIDIA | NVIDIA-optimized |
| `nvidia/llama-3.1-nemotron-ultra-253b-v1` | NVIDIA | Most capable |
| `meta/llama-3.1-405b-instruct` | Meta | Very large |
| `mistralai/mixtral-8x22b-instruct-v0.1` | Mistral AI | MoE architecture |
| `mistralai/mistral-large` | Mistral AI | — |
| `qwen/qwen2.5-72b-instruct` | Alibaba | — |

## Architecture

```
KlimAgent/
├── main.js                    # Electron main process
├── preload.js                 # IPC bridge (contextBridge)
├── renderer/
│   ├── index.html             # App shell
│   ├── renderer.js            # UI logic + SSE streaming
│   └── style.css              # NVIDIA-green dark theme
└── server/
    ├── server.js              # Express + SSE endpoint
    └── providers/
        ├── base-provider.js   # Abstract base class
        ├── nvidia-nim-provider.js  # NVIDIA NIM (OpenAI-compatible)
        └── index.js           # Provider registry
```

## Built-in Tools

KlimAgent uses these tools autonomously when completing tasks:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `run_command` | Execute shell commands |
| `search_files` | Grep/find across the codebase |
| `list_directory` | List folder contents |
| `web_search` | Web search (informational) |

## License

MIT
