// TabToTV service worker: display tracking, popup placement, badge state, cleanup.
importScripts('settings.js');

// tabId -> { tvTabId, openerWindowId, displayId, frameId }, persisted because the worker can be
// suspended. One session per tab; frameId is the (i)frame whose video is on the TV, tvTabId its
// tab in the shared TV window.
//
// PROTOTYPE (feature/tv-window): all TV outputs are tabs of ONE fullscreen window on the TV.
// Switching between videos activates another tab in it instead of focusing another fullscreen
// window, so macOS doesn't switch Spaces (no slide animation). The page opens its TV view as a
// normal tab (window.open without 'popup'); tabs can only move between normal windows.
async function getSessions() {
  return (await chrome.storage.session.get({ sessions: {} })).sessions;
}
// All read-modify-write updates go through one queue; interleaved updates (e.g. a stop from one
// frame while another frame takes over the TV) would otherwise overwrite each other.
// State: { sessions, tvOwner } – tvOwner is the tab whose TV window is currently shown.
let sessionQueue = Promise.resolve();
function updateState(fn) {
  const run = sessionQueue.then(async () => {
    const state = await chrome.storage.session.get({ sessions: {}, tvOwner: null });
    const result = await fn(state);
    await chrome.storage.session.set(state);
    return result;
  });
  sessionQueue = run.catch(() => {});
  return run;
}
function updateSessions(fn) {
  return updateState(state => fn(state.sessions));
}
function setSession(tabId, value) {
  return updateSessions(sessions => {
    if (value) sessions[tabId] = value; else delete sessions[tabId];
  });
}
// Removes matching sessions, deciding on the current state inside the queue (a snapshot taken
// earlier may already be outdated, e.g. when another frame just took over the TV).
// Returns the removed [tabId, session] pairs.
function removeSessionsWhere(pred) {
  return updateSessions(sessions => {
    const removed = Object.entries(sessions).filter(([tabId, s]) => pred(s, tabId));
    for (const [tabId] of removed) delete sessions[tabId];
    return removed;
  });
}

// --- TV ownership: at most two TV windows ----------------------------------
// Each TV window is its own macOS Space. The owner's window is shown; the previous owner stays
// in the background for settings.backgroundCloseSec (so switching back is instant), any further
// window is closed right away.

async function takeOverTv(tabId) {
  const { prev, evicted } = await updateState(state => {
    // Already the owner (e.g. play again in the shown tab): nothing changes, keep the background window.
    if (state.tvOwner === tabId) return { prev: null, evicted: [] };
    const prev = state.tvOwner;
    state.tvOwner = tabId;
    const evicted = Object.entries(state.sessions).filter(([id]) => +id !== tabId && +id !== prev);
    for (const [id] of evicted) delete state.sessions[id];
    return { prev: prev != null && state.sessions[prev] ? [prev, state.sessions[prev]] : null, evicted };
  });
  for (const [id, s] of evicted) {
    sendToFrame(id, s, { type: 'stop' });
    closeTv(s);
  }
  if (prev) sendToFrame(prev[0], prev[1], { type: 'background' });
  const own = (await getSessions())[tabId];
  if (own) sendToFrame(tabId, own, { type: 'foreground' });
}

// The owner's output ended: free the TV completely, so no stale background window shows up.
async function releaseTv(tabId) {
  const others = await updateState(state => {
    // Only if the owner really has no output left (not e.g. while one of its frames takes over).
    if (state.tvOwner !== +tabId || state.sessions[tabId]) return [];
    state.tvOwner = null;
    const others = Object.entries(state.sessions);
    for (const [id] of others) delete state.sessions[id];
    return others;
  });
  for (const [id, s] of others) {
    sendToFrame(id, s, { type: 'stop' });
    closeTv(s);
  }
}

// Messages for a session go to the frame that owns it, not to every frame of the tab.
function sendToFrame(tabId, session, msg) {
  return chrome.tabs.sendMessage(+tabId, msg, { frameId: session.frameId ?? 0 }).catch(() => {});
}

// --- Target display -------------------------------------------------------

