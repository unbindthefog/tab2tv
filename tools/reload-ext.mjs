// Reloads the unpacked extension in the test instance (Brave may keep a cached service worker
// script across restarts). Requires --enable-unsafe-extension-debugging (set by test-brave.sh).
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../extension', import.meta.url));
const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path } }));
const res = await new Promise(r => (ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) r(d); }));
console.log(JSON.stringify(res.result ?? res.error));
ws.close();
