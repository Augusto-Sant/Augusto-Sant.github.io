/* ============================================================
   dither.js - vanilla port of Aceternity's DitherShader
   Renders a full-viewport ordered-dither (duotone) of an image
   into <canvas data-dither>, plus two slow background effects:
   - pixel clouds drifting across the bright sky of the photo
   - gentle scroll parallax
   Both are off under prefers-reduced-motion and paused while
   the tab is hidden.
   ============================================================ */

(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // 4x4 / 8x8 Bayer matrices for ordered dithering
  const BAYER_4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const BAYER_8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];

  function parseColor(color) {
    color = color.trim();
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16));
      }
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    const m = color.match(/rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/i);
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function ditherThresholdAt(mode, x, y, gridSize) {
    const size = gridSize <= 4 ? 4 : 8;
    const matrix = gridSize <= 4 ? BAYER_4 : BAYER_8;
    const scale = size === 4 ? 16 : 64;
    switch (mode) {
      case 'halftone': {
        const a = Math.PI / 4;
        const s = gridSize * 2;
        const rx = x * Math.cos(a) + y * Math.sin(a);
        const ry = -x * Math.sin(a) + y * Math.cos(a);
        return (Math.sin(rx / s) + Math.sin(ry / s) + 2) / 4;
      }
      case 'crosshatch': {
        const l1 = (x + y) % (gridSize * 2) < gridSize ? 1 : 0;
        const l2 = (x - y + gridSize * 4) % (gridSize * 2) < gridSize ? 1 : 0;
        return (l1 + l2) / 2;
      }
      case 'bayer':
      default: {
        const mx = Math.floor(x / gridSize) % size;
        const my = Math.floor(y / gridSize) % size;
        return matrix[my][mx] / scale;
      }
    }
  }

  /* ---------- value noise for the clouds ---------- */
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) {
    return (
      vnoise(x, y) * 0.55 +
      vnoise(x * 2.03, y * 2.03) * 0.3 +
      vnoise(x * 4.11, y * 4.11) * 0.15
    );
  }

  /* ---------- renderer ---------- */
  function createRenderer(canvas, img, opts) {
    const ctx = canvas.getContext('2d');
    const g = opts.gridSize;
    const dark = opts.invert ? opts.secondary : opts.primary;
    const light = opts.invert ? opts.primary : opts.secondary;

    let w = 0, h = 0, cols = 0, rows = 0;
    let baseLum = null;   // per cell, after brightness/contrast
    let thresh = null;    // per cell dither threshold
    let skyW = null;      // per cell: how much clouds show here (0..1)
    let skyRows = 0;      // cells rows that can contain clouds
    let skyIdx = null, state = null;    // indices of cells with skyW > 0 (the only ones clouds repaint)
    let out = null, out32 = null;
    let darkPx = 0, lightPx = 0;
    let ok = false;

    // cloud field is sampled on a coarse grid and looked up per cell
    const CLOUD_STEP = 4; // in cells
    let cloud = null, ccols = 0, crows = 0;

    function setup() {
      w = Math.max(1, Math.round(canvas.clientWidth));
      h = Math.max(1, Math.round(canvas.clientHeight));
      canvas.width = w;
      canvas.height = h;

      // object-fit: cover into an offscreen canvas, biased by focal point
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const offCtx = off.getContext('2d', { willReadFrequently: true });
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = Math.ceil(img.naturalWidth * s);
      const dh = Math.ceil(img.naturalHeight * s);
      const dx = Math.floor((w - dw) * opts.focusX);
      const dy = Math.floor((h - dh) * opts.focusY);
      offCtx.drawImage(img, dx, dy, dw, dh);

      let src;
      try {
        src = offCtx.getImageData(0, 0, w, h).data;
      } catch (err) {
        // Pixels are unreadable when the page is opened via file:// (the
        // image counts as cross-origin). Show the plain photo, toned down
        // by CSS, instead of nothing. Serve over http to get the dither.
        console.warn('dither: cannot read image pixels (open via http, not file://).', err);
        ctx.drawImage(img, dx, dy, dw, dh);
        canvas.classList.add('is-fallback', 'is-ready');
        ok = false;
        return false;
      }

      cols = Math.ceil(w / g);
      rows = Math.ceil(h / g);
      baseLum = new Float32Array(cols * rows);
      thresh = new Float32Array(cols * rows);
      skyW = new Float32Array(cols * rows);
      skyRows = 0;

      for (let cy = 0; cy < rows; cy++) {
        const y = cy * g;
        // vertical position inside the photo (0 top .. 1 bottom)
        const imgY = (y - dy) / dh;
        const vertical = 1 - smoothstep(opts.skyTop, opts.skyBottom, imgY);
        for (let cx = 0; cx < cols; cx++) {
          const x = cx * g;
          const i = (y * w + x) * 4;
          const k = cy * cols + cx;
          const r = clamp((src[i] - 128) * opts.contrast + 128 + opts.brightness * 255, 0, 255);
          const gg = clamp((src[i + 1] - 128) * opts.contrast + 128 + opts.brightness * 255, 0, 255);
          const b = clamp((src[i + 2] - 128) * opts.contrast + 128 + opts.brightness * 255, 0, 255);
          const lum = luminance(r, gg, b) / 255;
          baseLum[k] = lum;

          let t = ditherThresholdAt(opts.mode, x, y, g);
          thresh[k] = t * (1 - opts.threshold) + opts.threshold * 0.5;

          // clouds only over bright sky near the top of the photo
          const sw = vertical * smoothstep(0.62, 0.82, lum);
          skyW[k] = sw;
          if (sw > 0.001) skyRows = cy + 1;
        }
      }

      // A cloud can only darken a cell by skyW * density, so only cells that
      // are light now and within that margin of their threshold can flip.
      const idx = [];
      for (let k = 0; k < skyRows * cols; k++) {
        const margin = baseLum[k] - thresh[k];
        if (margin >= 0 && margin < skyW[k] * opts.cloudDensity) idx.push(k);
      }
      skyIdx = Int32Array.from(idx);
      state = new Uint8Array(cols * rows); // 1 = dark

      ccols = Math.ceil(cols / CLOUD_STEP) + 2;
      crows = Math.ceil(skyRows / CLOUD_STEP) + 2;
      cloud = new Float32Array(ccols * crows);

      out = ctx.createImageData(w, h);
      out32 = new Uint32Array(out.data.buffer);
      // pack colours once; ImageData is RGBA in memory order
      const pack = (c) => {
        const t = new Uint8ClampedArray([c[0], c[1], c[2], 255]);
        return new Uint32Array(t.buffer)[0];
      };
      darkPx = pack(dark);
      lightPx = pack(light);
      ok = true;
      return true;
    }

    function updateClouds(time) {
      // drift right-to-left; slightly stretched horizontally
      const scale = opts.cloudScale / CLOUD_STEP;
      const ox = time * opts.cloudSpeed;
      for (let j = 0; j < crows; j++) {
        for (let i = 0; i < ccols; i++) {
          const n = fbm(i / scale + ox, (j / scale) * 1.7 + 11.3);
          cloud[j * ccols + i] = smoothstep(0.48, 0.78, n);
        }
      }
    }

    function cloudAt(cx, cy) {
      const fx = cx / CLOUD_STEP, fy = cy / CLOUD_STEP;
      const i = fx | 0, j = fy | 0;
      const u = fx - i, v = fy - j;
      const a = cloud[j * ccols + i], b = cloud[j * ccols + i + 1];
      const c = cloud[(j + 1) * ccols + i], d = cloud[(j + 1) * ccols + i + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    function fillCell(k, colour) {
      const cy = (k / cols) | 0, cx = k - cy * cols;
      const x = cx * g, y = cy * g;
      const xEnd = Math.min(x + g, w), yEnd = Math.min(y + g, h);
      for (let yy = y; yy < yEnd; yy++) {
        const row = yy * w;
        for (let xx = x; xx < xEnd; xx++) out32[row + xx] = colour;
      }
    }

    function cellColour(k, cx, cy, withClouds) {
      let lum = baseLum[k];
      if (withClouds && skyW[k] > 0.001) {
        lum -= cloudAt(cx, cy) * skyW[k] * opts.cloudDensity;
      }
      return lum < thresh[k] ? darkPx : lightPx;
    }

    // full repaint (on load / resize)
    function paintAll(withClouds) {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const k = cy * cols + cx;
          const c = cellColour(k, cx, cy, withClouds);
          state[k] = c === darkPx ? 1 : 0;
          fillCell(k, c);
        }
      }
      ctx.putImageData(out, 0, 0);
    }

    // cloud frame: only sky cells change
    function paintSky() {
      const dens = opts.cloudDensity;
      let minY = rows, maxY = -1;
      for (let n = 0; n < skyIdx.length; n++) {
        const k = skyIdx[n];
        const cy = (k / cols) | 0;
        const isDark = baseLum[k] - cloudAt(k - cy * cols, cy) * skyW[k] * dens < thresh[k] ? 1 : 0;
        if (isDark === state[k]) continue;
        state[k] = isDark;
        fillCell(k, isDark ? darkPx : lightPx);
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      if (maxY < 0) return;
      const y0 = minY * g;
      ctx.putImageData(out, 0, 0, 0, y0, w, Math.min((maxY + 1) * g, h) - y0);
    }

    return {
      get ok() { return ok; },
      resize(time, animate) {
        if (!setup()) return;
        if (animate) updateClouds(time);
        paintAll(animate);
        canvas.classList.add('is-ready');
      },
      frame(time) {
        if (!ok || skyIdx.length === 0) return;
        updateClouds(time);
        paintSky();
      },
    };
  }

  function init(canvas) {
    const d = canvas.dataset;
    const num = (v, fallback) => (v === undefined ? fallback : +v);
    const opts = {
      gridSize: num(d.gridSize, 2),
      mode: d.mode || 'bayer',
      primary: parseColor(d.primary || '#000000'),
      secondary: parseColor(d.secondary || '#ffffff'),
      threshold: num(d.threshold, 0.5),
      brightness: num(d.brightness, 0),
      contrast: num(d.contrast, 1),
      invert: d.invert === 'true',
      focusX: num(d.focusX, 0.5),
      focusY: num(d.focusY, 0.5),
      // clouds
      skyTop: num(d.skyTop, 0.3),        // photo y where clouds start fading
      skyBottom: num(d.skyBottom, 0.48), // photo y where clouds are gone
      cloudScale: num(d.cloudScale, 60), // cloud size, in cells
      cloudSpeed: num(d.cloudSpeed, 0.025), // noise units per second
      cloudDensity: num(d.cloudDensity, 0.4),
      fps: num(d.fps, 12),
      parallax: num(d.parallax, 0.2),    // fraction of viewport height
    };

    const img = new Image();
    img.decoding = 'async';
    img.src = d.src;

    let renderer = null;
    let lastW = 0, lastH = 0, timer = 0;
    let raf = 0, lastFrame = 0;
    const t0 = performance.now();
    const now = () => (performance.now() - t0) / 1000;
    const animated = () => !reduceMotion.matches;

    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      // ignore small height jitter (mobile URL bar show/hide)
      if (w === lastW && Math.abs(h - lastH) < 120) return;
      lastW = w;
      lastH = h;
      renderer.resize(now(), animated());
    }

    /* ---- clouds loop, throttled to opts.fps ---- */
    function loop(ts) {
      raf = requestAnimationFrame(loop);
      if (ts - lastFrame < 1000 / opts.fps) return;
      lastFrame = ts;
      renderer.frame(now());
    }
    function start() {
      if (!raf && animated() && !document.hidden && renderer && renderer.ok) {
        raf = requestAnimationFrame(loop);
      }
    }
    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    /* ---- parallax: background moves a fraction of the page scroll ---- */
    let ticking = false;
    function applyParallax() {
      ticking = false;
      if (!animated()) {
        canvas.style.transform = '';
        return;
      }
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? clamp(scrollY / max, 0, 1) : 0;
      const shift = p * opts.parallax * innerHeight;
      canvas.style.transform = `translate3d(0, ${-shift.toFixed(1)}px, 0)`;
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(applyParallax);
      }
    }

    img.onload = () => {
      renderer = createRenderer(canvas, img, opts);
      draw();
      start();
      applyParallax();

      new ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          draw();
          applyParallax();
        }, 150);
      }).observe(canvas);

      addEventListener('scroll', onScroll, { passive: true });
      document.addEventListener('visibilitychange', () =>
        document.hidden ? stop() : start()
      );
      reduceMotion.addEventListener('change', () => {
        lastW = 0; // force repaint with/without clouds
        draw();
        applyParallax();
        animated() ? start() : stop();
      });
    };
    img.onerror = () => console.error('dither: failed to load', d.src);
  }

  document.querySelectorAll('canvas[data-dither]').forEach(init);

  /* ============================================================
     Project thumbnails
     <canvas data-thumb> sits on top of a colour <img>. At rest the
     canvas shows an ink-on-paper dither of the image; on hover/focus
     a cloud-shaped noise mask grows and clears the canvas cell by
     cell, revealing the colour image underneath. Reverses on leave.
     ============================================================ */
  function initThumb(canvas) {
    const d = canvas.dataset;
    const wrap = canvas.parentElement;
    const card = canvas.closest('.project') || wrap;
    const img = wrap.querySelector('img');
    if (!img) return;

    const num = (v, fallback) => (v === undefined ? fallback : +v);
    const opts = {
      gridSize: num(d.gridSize, 2),
      ink: parseColor(d.ink || '#0b0b0b'),
      paper: parseColor(d.paper || '#fafaf8'),
      threshold: num(d.threshold, 0.2),  // low = wider tonal range, more dots
      contrast: num(d.contrast, 1.1),
      levels: d.levels === 'auto',       // stretch 2nd..98th percentile
      invert: d.invert || 'auto',        // 'auto' | 'true' | 'false'
      cloudScale: num(d.cloudScale, 16), // cloud size in cells
      duration: num(d.duration, 1600),   // ms
      rim: 0.06,                         // width of the paper-coloured cloud edge
      grain: num(d.grain, 0.22),         // per-cell randomness of the cloud edge
    };

    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, cols = 0, rows = 0;
    let dark = null, mask = null, out = null, out32 = null;
    let order = null, sortedMask = null; // cells sorted by mask value
    let lastReveal = null;
    let inkPx = 0, paperPx = 0;
    let ready = false;

    // animation state: p is linear progress 0 (dither) .. 1 (colour)
    let p = 0, target = 0, raf = 0, last = 0;

    const pack = (c) =>
      new Uint32Array(new Uint8ClampedArray([c[0], c[1], c[2], 255]).buffer)[0];

    function setup() {
      w = Math.max(1, Math.round(canvas.clientWidth));
      h = Math.max(1, Math.round(canvas.clientHeight));
      canvas.width = w;
      canvas.height = h;

      // object-fit: cover, same as the <img> underneath
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const offCtx = off.getContext('2d', { willReadFrequently: true });
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      offCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

      let src;
      try {
        src = offCtx.getImageData(0, 0, w, h).data;
      } catch (err) {
        // file:// - pixels unreadable; CSS shows a greyscale <img> instead
        wrap.classList.add('is-fallback');
        return false;
      }

      const g = opts.gridSize;
      cols = Math.ceil(w / g);
      rows = Math.ceil(h / g);
      const n = cols * rows;
      const lum = new Float32Array(n);
      let sum = 0;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = (cy * g * w + cx * g) * 4;
          const l = luminance(src[i], src[i + 1], src[i + 2]) / 255;
          lum[cy * cols + cx] = l;
          sum += l;
        }
      }

      // optional auto-levels: stretch the 2nd..98th percentile to 0..1.
      // Off by default: flat UI screenshots would lose all mid-tones.
      let lo = 0, hi = 1;
      if (opts.levels) {
        const sorted = Float32Array.from(lum).sort();
        lo = sorted[Math.floor(n * 0.02)];
        hi = sorted[Math.floor(n * 0.98)];
      }
      const span = Math.max(0.05, hi - lo);
      // dark-themed screenshots would turn almost solid ink: flip them
      const invert =
        opts.invert === 'true' || (opts.invert === 'auto' && sum / n < 0.45);

      dark = new Uint8Array(n);
      mask = new Float32Array(n);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const k = cy * cols + cx;
          let l = clamp((lum[k] - lo) / span, 0, 1);
          if (invert) l = 1 - l;
          l = clamp((l - 0.5) * opts.contrast + 0.5, 0, 1);
          let t = ditherThresholdAt('bayer', cx * g, cy * g, g);
          t = t * (1 - opts.threshold) + opts.threshold * 0.5;
          dark[k] = l < t ? 1 : 0;
        }
      }
      order = new Uint32Array(n);
      sortedMask = new Float32Array(n);
      buildMask();

      out = ctx.createImageData(w, h);
      out32 = new Uint32Array(out.data.buffer);
      inkPx = pack(opts.ink);
      paperPx = pack(opts.paper);
      return true;
    }

    // Cloud mask: random-seeded fbm (new clouds every hover) mixed with a
    // little per-cell noise so the edges are ragged instead of blobby.
    function buildMask() {
      const n = cols * rows;
      const ox = Math.random() * 1000, oy = Math.random() * 1000;
      const sc = opts.cloudScale * (0.8 + Math.random() * 0.5);
      const stretch = 1 + Math.random() * 0.8;
      const grain = opts.grain;
      let mMin = Infinity, mMax = -Infinity;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const k = cy * cols + cx;
          const m =
            fbm(cx / sc + ox, (cy / sc) * stretch + oy) * (1 - grain) +
            Math.random() * grain;
          mask[k] = m;
          if (m < mMin) mMin = m;
          if (m > mMax) mMax = m;
        }
      }
      // normalise so the reveal spans the full 0..1 progress
      const mSpan = Math.max(1e-6, mMax - mMin);
      for (let k = 0; k < n; k++) mask[k] = (mask[k] - mMin) / mSpan;
      // sort cells by mask (bucket sort, O(n)) so a frame only touches the
      // band of cells whose state changes
      const B = 4096;
      const counts = new Uint32Array(B + 1);
      const bucket = new Uint16Array(n);
      for (let k = 0; k < n; k++) {
        const bi = Math.min(B - 1, (mask[k] * B) | 0);
        bucket[k] = bi;
        counts[bi + 1]++;
      }
      for (let i = 1; i <= B; i++) counts[i] += counts[i - 1];
      for (let k = 0; k < n; k++) order[counts[bucket[k]]++] = k;
      // buckets are coarse, so the boundary search uses the bucket floor
      for (let i = 0; i < n; i++) sortedMask[i] = bucket[order[i]] / B;
      lastReveal = null;
    }

    function paintCell(k, reveal) {
      const g = opts.gridSize;
      const m = mask[k];
      let c;
      if (m < reveal) c = 0; // transparent: the colour image shows
      else if (p > 0 && m < reveal + opts.rim) c = paperPx; // cloud edge
      else c = dark[k] ? inkPx : paperPx;
      const cy = (k / cols) | 0, cx = k - cy * cols;
      const x = cx * g, y = cy * g;
      const xEnd = Math.min(x + g, w), yEnd = Math.min(y + g, h);
      for (let yy = y; yy < yEnd; yy++) {
        const row = yy * w;
        for (let xx = x; xx < xEnd; xx++) out32[row + xx] = c;
      }
    }

    // first index in sortedMask with value >= v
    function lowerBound(v) {
      let lo = 0, hi = sortedMask.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedMask[mid] < v) lo = mid + 1; else hi = mid;
      }
      return lo;
    }

    function render() {
      // ease in-out, then widen so 0 hides nothing and 1 clears everything
      const e = p * p * (3 - 2 * p);
      const reveal = e * (1 + opts.rim * 2) - opts.rim;
      const n = order.length;
      if (lastReveal === null || p === 0 || p === 1) {
        // full repaint: first draw and at rest (clears the cloud edge)
        for (let k = 0; k < n; k++) paintCell(k, reveal);
      } else {
        // only cells whose mask lies between the old and new edge change
        const lo = Math.min(lastReveal, reveal);
        const hi = Math.max(lastReveal, reveal) + opts.rim;
        // sortedMask holds bucket floors: start one bucket early
        for (let i = lowerBound(lo - 1 / 4096); i < n && sortedMask[i] <= hi; i++) {
          paintCell(order[i], reveal);
        }
      }
      lastReveal = reveal;
      ctx.putImageData(out, 0, 0);
    }

    function tick(ts) {
      const dt = last ? ts - last : 16;
      last = ts;
      const step = dt / opts.duration;
      p = target > p ? Math.min(target, p + step) : Math.max(target, p - step);
      render();
      if (p !== target) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        last = 0;
        if (p === 0) scheduleNewClouds();
      }
    }

    // Back at rest the mask isn't visible, so draw the next hover's clouds
    // now, off the hover's critical path.
    function scheduleNewClouds() {
      const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 60));
      idle(() => {
        if (p === 0 && !raf) buildMask();
      });
    }

    function go(to) {
      target = to;
      if (!ready) return;
      if (reduceMotion.matches) {
        p = to;
        render();
        return;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function build() {
      ready = setup();
      if (ready) {
        render();
        wrap.classList.add('is-ready');
      }
    }

    card.addEventListener('pointerenter', () => go(1));
    card.addEventListener('pointerleave', () => go(0));
    card.addEventListener('focusin', () => go(1));
    card.addEventListener('focusout', () => go(0));

    const start = () => {
      build();
      let timer = 0, lastW = canvas.clientWidth;
      new ResizeObserver(() => {
        if (canvas.clientWidth === lastW) return;
        lastW = canvas.clientWidth;
        clearTimeout(timer);
        timer = setTimeout(build, 150);
      }).observe(canvas);
    };
    if (img.complete && img.naturalWidth) start();
    else img.addEventListener('load', start, { once: true });
  }

  document.querySelectorAll('canvas[data-thumb]').forEach(initThumb);


  /* ---- active nav link (no animation) ---- */
  const links = [...document.querySelectorAll('.nav a[href^="#"]')];
  const sections = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((a) =>
            a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id)
          );
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach((s) => io.observe(s));
  }
})();