async function findTargetDisplay() {
  const [displays, { targetDisplay }] = await Promise.all([
    chrome.system.display.getInfo(),
    chrome.storage.local.get({ targetDisplay: null }),
  ]);
  const { display, by } = tab2tvMatchTarget(displays, targetDisplay);
  // Re-identified by name under a new id (e.g. AirPlay reconnect): remember it for the next exact
  // match. A match by resolution alone is not stored – it is redone on every lookup, so it can't
  // permanently lock onto another monitor.
  if (display && by === 'name' && display.id !== targetDisplay.id) {
    await chrome.storage.local.set({ targetDisplay: { ...targetDisplay, id: display.id } });
  }
  return display;
}

// Small diagnostic log of display changes, shown on the options page. Serialized: display
// changes come in bursts, and parallel read-modify-writes would drop entries.
let displayLogQueue = Promise.resolve();
function logDisplays(event) {
  displayLogQueue = displayLogQueue.then(() => appendDisplayLog(event), () => appendDisplayLog(event));
  return displayLogQueue;
}
async function appendDisplayLog(event) {
  const displays = await chrome.system.display.getInfo();
  const { displayLog = [] } = await chrome.storage.local.get('displayLog');
  displayLog.push({
    t: Date.now(), event,
    displays: displays.map(d => ({ id: d.id, name: d.name, w: d.bounds.width, h: d.bounds.height,
      primary: d.isPrimary, internal: d.isInternal })),
  });
  await chrome.storage.local.set({ displayLog: displayLog.slice(-20) });
}

// Toolbar icon: a small TV drawn in the state color (no image files needed).
function drawTvIcon(size, color) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  const s = size / 16;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(1 * s, 2 * s, 14 * s, 10 * s, 2 * s);   // screen
  g.fill();
  g.fillRect(5 * s, 13 * s, 6 * s, 1.5 * s);          // stand
  g.fillStyle = '#fff';
  g.beginPath();                                       // play triangle
  g.moveTo(6.5 * s, 4.5 * s); g.lineTo(10.5 * s, 7 * s); g.lineTo(6.5 * s, 9.5 * s);
  g.fill();
  return g.getImageData(0, 0, size, size);
}
function setStateIcon(color) {
  return chrome.action.setIcon({ imageData: { 16: drawTvIcon(16, color), 32: drawTvIcon(32, color) } })
    .catch(() => {});
}

// Badge: "–" no target display, "AUS" automatic mode off; tabs with a TV window show "TV"
// (green with automatic mode on, red with it off).
// Runs serialized: overlapping runs (sessions change several times per TV handover) could
// otherwise finish out of order and leave an outdated per-tab badge.
let badgeQueue = Promise.resolve();
let badgeTvTabs = null;   // tabs that got the "TV" badge in the last run (null: unknown)
function refreshBadge() {
  badgeQueue = badgeQueue.then(refreshBadgeNow, refreshBadgeNow);
  return badgeQueue;
}
async function refreshBadgeNow() {
  const target = await findTargetDisplay();
  const auto = await isAutoMode();
  const grey = '#757575', green = '#2e7d32', red = '#c62828';
  const toggleHint = auto ? 'Automatik an' : 'Automatik aus';
  await setStateIcon(!target ? grey : auto ? green : red);
  const globalColor = !target ? grey : auto ? green : red;
  await chrome.action.setBadgeBackgroundColor({ color: globalColor });
  await chrome.action.setBadgeText({ text: !target ? '–' : auto ? '' : 'AUS' });
  const globalTitle = 'TabToTV: ' + (target ? toggleHint : 'kein Zielbildschirm');
  await chrome.action.setTitle({ title: globalTitle });
  // Per tab only the text "TV" (color and tooltip stay global, so nothing per tab can go stale).
  // Sessions end in several places (evicted, released, closed), so diff against the last run
  // instead of tracking each path; the first run after a worker start covers all tabs.
  // Without a target display, nothing is on TV.
  const onTv = new Set(Object.keys(target ? await getSessions() : {}).map(Number));
  const tabIds = badgeTvTabs ? new Set([...badgeTvTabs, ...onTv]) : (await chrome.tabs.query({})).map(t => t.id);
  for (const tabId of tabIds) {
    // null (not '') clears the tab value so the global badge ("AUS", "–") shows again.
    chrome.action.setBadgeText({ tabId, text: onTv.has(tabId) ? 'TV' : null }).catch(() => {});
  }
  badgeTvTabs = onTv;
}

chrome.system.display.onDisplayChanged.addListener(() => handleDisplayChange());

