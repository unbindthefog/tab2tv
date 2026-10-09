// TabToTV service worker: display tracking, popup placement, badge state, cleanup.
importScripts('settings.js');

// tabId -> { popupWindowId, openerWindowId, displayId, frameId }, persisted because the worker
// can be suspended. One session per tab; frameId is the (i)frame whose video is on the TV.
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
    closePopup(s.popupWindowId);
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
    closePopup(s.popupWindowId);
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
  const found = tab2tvPickTarget(displays, targetDisplay);
  // Re-identified under a new id (e.g. AirPlay reconnect): remember it for the next exact match.
  if (found && targetDisplay && found.id !== targetDisplay.id) {
    await chrome.storage.local.set({ targetDisplay: { ...targetDisplay, id: found.id } });
  }
  return found;
}

// Small diagnostic log of display changes, shown on the options page.
async function logDisplays(event) {
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
    closePopup(s.popupWindowId);
    chrome.action.setBadgeText({ tabId: +tabId, text: null }).catch(() => {});
    console.debug('[TabToTV] display lost, stopped tab', tabId, 'after', Date.now() - t0, 'ms');
  }
  logDisplays('changed');
  refreshBadge();
}

chrome.runtime.onStartup.addListener(() => { refreshBadge(); logDisplays('startup'); });
chrome.runtime.onInstalled.addListener(async () => {
  await tab2tvMigrateSettings();
  refreshBadge();
  logDisplays('installed');
});
chrome.storage.onChanged.addListener(changes => {
  // changes.sessions (storage.session): any session started or ended, whichever code path did it.
  if (changes.targetDisplay || changes.autoMode || changes.sessions) refreshBadge();
});

// --- Popup placement ------------------------------------------------------

