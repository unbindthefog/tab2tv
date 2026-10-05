const $ = id => document.getElementById(id);

tab2tvLoadSettings().then(s => {
  $('autoEnabled').checked = s.autoEnabled;
  $('parallel').checked = s.parallel;
  $('minDurationSec').value = s.minDurationSec;
  $('minWidthPx').value = s.minWidthPx;
  $('onEnded').value = s.onEnded;
  $('disabledSites').value = s.disabledSites.join('\n');
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    autoEnabled: $('autoEnabled').checked,
    parallel: $('parallel').checked,
    minDurationSec: +$('minDurationSec').value,
    minWidthPx: +$('minWidthPx').value,
    onEnded: $('onEnded').value,
    disabledSites: $('disabledSites').value.split('\n').map(s => s.trim()).filter(Boolean),
  });
  $('saved').textContent = 'Gespeichert';
  setTimeout(() => { $('saved').textContent = ''; }, 1500);
});
