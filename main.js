(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine) and (min-width: 961px)").matches;

  // Tour videos open with a 2.8 s title card and close with a 3 s end card (tools/assemble.py).
  // On the site we only want the product footage in between.
  const CARD_IN = 3.5;
  const CARD_OUT = 3.6;
  const SHOT_MS = 3200;

  // ---------- Player: puts a project's reel into a .screen-stage ----------
  class Player {
    constructor(stage, media, base, { loop = true, maxMs = Infinity, onProgress, onDone } = {}) {
      Object.assign(this, { stage, media, base, loop, maxMs, onProgress, onDone });
      this.timer = null;
      this.raf = null;
      this.video = null;
      this.shotIndex = 0;
    }

    layer(el) {
      el.classList.add("layer", "out");
      this.stage.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("out")));
      const old = [...this.stage.children].filter((c) => c !== el);
      old.forEach((c) => c.classList.add("out"));
      setTimeout(() => old.forEach((c) => c.isConnected && c !== this.video && c.remove()), 750);
      return el;
    }

    start() {
      this.stop();
      this.startedAt = performance.now();
      if (this.media.video && !reduced) return this.playVideo();
      if (this.media.shots?.length > 1 && !reduced) return this.playShots();
      this.tickStatic();
    }

    playVideo() {
      const v = this.video && this.video.isConnected ? this.video : document.createElement("video");
      if (v !== this.video) {
        v.muted = true;
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.preload = "auto";
        if (this.media.poster) v.poster = this.base + this.media.poster;
        v.src = `${this.base}${this.media.video}#t=${CARD_IN}`;
        this.video = v;
        this.layer(v);
      }
      const bounds = () => {
        const d = v.duration || 0;
        return d > CARD_IN + CARD_OUT + 4 ? [CARD_IN, d - CARD_OUT] : [0, d];
      };
      const begin = () => {
        const [a] = bounds();
        if (v.currentTime < a || v.currentTime > bounds()[1]) v.currentTime = a;
        v.play().catch(() => {});
      };
      if (v.readyState >= 1) begin();
      else v.addEventListener("loadedmetadata", begin, { once: true });
      // A video that can't play (codec, network) must not stall the page: fall back to the screenshots.
      v.addEventListener("error", () => this.fallback(), { once: true });

      const tick = () => {
        const [a, b] = bounds();
        const elapsed = performance.now() - this.startedAt;
        if (b > a) {
          if (v.currentTime >= b - 0.05 && this.loop) v.currentTime = a;
          if (!this.loop) this.onProgress?.(Math.min(1, elapsed / Math.min((b - a) * 1000, this.maxMs)));
          if (!this.loop && elapsed >= Math.min((b - a) * 1000, this.maxMs)) return this.done();
        } else if (!this.loop) {
          this.onProgress?.(Math.min(1, elapsed / this.maxMs));
          if (elapsed >= this.maxMs) return this.done();
        }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    playShots() {
      const shots = this.media.shots;
      const total = Math.min(this.maxMs, shots.length * SHOT_MS);
      const show = () => {
        const img = new Image();
        img.alt = "";
        img.className = "kb";
        img.src = this.base + shots[this.shotIndex % shots.length];
        const put = () => this.layer(img);
        img.decode ? img.decode().then(put, put) : put();
        this.shotIndex++;
      };
      show();
      this.timer = setInterval(() => {
        if (!this.loop && performance.now() - this.startedAt >= total - 50) return;
        show();
      }, SHOT_MS);
      const tick = () => {
        const elapsed = performance.now() - this.startedAt;
        this.onProgress?.(Math.min(1, elapsed / total));
        if (elapsed >= total && !this.loop) return this.done();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    tickStatic() {
      if (this.media.poster && !this.stage.querySelector("img")) {
        const img = new Image();
        img.alt = "";
        img.src = this.base + this.media.poster;
        this.layer(img);
      }
      if (this.loop || this.maxMs === Infinity) return;
      const tick = () => {
        const elapsed = performance.now() - this.startedAt;
        this.onProgress?.(Math.min(1, elapsed / this.maxMs));
        if (elapsed >= this.maxMs) return this.done();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    fallback() {
      if (!this.media.video) return;
      this.stop();
      const v = this.video;
      this.video = null;
      v?.remove();
      this.media = { ...this.media, video: null };
      const startedAt = this.startedAt;
      this.start();
      this.startedAt = startedAt;
    }

    done() {
      this.stop();
      this.onDone?.();
    }

    pause() {
      this.stop();
      this.video?.pause();
    }

    stop() {
      clearInterval(this.timer);
      cancelAnimationFrame(this.raf);
    }

    destroy() {
      this.pause();
      if (this.video) {
        const v = this.video;
        this.video = null;
        v.classList.add("out");
        setTimeout(() => { v.removeAttribute("src"); v.load(); v.remove(); }, 750);
      }
    }
  }

  // ---------- hero reel ----------
  const reelData = document.getElementById("reel-data");
  if (reelData) {
    const items = JSON.parse(reelData.textContent);
    const stage = document.querySelector("[data-reel-stage]");
    const title = document.querySelector("[data-reel-title]");
    const buttons = [...document.querySelectorAll("[data-reel-index]")];
    const HERO_MS = 9000;
    let index = 0;
    let player = null;

    const go = (i) => {
      index = (i + items.length) % items.length;
      buttons.forEach((b, j) => {
        b.setAttribute("aria-pressed", String(j === index));
        b.querySelector(".reel-bar > span").style.width = j < index ? "100%" : "0%";
      });
      title.textContent = items[index].name;
      player?.destroy();
      const bar = buttons[index].querySelector(".reel-bar > span");
      player = new Player(stage, items[index], "", {
        loop: false,
        maxMs: HERO_MS,
        onProgress: (p) => { bar.style.width = `${p * 100}%`; },
        onDone: () => go(index + 1),
      });
      player.start();
    };
    buttons.forEach((b, i) => b.addEventListener("click", () => go(i)));

    // Only run the reel while the hero is on screen.
    let started = false;
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        if (!started) { started = true; setTimeout(() => go(0), reduced ? 0 : 900); }
        else player?.start();
      } else player?.pause();
    }, { threshold: 0.15 }).observe(stage);
  }

  // ---------- load sequence + hero tilt ----------
  const ready = () => {
    root.classList.add("ready");
    setTimeout(() => root.classList.add("settled"), 2000);
  };
  (document.fonts?.ready || Promise.resolve()).then(() => requestAnimationFrame(ready));
  setTimeout(ready, 1200);

  const tilt = document.querySelector(".hero-tilt");
  if (tilt && finePointer && !reduced) {
    let raf = null;
    window.addEventListener("pointermove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const x = e.clientX / innerWidth - 0.5;
        const y = e.clientY / innerHeight - 0.5;
        tilt.style.setProperty("--rx", `${(x * 7).toFixed(2)}deg`);
        tilt.style.setProperty("--ry", `${(-y * 5).toFixed(2)}deg`);
      });
    }, { passive: true });
  }

  // ---------- project screens: play while visible ----------
  const screens = [...document.querySelectorAll(".screen[data-screen]")];
  const players = new Map();
  const screenObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      let p = players.get(e.target);
      if (e.isIntersecting) {
        if (!p) {
          const media = JSON.parse(e.target.dataset.screen);
          p = new Player(e.target.querySelector(".screen-stage"), media, e.target.dataset.base || "");
          players.set(e.target, p);
        }
        p.start();
      } else p?.pause();
    }
  }, { threshold: 0.35 });
  screens.forEach((s) => screenObserver.observe(s));

  // ---------- screens grow into place as they scroll up ----------
  const scalers = [...document.querySelectorAll(".screen-scroll")];
  if (scalers.length && !reduced) {
    let pending = false;
    const update = () => {
      pending = false;
      const vh = innerHeight;
      for (const el of scalers) {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) continue;
        const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
        el.style.setProperty("--s", (0.9 + 0.1 * (1 - Math.pow(1 - p, 3))).toFixed(4));
      }
    };
    addEventListener("scroll", () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", update);
    update();
  }

  // ---------- copy email (mailto does nothing for people without a mail app) ----------
  for (const btn of document.querySelectorAll("[data-copy]")) {
    const label = btn.querySelector("[data-copy-label]");
    const original = label.textContent;
    btn.setAttribute("aria-label", `Copy ${original}`);
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        label.textContent = "Email copied";
      } catch {
        label.textContent = original;
        return;
      }
      btn.setAttribute("data-copied", "");
      clearTimeout(btn.copyTimer);
      btn.copyTimer = setTimeout(() => { label.textContent = original; btn.removeAttribute("data-copied"); }, 1800);
    });
  }

  // ---------- numbers count up the first time they are seen ----------
  const counters = [...document.querySelectorAll("[data-count]")];
  const animate = (el) => {
    const text = el.textContent;
    const m = text.match(/\d+(?:[.,]\d+)?/);
    if (!m || reduced) return;
    const target = parseFloat(m[0].replace(",", "."));
    const decimals = (m[0].split(/[.,]/)[1] || "").length;
    const [pre, post] = [text.slice(0, m.index), text.slice(m.index + m[0].length)];
    const dur = 1100;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const v = target * (1 - Math.pow(1 - k, 4));
      el.textContent = pre + v.toFixed(decimals) + post;
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = text;
    };
    requestAnimationFrame(step);
  };
  const countObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      countObserver.unobserve(e.target);
      e.target.closest(".stat, .win")?.classList.add("in");
      animate(e.target);
    }
  }, { threshold: 0.6 });
  counters.forEach((c) => countObserver.observe(c));
})();
