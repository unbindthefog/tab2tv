// Regression test: the automatic mode switch in the popup (TV keeps its video while off).
// Needs the test instance (tools/test-brave.sh) with the options page open in one tab.
// The toolbar popup can't be opened via CDP; the test opens popup.html?tabId=… as a tab and
// clicks its button with userGesture, like a real click in the popup.
// Usage: node tools/test-automode.mjs
const base = 'http://127.0.0.1:9333';
const VIDEOS = { A: 'aqz-KE-bpKQ', B: 'arj7oStGLkU' };

const list = async () => (await fetch(base + '/json/list')).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalIn(match, expr, gesture = true) {
  const t = (await list()).find(x => x.url.includes(match));
  if (!t) throw new Error('no target ' + match);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  const res = await new Promise(r => {
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result?.result?.value); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gesture } }));
  });
  ws.close();
  return res;
}
const options = expr => evalIn('options.html', expr, false);
const tvWindows = async () => (await list()).filter(t => t.url === 'about:blank#tab2tv').length;
const state = () => options('chrome.storage.session.get({sessions:{},tvOwner:null}).then(s=>({owner:s.tvOwner, tabs:Object.keys(s.sessions).map(Number)}))');
const tabIdOf = key => options(`chrome.tabs.query({url:"https://www.youtube.com/watch?v=${VIDEOS[key]}*"}).then(t=>t[0]?.id)`);
const play = key => evalIn(VIDEOS[key], `(async()=>{const p=document.getElementById("movie_player"); p.unMute(); p.setVolume(10);
  const v=document.querySelector("video"); v.pause(); await new Promise(r=>setTimeout(r,300));
  document.querySelector(".ytp-play-button").click(); await new Promise(r=>setTimeout(r,2500)); return !v.paused})()`);
// Open the popup for a page tab and click "Automatik" (with user gesture), then close it again.
async function clickIcon(tabId) {
  const extId = await options('chrome.runtime.id');
  const url = `chrome-extension://${extId}/popup.html?tabId=${tabId}`;
  const t = await (await fetch(base + '/json/new?' + url, { method: 'PUT' })).json();
  await sleep(1000);
  await evalIn(`popup.html?tabId=${tabId}`, 'document.getElementById("auto").click(), 1', true);
  await sleep(3000);
  await fetch(base + '/json/close/' + t.id);
}
const toast = key => evalIn(VIDEOS[key], '[...document.documentElement.children].filter(e=>e.tagName==="DIV"&&e.style.position==="fixed").length', false);

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  if (!ok) failed++;
}

await options('chrome.storage.local.set({autoMode:true, autoSites:["youtube.com"]})');
// Leftover tabs from earlier runs would be matched by URL; start clean.
await options('chrome.tabs.query({url:"https://www.youtube.com/*"}).then(t=>chrome.tabs.remove(t.map(x=>x.id)))');
for (const key of Object.keys(VIDEOS)) {
  await fetch(base + '/json/new?https://www.youtube.com/watch?v=' + VIDEOS[key], { method: 'PUT' });
}
await sleep(7000);
const id = { A: await tabIdOf('A'), B: await tabIdOf('B') };

await options(`chrome.tabs.update(${id.A},{active:true})`);
await play('A');
let s = await state();
check('A on TV (automatic mode on)', s.owner === id.A && (await tvWindows()) === 1, s);

await clickIcon(id.A);
check('icon: automatic mode off', (await options('chrome.storage.local.get("autoMode")')).autoMode === false);
check('badge shows AUS', (await options('chrome.action.getBadgeText({})')) === 'AUS');

await options(`chrome.tabs.update(${id.B},{active:true})`);
await play('B');
s = await state();
check('B playing, but TV keeps A (no auto start)', s.owner === id.A && s.tabs.length === 1 && (await tvWindows()) === 1, s);

await clickIcon(id.B);
s = await state();
const onTv = s.owner === id.B && (await tvWindows()) >= 1;
check('icon again: automatic mode on', (await options('chrome.storage.local.get("autoMode")')).autoMode === true);
if (onTv) check('B on TV right away (gesture reached the page)', true, s);
else check('B on TV right away – fallback: hint button shown instead', (await toast('B')) === 1, s);

await options(`chrome.tabs.update(${id.A},{active:true})`);
await sleep(1500);
s = await state();
if (onTv) check('switch to A: TV follows again (A still in background)', s.owner === id.A, s);

// Clean up: return everything.
for (const key of Object.keys(VIDEOS)) {
  await evalIn(VIDEOS[key], 'document.querySelector(".tab2tv-placeholder button")?.click()').catch(() => {});
}
await options('chrome.storage.local.remove(["autoMode","autoSites"])');
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
