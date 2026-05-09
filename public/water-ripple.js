/**
 * Water Ripple Effect — ripples follow the mouse cursor like touching water
 * Only activates when hovering over a logo. Ripples spawn at cursor position.
 */
(function () {
  'use strict';

  /* ---------- config ---------- */
  const RIPPLE_SPEED   = 0.45;  // ring expansion speed (px/frame) — slow like real water
  const RIPPLE_FADE    = 0.006; // opacity decay per frame — rings persist longer
  const RIPPLE_MAX_R   = 0.50;  // max radius as fraction of min dimension
  const COLOR          = [0, 102, 166]; // brand blue
  const SPAWN_INTERVAL = 450;   // ms between spawns — spaced out like dripping water

  /* ---------- find logo images ---------- */
  function findLogos() {
    return Array.from(document.querySelectorAll('img')).filter(function (img) {
      var s = (img.src || '').toLowerCase();
      var a = (img.alt || '').toLowerCase();
      var c = (img.className || '').toLowerCase();
      return s.indexOf('logo') !== -1 || a.indexOf('logo') !== -1 ||
             a.indexOf('programs') !== -1 || c.indexOf('logo') !== -1;
    });
  }

  /* ---------- setup a single logo ---------- */
  function setupLogo(img) {
    if (img.__rippleDone) return;
    img.__rippleDone = true;

    function init() {
      var parent = img.parentElement;
      if (!parent) return;

      var cs = window.getComputedStyle(parent);
      if (cs.position === 'static') parent.style.position = 'relative';

      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;border-radius:inherit;';
      canvas.width  = img.offsetWidth  * window.devicePixelRatio;
      canvas.height = img.offsetHeight * window.devicePixelRatio;
      parent.appendChild(canvas);

      var ctx      = canvas.getContext('2d');
      var ripples  = [];
      var mx = 0, my = 0;           // mouse pos (CSS pixels, relative to logo)
      var isHover  = false;
      var animId   = null;
      var lastSpawn = 0;

      function resize() {
        var r = img.getBoundingClientRect();
        var pr = parent.getBoundingClientRect();
        canvas.style.width  = r.width  + 'px';
        canvas.style.height = r.height + 'px';
        canvas.style.top    = (r.top - pr.top) + 'px';
        canvas.style.left   = (r.left - pr.left) + 'px';
        canvas.width  = r.width  * window.devicePixelRatio;
        canvas.height = r.height * window.devicePixelRatio;
      }
      resize();

      function spawnRipple(x, y) {
        ripples.push({ x: x, y: y, r: 0, op: 0.35, lw: 1.4 });
      }

      function draw() {
        var w = canvas.width;
        var h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        var maxR = Math.min(w, h) * RIPPLE_MAX_R;

        for (var i = ripples.length - 1; i >= 0; i--) {
          var p = ripples[i];
          p.r  += RIPPLE_SPEED * window.devicePixelRatio;
          p.op -= RIPPLE_FADE;
          p.lw -= 0.012;

          if (p.op <= 0 || p.r > maxR) { ripples.splice(i, 1); continue; }

          // main ring
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',' + p.op.toFixed(3) + ')';
          ctx.lineWidth   = Math.max(0.5, p.lw);
          ctx.stroke();

          // faint inner echo
          if (p.r > 6) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',' + (p.op * 0.18).toFixed(3) + ')';
            ctx.lineWidth   = Math.max(0.3, p.lw * 0.35);
            ctx.stroke();
          }
        }

        if (isHover) {
          // very soft glow under cursor
          var grad = ctx.createRadialGradient(mx, my, 0, mx, my, maxR * 0.5);
          grad.addColorStop(0, 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',0.05)');
          grad.addColorStop(1, 'rgba(' + COLOR[0] + ',' + COLOR[1] + ',' + COLOR[2] + ',0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
        }

        if (isHover || ripples.length > 0) {
          animId = requestAnimationFrame(draw);
        } else {
          animId = null;
          ctx.clearRect(0, 0, w, h);
        }
      }

      function start() {
        if (!animId) animId = requestAnimationFrame(draw);
      }

      // ——— mouse events ———
      img.addEventListener('mouseenter', function () {
        isHover = true;
        start();
      });

      img.addEventListener('mousemove', function (e) {
        var r = img.getBoundingClientRect();
        mx = (e.clientX - r.left) * window.devicePixelRatio;
        my = (e.clientY - r.top ) * window.devicePixelRatio;

        var now = Date.now();
        if (now - lastSpawn > SPAWN_INTERVAL) {
          lastSpawn = now;
          spawnRipple(mx, my);
          start();
        }
      });

      img.addEventListener('mouseleave', function () {
        isHover = false;
      });

      window.addEventListener('resize', resize);
    }

    if (img.complete) {
      init();
    } else {
      img.addEventListener('load', init, { once: true });
    }
  }

  /* ---------- init ---------- */
  function run() {
    findLogos().forEach(setupLogo);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // Re-scan for dynamically added logos (SPA nav)
  setInterval(function () {
    findLogos().forEach(setupLogo);
  }, 2000);
})();