async function findPopupWindowForOpener(openerTabId, excludeWindowId) {
  for (let i = 0; i < 20; i++) {
    const tabs = await chrome.tabs.query({ windowType: 'popup' });
    // Newest matching popup (highest tab id), in case an older one of this tab is still closing.
    const tab = tabs
      .filter(t => t.openerTabId === openerTabId && t.windowId !== excludeWindowId
        && (t.url || t.pendingUrl) === TAB2TV_POPUP_URL)   // never a popup the site opened itself
      .sort((a, b) => b.id - a.id)[0];
    if (tab) return tab.windowId;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
}

async function placePopup(senderTab, frameId) {
  const target = await findTargetDisplay();
  if (!target) return { ok: false, reason: 'noDisplay' };

  // Another frame of this tab is already on the TV (e.g. a second embedded player): end that first.
  // Remove its session first (atomically), so that frame's late "stopped" message and the removal
  // of its popup find nothing to release – this tab keeps owning the TV, other tabs keep theirs.
  const previous = (await getSessions())[senderTab.id];
  if (previous && previous.frameId !== frameId) {
    await updateSessions(s => { if (s[senderTab.id]?.frameId === previous.frameId) delete s[senderTab.id]; });
    sendToFrame(senderTab.id, previous, { type: 'stop' });
    closePopup(previous.popupWindowId);
  }

  const popupWindowId = await findPopupWindowForOpener(senderTab.id, previous?.popupWindowId);
  if (popupWindowId == null) {
    // The previous frame's session may already be gone: don't leave the TV owned by a tab without output.
    releaseTv(senderTab.id);
    return { ok: false, reason: 'noPopup' };
  }

  // Moving must not include width/height, and 'fullscreen' cannot be combined with bounds.
  await chrome.windows.update(popupWindowId, { left: target.bounds.left + 40, top: target.bounds.top + 40 });
  await chrome.windows.update(popupWindowId, { state: 'fullscreen' });
  await chrome.windows.update(senderTab.windowId, { focused: true });

  await setSession(senderTab.id, {
    popupWindowId, openerWindowId: senderTab.windowId, displayId: target.id, frameId,
  });
  await takeOverTv(senderTab.id);
  refreshBadge();
  return { ok: true, display: { width: target.bounds.width, height: target.bounds.height } };
}

// Every fullscreen popup lives in its own macOS Space on the TV. Focusing it makes macOS switch
// the TV display to that Space; focus then goes straight back to the page's window.
async function raiseSession(tabId) {
  const s = (await getSessions())[tabId];
  if (!s) return;
  const t0 = performance.now();
  await chrome.windows.update(s.popupWindowId, { focused: true });
  await chrome.windows.update(s.openerWindowId, { focused: true });
  await takeOverTv(+tabId);
  console.debug('[TabToTV] raised popup of tab', tabId, 'in', Math.round(performance.now() - t0), 'ms');
}

function closePopup(windowId) {
  if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
}

// Popup button: end every output (videos return to their pages) and close every TV window,
// including leftovers without a page.
async function closeAllTvWindows() {
  const removed = await updateState(state => {
    const all = Object.entries(state.sessions);
    state.sessions = {};
    state.tvOwner = null;
    return all;
  });
  for (const [tabId, s] of removed) {
    sendToFrame(tabId, s, { type: 'stop' });
    closePopup(s.popupWindowId);
  }
  const leftovers = await chrome.tabs.query({ windowType: 'popup' });
  // Leftovers only (no opener): a TV window that is just being opened has one and is left alone.
  for (const t of leftovers) if (isOrphanTvTab(t)) closePopup(t.windowId);
}

// --- Leftovers after a browser restart ---------------------------------------
// With session restore Brave brings TV popups back as empty windows. A live TV popup always has
// an opener tab (the page that opened it); a restored one has none.

function isOrphanTvTab(tab) {
  return (tab.url || tab.pendingUrl || '') === TAB2TV_POPUP_URL && tab.openerTabId == null;
}

async function closeOrphanPopups(reason) {
  const tabs = await chrome.tabs.query({ windowType: 'popup' });
  for (const tab of tabs.filter(isOrphanTvTab)) {
    console.debug('[TabToTV] closing leftover TV popup', tab.windowId, '(' + reason + ')');
    closePopup(tab.windowId);
  }
}

chrome.runtime.onStartup.addListener(() => {
  // Restored windows may appear shortly after startup.
  for (const ms of [0, 2000, 6000]) setTimeout(() => closeOrphanPopups('startup'), ms);
});
// Also on every worker start: the extension may be loaded after session restore (missing the
// events above), and the check is a single cheap query.
closeOrphanPopups('worker start');
chrome.tabs.onCreated.addListener(tab => { if (isOrphanTvTab(tab)) closePopup(tab.windowId); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url && isOrphanTvTab(tab)) closePopup(tab.windowId);
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
  if (msg.type === 'raise' && tab) {
    // Play in a tab with a TV window: it takes the TV over, unless the automatic mode is off.
    isAutoMode().then(on => { if (on) raiseSession(tab.id).catch(() => {}); });
  }
  if (msg.type === 'stopped' && tab) {
    updateSessions(s => {
      // Ignore a stale stop from a frame whose session was already replaced by another frame.
      if (!s[tab.id] || s[tab.id].frameId !== sender.frameId) return false;
      closePopup(s[tab.id].popupWindowId);
      delete s[tab.id];
      return true;
    }).then(stopped => {
      if (!stopped) return;
      releaseTv(tab.id);
      refreshBadge();
    });
  }
});

// --- Popup (toolbar icon) and shortcut -----------------------------------------
// See tab2tvProbeFrames(): the probe must be injected right in the user's click/shortcut handler,
// so that the page gets the user activation needed to open the TV window.

// Starts the best-scored video of the tab. False if there is none or the frame can't be reached
// (e.g. a tab opened before the extension was reloaded has no content script).
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

// Shortcut: send the video of the current tab to the TV, or return it.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-tv' && tab?.id != null) {
    toggleTabOutput(tab.id, tab2tvProbeFrames(tab.id))
      .catch(e => console.debug('[TabToTV] shortcut failed:', e.message));
  }
});
// Shortcut and popup button. The probe must already be running (started within the user's input).
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

// Tab closed: make sure nothing stays on the TV.
chrome.tabs.onRemoved.addListener(async tabId => {
  const removed = await removeSessionsWhere((s, id) => +id === tabId);
  for (const [, s] of removed) closePopup(s.popupWindowId);
  releaseTv(tabId);
});

// Popup closed from outside (e.g. user, macOS): tell the page to clean up.
chrome.windows.onRemoved.addListener(async windowId => {
  const removed = await removeSessionsWhere(s => s.popupWindowId === windowId);
  for (const [tabId, s] of removed) {
    sendToFrame(tabId, s, { type: 'popupClosed' });
    chrome.action.setBadgeText({ tabId: +tabId, text: null }).catch(() => {});
    releaseTv(tabId);
  }
});
