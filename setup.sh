#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# KlimAgent Setup Script
# Autonomous AI Workspace powered by NVIDIA NIM
# ═══════════════════════════════════════════════════
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║         KlimAgent Setup               ║${RESET}"
echo -e "${BOLD}${GREEN}║   Powered by NVIDIA NIM               ║${RESET}"
echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════╝${RESET}"
echo ""

# ── Check Node.js ──────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Please install Node.js 18+${RESET}"
  echo "  → https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${YELLOW}⚠ Node.js v18+ recommended (found $(node -v))${RESET}"
fi

echo -e "${GREEN}✓ Node.js $(node -v)${RESET}"

# ── Set up .env ────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "\n${CYAN}${BOLD}NVIDIA NIM Configuration${RESET}"
  echo -e "${CYAN}Get your free API key at: https://build.nvidia.com/${RESET}\n"
  read -rp "Enter your NVIDIA API key (nvapi-...): " NVIDIA_KEY
  if [ -n "$NVIDIA_KEY" ]; then
    sed -i "s/nvapi-your-key-here/${NVIDIA_KEY}/" .env
    echo -e "${GREEN}✓ API key saved to .env${RESET}"
  else
    echo -e "${YELLOW}⚠ No key entered. Edit .env manually before starting.${RESET}"
  fi
else
  echo -e "${GREEN}✓ .env already exists${RESET}"
fi

# ── Install root dependencies ──────────────────────
echo -e "\n${CYAN}Installing root dependencies…${RESET}"
npm install
echo -e "${GREEN}✓ Root dependencies installed${RESET}"

# ── Install server dependencies ────────────────────
echo -e "\n${CYAN}Installing server dependencies…${RESET}"
cd server && npm install && cd ..
echo -e "${GREEN}✓ Server dependencies installed${RESET}"

# ── Done ───────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║         Setup Complete!               ║${RESET}"
echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════╝${RESET}"
echo ""
echo -e "${BOLD}To start KlimAgent:${RESET}"
echo ""
echo -e "  ${CYAN}# Terminal 1 — Start the backend server${RESET}"
echo -e "  ${BOLD}cd server && npm start${RESET}"
echo ""
echo -e "  ${CYAN}# Terminal 2 — Launch the Electron app${RESET}"
echo -e "  ${BOLD}npm start${RESET}"
echo ""
echo -e "${YELLOW}Need an NVIDIA API key?${RESET}"
echo -e "  → https://build.nvidia.com/"
echo ""
