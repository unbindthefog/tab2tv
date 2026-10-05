// TabToTV service worker: display tracking, popup placement, badge state, cleanup.
importScripts('settings.js');

// tabId -> { popupWindowId, openerWindowId }, persisted because the worker can be suspended.
async function getSessions() {
  return (await chrome.storage.session.get({ sessions: {} })).sessions;
}
async function setSession(tabId, value) {
  const sessions = await getSessions();
  if (value) sessions[tabId] = value; else delete sessions[tabId];
  await chrome.storage.session.set({ sessions });
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
  const sessions = await getSessions();
  for (const [tabId, s] of Object.entries(sessions)) {
    if (connected.has(s.displayId)) continue;
    chrome.tabs.sendMessage(+tabId, { type: 'displayLost' }).catch(() => {});
    closePopup(s.popupWindowId);
    await setSession(tabId, null);
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

async function findPopupWindowForOpener(openerTabId) {
  for (let i = 0; i < 20; i++) {
    const tabs = await chrome.tabs.query({ windowType: 'popup' });
    const tab = tabs.find(t => t.openerTabId === openerTabId);
    if (tab) return tab.windowId;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
}

async function placePopup(senderTab) {
  const target = await findTargetDisplay();
  if (!target) return { ok: false, reason: 'noDisplay' };
  const popupWindowId = await findPopupWindowForOpener(senderTab.id);
  if (popupWindowId == null) return { ok: false, reason: 'noPopup' };

  // Moving must not include width/height, and 'fullscreen' cannot be combined with bounds.
  await chrome.windows.update(popupWindowId, { left: target.bounds.left + 40, top: target.bounds.top + 40 });
  await chrome.windows.update(popupWindowId, { state: 'fullscreen' });
  await chrome.windows.update(senderTab.windowId, { focused: true });

  await setSession(senderTab.id, { popupWindowId, openerWindowId: senderTab.windowId, displayId: target.id });
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
    placePopup(tab).then(sendResponse, e => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg.type === 'raise' && tab) {
    raiseSession(tab.id).catch(() => {});
  }
  if (msg.type === 'stopped' && tab) {
    getSessions().then(async s => {
      if (s[tab.id]) closePopup(s[tab.id].popupWindowId);
      await setSession(tab.id, null);
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: '' }).catch(() => {});
      refreshBadge();
    });
  }
});

function sendToggle(tab) {
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
}
chrome.action.onClicked.addListener(sendToggle);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-tv') sendToggle(tab);
});

// The TV follows the active tab if that tab has an output session.
chrome.tabs.onActivated.addListener(({ tabId }) => raiseSession(tabId).catch(() => {}));

// Tab closed: make sure nothing stays on the TV.
chrome.tabs.onRemoved.addListener(async tabId => {
  const s = await getSessions();
  if (s[tabId]) { closePopup(s[tabId].popupWindowId); await setSession(tabId, null); }
});

// Popup closed from outside (e.g. user, macOS): tell the page to clean up.
chrome.windows.onRemoved.addListener(async windowId => {
  const s = await getSessions();
  for (const [tabId, v] of Object.entries(s)) {
    if (v.popupWindowId === windowId) {
      chrome.tabs.sendMessage(+tabId, { type: 'popupClosed' }).catch(() => {});
      await setSession(tabId, null);
      chrome.action.setBadgeText({ tabId: +tabId, text: '' }).catch(() => {});
    }
  }
});