async function handleDisplayChange() {
  const t0 = Date.now();
  const usable = new Set((await chrome.system.display.getInfo()).filter(tab2tvIsUsableTarget).map(d => d.id));
  // Display of a session gone, primary or disabled (AirPlay disconnected, switched to mirroring):
  // return the video, paused.
  // macOS moves windows of a removed display to the main display, so close the popup right away.
  const lost = await removeSessionsWhere(s => !usable.has(s.displayId));
  for (const [tabId, s] of lost) {
    sendToFrame(tabId, s, { type: 'displayLost' });
    closeTv(s);
    console.debug('[TabToTV] display lost, stopped tab', tabId, 'after', Date.now() - t0, 'ms');
  }
  const { tvDisplayId } = await chrome.storage.session.get({ tvDisplayId: null });
  if (tvDisplayId != null && !usable.has(tvDisplayId)) closeTvWindow();
  logDisplays('changed');
  refreshBadge();
}

chrome.runtime.onStartup.addListener(() => { refreshBadge(); logDisplays('startup'); });
chrome.runtime.onInstalled.addListener(async () => {
  await tab2tvMigrateSettings();
  refreshBadge();
  logDisplays('installed');
  injectIntoOpenTabs();
});

// Content scripts only run in pages loaded after the extension was installed or updated. Inject
// them into the frames of already open tabs, so the popup's SEND finds their videos without a
// page reload. A frame counts as served only if a live instance answers (an old instance cut off
// by the update does not); settings.js declares top-level constants, so served frames are skipped.
// Script lists come from the manifest; the MAIN-world adapter goes into YouTube frames only.
async function injectIntoOpenTabs() {
  const [isolated, main] = chrome.runtime.getManifest().content_scripts;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(tabs.map(async tab => {
    const probe = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => ({ alive: !!globalThis.tab2tvContentAlive?.(), web: /^https?:$/.test(location.protocol),
        youtube: /^https:\/\/www\.youtube(-nocookie)?\.com\//.test(location.href) }),
    });
    // Like the manifest: web frames only (not about:blank/srcdoc). One frame at a time, so a frame
    // that navigates away meanwhile doesn't make the others fail.
    const missing = probe.filter(r => r.result.web && !r.result.alive);
    await Promise.allSettled(missing.map(async r => {
      const target = { tabId: tab.id, frameIds: [r.frameId] };
      await chrome.scripting.executeScript({ target, files: isolated.js });
      if (r.result.youtube) await chrome.scripting.executeScript({ target, files: main.js, world: 'MAIN' });
    }));
  }));
}

chrome.storage.onChanged.addListener(changes => {
  // changes.sessions (storage.session): any session started or ended, whichever code path did it.
  if (changes.targetDisplay || changes.autoMode || changes.sessions) refreshBadge();
});

// --- Popup placement ------------------------------------------------------

