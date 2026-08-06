import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');
const electronCli = path.join(projectRoot, 'node_modules/electron/cli.js');

let nextPort = 9400; // arbitrary base; each launch bumps it so sequential runs never collide

function waitForPort(port, timeoutMs, hasExited) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() < deadline) {
        if (hasExited()) return reject(new Error('electron process exited before its devtools port came up'));
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json`);
          if (res.ok) return resolve();
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 150));
      }
      reject(new Error(`electron devtools port ${port} never came up within ${timeoutMs}ms`));
    })();
  });
}

async function connectWithRetry(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return await connect(port);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

// Signals the whole process GROUP, not just the cli.js wrapper — relying on
// cli.js to forward SIGTERM to the real Electron binary (which it does) is
// not enough on its own: main.js's own before-quit handler intentionally
// delays actual exit to flush a git-backed backup, so a short grace period
// can expire while the app is still mid-quit, and killing only the wrapper
// at that point orphans the real Electron process (and its GPU/renderer/
// utility helper processes) forever. Killing by process group (negative
// pid) reaches all of them directly regardless of how that inner shutdown
// sequence is going.
function killProcessTree(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group may already be gone */ }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group may already be gone */ }
      }
    }, 2000);
  });
}

async function spawnElectron(userDataDir) {
  const port = nextPort++;
  const child = spawn(
    process.execPath,
    [electronCli, '.', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`],
    {
      cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      // Never show or steal focus -- CDP drives the renderer directly and
      // doesn't need a visible window. Without this, every test/scratch
      // launch pops a real window that grabs focus from whatever the
      // developer is doing.
      env: { ...process.env, BARETEXT_HIDDEN: '1' },
    }
  );
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  let exited = false;
  child.once('exit', () => { exited = true; });

  await waitForPort(port, 10000, () => exited);
  const client = await connectWithRetry(port, 5000);
  await waitForAppReady(client, 10000);
  return { child, client, port, getStderr: () => stderr };
}

// The devtools page target exists as soon as Electron opens the window —
// well before app.js has run, CodeMirror has mounted, AND the real fixture
// content has round-tripped through the async 'file-loaded' IPC message
// (which also drives scene-nav's first real rail/corkboard render). Poll
// until the doc shows real content (not the "start writing..." placeholder)
// instead of a fixed sleep, so every other test can assume the fixture is
// fully loaded and scene-nav has already rendered from it.
async function waitForAppReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate(`
      const el = document.querySelector('.cm-content');
      return !!el && el.innerText.trim() !== '' && el.innerText.trim() !== 'start writing...';
    `);
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('app did not finish loading real content within timeout');
}

// Launches a fully isolated instance of the real app: its own --user-data-dir
// (so settings.json / ignored words / theme never touch the developer's real
// profile) and its own save directory seeded with the given fixture content.
// Mirrors exactly the manual scratch-profile discipline used throughout this
// project's QA — nothing here ever touches ~/Documents/Barebones or the real
// Electron userData dir.
export async function launchApp({ fixtureContent = '', mode = 'editor', accentTheme = 'dark', extraSettings = {} } = {}) {
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baretext-e2e-'));
  const userDataDir = path.join(scratchRoot, 'userdata');
  const saveDir = path.join(scratchRoot, 'savedir');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(saveDir, { recursive: true });

  const fixturePath = path.join(saveDir, 'test.md');
  fs.writeFileSync(fixturePath, fixtureContent, 'utf8');

  const settingsPath = path.join(userDataDir, 'settings.json');
  const settings = { saveDir, mode, accentTheme, lastFilePath: fixturePath, typewriter: false, ...extraSettings };
  fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');

  // `current` holds the live child/client for whichever launch is active —
  // restart() swaps it out, and every method below reads through it, so
  // there's a single source of truth instead of several variables that can
  // drift out of sync with each other after a relaunch.
  const current = await spawnElectron(userDataDir);

  function readSettings() {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  // Fully quits and relaunches against the SAME scratch profile, so tests
  // can verify a setting actually persisted to disk and gets replayed on a
  // real cold start — not just an in-page reload.
  async function restart() {
    current.client.close();
    await killProcessTree(current.child);
    const next = await spawnElectron(userDataDir);
    current.child = next.child;
    current.client = next.client;
    current.port = next.port;
    current.getStderr = next.getStderr;
    return current.client;
  }

  async function close() {
    current.client.close();
    await killProcessTree(current.child);
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }

  return {
    get client() { return current.client; },
    get port() { return current.port; },
    userDataDir, saveDir, fixturePath, settingsPath,
    readSettings, restart, close,
    getStderr: () => current.getStderr(),
  };
}
