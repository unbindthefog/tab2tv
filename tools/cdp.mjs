// Minimal CDP client (no deps) for the isolated test Brave instance (tools/test-brave.sh).
// Usage: node tools/cdp.mjs <url-substring|type:TYPE> "<js expression>"
//   NOGESTURE=1  evaluate without user gesture
//   LOGMS=4000   afterwards collect console messages containing "[tab2tv]" for N ms
const [, , match, expr] = process.argv;
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const t = list.find(x => match.startsWith('type:') ? x.type === match.slice(5) : x.url.includes(match));
if (!t) { console.error('no target', list.map(x => x.type + ' ' + x.url)); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const logs = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.consoleAPICalled') {
    const text = d.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (text.includes('[tab2tv]')) logs.push(text);
  }
};
const send = (method, params = {}) => new Promise(r => {
  const id = nextId++;
  pending.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});

const logMs = +(process.env.LOGMS || 0);
if (logMs) await send('Runtime.enable');
const res = await send('Runtime.evaluate', {
  expression: expr, awaitPromise: true, returnByValue: true,
  userGesture: !process.env.NOGESTURE,
});
console.log(JSON.stringify(res.result?.result?.value ?? res.result ?? res.error, null, 1));
if (logMs) {
  await new Promise(r => setTimeout(r, logMs));
  console.log(logs.length ? logs.join('\n') : '(no [tab2tv] logs)');
}
ws.close();