async function findTvTabForOpener(openerTabId, excludeTabId) {
  for (let i = 0; i < 20; i++) {
    const tabs = await chrome.tabs.query({});
    // Newest matching tab (highest id), in case an older one of this tab is still closing.
    const tab = tabs
      .filter(t => t.openerTabId === openerTabId && t.id !== excludeTabId
        && (t.url || t.pendingUrl) === TAB2TV_POPUP_URL)   // never a tab the site opened itself
      .sort((a, b) => b.id - a.id)[0];
    if (tab) return tab;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
}

async function placePopup(senderTab, frameId) {
  // window.open put the TV tab in front of the page in its window. A hidden page stops decoding
  // video (Chromium's background optimization) and stutters when it comes back: give the page its
  // tab back first, before anything else; the TV picture may stall briefly instead.
  chrome.tabs.update(senderTab.id, { active: true }).catch(() => {});
  const target = await findTargetDisplay();
  if (!target) return { ok: false, reason: 'noDisplay' };

  // Another frame of this tab is already on the TV (e.g. a second embedded player): end that first.
  // Remove its session first (atomically), so that frame's late "stopped" message and the removal
  // of its popup find nothing to release – this tab keeps owning the TV, other tabs keep theirs.
  const previous = (await getSessions())[senderTab.id];
  if (previous && previous.frameId !== frameId) {
    await updateSessions(s => { if (s[senderTab.id]?.frameId === previous.frameId) delete s[senderTab.id]; });
    sendToFrame(senderTab.id, previous, { type: 'stop' });
    closeTv(previous);
  }

  const tvTab = await findTvTabForOpener(senderTab.id, previous?.tvTabId);
  if (!tvTab) {
    // The previous frame's session may already be gone: don't leave the TV owned by a tab without output.
    releaseTv(senderTab.id);
    return { ok: false, reason: 'noPopup' };
  }

  const t0 = performance.now();
  // The video is just another tab of the TV window (opened once, with its placeholder). It waits
  // there in the background until the page reports its first picture ('show'). No focus changes:
  // the page's window keeps focus (only creating the TV window needs to give it back).
  const tvWindowId = await ensureTvWindow(target);
  await chrome.tabs.move(tvTab.id, { windowId: tvWindowId, index: -1 });
  console.debug('[TabToTV] placed TV tab in', Math.round(performance.now() - t0), 'ms');

  // Owner right away (so nothing evicts or releases it before its first picture), but 'shown'
  // only after 'show': until then raiseSession leaves the TV as it is.
  await setSession(senderTab.id, {
    tvTabId: tvTab.id, openerWindowId: senderTab.windowId, displayId: target.id, frameId, shown: false,
  });
  await takeOverTv(senderTab.id);
  refreshBadge();
  // Physical resolution of the TV (bounds are in scaled points; a Retina-like scale doubles them).
  const mode = target.modes?.find(m => m.isSelected);
  const nativeHeight = mode?.heightInNativePixels || Math.round(target.bounds.height * (mode?.deviceScaleFactor || 1));
  return { ok: true, display: { width: target.bounds.width, height: target.bounds.height, nativeHeight } };
}

// All TV tabs share one fullscreen window: showing another video is a tab switch there, no
// window focus and no Space change.
async function raiseSession(tabId) {
  const s = (await getSessions())[tabId];
  if (!s) return;
  const t0 = performance.now();
  if (s.shown === false) return;   // no picture yet; 'show' brings it to the front
  await chrome.tabs.update(s.tvTabId, { active: true });
  await takeOverTv(+tabId);
  console.debug('[TabToTV] raised popup of tab', tabId, 'in', Math.round(performance.now() - t0), 'ms');
}

function closeTv(session) {
  if (session?.tvTabId != null) chrome.tabs.remove(session.tvTabId).catch(() => {});
}
function closeTvTab(tabId) {
  chrome.tabs.remove(tabId).catch(() => {});
}

// The shared TV window, if it still exists (its id is kept across worker restarts). It always
// holds the placeholder tab (tv-idle.html), shown while no video is on the TV; so the window stays
// open between videos and only the first one needs the fullscreen animation.
const TV_IDLE_URL = chrome.runtime.getURL('tv-idle.html');
async function getTvWindowId() {
  const { tvWindowId } = await chrome.storage.session.get({ tvWindowId: null });
  if (tvWindowId == null) return null;
  return chrome.windows.get(tvWindowId).then(w => w.id, () => null);
}

// Opens the TV window with its placeholder on the target display, unless it is already open.
let openingTvWindow = null;
function ensureTvWindow(target) {
  openingTvWindow ??= (async () => {
    const existing = await getTvWindowId();
    const { tvDisplayId } = await chrome.storage.session.get({ tvDisplayId: null });
    if (existing != null && tvDisplayId === target.id) return existing;
    // Target changed (other display chosen, or the TV came back under a new id): start over there.
    // Forget it first: windows.onRemoved must not later clear the id of the new window.
    if (existing != null) {
      await chrome.storage.session.remove(['tvWindowId', 'tvDisplayId']);
      await chrome.windows.remove(existing).catch(() => {});
    }
    const focused = await chrome.windows.getLastFocused().catch(() => null);
    const w = await chrome.windows.create({ url: TV_IDLE_URL, left: target.bounds.left + 40, top: target.bounds.top + 40 });
    await chrome.storage.session.set({ tvWindowId: w.id, tvDisplayId: target.id });
    await chrome.windows.update(w.id, { state: 'fullscreen' });
    if (focused) await chrome.windows.update(focused.id, { focused: true }).catch(() => {});
    return w.id;
  })().finally(() => { openingTvWindow = null; });
  return openingTvWindow;
}

// Shows the owner's video on the TV, or the placeholder if no video is on it.
async function showCurrentOnTv() {
  const tvWindowId = await getTvWindowId();
  if (tvWindowId == null) return;
  const { sessions, tvOwner } = await chrome.storage.session.get({ sessions: {}, tvOwner: null });
  const owner = tvOwner != null && sessions[tvOwner];
  if (owner && owner.shown !== false) return chrome.tabs.update(owner.tvTabId, { active: true }).catch(() => {});
  const [idle] = await chrome.tabs.query({ windowId: tvWindowId, url: TV_IDLE_URL });
  if (idle) chrome.tabs.update(idle.id, { active: true }).catch(() => {});
}

async function closeTvWindow() {
  const tvWindowId = await getTvWindowId();
  await chrome.storage.session.remove(['tvWindowId', 'tvDisplayId']);
  if (tvWindowId != null) chrome.windows.remove(tvWindowId).catch(() => {});
}

// Popup button: end every output (videos return to their pages) and close every TV window,
// including leftovers without a page.
// CLEAR: with videos on the TV, end them all (videos return to their pages) and keep the TV window
// with its placeholder; with only the placeholder left, close the TV window too.
async function closeAllTvWindows() {
  if (!Object.keys(await getSessions()).length && !(await findOrphanTvTabs()).length) return closeTvWindow();
  const removed = await updateState(state => {
    const all = Object.entries(state.sessions);
    state.sessions = {};
    state.tvOwner = null;
    return all;
  });
  for (const [tabId, s] of removed) {
    sendToFrame(tabId, s, { type: 'stop' });
    closeTv(s);
  }
  // Leftovers only (no opener): a TV tab that is just being opened has one and is left alone.
  for (const t of await findOrphanTvTabs()) closeTvTab(t.id);
}

// TV tabs that no session references. The opener can't be used alone: tabs.move into the TV
// window resets openerTabId, so every live TV tab would look like a leftover.
async function findOrphanTvTabs() {
  const live = new Set(Object.values(await getSessions()).map(s => s.tvTabId));
  return (await chrome.tabs.query({})).filter(t => tab2tvIsOrphanTvTab(t) && !live.has(t.id));
}

// --- Leftovers after a browser restart ---------------------------------------
// With session restore Brave brings TV popups back as empty windows. A live TV popup always has
// an opener tab (the page that opened it); a restored one has none.

async function closeOrphanPopups(reason) {
  for (const tab of await findOrphanTvTabs()) {
    console.debug('[TabToTV] closing leftover TV tab', tab.id, '(' + reason + ')');
    closeTvTab(tab.id);
  }
  // Placeholder tabs outside the current TV window (restored after a browser restart).
  const tvWindowId = await getTvWindowId();
  for (const tab of await chrome.tabs.query({ url: TV_IDLE_URL })) {
    if (tab.windowId !== tvWindowId) closeTvTab(tab.id);
  }
}

chrome.runtime.onStartup.addListener(() => {
  // Restored windows may appear shortly after startup.
  for (const ms of [0, 2000, 6000]) setTimeout(() => closeOrphanPopups('startup'), ms);
});
// Also on every worker start: the extension may be loaded after session restore (missing the
// events above), and the check is a single cheap query.
closeOrphanPopups('worker start');
chrome.tabs.onCreated.addListener(tab => { if (tab2tvIsOrphanTvTab(tab)) closeTvTab(tab.id); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url && tab2tvIsOrphanTvTab(tab)) closeTvTab(tab.id);
});

