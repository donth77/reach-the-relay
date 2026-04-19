/// <reference types="vite/client" />
// In-memory ring-buffer logger for combat diagnostics.
// Events are logged here and mirrored to the browser console when enabled.
// Press `L` in combat to copy the whole buffer to the clipboard for pasting.
//
// Enable/disable via Vite env var `VITE_DEBUG_LOG`:
//   - 'true'  → force enabled
//   - 'false' → force disabled
//   - unset   → defaults to enabled in `vite dev`, disabled in production build

const envFlag = import.meta.env.VITE_DEBUG_LOG as string | undefined;
const DEBUG_ENABLED = envFlag === 'true' || (envFlag !== 'false' && import.meta.env.DEV);

const BUFFER_SIZE = 500;
const buffer: string[] = [];

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function log(tag: string, msg: string, data?: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  const dataStr = data && Object.keys(data).length > 0 ? ' ' + JSON.stringify(data) : '';
  const line = `[${timestamp()}] [${tag}] ${msg}${dataStr}`;
  buffer.push(line);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
   
  console.log(line);
}

export function dumpLog(): string {
  return buffer.join('\n');
}

export function clearLog(): void {
  buffer.length = 0;
}

export async function copyLogToClipboard(): Promise<boolean> {
  const text = dumpLog();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function isDebugEnabled(): boolean {
  return DEBUG_ENABLED;
}

// Mounts a small fixed-position badge in the top-left of the page so you can see
// at a glance that debug logging is active. Call once at startup from main.ts.
// Uses DOM (not Phaser) so it stays visible across every scene.
export function mountDebugBadge(): void {
  if (!DEBUG_ENABLED) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('debug-badge')) return;
  const el = document.createElement('div');
  el.id = 'debug-badge';
  el.textContent = 'DEBUG · [L] copy log';
  Object.assign(el.style, {
    position: 'fixed',
    top: '6px',
    left: '6px',
    zIndex: '9999',
    padding: '3px 8px',
    background: 'rgba(0,0,0,0.75)',
    color: '#ff6666',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold',
    border: '1px solid #ff6666',
    borderRadius: '3px',
    pointerEvents: 'none',
    letterSpacing: '0.5px',
  });
  document.body.appendChild(el);
}
