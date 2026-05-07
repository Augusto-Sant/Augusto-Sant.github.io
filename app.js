/* ============================================================
   jose_dev_  — interactions
   ============================================================ */

(function () {
   'use strict';

   const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#________%&$@';

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

      el.addEventListener('mouseenter', () => fx.setText(el.dataset.original));
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
            el.addEventListener('mouseenter', () => fx.setText(el.dataset.original));
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

   /* ---- header border on scroll ---- */
   const header = document.querySelector('.site-header');
   const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 10);
   };
   onScroll();
   window.addEventListener('scroll', onScroll, { passive: true });

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

   /* ---- ASCII wave art (canvas-style ascii density map) ---- */
   const asciiEl = document.getElementById('asciiArt');
   if (asciiEl) {
      const COLS = 80;
      const ROWS = 32;
      const CHARSET = ' .·:-+*=%@#';

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

      let start = performance.now();
      function loop(now) {
         render(now - start);
         requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
   }
})();
