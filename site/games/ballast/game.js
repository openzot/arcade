/**
 * Ballast — ride a hot-air balloon across a dawn mountain pass.
 * Burn to rise, vent to fall; every altitude carries its own wind.
 * Vanilla canvas game; no dependencies, no network.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  tiny helpers
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

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

  /* ------------------------------------------------------------------ *
   *  constants
   * ------------------------------------------------------------------ */

  const VH = 720; // virtual view height
  const CEIL_Y = 84; // frost ceiling
  const GY = 636; // valley floor
  const NEUTRAL_HEAT = 46;
  const LAND_VY = 76; // gentler than this to set down
  const BURN_RATE = 13.5; // fuel per second
  const HEAT_UP = 58; // heat per second while burning
  const HEAT_DECAY = 8.5;
  const HEAT_VENT = 150;
  const DEAD_GRACE = 6.5; // seconds of dying wind before it kills you

  const LEGS = [
    {
      len: 5200,
      dur: 80,
      fuel: 100,
      ballast: 2,
      seed: 11,
      gust: 0,
      thermalAt: 1.1,
      thermals: 0,
      bands: [
        [90, 22],
        [280, 55],
        [430, 88],
        [660, 45],
      ],
      spires: [
        { x: 2450, w: 74, h: 300 },
        { x: 3650, w: 96, h: 236 },
      ],
      crags: [],
      meadow: [4350, 5050],
    },
    {
      len: 6400,
      dur: 86,
      fuel: 96,
      ballast: 2,
      seed: 23,
      gust: 0,
      thermalAt: 1.1,
      thermals: 0,
      bands: [
        [90, -18],
        [250, 42],
        [420, 92],
        [560, 118],
        [680, 48],
      ],
      spires: [
        { x: 2150, w: 80, h: 350 },
        { x: 3350, w: 70, h: 300 },
        { x: 4750, w: 104, h: 268 },
        { x: 5500, w: 66, h: 330 },
      ],
      crags: [],
      meadow: [5500, 6280],
    },
    {
      len: 7500,
      dur: 92,
      fuel: 92,
      ballast: 2,
      seed: 37,
      gust: 0.08,
      thermalAt: 0.75,
      thermals: 3,
      bands: [
        [90, -45],
        [190, 58],
        [300, 125],
        [430, 68],
        [570, 105],
        [690, 38],
      ],
      spires: [
        { x: 2550, w: 88, h: 330 },
        { x: 4100, w: 76, h: 372 },
        { x: 5900, w: 98, h: 296 },
      ],
      crags: [
        { x: 3150, w: 130, h: 208 },
        { x: 5000, w: 150, h: 236 },
      ],
      meadow: [6550, 7360],
    },
    {
      len: 8800,
      dur: 98,
      fuel: 90,
      ballast: 2,
      seed: 53,
      gust: 0.2,
      thermalAt: 0.32,
      thermals: 5,
      bands: [
        [90, -62],
        [200, 68],
        [320, 116],
        [460, -12],
        [580, 112],
        [700, 52],
      ],
      spires: [
        { x: 1950, w: 84, h: 356 },
        { x: 3050, w: 66, h: 392 },
        { x: 4500, w: 110, h: 310 },
        { x: 6300, w: 72, h: 366 },
        { x: 7400, w: 96, h: 288 },
      ],
      crags: [
        { x: 2500, w: 140, h: 222 },
        { x: 3900, w: 120, h: 198 },
        { x: 5600, w: 160, h: 252 },
        { x: 7000, w: 128, h: 214 },
      ],
      meadow: [7750, 8620],
    },
    {
      len: 10200,
      dur: 108,
      fuel: 92,
      ballast: 2,
      seed: 71,
      gust: 0.28,
      thermalAt: 0.3,
      thermals: 6,
      bands: [
        [90, -72],
        [190, 78],
        [290, 135],
        [420, -22],
        [520, 122],
        [600, 145],
        [720, 48],
      ],
      spires: [
        { x: 1750, w: 78, h: 370 },
        { x: 2750, w: 62, h: 400 },
        { x: 3850, w: 96, h: 330 },
        { x: 4900, w: 70, h: 386 },
        { x: 6100, w: 116, h: 316 },
        { x: 7300, w: 66, h: 396 },
        { x: 8600, w: 88, h: 300 },
      ],
      crags: [
        { x: 2250, w: 132, h: 216 },
        { x: 3350, w: 148, h: 244 },
        { x: 5450, w: 136, h: 228 },
        { x: 6800, w: 156, h: 256 },
        { x: 8100, w: 124, h: 206 },
      ],
      meadow: [9350, 9980],
      monastery: true,
    },
  ];


  /* ------------------------------------------------------------------ *
   *  dom
   * ------------------------------------------------------------------ */

  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const frame = $("frame");
  const chipLeg = $("chipLeg");
  const chipFuel = $("chipFuel");
  const chipBallast = $("chipBallast");
  const heatFill = $("heatFill");
  const sunDisc = $("sunDisc");
  const altScale = $("altScale");
  const toastEl = $("toast");
  const overlay = $("overlay");
  const ovTitle = $("ovTitle");
  const ovTagline = $("ovTagline");
  const ovBody = $("ovBody");
  const ovKeys = $("ovKeys");
  const btnGo = $("btnGo");
  const btnSound = $("btnSound");
  const btnPause = $("btnPause");
  const padBurn = $("padBurn");
  const padVent = $("padVent");
  const padBallast = $("padBallast");

  /* ------------------------------------------------------------------ *
   *  audio — all synthesised
   * ------------------------------------------------------------------ */

  const Sfx = {
    ac: null,
    muted: false,
    master: null,
    windGain: null,
    windFilter: null,
    burnGain: null,

    ensure() {
      if (this.ac || this.muted === null) return;
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this.muted = null; // no audio available; stay silent forever
        return;
      }
      this.master = this.ac.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ac.destination);

      // wind: looped noise -> lowpass -> gain
      const len = this.ac.sampleRate * 2;
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) {
        v = v * 0.97 + (Math.random() * 2 - 1) * 0.05;
        d[i] = v * 3;
      }
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.windFilter = this.ac.createBiquadFilter();
      this.windFilter.type = "lowpass";
      this.windFilter.frequency.value = 420;
      this.windGain = this.ac.createGain();
      this.windGain.gain.value = 0;
      src.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      src.start();

      // burner: noise -> bandpass -> gain
      const src2 = this.ac.createBufferSource();
      src2.buffer = buf;
      src2.loop = true;
      const bp = this.ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 950;
      bp.Q.value = 0.7;
      this.burnGain = this.ac.createGain();
      this.burnGain.gain.value = 0;
      src2.connect(bp);
      bp.connect(this.burnGain);
      this.burnGain.connect(this.master);
      src2.start();
    },

    resume() {
      this.ensure();
      if (this.ac && this.ac.state === "suspended") this.ac.resume();
    },

    setWind(rel) {
      if (!this.ac) return;
      const g = this.muted ? 0 : clamp(Math.abs(rel) / 260, 0, 1) * 0.5;
      this.windGain.gain.setTargetAtTime(g, this.ac.currentTime, 0.09);
      this.windFilter.frequency.setTargetAtTime(
        300 + Math.abs(rel) * 1.6,
        this.ac.currentTime,
        0.1,
      );
    },

    setBurn(on) {
      if (!this.ac) return;
      this.burnGain.gain.setTargetAtTime(
        this.muted ? 0 : on ? 0.34 : 0,
        this.ac.currentTime,
        0.05,
      );
    },

    blip(freq, dur, type, vol) {
      if (!this.ac || this.muted) return;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.2, this.ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ac.currentTime + dur);
      o.connect(g);
      g.connect(this.master);
      o.start();
      o.stop(this.ac.currentTime + dur + 0.05);
    },

    thud() {
      if (!this.ac || this.muted) return;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(120, this.ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(38, this.ac.currentTime + 0.28);
      g.gain.setValueAtTime(0.5, this.ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ac.currentTime + 0.34);
      o.connect(g);
      g.connect(this.master);
      o.start();
      o.stop(this.ac.currentTime + 0.4);
    },

    fanfare() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) =>
        setTimeout(() => this.blip(f, 0.5, "triangle", 0.22), i * 130),
      );
    },

    chime() {
      const notes = [784, 988, 1175];
      notes.forEach((f, i) =>
        setTimeout(() => this.blip(f, 0.42, "sine", 0.18), i * 90),
      );
    },
  };

  /* ------------------------------------------------------------------ *
   *  state
   * ------------------------------------------------------------------ */

  let mode = "title"; // title | flying | landed | crashed | victory
  let paused = false;
  let legIndex = 0;
  let totalStars = 0;

  const bal = {
    x: 300,
    y: 470,
    vx: 0,
    vy: 0,
    heat: NEUTRAL_HEAT + 6,
    fuel: 100,
    ballast: 2,
    burning: false,
    venting: false,
    tilt: 0,
  };

  let leg = null; // active leg definition
  let cols = []; // thermal columns
  let streaks = []; // wind streak particles
  let motes = []; // sparks / sand / puffs
  let starsSky = [];
  let ridges = []; // parallax layers
  let t = 0; // leg time
  let phase = 0; // sun phase 0..1
  let windDead = false;
  let deadT = 0;
  let camX = 0;
  let scaleF = 1;
  let cssW = 960;
  let cssH = 540;
  let toastTimer = null;
  let lastTouch = 0;

  /* ------------------------------------------------------------------ *
   *  layout / canvas
   * ------------------------------------------------------------------ */

  function fitCanvas() {
    const r = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = Math.max(320, r.width);
    cssH = Math.max(240, r.height);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scaleF = cssH / VH;
  }

  window.addEventListener("resize", fitCanvas);

  /* ------------------------------------------------------------------ *
   *  leg setup
   * ------------------------------------------------------------------ */

  function makeRidge(seed, baseY, amp, step) {
    const rnd = mulberry32(seed);
    const pts = [];
    let x = 0;
    let y = baseY;
    let dir = 1;
    while (x < 26000) {
      pts.push([x, y]);
      x += step * (0.6 + rnd() * 0.9);
      dir = rnd() < 0.5 ? -1 : 1;
      y = clamp(y + dir * amp * (0.25 + rnd()), baseY - amp, baseY + amp * 0.6);
    }
    return pts;
  }

  function startLeg(i) {
    legIndex = i;
    leg = LEGS[i];
    bal.x = 260;
    bal.y = 470;
    bal.vx = 0;
    bal.vy = 0;
    bal.heat = NEUTRAL_HEAT + 8;
    bal.fuel = leg.fuel;
    bal.ballast = leg.ballast;
    bal.tilt = 0;
    t = 0;
    phase = 0;
    windDead = false;
    deadT = 0;
    streaks.length = 0;
    motes.length = 0;
    cols = [];
    const rnd = mulberry32(leg.seed * 977 + 5);
    for (let k = 0; k < leg.thermals; k++) {
      cols.push({
        x: 900 + rnd() * (leg.len - 2100),
        w: 110 + rnd() * 70,
        str: 95 + rnd() * 55,
      });
    }
    starsSky = [];
    const sr = mulberry32(leg.seed + 999);
    for (let k = 0; k < 90; k++) {
      starsSky.push([sr() * 1.2, sr() * 0.55, sr(), 0.6 + sr() * 1.6]);
    }
    ridges = [
      makeRidge(leg.seed + 1, 470, 90, 260),
      makeRidge(leg.seed + 2, 530, 70, 190),
      makeRidge(leg.seed + 3, 596, 46, 130),
    ];
    camX = bal.x - (cssW / scaleF) * 0.38;
    updateHUDStatic();
    hideOverlay();
    mode = "flying";
    paused = false;
    lastTouch = performance.now();
  }

  /* ------------------------------------------------------------------ *
   *  wind field
   * ------------------------------------------------------------------ */

  function windAt(y) {
    const pts = leg.bands;
    let mult = 1;
    if (leg.gust > 0) {
      mult =
        1 +
        leg.gust * Math.sin(t * 0.85) +
        leg.gust * 0.55 * Math.sin(t * 2.3 + 1.7);
    }
    if (windDead) mult *= 0.25;
    if (y <= pts[0][0]) return pts[0][1] * mult;
    for (let i = 1; i < pts.length; i++) {
      if (y <= pts[i][0]) {
        const f = (y - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return lerp(pts[i - 1][1], pts[i][1], f) * mult;
      }
    }
    return pts[pts.length - 1][1] * mult;
  }

  /* ------------------------------------------------------------------ *
   *  simulation
   * ------------------------------------------------------------------ */

  function crash(reason) {
    if (mode !== "flying") return;
    mode = "crashed";
    Sfx.setBurn(false);
    Sfx.thud();
    shake = 14;
    showOverlay(
      "Down in the Pass",
      "",
      reason +
        ` You made ${metresDone()} m of the crossing. The meadow waits — cast off again.`,
      [],
      "Retry leg ⏎",
    );
  }

  function metresDone() {
    return Math.max(0, Math.round((bal.x - 260) / 10));
  }

  function land() {
    if (mode !== "flying") return;
    mode = "landed";
    Sfx.setBurn(false);
    Sfx.chime();
    const soft = Math.abs(bal.vy);
    const fuelPct = Math.round(bal.fuel);
    let st = 1;
    if (bal.fuel > leg.fuel * 0.32) st++;
    if (bal.ballast === leg.ballast && soft < 40) st++;
    totalStars += st;
    const starStr = "★".repeat(st) + "☆".repeat(3 - st);
    const next = legIndex + 1;
    if (next >= LEGS.length) {
      mode = "victory";
      setTimeout(() => Sfx.fanfare(), 250);
      showOverlay(
        "Over the Pass",
        `${starStr}`,
        `Set down soft (${Math.round(soft)} u) with ${fuelPct}% of your fuel and ${bal.ballast} bag${
          bal.ballast === 1 ? "" : "s"
        } still hung. The monastery bell rings you in — five crossings, ${totalStars} of ${
          LEGS.length * 3
        } stars.`,
        [],
        "Fly again ⏎",
      );
    } else {
      showOverlay(
        `Leg ${legIndex + 1} — Set Down`,
        starStr,
        `Soft enough (${Math.round(soft)} u), ${fuelPct}% fuel left, ${bal.ballast} bag${
          bal.ballast === 1 ? "" : "s"
        } aboard. The next meadow lies higher and meaner.`,
        [],
        "Next leg ⏎",
      );
    }
  }

  let shake = 0;

  function step(dt) {
    t += dt;
    phase = clamp(t / leg.dur, 0, 1);

    // ---- controls -------------------------------------------------
    const wantBurn =
      bal.fuel > 0 && (keys.burn || padBurn.classList.contains("held"));
    const wantVent = keys.vent || padVent.classList.contains("held");
    bal.burning = wantBurn;
    bal.venting = wantVent && !wantBurn;
    if (wantBurn) {
      bal.heat = Math.min(112, bal.heat + HEAT_UP * dt);
      bal.fuel = Math.max(0, bal.fuel - BURN_RATE * dt);
      if (Math.random() < dt * 30) {
        motes.push({
          kind: "spark",
          x: bal.x + rndS(14),
          y: bal.y + 46,
          vy: -60 - Math.random() * 60,
          life: 0.4,
        });
      }
    } else {
      bal.heat = Math.max(0, bal.heat - HEAT_DECAY * dt);
    }
    if (bal.venting) {
      bal.heat = Math.max(0, bal.heat - HEAT_VENT * dt);
      if (Math.random() < dt * 40) {
        motes.push({
          kind: "puff",
          x: bal.x + rndS(20),
          y: bal.y - 46,
          vy: -30 - Math.random() * 40,
          life: 0.7,
        });
      }
    }

    // ---- vertical dynamics ----------------------------------------
    const climb = ((bal.heat - NEUTRAL_HEAT) / (NEUTRAL_HEAT * 0.9)) * 165;
    bal.vy = lerp(bal.vy, -climb, 1 - Math.exp(-dt * 2.6));

    // thermals shove you up
    if (phase > leg.thermalAt) {
      for (const c of cols) {
        if (Math.abs(bal.x - c.x) < c.w / 2 && bal.y > 170) {
          bal.vy -= c.str * dt * (1.15 - phase * 0.45);
          if (Math.random() < dt * 24) {
            motes.push({
              kind: "shimmer",
              x: bal.x + rndS(c.w / 2),
              y: bal.y + 60,
              vy: -90,
              life: 0.8,
            });
          }
        }
      }
    }
    if (!windDead && t >= leg.dur) {
      windDead = true;
      toast("The dawn wind is dying!", "bad");
    }
    if (windDead) {
      bal.vy += 30 * dt;
      deadT += dt;
      if (deadT > DEAD_GRACE) {
        crash("The dawn wind died beneath you.");
        return;
      }
    }

    // frost ceiling
    if (bal.y - 46 < CEIL_Y) {
      bal.y = CEIL_Y + 46;
      bal.vy = Math.max(bal.vy, 20);
      bal.heat = Math.max(0, bal.heat - 30 * dt);
      if (t - lastCeilNote > 4) {
        lastCeilNote = t;
        toast("The crown frosts — come down.", "bad");
      }
    }

    bal.y += bal.vy * dt;

    // ---- horizontal drift ------------------------------------------
    const wx = windAt(bal.y);
    bal.vx = lerp(bal.vx, wx, 1 - Math.exp(-dt * 1.8));
    bal.x += bal.vx * dt;
    bal.tilt = lerp(
      bal.tilt,
      clamp(bal.vx / 900, -0.16, 0.16),
      1 - Math.exp(-dt * 3),
    );

    // ---- camera -----------------------------------------------------
    camX = bal.x - (cssW / scaleF) * 0.38;

    // ---- collisions --------------------------------------------------
    const hits = hitObstacles();
    if (hits) {
      crash(hits);
      return;
    }
    if (bal.x > leg.len + 420) {
      crash("You drifted past the pass into the far peaks.");
      return;
    }

    // ---- ground ------------------------------------------------------
    const bottom = bal.y + 80;
    if (bottom >= GY) {
      const inMeadow = bal.x >= leg.meadow[0] && bal.x <= leg.meadow[1];
      bal.y = GY - 80;
      if (inMeadow && bal.vy <= LAND_VY) {
        land();
      } else {
        crash(
          inMeadow
            ? "Too hard on the meadow — vent earlier and float it in."
            : "You put down on bare rock outside the meadow.",
        );
      }
      return;
    }

    // ---- particles ----------------------------------------------------
    spawnStreaks(dt);
    stepStreaks(dt);
    stepMotes(dt);
    Sfx.setWind(bal.vx - 0);
    Sfx.setBurn(wantBurn);
    shake = Math.max(0, shake - dt * 30);
  }

  let lastCeilNote = -9;

  function rndS(a) {
    return (Math.random() * 2 - 1) * a;
  }

  function hitObstacles() {
    // sample circles of the craft
    const cs = [
      [bal.x, bal.y, 44],
      [bal.x, bal.y + 44, 15],
      [bal.x, bal.y + 68, 17],
    ];
    const test = (rx0, ry0, rx1, ry1, what) => {
      for (const [cx, cy, cr] of cs) {
        const nx = clamp(cx, rx0, rx1);
        const ny = clamp(cy, ry0, ry1);
        const dx = cx - nx;
        const dy = cy - ny;
        if (dx * dx + dy * dy < cr * cr - 60) return what;
      }
      return null;
    };
    for (const s of leg.spires) {
      const hit = test(
        s.x - 4,
        GY - s.h,
        s.x + s.w + 4,
        GY,
        "A spire tore the envelope.",
      );
      if (hit) return hit;
    }
    for (const c of leg.crags) {
      const hit = test(
        c.x - 4,
        0,
        c.x + c.w + 4,
        c.h,
        "An overhanging crag swatted you into the wall.",
      );
      if (hit) return hit;
    }
    return null;
  }

  function dropBallast() {
    if (mode !== "flying" || paused) return;
    if (bal.ballast <= 0) {
      toast("No bags left.", "bad");
      return;
    }
    bal.ballast--;
    bal.vy = Math.min(bal.vy, 0) - 175;
    for (let i = 0; i < 10; i++) {
      motes.push({
        kind: "sand",
        x: bal.x + rndS(12),
        y: bal.y + 78,
        vy: 60 + Math.random() * 90,
        vx: rndS(30),
        life: 0.9,
      });
    }
    Sfx.blip(196, 0.3, "sine", 0.25);
    toast(
      `Sand away — ${bal.ballast} bag${bal.ballast === 1 ? "" : "s"} left.`,
    );
    updateHUDStatic();
  }

  /* ------------------------------------------------------------------ *
   *  particles
   * ------------------------------------------------------------------ */

  function spawnStreaks(dt) {
    const vw = cssW / scaleF;
    const n = Math.min(4, Math.floor(dt * 90));
    for (let i = 0; i < n; i++) {
      const y = 60 + Math.random() * (GY - 100);
      streaks.push({
        x: camX - 60 + Math.random() * (vw + 120),
        y,
        vx: windAt(y),
        life: 1.6 + Math.random(),
        len: 0,
      });
    }
    if (streaks.length > 260) streaks.splice(0, streaks.length - 260);
  }

  function stepStreaks(dt) {
    const vw = cssW / scaleF;
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.x += s.vx * dt;
      s.life -= dt;
      s.len = s.vx * 0.14;
      const sx = s.x - camX;
      if (s.life <= 0 || sx < -80 || sx > vw + 80) streaks.splice(i, 1);
    }
  }

  function stepMotes(dt) {
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.life -= dt;
      m.y += m.vy * dt;
      if (m.vx) m.x += m.vx * dt;
      if (m.life <= 0) motes.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   *  rendering
   * ------------------------------------------------------------------ */

  function hexLerp(a, b, f) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const r = Math.round(lerp(pa >> 16, pb >> 16, f));
    const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, f));
    const bl = Math.round(lerp(pa & 255, pb & 255, f));
    return `rgb(${r},${g},${bl})`;
  }

  const SKY = [
    ["#0d1330", "#23305c", "#4a4f7d"],
    ["#27407a", "#7a6ea0", "#f2a65e"],
    ["#4d7fb8", "#a8c4dd", "#ffd9a0"],
  ];

  function skyColors() {
    const p = phase;
    if (p < 0.55) {
      const f = p / 0.55;
      return [
        hexLerp(SKY[0][0], SKY[1][0], f),
        hexLerp(SKY[0][1], SKY[1][1], f),
        hexLerp(SKY[0][2], SKY[1][2], f),
      ];
    }
    const f = (p - 0.55) / 0.45;
    return [
      hexLerp(SKY[1][0], SKY[2][0], f),
      hexLerp(SKY[1][1], SKY[2][1], f),
      hexLerp(SKY[1][2], SKY[2][2], f),
    ];
  }

  function draw() {
    const vw = cssW / scaleF;
    const u = scaleF;
    ctx.save();
    ctx.scale(u, u);

    // sky
    const sc = skyColors();
    const grad = ctx.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, sc[0]);
    grad.addColorStop(0.62, sc[1]);
    grad.addColorStop(1, sc[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, VH);

    // stars fading with dawn
    const starA = clamp(1 - phase * 1.6, 0, 1);
    if (starA > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${starA * 0.8})`;
      for (const [fx, fy, tw, sz] of starsSky) {
        const sx =
          ((((fx * vw * 0.9 - camX * 0.04) % (vw * 1.2)) + vw * 1.2) %
            (vw * 1.2)) -
          vw * 0.1;
        const yy = fy * VH;
        ctx.globalAlpha =
          starA * (0.4 + 0.6 * Math.abs(Math.sin(t * tw + fx * 20)));
        ctx.fillRect(sx, yy, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    // sun climbing behind ridges
    const sunX = vw * 0.72;
    const sunY = lerp(VH * 0.86, VH * 0.34, phase);
    const sg = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 130);
    sg.addColorStop(0, `rgba(255,225,150,${0.85})`);
    sg.addColorStop(1, "rgba(255,200,92,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - 140, sunY - 140, 280, 280);
    ctx.fillStyle = "#ffe9ad";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 26 + phase * 10, 0, TAU);
    ctx.fill();

    // band guide lines (readability: dashed horizons of equal wind)
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.setLineDash([6, 10]);
    ctx.lineWidth = 1;
    for (const [by] of leg.bands) {
      if (by > CEIL_Y + 30 && by < GY - 40) {
        ctx.beginPath();
        ctx.moveTo(0, by);
        ctx.lineTo(vw, by);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // parallax ridges
    drawRidge(ridges[0], 0.22, "#1b2444");
    drawRidge(ridges[1], 0.5, "#131a33");
    drawRidge(ridges[2], 0.85, "#0c1124");

    // valley floor
    ctx.fillStyle = "#080c19";
    ctx.fillRect(0, GY, vw, VH - GY);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let gx = Math.floor(camX / 90) * 90; gx < camX + vw; gx += 90) {
      ctx.fillRect(gx - camX, GY + 8, 34, 2);
    }

    // meadow
    const mx0 = leg.meadow[0] - camX;
    const mx1 = leg.meadow[1] - camX;
    if (mx1 > 0 && mx0 < vw) {
      ctx.fillStyle = windDead ? "#26401f" : "#2e5a28";
      ctx.fillRect(mx0, GY - 4, mx1 - mx0, 10);
      ctx.fillStyle = windDead ? "#31541f" : "#3c7031";
      ctx.fillRect(mx0, GY - 4, mx1 - mx0, 4);
      // flag at centre
      const fcx = (leg.meadow[0] + leg.meadow[1]) / 2 - camX;
      ctx.strokeStyle = "#d8d2be";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fcx, GY - 2);
      ctx.lineTo(fcx, GY - 54);
      ctx.stroke();
      ctx.fillStyle = "#ffc85c";
      const fl = Math.sin(t * 6) * 3;
      ctx.beginPath();
      ctx.moveTo(fcx, GY - 54);
      ctx.lineTo(fcx + 26 + fl, GY - 47);
      ctx.lineTo(fcx, GY - 40);
      ctx.closePath();
      ctx.fill();
    }

    // monastery on the final leg
    if (leg.monastery && mx1 > -200) {
      const mcx = leg.len + 60 - camX;
      if (mcx < vw + 300) drawMonastery(mcx, GY);
    }

    // obstacles
    for (const s of leg.spires) {
      const sx = s.x - camX;
      if (sx > vw + 60 || sx + s.w < -60) continue;
      drawSpire(sx, s.w, s.h);
    }
    for (const c of leg.crags) {
      const cx = c.x - camX;
      if (cx > vw + 60 || cx + c.w < -60) continue;
      drawCrag(cx, c.w, c.h);
    }

    // thermal columns
    if (phase > leg.thermalAt) {
      for (const c of cols) {
        const cx = c.x - camX;
        if (cx < -c.w || cx > vw + c.w) continue;
        const a = 0.05 + 0.05 * Math.sin(t * 3 + c.x);
        const tg = ctx.createLinearGradient(cx, GY, cx, 170);
        tg.addColorStop(0, `rgba(255,220,150,${a * 1.6})`);
        tg.addColorStop(1, "rgba(255,220,150,0)");
        ctx.fillStyle = tg;
        ctx.fillRect(cx - c.w / 2, 170, c.w, GY - 170);
      }
    }

    // wind streaks
    ctx.lineCap = "round";
    for (const s of streaks) {
      const sx = s.x - camX;
      const rel = s.vx - bal.vx;
      const a = clamp(Math.abs(rel) / 130, 0.04, 0.4) * clamp(s.life, 0, 1);
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx, s.y);
      ctx.lineTo(sx - s.len * 0.4, s.y);
      ctx.stroke();
    }

    // motes
    for (const m of motes) {
      const sx = m.x - camX;
      if (m.kind === "spark") {
        ctx.fillStyle = `rgba(255,${(170 + Math.random() * 60) | 0},80,${clamp(m.life * 2, 0, 0.9)})`;
        ctx.beginPath();
        ctx.arc(sx, m.y, 2.2, 0, TAU);
        ctx.fill();
      } else if (m.kind === "puff") {
        ctx.fillStyle = `rgba(220,225,235,${clamp(m.life, 0, 0.5)})`;
        ctx.beginPath();
        ctx.arc(sx, m.y, 5 + (0.7 - m.life) * 14, 0, TAU);
        ctx.fill();
      } else if (m.kind === "sand") {
        ctx.fillStyle = `rgba(214,196,158,${clamp(m.life, 0, 0.8)})`;
        ctx.fillRect(sx, m.y, 2.4, 2.4);
      } else {
        ctx.strokeStyle = `rgba(255,235,190,${clamp(m.life, 0, 0.4)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx - 4, m.y);
        ctx.quadraticCurveTo(sx, m.y - 6, sx + 4, m.y);
        ctx.stroke();
      }
    }

    drawBalloon(vw);

    // vignette
    const vg = ctx.createRadialGradient(
      vw / 2,
      VH / 2,
      VH * 0.42,
      vw / 2,
      VH / 2,
      VH * 0.86,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(4,6,14,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, vw, VH);

    ctx.restore();
  }

  function drawRidge(pts, par, color) {
    const vw = cssW / scaleF;
    const off = camX * par;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-20, VH);
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const sx = pts[i][0] - off;
      if (sx < -stepW(pts, i) - 40) continue;
      if (sx > vw + 40) break;
      if (!started) {
        ctx.moveTo(sx, pts[i][1]);
        started = true;
      } else ctx.lineTo(sx, pts[i][1]);
    }
    ctx.lineTo(vw + 40, VH);
    ctx.closePath();
    ctx.fill();
  }

  function stepW(pts, i) {
    return i > 0 ? pts[i][0] - pts[i - 1][0] : 0;
  }

  function drawSpire(sx, w, h) {
    const top = GY - h;
    ctx.fillStyle = "#151b31";
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.18, GY);
    ctx.lineTo(sx + w * 0.1, top + h * 0.16);
    ctx.quadraticCurveTo(sx + w * 0.34, top - 6, sx + w * 0.72, top + h * 0.1);
    ctx.lineTo(sx + w * 1.14, GY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.1, top + h * 0.16);
    ctx.quadraticCurveTo(sx + w * 0.34, top - 6, sx + w * 0.72, top + h * 0.1);
    ctx.lineTo(sx + w * 0.6, GY);
    ctx.lineTo(sx + w * 0.28, GY);
    ctx.closePath();
    ctx.fill();
  }

  function drawCrag(sx, w, h) {
    ctx.fillStyle = "#171d36";
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.14, 0);
    ctx.lineTo(sx + w * 0.16, h * 0.82);
    ctx.quadraticCurveTo(sx + w * 0.5, h + 8, sx + w * 0.86, h * 0.74);
    ctx.lineTo(sx + w * 1.12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.16, h * 0.82);
    ctx.quadraticCurveTo(sx + w * 0.5, h + 8, sx + w * 0.86, h * 0.74);
    ctx.lineTo(sx + w * 0.78, h * 0.3);
    ctx.lineTo(sx + w * 0.42, h * 0.36);
    ctx.closePath();
    ctx.fill();
  }

  function drawMonastery(sx, gy) {
    ctx.fillStyle = "#10162b";
    // cliff shelf
    ctx.fillRect(sx - 90, gy - 26, 260, 26);
    // bodies
    ctx.fillRect(sx, gy - 118, 74, 92);
    ctx.fillRect(sx + 84, gy - 88, 46, 62);
    // roofs
    ctx.beginPath();
    ctx.moveTo(sx - 8, gy - 118);
    ctx.lineTo(sx + 37, gy - 152);
    ctx.lineTo(sx + 82, gy - 118);
    ctx.closePath();
    ctx.fill();
    // windows lit
    ctx.fillStyle = "rgba(255,200,92,0.85)";
    ctx.fillRect(sx + 12, gy - 104, 8, 12);
    ctx.fillRect(sx + 34, gy - 104, 8, 12);
    ctx.fillRect(sx + 96, gy - 78, 7, 10);
    // flag pole
    ctx.strokeStyle = "#d8d2be";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 37, gy - 152);
    ctx.lineTo(sx + 37, gy - 186);
    ctx.stroke();
    ctx.fillStyle = "#c04a3e";
    const fl = Math.sin(t * 5) * 3;
    ctx.beginPath();
    ctx.moveTo(sx + 37, gy - 186);
    ctx.lineTo(sx + 60 + fl, gy - 179);
    ctx.lineTo(sx + 37, gy - 172);
    ctx.closePath();
    ctx.fill();
  }

  function drawBalloon(vw) {
    const sx = bal.x - camX;
    const sy = bal.y;
    const tilt = bal.tilt;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(tilt);

    // shadow on the ground
    const alt = GY - sy;
    const shA = clamp(1 - alt / 620, 0, 0.32);
    ctx.fillStyle = `rgba(0,0,0,${shA})`;
    ctx.beginPath();
    ctx.ellipse(0, GY - sy + 6, 40 + alt * 0.05, 7, 0, 0, TAU);
    ctx.fill();

    // rigging
    ctx.strokeStyle = "#d8d2be";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-30, 34);
    ctx.lineTo(-14, 66);
    ctx.moveTo(30, 34);
    ctx.lineTo(14, 66);
    ctx.moveTo(-30, 34);
    ctx.lineTo(0, 44);
    ctx.moveTo(30, 34);
    ctx.lineTo(0, 44);
    ctx.stroke();

    // envelope
    const eg = ctx.createRadialGradient(-14, -14, 8, 0, 0, 52);
    eg.addColorStop(0, "#ffe08a");
    eg.addColorStop(0.55, "#e8923f");
    eg.addColorStop(1, "#b64a2c");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.moveTo(-30, 36);
    ctx.bezierCurveTo(-52, 8, -46, -40, 0, -48);
    ctx.bezierCurveTo(46, -40, 52, 8, 30, 36);
    ctx.quadraticCurveTo(0, 46, -30, 36);
    ctx.fill();
    // gores
    ctx.strokeStyle = "rgba(90,30,20,0.35)";
    ctx.lineWidth = 1.2;
    for (const gxp of [-18, 0, 18]) {
      ctx.beginPath();
      ctx.moveTo(gxp * 0.4, 40);
      ctx.quadraticCurveTo(gxp, -8, 0, -47);
      ctx.stroke();
    }
    // crown rope
    ctx.strokeStyle = "rgba(90,30,20,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.lineTo(0, -54);
    ctx.stroke();

    // burner flame
    if (bal.burning) {
      const fh = 16 + Math.random() * 12;
      const fg = ctx.createLinearGradient(0, 44, 0, 44 - fh - 18);
      fg.addColorStop(0, "rgba(255,240,180,0.95)");
      fg.addColorStop(0.5, "rgba(255,157,77,0.9)");
      fg.addColorStop(1, "rgba(255,90,40,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-7, 44);
      ctx.quadraticCurveTo(0, 44 - fh - 18, 7, 44);
      ctx.closePath();
      ctx.fill();
    }

    // basket
    ctx.fillStyle = "#7a5230";
    ctx.strokeStyle = "#4c3018";
    ctx.lineWidth = 1.5;
    const bw = 34;
    const bh = 24;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bw / 2, 44, bw, bh, 4);
    else ctx.rect(-bw / 2, 44, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(76,48,24,0.7)";
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + 4, 44);
    ctx.lineTo(-bw / 2 + 4, 44 + bh);
    ctx.moveTo(0, 44);
    ctx.lineTo(0, 44 + bh);
    ctx.moveTo(bw / 2 - 4, 44);
    ctx.lineTo(bw / 2 - 4, 44 + bh);
    ctx.stroke();

    // sandbags hanging from basket rim
    for (let i = 0; i < bal.ballast; i++) {
      const bxx = -bw / 2 + 7 + i * 9;
      ctx.fillStyle = "#cbb98e";
      ctx.beginPath();
      ctx.ellipse(bxx, 44 + bh + 4, 3.4, 4.4, 0, 0, TAU);
      ctx.fill();
    }

    // vent flap open
    if (bal.venting) {
      ctx.fillStyle = "rgba(20,26,46,0.85)";
      ctx.beginPath();
      ctx.ellipse(0, -50, 9, 4 + Math.random() * 3, 0, 0, TAU);
      ctx.fill();
    }

    // vertical-speed arrow beside the craft
    ctx.rotate(-tilt);
    const va = clamp(bal.vy / 90, -1, 1);
    if (Math.abs(va) > 0.12) {
      ctx.fillStyle =
        va < 0 ? "rgba(143,217,122,0.9)" : "rgba(127,178,255,0.9)";
      ctx.font = "bold 15px Georgia";
      ctx.textAlign = "center";
      ctx.fillText(va < 0 ? "▲" : "▼", 62, va < 0 ? 8 : 22);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   *  HUD
   * ------------------------------------------------------------------ */

  function buildAltScale() {
    altScale.innerHTML = "";
    leg.bands.forEach(([by, bv]) => {
      const row = document.createElement("div");
      row.className = "alt-band";
      row.style.top = `${(by / GY) * 100}%`;
      const arrow = document.createElement("span");
      arrow.className = "alt-arrow";
      const mag = Math.min(3, 1 + Math.floor(Math.abs(bv) / 55));
      arrow.textContent = bv >= 0 ? "›".repeat(mag) : "‹".repeat(mag);
      arrow.style.color = bv >= 0 ? "#9fe08a" : "#7fb2ff";
      const spd = document.createElement("span");
      spd.textContent = `${bv >= 0 ? "+" : ""}${Math.round(bv)}`;
      row.appendChild(arrow);
      row.appendChild(spd);
      altScale.appendChild(row);
    });
  }

  function updateHUDStatic() {
    chipFuel.textContent = `Fuel ${Math.max(0, Math.round(bal.fuel))}%`;
    chipFuel.classList.toggle("low", bal.fuel < leg.fuel * 0.22);
    chipBallast.textContent = `Ballast ${"●".repeat(bal.ballast)}${"○".repeat(leg.ballast - bal.ballast)}`;
    padBallast.disabled = bal.ballast <= 0;
    buildAltScale();
  }

  function updateHUDLive() {
    const remain = Math.max(0, Math.round((leg.meadow[1] - bal.x) / 10));
    chipLeg.textContent = `Leg ${legIndex + 1}/${LEGS.length} · ${remain} m`;
    heatFill.style.width = `${clamp(bal.heat / 112, 0, 1) * 100}%`;
    const sd = 0.35 + phase * 1.5;
    sunDisc.style.bottom = `${sd}rem`;
  }

  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = `toast show${kind ? " " + kind : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = "toast";
    }, 1900);
  }

  /* ------------------------------------------------------------------ *
   *  overlays
   * ------------------------------------------------------------------ */

  function showOverlay(title, starsLine, body, keys, goLabel) {
    ovTitle.textContent = title;
    ovTitle.classList.toggle("win", mode === "victory");
    ovTagline.style.display = "";
    let starsHtml = "";
    if (starsLine) starsHtml = `<div class="stars">${starsLine}</div>`;
    ovTagline.innerHTML =
      starsHtml + "Altitude is money. Spend it on the wind.";
    ovBody.innerHTML = body;
    if (keys && keys.length) {
      ovKeys.innerHTML = keys.map((k) => `<li>${k}</li>`).join("");
      ovKeys.style.display = "";
    } else {
      ovKeys.style.display = "none";
    }
    btnGo.textContent = goLabel;
    overlay.classList.add("show");
  }

  function hideOverlay() {
    overlay.classList.remove("show");
  }

  function showTitle() {
    mode = "title";
    totalStars = 0;
    showOverlay(
      "Ballast",
      "",
      `Five dawn crossings of the Karst pass. The valley floor crawls with headwind; the high
       bands run fast. Hold <strong>burn</strong> to climb, tap <strong>vent</strong> to spill hot
       air and drop, spend <strong>ballast</strong> for lift you cannot burn. Thread spires and
       crags, ride the bands the arrows promise, and set down gently in the flagged meadow before
       the sun climbs and kills the thermals. On later legs the dawn breathes: gusts shove, and
       thermals bloom on the warming slopes.`,
      [
        "<b>Space / BURN</b> hold to fire the burner — rise",
        "<b>X / VENT</b> hold to vent hot air — fall",
        "<b>B / BALLAST</b> drop a sandbag — one sudden lift",
        "<b>P</b> pause · <b>R</b> restart leg · <b>M</b> sound",
        "or hold the sky itself: right half burns, left half vents",
      ],
      "Cast off ⏎",
    );
  }

  function goAction() {
    Sfx.resume();
    if (mode === "title") {
      totalStars = 0;
      startLeg(0);
    } else if (mode === "landed") {
      startLeg(legIndex + 1);
    } else if (mode === "crashed") {
      startLeg(legIndex);
    } else if (mode === "victory") {
      showTitle();
    } else if (paused) {
      togglePause();
    }
  }

  function togglePause(force) {
    if (mode !== "flying" && !paused) return;
    paused = force !== undefined ? force : !paused;
    if (paused) {
      Sfx.setBurn(false);
      Sfx.setWind(0);
      showOverlay("Paused", "", "The pass holds its breath.", [], "Resume ⏎");
      btnGo.dataset.resume = "1";
    } else {
      hideOverlay();
      lastTouch = performance.now();
    }
  }

  /* ------------------------------------------------------------------ *
   *  input
   * ------------------------------------------------------------------ */

  const keys = { burn: false, vent: false };

  window.addEventListener("keydown", (e) => {
    if (e.repeat && e.code !== "Space") return;
    switch (e.code) {
      case "Space":
        e.preventDefault();
        if (mode === "flying" && !paused) keys.burn = true;
        else if (!overlayHidden()) goAction();
        break;
      case "Enter":
        e.preventDefault();
        goAction();
        break;
      case "KeyX":
        keys.vent = true;
        break;
      case "KeyB":
        dropBallast();
        break;
      case "KeyP":
        if (mode === "flying") togglePause();
        break;
      case "KeyR":
        if (mode === "flying" || paused || mode === "crashed") {
          paused = false;
          startLeg(legIndex);
        }
        break;
      case "KeyM":
        toggleSound();
        break;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") keys.burn = false;
    if (e.code === "KeyX") keys.vent = false;
  });

  function overlayHidden() {
    return !overlay.classList.contains("show");
  }

  // holding the sky itself: right half burns, left half vents
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "flying" || paused) return;
    Sfx.resume();
    const rect = canvas.getBoundingClientRect();
    if (e.clientX - rect.left > rect.width / 2) keys.burn = true;
    else keys.vent = true;
    canvas.setPointerCapture(e.pointerId);
  });
  window.addEventListener("pointerup", () => {
    keys.burn = false;
    keys.vent = false;
  });

  function bindPad(el, down, up) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.classList.add("held");
      Sfx.resume();
      down();
    });
    const release = () => {
      el.classList.remove("held");
      if (up) up();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
  }

  bindPad(
    padBurn,
    () => {},
    () => {},
  );
  bindPad(
    padVent,
    () => {},
    () => {},
  );
  bindPad(
    padBallast,
    () => dropBallast(),
    () => {},
  );

  btnGo.addEventListener("click", goAction);
  btnPause.addEventListener("click", () => togglePause());
  btnSound.addEventListener("click", toggleSound);

  function toggleSound() {
    Sfx.ensure();
    if (Sfx.muted === null) return;
    Sfx.muted = !Sfx.muted;
    btnSound.textContent = Sfx.muted ? "🔇" : "🔊";
    if (Sfx.muted) {
      Sfx.setWind(0);
      Sfx.setBurn(false);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "flying" && !paused) togglePause(true);
  });

  /* ------------------------------------------------------------------ *
   *  main loop
   * ------------------------------------------------------------------ */

  let last = performance.now();

  function frameLoop(now) {
    requestAnimationFrame(frameLoop);
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (mode === "flying" && !paused) {
      step(dt);
      updateHUDLive();
      // refresh fuel/ballast chips cheaply
      chipFuel.textContent = `Fuel ${Math.max(0, Math.round(bal.fuel))}%`;
      chipFuel.classList.toggle("low", bal.fuel < leg.fuel * 0.22);
    } else {
      t += 0; // frozen
      Sfx.setWind(0);
      if (mode !== "flying") Sfx.setBurn(false);
    }
    draw();
  }

  /* ------------------------------------------------------------------ *
   *  boot
   * ------------------------------------------------------------------ */

  fitCanvas();
  legIndex = 0;
  leg = LEGS[0];
  phase = 0;
  starsSky = [];
  const sr0 = mulberry32(1234);
  for (let k = 0; k < 90; k++)
    starsSky.push([sr0() * 1.2, sr0() * 0.55, sr0(), 0.6 + sr0() * 1.6]);
  ridges = [
    makeRidge(2, 470, 90, 260),
    makeRidge(3, 530, 70, 190),
    makeRidge(4, 596, 46, 130),
  ];
  cols = [];
  camX = 0;
  bal.x = 300;
  bal.y = 470;
  updateHUDStatic();
  updateHUDLive();
  showTitle();
  requestAnimationFrame(frameLoop);

  /* tiny test hook for headless smoke tests — no effect on play */
  window.__ballast = {
    state: () => ({
      mode,
      paused,
      legIndex: legIndex + 1,
      x: Math.round(bal.x),
      y: Math.round(bal.y),
      vy: Math.round(bal.vy),
      fuel: Math.round(bal.fuel),
      ballast: bal.ballast,
      phase: +phase.toFixed(2),
    }),
    jump(px, py) {
      bal.x = px;
      if (py !== undefined) bal.y = py;
    },
    dusk() {
      t = leg.dur;
    },
  };
})();
