// Regression test: TV windows with several tabs (max. two, background window closes after a delay).
// Needs the test instance (tools/test-brave.sh) with the options page open in one tab.
// Usage: node tools/test-multitab.mjs
const base = 'http://127.0.0.1:9333';
const CLOSE_SEC = 8;
const VIDEOS = { A: 'aqz-KE-bpKQ', B: 'arj7oStGLkU', C: 'RCNO3k4QL5M' };

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
const tvWindows = async () => (await list()).filter(t => t.url === 'about:blank#tab2tv').length;
const options = expr => evalIn('options.html', expr, false);
const state = () => options('chrome.storage.session.get({sessions:{},tvOwner:null}).then(s=>({owner:s.tvOwner, tabs:Object.keys(s.sessions).map(Number)}))');
const tabIdOf = async key => options(`chrome.tabs.query({url:"https://www.youtube.com/watch?v=${VIDEOS[key]}*"}).then(t=>t[0]?.id)`);
// Click play with an audible volume (YouTube restores its stored volume, so use the player API).
const play = key => evalIn(VIDEOS[key], `(async()=>{const p=document.getElementById("movie_player"); p.unMute(); p.setVolume(10);
  const v=document.querySelector("video"); v.pause(); await new Promise(r=>setTimeout(r,300));
  document.querySelector(".ytp-play-button").click(); await new Promise(r=>setTimeout(r,2500)); return !v.paused})()`);
const placeholder = key => evalIn(VIDEOS[key], 'document.querySelectorAll(".tab2tv-placeholder").length', false);

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  if (!ok) failed++;
}

// YouTube is on the default auto list; placeholder mode makes "page restored" checkable.
await options(`chrome.storage.local.set({backgroundCloseSec:${CLOSE_SEC}, autoSites:["youtube.com"], parallel:false})`);
// Leftover tabs from earlier runs would be matched by URL; start clean.
await options('chrome.tabs.query({url:"https://www.youtube.com/*"}).then(t=>chrome.tabs.remove(t.map(x=>x.id)))');
for (const key of Object.keys(VIDEOS)) {
  await fetch(base + '/json/new?https://www.youtube.com/watch?v=' + VIDEOS[key], { method: 'PUT' });
}
await sleep(7000);
const id = { A: await tabIdOf('A'), B: await tabIdOf('B'), C: await tabIdOf('C') };

await play('A');
let s = await state();
check('A on TV, owner A', s.owner === id.A && (await tvWindows()) === 1, s);

await play('B');
s = await state();
check('B takes over, A in background (2 windows)', s.owner === id.B && s.tabs.length === 2 && (await tvWindows()) === 2, s);

await play('B');
s = await state();
check('play again in B: A stays in background', s.owner === id.B && s.tabs.length === 2, s);

await options(`chrome.tabs.update(${id.A},{active:true})`);
await sleep(1500);
s = await state();
check('switch back to A within delay: owner A, still 2 windows', s.owner === id.A && (await tvWindows()) === 2, s);

await play('C');
await sleep(1000);
s = await state();
check('C takes over: A background, B closed at once (max 2)', s.owner === id.C && s.tabs.length === 2
  && s.tabs.includes(id.A) && !s.tabs.includes(id.B) && (await tvWindows()) === 2, s);
check('B page restored', (await placeholder('B')) === 0);

await sleep((CLOSE_SEC + 3) * 1000);
s = await state();
check(`after ${CLOSE_SEC}s: background window A closed, only C left`, s.owner === id.C && s.tabs.length === 1 && (await tvWindows()) === 1, s);
check('A page restored', (await placeholder('A')) === 0);

await play('B');
await evalIn(VIDEOS.B, 'document.querySelector(".tab2tv-placeholder button").click()');
await sleep(1500);
s = await state();
check('owner B returns its video: background C closed too, TV free', s.owner === null && s.tabs.length === 0 && (await tvWindows()) === 0, s);

await options('chrome.storage.local.remove(["backgroundCloseSec","autoSites","parallel"])');
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
