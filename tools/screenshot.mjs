// Screenshot of a page in the test instance (full page). Usage: node tools/screenshot.mjs <url-substring> <out.png>
import { writeFileSync } from 'node:fs';
const [, , match, out] = process.argv;
const t = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find(x => x.type === 'page' && x.url.includes(match));
if (!t) { console.error('no target', match); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } }));
const res = await new Promise(r => (ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) r(d); }));
writeFileSync(out, Buffer.from(res.result.data, 'base64'));
console.log('saved', out);
ws.close();
