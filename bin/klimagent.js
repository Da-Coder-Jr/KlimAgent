#!/usr/bin/env node
/**
 * KlimAgent CLI entry point.
 * Run `klimagent` to launch the full app (server + Electron window).
 */

'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = process.env.PORT || 3001;

// ── Resolve electron binary ────────────────────────────────────────────────
function findElectron() {
  const candidates = [
    path.join(ROOT, 'node_modules', '.bin', 'electron'),
    path.join(ROOT, 'node_modules', '.bin', 'electron.cmd'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    return execSync('which electron', { encoding: 'utf8' }).trim();
  } catch {}
  return null;
}

// ── Wait for server ────────────────────────────────────────────────────────
function waitForServer(maxMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > maxMs) return reject(new Error('Server did not start in time'));
      setTimeout(check, 400);
    };
    check();
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  ╔═══════════════════════════════╗');
  console.log('  ║       KlimAgent v1.0.0        ║');
  console.log('  ║   Powered by NVIDIA NIM       ║');
  console.log('  ╚═══════════════════════════════╝\n');

  // Check .env exists
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('  ✗ .env not found. Run: cp .env.example .env\n    Then add your NVIDIA_API_KEY.');
    process.exit(1);
  }

  // Check server deps
  if (!fs.existsSync(path.join(SERVER_DIR, 'node_modules'))) {
    console.log('  → Installing server dependencies…');
    execSync('npm install', { cwd: SERVER_DIR, stdio: 'inherit' });
  }

  // Start backend server
  console.log('  → Starting NVIDIA NIM server…');
  const server = spawn('node', ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', d => process.stdout.write('  [server] ' + d));
  server.stderr.on('data', d => process.stderr.write('  [server] ' + d));
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`  ✗ Server exited with code ${code}`);
    }
  });

  // Wait for server ready
  try {
    await waitForServer();
    console.log('  ✓ Server ready\n');
  } catch (err) {
    console.error('  ✗ ' + err.message);
    server.kill();
    process.exit(1);
  }

  // Launch Electron
  const electronBin = findElectron();
  if (!electronBin) {
    console.error('  ✗ Electron not found. Run: npm install');
    server.kill();
    process.exit(1);
  }

  console.log('  → Opening KlimAgent window…\n');
  const app = spawn(electronBin, [ROOT], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: 'inherit'
  });

  app.on('close', () => {
    server.kill();
    process.exit(0);
  });

  // Graceful shutdown
  process.on('SIGINT', () => { app.kill(); server.kill(); process.exit(0); });
  process.on('SIGTERM', () => { app.kill(); server.kill(); process.exit(0); });
}

main().catch(err => {
  console.error('  ✗ Fatal:', err.message);
  process.exit(1);
});
