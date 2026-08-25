/* Beacon Ridge — run fire along a moonless chalk ridge.
 * Relay the flame between seven hill-fort pyres before the night takes you.
 * Vanilla JS, no dependencies, everything drawn on one canvas.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };
  const TAU = Math.PI * 2;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let rng = mulberry32(12345);
  const rand = (a, b) => a + rng() * (b - a);

  function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  /* ------------------------------------------------------------------ *
   * constants
   * ------------------------------------------------------------------ */

  const W = 800;
  const H = 560;
  const WORLD_W = 5400;
  const WORLD_H = 1500;

  const TAPER_MAX = 24;
  const SPEED = 185;
  const ACCEL = 9;
  const BOG_MULT = 0.45;
  const BOG_TAPER = 1.4;
  const PLAYER_R = 13;

  const PYRE_COUNT = 7;
  const PYRE_FUEL = 68;
  const FUEL_CAP = 100;
  const FEED_ADD = 18;
  const KINDLE_TIME = 1.15;
  const PYRE_RANGE = 84;
  const PYRE_TOUCH = 62;

  const BUNDLE_COUNT = 12;
  const CARRY_MAX = 3;
  const PICKUP_R = 30;
  const FEED_CD = 0.35;

  const GUST_WARN = 1.15;
  const GUST_BLOW = 2.7;
  const GUST_DRAIN = 3;
  const GUST_PUSH = 96;

  const FORT_NAMES = [
    "Sea Gate",
    "Hare Down",
    "Gallows Knoll",
    "Chalk Barrow",
    "Shepherd's Rest",
    "Wind Stones",
    "Dawn Gate",
  ];

  /* ------------------------------------------------------------------ *
   * dom
   * ------------------------------------------------------------------ */

  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const darkCan = document.createElement("canvas");
  const dctx = darkCan.getContext("2d");

  const toastEl = $("toast");
  const overlayEl = $("overlay");
  const introPanel = $("introPanel");
  const pausePanel = $("pausePanel");
  const endPanel = $("endPanel");
  const endTitle = $("endTitle");
  const endStats = $("endStats");
  const endVerdict = $("endVerdict");
  const beginBtn = $("beginBtn");
  const againBtn = $("againBtn");
  const resumeBtn = $("resumeBtn");
  const restartBtn = $("restartBtn");
  const restartBtn2 = $("restartBtn2");
  const pauseBtn = $("pauseBtn");
  const soundBtn = $("soundBtn");
  const actBtn = $("actBtn");

  /* ------------------------------------------------------------------ *
   * audio — everything synthesised, nothing fetched
   * ------------------------------------------------------------------ */

  const Sfx = {
    ac: null,
    master: null,
    noiseBuf: null,
    windGain: null,
    muted: false,

    init() {
      if (this.ac) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = this.muted ? 0 : 0.85;
        this.master.connect(this.ac.destination);
        const len = this.ac.sampleRate * 2;
        this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ac.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const filt = this.ac.createBiquadFilter();
        filt.type = "bandpass";
        filt.frequency.value = 380;
        filt.Q.value = 0.55;
        this.windGain = this.ac.createGain();
        this.windGain.gain.value = 0.045;
        src.connect(filt);
        filt.connect(this.windGain);
        this.windGain.connect(this.master);
        src.start();
      } catch (err) {
        this.ac = null;
      }
    },

    resume() {
      if (this.ac && this.ac.state === "suspended") this.ac.resume();
    },

    setMuted(m) {
      this.muted = m;
      if (this.ac) {
        this.master.gain.setTargetAtTime(
          m ? 0 : 0.85,
          this.ac.currentTime,
          0.05,
        );
      }
    },

    windLevel(v) {
      if (!this.ac) return;
      this.windGain.gain.setTargetAtTime(
        0.045 + v * 0.24,
        this.ac.currentTime,
        0.3,
      );
    },

    tone(freq, dur, opts) {
      if (!this.ac || this.muted) return;
      const o = opts || {};
      const t0 = this.ac.currentTime + (o.delay || 0);
      const osc = this.ac.createOscillator();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (o.slideTo)
        osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.15, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },

    hiss(dur, opts) {
      if (!this.ac || this.muted) return;
      const o = opts || {};
      const t0 = this.ac.currentTime + (o.delay || 0);
      const src = this.ac.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filt = this.ac.createBiquadFilter();
      filt.type = o.fType || "bandpass";
      filt.frequency.setValueAtTime(o.freq || 1000, t0);
      if (o.slideFreq) {
        filt.frequency.exponentialRampToValueAtTime(o.slideFreq, t0 + dur);
      }
      filt.Q.value = o.q || 0.8;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(
        o.vol || 0.15,
        t0 + (o.attack || 0.03),
      );
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },

    ignite() {
      this.hiss(0.55, { freq: 1600, vol: 0.26 });
      this.tone(110, 0.5, { type: "sawtooth", vol: 0.13, slideTo: 460 });
      this.hiss(0.08, { freq: 2600, vol: 0.14, delay: 0.18 });
      this.hiss(0.06, { freq: 3100, vol: 0.1, delay: 0.3 });
    },

    douse() {
      this.tone(170, 0.75, { vol: 0.2, slideTo: 50 });
      this.hiss(0.35, { freq: 480, vol: 0.12 });
    },

    feed() {
      this.tone(215, 0.09, { type: "triangle", vol: 0.2 });
      this.tone(148, 0.13, { type: "triangle", vol: 0.16, delay: 0.07 });
    },

    pickup() {
      this.tone(660, 0.07, { type: "square", vol: 0.06 });
      this.tone(990, 0.1, { type: "square", vol: 0.05, delay: 0.06 });
    },

    refill() {
      this.tone(500, 0.14, { vol: 0.08, slideTo: 740 });
    },

    warn() {
      this.hiss(GUST_WARN + 0.4, {
        freq: 800,
        vol: 0.1,
        q: 2,
        slideFreq: 1900,
      });
      this.tone(280, 1.1, { vol: 0.045, slideTo: 620 });
    },

    surge() {
      this.hiss(GUST_BLOW + 0.3, { freq: 650, vol: 0.2, q: 0.7 });
    },

    win() {
      const notes = [294, 370, 440, 587];
      notes.forEach((f, i) => {
        this.tone(f, 0.6, { type: "triangle", vol: 0.13, delay: i * 0.14 });
        this.tone(f * 2, 0.5, { type: "sine", vol: 0.05, delay: i * 0.14 });
      });
      this.hiss(1.4, { freq: 5200, vol: 0.05, delay: 0.5 });
    },

    lose() {
      this.tone(196, 2.4, { vol: 0.2, slideTo: 46 });
      this.hiss(1.8, { freq: 300, vol: 0.14, slideFreq: 140 });
    },
  };

  /* ------------------------------------------------------------------ *
   * world state
   * ------------------------------------------------------------------ */

  let state = "intro"; // intro | running | paused | won | lost
  let world = null;
  let player = null;
  let gust = null;
  let particles = [];
  let cam = { x: 0, y: 0 };
  let elapsed = 0;
  let clock = 0;
  let litCount = 0;
  let winAt = -1;
  let fedCount = 0;
  let gustCount = 0;
  let sessionBest = null;
  let feedCd = 0;
  let refillToastCd = 0;
  let lowWarned = false;
  let toastTimer = null;

  /* ------------------------------------------------------------------ *
   * generation
   * ------------------------------------------------------------------ */

  function makeRidgePoints(base, amps, phases) {
    const M = 64;
    const pts = [];
    for (let i = 0; i < M; i++) {
      let hgt = base;
      for (let k = 0; k < amps.length; k++) {
        hgt += amps[k] * Math.sin((TAU * ((k + 2) * i)) / M + phases[k]);
      }
      pts.push(hgt);
    }
    return pts;
  }

  function genWorld() {
    rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
    world = {
      pyres: [],
      bogs: [],
      bundles: [],
      tufts: [],
      mottle: [],
      stars: [],
      pathSegs: [],
      ridgeFar: makeRidgePoints(
        150,
        [42, 26, 14],
        [rand(0, 6), rand(0, 6), rand(0, 6)],
      ),
      ridgeNear: makeRidgePoints(
        108,
        [30, 44, 18],
        [rand(0, 6), rand(0, 6), rand(0, 6)],
      ),
    };

    // pyres, strung along the ridge with a meander
    for (let i = 0; i < PYRE_COUNT; i++) {
      const fx = i / (PYRE_COUNT - 1);
      let tries = 0;
      let x = 0;
      let y = 0;
      do {
        x = 430 + fx * 4590 + rand(-70, 70);
        const bandLow = i % 2 === 0 ? 520 : 800;
        y = rand(bandLow, bandLow + 250);
        tries++;
      } while (
        tries < 40 &&
        world.pyres.some((p) => dist2(p.x, p.y, x, y) < 460 * 460)
      );
      world.pyres.push({
        x,
        y,
        name: FORT_NAMES[i],
        lit: false,
        fuel: 0,
        prog: 0,
        flick: rand(0, 6),
      });
    }
    world.pyres[0].lit = true;
    world.pyres[0].fuel = PYRE_FUEL;
    litCount = 1;

    for (let i = 0; i < PYRE_COUNT - 1; i++) {
      const a = world.pyres[i];
      const b = world.pyres[i + 1];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = rand(-90, 90);
      world.pathSegs.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        cx: mx + (-dy / len) * off,
        cy: my + (dx / len) * off,
      });
    }

    // bog pools
    let placed = 0;
    let guard = 0;
    while (placed < 9 && guard < 400) {
      guard++;
      const cx = rand(320, 5120);
      const cy = rand(380, 1180);
      if (
        world.pyres.some((p) => dist2(p.x, p.y, cx, cy) < 170 * 170) ||
        world.bogs.some((b) => dist2(b.cx, b.cy, cx, cy) < 260 * 260)
      ) {
        continue;
      }
      const verts = [];
      const n = 5 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        verts.push({
          ang: (k / n) * TAU + rand(-0.25, 0.25),
          rad: rand(40, 88),
        });
      }
      world.bogs.push({ cx, cy, verts });
      placed++;
    }

    const bogRadiusAt = (bog, ang) => {
      let best = 0;
      for (const v of bog.verts) {
        let d = Math.abs(((v.ang - ang + Math.PI * 3) % TAU) - Math.PI);
        d = Math.PI - d; // 0 when angles match
        if (d < 0.7) best = Math.max(best, v.rad * (1 - d));
      }
      return best || 55;
    };

    // brushwood bundles
    placed = 0;
    guard = 0;
    while (placed < BUNDLE_COUNT && guard < 500) {
      guard++;
      const bx = rand(280, 5140);
      const by = rand(370, 1190);
      if (world.pyres.some((p) => dist2(p.x, p.y, bx, by) < 110 * 110))
        continue;
      if (
        world.bogs.some(
          (b) =>
            dist2(b.cx, b.cy, bx, by) <
            (bogRadiusAt(b, Math.atan2(by - b.cy, bx - b.cx)) + 34) ** 2,
        )
      ) {
        continue;
      }
      if (world.bundles.some((u) => dist2(u.x, u.y, bx, by) < 90 * 90))
        continue;
      world.bundles.push({ x: bx, y: by, taken: false, ph: rand(0, 6) });
      placed++;
    }

    // dressing
    for (let i = 0; i < 420; i++) {
      world.tufts.push({
        x: rand(40, WORLD_W - 40),
        y: rand(330, WORLD_H - 40),
        h: rand(6, 14),
        ph: rand(0, 6),
      });
    }
    for (let i = 0; i < 46; i++) {
      world.mottle.push({
        x: rand(0, WORLD_W),
        y: rand(300, WORLD_H),
        r: rand(130, 330),
        lite: rng() < 0.5,
      });
    }
    for (let i = 0; i < 110; i++) {
      world.stars.push({
        sx: rand(0, W),
        sy: rand(0, H * 0.56),
        sz: rand(0.5, 1.7),
        ph: rand(0, 6),
      });
    }

    particles.length = 0;
  }

  function resetPlayer() {
    const p0 = world.pyres[0];
    player = {
      x: p0.x + 56,
      y: p0.y + 30,
      vx: 0,
      vy: 0,
      taper: TAPER_MAX,
      carry: 0,
      face: 1,
      step: 0,
      inBog: false,
    };
    cam.x = clamp(player.x - W / 2, 0, WORLD_W - W);
    cam.y = clamp(player.y - H / 2, 0, WORLD_H - H);
    elapsed = 0;
    fedCount = 0;
    gustCount = 0;
    feedCd = 0;
    refillToastCd = 0;
    lowWarned = false;
    winAt = -1;
    gust = { phase: "idle", t: 9, level: 0, dx: 1 };
  }

  /* ------------------------------------------------------------------ *
   * toast
   * ------------------------------------------------------------------ */

  function toast(msg, long) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => toastEl.classList.remove("show"),
      long ? 3200 : 2100,
    );
  }

  /* ------------------------------------------------------------------ *
   * input
   * ------------------------------------------------------------------ */

  const keys = Object.create(null);
  let movePtr = { active: false, x: 0, y: 0 };
  let actHeld = false;
  let prevActHeld = false;

  const MOVE_CODES = {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  };

  window.addEventListener("keydown", (e) => {
    const code = e.code;
    if (MOVE_CODES[code]) {
      keys[MOVE_CODES[code]] = true;
      movePtr.active = false;
      e.preventDefault();
      return;
    }
    if (code === "Space" || code === "Enter") {
      actHeld = true;
      Sfx.init();
      Sfx.resume();
      e.preventDefault();
      return;
    }
    if (code === "KeyE") {
      actHeld = true;
      Sfx.init();
      Sfx.resume();
      return;
    }
    if (code === "KeyP") {
      togglePause();
      return;
    }
    if (code === "KeyM") {
      toggleSound();
      return;
    }
    if (code === "KeyR") {
      startRun();
    }
  });

  window.addEventListener("keyup", (e) => {
    const code = e.code;
    if (MOVE_CODES[code]) {
      keys[MOVE_CODES[code]] = false;
      return;
    }
    if (code === "Space" || code === "Enter" || code === "KeyE") {
      if (!actBtnHeld) actHeld = false;
    }
  });

  let actBtnHeld = false;
  actBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    actBtnHeld = true;
    actHeld = true;
    Sfx.init();
    Sfx.resume();
  });
  const releaseActBtn = () => {
    actBtnHeld = false;
    if (!keys._spaceLock) actHeld = false;
  };
  actBtn.addEventListener("pointerup", releaseActBtn);
  actBtn.addEventListener("pointercancel", releaseActBtn);
  actBtn.addEventListener("pointerleave", releaseActBtn);
  actBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  function canvasToWorld(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * W) / rect.width;
    const sy = ((e.clientY - rect.top) * H) / rect.height;
    return { x: sx + cam.x, y: sy + cam.y };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    Sfx.init();
    Sfx.resume();
    const p = canvasToWorld(e);
    movePtr.active = true;
    movePtr.x = p.x;
    movePtr.y = p.y;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!movePtr.active) return;
    const p = canvasToWorld(e);
    movePtr.x = p.x;
    movePtr.y = p.y;
  });
  const endMove = () => {
    movePtr.active = false;
  };
  canvas.addEventListener("pointerup", endMove);
  canvas.addEventListener("pointercancel", endMove);

  /* ------------------------------------------------------------------ *
   * flow control
   * ------------------------------------------------------------------ */

  function showOnly(panel) {
    for (const el of [introPanel, pausePanel, endPanel]) {
      el.classList.toggle("hidden", el !== panel);
    }
    overlayEl.classList.toggle("hidden", !panel);
  }

  function startRun() {
    Sfx.init();
    Sfx.resume();
    genWorld();
    resetPlayer();
    state = "running";
    showOnly(null);
    pauseBtn.textContent = "Pause";
    toast("Wake the chain. Seven fires before dawn.", true);
  }

  function togglePause() {
    if (state === "running") {
      state = "paused";
      showOnly(pausePanel);
      pauseBtn.textContent = "Resume";
      Sfx.windLevel(0);
    } else if (state === "paused") {
      state = "running";
      showOnly(null);
      pauseBtn.textContent = "Pause";
    }
  }

  function toggleSound() {
    Sfx.init();
    Sfx.resume();
    Sfx.setMuted(!Sfx.muted);
    soundBtn.textContent = Sfx.muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", String(!Sfx.muted));
  }

  function endRun(won) {
    state = won ? "won" : "lost";
    Sfx.windLevel(0.1);
    if (won) {
      Sfx.win();
      if (sessionBest === null || elapsed < sessionBest) sessionBest = elapsed;
    } else {
      Sfx.lose();
    }
    endTitle.textContent = won
      ? "Dawn Finds the Ridge Burning"
      : "The Dark Takes You";
    endStats.textContent =
      litCount +
      "/7 fires burning · " +
      fmtTime(elapsed) +
      " · " +
      fedCount +
      " brushwood fed · " +
      gustCount +
      " gales weathered" +
      (won && sessionBest !== null
        ? " · tonight's best " + fmtTime(sessionBest)
        : "");
    let verdict;
    if (won) {
      verdict =
        elapsed < 78
          ? "They will sing of this run on both coasts."
          : elapsed < 115
            ? "Slow, smoky — but the whole down burned whole."
            : "The chain held. The sheep never even woke.";
    } else if (litCount >= 5) {
      verdict = "One gap short. The last stretch ate your ember.";
    } else if (litCount >= 2) {
      verdict = "The chain guttered midway, link by link.";
    } else {
      verdict = "Barely past the sea gate. The night is patient.";
    }
    endVerdict.textContent = verdict;
    showOnly(endPanel);
    pauseBtn.textContent = "Pause";
  }

  beginBtn.addEventListener("click", startRun);
  againBtn.addEventListener("click", startRun);
  restartBtn.addEventListener("click", startRun);
  restartBtn2.addEventListener("click", startRun);
  resumeBtn.addEventListener("click", () => {
    if (state === "paused") togglePause();
  });
  pauseBtn.addEventListener("click", togglePause);
  soundBtn.addEventListener("click", toggleSound);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "running") togglePause();
  });

  /* ------------------------------------------------------------------ *
   * update
   * ------------------------------------------------------------------ */

  function nearestPyreInRange() {
    let best = null;
    let bd = PYRE_RANGE * PYRE_RANGE;
    for (const p of world.pyres) {
      const d = dist2(player.x, player.y, p.x, p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function bogAt(x, y) {
    for (const b of world.bogs) {
      if (dist2(b.cx, b.cy, x, y) < 110 * 110) {
        const ang = Math.atan2(y - b.cy, x - b.cx);
        let rr = 0;
        for (const v of b.verts) {
          let d = Math.abs(((v.ang - ang + Math.PI * 3) % TAU) - Math.PI);
          d = Math.PI - d;
          rr += v.rad * Math.max(0, 1 - d / 1.4);
        }
        if (rr * 0.55 > Math.hypot(x - b.cx, y - b.cy)) return b;
      }
    }
    return null;
  }

  function spawnParticle(o) {
    if (particles.length > 340) particles.shift();
    particles.push(o);
  }

  function update(dt) {
    clock += dt;
    elapsed += dt;
    feedCd = Math.max(0, feedCd - dt);
    refillToastCd = Math.max(0, refillToastCd - dt);

    /* ---- gust machine ---- */
    gust.t -= dt;
    if (gust.phase === "idle" && gust.t <= 0) {
      gust.phase = "warn";
      gust.t = GUST_WARN;
      gust.dx = rng() < 0.5 ? -1 : 1;
      toast("A gale is coming — the flames will crouch.");
      Sfx.warn();
    } else if (gust.phase === "warn" && gust.t <= 0) {
      gust.phase = "blow";
      gust.t = GUST_BLOW;
      gustCount++;
      Sfx.surge();
    } else if (gust.phase === "blow" && gust.t <= 0) {
      gust.phase = "idle";
      gust.t = rand(9.5, 15.5);
    }
    const gustTarget =
      gust.phase === "blow" ? 1 : gust.phase === "warn" ? 0.3 : 0;
    gust.level += (gustTarget - gust.level) * Math.min(1, dt * 4);
    Sfx.windLevel(gust.level);

    /* ---- movement ---- */
    let ix = 0;
    let iy = 0;
    if (keys.left) ix -= 1;
    if (keys.right) ix += 1;
    if (keys.up) iy -= 1;
    if (keys.down) iy += 1;
    if (ix === 0 && iy === 0 && movePtr.active) {
      const dx = movePtr.x - player.x;
      const dy = movePtr.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > 8) {
        ix = dx / d;
        iy = dy / d;
      }
    } else if (ix !== 0 || iy !== 0) {
      const il = Math.hypot(ix, iy);
      ix /= il;
      iy /= il;
    }

    const bog = bogAt(player.x, player.y);
    player.inBog = !!bog;
    const mult = player.inBog ? BOG_MULT : 1;
    const tvx = ix * SPEED * mult;
    const tvy = iy * SPEED * mult;
    const k = Math.min(1, dt * ACCEL);
    player.vx = lerp(player.vx, tvx, k);
    player.vy = lerp(player.vy, tvy, k);
    player.x += player.vx * dt + gust.dx * GUST_PUSH * gust.level * dt;
    player.y += player.vy * dt;
    player.x = clamp(player.x, 26, WORLD_W - 26);
    player.y = clamp(player.y, 330, WORLD_H - 26);
    const sp = Math.hypot(player.vx, player.vy);
    if (sp > 12) {
      player.face = player.vx >= 0 ? 1 : -1;
      player.step += sp * dt * 0.09;
      if (Math.random() < dt * 22) {
        spawnParticle({
          type: "trail",
          x: player.x + rand(-3, 3),
          y: player.y - 14 + rand(-2, 2),
          vx: rand(-6, 6),
          vy: rand(-14, -4),
          life: rand(0.3, 0.55),
          age: 0,
          sz: rand(1.4, 2.6),
        });
      }
    }
    if (player.inBog && Math.random() < dt * 3) {
      spawnParticle({
        type: "ripple",
        x: player.x + rand(-8, 8),
        y: player.y + rand(-4, 6),
        vx: 0,
        vy: 0,
        life: 0.9,
        age: 0,
        sz: 4,
      });
    }

    /* ---- bundles ---- */
    if (player.carry < CARRY_MAX) {
      for (const u of world.bundles) {
        if (u.taken) continue;
        if (dist2(player.x, player.y, u.x, u.y) < PICKUP_R * PICKUP_R) {
          u.taken = true;
          player.carry++;
          Sfx.pickup();
          toast("Brushwood gathered (" + player.carry + "/" + CARRY_MAX + ").");
          break;
        }
      }
    }

    /* ---- pyre context: refill / kindle / feed ---- */
    const near = nearestPyreInRange();
    if (near && near.lit) {
      if (player.taper < TAPER_MAX - 0.5) {
        if (player.taper < TAPER_MAX * 0.55 && refillToastCd <= 0) {
          toast("Your taper drinks deep.", false);
          refillToastCd = 6;
          Sfx.refill();
          spawnParticle({
            type: "ring",
            x: player.x,
            y: player.y - 8,
            vx: 0,
            vy: 0,
            life: 0.5,
            age: 0,
            sz: 10,
            col: "255,214,140",
          });
        }
        player.taper = TAPER_MAX;
        lowWarned = false;
      }
      if (
        actHeld &&
        !prevActHeld &&
        player.carry > 0 &&
        near.fuel < FUEL_CAP - 1 &&
        feedCd <= 0
      ) {
        near.fuel = Math.min(FUEL_CAP, near.fuel + FEED_ADD);
        player.carry--;
        fedCount++;
        feedCd = FEED_CD;
        Sfx.feed();
        toast(near.name + " takes the brushwood. +" + FEED_ADD + "s");
        spawnParticle({
          type: "ring",
          x: near.x,
          y: near.y - 18,
          vx: 0,
          vy: 0,
          life: 0.6,
          age: 0,
          sz: 16,
          col: "255,202,135",
        });
      }
    } else if (near && !near.lit) {
      if (actHeld) {
        near.prog = Math.min(1, near.prog + dt / KINDLE_TIME);
        if (near.prog >= 1) {
          near.lit = true;
          near.prog = 0;
          near.fuel = PYRE_FUEL;
          litCount++;
          player.taper = TAPER_MAX;
          lowWarned = false;
          Sfx.ignite();
          toast(near.name + " burns!", true);
          for (let i = 0; i < 16; i++) {
            const a = rand(0, TAU);
            spawnParticle({
              type: "spark",
              x: near.x + Math.cos(a) * 8,
              y: near.y - 16 + Math.sin(a) * 6,
              vx: Math.cos(a) * rand(30, 110),
              vy: Math.sin(a) * rand(30, 90) - 50,
              life: rand(0.5, 0.9),
              age: 0,
              sz: rand(1.5, 3),
            });
          }
        }
      } else {
        near.prog = Math.max(0, near.prog - dt * 0.85);
      }
    }

    /* ---- pyres burn down ---- */
    const drainMult = gust.phase === "blow" ? GUST_DRAIN : 1;
    for (const p of world.pyres) {
      if (!p.lit) continue;
      p.fuel -= dt * drainMult;
      const fscale = Math.min(1, p.fuel / 9);
      if (Math.random() < dt * 18 * fscale) {
        spawnParticle({
          type: "spark",
          x: p.x + rand(-7, 7),
          y: p.y - rand(14, 34),
          vx: rand(-14, 14) + gust.dx * gust.level * 46,
          vy: rand(-70, -30),
          life: rand(0.4, 0.85),
          age: 0,
          sz: rand(1.2, 2.6),
        });
      }
      if (Math.random() < dt * 5) {
        spawnParticle({
          type: "smoke",
          x: p.x + rand(-6, 6),
          y: p.y - rand(30, 48),
          vx: rand(-6, 6) + gust.dx * gust.level * 30,
          vy: rand(-34, -22),
          life: rand(1.4, 2.4),
          age: 0,
          sz: rand(5, 9),
        });
      }
      if (p.fuel <= 0) {
        p.lit = false;
        p.fuel = 0;
        litCount--;
        winAt = -1;
        Sfx.douse();
        if (litCount === 0) {
          toast("Every fire is out. Only your ember answers now.", true);
        } else {
          toast("A fire has died in the dark.", true);
        }
      }
    }

    /* ---- taper & fail ---- */
    player.taper -= dt * (player.inBog ? BOG_TAPER : 1);
    if (player.taper < TAPER_MAX * 0.25 && !lowWarned) {
      lowWarned = true;
      toast("Your ember gutters — run for fire!", true);
    }
    if (player.taper <= 0) {
      player.taper = 0;
      endRun(false);
      return;
    }

    /* ---- win ---- */
    if (litCount >= PYRE_COUNT && winAt < 0) {
      winAt = elapsed + 0.9;
      toast("The whole ridge burns. Hold it to the light!", true);
    }
    if (winAt > 0 && elapsed >= winAt) {
      endRun(true);
      return;
    }

    prevActHeld = actHeld;

    /* ---- particles ---- */
    for (const pt of particles) {
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.type === "spark") pt.vy += 60 * dt;
      if (pt.type === "smoke") pt.sz += 6 * dt;
    }
    particles = particles.filter((pt) => pt.age < pt.life);

    /* ---- camera ---- */
    const tx = clamp(player.x + player.vx * 0.3 - W / 2, 0, WORLD_W - W);
    const ty = clamp(player.y + player.vy * 0.2 - H / 2, 0, WORLD_H - H);
    cam.x += (tx - cam.x) * Math.min(1, dt * 5);
    cam.y += (ty - cam.y) * Math.min(1, dt * 5);

    refreshActBtn(near);
  }

  let lastActLabel = "";
  function refreshActBtn(near) {
    let label = "";
    let enabled = false;
    if (state === "running" && near) {
      if (near.lit) {
        if (player.carry > 0 && near.fuel < FUEL_CAP - 1) {
          label = "Feed +" + FEED_ADD + "s";
          enabled = true;
        } else {
          label = "Burning";
        }
      } else {
        label = "Kindle";
        enabled = true;
      }
    }
    if (label !== lastActLabel) {
      lastActLabel = label;
      actBtn.textContent = label || "· · ·";
      if (enabled) {
        actBtn.removeAttribute("disabled");
      } else {
        actBtn.setAttribute("disabled", "");
      }
      actBtn.setAttribute(
        "aria-label",
        enabled ? label : "No pyre within reach",
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  let dpr = 1;

  function fitCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    darkCan.width = canvas.width;
    darkCan.height = canvas.height;
  }
  window.addEventListener("resize", fitCanvas);
  fitCanvas();

  function flickerOf(p) {
    const t = clock * 11 + p.flick;
    return 0.86 + 0.09 * Math.sin(t) + 0.05 * Math.sin(t * 2.7 + 1.3);
  }

  function drawWorldPass() {
    const ox = -cam.x;
    const oy = -cam.y;

    /* ground base */
    ctx.fillStyle = "#15221b";
    ctx.fillRect(cam.x, cam.y, W, H);

    /* soft mottling */
    for (const m of world.mottle) {
      const sx = m.x + ox;
      const sy = m.y + oy;
      if (sx < -m.r || sx > W + m.r || sy < -m.r || sy > H + m.r) continue;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, m.r);
      const col = m.lite ? "188, 205, 160" : "6, 12, 8";
      g.addColorStop(0, "rgba(" + col + ", 0.05)");
      g.addColorStop(1, "rgba(" + col + ", 0)");
      ctx.fillStyle = g;
      ctx.fillRect(sx - m.r, sy - m.r, m.r * 2, m.r * 2);
    }

    /* the chalk way */
    ctx.strokeStyle = "rgba(235, 228, 208, 0.13)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.setLineDash([13, 19]);
    for (const s of world.pathSegs) {
      ctx.beginPath();
      ctx.moveTo(s.ax + ox, s.ay + oy);
      ctx.quadraticCurveTo(s.cx + ox, s.cy + oy, s.bx + ox, s.by + oy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    /* grass tufts */
    ctx.strokeStyle = "rgba(196, 222, 168, 0.12)";
    ctx.lineWidth = 1.4;
    const sway = Math.sin(clock * 2.1) * 1.6 + gust.dx * gust.level * 5;
    for (const t of world.tufts) {
      const sx = t.x + ox;
      const sy = t.y + oy;
      if (sx < -8 || sx > W + 8 || sy < -14 || sy > H + 8) continue;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(
        sx + sway * 0.4,
        sy - t.h * 0.6,
        sx + sway,
        sy - t.h,
      );
      ctx.stroke();
    }

    /* bog pools */
    for (const b of world.bogs) {
      const sx = b.cx + ox;
      const sy = b.cy + oy;
      if (sx < -160 || sx > W + 160 || sy < -160 || sy > H + 160) continue;
      ctx.beginPath();
      for (let i = 0; i <= b.verts.length; i++) {
        const v = b.verts[i % b.verts.length];
        const px = sx + Math.cos(v.ang) * v.rad;
        const py = sy + Math.sin(v.ang) * v.rad * 0.72;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(16, 38, 48, 0.92)";
      ctx.fill();
      ctx.strokeStyle = "rgba(150, 205, 225, 0.14)";
      ctx.lineWidth = 2;
      ctx.stroke();

      /* sheen */
      const g = ctx.createLinearGradient(sx, sy - 30, sx, sy + 30);
      g.addColorStop(0, "rgba(160, 210, 230, 0.07)");
      g.addColorStop(1, "rgba(160, 210, 230, 0)");
      ctx.fillStyle = g;
      ctx.fill();
    }

    /* brushwood bundles */
    for (const u of world.bundles) {
      if (u.taken) continue;
      const sx = u.x + ox;
      const sy = u.y + oy + Math.sin(clock * 1.7 + u.ph) * 1.5;
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20);
      g.addColorStop(0, "rgba(255, 214, 140, 0.22)");
      g.addColorStop(1, "rgba(255, 214, 140, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(sx - 20, sy - 20, 40, 40);
      ctx.strokeStyle = "#8a6b38";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * 3.2, sy + 6);
        ctx.lineTo(sx + i * 5.4, sy - 7);
        ctx.stroke();
      }
      ctx.strokeStyle = "#c9a45c";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - 7, sy - 1);
      ctx.lineTo(sx + 7, sy + 1);
      ctx.stroke();
    }

    /* pyres */
    for (const p of world.pyres) {
      const sx = p.x + ox;
      const sy = p.y + oy;
      if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;

      /* stone ring */
      ctx.fillStyle = "#4c4f58";
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * 26, sy + Math.sin(a) * 17, 5.5, 0, TAU);
        ctx.fill();
      }
      /* log teepee */
      ctx.strokeStyle = p.lit ? "#5c4326" : "#39352d";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI - Math.PI + 0.35;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 16, sy + 6);
        ctx.lineTo(sx - Math.cos(a) * 4, sy - 26);
        ctx.stroke();
      }

      if (p.lit) {
        const fl = flickerOf(p);
        const fs = Math.min(1, p.fuel / 9);
        const lean = gust.dx * gust.level * 0.55;

        /* ground glow */
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const gg = ctx.createRadialGradient(
          sx,
          sy - 10,
          4,
          sx,
          sy - 10,
          130 * fl,
        );
        gg.addColorStop(0, "rgba(255, 158, 64, 0.34)");
        gg.addColorStop(0.5, "rgba(255, 120, 40, 0.12)");
        gg.addColorStop(1, "rgba(255, 120, 40, 0)");
        ctx.fillStyle = gg;
        ctx.fillRect(sx - 140 * fl, sy - 150 * fl, 280 * fl, 290 * fl);

        /* flames */
        const tongues = [
          { h: 46, w: 15, col: "rgba(255, 92, 43, 0.85)", off: 0 },
          { h: 34, w: 11, col: "rgba(255, 155, 61, 0.9)", off: 2.1 },
          { h: 22, w: 7, col: "rgba(255, 224, 138, 0.95)", off: 4.2 },
        ];
        for (const tg of tongues) {
          const th = tg.h * fl * fs;
          const wob = Math.sin(clock * 9 + tg.off) * 3;
          const tipX = sx + lean * th + wob;
          ctx.beginPath();
          ctx.moveTo(sx - tg.w, sy - 12);
          ctx.quadraticCurveTo(
            sx - tg.w * 0.7,
            sy - 12 - th * 0.55,
            tipX,
            sy - 12 - th,
          );
          ctx.quadraticCurveTo(
            sx + tg.w * 0.7,
            sy - 12 - th * 0.55,
            sx + tg.w,
            sy - 12,
          );
          ctx.closePath();
          ctx.fillStyle = tg.col;
          ctx.fill();
        }
        ctx.restore();

        /* smoke handled by particles */

        /* fuel ring */
        const frac = clamp(p.fuel / PYRE_FUEL, 0, 1);
        const ringCol =
          frac > 0.5 ? "#ffd27a" : frac > 0.25 ? "#ff9b3d" : "#ff5a4a";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(sx, sy - 62, 22, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = ringCol;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(sx, sy - 62, 22, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        ctx.stroke();
        if (frac <= 0.25) {
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(clock * 8);
          ctx.strokeStyle = "rgba(255, 74, 58, 0.5)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(sx, sy - 62, 28, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else {
        /* kindle progress */
        if (p.prog > 0) {
          ctx.strokeStyle = "rgba(255, 214, 140, 0.9)";
          ctx.lineWidth = 5;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(sx, sy - 62, 22, -Math.PI / 2, -Math.PI / 2 + TAU * p.prog);
          ctx.stroke();
        }
        if (
          state === "running" &&
          dist2(player.x, player.y, p.x, p.y) < PYRE_RANGE * PYRE_RANGE &&
          p.prog === 0
        ) {
          ctx.fillStyle = "rgba(232, 224, 204, 0.72)";
          ctx.font = "italic 12px Georgia, serif";
          ctx.textAlign = "center";
          ctx.fillText("hold to kindle", sx, sy - 76);
        }
      }
    }

    /* ripple + ring particles */
    for (const pt of particles) {
      if (pt.type !== "ripple" && pt.type !== "ring") continue;
      const lt = pt.age / pt.life;
      ctx.strokeStyle =
        "rgba(" +
        (pt.col || "170, 215, 235") +
        ", " +
        (0.55 * (1 - lt)).toFixed(3) +
        ")";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pt.x + ox, pt.y + oy, pt.sz + lt * 26, 0, TAU);
      ctx.stroke();
    }

    /* player */
    drawPlayer(ox, oy);

    /* spark / smoke / trail particles */
    for (const pt of particles) {
      if (pt.type === "ripple" || pt.type === "ring") continue;
      const sx = pt.x + ox;
      const sy = pt.y + oy;
      const lt = pt.age / pt.life;
      if (pt.type === "smoke") {
        ctx.fillStyle =
          "rgba(150, 160, 185, " + (0.14 * (1 - lt)).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(sx, sy, pt.sz, 0, TAU);
        ctx.fill();
      } else {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const warm = pt.type === "trail" ? "255, 190, 120" : "255, 168, 82";
        ctx.fillStyle =
          "rgba(" + warm + ", " + (0.9 * (1 - lt)).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(sx, sy, pt.sz * (1 - lt * 0.6), 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawPlayer(ox, oy) {
    const sx = player.x + ox;
    const sy = player.y + oy;
    const bob = Math.abs(Math.sin(player.step)) * 2.2;
    const moving = Math.hypot(player.vx, player.vy) > 12;

    /* shadow */
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + 4, 11, 4.5, 0, 0, TAU);
    ctx.fill();

    /* legs */
    if (moving) {
      ctx.strokeStyle = "#2c2620";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      const st = Math.sin(player.step) * 5;
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy - 4);
      ctx.lineTo(sx - 3 + st, sy + 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + 3, sy - 4);
      ctx.lineTo(sx + 3 - st, sy + 3);
      ctx.stroke();
    }

    /* cloak */
    const sway = Math.sin(clock * 6) * 1.2 + player.vx * 0.02;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 2);
    ctx.quadraticCurveTo(sx - 6 + sway, sy - 22, sx, sy - 26);
    ctx.quadraticCurveTo(sx + 7 + sway, sy - 20, sx + 8, sy - 2);
    ctx.closePath();
    ctx.fillStyle = "#3d4a63";
    ctx.fill();
    ctx.strokeStyle = "#232c3e";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* head */
    ctx.fillStyle = "#d9cdb0";
    ctx.beginPath();
    ctx.arc(sx + sway * 0.4, sy - 30, 4.6, 0, TAU);
    ctx.fill();

    /* the ember */
    const ex = sx + player.face * 9;
    const ey = sy - 16 - bob;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 16);
    eg.addColorStop(0, "rgba(255, 176, 80, 0.85)");
    eg.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = eg;
    ctx.fillRect(ex - 16, ey - 16, 32, 32);
    ctx.restore();
    ctx.fillStyle = "#ffd9a0";
    ctx.beginPath();
    ctx.arc(ex, ey, 2.6, 0, TAU);
    ctx.fill();

    /* taper stick */
    ctx.strokeStyle = "#6b5233";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sx + player.face * 5, sy - 8);
    ctx.lineTo(ex, ey + 2);
    ctx.stroke();
  }

  function drawSkyAndRidges() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#04060f");
    sky.addColorStop(0.55, "#0a1026");
    sky.addColorStop(1, "#101a33");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* stars */
    for (const s of world.stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(clock * 0.7 + s.ph));
      ctx.fillStyle = "rgba(220, 228, 255, " + (0.5 * tw).toFixed(3) + ")";
      ctx.fillRect(s.sx, s.sy, s.sz, s.sz);
    }

    /* parallax ridges */
    const drawRidge = (pts, col, px, baseY) => {
      const step = W / (pts.length - 1);
      const shift = (((cam.x * px) % W) + W) % W;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-shift, H);
      for (let rep = -1; rep <= 1; rep++) {
        for (let i = 0; i < pts.length; i++) {
          const x = i * step - shift + rep * W;
          const y = baseY - pts[i] - cam.y * px * 0.35;
          ctx.lineTo(x, y);
        }
      }
      ctx.lineTo(W * 2, H);
      ctx.closePath();
      ctx.fill();
    };
    drawRidge(world.ridgeFar, "#0a1124", 0.18, 330);
    drawRidge(world.ridgeNear, "#0c1526", 0.4, 372);
  }

  function drawDarkness() {
    const dawnFade = state === "won" ? clamp((clock - winClock) / 3, 0, 1) : 0;
    if (dawnFade >= 1) return;

    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle =
      "rgba(3, 5, 14, " + (0.93 * (1 - dawnFade)).toFixed(3) + ")";
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = "destination-out";

    const hole = (wx, wy, rad, str) => {
      const sx = wx - cam.x;
      const sy = wy - cam.y;
      if (sx < -rad || sx > W + rad || sy < -rad || sy > H + rad) return;
      const g = dctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      g.addColorStop(0, "rgba(0, 0, 0, " + str.toFixed(3) + ")");
      g.addColorStop(0.55, "rgba(0, 0, 0, " + (str * 0.75).toFixed(3) + ")");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      dctx.fillStyle = g;
      dctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    };

    for (const p of world.pyres) {
      if (p.lit) hole(p.x, p.y - 14, 250 * flickerOf(p), 0.97);
      else hole(p.x, p.y - 10, 92, 0.3);
    }
    const prad = 64 + 116 * (player.taper / TAPER_MAX);
    hole(player.x, player.y - 12, prad + Math.sin(clock * 9) * 4, 0.99);
    for (const u of world.bundles) {
      if (!u.taken) hole(u.x, u.y, 30, 0.5);
    }

    ctx.drawImage(darkCan, 0, 0, W, H);
  }

  let winClock = 0;

  function drawPostDarkness() {
    const ox = -cam.x;
    const oy = -cam.y;

    /* ghost markers for cold pyres + names when close */
    for (const p of world.pyres) {
      const sx = p.x + ox;
      const sy = p.y + oy;
      if (sx < -60 || sx > W + 60 || sy < -80 || sy > H + 60) continue;
      if (!p.lit) {
        const pul = 0.16 + 0.09 * Math.sin(clock * 2.2 + p.flick);
        ctx.fillStyle = "rgba(200, 212, 255, " + pul.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(sx, sy - 44, 3.2, 0, TAU);
        ctx.fill();
      }
      const d = Math.sqrt(dist2(player.x, player.y, p.x, p.y));
      if (d < 460) {
        const al = clamp(1 - d / 460, 0, 1) * 0.65;
        ctx.fillStyle = "rgba(232, 224, 204, " + al.toFixed(3) + ")";
        ctx.font = "11px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText(p.name, sx, sy - 92);
      }
    }

    /* wind streaks */
    if (gust.level > 0.05) {
      const n = Math.floor(gust.level * 16);
      ctx.strokeStyle = "rgba(190, 205, 235, 0.14)";
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const yy = (((i * 97.3 + clock * 900 * gust.dx) % H) + H) % H;
        const xx = ((i * 211.7 + clock * 1400 * gust.dx) % (W + 240)) - 120;
        ctx.beginPath();
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx - 90 * gust.dx, yy + 3);
        ctx.stroke();
      }
    }

    /* vignette */
    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.42,
      W / 2,
      H / 2,
      H * 0.86,
    );
    vg.addColorStop(0, "rgba(0, 0, 0, 0)");
    vg.addColorStop(1, "rgba(0, 0, 0, 0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    /* ---- HUD ---- */
    ctx.textAlign = "left";

    /* fires counter */
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(232, 224, 204, 0.85)";
    ctx.fillText("FIRES", 16, 26);
    for (let i = 0; i < PYRE_COUNT; i++) {
      const px = 66 + i * 19;
      const py = 21;
      const lit = world.pyres[i] && world.pyres[i].lit;
      ctx.beginPath();
      ctx.moveTo(px, py + 7);
      ctx.quadraticCurveTo(px - 5, py + 1, px, py - 6);
      ctx.quadraticCurveTo(px + 5, py + 1, px, py + 7);
      if (lit) {
        ctx.fillStyle = "#ffab4a";
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(232, 224, 204, 0.4)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    /* timer */
    ctx.font = "600 14px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(232, 224, 204, 0.8)";
    ctx.fillText(fmtTime(elapsed), W - 16, 27);
    ctx.textAlign = "left";

    /* minimap */
    const mw = 216;
    const mh = 46;
    const mx = (W - mw) / 2;
    const my = 10;
    ctx.fillStyle = "rgba(5, 8, 18, 0.55)";
    ctx.strokeStyle = "rgba(255, 217, 160, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(mx, my, mw, mh, 8);
    ctx.fill();
    ctx.stroke();
    const mxs = (wx) => mx + 10 + (wx / WORLD_W) * (mw - 20);
    const mys = (wy) => my + 12 + (wy / WORLD_H) * (mh - 24);
    ctx.strokeStyle = "rgba(232, 224, 204, 0.18)";
    ctx.beginPath();
    for (let i = 0; i < world.pyres.length; i++) {
      const p = world.pyres[i];
      if (i === 0) ctx.moveTo(mxs(p.x), mys(p.y));
      else ctx.lineTo(mxs(p.x), mys(p.y));
    }
    ctx.stroke();
    for (const p of world.pyres) {
      ctx.beginPath();
      if (p.lit) {
        ctx.fillStyle = "#ffab4a";
        ctx.shadowColor = "#ff9b3d";
        ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = "#5d6470";
        ctx.shadowBlur = 0;
      }
      ctx.arc(mxs(p.x), mys(p.y), 3, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      mxs(player.x),
      mys(player.y),
      2.2 + Math.sin(clock * 6) * 0.6,
      0,
      TAU,
    );
    ctx.fill();
    /* view rectangle */
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.strokeRect(
      mxs(cam.x),
      mys(cam.y),
      (W / WORLD_W) * (mw - 20),
      (H / WORLD_H) * (mh - 24),
    );

    /* gale banner */
    if (gust.level > 0.08) {
      const blink =
        gust.phase === "warn" ? 0.4 + 0.6 * Math.abs(Math.sin(clock * 9)) : 1;
      ctx.globalAlpha = blink;
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#cfd9ff";
      const arrows = gust.dx > 0 ? "» » »" : "« « «";
      ctx.fillText(arrows + "  GALE  " + arrows, W / 2, my + mh + 24);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }

    /* taper gauge */
    const gw = 168;
    const gx = 16;
    const gy = H - 30;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(232, 224, 204, 0.75)";
    ctx.fillText("TAPER", gx, gy - 6);
    ctx.strokeStyle = "rgba(255, 230, 190, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, 12);
    const tf = clamp(player.taper / TAPER_MAX, 0, 1);
    const lowPulse = tf < 0.22 ? 0.55 + 0.45 * Math.sin(clock * 10) : 1;
    ctx.globalAlpha = lowPulse;
    const tg = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    tg.addColorStop(0, "#ffd27a");
    tg.addColorStop(1, tf > 0.5 ? "#ff9b3d" : "#ff5a3a");
    ctx.fillStyle = tg;
    ctx.fillRect(gx + 1.5, gy + 1.5, (gw - 3) * tf, 9);
    ctx.globalAlpha = 1;

    /* carried bundles */
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(232, 224, 204, 0.75)";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("BRUSHWOOD", W - 16, gy - 6);
    for (let i = 0; i < CARRY_MAX; i++) {
      const bx = W - 30 - i * 24;
      const have = i < player.carry;
      ctx.strokeStyle = have ? "#c9a45c" : "rgba(201, 164, 92, 0.25)";
      ctx.lineWidth = 2.2;
      for (let j = -1; j <= 1; j++) {
        ctx.beginPath();
        ctx.moveTo(bx + j * 3, gy + 9);
        ctx.lineTo(bx + j * 5, gy - 4);
        ctx.stroke();
      }
    }
    ctx.textAlign = "left";

    /* dawn wash */
    if (state === "won") {
      const df = clamp((clock - winClock) / 3, 0, 1);
      const dg = ctx.createLinearGradient(0, 0, 0, H);
      dg.addColorStop(0, "rgba(255, 186, 100, " + (0.55 * df).toFixed(3) + ")");
      dg.addColorStop(
        0.6,
        "rgba(255, 150, 80, " + (0.18 * df).toFixed(3) + ")",
      );
      dg.addColorStop(1, "rgba(255, 120, 70, 0)");
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, W, H);
      const sunY = H * 0.62 - df * H * 0.24;
      const sg = ctx.createRadialGradient(
        W * 0.68,
        sunY,
        4,
        W * 0.68,
        sunY,
        130,
      );
      sg.addColorStop(0, "rgba(255, 236, 190, " + (0.9 * df).toFixed(3) + ")");
      sg.addColorStop(1, "rgba(255, 200, 120, 0)");
      ctx.fillStyle = sg;
      ctx.fillRect(W * 0.68 - 140, sunY - 140, 280, 280);
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSkyAndRidges();
    ctx.save();
    drawWorldPass();
    ctx.restore();
    drawDarkness();
    drawPostDarkness();
  }

  /* ------------------------------------------------------------------ *
   * main loop
   * ------------------------------------------------------------------ */

  let tPrev = performance.now();

  function frame(ts) {
    const dt = Math.min(0.05, (ts - tPrev) / 1000);
    tPrev = ts;
    if (state === "running") {
      update(dt);
    } else {
      clock += dt;
      if (state === "won" && winClock === 0) winClock = clock;
      if (state === "won") Sfx.windLevel(0.1);
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */

  genWorld();
  resetPlayer();
  showOnly(introPanel);
  requestAnimationFrame(frame);
})();
