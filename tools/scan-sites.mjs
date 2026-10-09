// False-trigger scan: opens typical news/shopping sites in the test instance and reports every
// <video> (all frames, incl. ad iframes) with the reason automatic output would ignore it.
// "WOULD TRIGGER" = a video automatic output would take (if the user started it, or – without
// user activation – it would get the "Auf TV abspielen?" hint).
// Runs with autoAllSites on (otherwise the site list filters everything); restores it afterwards.
// Nothing reaches the TV: without a target display the extension stays inactive anyway.
// Usage: node tools/scan-sites.mjs [url ...]
const base = 'http://127.0.0.1:9333';
const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://www.spiegel.de/', 'https://www.zeit.de/', 'https://www.tagesschau.de/', 'https://www.bild.de/',
  'https://www.faz.net/', 'https://www.n-tv.de/', 'https://www.welt.de/', 'https://www.chip.de/',
  'https://www.amazon.de/', 'https://www.otto.de/', 'https://www.zalando.de/', 'https://www.mediamarkt.de/',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = async () => (await fetch(base + '/json/list')).json();

// Evaluate in the extension's isolated world of every frame of a CDP target.
async function evalInExtensionWorlds(target, expr) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
  try { return await collectFromWorlds(ws, expr); } finally { ws.close(); }
}
async function collectFromWorlds(ws, expr) {
  const contexts = [];
  let id = 0;
  const pending = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.executionContextCreated') {
      const c = d.params.context;
      if (c.auxData?.type === 'isolated' && /TabToTV/.test(c.name)) contexts.push(c.id);
    }
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  // Every call gets a timeout, so a target that goes away can't hang the scan.
  const send = (method, params = {}) => Promise.race([
    new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout ' + method)), 5000)),
  ]);
  await send('Runtime.enable');
  // Contexts are reported right after Runtime.enable; wait until the extension's appears (max 2 s).
  for (let waited = 0; !contexts.length && waited < 2000; waited += 100) await sleep(100);
  const out = [];
  for (const contextId of contexts) {
    const res = await send('Runtime.evaluate', { expression: expr, contextId, returnByValue: true });
    out.push(...(res.result?.result?.value || []));
  }
  return out;
}

// Decline cookie banners where a top-level button allows it (privacy-preserving choice only).
const declineExpr = `(() => { const b = [...document.querySelectorAll('button, a[role=button]')]
  .find(b => /^(alle ablehnen|ablehnen|nur (technisch )?notwendige|reject all|zustimmung verweigern)/i.test(b.innerText.trim()));
  if (b) { b.click(); return b.innerText.trim(); } return null; })()`;
async function declineConsent() {
  for (const t of (await list()).filter(t => t.type === 'page' || t.type === 'iframe')) {
    if (!/^https?:/.test(t.url)) continue;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    try {
      await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
      const clicked = await new Promise(r => {
        ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result?.result?.value); };
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: declineExpr, returnByValue: true } }));
      });
      if (clicked) return clicked;
    } catch { /* target gone */ } finally { ws.close(); }
  }
  return null;
}

const options = (await list()).find(t => t.url.includes('/options.html'));
if (!options) { console.error('open the options page in the test instance first'); process.exit(1); }
async function setStorage(obj) {
  const ws = new WebSocket(options.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  await new Promise(r => { ws.onmessage = m => { if (JSON.parse(m.data).id === 1) r(); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: obj, awaitPromise: true } })); });
  ws.close();
}
// Save the user's values and restore them however the scan ends (error, Ctrl-C).
await setStorage('chrome.storage.local.get(["autoAllSites","autoMode"]).then(v => (globalThis.__scanSaved = v))');
const restore = () => setStorage(`(async () => { const v = globalThis.__scanSaved || {};
  await chrome.storage.local.remove(["autoAllSites","autoMode"]); await chrome.storage.local.set(v); })()`);
process.on('SIGINT', async () => { await restore(); process.exit(130); });
await setStorage('chrome.storage.local.set({autoAllSites:true, autoMode:true})');

let triggers = 0;
try {
for (const url of SITES) {
  const tab = await (await fetch(base + '/json/new?' + url, { method: 'PUT' })).json();
  await sleep(8000);
  const consent = await declineConsent();
  await sleep(consent ? 10000 : 4000);
  const host = new URL(url).hostname;
  // The tab and its (nested) out-of-process iframes only, not iframes of other tabs.
  const all = await list();
  const own = new Set([tab.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of all) if (t.type === 'iframe' && own.has(t.parentId) && !own.has(t.id)) { own.add(t.id); grew = true; }
  }
  const targets = all.filter(t => own.has(t.id));
  const videos = [];
  for (const t of targets) videos.push(...await evalInExtensionWorlds(t, 'globalThis.tab2tvDebugVideos?.() || []').catch(() => []));
  const would = videos.filter(v => v.reason === null);
  triggers += would.length;
  console.log(`\n${host}  consent: ${consent || '–'}  videos: ${videos.length}  ${would.length ? 'WOULD TRIGGER: ' + would.length : 'no trigger'}`);
  const hidden = videos.filter(v => v.w === 0 && v.h === 0 && v.reason !== null);
  if (hidden.length) console.log(`     (${hidden.length} unsichtbare 0x0-Videos, ignoriert)`);
  for (const v of videos.filter(v => !hidden.includes(v))) {
    console.log(`  ${v.reason === null ? '!!' : '  '} ${v.frame} ${v.w}x${v.h} ${v.playing ? 'playing' : 'paused'}${v.muted ? ' muted' : ''} dur=${v.duration} → ${v.reason ?? 'WOULD TRIGGER'}  ${v.src}`);
  }
  await fetch(base + '/json/close/' + tab.id);
  await sleep(500);
}
} finally {
  await restore();
}
console.log(`\n${SITES.length} sites, ${triggers} video(s) that automatic output would take`);
