/* ============================================================
   jose_dev_  - interactions
   ============================================================ */

(function() {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ============================================================
     Smooth text decode
     - time based (not frame based) so speed is stable
     - each glyph: left-to-right stagger, short cycle of faint chars,
       then settles and briefly glows
     ============================================================ */
  const GLYPHS = '#%&@*+=-_:;<>[]{}()/\\|?!$';

  class TextDecode {
    constructor(el) {
      this.el = el;
      this.raf = null;
      this.tick = this.tick.bind(this);
    }

    /**
     * @param {string} text   target text
     * @param {object} o      { stagger, duration, hold }
     */
    to(text, o = {}) {
      const from = this.el.textContent;
      const stagger = o.stagger ?? 28;      // ms between glyph starts
      const duration = o.duration ?? 420;   // ms each glyph spends decoding
      const len = Math.max(from.length, text.length);

      this.chars = [];
      for (let i = 0; i < len; i++) {
        const to = text[i] ?? '';
        const start = i * stagger + Math.random() * stagger * 0.6;
        this.chars.push({
          from: from[i] ?? '',
          to,
          start,
          end: start + duration,
          glyph: '',
          nextSwap: 0,
        });
      }
      this.target = text;
      this.t0 = performance.now();
      cancelAnimationFrame(this.raf);
      return new Promise((res) => {
        this.done = res;
        this.raf = requestAnimationFrame(this.tick);
      });
    }

    tick(now) {
      const t = now - this.t0;
      let html = '';
      let word = '';
      let settled = 0;

      const flush = () => {
        if (word) html += `<span class="w">${word}</span>`;
        word = '';
      };

      for (const c of this.chars) {
        const isSpace = c.to === ' ' || (c.to === '' && c.from === ' ');
        if (isSpace) {
          // spaces never decode -> word boundaries stay stable
          settled++;
          flush();
          html += ' ';
          continue;
        }
        if (t >= c.end) {
          settled++;
          if (c.to) word += `<span class="g on">${esc(c.to)}</span>`;
        } else if (t >= c.start) {
          if (t >= c.nextSwap) {
            const p = (t - c.start) / (c.end - c.start);
            c.glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
            c.nextSwap = t + lerp(35, 110, ease.inOutSine(p));
          }
          word += `<span class="g dud">${esc(c.glyph)}</span>`;
        } else {
          // not started yet: already show a placeholder glyph so the
          // final word lengths (and line wrap) are fixed from frame one
          if (!c.glyph) c.glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          word += `<span class="g dud">${esc(c.glyph)}</span>`;
        }
      }
      flush();

      this.el.innerHTML = html;

      if (settled >= this.chars.length) {
        this.done && this.done();
      } else {
        this.raf = requestAnimationFrame(this.tick);
      }
    }
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- decode-on-view ---- */
  if (!reduceMotion) {
    const seen = new WeakSet();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e, k) => {
          if (!e.isIntersecting || seen.has(e.target)) return;
          seen.add(e.target);
          const el = e.target;
          const text = el.textContent;
          el.style.visibility = 'hidden';
          setTimeout(() => {
            el.style.visibility = '';
            el.textContent = '';
            new TextDecode(el).to(text, { stagger: 22, duration: 380 });
          }, k * 90);
        });
      },
      { threshold: 0.5 }
    );
    document.querySelectorAll('[data-scramble-on-view]').forEach((el) => io.observe(el));
  }

  /* ---- reveal on scroll (stagger children) ---- */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => {
    // children of lists / grids get an index for CSS stagger
    el.querySelectorAll('.timeline-item, .stack-col, .contact-list a').forEach((child, i) => {
      child.style.setProperty('--i', i);
    });
    revealObserver.observe(el);
  });

  /* ---- header shadow via sentinel ---- */
  const header = document.querySelector('.site-header');
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;';
  document.body.prepend(sentinel);
  new IntersectionObserver(
    ([entry]) => header.classList.toggle('scrolled', !entry.isIntersecting),
    { threshold: 0 }
  ).observe(sentinel);

  /* ---- active nav ---- */
  const navLinks = document.querySelectorAll('.nav-link');
  const navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
      });
    },
    { rootMargin: '-30% 0px -60% 0px' }
  );
  navLinks.forEach((a) => {
    const s = document.getElementById(a.getAttribute('href').slice(1));
    s && navObserver.observe(s);
  });

  /* ---- chapter focus ---- */
  const chapters = Array.from(document.querySelectorAll('main > section'));
  if (chapters.length) {
    const ratios = new Map(chapters.map((c) => [c, 0]));
    let active = null;
    const focusObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
        let best = null, br = 0;
        ratios.forEach((r, el) => { if (r > br) { br = r; best = el; } });
        if (!best) best = active || chapters[0];
        if (best === active) return;
        active = best;
        chapters.forEach((c) => c.classList.toggle('dimmed', c !== best));
      },
      { threshold: [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1] }
    );
    chapters.forEach((c) => focusObserver.observe(c));
  }

  /* ============================================================
     Hero: ASCII agent swarm that spells the title
     - deterministic: a pixel font defines the exact final frame
     - one agent per lit cell; each agent has a HOME cell and a TARGET cell
     - agents travel on the grid along A* paths (settled agents are
       obstacles, so late arrivals flow around the letters)
     - loop: form -> hold -> scatter home -> idle -> form ...
     ============================================================ */
  const asciiEl = document.getElementById('asciiArt');
  if (asciiEl) {
    // final frame: one agent per non-space character
    const ART = [
      '▄▄▄▄▄   ▄▄              ▄▄    ▄▄     ▄▄▄▄                                 ',
      ' ███    ██          ▀▀  ██    ██   ▄██▀▀██▄                    ██         ',
      ' ███    ████▄ ██ ██ ██  ██ ▄████   ███  ███ ▄████ ▄█▀█▄ ████▄ ▀██▀▀ ▄█▀▀▀ ',
      ' ███    ██ ██ ██ ██ ██  ██ ██ ██   ███▀▀███ ██ ██ ██▄█▀ ██ ██  ██   ▀███▄ ',
      '▄███▄   ████▀ ▀██▀█ ██▄ ██ ▀████   ███  ███ ▀████ ▀█▄▄▄ ██ ██  ██   ▄▄▄█▀ ',
      '                                               ██                         ',
      '                                             ▀▀▀                          ',
    ];
    const ART_W = Math.max(...ART.map((l) => l.trimEnd().length));   // ignore trailing spaces when centering
    const ART_H = ART.length;
    const COLS = 100;
    const ROWS = 30;
    const STATIC_PREVIEW = false;    // true = render only the final state (for checking the art)

    // ---- build target cells (and the glyph each agent shows when settled) ----
    function layoutArt() {
      const left = Math.floor((COLS - ART_W) / 2);
      const top = Math.floor((ROWS - ART_H) / 2);
      const cells = [], glyphs = [];
      ART.forEach((line, r) => {
        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          if (ch === ' ') continue;
          const x = left + c, y = top + r;
          if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
          cells.push(x + COLS * y);
          glyphs.push(ch);
        }
      });
      return { cells, glyphs };
    }

    const { cells: targets, glyphs: targetGlyph } = layoutArt();
    const N = targets.length;
    const isTarget = new Uint8Array(COLS * ROWS);
    targets.forEach((k) => (isTarget[k] = 1));

    // ---- agents ----
    const home = new Int32Array(N);
    const cell = new Int32Array(N);        // current cell
    const prev1 = new Int32Array(N), prev2 = new Int32Array(N);  // trail
    const path = new Array(N);             // remaining waypoints (cell indices)
    const progress = new Float32Array(N);  // fractional progress along current segment
    const speed = new Float32Array(N);     // cells per second
    const departAt = new Float32Array(N);
    const settled = new Uint8Array(COLS * ROWS);  // occupancy of arrived agents
    const arrived = new Uint8Array(N);
    const ghost = new Uint8Array(N);       // 1 = no route found, walks straight through others

    // homes: random cells outside the text, spread over the whole frame
    for (let i = 0; i < N; i++) {
      let k;
      do { k = (Math.random() * COLS * ROWS) | 0; } while (isTarget[k]);
      home[i] = k; cell[i] = k; prev1[i] = k; prev2[i] = k;
      speed[i] = 22 + Math.random() * 16;
      path[i] = null;
    }

    // ---- A* on the grid (8-neighbour) ----
    const gScore = new Float32Array(COLS * ROWS);
    const cameFrom = new Int32Array(COLS * ROWS);
    const closed = new Uint8Array(COLS * ROWS);
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4], [-1, 1, 1.4], [1, -1, 1.4], [-1, -1, 1.4]];

    function heur(a, b) {
      const ax = a % COLS, ay = (a / COLS) | 0, bx = b % COLS, by = (b / COLS) | 0;
      const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
      return Math.max(dx, dy) + 0.4 * Math.min(dx, dy);
    }

    function astar(start, goal, blocked) {
      if (start === goal) return [goal];
      gScore.fill(Infinity); closed.fill(0);
      gScore[start] = 0; cameFrom[start] = -1;
      // binary heap of [f, cell]
      const heap = [];
      const push = (f, c) => { heap.push([f, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break;[heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (; ;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break;[heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      push(heur(start, goal), start);
      let expanded = 0;
      while (heap.length && expanded < 6000) {
        const [, c] = pop();
        if (c === goal) {
          const out = [];
          for (let k = goal; k !== -1; k = cameFrom[k]) out.push(k);
          out.reverse(); out.shift();
          return out;
        }
        if (closed[c]) continue;
        closed[c] = 1; expanded++;
        const cx = c % COLS, cy = (c / COLS) | 0;
        for (const [dx, dy, w] of NB) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
          const n = nx + COLS * ny;
          if (closed[n] || (blocked && blocked[n] && n !== goal)) continue;
          const g = gScore[c] + w;
          if (g < gScore[n]) { gScore[n] = g; cameFrom[n] = c; push(g + heur(n, goal), n); }
        }
      }
      return null;
    }

    function straight(start, goal) {
      // fallback: Bresenham line
      let x0 = start % COLS, y0 = (start / COLS) | 0;
      const x1 = goal % COLS, y1 = (goal / COLS) | 0;
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy; const out = [];
      while (!(x0 === x1 && y0 === y1)) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
        out.push(x0 + COLS * y0);
      }
      return out;
    }

    // ---- phases ----
    const HOLD_MS = 9000, IDLE_MS = 5000, STAGGER_MS = 2600;
    let phase = 'idle';
    let phaseT0 = -IDLE_MS + 1200;    // start forming shortly after load
    let goalOf = null;                // Int32Array: current destination per agent
    let allDone = false;

    function beginTravel(t, toTargets) {
      goalOf = toTargets ? targets : home;
      settled.fill(0); arrived.fill(0); ghost.fill(0); allDone = false;
      for (let i = 0; i < N; i++) {
        path[i] = null; progress[i] = 0;
        // nearer agents leave first -> letters grow outward smoothly
        departAt[i] = t + Math.random() * STAGGER_MS + (toTargets ? heur(cell[i], goalOf[i]) * 8 : 0);
      }
    }

    function step(t, dt) {
      const el = t - phaseT0;
      if (phase === 'idle' && el > IDLE_MS) { phase = 'form'; phaseT0 = t; beginTravel(t, true); }
      else if (phase === 'form' && allDone) { phase = 'hold'; phaseT0 = t; }
      else if (phase === 'hold' && el > HOLD_MS) { phase = 'scatter'; phaseT0 = t; beginTravel(t, false); }
      else if (phase === 'scatter' && allDone) { phase = 'idle'; phaseT0 = t; }

      if (phase === 'form' || phase === 'scatter') {
        let done = 0;
        const useObstacles = phase === 'form';
        for (let i = 0; i < N; i++) {
          if (arrived[i]) { done++; continue; }
          if (t < departAt[i]) continue;
          if (!path[i]) {
            const g = goalOf[i];
            path[i] = useObstacles ? astar(cell[i], g, settled) : null;
            if (!path[i]) { path[i] = straight(cell[i], g); ghost[i] = 1; }
            if (!path[i].length) { arrived[i] = 1; settled[cell[i]] = 1; continue; }
          }
          progress[i] += speed[i] * dt / 1000;
          while (progress[i] >= 1 && path[i].length) {
            progress[i] -= 1;
            const next = path[i][0];
            if (useObstacles && !ghost[i] && settled[next] && next !== goalOf[i]) {
              // someone settled on our route -> re-plan (or give up and walk straight)
              const p = astar(cell[i], goalOf[i], settled);
              if (p) path[i] = p; else { path[i] = straight(cell[i], goalOf[i]); ghost[i] = 1; }
              break;
            }
            path[i].shift();
            prev2[i] = prev1[i]; prev1[i] = cell[i]; cell[i] = next;
          }
          if (!path[i].length && cell[i] === goalOf[i]) { arrived[i] = 1; settled[cell[i]] = 1; }
        }
        if (done === N) allDone = true;
      } else if (phase === 'idle') {
        // gentle twinkle: agents drift one cell around home and back
        for (let i = 0; i < N; i++) {
          if (Math.random() > 0.015) continue;
          const hx = home[i] % COLS, hy = (home[i] / COLS) | 0;
          const nx = Math.max(0, Math.min(COLS - 1, hx + ((Math.random() * 3) | 0) - 1));
          const ny = Math.max(0, Math.min(ROWS - 1, hy + ((Math.random() * 3) | 0) - 1));
          const k = nx + COLS * ny;
          if (isTarget[k]) continue;
          prev2[i] = prev1[i]; prev1[i] = cell[i]; cell[i] = k;
        }
      }
    }

    const grid = new Uint8Array(COLS * ROWS);
    const artAt = new Int32Array(COLS * ROWS);
    const GL = [' ', '.', ':', '*', '#', '@'];   // empty, old trail, trail, moving, settled, flash  (ASCII only: same width in the webfont)

    function render(t, dt) {
      step(t, dt);
      grid.fill(0);
      const moving = phase === 'form' || phase === 'scatter';
      for (let i = 0; i < N; i++) {
        if (moving && !arrived[i] && t >= departAt[i]) {
          if (grid[prev2[i]] < 1) grid[prev2[i]] = 1;
          if (grid[prev1[i]] < 2) grid[prev1[i]] = 2;
        }
      }
      artAt.fill(0);
      for (let i = 0; i < N; i++) {
        const c = cell[i];
        let g;
        if (phase === 'hold') g = 4;
        else if (phase === 'idle') g = 1;
        else g = arrived[i] ? 4 : (t >= departAt[i] ? 3 : 1);
        if (grid[c] < g) grid[c] = g;
        if (g === 4) artAt[c] = i + 1;   // settled agents draw their own glyph
      }
      let out = '';
      for (let y = 0; y < ROWS; y++) {
        let row = '';
        for (let x = 0; x < COLS; x++) {
          const k = x + COLS * y;
          row += grid[k] === 4 && artAt[k] ? targetGlyph[artAt[k] - 1] : GL[grid[k]];
        }
        out += row + '\n';
      }
      asciiEl.textContent = out;
    }

    if (reduceMotion || STATIC_PREVIEW) {
      // static: title spelled out
      for (let i = 0; i < N; i++) cell[i] = targets[i];
      phase = 'hold'; phaseT0 = 0; arrived.fill(1);
      render(0, 0);
    } else {
      let last = performance.now();
      const t0 = last;
      function loop(now) {
        const dt = Math.min(50, now - last);
        last = now;
        render(now - t0, dt);
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    }
  }

  /* ============================================================
     Background: sparse 2D agent swarm drifting across the page
     ============================================================ */
  const bgEl = document.getElementById('asciiBg');
  if (bgEl) {
    const CW = 8.8, CH = 15;
    let cols = 0, rows = 0;
    const NB = 110;
    const bx = new Float32Array(NB), by = new Float32Array(NB);
    const bvx = new Float32Array(NB), bvy = new Float32Array(NB);
    let grid = null;

    function measure() {
      cols = Math.ceil(window.innerWidth / CW) + 1;
      rows = Math.ceil(window.innerHeight / CH) + 1;
      grid = new Uint8Array(cols * rows);
    }
    measure();
    for (let i = 0; i < NB; i++) {
      bx[i] = Math.random() * cols; by[i] = Math.random() * rows;
      bvx[i] = (Math.random() - 0.5) * 6; bvy[i] = (Math.random() - 0.5) * 3;
    }
    // a wandering target the background flock follows
    let tx = cols / 2, ty = rows / 2;

    function stepBg(t, dt) {
      const s = dt / 1000, tt = t / 1000;
      tx = cols / 2 + Math.sin(tt * 0.11) * cols * 0.4;
      ty = rows / 2 + Math.cos(tt * 0.07) * rows * 0.35;
      for (let i = 0; i < NB; i++) {
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
        for (let j = 0; j < NB; j++) {
          if (i === j) continue;
          const dx = bx[j] - bx[i], dy = (by[j] - by[i]) * 2; // cells are ~2x tall
          const d2 = dx * dx + dy * dy;
          if (d2 > 14 * 14) continue;
          n++; cx += dx; cy += dy; ax += bvx[j]; ay += bvy[j];
          if (d2 < 4 * 4) { sx -= dx / (d2 + 0.1); sy -= dy / (d2 + 0.1); }
        }
        let fx = (tx - bx[i]) * 0.08, fy = (ty - by[i]) * 0.08;
        if (n) { fx += (cx / n) * 0.3 + (ax / n - bvx[i]) * 0.5 + sx * 3; fy += (cy / n) * 0.15 + (ay / n - bvy[i]) * 0.5 + sy * 1.5; }
        fx += (Math.random() - 0.5) * 2; fy += (Math.random() - 0.5) * 1;
        bvx[i] += fx * s; bvy[i] += fy * s;
        const sp = Math.hypot(bvx[i], bvy[i] * 2), MAX = 7;
        if (sp > MAX) { bvx[i] *= MAX / sp; bvy[i] *= MAX / sp; }
        bx[i] += bvx[i] * s; by[i] += bvy[i] * s;
        if (bx[i] < 0) bx[i] += cols; if (bx[i] >= cols) bx[i] -= cols;
        if (by[i] < 0) by[i] += rows; if (by[i] >= rows) by[i] -= rows;
      }
    }

    function paint(t, dt) {
      stepBg(t, dt);
      grid.fill(0);
      // agents + a short trailing tail in their direction of travel
      for (let i = 0; i < NB; i++) {
        const x = bx[i] | 0, y = by[i] | 0;
        if (y < 0 || y >= rows) continue;
        const tx1 = (bx[i] - Math.sign(bvx[i]) * 1.5) | 0;
        if (tx1 >= 0 && tx1 < cols) grid[tx1 + cols * y] = Math.max(grid[tx1 + cols * y], 1);
        if (x >= 0 && x < cols) grid[x + cols * y] = 2;
      }
      let out = '';
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = grid[x + cols * y];
          out += v === 2 ? '*' : v === 1 ? '.' : ' ';
        }
        out += '\n';
      }
      bgEl.textContent = out;
    }

    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(measure, 150); });

    if (reduceMotion) {
      for (let k = 0; k < 90; k++) stepBg(k * 33, 33);
      paint(3000, 0);
    } else {
      let last = performance.now();
      const s0 = last;
      (function bgLoop(now) {
        const dt = Math.min(60, now - last);
        if (dt >= 40) { paint(now - s0, dt); last = now; }
        requestAnimationFrame(bgLoop);
      })(last);
    }
  }
})();
