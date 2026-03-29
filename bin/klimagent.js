#!/usr/bin/env node
/**
 * KlimAgent CLI — run `klimagent` to start the full stack:
 *   1. Node.js API server (port 3001)
 *   2. Python Agent-S bridge (port 3002) — if Python available
 *   3. Electron window
 */
'use strict';

const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs   = require('fs');

const ROOT       = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT       = parseInt(process.env.PORT || '3001');
const BRIDGE_PORT= parseInt(process.env.BRIDGE_PORT || '3002');

function findElectron() {
  const candidates = [
    path.join(ROOT, 'node_modules', '.bin', 'electron'),
    path.join(ROOT, 'node_modules', '.bin', 'electron.cmd'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try { return execSync('which electron', { encoding: 'utf8' }).trim(); } catch {}
  return null;
}

function findPython() {
  for (const py of ['python3', 'python']) {
    try {
      const r = spawnSync(py, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return py;
    } catch {}
  }
  return null;
}

function waitFor(port, maxMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(`http://localhost:${port}/api/health`, res => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > maxMs) return reject(new Error(`Port ${port} timeout`));
      setTimeout(check, 400);
    };
    check();
  });
}

const children = [];

function cleanup() {
  children.forEach(c => { try { c.kill(); } catch {} });
}

async function main() {
  console.log('\n  ╔═══════════════════════════════════════╗');
  console.log('  ║         KlimAgent v1.0.0              ║');
  console.log('  ║  open-claude-cowork + Agent-S + NIM   ║');
  console.log('  ╚═══════════════════════════════════════╝\n');

  // Check .env
  if (!fs.existsSync(path.join(ROOT, '.env'))) {
    console.error('  ✗ .env not found. Run: cp .env.example .env\n    Then add NVIDIA_API_KEY.');
    process.exit(1);
  }

  // Install server deps if needed
  if (!fs.existsSync(path.join(SERVER_DIR, 'node_modules'))) {
    console.log('  → Installing server dependencies…');
    execSync('npm install', { cwd: SERVER_DIR, stdio: 'inherit' });
  }

  // ── 1. Node.js API server ──────────────────────────────────────────────────
  console.log('  → Starting Node.js API server…');
  const server = spawn('node', ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(server);
  server.stdout.on('data', d => process.stdout.write('  [server] ' + d));
  server.stderr.on('data', d => process.stderr.write('  [server] ' + d));
  server.on('exit', code => { if (code && code !== 0) console.error(`  ✗ Server exited (${code})`); });

  try {
    await waitFor(PORT);
    console.log('  ✓ API server ready\n');
  } catch {
    console.error('  ✗ API server failed to start'); cleanup(); process.exit(1);
  }

  // ── 2. Python bridge (optional) ────────────────────────────────────────────
  const python = findPython();
  if (python) {
    console.log('  → Starting Python Agent-S bridge…');
    const bridge = spawn(python, ['agent/bridge.py'], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(bridge);
    bridge.stdout.on('data', d => process.stdout.write('  [bridge] ' + d));
    bridge.stderr.on('data', d => {
      const s = d.toString();
      if (!s.includes('INFO') && !s.includes('Uvicorn')) process.stderr.write('  [bridge] ' + s);
    });
    // Wait up to 8s for bridge (non-fatal if unavailable)
    try {
      await new Promise((res, rej) => {
        const start = Date.now();
        const chk = () => {
          http.get(`http://localhost:${BRIDGE_PORT}/health`, r => {
            if (r.statusCode === 200) res(); else retry();
          }).on('error', retry);
        };
        const retry = () => {
          if (Date.now() - start > 8000) rej(); else setTimeout(chk, 500);
        };
        chk();
      });
      console.log('  ✓ Python bridge ready\n');
    } catch {
      console.log('  ⚠ Python bridge not ready — GUI Agent features unavailable\n');
    }
  } else {
    console.log('  ⚠ Python not found — GUI Agent features unavailable\n');
  }

  // ── 3. Electron window ─────────────────────────────────────────────────────
  const electronBin = findElectron();
  if (!electronBin) {
    console.error('  ✗ Electron not found. Run: npm install');
    cleanup(); process.exit(1);
  }

  console.log('  → Opening KlimAgent window…\n');
  const app = spawn(electronBin, [ROOT], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: 'inherit',
  });
  children.push(app);

  app.on('close', () => { cleanup(); process.exit(0); });

  process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

main().catch(err => { console.error('  ✗ Fatal:', err.message); cleanup(); process.exit(1); });
