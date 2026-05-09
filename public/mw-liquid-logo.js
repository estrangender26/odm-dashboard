/**
 * mw-liquid-logo — animates SVG feTurbulence baseFrequency
 * Creates gentle flowing water distortion on the logo image.
 */
(function () {
  'use strict';

  // Insert SVG filter definitions once
  if (!document.getElementById('mw-liquid-defs')) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mw-liquid-logo-defs');
    svg.setAttribute('id', 'mw-liquid-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
      '<filter id="mw-logo-water-idle" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.003 0.006" numOctaves="2" seed="5" result="noise"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      '<filter id="mw-logo-water-active" x="-25%" y="-25%" width="150%" height="150%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="3" result="noise"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G"/>' +
        '<feGaussianBlur stdDeviation="0.2"/>' +
      '</filter>';
    document.body.appendChild(svg);
  }

  // Grab turbulence nodes
  var idleTurb, activeTurb;
  function getTurb() {
    if (idleTurb) return;
    var svgEl = document.getElementById('mw-liquid-defs');
    if (!svgEl) return;
    idleTurb  = svgEl.querySelector('#mw-logo-water-idle  feTurbulence');
    activeTurb = svgEl.querySelector('#mw-logo-water-active feTurbulence');
  }

  var logos = [];       // discovered logo elements
  var isAnyHover = false;
  var running = false;

  // Discover logos
  function scan() {
    var found = document.querySelectorAll('.mw-liquid-logo');
    found.forEach(function (el) {
      if (el.__mwLiquid) return;
      el.__mwLiquid = true;
      logos.push(el);
      // track hover state
      el.addEventListener('mouseenter', function () { isAnyHover = true; });
      el.addEventListener('mouseleave', function () {
        isAnyHover = logos.some(function (l) {
          return l.matches(':hover');
        });
      });
      // touch
      el.addEventListener('touchstart', function () { el.classList.add('mw-liquid-active'); }, { passive: true });
      el.addEventListener('touchend',   function () { setTimeout(function () { el.classList.remove('mw-liquid-active'); }, 800); });
    });
  }

  // Animate turbulence baseFrequency
  var t0 = performance.now();
  function tick(now) {
    getTurb();
    var t = (now - t0) * 0.001;

    // idle: barely perceptible drift
    if (idleTurb) {
      idleTurb.setAttribute('baseFrequency',
        (0.003 + Math.sin(t * 0.4) * 0.0006).toFixed(4) + ' ' +
        (0.006 + Math.cos(t * 0.35) * 0.0012).toFixed(4)
      );
    }

    // active: flowing water
    if (activeTurb) {
      var intensity = isAnyHover ? 1.0 : 0.25;
      activeTurb.setAttribute('baseFrequency',
        (0.006 + Math.sin(t * 0.9)  * 0.0025 * intensity).toFixed(4) + ' ' +
        (0.012 + Math.cos(t * 0.75) * 0.004  * intensity).toFixed(4)
      );
    }

    requestAnimationFrame(tick);
  }

  // Boot
  function boot() {
    scan();
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else
    boot();

  // SPA: re-scan periodically
  setInterval(scan, 2000);
})();
