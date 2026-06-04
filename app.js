/* ============================================================
   jose_dev_  - interactions
   ============================================================ */

(function () {
   'use strict';

   const SCRAMBLE_CHARS = '!<>-_\\/[]{}=+*^?#________%&$@';

   class TextScramble {
      constructor(el) {
         this.el = el;
         this.chars = SCRAMBLE_CHARS;
         this.queue = [];
         this.frame = 0;
         this.frameRequest = null;
         this.resolve = null;
         this.update = this.update.bind(this);
      }

      setText(newText) {
         const oldText = this.el.innerText;
         const length = Math.max(oldText.length, newText.length);
         const promise = new Promise((resolve) => (this.resolve = resolve));
         this.queue = [];
         for (let i = 0; i < length; i++) {
            const from = oldText[i] || '';
            const to = newText[i] || '';
            const start = Math.floor(Math.random() * 40);
            const end = start + Math.floor(Math.random() * 40) + 15;
            this.queue.push({ from, to, start, end });
         }
         cancelAnimationFrame(this.frameRequest);
         this.frame = 0;
         this.update();
         return promise;
      }

      update() {
         let output = '';
         let complete = 0;
         for (let i = 0, n = this.queue.length; i < n; i++) {
            let { from, to, start, end, char } = this.queue[i];
            if (this.frame >= end) {
               complete++;
               output += to;
            } else if (this.frame >= start) {
               if (!char || Math.random() < 0.28) {
                  char = this.randomChar();
                  this.queue[i].char = char;
               }
               output += `<span class="dud">${char}</span>`;
            } else {
               output += from;
            }
         }
         this.el.innerHTML = output;
         if (complete === this.queue.length) {
            if (this.resolve) this.resolve();
         } else {
            this.frameRequest = requestAnimationFrame(this.update);
            this.frame++;
         }
      }

      randomChar() {
         return this.chars[Math.floor(Math.random() * this.chars.length)];
      }
   }

   /* ---- inject style for scramble dud chars ---- */
   const style = document.createElement('style');
   style.textContent = `.dud { color: var(--fg-faint); }`;
   document.head.appendChild(style);

   /* ---- on-load scramble ---- */
   document.querySelectorAll('[data-scramble]').forEach((el) => {
      const original = el.textContent;
      const delay = parseInt(el.dataset.scrambleDelay || '0', 10);
      const fx = new TextScramble(el);
      el.dataset.original = original;
      setTimeout(() => fx.setText(original), delay);
   });

   /* ---- on-view scramble (IntersectionObserver) ---- */
   const viewObserver = new IntersectionObserver(
      (entries) => {
         entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            if (el.dataset.scrambled === '1') return;
            el.dataset.scrambled = '1';
            const original = el.textContent;
            el.dataset.original = original;
            const fx = new TextScramble(el);
            fx.setText(original);
         });
      },
      { threshold: 0.4 }
   );
   document.querySelectorAll('[data-scramble-on-view]').forEach((el) => {
      viewObserver.observe(el);
   });

   /* ---- reveal on scroll ---- */
   const revealObserver = new IntersectionObserver(
      (entries) => {
         entries.forEach((entry) => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
         });
      },
      { threshold: 0.1 }
   );
   document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

   /* ---- header border via sentinel (no scroll listener) ---- */
   const header = document.querySelector('.site-header');
   const sentinel = document.createElement('div');
   sentinel.setAttribute('aria-hidden', 'true');
   sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;';
   document.body.prepend(sentinel);
   new IntersectionObserver(
      ([entry]) => header.classList.toggle('scrolled', !entry.isIntersecting),
      { threshold: 0 }
   ).observe(sentinel);

   /* ---- active nav based on scroll position ---- */
   const navLinks = document.querySelectorAll('.nav-link');
   const sections = Array.from(navLinks).map((a) => {
      const id = a.getAttribute('href').slice(1);
      return { link: a, section: document.getElementById(id) };
   });
   const navObserver = new IntersectionObserver(
      (entries) => {
         entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const id = entry.target.id;
            navLinks.forEach((a) => {
               a.classList.toggle('active', a.getAttribute('href') === '#' + id);
            });
         });
      },
      { rootMargin: '-30% 0px -60% 0px' }
   );
   sections.forEach(({ section }) => section && navObserver.observe(section));

   /* ---- chapter focus: keep only the most-visible section lit ---- */
   const chapters = Array.from(document.querySelectorAll('main > section'));
   if (chapters.length) {
      const ratios = new Map(chapters.map((c) => [c, 0]));
      let activeChapter = null;

      function updateFocus() {
         let best = null;
         let bestRatio = 0;
         ratios.forEach((ratio, el) => {
            if (ratio > bestRatio) {
               bestRatio = ratio;
               best = el;
            }
         });
         // keep the current one if nothing is meaningfully in view (e.g. between snaps)
         if (!best) best = activeChapter || chapters[0];
         if (best === activeChapter) return;
         activeChapter = best;
         chapters.forEach((c) => c.classList.toggle('dimmed', c !== best));
      }

      const focusObserver = new IntersectionObserver(
         (entries) => {
            entries.forEach((entry) => ratios.set(entry.target, entry.intersectionRatio));
            updateFocus();
         },
         { threshold: [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1] }
      );
      chapters.forEach((c) => focusObserver.observe(c));
   }

   /* ---- ASCII wave art (canvas-style ascii density map) ---- */
   const asciiEl = document.getElementById('asciiArt');
   if (asciiEl) {
      const COLS = 80;
      const ROWS = 32;
      const CHARSET = ' .·:-+*=%@#';
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      function render(t) {
         let out = '';
         for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
               const nx = x / COLS - 0.5;
               const ny = y / ROWS - 0.5;
               const r = Math.sqrt(nx * nx + ny * ny);
               // wave field with rotation over time
               const angle = Math.atan2(ny, nx);
               const v =
                  Math.sin(r * 14 - t * 0.0018) *
                  Math.cos(angle * 3 + t * 0.0009) *
                  (1 - r * 1.4);
               const idx = Math.max(
                  0,
                  Math.min(CHARSET.length - 1, Math.floor((v + 1) * 0.5 * CHARSET.length))
               );
               out += CHARSET[idx];
            }
            out += '\n';
         }
         asciiEl.textContent = out;
      }

      if (reduceMotion) {
         render(0);
      } else {
         const start = performance.now();
         function loop(now) {
            render(now - start);
            requestAnimationFrame(loop);
         }
         requestAnimationFrame(loop);
      }
   }

   /* ---- full-page subtle ascii background ---- */
   const bgEl = document.getElementById('asciiBg');
   if (bgEl) {
      const CHARS = ' ....::-=+*';
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let cols = 0;
      let rows = 0;

      function measure() {
         // derived from the .ascii-bg type metrics in the stylesheet
         const cw = 8.8;
         const ch = 15;
         cols = Math.ceil(window.innerWidth / cw) + 1;
         rows = Math.ceil(window.innerHeight / ch) + 1;
      }

      function paint(t) {
         let out = '';
         for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
               const v =
                  Math.sin(x * 0.18 + t * 0.00018) +
                  Math.sin(y * 0.26 - t * 0.00012) +
                  Math.sin((x + y) * 0.09 + t * 0.0001);
               const idx = Math.floor(((v + 3) / 6) * (CHARS.length - 1));
               out += CHARS[idx] || ' ';
            }
            out += '\n';
         }
         bgEl.textContent = out;
      }

      measure();
      let resizeTimer;
      window.addEventListener('resize', () => {
         clearTimeout(resizeTimer);
         resizeTimer = setTimeout(measure, 150);
      });

      if (reduceMotion) {
         paint(0);
      } else {
         const startBg = performance.now();
         // throttle to ~12fps — background motion stays subtle and cheap
         let last = 0;
         function bgLoop(now) {
            if (now - last > 80) {
               paint(now - startBg);
               last = now;
            }
            requestAnimationFrame(bgLoop);
         }
         requestAnimationFrame(bgLoop);
      }
   }
})();
