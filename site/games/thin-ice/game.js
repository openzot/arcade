/**
 * Thin Ice — skate out, crack the ice, bring them home before dawn.
 * Vanilla canvas game; no dependencies, no network.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  constants
   * ------------------------------------------------------------------ */

  const COLS = 13;
  const ROWS = 10;
  const SHORE_ROW = ROWS - 1; // bottom row is the snowbank shore (safe)
  const BREAK_AT = 5; // crack state that swallows the leader
  const STEP_MS = 118; // one skating step
  const REFREEZE_MS = 6500; // damaged tiles heal one state per tick
  const NIGHT_BASE_MS = 95000; // dawn countdown, shrinks each night
  const NIGHT_STEP_MS = 6000;
  const PLUNGE_MS = 750;

  const DIRS = {
    up: { dc: 0, dr: -1 },
    down: { dc: 0, dr: 1 },
    left: { dc: -1, dr: 0 },
    right: { dc: 1, dr: 0 },
  };

  const COATS = [
    "#e2604f",
    "#e8a13c",
    "#67b06a",
    "#5f8fd9",
    "#b07fd9",
    "#d95fa0",
    "#4fb8b0",
    "#d8d24a",
  ];

  const STORE_BEST = "thin-ice-best";
  const STORE_MUTE = "thin-ice-mute";

  /* ------------------------------------------------------------------ *
   *  dom
   * ------------------------------------------------------------------ */

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const elNight = document.getElementById("night");
  const elSaved = document.getElementById("saved");
  const elTotal = document.getElementById("total");
  const elScore = document.getElementById("score");
  const elLives = document.getElementById("lives");
  const elClock = document.getElementById("clockfill");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ov-title");
  const ovTag = document.getElementById("ov-tag");
  const ovBody = document.getElementById("ov-body");
  const ovBest = document.getElementById("ov-best");
  const btnStart = document.getElementById("btn-start");
  const btnPause = document.getElementById("btn-pause");
  const btnMute = document.getElementById("btn-mute");
  const btnRestart = document.getElementById("btn-restart");

  /* ------------------------------------------------------------------ *
   *  tiny helpers
   * ------------------------------------------------------------------ */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(a, b, salt) {
    let h =
      (salt | 0) ^
      Math.imul(a + 0x9e37, 0x85eb) ^
      Math.imul(b + 0x51f7, 0xc2b2);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4);
    return (h ^ (h >>> 15)) >>> 0;
  }

  const store = {
    get(key, fallback) {
      try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, String(value));
      } catch (err) {
        /* private mode etc. */
      }
    },
  };

  /* ------------------------------------------------------------------ *
   *  audio — all synthesised, created on first gesture
   * ------------------------------------------------------------------ */

  const audio = {
    ctx: null,
    master: null,
    muted: store.get(STORE_MUTE, "0") === "1",

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return;
      }
      if (typeof window.AudioContext === "undefined") return;
      this.ctx = new window.AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    },

    setMuted(muted) {
      this.muted = muted;
      store.set(STORE_MUTE, muted ? "1" : "0");
      if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    },

    env(gainNode, t0, peak, dur) {
      const g = gainNode.gain;
      g.setValueAtTime(0.0001, t0);
      g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.012);
      g.exponentialRampToValueAtTime(0.0001, t0 + dur);
    },

    noise(dur) {
      const rate = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, Math.max(1, (dur * rate) | 0), rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      return src;
    },

    /** crunchy footfall; deeper and creakier on badly cracked ice */
    step(state) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const src = this.noise(0.09 + state * 0.02);
      const filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 900 + state * 500;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.16 + state * 0.05, 0.1 + state * 0.05);
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      src.start(t0);
      if (state >= 3) this.creak(0.6);
    },

    /** wooden groan — warnings, distant shifting */
    creak(vol) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(170 + Math.random() * 60, t0);
      osc.frequency.exponentialRampToValueAtTime(
        70 + Math.random() * 30,
        t0 + 0.28,
      );
      const g = this.ctx.createGain();
      this.env(g, t0, 0.08 * vol, 0.32);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    },

    rescue() {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      [659.25, 987.77].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const g = this.ctx.createGain();
        this.env(g, t0 + i * 0.09, 0.18, 0.22);
        o.connect(g);
        g.connect(this.master);
        o.start(t0 + i * 0.09);
        o.stop(t0 + i * 0.09 + 0.26);
      });
    },

    plunge() {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const splashNoise = this.noise(0.5);
      const filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 700;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.3, 0.5);
      splashNoise.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      splashNoise.start(t0);
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(240, t0);
      o.frequency.exponentialRampToValueAtTime(48, t0 + 0.55);
      const g2 = this.ctx.createGain();
      this.env(g2, t0, 0.22, 0.6);
      o.connect(g2);
      g2.connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.62);
    },

    jingle() {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f;
        const g = this.ctx.createGain();
        this.env(g, t0 + i * 0.1, 0.07, 0.3);
        o.connect(g);
        g.connect(this.master);
        o.start(t0 + i * 0.1);
        o.stop(t0 + i * 0.1 + 0.34);
      });
    },

    tick() {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 720;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.06, 0.09);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.1);
    },
  };

  /* ------------------------------------------------------------------ *
   *  world state
   * ------------------------------------------------------------------ */

  let MODE = "title"; // title | playing | paused | plunging | cleared | over
  let tiles = []; // [{type:'ice'|'rock'|'shore', crack}]
  let stranded = new Map(); // "c,r" -> {coat,c,r}
  let followers = []; // [{c,r,fc,fr,coat}]
  let leader = null; // {c,r,fc,fr}
  let stepAnim = null; // {t}
  let stepQueue = [];
  let pathTrail = []; // recent points for the skate trail

  let night = 1;
  let score = 0;
  let lives = 3;
  let savedTotal = 0; // rescued this night
  let runSaved = 0; // rescued across the run
  let needTotal = 0;
  let best = parseInt(store.get(STORE_BEST, "0"), 10) || 0;

  let dawnLeft = NIGHT_BASE_MS;
  let nightDurMs = NIGHT_BASE_MS;
  let refreezeAcc = 0;
  let groanAt = 8000;
  let plungeT = 0;
  let clearedT = 0;
  let runSeed = (Date.now() & 0xffff) | 1;

  const cracksCache = new Map();
  const stars = [];
  const flakes = [];
  const particles = [];
  const floaters = [];

  const entryTile = () => ({ c: (COLS / 2) | 0, r: SHORE_ROW });

  /* ------------------------------------------------------------------ *
   *  level generation
   * ------------------------------------------------------------------ */

  function genNight(n) {
    const rnd = mulberry32(runSeed + n * 7919);
    tiles = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        row.push({ type: r === SHORE_ROW ? "shore" : "ice", crack: 0 });
      }
      tiles.push(row);
    }

    // boulders and reed clumps on the pond
    const rockCount = Math.min(17, 5 + n);
    const entry = entryTile();
    let placed = 0;
    let guard = 0;
    while (placed < rockCount && guard++ < 500) {
      const c = (rnd() * COLS) | 0;
      const r = (rnd() * (SHORE_ROW - 1)) | 0;
      if (tiles[r][c].type !== "ice") continue;
      if (Math.abs(c - entry.c) <= 1 && r >= SHORE_ROW - 2) continue; // keep launch clear
      tiles[r][c].type = "rock";
      placed++;
    }

    // reachability from the launch tile across open ice
    const seen = new Set();
    const startKey = entry.c + "," + entry.r;
    seen.add(startKey);
    const bfs = [entry];
    while (bfs.length) {
      const cur = bfs.pop();
      for (const d of Object.values(DIRS)) {
        const nc = cur.c + d.dc;
        const nr = cur.r + d.dr;
        const key = nc + "," + nr;
        if (
          nc >= 0 &&
          nc < COLS &&
          nr >= 0 &&
          nr < SHORE_ROW &&
          tiles[nr][nc].type !== "rock" &&
          !seen.has(key)
        ) {
          seen.add(key);
          bfs.push({ c: nc, r: nr });
        }
      }
    }
    const reachable = [];
    for (let r = 0; r < SHORE_ROW; r++) {
      for (let c = 0; c < COLS; c++) {
        if (tiles[r][c].type === "ice" && seen.has(c + "," + r)) {
          reachable.push({ c, r });
        }
      }
    }

    // stranded skaters, spread out, away from the shore
    stranded.clear();
    const want = Math.min(3 + (n - 1), 8);
    const far = reachable.filter((p) => p.r < SHORE_ROW - 2);
    let guard2 = 0;
    while (stranded.size < want && far.length && guard2++ < 800) {
      const p = far[(rnd() * far.length) | 0];
      const key = p.c + "," + p.r;
      if (stranded.has(key)) continue;
      let lonely = true;
      for (const k of stranded.keys()) {
        const parts = k.split(",");
        if (Math.abs(+parts[0] - p.c) + Math.abs(+parts[1] - p.r) < 3)
          lonely = false;
      }
      if (!lonely) continue;
      stranded.set(key, {
        coat: COATS[stranded.size % COATS.length],
        c: p.c,
        r: p.r,
      });
    }

    // rotten patches appear from night 2
    if (n >= 2) {
      const patchCount = Math.min(16, 2 + 2 * (n - 1));
      let done = 0;
      let guard3 = 0;
      while (done < patchCount && guard3++ < 500) {
        const p = reachable[(rnd() * reachable.length) | 0];
        const tl = tiles[p.r][p.c];
        if (tl.crack === 0 && !stranded.has(p.c + "," + p.r)) {
          tl.crack = 2;
          done++;
        }
      }
    }

    needTotal = stranded.size;
    savedTotal = 0;
  }

  function newRun() {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
    score = 0;
    lives = 3;
    night = 1;
    runSaved = 0;
    runSeed = (Date.now() & 0xffff) | 1;
    startNight();
    hideOverlay();
    MODE = "playing";
    audio.tick();
  }

  function startNight() {
    genNight(night);
    nightDurMs = Math.max(55000, NIGHT_BASE_MS - (night - 1) * NIGHT_STEP_MS);
    dawnLeft = nightDurMs;
    refreezeAcc = 0;
    groanAt = 7000 + Math.random() * 6000;
    stepQueue.length = 0;
    stepAnim = null;
    followers = [];
    particles.length = 0;
    floaters.length = 0;
    pathTrail.length = 0;
    cracksCache.clear();
    const e = entryTile();
    leader = { c: e.c, r: e.r, fc: e.c, fr: e.r };
    buildStarsAndFlakes();
    updateHUD();
  }

  function nextNight() {
    night++;
    startNight();
    hideOverlay();
    MODE = "playing";
  }

  /* ------------------------------------------------------------------ *
   *  movement, cracking, rescue
   * ------------------------------------------------------------------ */

  function crackLoad() {
    return 1 + Math.min(2, Math.floor(followers.length / 3));
  }

  function tryStep(dirName) {
    if (MODE !== "playing") return;
    if (stepAnim) {
      if (stepQueue.length < 2) stepQueue.push(dirName);
      return;
    }
    beginStep(dirName);
  }

  function beginStep(dirName) {
    const d = DIRS[dirName];
    const nc = leader.c + d.dc;
    const nr = leader.r + d.dr;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
    if (tiles[nr][nc].type === "rock") return;

    // everyone slides one tile along the line
    let carry = { c: leader.c, r: leader.r }; // tile being vacated next
    leader.fc = leader.c;
    leader.fr = leader.r;
    leader.c = nc;
    leader.r = nr;
    for (const f of followers) {
      const next = { c: f.c, r: f.r };
      f.fc = f.c;
      f.fr = f.r;
      f.c = carry.c;
      f.r = carry.r;
      carry = next;
    }
    stepAnim = { t: 0 };

    pathTrail.push(screenPos(leader.fc, leader.fr, 0.62));
    if (pathTrail.length > 160) pathTrail.shift();

    // the ice keeps score
    const destTile = tiles[nr][nc];
    if (destTile.type === "ice") {
      destTile.crack += crackLoad();
      audio.step(Math.min(destTile.crack, 4));
      if (destTile.crack >= BREAK_AT) {
        startPlunge();
        return;
      }
    } else {
      audio.step(0);
    }

    // rescue?
    const key = nc + "," + nr;
    if (stranded.has(key)) {
      const sk = stranded.get(key);
      stranded.delete(key);
      followers.push({
        c: carry.c,
        r: carry.r,
        fc: nc,
        fr: nr,
        coat: sk.coat,
      });
      savedTotal++;
      runSaved++;
      const gained = 100 * night;
      score += gained;
      audio.rescue();
      const sp = screenPos(nc, nr, 0.5);
      floaters.push({ x: sp.x, y: sp.y, text: "+" + gained, t: 0 });
      sparkle(sp.x, sp.y, "#ffd98a");
      updateHUD();

      if (stranded.size === 0) {
        nightCleared();
      }
    }
  }

  function finishStep() {
    stepAnim = null;
    leader.fc = leader.c;
    leader.fr = leader.r;
    for (const f of followers) {
      f.fc = f.c;
      f.fr = f.r;
    }
    if (stepQueue.length && MODE === "playing") beginStep(stepQueue.shift());
  }

  function startPlunge() {
    MODE = "plunging";
    plungeT = 0;
    lives--;
    updateHUD();
    audio.plunge();
    const p = screenPos(leader.c, leader.r, 0.5);
    splash(p.x, p.y);
  }

  function resolvePlunge() {
    if (lives <= 0) {
      gameOver("Too many lanterns went out beneath the ice.");
      return;
    }
    // the rescued walk themselves ashore — already counted as saved
    followers = [];
    stepQueue.length = 0;
    stepAnim = null;
    const e = entryTile();
    leader = { c: e.c, r: e.r, fc: e.c, fr: e.r };
    pathTrail.length = 0;
    MODE = "playing";
    floaters.push({
      x: view.w / 2,
      y: view.h * 0.42,
      text: "brrr!",
      t: 0,
    });
  }

  function nightCleared() {
    MODE = "cleared";
    clearedT = 0;
    const bonus = 150 + 25 * lives;
    score += bonus;
    audio.jingle();
    if (score > best) {
      best = score;
      store.set(STORE_BEST, best);
    }
    updateHUD();
    showPanel({
      title: "Night " + night + " crossed",
      tag: "Everyone is back on the shore.",
      bodyHTML:
        '<p class="keys">bonus +' +
        bonus +
        " &middot; lanterns left: " +
        lives +
        "</p>",
      btnLabel: "Next night",
    });
  }

  function gameOver(reason) {
    MODE = "over";
    if (score > best) {
      best = score;
      store.set(STORE_BEST, best);
    }
    updateHUD();
    showPanel({
      title: "The cold wins tonight",
      tag: reason,
      bodyHTML:
        "<ul>" +
        "<li>Nights crossed: " +
        (night - 1) +
        "</li>" +
        "<li>Skaters brought home: " +
        runSaved +
        "</li>" +
        "<li>Final score: " +
        score +
        "</li>" +
        "</ul>",
      btnLabel: "Skate again",
    });
  }

  /* ------------------------------------------------------------------ *
   *  overlay / hud
   * ------------------------------------------------------------------ */

  let pendingTimeout = null;

  function showPanel(cfg) {
    ovTitle.textContent = cfg.title;
    ovTag.textContent = cfg.tag || "";
    ovBody.innerHTML = cfg.bodyHTML || "";
    btnStart.textContent = cfg.btnLabel || "Continue";
    ovBest.textContent = "best " + best;
    ovBest.classList.toggle("hidden", !(best > 0));
    overlay.classList.add("show");
    btnStart.onclick = () => {
      audio.ensure();
      audio.tick();
      if (cfg.action) {
        cfg.action();
      } else if (MODE === "title" || MODE === "over") {
        newRun();
      } else if (MODE === "paused") {
        resumeGame();
      } else if (MODE === "cleared") {
        clearedT = 0;
        nextNight();
      }
    };
  }

  function hideOverlay() {
    overlay.classList.remove("show");
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
  }

  function showTitle() {
    MODE = "title";
    showPanel({
      title: "Thin Ice",
      tag: "The pond remembers every step.",
      bodyHTML: ovBody.innerHTML,
      btnLabel: "Begin the crossing",
    });
  }

  function resumeGame() {
    if (MODE !== "paused") return;
    MODE = "playing";
    hideOverlay();
  }

  function pauseGame() {
    if (MODE !== "playing") return;
    MODE = "paused";
    showPanel({
      title: "Paused",
      tag: "The pond waits.",
      bodyHTML:
        '<p class="keys">arrows / WASD to step &middot; swipe or tap on touch</p>',
      btnLabel: "Back to the ice",
    });
  }

  function updateHUD() {
    elNight.textContent = night;
    elSaved.textContent = savedTotal;
    elTotal.textContent = needTotal;
    elScore.textContent = score;
    let lv = "";
    for (let i = 0; i < 3; i++) {
      lv += '<span class="' + (i < lives ? "" : "out") + '"></span>';
    }
    elLives.innerHTML = lv;
  }

  /* ------------------------------------------------------------------ *
   *  layout helpers
   * ------------------------------------------------------------------ */

  const view = { w: 320, h: 240, cell: 20, ox: 0, oy: 0 };

  function computeView() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width);
    const h = Math.max(220, rect.height);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = w;
    view.h = h;
    view.cell = Math.max(
      10,
      Math.floor(Math.min((w - 20) / COLS, (h - 64) / ROWS)),
    );
    view.ox = (w - view.cell * COLS) / 2;
    view.oy = (h - view.cell * ROWS) / 2 + 6;
  }

  function tileRect(c, r) {
    const s = view.cell;
    return { x: view.ox + c * s, y: view.oy + r * s, s };
  }

  function screenPos(c, r, frac) {
    const p = tileRect(c, r);
    return {
      x: p.x + p.s * 0.5,
      y: p.y + p.s * (frac === undefined ? 0.5 : frac),
    };
  }

  function entPos(e) {
    const t = stepAnim ? ease(clamp(stepAnim.t, 0, 1)) : 1;
    const a = screenPos(e.fc, e.fr, 0.62);
    const b = screenPos(e.c, e.r, 0.62);
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }

  /* ------------------------------------------------------------------ *
   *  decoration / particles
   * ------------------------------------------------------------------ */

  function buildStarsAndFlakes() {
    const rnd = mulberry32(runSeed * 31 + 7);
    stars.length = 0;
    for (let i = 0; i < 110; i++) {
      stars.push({
        x: rnd(),
        y: rnd() * 0.55,
        r: 0.4 + rnd() * 1.1,
        ph: rnd() * Math.PI * 2,
        sp: 0.4 + rnd() * 1.4,
      });
    }
    flakes.length = 0;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const n = reduce ? 26 : 70;
    for (let i = 0; i < n; i++) {
      flakes.push({
        x: rnd(),
        y: rnd(),
        v: 0.02 + rnd() * 0.05,
        drift: (rnd() - 0.5) * 0.03,
        r: 0.7 + rnd() * 1.7,
        ph: rnd() * Math.PI * 2,
      });
    }
  }

  function sparkle(x, y, colour) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 70;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.5 + Math.random() * 0.4,
        t: 0,
        r: 1.2 + Math.random() * 1.8,
        colour,
      });
    }
  }

  function splash(x, y) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
      const sp = 60 + Math.random() * 130;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.35,
        t: 0,
        r: 1.4 + Math.random() * 2.2,
        colour: "#cfe8ff",
      });
    }
    particles.push({ ring: true, x, y, t: 0, life: 0.8 });
  }

  function puff(x, y) {
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 20,
        vy: -10 - Math.random() * 20,
        life: 0.6,
        t: 0,
        r: 1 + Math.random() * 1.6,
        colour: "rgba(200,225,255,0.5)",
      });
    }
  }

  /* ------------------------------------------------------------------ *
   *  crack art (procedural, cached per tile)
   * ------------------------------------------------------------------ */

  function crackLines(c, r) {
    const key = c + "," + r;
    let set = cracksCache.get(key);
    if (!set) {
      const rnd = mulberry32(hash2(c, r, runSeed + night));
      set = [];
      for (let i = 0; i < 12; i++) {
        let ang = rnd() * Math.PI * 2;
        const segs = 3 + ((rnd() * 3) | 0);
        const pts = [{ x: 0.5, y: 0.5 }];
        let x = 0.5;
        let y = 0.5;
        let len = 0.16 + rnd() * 0.3;
        for (let si = 0; si < segs; si++) {
          ang += (rnd() - 0.5) * 1.3;
          x += Math.cos(ang) * len;
          y += Math.sin(ang) * len;
          len *= 0.82;
          pts.push({ x: clamp(x, 0.04, 0.96), y: clamp(y, 0.04, 0.96) });
        }
        set.push(pts);
      }
      cracksCache.set(key, set);
    }
    return set;
  }

  /* ------------------------------------------------------------------ *
   *  rendering
   * ------------------------------------------------------------------ */

  function render(now) {
    computeView();
    const s = view.cell;
    const W = view.w;
    const H = view.h;
    const t = now / 1000;

    // sky
    const duskiness = clamp(1 - dawnLeft / Math.max(1, nightDurMs), 0, 1);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#070d1a");
    sky.addColorStop(clamp(0.55 + duskiness * 0.2, 0, 0.99), "#0d1830");
    sky.addColorStop(1, mixHex("#101c33", "#5a4a58", duskiness * 0.55));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // stars
    ctx.fillStyle = "#dfe9ff";
    for (const st of stars) {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph));
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawAurora(W, t);

    // moon
    const mx = W * 0.84;
    const my = H * 0.11;
    const mg = ctx.createRadialGradient(mx, my, 2, mx, my, 90);
    mg.addColorStop(0, "rgba(230,240,255,0.9)");
    mg.addColorStop(0.25, "rgba(190,215,255,0.22)");
    mg.addColorStop(1, "rgba(190,215,255,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(mx - 95, my - 95, 190, 190);
    ctx.fillStyle = "#eef4ff";
    ctx.beginPath();
    ctx.arc(mx, my, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(160,185,220,0.5)";
    ctx.beginPath();
    ctx.arc(mx - 4, my - 3, 3, 0, Math.PI * 2);
    ctx.arc(mx + 5, my + 4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    drawPond(s, t, duskiness);
    drawShoreline(s, t);
    drawEntities(s, t);
    drawParticles();
    drawFloaters();
    drawSnow(H, t);

    // dawn wash on the horizon late in the night
    if (duskiness > 0.72) {
      const a = (duskiness - 0.72) / 0.28;
      const dg = ctx.createLinearGradient(0, H * 0.55, 0, H);
      dg.addColorStop(0, "rgba(255,170,110,0)");
      dg.addColorStop(1, "rgba(255,170,110," + (0.22 * a).toFixed(3) + ")");
      ctx.fillStyle = dg;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);
    }

    elClock.style.transform =
      "scaleX(" +
      clamp(dawnLeft / Math.max(1, nightDurMs), 0, 1).toFixed(4) +
      ")";
  }

  function mixHex(a, b, f) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ff = clamp(f, 0, 1);
    const mix = (sh) =>
      Math.round(lerp((pa >> sh) & 255, (pb >> sh) & 255, ff));
    return "rgb(" + mix(16) + "," + mix(8) + "," + mix(0) + ")";
  }

  function drawAurora(W, t) {
    ctx.save();
    ctx.globalAlpha = 0.1;
    for (let band = 0; band < 2; band++) {
      ctx.beginPath();
      const baseY = 26 + band * 26;
      ctx.moveTo(-20, baseY);
      for (let x = -20; x <= W + 20; x += 24) {
        const y =
          baseY +
          Math.sin(x * 0.012 + t * (0.35 + band * 0.12) + band * 2) * 14 +
          Math.sin(x * 0.004 - t * 0.2) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 20, -40);
      ctx.lineTo(-20, -40);
      ctx.closePath();
      ctx.fillStyle = band ? "#3ddc97" : "#69c0ff";
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRectPath(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawPond(s, t, duskiness) {
    const px = view.ox;
    const py = view.oy;
    const pw = s * COLS;
    const ph = s * ROWS;

    // ice sheet
    const g = ctx.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, mixHex("#8fb9d6", "#c9a9a4", duskiness * 0.35));
    g.addColorStop(1, mixHex("#6d9cbd", "#a98f92", duskiness * 0.35));
    roundRectPath(px - 6, py - 6, pw + 12, ph + 12, 10);
    ctx.fillStyle = g;
    ctx.fill();

    // wind-blown snow patches
    const rnd = mulberry32(runSeed + 99);
    ctx.fillStyle = "rgba(235,245,255,0.30)";
    for (let i = 0; i < 26; i++) {
      const cx = px + rnd() * pw;
      const cy = py + rnd() * ph * 0.94;
      const rr = s * (0.18 + rnd() * 0.5);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr, rr * 0.55, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // grout lines
    ctx.strokeStyle = "rgba(40,70,100,0.16)";
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(px + c * s, py);
      ctx.lineTo(px + c * s, py + ph);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(px, py + r * s);
      ctx.lineTo(px + pw, py + r * s);
      ctx.stroke();
    }

    for (let r = 0; r < SHORE_ROW; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = tiles[r][c];
        if (tile.type === "rock") {
          drawRock(tileRect(c, r), rnd);
        } else if (tile.type === "ice") {
          if (tile.crack >= BREAK_AT) {
            drawHole(tileRect(c, r), t);
          } else if (tile.crack > 0) {
            drawCracked(c, r, tileRect(c, r), tile.crack, t);
          }
        }
      }
    }
  }

  function drawRock(p, rnd) {
    const cx = p.x + p.s / 2;
    const cy = p.y + p.s * 0.56;
    const rr = p.s * 0.36;
    ctx.fillStyle = "rgba(20,40,60,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + rr * 0.55, rr * 1.05, rr * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5c6a78";
    ctx.beginPath();
    ctx.moveTo(cx - rr, cy + rr * 0.4);
    ctx.lineTo(cx - rr * 0.6, cy - rr * 0.7);
    ctx.lineTo(cx + rr * 0.15, cy - rr);
    ctx.lineTo(cx + rr * 0.9, cy - rr * 0.2);
    ctx.lineTo(cx + rr * 0.7, cy + rr * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8ea3b5";
    ctx.beginPath();
    ctx.moveTo(cx - rr * 0.55, cy - rr * 0.62);
    ctx.lineTo(cx + rr * 0.1, cy - rr * 0.92);
    ctx.lineTo(cx + rr * 0.42, cy - rr * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(240,248,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(
      cx + ((rnd() - 0.5) * p.s) / 8,
      cy - rr * 0.88,
      rr * 0.5,
      rr * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  function drawCracked(c, r, p, state, t) {
    const lines = crackLines(c, r);
    const count = [0, 3, 6, 9, 12][state];
    const alpha = [0, 0.28, 0.45, 0.66, 0.85][state];

    if (state >= 3) {
      // sagging shadow — this pane is giving up
      const pulse = state >= 4 ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
      ctx.fillStyle = "rgba(12,30,52," + (0.3 + pulse * 0.25).toFixed(3) + ")";
      ctx.beginPath();
      ctx.ellipse(
        p.x + p.s / 2,
        p.y + p.s * 0.58,
        p.s * 0.38,
        p.s * 0.3,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(18,44,74," + alpha.toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, p.s * (state >= 3 ? 0.045 : 0.03));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const pts = lines[i];
      ctx.beginPath();
      ctx.moveTo(p.x + pts[0].x * p.s, p.y + pts[0].y * p.s);
      for (let j = 1; j < pts.length; j++) {
        ctx.lineTo(p.x + pts[j].x * p.s, p.y + pts[j].y * p.s);
      }
      ctx.stroke();
    }
  }

  function drawHole(p, t) {
    const cx = p.x + p.s / 2;
    const cy = p.y + p.s / 2;
    ctx.fillStyle = "rgba(232,246,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, p.s * 0.46, p.s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#04070d";
    ctx.beginPath();
    ctx.ellipse(cx, cy, p.s * 0.4, p.s * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    const wg = ctx.createRadialGradient(cx, cy, 1, cx, cy, p.s * 0.34);
    wg.addColorStop(0, "rgba(30,60,95,0.9)");
    wg.addColorStop(1, "rgba(30,60,95,0)");
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.ellipse(cx, cy, p.s * 0.4, p.s * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 2; i++) {
      const ph = (t * 0.7 + i * 0.5) % 1;
      ctx.strokeStyle = "rgba(200,230,255," + (0.4 * (1 - ph)).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        p.s * (0.1 + ph * 0.36),
        p.s * (0.08 + ph * 0.3),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  function drawShoreline(s, t) {
    const px = view.ox;
    const py = view.oy;
    const pw = s * COLS;
    const shoreY = py + s * SHORE_ROW;

    ctx.fillStyle = "#e9f2fb";
    ctx.fillRect(px - 6, shoreY, pw + 12, s + 14);
    ctx.fillStyle = "rgba(150,180,210,0.5)";
    ctx.fillRect(px - 6, shoreY + s * 0.86, pw + 12, 4);
    ctx.strokeStyle = "rgba(120,155,190,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 6, shoreY + 1);
    ctx.lineTo(px + pw + 6, shoreY + 1);
    ctx.stroke();

    // the keeper's hut, window warm against the blue
    const hx = px + pw - s * 1.7;
    const hw = s * 1.5;
    const hh = s * 1.05;
    const hy = shoreY + s - hh;
    ctx.fillStyle = "#4a3a2c";
    ctx.fillRect(hx, hy, hw, hh);
    ctx.fillStyle = "#7c5a3c";
    ctx.beginPath();
    ctx.moveTo(hx - s * 0.14, hy);
    ctx.lineTo(hx + hw / 2, hy - s * 0.55);
    ctx.lineTo(hx + hw + s * 0.14, hy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#20303f";
    ctx.fillRect(hx - s * 0.14, hy - s * 0.6, hw + s * 0.28, s * 0.1);

    const wx = hx + hw * 0.32;
    const wy = hy + hh * 0.38;
    const flicker = 0.75 + 0.25 * Math.sin(t * 7 + Math.sin(t * 13));
    const wg = ctx.createRadialGradient(wx, wy, 1, wx, wy, s * 1.1);
    wg.addColorStop(0, "rgba(255,196,110," + (0.5 * flicker).toFixed(3) + ")");
    wg.addColorStop(1, "rgba(255,196,110,0)");
    ctx.fillStyle = wg;
    ctx.fillRect(wx - s * 1.1, wy - s * 1.1, s * 2.2, s * 2.2);
    ctx.fillStyle = "#ffcf8a";
    ctx.fillRect(wx, wy, s * 0.36, s * 0.3);

    // chimney smoke
    ctx.fillStyle = "rgba(220,230,245,0.14)";
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.25 + i * 0.33) % 1;
      ctx.beginPath();
      ctx.arc(
        hx + hw * 0.78 + Math.sin(ph * 6) * s * 0.2,
        hy - s * 0.7 - ph * s * 1.6,
        s * (0.1 + ph * 0.22),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // launch lantern posted at the entry tile
    const e = entryTile();
    const ep = screenPos(e.c, e.r, 0.35);
    ctx.strokeStyle = "#3d4c5c";
    ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(ep.x, ep.y + s * 0.4);
    ctx.lineTo(ep.x, ep.y - s * 0.1);
    ctx.stroke();
    const lampFlicker = 0.8 + 0.2 * Math.sin(t * 9 + 1);
    const lg = ctx.createRadialGradient(
      ep.x,
      ep.y - s * 0.16,
      1,
      ep.x,
      ep.y - s * 0.16,
      s * 0.5,
    );
    lg.addColorStop(
      0,
      "rgba(255,205,120," + (0.85 * lampFlicker).toFixed(3) + ")",
    );
    lg.addColorStop(1, "rgba(255,205,120,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(ep.x - s * 0.5, ep.y - s * 0.66, s, s);
    ctx.fillStyle = "#ffd98a";
    ctx.beginPath();
    ctx.arc(ep.x, ep.y - s * 0.16, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEntities(s, t) {
    // skate trail
    if (pathTrail.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pathTrail[0].x, pathTrail[0].y);
      for (let i = 1; i < pathTrail.length; i++) {
        ctx.lineTo(pathTrail[i].x, pathTrail[i].y);
      }
      ctx.stroke();
    }

    // stranded skaters, waving for help
    for (const sk of stranded.values()) {
      const p = screenPos(sk.c, sk.r, 0.62);
      const shiver = Math.sin(t * 18 + sk.c * 2.1) * s * 0.02;
      const wave = 0.5 + 0.5 * Math.sin(t * 3 + sk.r);
      drawSkater(p.x + shiver, p.y, s, sk.coat, false, 0);
      ctx.strokeStyle =
        "rgba(160,210,255," + (0.18 + wave * 0.22).toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * (0.34 + wave * 0.08), 0, Math.PI * 2);
      ctx.stroke();
    }

    // the rescue train, front to back
    for (let i = followers.length - 1; i >= 0; i--) {
      const f = followers[i];
      const p = entPos(f);
      drawSkater(p.x, p.y, s, f.coat, true, i);
    }

    // lantern glow under the leader
    const lp = entPos(leader);
    const breathe = 0.9 + 0.1 * Math.sin(t * 2.2);
    const glow = ctx.createRadialGradient(
      lp.x,
      lp.y,
      s * 0.1,
      lp.x,
      lp.y,
      s * 2.6 * breathe,
    );
    glow.addColorStop(0, "rgba(255,214,140,0.30)");
    glow.addColorStop(0.5, "rgba(255,214,140,0.10)");
    glow.addColorStop(1, "rgba(255,214,140,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(lp.x - s * 3, lp.y - s * 3, s * 6, s * 6);

    if (MODE === "plunging") {
      const f = clamp(plungeT / PLUNGE_MS, 0, 1);
      ctx.save();
      ctx.globalAlpha = 1 - f;
      drawSkater(
        lp.x,
        lp.y + f * s * 0.4,
        s * (1 - f * 0.5),
        "#e2604f",
        false,
        0,
      );
      ctx.restore();
    } else {
      drawLeader(lp.x, lp.y, s, t);
    }
  }

  function shade(hex, amt) {
    const p = parseInt(hex.slice(1), 16);
    const sh = (shift) => clamp(((p >> shift) & 255) + amt, 0, 255);
    return "rgb(" + sh(16) + "," + sh(8) + "," + sh(0) + ")";
  }

  function drawSkater(x, y, s, coat, skating, idx) {
    const u = s * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(20,45,70,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, u * 0.42, u * 0.42, u * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#26374a";
    ctx.lineWidth = Math.max(1.5, u * 0.14);
    ctx.lineCap = "round";
    const legSwing = skating
      ? Math.sin(performance.now() / 90 + idx) * u * 0.12
      : 0;
    ctx.beginPath();
    ctx.moveTo(-u * 0.12, u * 0.05);
    ctx.lineTo(-u * 0.16 + legSwing, u * 0.4);
    ctx.moveTo(u * 0.12, u * 0.05);
    ctx.lineTo(u * 0.16 + legSwing, u * 0.4);
    ctx.stroke();
    ctx.fillStyle = coat;
    roundRectPath(-u * 0.22, -u * 0.42, u * 0.44, u * 0.55, u * 0.18);
    ctx.fill();
    ctx.fillStyle = "#f2d3ae";
    ctx.beginPath();
    ctx.arc(0, -u * 0.58, u * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(coat, -40);
    ctx.beginPath();
    ctx.arc(0, -u * 0.63, u * 0.175, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, -u * 0.8, u * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(coat, 45);
    ctx.fillRect(u * 0.05, -u * 0.44, u * 0.3, u * 0.1);
    ctx.restore();
  }

  function drawLeader(x, y, s, t) {
    drawSkater(x, y, s, "#e2604f", Boolean(stepAnim), 0);
    const u = s * 0.5;
    ctx.save();
    ctx.translate(x + u * 0.3, y - u * 0.2);
    ctx.rotate(Math.sin(t * 4) * 0.12);
    ctx.strokeStyle = "#26374a";
    ctx.lineWidth = Math.max(1.5, u * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(u * 0.34, -u * 0.34);
    ctx.stroke();
    ctx.fillStyle = "#ffe9b0";
    roundRectPath(u * 0.22, -u * 0.5, u * 0.24, u * 0.3, u * 0.06);
    ctx.fill();
    ctx.strokeStyle = "#5a4630";
    ctx.lineWidth = 1;
    roundRectPath(u * 0.22, -u * 0.5, u * 0.24, u * 0.3, u * 0.06);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.t += frameDt;
      if (pt.t >= pt.life) {
        particles.splice(i, 1);
        continue;
      }
      const f = pt.t / pt.life;
      if (pt.ring) {
        ctx.strokeStyle =
          "rgba(210,235,255," + (0.5 * (1 - f)).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4 + f * 34, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      pt.x += pt.vx * frameDt;
      pt.y += pt.vy * frameDt;
      pt.vy += 160 * frameDt;
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = pt.colour;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * (1 - f * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    ctx.font = "bold " + Math.max(12, view.cell * 0.5) + "px sans-serif";
    for (let i = floaters.length - 1; i >= 0; i--) {
      const fl = floaters[i];
      fl.t += frameDt;
      if (fl.t > 1) {
        floaters.splice(i, 1);
        continue;
      }
      ctx.fillStyle = "rgba(255,225,150," + (1 - fl.t).toFixed(3) + ")";
      ctx.fillText(fl.text, fl.x, fl.y - fl.t * 34);
    }
  }

  function drawSnow(H, t) {
    ctx.fillStyle = "rgba(235,245,255,0.75)";
    for (const fl of flakes) {
      const y = (fl.y + t * fl.v) % 1;
      const x = (fl.x + Math.sin(t * 0.6 + fl.ph) * fl.drift + 1) % 1;
      ctx.globalAlpha = 0.35 + fl.r * 0.2;
      ctx.beginPath();
      ctx.arc(x * view.w, y * H, fl.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ *
   *  update
   * ------------------------------------------------------------------ */

  let frameDt = 0;

  function update(dt) {
    frameDt = dt;

    if (MODE === "playing") {
      dawnLeft -= dt * 1000;
      if (dawnLeft <= 0) {
        dawnLeft = 0;
        gameOver("Dawn caught the last of them out on the ice.");
        return;
      }

      if (stepAnim) {
        stepAnim.t += (dt * 1000) / STEP_MS;
        if (stepAnim.t >= 1) finishStep();
      }

      // slow refreeze — patience is a strategy, dawn disagrees
      refreezeAcc += dt * 1000;
      if (refreezeAcc >= REFREEZE_MS) {
        refreezeAcc -= REFREEZE_MS;
        for (let r = 0; r < SHORE_ROW; r++) {
          for (let c = 0; c < COLS; c++) {
            const tl = tiles[r][c];
            if (tl.type === "ice" && tl.crack > 0) tl.crack--;
          }
        }
      }

      // the pond shifts and groans on its own
      groanAt -= dt * 1000;
      if (groanAt <= 0) {
        groanAt = 7000 + Math.random() * 6000;
        const candidates = [];
        for (let r = 0; r < SHORE_ROW; r++) {
          for (let c = 0; c < COLS; c++) {
            const tl = tiles[r][c];
            if (tl.type === "ice" && tl.crack > 0 && tl.crack < 3) {
              candidates.push({ c, r });
            }
          }
        }
        if (candidates.length) {
          const pick = candidates[(Math.random() * candidates.length) | 0];
          tiles[pick.r][pick.c].crack++;
          const sp = screenPos(pick.c, pick.r, 0.5);
          puff(sp.x, sp.y);
          const ld = Math.abs(pick.c - leader.c) + Math.abs(pick.r - leader.r);
          audio.creak(ld < 4 ? 1 : 0.5);
        }
      }
    } else if (MODE === "plunging") {
      plungeT += dt * 1000;
      if (plungeT >= PLUNGE_MS) resolvePlunge();
    } else if (MODE === "cleared") {
      clearedT += dt * 1000;
      if (clearedT >= 1700) {
        clearedT = 0;
        nextNight();
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  main loop
   * ------------------------------------------------------------------ */

  let lastNow = 0;

  function loop(now) {
    const dt = Math.min(0.1, lastNow ? (now - lastNow) / 1000 : 0.016);
    lastNow = now;
    if (MODE === "playing" || MODE === "plunging" || MODE === "cleared") {
      update(dt);
    } else {
      frameDt = dt;
    }
    render(now);
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ *
   *  input
   * ------------------------------------------------------------------ */

  const KEY_DIRS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    s: "down",
    a: "left",
    d: "right",
    W: "up",
    S: "down",
    A: "left",
    D: "right",
  };

  window.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const dir = KEY_DIRS[ev.key];
    if (dir) {
      ev.preventDefault();
      audio.ensure();
      if (MODE === "title" || MODE === "over") btnStart.click();
      else if (MODE === "cleared") {
        clearedT = 0;
        nextNight();
      }
      tryStep(dir);
      return;
    }
    switch (ev.key) {
      case "p":
      case "P":
        if (MODE === "playing") pauseGame();
        else if (MODE === "paused") resumeGame();
        break;
      case "r":
      case "R":
        audio.ensure();
        newRun();
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "Escape":
        if (MODE === "playing") pauseGame();
        break;
      default:
        break;
    }
  });

  let ptrDown = null;
  canvas.addEventListener("pointerdown", (ev) => {
    audio.ensure();
    ptrDown = { x: ev.clientX, y: ev.clientY };
    ev.preventDefault();
  });

  canvas.addEventListener("pointerup", (ev) => {
    if (!ptrDown) return;
    const dx = ev.clientX - ptrDown.x;
    const dy = ev.clientY - ptrDown.y;
    ptrDown = null;
    if (Math.hypot(dx, dy) < 18) {
      // tap: skate toward the tapped spot
      const rect = canvas.getBoundingClientRect();
      const rx = ev.clientX - rect.left;
      const ry = ev.clientY - rect.top;
      const lp = entPos(leader);
      const ax = rx - lp.x;
      const ay = ry - lp.y;
      tryStep(
        Math.abs(ax) >= Math.abs(ay)
          ? ax >= 0
            ? "right"
            : "left"
          : ay >= 0
            ? "down"
            : "up",
      );
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      tryStep(dx > 0 ? "right" : "left");
    } else {
      tryStep(dy > 0 ? "down" : "up");
    }
  });

  btnPause.addEventListener("click", () => {
    audio.ensure();
    if (MODE === "playing") pauseGame();
    else if (MODE === "paused") resumeGame();
  });

  btnRestart.addEventListener("click", () => {
    audio.ensure();
    newRun();
  });

  function toggleMute() {
    audio.ensure();
    audio.setMuted(!audio.muted);
    syncMuteButton();
  }

  function syncMuteButton() {
    btnMute.textContent = audio.muted ? "\u2715" : "\u266A";
    btnMute.setAttribute("aria-pressed", String(audio.muted));
  }

  btnMute.addEventListener("click", toggleMute);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && MODE === "playing") pauseGame();
  });

  /* ------------------------------------------------------------------ *
   *  boot
   * ------------------------------------------------------------------ */

  syncMuteButton();
  genNight(1); // a pond waiting behind the title screen
  const e0 = entryTile();
  leader = { c: e0.c, r: e0.r, fc: e0.c, fr: e0.r };
  buildStarsAndFlakes();
  updateHUD();
  showTitle();
  requestAnimationFrame(loop);
})();
