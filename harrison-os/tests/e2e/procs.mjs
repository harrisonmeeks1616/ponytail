// e2e process helpers for Harrison OS (Windows-first, also tolerable elsewhere).
// Starts and stops local servers by PID tree. Only ever kills a process tree whose own command
// line, or an ancestor's, names this repo's folder (harrison-os, not harrison-os-spike), so an
// unrelated program that happens to listen on the same port is never touched.

import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const IS_WIN = process.platform === 'win32';
// "harrison-os" followed by a path separator, quote, space or end: never "harrison-os-spike".
const REPO_MARK = /harrison-os(?![-\w])/i;

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
  } catch (err) {
    return (err && err.stdout) || '';
  }
}

export function listeningPids(port) {
  const pids = new Set();
  if (IS_WIN) {
    const out = run('netstat', ['-ano', '-p', 'tcp']);
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5 || cols[3] !== 'LISTENING') continue;
      if (cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
    }
  } else {
    const out = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    for (const l of out.split(/\s+/)) if (/^\d+$/.test(l)) pids.add(Number(l));
  }
  pids.delete(0);
  return [...pids];
}

function processInfo(pid) {
  if (!IS_WIN) {
    const cmd = run('ps', ['-o', 'command=', '-p', String(pid)]).trim();
    const ppid = Number(run('ps', ['-o', 'ppid=', '-p', String(pid)]).trim()) || 0;
    return cmd ? { pid, ppid, name: cmd.split(' ')[0], commandLine: cmd } : null;
  }
  const ps =
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; ` +
    'if ($p) { [Console]::Out.Write((@{ ppid = $p.ParentProcessId; name = $p.Name; cmd = $p.CommandLine } | ConvertTo-Json -Compress)) }';
  const out = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]).trim();
  if (!out) return null;
  try {
    const j = JSON.parse(out);
    return { pid, ppid: Number(j.ppid) || 0, name: j.name || '', commandLine: j.cmd || '' };
  } catch {
    return null;
  }
}

// The topmost process in the parent chain (up to 6 levels) whose command line names this repo,
// or null when the port holder is unrelated.
function repoRootFor(pid) {
  let cur = processInfo(pid);
  let root = null;
  for (let depth = 0; cur && depth < 6; depth++) {
    if (REPO_MARK.test(String(cur.commandLine))) root = cur;
    if (!cur.ppid || cur.ppid === cur.pid) break;
    cur = processInfo(cur.ppid);
  }
  return root;
}

export function killTree(pid) {
  if (!pid) return '';
  if (IS_WIN) return run('taskkill', ['/T', '/F', '/PID', String(pid)]).trim();
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  return '';
}

// Frees `port` when its holder belongs to this repo; throws when an unrelated process holds it.
export function freePort(port, log = () => {}) {
  for (const pid of listeningPids(port)) {
    const root = repoRootFor(pid);
    if (!root) {
      const info = processInfo(pid);
      throw new Error(`port ${port} is held by PID ${pid} (${info ? info.name : 'unknown'}), which is not part of harrison-os; stop it yourself`);
    }
    log(`port ${port}: killing leftover harrison-os process tree ${root.pid} (${root.name})`);
    killTree(root.pid);
  }
}

export async function waitPortFree(port, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (listeningPids(port).length === 0) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return listeningPids(port).length === 0;
}

// Spawns a long-running node process; output goes to logPath and to an in-memory buffer.
export function spawnLogged(args, { cwd, env, logPath }) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: !IS_WIN,
  });
  const file = logPath ? createWriteStream(logPath) : null;
  const chunks = [];
  const onData = (d) => {
    chunks.push(d);
    if (file) file.write(d);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return {
    child,
    output: () => Buffer.concat(chunks).toString('utf8'),
    closeLog: () => new Promise((r) => (file ? file.end(r) : r())),
  };
}

export function runNodeSync(args, { cwd, env, timeoutMs = 120000 }) {
  try {
    const out = execFileSync(process.execPath, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, output: `${(err && err.stdout) || ''}${(err && err.stderr) || ''}`, error: err && err.message };
  }
}