// --- Messages and triggers ------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;
  if (msg.type === 'status') {
    findTargetDisplay().then(t => sendResponse({ hasTarget: !!t }));
    return true;
  }
  if (msg.type === 'place' && tab) {
    placePopup(tab, sender.frameId).then(sendResponse, e => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  // Popup commands only from the extension's own pages, never from a content-script frame.
  const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
  if (['setAutoMode', 'closeAll', 'toggleTab'].includes(msg.type) && !fromExtensionPage) return;
  if (msg.type === 'setAutoMode') {
    setAutoMode(msg.on, msg.tabId, msg.probe).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (msg.type === 'closeAll') {
    closeAllTvWindows().then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (msg.type === 'toggleTab') {
    toggleTabOutput(msg.tabId, msg.probe || []).then(ok => sendResponse(ok), () => sendResponse(false));
    return true;
  }
  if (msg.type === 'openTv' && fromExtensionPage) {
    // SEND without a video: make the TV ready (window with placeholder).
    findTargetDisplay().then(t => t ? ensureTvWindow(t).then(() => true) : false)
      .then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (msg.type === 'show' && tab) {
    // First picture of a new TV output is there: bring it to the front and make this tab the owner.
    updateSessions(s => {
      const own = s[tab.id];
      if (!own || own.frameId !== sender.frameId) return null;
      own.shown = true;
      return own.tvTabId;
    }).then(async tvTabId => {
      if (tvTabId == null) return;
      // Only if this tab still owns the TV (the user may have switched to another output meanwhile).
      const { tvOwner } = await chrome.storage.session.get({ tvOwner: null });
      if (tvOwner === tab.id) await chrome.tabs.update(tvTabId, { active: true }).catch(() => {});
    });
  }
  if (msg.type === 'raise' && tab) {
    // Play in a tab with a TV window: it takes the TV over, unless the automatic mode is off.
    isAutoMode().then(on => { if (on) raiseSession(tab.id).catch(() => {}); });
  }
  if (msg.type === 'stopped' && tab) {
    updateSessions(s => {
      // Ignore a stale stop from a frame whose session was already replaced by another frame.
      if (!s[tab.id] || s[tab.id].frameId !== sender.frameId) return false;
      closeTv(s[tab.id]);
      delete s[tab.id];
      return true;
    }).then(stopped => {
      if (!stopped) return;
      releaseTv(tab.id);
      refreshBadge();
    });
  }
});

// --- Popup (toolbar icon) --------------------------------------------------------
// See tab2tvProbeFrames(): the probe must be injected right in the user's click handler,
// so that the page gets the user activation needed to open the TV window.

// Starts the best-scored video of the tab. False if there is none or the frame can't be reached
// (e.g. it navigated away meanwhile).
async function startBestVideo(tabId, probe) {
  const best = ((await probe) || []).filter(r => r.result > 0).sort((a, b) => b.result - a.result)[0];
  if (!best) return false;
  return chrome.tabs.sendMessage(tabId, { type: 'start' }, { frameId: best.frameId })
    .then(() => true, () => false);
}

async function isAutoMode() {
  return (await chrome.storage.local.get({ autoMode: TAB2TV_DEFAULTS.autoMode })).autoMode;
}

// Automatic mode (switched in the popup). Off: the TV keeps its video – no following the active
// tab, no automatic start. On: the TV follows again, starting with the video of the given tab
// (probe results come from the popup, which ran the probe within the user's click).
async function setAutoMode(on, tabId, probeResults) {
  await chrome.storage.local.set({ autoMode: on });
  if (!on || tabId == null) return;
  if ((await getSessions())[tabId]) await raiseSession(tabId);
  else await startBestVideo(tabId, probeResults || []);
}

// Popup SEND key. The probe must already be running (started within the user's click).
async function toggleTabOutput(tabId, probe) {
  const session = (await getSessions())[tabId];
  if (!session) return startBestVideo(tabId, probe);
  return chrome.tabs.sendMessage(tabId, { type: 'stop' }, { frameId: session.frameId ?? 0 })
    .then(() => true, () => false);
}

// With the automatic mode on, the TV follows the active tab if that tab has an output session.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (await isAutoMode()) raiseSession(tabId).catch(() => {});
});

// Page tab closed: make sure nothing stays on the TV. TV tab closed from outside (e.g. the whole
// TV window): tell its page to clean up.
chrome.tabs.onRemoved.addListener(async (tabId, { windowId, isWindowClosing }) => {
  const removed = await removeSessionsWhere((s, id) => +id === tabId);
  for (const [, s] of removed) closeTv(s);
  releaseTv(tabId);
  const lost = await removeSessionsWhere(s => s.tvTabId === tabId);
  for (const [pageTabId, s] of lost) {
    sendToFrame(pageTabId, s, { type: 'popupClosed' });
    await releaseTv(pageTabId);
  }
  // Chromium activates a neighbouring tab of the TV window: show the owner's video or the placeholder.
  if (!isWindowClosing && windowId === await getTvWindowId()) showCurrentOnTv();
});

chrome.windows.onRemoved.addListener(async windowId => {
  const { tvWindowId } = await chrome.storage.session.get({ tvWindowId: null });
  if (windowId === tvWindowId) chrome.storage.session.remove(['tvWindowId', 'tvDisplayId']);
});
