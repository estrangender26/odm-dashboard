/**
 * Water Ripple Effect — disturbs like water when hovering over logos
 * Applies to all <img> elements with "logo" in their src or alt text
 */
(function () {
  'use strict';

  /* ---------- config ---------- */
  const RIPPLE_COUNT = 6;       // how many rings at once
  const RIPPLE_SPEED = 1.8;     // expansion speed
  const RIPPLE_FADE = 0.018;    // opacity decay per frame
  const RIPPLE_MAX_R = 0.55;    // max radius as fraction of logo size
  const COLOR = [0, 102, 166];  // ripple color RGB (brand blue)

  /* ---------- find logo images ---------- */
  function findLogos() {
    return Array.from(document.querySelectorAll('img')).filter(function (img) {
      var src = (img.src || '').toLowerCase();
      var alt = (img.alt || '').toLowerCase();
      var cls = (img.className || '').toLowerCase();
      return src.indexOf('logo') !== -1 ||
             alt.indexOf('logo') !== -1 ||
             alt.indexOf('programs') !== -1 ||
             cls.indexOf('logo') !== -1;
    });
  }

  /* ---------- setup a single logo ---------- */
  function setupLogo(img) {
    // wait until image is loaded to get its size
    if (!img.complete) {
      img.addEventListener('load', function () { setupLogo(img); }, { once: true });
      return;
    }

    var parent = img.parentElement;
    if (!parent) return;

    // make parent positioned so canvas can overlay
    var parentStyle = window.getComputedStyle(parent);
    if (parentStyle.position === 'static') {
      parent.style.position = 'relative';
    }

    // create canvas overlay
    var canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = img.offsetTop + 'px';
    canvas.style.left = img.offsetLeft + 'px';
    canvas.style.width = img.offsetWidth + 'px';
    canvas.style.height = img.offsetHeight + 'px';
    canvas.style.pointerEvents = 'none'; // let clicks pass through
    canvas.style.zIndex = '10';
    canvas.style.borderRadius = window.getComputedStyle(img).borderRadius;
    canvas.width = img.offsetWidth * window.devicePixelRatio;
    canvas.height = img.offsetHeight * window.devicePixelRatio;
    parent.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var ripples = [];
    var isHovering = false;
    var animId = null;

    function spawnRipple() {
      ripples.push({
        r: 0,
        opacity: 0.45,
        lineWidth: 2.5,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      var w = img.offsetWidth;
      var h = img.offsetHeight;
      var cx = w / 2;
      var cy = h / 2;
      var maxR = Math.min(w, h) * RIPPLE_MAX_R;

      // update & draw each ripple
      for (var i = ripples.length - 1; i >= 0; i--) {
        var rip = ripples[i];
        rip.r += RIPPLE_SPEED;
        rip.opacity -= RIPPLE_FADE;
        rip.lineWidth -= 0.015;

        if (rip.opacity <= 0 || rip.r > maxR) {
          ripples.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, rip.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',' + rip.opacity.toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.5, rip.lineWidth);
        ctx.stroke();

        // subtle inner echo ring
        if (rip.r > 8) {
          ctx.beginPath();
          ctx.arc(cx, cy, rip.r * 0.65, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',' + (rip.opacity * 0.35).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.3, rip.lineWidth * 0.5);
          ctx.stroke();
        }
      }

      // subtle base glow when hovering
      if (isHovering) {
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.8);
        grad.addColorStop(0, 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',0.06)');
        grad.addColorStop(1, 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.restore();

      // continue or stop animation
      if (isHovering || ripples.length > 0) {
        animId = requestAnimationFrame(draw);
      } else {
        animId = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    function startAnim() {
      if (!animId) {
        animId = requestAnimationFrame(draw);
      }
    }

    // continuous spawner while hovering
    var spawnInterval = null;

    img.addEventListener('mouseenter', function () {
      isHovering = true;
      startAnim();
      // spawn ripples at intervals
      spawnRipple();
      spawnInterval = setInterval(function () {
        if (ripples.length < RIPPLE_COUNT) spawnRipple();
      }, 280);
    });

    img.addEventListener('mouseleave', function () {
      isHovering = false;
      if (spawnInterval) {
        clearInterval(spawnInterval);
        spawnInterval = null;
      }
    });

    // handle resize
    window.addEventListener('resize', function () {
      canvas.style.top = img.offsetTop + 'px';
      canvas.style.left = img.offsetLeft + 'px';
      canvas.style.width = img.offsetWidth + 'px';
      canvas.style.height = img.offsetHeight + 'px';
      canvas.width = img.offsetWidth * window.devicePixelRatio;
      canvas.height = img.offsetHeight * window.devicePixelRatio;
    });
  }

  /* ---------- init ---------- */
  function init() {
    var logos = findLogos();
    logos.forEach(setupLogo);
  }

  // run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // re-scan periodically for dynamically added logos (SPA navigation)
  setInterval(function () {
    var logos = findLogos();
    logos.forEach(function (img) {
      if (!img.__rippleSetup) {
        img.__rippleSetup = true;
        setupLogo(img);
      }
    });
  }, 2000);
})();
