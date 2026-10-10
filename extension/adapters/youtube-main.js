// Runs in YouTube's main world: access to the player API that the isolated content script lacks.
// YouTube picks the quality from the (small) in-page player size, so force the best level while on TV.
// May also be injected into an already open tab after an extension update: register only once.
// Wrapped so nothing lands in the page's global scope except the guard flag.
(() => {
  if (window.tab2tvQualityAdapter) return;
  window.tab2tvQualityAdapter = true;
  document.addEventListener('tab2tv:quality', e => {
    const player = document.getElementById('movie_player');
    if (!player?.getAvailableQualityLevels) return;
    if (e.detail === 'max') {
      const best = player.getAvailableQualityLevels()[0];
      if (best) player.setPlaybackQualityRange(best, best);
    } else {
      player.setPlaybackQualityRange('auto', 'auto');
    }
  });
})();
