/**
 * Real Water Ripple — 2D wave simulation with image refraction.
 * The logo image sits under a simulated water surface.
 * Moving the cursor disturbs the water; waves propagate outward.
 * The image is refracted by the wave slopes — it waves, not blurs.
 */
(function () {
  'use strict';

  /* ---------- config ---------- */
  var DAMPING  = 0.965;  // wave energy retention per frame (0.96-0.99)
  var REFRACT  = 0.40;   // refraction strength — how much the image bends
  var SHINE    = 0.35;   // specular highlight intensity
  var DROPSize = 3;      // cursor disturbance radius in grid cells
  var DROPStr  = 380;    // cursor disturbance strength

  /* ---------- find logos ---------- */
  function findLogos() {
    return Array.from(document.querySelectorAll('img')).filter(function (img) {
      var s = (img.src || '').toLowerCase();
      var a = (img.alt || '').toLowerCase();
      var c = (img.className || '').toLowerCase();
      return s.indexOf('logo') !== -1 || a.indexOf('logo') !== -1 ||
             a.indexOf('programs') !== -1 || c.indexOf('logo') !== -1;
    });
  }

  /* ---------- setup one logo ---------- */
  function setupLogo(img) {
    if (img.__waterDone) return;

    function ready() {
      if (!img.complete || !img.naturalWidth) return;

      var parent = img.parentElement;
      if (!parent) return;
      var pcs = window.getComputedStyle(parent);
      if (pcs.position === 'static') parent.style.position = 'relative';

      // canvas overlays the image exactly
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;border-radius:inherit;';
      parent.appendChild(canvas);

      // simulation grid size (lower = faster, higher = smoother)
      var GRID_W = 160;
      var GRID_H = 160;

      var w = img.offsetWidth;
      var h = img.offsetHeight;
      var dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width  = w * dpr;
      canvas.height = h * dpr;

      var ctx = canvas.getContext('2d', { alpha: false });

      // offscreen buffer with the logo image
      var offC = document.createElement('canvas');
      offC.width  = canvas.width;
      offC.height = canvas.height;
      var offCtx = offC.getContext('2d');
      offCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var imgData = offCtx.getImageData(0, 0, canvas.width, canvas.height);

      // water height fields: current and previous
      var buf0 = new Float32Array(GRID_W * GRID_H);
      var buf1 = new Float32Array(GRID_W * GRID_H);
      var temp;

      var isHover = false;
      var lastDrop = 0;

      function idx(x, y) {
        x = x < 0 ? 0 : x >= GRID_W ? GRID_W - 1 : x | 0;
        y = y < 0 ? 0 : y >= GRID_H ? GRID_H - 1 : y | 0;
        return y * GRID_W + x;
      }

      function disturb(x, y, strength, radius) {
        var ix = (x * GRID_W) | 0;
        var iy = ((1 - y) * GRID_H) | 0; // flip Y
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
              var i = idx(ix + dx, iy + dy);
              buf0[i] -= strength * (1 - (dx * dx + dy * dy) / (radius * radius + 1));
            }
          }
        }
      }

      // precompute grid-to-pixel mapping
      var pxPerGx = canvas.width  / GRID_W;
      var pxPerGy = canvas.height / GRID_H;

      // output buffer for direct pixel manipulation
      var outData = ctx.createImageData(canvas.width, canvas.height);
      var out32   = new Uint32Array(outData.data.buffer);
      var src32   = new Uint32Array(imgData.data.buffer);

      function render() {
        var gw = GRID_W, gh = GRID_H;
        var cpxW = canvas.width, cpxH = canvas.height;

        // wave propagation — classic 2D wave equation
        for (var gy = 1; gy < gh - 1; gy++) {
          var row = gy * gw;
          for (var gx = 1; gx < gw - 1; gx++) {
            var i = row + gx;
            // average of neighbors + velocity from previous state
            var val = (
              buf0[i - 1] + buf0[i + 1] +
              buf0[i - gw] + buf0[i + gw] +
              buf0[i - gw - 1] + buf0[i - gw + 1] +
              buf0[i + gw - 1] + buf0[i + gw + 1]
            ) * 0.125 - buf1[i];
            buf1[i] = val * DAMPING;
          }
        }

        // swap buffers
        temp = buf0; buf0 = buf1; buf1 = temp;

        // render: refract image through water surface
        for (var py = 0; py < cpxH; py++) {
          // grid Y coordinate
          var gyf = py / pxPerGy;
          var gy0 = gyf | 0;
          var gye = gy0 >= gh - 1 ? gh - 1 : gy0 + 1;
          var ty  = gyf - gy0;

          for (var px = 0; px < cpxW; px++) {
            var gxf = px / pxPerGx;
            var gx0 = gxf | 0;
            var gxe = gx0 >= gw - 1 ? gw - 1 : gx0 + 1;
            var tx  = gxf - gx0;

            // bilinear sample of height gradient
            var h00 = buf0[gy0  * gw + gx0];
            var h10 = buf0[gy0  * gw + gxe];
            var h01 = buf0[gye  * gw + gx0];
            var h11 = buf0[gye  * gw + gxe];

            // compute gradient (slope) — this is what refracts the image
            var gxGrad = (h10 - h00) * (1 - ty) + (h11 - h01) * ty;
            var gyGrad = (h01 - h00) * (1 - tx) + (h11 - h10) * tx;

            // height at this point (for specular)
            var height = h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) +
                         h01 * (1 - tx) * ty       + h11 * tx * ty;

            // refracted sample coordinates
            var sx = px + gxGrad * REFRACT * pxPerGx;
            var sy = py + gyGrad * REFRACT * pxPerGy;

            sx = sx < 0 ? 0 : sx >= cpxW - 1 ? cpxW - 1 : sx;
            sy = sy < 0 ? 0 : sy >= cpxH - 1 ? cpxH - 1 : sy;

            var si = ((sy | 0) * cpxW + (sx | 0));

            var pixel = src32[si];

            // specular highlight on wave peaks facing the light
            var spec = Math.max(0, height) * SHINE;
            if (spec > 0.01) {
              // add white highlight
              var b = (pixel      ) & 0xFF;
              var g = (pixel >>  8) & 0xFF;
              var r = (pixel >> 16) & 0xFF;
              var a = (pixel >> 24) & 0xFF;
              var boost = spec * 255;
              r = r + boost > 255 ? 255 : (r + boost) | 0;
              g = g + boost > 255 ? 255 : (g + boost) | 0;
              b = b + boost > 255 ? 255 : (b + boost) | 0;
              pixel = (a << 24) | (r << 16) | (g << 8) | b;
            }

            out32[py * cpxW + px] = pixel;
          }
        }

        ctx.putImageData(outData, 0, 0);
      }

      // position canvas over image
      function position() {
        var r  = img.getBoundingClientRect();
        var pr = parent.getBoundingClientRect();
        canvas.style.width  = r.width  + 'px';
        canvas.style.height = r.height + 'px';
        canvas.style.top    = (r.top  - pr.top ) + 'px';
        canvas.style.left   = (r.left - pr.left) + 'px';
      }
      position();

      // animation loop
      var animId = null;
      function frame() {
        render();
        // keep running while there are waves or hovering
        var energy = 0;
        for (var i = 0; i < buf0.length; i++) {
          energy += Math.abs(buf0[i]);
          if (energy > 10) break;
        }
        if (isHover || energy > 10) {
          animId = requestAnimationFrame(frame);
        } else {
          animId = null;
          // draw original image when still
          ctx.putImageData(imgData, 0, 0);
        }
      }

      function start() {
        if (!animId) animId = requestAnimationFrame(frame);
      }

      // mouse events — UV [0,1]
      img.addEventListener('mouseenter', function () {
        isHover = true;
        start();
      });

      img.addEventListener('mousemove', function (e) {
        var r = img.getBoundingClientRect();
        var ux = (e.clientX - r.left) / r.width;
        var uy = (e.clientY - r.top) / r.height;

        var now = Date.now();
        if (now - lastDrop > 40) { // max ~25 drops/sec
          lastDrop = now;
          disturb(ux, 1 - uy, DROPStr, DROPSize);
          start();
        }
      });

      img.addEventListener('mouseleave', function () {
        isHover = false;
      });

      window.addEventListener('resize', position);

      // initial render
      ctx.putImageData(imgData, 0, 0);

      img.__waterDone = true;
    }

    if (img.complete) ready();
    else img.addEventListener('load', ready, { once: true });
  }

  /* ---------- init ---------- */
  function run() { findLogos().forEach(setupLogo); }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', run);
  else
    run();

  // re-scan for SPA navigation
  setInterval(function () { findLogos().forEach(setupLogo); }, 2000);
})();
