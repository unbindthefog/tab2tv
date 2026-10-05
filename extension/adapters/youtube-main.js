// Runs in YouTube's main world: access to the player API that the isolated content script lacks.
// YouTube picks the quality from the (small) in-page player size, so force the best level while on TV.
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
