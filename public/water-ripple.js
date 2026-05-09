/**
 * True Image Water Ripple — the actual logo image distorts like water
 * Uses WebGL to displace image pixels with ripple waves that follow the cursor.
 */
(function () {
  'use strict';

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

  /* ---------- vertex shader ---------- */
  var VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  /* ---------- fragment shader ---------- */
  var FRAG = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_img;
    uniform vec2  u_res;
    uniform float u_time;

    // mouse trail: x,y,age for 12 points
    uniform vec4  u_m0;  uniform vec4  u_m1;
    uniform vec4  u_m2;  uniform vec4  u_m3;
    uniform vec4  u_m4;  uniform vec4  u_m5;
    uniform vec4  u_m6;  uniform vec4  u_m7;
    uniform vec4  u_m8;  uniform vec4  u_m9;
    uniform vec4  u_m10; uniform vec4  u_m11;

    float wave(vec2 uv, vec4 m) {
      if (m.z < 0.0) return 0.0;
      float age = m.z;
      float spd = 0.28;          // ripple propagation speed
      float r = age * spd;       // current radius
      float d = distance(uv, m.xy);
      float w = d - r;
      // sine wave packet that travels outward
      float amp = 0.012 * exp(-age * 0.35) * smoothstep(0.0, 0.06, r);
      // only show the leading/trailing wave edge
      float ring = exp(-w * w * 1800.0) * sin(w * 40.0);
      return amp * ring;
    }

    void main() {
      vec2 uv = v_uv;
      float dx = 0.0, dy = 0.0;

      dx += wave(uv, u_m0);  dy += wave(uv, u_m0);
      dx += wave(uv, u_m1);  dy += wave(uv, u_m1);
      dx += wave(uv, u_m2);  dy += wave(uv, u_m2);
      dx += wave(uv, u_m3);  dy += wave(uv, u_m3);
      dx += wave(uv, u_m4);  dy += wave(uv, u_m4);
      dx += wave(uv, u_m5);  dy += wave(uv, u_m5);
      dx += wave(uv, u_m6);  dy += wave(uv, u_m6);
      dx += wave(uv, u_m7);  dy += wave(uv, u_m7);
      dx += wave(uv, u_m8);  dy += wave(uv, u_m8);
      dx += wave(uv, u_m9);  dy += wave(uv, u_m9);
      dx += wave(uv, u_m10); dy += wave(uv, u_m10);
      dx += wave(uv, u_m11); dy += wave(uv, u_m11);

      // sample image with displaced UV
      vec4 col = texture2D(u_img, uv + vec2(dx, dy));
      gl_FragColor = col;
    }
  `;

  /* ---------- WebGL helpers ---------- */
  function makeShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function setupWebGL(canvas, img) {
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return null;

    var vs = makeShader(gl, gl.VERTEX_SHADER, VERT);
    var fs = makeShader(gl, gl.FRAGMENT_SHADER, FRAG);
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // fullscreen quad
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1,  -1,1,
      -1,1,   1,-1,   1,1
    ]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // upload image as texture
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    return {
      gl: gl,
      prog: prog,
      locs: {
        img:  gl.getUniformLocation(prog, 'u_img'),
        res:  gl.getUniformLocation(prog, 'u_res'),
        time: gl.getUniformLocation(prog, 'u_time'),
        m: [
          gl.getUniformLocation(prog, 'u_m0'),  gl.getUniformLocation(prog, 'u_m1'),
          gl.getUniformLocation(prog, 'u_m2'),  gl.getUniformLocation(prog, 'u_m3'),
          gl.getUniformLocation(prog, 'u_m4'),  gl.getUniformLocation(prog, 'u_m5'),
          gl.getUniformLocation(prog, 'u_m6'),  gl.getUniformLocation(prog, 'u_m7'),
          gl.getUniformLocation(prog, 'u_m8'),  gl.getUniformLocation(prog, 'u_m9'),
          gl.getUniformLocation(prog, 'u_m10'), gl.getUniformLocation(prog, 'u_m11'),
        ]
      }
    };
  }

  /* ---------- setup a single logo ---------- */
  function setupLogo(img) {
    if (img.__rippleDone) return;

    function init() {
      if (!img.complete || !img.naturalWidth) return;

      var parent = img.parentElement;
      if (!parent) return;

      // ensure parent is positioned
      var pcs = window.getComputedStyle(parent);
      if (pcs.position === 'static') parent.style.position = 'relative';

      // create canvas that overlays the image exactly
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;border-radius:inherit;';

      var w = img.offsetWidth;
      var h = img.offsetHeight;
      var dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      parent.appendChild(canvas);

      var webgl = setupWebGL(canvas, img);
      if (!webgl) { canvas.remove(); return; }
      var gl = webgl.gl;
      var locs = webgl.locs;

      // position canvas over image
      function position() {
        var r = img.getBoundingClientRect();
        var pr = parent.getBoundingClientRect();
        canvas.style.width  = r.width  + 'px';
        canvas.style.height = r.height + 'px';
        canvas.style.top    = (r.top - pr.top) + 'px';
        canvas.style.left   = (r.left - pr.left) + 'px';
        var cw = r.width  * dpr;
        var ch = r.height * dpr;
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width  = cw;
          canvas.height = ch;
          gl.viewport(0, 0, cw, ch);
        }
      }
      position();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1i(locs.img, 0);

      // mouse trail — circular buffer of 12 points
      var TRAIL = 12;
      var trail = [];
      var isHover = false;
      var t0 = performance.now();
      var animId = null;

      function spawn(mx, my) {
        trail.push({ x: mx, y: my, t: (performance.now() - t0) / 1000 });
        if (trail.length > TRAIL) trail.shift();
      }

      function draw() {
        var now = (performance.now() - t0) / 1000;
        position();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(locs.res, canvas.width, canvas.height);
        gl.uniform1f(locs.time, now);

        // upload trail to shader
        for (var i = 0; i < TRAIL; i++) {
          var pt = trail[trail.length - 1 - i];
          if (pt) {
            gl.uniform4f(locs.m[i], pt.x, pt.y, now - pt.t, 0.0);
          } else {
            gl.uniform4f(locs.m[i], 0.0, 0.0, -1.0, 0.0);
          }
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (isHover || trail.length > 0) {
          // keep animating until all ripples fade
          var alive = false;
          for (var j = 0; j < trail.length; j++) {
            if (now - trail[j].t < 6.0) { alive = true; break; }
          }
          if (alive) {
            animId = requestAnimationFrame(draw);
          } else {
            trail = [];
            animId = null;
          }
        } else {
          animId = null;
        }
      }

      function start() {
        if (!animId) animId = requestAnimationFrame(draw);
      }

      // mouse events — convert to UV coordinates [0,1]
      img.addEventListener('mouseenter', function () {
        isHover = true;
        start();
      });

      img.addEventListener('mousemove', function (e) {
        var r = img.getBoundingClientRect();
        var ux = (e.clientX - r.left) / r.width;
        var uy = 1.0 - (e.clientY - r.top) / r.height; // flip Y for GL
        spawn(ux, uy);
        start();
      });

      img.addEventListener('mouseleave', function () {
        isHover = false;
      });

      window.addEventListener('resize', function () {
        if (animId) position();
      });

      img.__rippleDone = true;
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

  setInterval(function () {
    findLogos().forEach(setupLogo);
  }, 2000);
})();
