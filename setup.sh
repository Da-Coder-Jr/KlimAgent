#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# KlimAgent Setup Script
# Combines open-claude-cowork + Agent-S, powered by NVIDIA NIM
# ═══════════════════════════════════════════════════════════════
set -e

GREEN="\033[0;32m"; CYAN="\033[0;36m"; YELLOW="\033[1;33m"
RED="\033[0;31m"; BOLD="\033[1m"; RESET="\033[0m"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║           KlimAgent Setup                ║${RESET}"
echo -e "${BOLD}${GREEN}║  open-claude-cowork + Agent-S + NIM      ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── Check Node.js ───────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Install Node.js 18+: https://nodejs.org${RESET}"; exit 1
fi
NODE_VER=$(node -v | cut -d. -f1 | tr -d 'v')
[ "$NODE_VER" -lt 18 ] && echo -e "${YELLOW}⚠ Node.js v18+ recommended${RESET}"
echo -e "${GREEN}✓ Node.js $(node -v)${RESET}"

# ── Check Python ────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo -e "${YELLOW}⚠ Python 3 not found. GUI Agent and benchmarks will be unavailable.${RESET}"
else
  PY_VER=$(python3 -c "import sys; print(sys.version_info.major*10+sys.version_info.minor)")
  [ "$PY_VER" -lt 39 ] && echo -e "${YELLOW}⚠ Python 3.9+ recommended${RESET}"
  echo -e "${GREEN}✓ Python $(python3 --version)${RESET}"
fi

# ── Create .env ─────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo -e "${CYAN}${BOLD}NVIDIA NIM API Key Setup${RESET}"
  echo -e "${CYAN}Get a free key at: https://build.nvidia.com/${RESET}"
  echo ""
  read -rp "Enter your NVIDIA API key (nvapi-...): " NVIDIA_KEY
  if [ -n "$NVIDIA_KEY" ]; then
    sed -i "s/nvapi-your-key-here/${NVIDIA_KEY}/" .env
    echo -e "${GREEN}✓ API key saved to .env${RESET}"
  else
    echo -e "${YELLOW}⚠ No key entered — edit .env manually before running${RESET}"
  fi
else
  echo -e "${GREEN}✓ .env exists${RESET}"
fi

# ── Install Node deps ────────────────────────────────────────────
echo -e "\n${CYAN}Installing Node.js dependencies (root)…${RESET}"
npm install
echo -e "${GREEN}✓ Root dependencies installed${RESET}"

echo -e "\n${CYAN}Installing Node.js dependencies (server)…${RESET}"
cd server && npm install && cd ..
echo -e "${GREEN}✓ Server dependencies installed${RESET}"

# ── Install Python deps ──────────────────────────────────────────
if command -v python3 &>/dev/null; then
  echo -e "\n${CYAN}Installing Python dependencies…${RESET}"
  if command -v pip3 &>/dev/null; then
    pip3 install -r requirements.txt --quiet
    echo -e "${GREEN}✓ Python dependencies installed${RESET}"
  else
    echo -e "${YELLOW}⚠ pip3 not found — run: pip install -r requirements.txt${RESET}"
  fi
fi

# ── Link CLI ─────────────────────────────────────────────────────
echo -e "\n${CYAN}Linking klimagent command globally…${RESET}"
if npm link 2>/dev/null; then
  echo -e "${GREEN}✓ 'klimagent' command available globally${RESET}"
else
  echo -e "${YELLOW}⚠ npm link failed (try: sudo npm link)${RESET}"
fi

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║           Setup Complete!                ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${BOLD}Start everything:${RESET}"
echo ""
echo -e "  ${BOLD}klimagent${RESET}            # all-in-one (server + Electron)"
echo ""
echo -e "${BOLD}Or start services individually:${RESET}"
echo ""
echo -e "  ${CYAN}# Terminal 1 — Node.js API server${RESET}"
echo -e "  ${BOLD}cd server && npm start${RESET}"
echo ""
echo -e "  ${CYAN}# Terminal 2 — Python Agent-S bridge (GUI agent + benchmarks)${RESET}"
echo -e "  ${BOLD}python agent/bridge.py${RESET}"
echo ""
echo -e "  ${CYAN}# Terminal 3 — Electron app${RESET}"
echo -e "  ${BOLD}npm start${RESET}"
echo ""
echo -e "${BOLD}Benchmark (CLI):${RESET}"
echo -e "  ${BOLD}python osworld_setup/s2_5/run_klimagent.py --dry_run --num_tasks 5${RESET}"
echo ""
