// TabToTV service worker: display tracking, popup placement, badge state, cleanup.
importScripts('settings.js');

// tabId -> { popupWindowId, openerWindowId, displayId, frameId }, persisted because the worker
// can be suspended. One session per tab; frameId is the (i)frame whose video is on the TV.
async function getSessions() {
  return (await chrome.storage.session.get({ sessions: {} })).sessions;
}
// All read-modify-write updates go through one queue; interleaved updates (e.g. a stop from one
// frame while another frame takes over the TV) would otherwise overwrite each other.
let sessionQueue = Promise.resolve();
function updateSessions(fn) {
  const run = sessionQueue.then(async () => {
    const sessions = await getSessions();
    const result = await fn(sessions);
    await chrome.storage.session.set({ sessions });
    return result;
  });
  sessionQueue = run.catch(() => {});
  return run;
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

async function refreshBadge() {
  const target = await findTargetDisplay();
  await chrome.action.setBadgeBackgroundColor({ color: target ? '#2e7d32' : '#757575' });
  await chrome.action.setBadgeText({ text: target ? '' : '–' });
  await chrome.action.setTitle({ title: target ? 'TabToTV: bereit' : 'TabToTV: kein Zielbildschirm' });
  const sessions = await getSessions();
  for (const tabId of Object.keys(sessions)) {
    chrome.action.setBadgeText({ tabId: +tabId, text: 'TV' }).catch(() => {});
    chrome.action.setTitle({ tabId: +tabId, title: 'TabToTV: läuft auf TV – klicken zum Zurückholen' }).catch(() => {});
  }
}

chrome.system.display.onDisplayChanged.addListener(() => handleDisplayChange());

async function handleDisplayChange() {
  const t0 = Date.now();
  const connected = new Set((await chrome.system.display.getInfo()).map(d => d.id));
  // Display of a session gone (AirPlay disconnected, switched to mirroring): return the video, paused.
  // macOS moves windows of a removed display to the main display, so close the popup right away.
  const lost = await removeSessionsWhere(s => !connected.has(s.displayId));
  for (const [tabId, s] of lost) {
    sendToFrame(tabId, s, { type: 'displayLost' });
    closePopup(s.popupWindowId);
    chrome.action.setBadgeText({ tabId: +tabId, text: '' }).catch(() => {});
    console.debug('[TabToTV] display lost, stopped tab', tabId, 'after', Date.now() - t0, 'ms');
  }
  logDisplays('changed');
  refreshBadge();
}

chrome.runtime.onStartup.addListener(() => { refreshBadge(); logDisplays('startup'); });
chrome.runtime.onInstalled.addListener(() => { refreshBadge(); logDisplays('installed'); });
chrome.storage.onChanged.addListener(changes => { if (changes.targetDisplay) refreshBadge(); });

// --- Popup placement ------------------------------------------------------

async function findPopupWindowForOpener(openerTabId, excludeWindowId) {
  for (let i = 0; i < 20; i++) {
    const tabs = await chrome.tabs.query({ windowType: 'popup' });
    // Newest matching popup (highest tab id), in case an older one of this tab is still closing.
    const tab = tabs
      .filter(t => t.openerTabId === openerTabId && t.windowId !== excludeWindowId)
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
  const previous = (await getSessions())[senderTab.id];
  if (previous && previous.frameId !== frameId) {
    sendToFrame(senderTab.id, previous, { type: 'stop' });
    closePopup(previous.popupWindowId);
  }

  const popupWindowId = await findPopupWindowForOpener(senderTab.id, previous?.popupWindowId);
  if (popupWindowId == null) return { ok: false, reason: 'noPopup' };

  // Moving must not include width/height, and 'fullscreen' cannot be combined with bounds.
  await chrome.windows.update(popupWindowId, { left: target.bounds.left + 40, top: target.bounds.top + 40 });
  await chrome.windows.update(popupWindowId, { state: 'fullscreen' });
  await chrome.windows.update(senderTab.windowId, { focused: true });

  await setSession(senderTab.id, {
    popupWindowId, openerWindowId: senderTab.windowId, displayId: target.id, frameId,
  });
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
  console.debug('[TabToTV] raised popup of tab', tabId, 'in', Math.round(performance.now() - t0), 'ms');
}

function closePopup(windowId) {
  if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
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
  if (msg.type === 'candidate' && tab) {
    pendingPicks.get(msg.id)?.push({ frameId: sender.frameId, score: msg.score });
  }
  if (msg.type === 'raise' && tab) {
    raiseSession(tab.id).catch(() => {});
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
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: '' }).catch(() => {});
      refreshBadge();
    });
  }
});

// Symbol/shortcut: stop the running output, or start the best video of any frame in the tab.
// Frames can't see into each other (cross-origin iframes), so each one reports its best candidate.
const pendingPicks = new Map(); // request id -> [{ frameId, score }]

async function sendToggle(tab) {
  if (tab?.id == null) return;
  const session = (await getSessions())[tab.id];
  if (session) { sendToFrame(tab.id, session, { type: 'stop' }); return; }

  const id = crypto.randomUUID();
  pendingPicks.set(id, []);
  chrome.tabs.sendMessage(tab.id, { type: 'candidates', id }).catch(() => {});
  await new Promise(r => setTimeout(r, 250));
  const best = pendingPicks.get(id).sort((a, b) => b.score - a.score)[0];
  pendingPicks.delete(id);
  if (best?.score > 0) chrome.tabs.sendMessage(tab.id, { type: 'start' }, { frameId: best.frameId }).catch(() => {});
}
chrome.action.onClicked.addListener(sendToggle);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-tv') sendToggle(tab);
});

// The TV follows the active tab if that tab has an output session.
chrome.tabs.onActivated.addListener(({ tabId }) => raiseSession(tabId).catch(() => {}));

// Tab closed: make sure nothing stays on the TV.
chrome.tabs.onRemoved.addListener(async tabId => {
  const removed = await removeSessionsWhere((s, id) => +id === tabId);
  for (const [, s] of removed) closePopup(s.popupWindowId);
});

// Popup closed from outside (e.g. user, macOS): tell the page to clean up.
chrome.windows.onRemoved.addListener(async windowId => {
  const removed = await removeSessionsWhere(s => s.popupWindowId === windowId);
  for (const [tabId, s] of removed) {
    sendToFrame(tabId, s, { type: 'popupClosed' });
    chrome.action.setBadgeText({ tabId: +tabId, text: '' }).catch(() => {});
  }
});
