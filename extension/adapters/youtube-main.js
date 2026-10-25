// Runs in YouTube's main world: access to the player API that the isolated content script lacks.
// YouTube picks the quality from the (small) in-page player size. While on TV, raise it to the best
// level up to the TV's height (detail: number of pixels); never lower it (that would rebuffer for
// nothing). detail 'auto' hands the choice back to YouTube.
// May also be injected into an already open tab after an extension update: register only once.
// Wrapped so nothing lands in the page's global scope except the guard flag.
(() => {
  if (window.tab2tvQualityAdapter) return;
  window.tab2tvQualityAdapter = true;
  document.addEventListener('tab2tv:quality', e => {
    const player = document.getElementById('movie_player');
    if (!player?.getAvailableQualityLevels) return;
    if (typeof e.detail === 'number') {
      const heights = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080,
        hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320 };
      // Levels come best first; 'auto' and unknown labels are skipped.
      const fit = player.getAvailableQualityLevels().find(q => heights[q] && heights[q] <= e.detail);
      // Pin the better of the fitting level and the current one: raises up to the TV's height,
      // never lowers, and keeps YouTube from dropping back to the small player's quality.
      const currentLabel = player.getPlaybackQuality?.();
      const pin = heights[currentLabel] >= (heights[fit] || 0) ? currentLabel : fit;
      if (pin) player.setPlaybackQualityRange(pin, pin);
    } else {
      player.setPlaybackQualityRange('auto', 'auto');
    }
  });
})();
