// TabToTV content script, runs in every frame.
// Approach: the page opens a same-origin popup, the original <video> is mirrored into it
// via captureStream(), and the service worker moves the popup fullscreen onto the TV.
// The original element stays in the page, so the site's own player keeps full control.
// Embedded players (cross-origin iframes) are handled by the instance inside that iframe:
// there the video is same-origin, and the popup is opened from the iframe's origin.
(() => {
  // Still connected to the extension? After an extension reload/update an old instance stays in
  // the page but is cut off (chrome.runtime.id becomes undefined); it then stays quiet.
  const alive = () => !!chrome.runtime?.id;
  // Asked by the service worker before it injects the scripts into already open tabs after an
  // install/update (see injectIntoOpenTabs in background.js): only a live instance counts.
  globalThis.tab2tvContentAlive = alive;

  let settings = { ...TAB2TV_DEFAULTS };
  tab2tvLoadSettings().then(s => { settings = s; });
  // Only settings changes (not e.g. the display log), as this runs in every frame of every tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(k => k in TAB2TV_DEFAULTS)) {
      tab2tvLoadSettings().then(s => { settings = s; });
    }
  });

  const isYouTube = /^www\.youtube(-nocookie)?\.com$/.test(location.hostname);
  const log = (...a) => console.debug('[TabToTV]', ...a);

  // The website the user is on (top-level page, also for embedded players); null if masked.
  const siteHostname = tab2tvSiteHostname(window.top === window, location.hostname, location.ancestorOrigins);

  let session = null;          // active output, see startTv()
  let lastInteractedVideo = null;
  let toolbarWarned = false;

  // ---------------------------------------------------------------------------
  // Video selection

  function videoArea(v) {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  function youtubeAdShowing(v) {
    return isYouTube && !!v.closest('.html5-video-player')?.classList.contains('ad-showing');
  }

  // Why a video is not eligible for automatic output, or null if it is.
  function autoRejectReason(v) {
    if (!settings.autoMode) return 'automatic mode off';
    if (!settings.autoAllSites && !(siteHostname && tab2tvSiteMatches(siteHostname, settings.autoSites))) {
      return 'auto off for ' + (siteHostname || 'unknown site (masked origin)');
    }
    if (v.muted || v.volume === 0) return 'muted';
    if (v.getBoundingClientRect().width < settings.minWidthPx) return 'too small';
    const d = v.duration;
    if (Number.isFinite(d) && d < settings.minDurationSec) return 'too short';
    if (youtubeAdShowing(v)) return 'ad';
    return null;
  }

  function pickMainVideo() {
    const videos = [...document.querySelectorAll('video')].filter(v => v.isConnected && videoArea(v) > 0);
    if (lastInteractedVideo && videos.includes(lastInteractedVideo)) return lastInteractedVideo;
    const playing = videos.filter(v => !v.paused);
    const pool = playing.length ? playing : videos;
    return pool.sort((a, b) => videoArea(b) - videoArea(a))[0] || null;
  }

  addEventListener('pointerdown', e => {
    const v = [...document.querySelectorAll('video')].find(v => {
      const r = v.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (v) lastInteractedVideo = v;
  }, true);

  function waitForMetadata(v, timeoutMs) {
    if (v.readyState >= 1) return Promise.resolve();
    return new Promise(r => {
      const done = () => { v.removeEventListener('loadedmetadata', done); r(); };
      v.addEventListener('loadedmetadata', done);
      setTimeout(done, timeoutMs);
    });
  }

  // Media events don't bubble, but they can be captured at document level.
  document.addEventListener('play', async e => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !alive()) return;
    if (session) {
      // Another big video started while on TV (e.g. site swapped elements): follow it.
      if (v !== session.video && !autoRejectReason(v) && videoArea(v) >= videoArea(session.video)) rebind(v);
      // Resuming here: bring this tab's TV window to the front (another tab may own the TV now).
      chrome.runtime.sendMessage({ type: 'raise' }).catch(() => {});
      return;
    }
    const activeAtPlay = navigator.userActivation.isActive;
    await waitForMetadata(v, 1500);
    const reason = autoRejectReason(v);
    if (reason) { log('auto skipped:', reason); return; }
    const { hasTarget } = await chrome.runtime.sendMessage({ type: 'status' });
    if (!hasTarget) return;
    if (navigator.userActivation.isActive) {
      startTv(v);
    } else {
      log('no user activation (at play:', activeAtPlay, ') – offering button');
      toast('Video auf dem TV abspielen?', [{ label: 'Auf TV abspielen', action: () => startTv(v) }], 10000);
    }
  }, true);

  // ---------------------------------------------------------------------------
  // Output

  function captureOrExplain(v) {
    try {
      return v.captureStream();
    } catch (e) {
      log('captureStream failed', e);
      const drm = v.mediaKeys || /EME/i.test(e.message);
      toast(drm
        ? 'Dieses Video ist kopiergeschützt (DRM) und kann nicht auf den TV ausgegeben werden.'
        : 'Dieses Video kann nicht auf den TV ausgegeben werden (fremde Herkunft).');
      return null;
    }
  }

  async function startTv(video) {
    if (session || !video) return;
    // Without user activation Brave opens window.open(..., 'popup') as a plain tab instead of a
    // popup window, so ask for a click first (the click itself provides the activation).
    if (!navigator.userActivation.isActive) {
      toast('Video auf dem TV abspielen?', [{ label: 'Auf TV abspielen', action: () => startTv(video) }], 10000);
      return;
    }
    const stream = captureOrExplain(video);
    if (!stream) return;

    // Must happen while the user activation is still valid.
    const popup = window.open(TAB2TV_POPUP_URL, 'tab2tv_' + Date.now(), 'popup,width=480,height=270');
    if (!popup) {
      toast('Popup wurde blockiert.', [{ label: 'Auf TV abspielen', action: () => startTv(video) }], 10000);
      return;
    }

    const tv = buildPopup(popup);
    tv.video.srcObject = stream;
    tv.video.play().catch(() => {});

    session = { video, popup, tv, placeholder: null, captions: null, cleanups: [] };
    applyPageMode();
    bindVideoEvents(video);
    session.captions = startCaptionMirror(video);
    if (isYouTube) document.dispatchEvent(new CustomEvent('tab2tv:quality', { detail: 'max' }));

    popup.addEventListener('pagehide', () => stopTv({ reason: 'popup closed' }));
    const watch = setInterval(() => { if (popup.closed) stopTv({ reason: 'popup closed' }); }, 1000);
    session.cleanups.push(() => clearInterval(watch));

    const t0 = performance.now();
    const res = await chrome.runtime.sendMessage({ type: 'place' });
    log('placed in', Math.round(performance.now() - t0), 'ms', res);
    if (!res?.ok) {
      stopTv({ reason: 'place failed' });
      toast(res?.reason === 'noDisplay' ? 'Kein zweiter Bildschirm verbunden.' : 'Ausgabe auf den TV fehlgeschlagen.');
      return;
    }
    // Brave keeps the toolbar visible in fullscreen unless the user disabled it.
    setTimeout(() => {
      if (session?.popup === popup && !toolbarWarned && popup.innerHeight < res.display.height - 4) {
        toolbarWarned = true;
        toast('Auf dem TV ist oben noch eine Leiste sichtbar. Abhilfe in Brave: Menü „Ansicht“ → „Symbolleiste im Vollbildmodus immer anzeigen“ ausschalten (⇧⌘F).', [], 15000);
      }
    }, 2000);
  }

  function buildPopup(popup) {
    const d = popup.document;
    d.title = 'TabToTV';
    const style = d.createElement('style');
    style.textContent = `
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
      #stage { position: fixed; inset: 0; }
      #stage > video { width: 100%; height: 100%; object-fit: contain; display: block; }
      #captions { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
      #cues { position: absolute; left: 0; right: 0; bottom: 6%; text-align: center; font: 600 3.2vh system-ui, sans-serif; color: #fff; }
      #cues span { background: rgba(0,0,0,.75); padding: .1em .4em; white-space: pre-line; box-decoration-break: clone; }
      #stage.black > video { visibility: hidden; }`;
    d.head.append(style);
    const stage = d.createElement('div'); stage.id = 'stage';
    const video = d.createElement('video');
    video.muted = true;            // sound comes only from the original element
    video.autoplay = true;
    video.playsInline = true;
    const captions = d.createElement('div'); captions.id = 'captions';
    const cues = d.createElement('div'); cues.id = 'cues';
    stage.append(video, captions, cues);
    d.body.append(stage);
    return { doc: d, stage, video, captions, cues };
  }

  function bindVideoEvents(video) {
    const recapture = () => {
      if (!session) return;
      const s = captureOrExplain(video);
      if (!s) { stopTv({ reason: 'capture lost' }); return; }
      session.tv.video.srcObject = s;
      session.tv.video.play().catch(() => {});
      session.tv.stage.classList.remove('black');
      if (isYouTube) document.dispatchEvent(new CustomEvent('tab2tv:quality', { detail: 'max' }));
    };
    const onEnded = () => {
      if (settings.onEnded === 'return') stopTv({ reason: 'ended' });
      else if (settings.onEnded === 'black') session?.tv.stage.classList.add('black');
    };
    // A new source on the same element (e.g. next YouTube video) ends the captured tracks.
    video.addEventListener('loadeddata', recapture);
    video.addEventListener('ended', onEnded);
    session.cleanups.push(() => {
      video.removeEventListener('loadeddata', recapture);
      video.removeEventListener('ended', onEnded);
    });
  }

  function rebind(video) {
    log('rebinding to new video element');
    for (const fn of session.cleanups.splice(0)) fn();
    restorePageMode();
    session.captions?.stop();
    session.video = video;
    session.tv.video.srcObject = captureOrExplain(video);
    applyPageMode();
    bindVideoEvents(video);
    session.captions = startCaptionMirror(video);
  }

  function stopTv({ reason, pause = false } = {}) {
    if (!session) return;
    log('stop:', reason);
    const s = session;
    session = null;
    clearTimeout(s.backgroundTimer);
    for (const fn of s.cleanups) fn();
    s.captions?.stop();
    if (pause) s.video.pause();
    restorePageMode(s);
    if (isYouTube) document.dispatchEvent(new CustomEvent('tab2tv:quality', { detail: 'auto' }));
    if (!s.popup.closed) s.popup.close();
    if (alive()) chrome.runtime.sendMessage({ type: 'stopped' }).catch(() => {});
  }

  addEventListener('pagehide', () => stopTv({ reason: 'page hidden' }));

  // How good this frame's best video is as the target of a manual start (0 = none).
  function candidateScore() {
    const v = pickMainVideo();
    if (!v) return 0;
    const reallyPlaying = !v.paused && v.readyState >= 3;   // not just "play requested"
    const audible = !v.muted && v.volume > 0;
    return videoArea(v) * (reallyPlaying ? 2 : 1) * (audible ? 1.5 : 1) * (v === lastInteractedVideo ? 3 : 1);
  }
  // Called by the service worker's probe (chrome.scripting.executeScript runs in this isolated world).
  globalThis.tab2tvCandidateScore = candidateScore;
  // Diagnostics for tools/scan-sites.mjs: every video of this frame and why automatic output
  // would ignore it (reason null = it would be sent to the TV when started by the user).
  globalThis.tab2tvDebugVideos = () => [...document.querySelectorAll('video')].map(v => {
    const r = v.getBoundingClientRect();
    return { frame: location.hostname, site: siteHostname, src: (v.currentSrc || v.src).slice(0, 80),
      w: Math.round(r.width), h: Math.round(r.height), playing: !v.paused, muted: v.muted,
      duration: Number.isFinite(v.duration) ? Math.round(v.duration) : String(v.duration),
      reason: autoRejectReason(v) };
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'start') {
      startTv(pickMainVideo());
    } else if (msg.type === 'stop') {
      stopTv({ reason: 'stop requested' });
    } else if (msg.type === 'displayLost') {
      stopTv({ reason: 'display lost', pause: true });
    } else if (msg.type === 'popupClosed') {
      stopTv({ reason: 'popup window removed' });
    } else if (msg.type === 'background') {
      // Another tab owns the TV now; free this TV window unless the user comes back in time.
      // The timer lives here, not in the service worker, which may be suspended meanwhile.
      if (!session) return;
      clearTimeout(session.backgroundTimer);
      session.backgroundTimer = setTimeout(
        () => stopTv({ reason: 'background timeout' }), settings.backgroundCloseSec * 1000);
    } else if (msg.type === 'foreground') {
      if (session) clearTimeout(session.backgroundTimer);
    }
  });

  // ---------------------------------------------------------------------------
  // Page side: placeholder or parallel hint

  let pageStyle = null;
  function ensurePageStyle() {
    if (pageStyle) return;
    pageStyle = document.createElement('style');
    pageStyle.textContent = `
      video[data-tab2tv-hidden] { opacity: 0 !important; }
      .tab2tv-placeholder { position: absolute; z-index: 2147483000; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 12px; background: #111; color: #ddd;
        font: 15px/1.4 system-ui, sans-serif; pointer-events: none; box-sizing: border-box; }
      .tab2tv-placeholder.parallel { background: none; justify-content: flex-start; align-items: flex-end; padding: 10px; }
      .tab2tv-placeholder button { pointer-events: auto; font: inherit; color: #fff; background: #2e7d32;
        border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
      .tab2tv-placeholder.parallel .tab2tv-label { display: none; }
      .tab2tv-placeholder.parallel button { background: rgba(0,0,0,.6); }`;
    (document.head || document.documentElement).append(pageStyle);
  }

  function applyPageMode() {
    ensurePageStyle();
    const v = session.video;
    if (!settings.parallel) v.setAttribute('data-tab2tv-hidden', '');
    const ph = document.createElement('div');
    ph.className = 'tab2tv-placeholder' + (settings.parallel ? ' parallel' : '');
    const label = document.createElement('div');
    label.className = 'tab2tv-label';
    label.textContent = 'Wird auf TV wiedergegeben';
    const btn = document.createElement('button');
    btn.textContent = 'Zurückholen';
    btn.addEventListener('click', e => { e.stopPropagation(); stopTv({ reason: 'button' }); });
    ph.append(label, btn);
    v.after(ph);
    // Keep the placeholder exactly over the video without touching page layout.
    const sync = () => {
      ph.style.left = v.offsetLeft + 'px';
      ph.style.top = v.offsetTop + 'px';
      ph.style.width = v.offsetWidth + 'px';
      ph.style.height = v.offsetHeight + 'px';
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(v);
    const iv = setInterval(sync, 1000);
    session.placeholder = { ph, stop: () => { ro.disconnect(); clearInterval(iv); ph.remove(); } };
  }

  function restorePageMode(s = session) {
    if (!s) return;
    s.video.removeAttribute('data-tab2tv-hidden');
    s.placeholder?.stop();
    s.placeholder = null;
  }

  // ---------------------------------------------------------------------------
  // Captions: YouTube renders captions as DOM overlays; native <track> cues are rendered by us.

  function startCaptionMirror(video) {
    const { captions, cues, doc } = session.tv;
    const stops = [];

    const player = isYouTube && video.closest('.html5-video-player');
    if (player) {
      copyCaptionCss(doc);
      const render = () => {
        const src = player.querySelector('.ytp-caption-window-container');
        captions.replaceChildren(...(src ? [doc.importNode(src, true)] : []));
        // Scale the player-sized caption layer to the popup's video box.
        const pw = player.clientWidth, ph = player.clientHeight;
        const W = doc.defaultView.innerWidth, H = doc.defaultView.innerHeight;
        const k = Math.min(W / pw, H / ph);
        captions.style.width = pw + 'px';
        captions.style.height = ph + 'px';
        captions.style.transform = `translate(${(W - pw * k) / 2}px, ${(H - ph * k) / 2}px) scale(${k})`;
      };
      const SEL = '.ytp-caption-window-container';
      const touchesCaptions = n => n.nodeType === 1
        ? !!(n.closest(SEL) || n.querySelector(SEL))
        : !!n.parentElement?.closest(SEL);
      let queued = false;
      const mo = new MutationObserver(muts => {
        if (queued || !muts.some(m => touchesCaptions(m.target)
          || [...m.addedNodes, ...m.removedNodes].some(touchesCaptions))) return;
        queued = true;
        // Not requestAnimationFrame: it does not run while the tab is hidden.
        setTimeout(() => { queued = false; render(); }, 0);
      });
      mo.observe(player, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
      render();
      stops.push(() => mo.disconnect());
    }

    const onCue = () => {
      const lines = [];
      for (const t of video.textTracks) {
        if (t.mode !== 'showing' || !t.activeCues) continue;
        for (const c of t.activeCues) if (c.text) lines.push(c.text.replace(/<[^>]+>/g, ''));
      }
      cues.replaceChildren(...lines.map(l => { const s = doc.createElement('span'); s.textContent = l; return s; }));
    };
    for (const t of video.textTracks) t.addEventListener('cuechange', onCue);
    stops.push(() => { for (const t of video.textTracks) t.removeEventListener('cuechange', onCue); });

    return { stop: () => { stops.forEach(f => f()); captions.replaceChildren(); cues.replaceChildren(); } };
  }

  function copyCaptionCss(doc) {
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; } // cross-origin sheet
      for (const r of list) if (r.selectorText && /caption/.test(r.selectorText)) rules.push(r.cssText);
    }
    const st = doc.createElement('style');
    st.textContent = rules.join('\n');
    doc.head.append(st);
  }

  // ---------------------------------------------------------------------------
  // Toast (shadow DOM, DOM APIs only because of Trusted Types on some sites)

  let toastHost = null;
  function toast(text, buttons = [], ms = 6000) {
    toastHost?.remove();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = `.t{max-width:360px;background:#1f1f1f;color:#eee;font:14px/1.4 system-ui,sans-serif;
      padding:12px 14px;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:10px}
      .b{display:flex;gap:8px;justify-content:flex-end} button{font:inherit;border:0;border-radius:6px;padding:5px 12px;cursor:pointer}
      .p{background:#2e7d32;color:#fff} .s{background:#444;color:#eee}`;
    const box = document.createElement('div'); box.className = 't';
    const p = document.createElement('div'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'b';
    const close = () => host.remove();
    for (const b of buttons) {
      const el = document.createElement('button'); el.className = 'p'; el.textContent = b.label;
      el.addEventListener('click', () => { close(); b.action(); });
      row.append(el);
    }
    const x = document.createElement('button'); x.className = 's'; x.textContent = buttons.length ? 'Nein' : 'OK';
    x.addEventListener('click', close);
    row.append(x);
    box.append(p, row);
    root.append(st, box);
    document.documentElement.append(host);
    toastHost = host;
    setTimeout(close, ms);
  }
})();
