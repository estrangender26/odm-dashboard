/**
 * mw-liquid-logo — builds sliced wave-band layers over each logo.
 * Reads the logo src, duplicates it into 5 clipped horizontal bands.
 */
(function () {
  'use strict';

  function process(el) {
    if (el.__mwLiquidReady) return;
    var img = el.querySelector('img');
    if (!img || !img.src) return;

    // create band container
    var bands = document.createElement('span');
    bands.className = 'logo-bands';
    bands.setAttribute('aria-hidden', 'true');

    // build 5 band slices, each with the logo as background
    for (var i = 0; i < 5; i++) {
      var band = document.createElement('span');
      band.className = 'band';
      band.style.backgroundImage = 'url("' + img.src + '")';
      bands.appendChild(band);
    }

    el.appendChild(bands);
    el.__mwLiquidReady = true;
  }

  function scan() {
    document.querySelectorAll('.mw-liquid-logo').forEach(process);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', scan);
  else
    scan();

  // re-scan for SPA navigation
  setInterval(scan, 2000);
})();
