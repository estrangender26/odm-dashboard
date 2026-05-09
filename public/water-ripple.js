/**
 * Water Ripple — force-sensitive, stops when mouse stops.
 * - Auto-ripples on page load
 * - Ripple strength depends on mouse velocity (force)
 * - All motion stops naturally when input ceases
 */
(function () {
  'use strict';

  /* config */
  var FRICTION   = 0.94;  // velocity decay per frame
  var REFRACT    = 0.18;  // how much the image bends with waves
  var WAVE_SPEED = 1.2;   // ripple propagation speed
  var MAX_R      = 0.55;  // max ripple radius (fraction of min dimension)

  function findLogos() {
    return Array.from(document.querySelectorAll('img')).filter(function (img) {
      var s = (img.src || '').toLowerCase();
      var a = (img.alt || '').toLowerCase();
      var c = (img.className || '').toLowerCase();
      return s.indexOf('logo') !== -1 || a.indexOf('logo') !== -1 ||
             a.indexOf('programs') !== -1 || c.indexOf('logo') !== -1;
    });
  }

  function setupLogo(img) {
    if (img.__wrd) return;

    function init() {
      if (!img.complete || !img.naturalWidth) return;
      var parent = img.parentElement;
      if (!parent) return;
      var pcs = window.getComputedStyle(parent);
      if (pcs.position === 'static') parent.style.position = 'relative';

      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;border-radius:inherit;';
      parent.appendChild(canvas);

      var w, h, dpr = Math.min(window.devicePixelRatio, 2);
      var ctx, imgBuf, src32;

      function size() {
        var r = img.getBoundingClientRect();
        var pr = parent.getBoundingClientRect();
        canvas.style.width  = r.width  + 'px';
        canvas.style.height = r.height + 'px';
        canvas.style.top    = (r.top - pr.top) + 'px';
        canvas.style.left   = (r.left - pr.left) + 'px';
        var nw = r.width  * dpr | 0;
        var nh = r.height * dpr | 0;
        if (nw < 2 || nh < 2) return false;
        if (canvas.width !== nw || canvas.height !== nh) {
          canvas.width = nw; canvas.height = nh;
          ctx = canvas.getContext('2d', { alpha: false });
          ctx.drawImage(img, 0, 0, nw, nh);
          imgBuf = ctx.getImageData(0, 0, nw, nh);
          src32 = new Uint32Array(imgBuf.data.buffer);
        }
        w = nw; h = nh;
        return true;
      }
      if (!size()) return;

      /* ---------- ripple physics ---------- */
      var ripples = [];          // each: {x, y, vx, vy, r, born, force}
      var waves = [];            // wave sample grid
      var GW = 80, GH = 80;      // grid resolution
      var grid = new Float32Array(GW * GH);
      var gridPrev = new Float32Array(GW * GH);
      var tmpGrid;

      function gIdx(gx, gy) {
        gx = gx < 0 ? 0 : gx >= GW ? GW - 1 : gx | 0;
        gy = gy < 0 ? 0 : gy >= GH ? GH - 1 : gy | 0;
        return gy * GW + gx;
      }

      // inject a ripple at (ux,uy) [0..1] with given force
      function drop(ux, uy, force) {
        force = force || 1;
        var px = ux * canvas.width;
        var py = uy * canvas.height;
        ripples.push({
          x: px, y: py,
          vx: 0, vy: 0,
          r: 0,
          born: performance.now(),
          force: Math.min(force, 3),
        });
      }

      // radial wave injection into the grid
      function injectWave(x, y, strength, radius) {
        var gx = (x / canvas.width  * GW) | 0;
        var gy = (y / canvas.height * GH) | 0;
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            var d2 = dx * dx + dy * dy;
            if (d2 <= radius * radius) {
              var i = gIdx(gx + dx, gy + dy);
              var falloff = 1 - d2 / (radius * radius + 0.01);
              grid[i] += strength * falloff * falloff;
            }
          }
        }
      }

      // simulate wave propagation one step
      function propagate() {
        for (var gy = 1; gy < GH - 1; gy++) {
          var row = gy * GW;
          for (var gx = 1; gx < GW - 1; gx++) {
            var i = row + gx;
            var avg = (
              grid[i - 1] + grid[i + 1] +
              grid[i - GW] + grid[i + GW] +
              grid[i - 1 - GW] + grid[i + 1 - GW] +
              grid[i - 1 + GW] + grid[i + 1 + GW]
            ) * 0.125;
            gridPrev[i] = avg * 2 - gridPrev[i];
            gridPrev[i] *= FRICTION;
          }
        }
        tmpGrid = grid; grid = gridPrev; gridPrev = tmpGrid;
      }

      // render: refract the image through the wave surface
      function renderFrame() {
        var outData = ctx.createImageData(w, h);
        var out32 = new Uint32Array(outData.data.buffer);
        var scaleX = GW / w;
        var scaleY = GH / h;

        // zero the grid if it's been too long since last activity
        var anyRipple = ripples.length > 0;
        var totalEnergy = 0;
        for (var i = 0; i < grid.length; i++) totalEnergy += Math.abs(grid[i]);

        if (!anyRipple && totalEnergy < 0.5) {
          // perfectly still — show original image
          out32.set(src32);
          ctx.putImageData(outData, 0, 0);
          return false; // signal stop
        }

        for (var py = 0; py < h; py++) {
          var gyf = py * scaleY;
          var gy0 = gyf | 0;
          var gye = gy0 >= GH - 1 ? GH - 1 : gy0 + 1;
          var ty  = gyf - gy0;

          for (var px = 0; px < w; px++) {
            var gxf = px * scaleX;
            var gx0 = gxf | 0;
            var gxe = gx0 >= GW - 1 ? GW - 1 : gx0 + 1;
            var tx  = gxf - gx0;

            // sample grid height
            var h00 = grid[gy0 * GW + gx0];
            var h10 = grid[gy0 * GW + gxe];
            var h01 = grid[gye * GW + gx0];
            var h11 = grid[gye * GW + gxe];

            // gradient = slope
            var gxG = (h10 - h00) * (1 - ty) + (h11 - h01) * ty;
            var gyG = (h01 - h00) * (1 - tx) + (h11 - h10) * tx;

            // height for specular
            var ht = h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) +
                     h01 * (1 - tx) * ty       + h11 * tx * ty;

            // refraction: sample image at displaced position
            var sx = px + gxG * REFRACT * 8;
            var sy = py + gyG * REFRACT * 8;
            sx = sx < 0 ? 0 : sx >= w - 1 ? w - 1 : sx;
            sy = sy < 0 ? 0 : sy >= h - 1 ? h - 1 : sy;

            var si = ((sy | 0) * w + (sx | 0));
            var pixel = src32[si];

            // specular on peaks
            if (ht > 2) {
              var boost = Math.min(ht * 12, 60);
              var b = (pixel      ) & 0xFF;
              var g = (pixel >>  8) & 0xFF;
              var r = (pixel >> 16) & 0xFF;
              var a = (pixel >> 24) & 0xFF;
              r = (r + boost) | 0; if (r > 255) r = 255;
              g = (g + boost) | 0; if (g > 255) g = 255;
              b = (b + boost) | 0; if (b > 255) b = 255;
              pixel = (a << 24) | (r << 16) | (g << 8) | b;
            }

            out32[py * w + px] = pixel;
          }
        }
        ctx.putImageData(outData, 0, 0);
        return true;
      }

      /* ---------- animation ---------- */
      var lastTime = 0;
      var animId = null;

      function tick(now) {
        var dt = now - lastTime;
        lastTime = now;

        // advance ripples
        for (var i = ripples.length - 1; i >= 0; i--) {
          var p = ripples[i];
          p.r += WAVE_SPEED;
          var maxR = Math.min(w, h) * MAX_R;
          var age = (now - p.born) / 1000;

          // inject ring into wave grid
          var rad = Math.max(2, p.r * 0.08 * p.force);
          var str = p.force * 6 * Math.exp(-age * 1.5);
          if (str > 0.3) injectWave(p.x, p.y, str, rad);

          if (p.r > maxR || str < 0.1) {
            ripples.splice(i, 1);
          }
        }

        propagate();
        var stillGoing = renderFrame();
        if (stillGoing) {
          animId = requestAnimationFrame(tick);
        } else {
          animId = null;
        }
      }

      function start() {
        if (!animId) {
          lastTime = performance.now();
          animId = requestAnimationFrame(tick);
        }
      }

      /* ---------- mouse tracking with force ---------- */
      var prevMX = 0, prevMY = 0, prevT = 0;

      img.addEventListener('mouseenter', function (e) {
        var r = img.getBoundingClientRect();
        prevMX = (e.clientX - r.left) / r.width;
        prevMY = (e.clientY - r.top) / r.height;
        prevT = performance.now();
      });

      img.addEventListener('mousemove', function (e) {
        var r = img.getBoundingClientRect();
        var ux = (e.clientX - r.left) / r.width;
        var uy = (e.clientY - r.top)  / r.height;
        var now = performance.now();
        var dt = now - prevT;
        if (dt < 5) return; // throttle

        // compute velocity = force
        var dx = ux - prevMX;
        var dy = uy - prevMY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var velocity = dist / (dt + 1) * 1000; // pixels per second in UV space
        var force = Math.min(velocity * 8, 2.5); // cap at 2.5

        if (force > 0.15) {
          drop(ux, uy, force);
          start();
        }

        prevMX = ux; prevMY = uy; prevT = now;
      });

      window.addEventListener('resize', function () { size(); });

      /* ---------- auto-ripple on load ---------- */
      // center ripple
      setTimeout(function () {
        drop(0.5, 0.5, 1.2);
        // a second smaller one offset
        setTimeout(function () { drop(0.55, 0.48, 0.7); start(); }, 180);
        start();
      }, 400);

      // initial draw
      ctx.putImageData(imgBuf, 0, 0);

      img.__wrd = true;
    }

    if (img.complete) init();
    else img.addEventListener('load', init, { once: true });
  }

  function run() { findLogos().forEach(setupLogo); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', run);
  else
    run();

  setInterval(function () { findLogos().forEach(setupLogo); }, 2000);
})();
