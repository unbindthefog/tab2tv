// Unit tests for the pure helpers in extension/settings.js (no browser needed).
// Usage: node tools/test-unit.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Minimal chrome.storage.local mock (enough for the settings migration).
const store = {};
const storageLocal = {
  async get(keys) {
    const out = {};
    if (Array.isArray(keys)) for (const k of keys) { if (k in store) out[k] = store[k]; }
    else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
    else for (const [k, d] of Object.entries(keys || {})) out[k] = k in store ? store[k] : d;
    return out;
  },
  async set(obj) { Object.assign(store, obj); },
  async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
};
const ctx = vm.createContext({ chrome: { storage: { local: storageLocal } }, URL });
vm.runInContext(readFileSync(new URL('../extension/settings.js', import.meta.url), 'utf8') +
  '\n;globalThis.api = { tab2tvPickTarget, tab2tvSiteMatches, tab2tvNormalizeSite, tab2tvDisplayLabel, tab2tvSiteHostname, tab2tvIsUsableTarget, tab2tvMatchTarget, tab2tvIsOrphanTvTab, tab2tvMigrateSettings };', ctx);
const { tab2tvPickTarget: pick, tab2tvSiteMatches: matches, tab2tvNormalizeSite: norm, tab2tvDisplayLabel: label,
  tab2tvSiteHostname: siteHost, tab2tvIsUsableTarget: usable, tab2tvMatchTarget: match,
  tab2tvIsOrphanTvTab: orphan, tab2tvMigrateSettings: migrate } = ctx.api;

let failed = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (ok ? '' : `  got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`));
  if (!ok) failed++;
}

const disp = (id, w, h, extra = {}) => ({ id, name: '', isPrimary: false, isInternal: false, isEnabled: true,
  bounds: { left: 0, top: 0, width: w, height: h }, ...extra });
const mac = disp('1', 1512, 982, { isPrimary: true, isInternal: true });
const tv = disp('136', 1920, 1080);
const monitor = disp('5', 2560, 1440);

// Target display
eq('auto: first non-primary', pick([mac, tv], null)?.id, '136');
eq('auto: only main display → none', pick([mac], null), null);
eq('chosen: exact id', pick([mac, monitor, tv], { id: '136', width: 1920, height: 1080 })?.id, '136');
eq('chosen: new AirPlay id, same resolution', pick([mac, tv], { id: '135', width: 1920, height: 1080 })?.id, '136');
eq('chosen: matched by name', pick([mac, disp('9', 1280, 720, { name: 'Wohnzimmer' })], { id: '1', width: 1920, height: 1080, label: 'Wohnzimmer' })?.id, '9');
eq('chosen: not connected → none, no fallback to other monitor', pick([mac, monitor], { id: '135', width: 1920, height: 1080 }), null);
eq('chosen: primary never a target', pick([mac], { id: '1', width: 1512, height: 982 }), null);
eq('disabled display ignored', pick([mac, disp('7', 1920, 1080, { isEnabled: false })], null), null);
eq('internal display not matched by resolution', pick([mac, disp('8', 1920, 1080, { isInternal: true })], { id: 'x', width: 1920, height: 1080 }), null);

eq('match kind: id', match([mac, tv], { id: '136', width: 1920, height: 1080 }).by, 'id');
eq('match kind: name (wins over resolution)', match([mac, disp('9', 1920, 1080, { name: 'Wohnzimmer' })], { id: '135', width: 1920, height: 1080, label: 'Wohnzimmer' }).by, 'name');
eq('match kind: resolution (new AirPlay id)', match([mac, tv], { id: '135', width: 1920, height: 1080 }).by, 'resolution');
eq('ambiguous resolution → none (never the wrong monitor)',
  pick([mac, tv, disp('9', 1920, 1080)], { id: '135', width: 1920, height: 1080 }), null);

// Website list
eq('domain matches itself', matches('youtube.com', ['youtube.com']), true);
eq('domain matches subdomain', matches('www.youtube.com', ['youtube.com']), true);
eq('no suffix-only match', matches('notyoutube.com', ['youtube.com']), false);
eq('other site', matches('spiegel.de', ['youtube.com']), false);
eq('empty list', matches('youtube.com', []), false);

// Normalizing input
eq('url → domain', norm('https://www.Spiegel.de/artikel?x=1'), 'spiegel.de');
eq('www stripped', norm('  www.youtube.com  '), 'youtube.com');
eq('port and path stripped', norm('localhost:8765/embeds.html'), 'localhost');
eq('subdomain kept', norm('m.youtube.com'), 'm.youtube.com');
eq('empty', norm('   '), '');

// Website of a frame (auto list is judged by the top-level site)
eq('top frame: own host', siteHost(true, 'www.youtube.com', []), 'www.youtube.com');
eq('embed: top-level site from ancestorOrigins', siteHost(false, 'www.youtube.com', ['https://news.example', 'https://www.spiegel.de']), 'www.spiegel.de');
eq('embed: masked origin → unknown, not the embed host', siteHost(false, 'www.youtube.com', ['null']), null);
eq('embed: no ancestorOrigins → unknown', siteHost(false, 'www.youtube.com', undefined), null);

// Usable target / display loss (mirroring makes the TV primary or disabled)
eq('external display usable', usable(tv), true);
eq('primary display not usable', usable(mac), false);
eq('disabled display not usable', usable(disp('7', 1920, 1080, { isEnabled: false })), false);

// Leftover TV popups
eq('orphan: TV url, no opener', orphan({ url: 'about:blank#tab2tv' }), true);
eq('live TV popup has an opener', orphan({ url: 'about:blank#tab2tv', openerTabId: 5 }), false);
eq('other popup', orphan({ url: 'https://example.com/' }), false);

// Settings migration v1 → v2
store.autoEnabled = false; store.parallel = false; store.disabledSites = ['x.de']; store.targetDisplay = { id: '1' };
await migrate();
eq('migration: explicit auto off → no auto sites, master switch untouched', [store.autoSites, store.autoAllSites, store.autoMode], [[], false, undefined]);
eq('migration: old keys dropped, others kept', [store.autoEnabled, store.parallel, store.disabledSites, store.targetDisplay?.id, store.settingsVersion], [undefined, undefined, undefined, '1', 2]);
for (const k of Object.keys(store)) delete store[k];
store.autoEnabled = true;
await migrate();
eq('migration: auto on → default autoMode (unset)', store.autoMode, undefined);

// Display label
eq('label fallback', label(tv), 'Externer Bildschirm (1920×1080)');
eq('label from name', label(tv, 'Wohnzimmer'), 'Wohnzimmer (1920×1080)');

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
