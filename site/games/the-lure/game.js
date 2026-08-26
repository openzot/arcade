/*
 * The Lure — a falconry morning on the chalk downs.
 * Swing the baited lure to draw your circling hawk in overhead,
 * then release to cast her stoop onto the grazing rabbits before
 * they bolt for the warren. Bag the quota before the mist burns off.
 *
 * Vanilla JS, no dependencies. All art drawn on canvas, all sound
 * synthesised with the Web Audio API.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  const cvs = document.getElementById("sky");
  const ctx = cvs.getContext("2d");
  const field = document.getElementById("field");
  const veil = document.getElementById("veil");
  const cardTitle = document.getElementById("cardTitle");
  const cardTag = document.getElementById("cardTag");
  const cardBody = document.getElementById("cardBody");
  const cardBtn = document.getElementById("cardBtn");
  const btnPause = document.getElementById("btnPause");
  const btnSound = document.getElementById("btnSound");
  const btnHelp = document.getElementById("btnHelp");
  const padLeft = document.getElementById("padLeft");
  const padRight = document.getElementById("padRight");
  const padCall = document.getElementById("padCall");
  const padLure = document.getElementById("padLure");

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

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

  let rng = mulberry32(12345);

  /* ------------------------------------------------------------------ */
  /* Audio — everything synthesised, created on first gesture            */
  /* ------------------------------------------------------------------ */

  const audio = {
    ctx: null,
    master: null,
    muted: false,
    windGain: null,
    windFilter: null,
    ready: false,
  };

  function ensureAudio() {
    if (audio.ready) {
      if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = audio.muted ? 0 : 0.9;
      audio.master.connect(audio.ctx.destination);

      // looping wind bed
      const len = audio.ctx.sampleRate * 2;
      const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
        data[i] = last * 3.2;
      }
      const src = audio.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      audio.windFilter = audio.ctx.createBiquadFilter();
      audio.windFilter.type = "lowpass";
      audio.windFilter.frequency.value = 320;
      audio.windGain = audio.ctx.createGain();
      audio.windGain.gain.value = 0;
      src
        .connect(audio.windFilter)
        .connect(audio.windGain)
        .connect(audio.master);
      src.start();
      audio.ready = true;
    } catch (e) {
      audio.ready = false;
    }
  }

  function blip(freq, dur, type, vol, glideTo) {
    if (!audio.ready) return;
    const t = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, vol, freq, q, type) {
    if (!audio.ready) return;
    const t = audio.ctx.currentTime;
    const n = Math.floor(audio.ctx.sampleRate * dur);
    const buf = audio.ctx.createBuffer(1, n, audio.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    const f = audio.ctx.createBiquadFilter();
    f.type = type || "bandpass";
    f.frequency.value = freq;
    f.Q.value = q || 1;
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(audio.master);
    src.start(t);
  }

  const sfx = {
    bell() {
      // hawk's bells: two tiny detuned jingles
      blip(2350, 0.09, "triangle", 0.05);
      blip(2385, 0.13, "triangle", 0.04);
    },
    whistle() {
      blip(1150, 0.32, "sine", 0.11, 1900);
      setTimeout(() => blip(1500, 0.22, "sine", 0.08, 2100), 130);
    },
    whoosh() {
      noiseBurst(0.5, 0.22, 700, 0.8, "bandpass");
    },
    catch() {
      noiseBurst(0.16, 0.3, 220, 1.2, "lowpass");
      blip(160, 0.14, "square", 0.06, 90);
    },
    miss() {
      noiseBurst(0.3, 0.14, 2400, 1.4, "highpass");
    },
    click() {
      blip(880, 0.05, "square", 0.04);
    },
    good() {
      blip(660, 0.14, "triangle", 0.1);
      setTimeout(() => blip(880, 0.16, "triangle", 0.1), 110);
      setTimeout(() => blip(1320, 0.24, "triangle", 0.09), 230);
    },
    bad() {
      blip(300, 0.3, "sawtooth", 0.07, 150);
    },
    count(hi) {
      blip(hi ? 1240 : 740, hi ? 0.22 : 0.1, "triangle", 0.1);
    },
    lark() {
      // distant skylark: a few bright descending chips
      let dt = 0;
      const base = 2600 + Math.random() * 500;
      for (let i = 0; i < 4; i++) {
        setTimeout(
          () => blip(base - i * 160, 0.09, "sine", 0.03, base - i * 160 - 260),
          dt * 1000,
        );
        dt += 0.12 + Math.random() * 0.1;
      }
    },
  };

  /* ------------------------------------------------------------------ */
  /* Layout                                                              */
  /* ------------------------------------------------------------------ */

  let W = 800;
  let H = 600;
  let dpr = 1;

  function resize() {
    const ow = W;
    const oh = H;
    const r = field.getBoundingClientRect();
    W = Math.max(320, Math.floor(r.width));
    H = Math.max(320, Math.floor(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.floor(W * dpr);
    cvs.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ow !== W || oh !== H) {
      const sx = W / ow;
      const sy = H / oh;
      for (const ent of [world.player, world.hawk]) {
        ent.x *= sx;
        ent.y *= sy;
      }
      for (const rb of world.rabbits) {
        rb.x *= sx;
      }
      world.hawk.cx *= sx;
      world.hawk.cy *= sy;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Terrain                                                             */
  /* ------------------------------------------------------------------ */

  let hillSeed = 3;

  function bump(x) {
    const bx = W * 0.63;
    const s = Math.max(40, W * 0.085);
    return -Math.exp(-((x - bx) * (x - bx)) / (2 * s * s)) * H * 0.075;
  }

  function hillY(x) {
    return (
      H * 0.56 +
      Math.sin(x * 0.004 + hillSeed) * H * 0.04 +
      Math.sin(x * 0.0011 + hillSeed * 2.3) * H * 0.05 +
      bump(x)
    );
  }

  /* ------------------------------------------------------------------ */
  /* Morning configurations                                              */
  /* ------------------------------------------------------------------ */

  const MORNINGS = [
    { quota: 2, time: 80, wind: 18, cap: 4, wary: 0.0, sky: 0 },
    { quota: 3, time: 78, wind: 30, cap: 5, wary: 0.05, sky: 1 },
    { quota: 3, time: 72, wind: 42, cap: 6, wary: 0.1, sky: 2 },
    { quota: 4, time: 70, wind: 54, cap: 7, wary: 0.16, sky: 3 },
    { quota: 4, time: 66, wind: 66, cap: 8, wary: 0.22, sky: 4 },
  ];

  const SKIES = [
    {
      top: "#b7d3e4",
      mid: "#e8ddc8",
      low: "#f4e3c0",
      sun: "#fff4d6",
      ridge: "#8ba4ae",
      hillA: "#9fae6f",
      hillB: "#7e9157",
    },
    {
      top: "#aacbe0",
      mid: "#ead9bd",
      low: "#f6ddb0",
      sun: "#ffe9b0",
      ridge: "#87a0aa",
      hillA: "#a3ac67",
      hillB: "#7d8c52",
    },
    {
      top: "#9dc3de",
      mid: "#ecd2ab",
      low: "#f7d49c",
      sun: "#ffd98e",
      ridge: "#82989f",
      hillA: "#a5a75f",
      hillB: "#7c8649",
    },
    {
      top: "#92bcd9",
      mid: "#eecaa0",
      low: "#f5cb90",
      sun: "#ffc878",
      ridge: "#7d9096",
      hillA: "#a2a05a",
      hillB: "#798147",
    },
    {
      top: "#8bb4d4",
      mid: "#efc396",
      low: "#f2c286",
      sun: "#ffbb66",
      ridge: "#788a91",
      hillA: "#9f9a56",
      hillB: "#767d46",
    },
  ];

  /* ------------------------------------------------------------------ */
  /* Game state                                                          */
  /* ------------------------------------------------------------------ */

  const PHASE = {
    MENU: "menu",
    DAWN: "dawn",
    COUNT: "count",
    FLY: "fly",
    BANNER: "banner",
    END: "end",
  };

  const HAWK = {
    FIST: "fist", // on the gloved fist
    LAUNCH: "launch", // climbing out to the waiting-on circle
    CIRCLE: "circle", // waiting on, wide lazy circle
    ATTRACT: "attract", // lure swinging, tightening overhead
    STOOP: "stoop", // the dive
    CLIMB: "climb", // pulled up, easing back to the circle
    RETURN: "return", // flying back to the fist
  };

  let phase = PHASE.MENU;
  let paused = false;
  let morningIdx = 0;
  let bag = 0;
  let clock = 0; // seconds left this morning
  let countT = 0;

  let bannerT = 0;
  let bannerText = "";
  let bannerSub = "";
  let stats = null;
  let hintQueue = [];
  let hintT = 0;
  let elapsedFly = 0;

  const world = {
    player: { x: 0, y: 0, dir: 1, walkT: 0, moving: false, plantT: 0 },
    hawk: {
      x: 0,
      y: 0,
      cx: 0,
      cy: 0,
      ang: 0,
      state: HAWK.FIST,
      vx: 0,
      vy: 0,
      flap: 0,
      eatT: 0,
      stoopT: 0,
      carry: false,

      cool: 0,
      target: { x: 0, y: 0 },
      trail: [],
    },
    lure: { spin: 0, phi: 0, held: false, tip: { x: 0, y: 0 }, pvx: 0, pvy: 0 },
    rabbits: [],
    particles: [],
    mist: [],
    clouds: [],
    wind: 0,
    gustT: 0,
    gustMag: 0,
    larkT: 4,
    shake: 0,
  };

  function freshStats() {
    return {
      bagTotal: 0,
      casts: 0,
      kills: 0,
      misses: 0,
      bestStoop: 0,
      dawns: 0,
    };
  }

  function makeBurrows(m) {
    // seeded spread across the down, denser around the warren mound
    const list = [];
    const n = 5 + m;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const jitter = ((rng() - 0.5) * 0.5) / n;
      const nx = clamp(0.14 + t * 0.72 + jitter, 0.1, 0.9);
      list.push({ nx });
    }
    return list;
  }

  function startMorning(idx, keepStats) {
    morningIdx = idx;
    const m = MORNINGS[idx];
    if (!keepStats) stats = freshStats();
    stats.dawns++;
    bag = 0;
    clock = m.time;
    elapsedFly = 0;
    hillSeed = 1.7 + idx * 1.31;
    world.wind = m.wind;
    world.rabbits.length = 0;
    world.particles.length = 0;
    world.hawk.state = HAWK.FIST;
    world.hawk.carry = false;
    world.hawk.eatT = 0;
    world.hawk.trail.length = 0;
    world.lure.spin = 0;
    world.lure.phi = 0;
    world.player.x = W * 0.3;
    world.player.y = hillY(world.player.x) + 14;
    world.hawk.x = world.player.x + 12;
    world.hawk.y = world.player.y - 36;
    world.hawk.cx = W * 0.5;
    world.hawk.cy = H * 0.24;
    world.burrows = makeBurrows(idx);
    world.mist = [];
    for (let i = 0; i < 4; i++) {
      world.mist.push({
        x: rng() * W,
        y: hillY(W * 0.5) - 20 - rng() * H * 0.12,
        w: W * (0.3 + rng() * 0.3),
        spd: 6 + rng() * 10,
      });
    }
    world.clouds = [];
    for (let i = 0; i < 3; i++) {
      world.clouds.push({
        x: rng() * W,
        y: H * (0.08 + rng() * 0.16),
        s: 0.7 + rng() * 0.8,
        spd: 3 + rng() * 5,
      });
    }
    for (let i = 0; i < Math.min(m.cap, 3); i++) spawnRabbit(true);
    hintQueue =
      idx === 0
        ? [
            "Walk near the grazers — they spook and run.",
            "Hold LURE to bring her in overhead.",
            "Release to cast her stoop!",
            "Bag the quota before the mist burns off.",
          ]
        : [];
    hintT = 0;
  }

  function spawnRabbit(initial) {
    const m = MORNINGS[morningIdx];
    const bs = world.burrows;
    if (!bs.length) return;
    const b = bs[Math.floor(rng() * bs.length)];
    const x = b.nx * W + (rng() - 0.5) * 30;
    world.rabbits.push({
      x: clamp(x, 30, W - 30),
      y: 0,
      dir: rng() < 0.5 ? -1 : 1,
      mode: "graze",
      fear: m.wary,
      hop: rng() * TAU,
      tx: 0,
      wait: initial ? rng() * 1.5 : 0,
      scut: 0,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  const keys = { left: false, right: false };
  let swingHeld = false;

  function beginSwing() {
    if (phase !== PHASE.FLY || paused) return;
    if (!swingHeld) {
      swingHeld = true;
      world.lure.held = true;
      padLure.classList.add("swinging");
    }
  }

  function endSwing() {
    if (!swingHeld) return;
    swingHeld = false;
    world.lure.held = false;
    padLure.classList.remove("swinging");
    castAttempt();
  }

  function callHawk() {
    if (phase !== PHASE.FLY || paused) return;
    const hk = world.hawk;
    if (hk.cool > 0) return;
    if (
      hk.state === HAWK.CIRCLE ||
      hk.state === HAWK.ATTRACT ||
      hk.state === HAWK.CLIMB ||
      hk.state === HAWK.LAUNCH
    ) {
      hk.state = HAWK.RETURN;
      hk.cool = 1.4;
      sfx.whistle();
      sfx.bell();
    }
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(k))
      e.preventDefault();
    ensureAudio();
    if (k === "m" || k === "M") {
      toggleSound();
      return;
    }
    if (k === "p" || k === "P" || k === "Escape") {
      togglePause();
      return;
    }
    if (phase === PHASE.MENU || phase === PHASE.END || phase === PHASE.DAWN) {
      if (k === "Enter" || k === " ") cardAction();
      return;
    }
    if (k === "r" || k === "R") {
      restartMorning();
      return;
    }
    if (k === "h" || k === "H") {
      showHelp();
      return;
    }
    if (paused) return;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = true;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = true;
    if ((k === " " || k === "ArrowDown" || k === "s" || k === "S") && !e.repeat)
      beginSwing();
    if ((k === "w" || k === "W" || k === "ArrowUp") && !e.repeat) callHawk();
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    if (k === " " || k === "ArrowDown" || k === "s" || k === "S") endSwing();
  });

  cvs.addEventListener("pointerdown", (e) => {
    ensureAudio();
    cvs.setPointerCapture(e.pointerId);
    beginSwing();
  });
  cvs.addEventListener("pointerup", () => endSwing());
  cvs.addEventListener("pointercancel", () => {
    swingHeld = false;
    world.lure.held = false;
    padLure.classList.remove("swinging");
  });

  function bindPad(el, down, up) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ensureAudio();
      down();
    });
    if (up) {
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    }
  }
  bindPad(
    padLeft,
    () => (keys.left = true),
    () => (keys.left = false),
  );
  bindPad(
    padRight,
    () => (keys.right = true),
    () => (keys.right = false),
  );
  bindPad(padCall, () => callHawk());
  bindPad(
    padLure,
    () => beginSwing(),
    () => endSwing(),
  );

  btnPause.addEventListener("click", () => {
    ensureAudio();
    togglePause();
  });
  btnSound.addEventListener("click", () => {
    ensureAudio();
    toggleSound();
  });
  btnHelp.addEventListener("click", () => {
    ensureAudio();
    if (phase === PHASE.MENU) showMenu();
    else showHelp();
  });
  cardBtn.addEventListener("click", () => {
    ensureAudio();
    cardAction();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === PHASE.FLY && !paused) togglePause();
  });

  function toggleSound() {
    audio.muted = !audio.muted;
    btnSound.textContent = audio.muted ? "\u00d7" : "\u266a";
    btnSound.setAttribute("aria-pressed", String(audio.muted));
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.9;
    sfx.click();
  }

  /* ------------------------------------------------------------------ */
  /* Overlay cards                                                       */
  /* ------------------------------------------------------------------ */

  let cardMode = "start";

  function showCard(mode) {
    cardMode = mode;
    cardBody.innerHTML = "";
    veil.classList.remove("hidden");
    if (mode === "start") {
      cardTitle.textContent = "The Lure";
      cardTag.textContent = "Hold her hungry. Cast her true.";
      cardBody.innerHTML = cardBody.innerHTML =
        "<p>An apprentice falconer, a young hawk, and a warren fattening " +
        "under the mist. Five dawns on the chalk downs — bag each " +
        "morning's quota before the sun burns the mist away.</p>" +
        "<h3>The flight</h3>" +
        '<div class="keys"><p><b>◀ ▶ / A D</b> walk the path (near footsteps spook them)</p>' +
        "<p><b>hold SPACE</b> swing the lure — she tightens over your head</p>" +
        "<p><b>release</b> cast the stoop at the lure&rsquo;s mark</p>" +
        "<p><b>W</b> whistle her back to the fist</p></div>" +
        "<h3>Mind</h3>" +
        "<p>Hawks are flown hungry: the meter drains while she waits on, " +
        "and each kill lets her mantle and feed. A starved hawk stoops " +
        "wide. Wind bends the stoop. Panic spreads through the warren.</p>";
      cardBtn.textContent = "Climb the down";
    } else if (mode === "help") {
      cardTitle.textContent = "The Lure";
      cardTag.textContent = "How to fly her";
      cardBody.innerHTML =
        '<div class="keys"><p><b>◀ ▶ / A D</b> walk — near footsteps send them bolting</p>' +
        "<p><b>hold SPACE</b> swing the lure; she centres over you</p>" +
        "<p><b>release</b> cast the stoop where the lure hangs</p>" +
        "<p><b>W</b> whistle her back to the fist</p>" +
        "<p><b>P</b> pause &nbsp; <b>R</b> restart dawn &nbsp; <b>M</b> sound</p></div>" +
        "<p>Her ground-shadow marks her line. Strike early: once one runs, " +
        "the whole warren runs.</p>";
      cardBtn.textContent = "Back to it";
    } else if (mode === "pause") {
      cardTitle.textContent = "Paused";
      cardTag.textContent = "She circles on, out of time.";
      cardBtn.textContent = "Resume";
    } else if (mode === "failed") {
      cardTitle.textContent = "The mist burned off";
      cardTag.textContent = "The warren melts into the bright hillside.";
      const m = MORNINGS[morningIdx];
      cardBody.innerHTML =
        "<p>You flew the quota short: <b>" +
        bag +
        " of " +
        m.quota +
        "</b> in the bag.</p>" +
        "<p>Take the same dawn again — fresher wind, stupider rabbits.</p>";
      cardBtn.textContent = "Fly the dawn again";
    } else if (mode === "dawn") {
      const m = MORNINGS[morningIdx];
      cardTitle.textContent = "Dawn " + (morningIdx + 1) + " of 5";
      cardTag.textContent = [
        "First light, flat calm.",
        "A breathing breeze.",
        "The wind finds the down.",
        "White horses on the grass.",
        "Last morning, hard wind.",
      ][morningIdx];
      cardBody.innerHTML =
        "<p>Quota: <b>" +
        m.quota +
        " rabbits</b> before the mist lifts.</p>" +
        "<p>Wind today: <b>" +
        (m.wind < 25 ? "light" : m.wind < 48 ? "steady" : "hard") +
        "</b>. The warren is " +
        (m.wary < 0.08 ? "careless" : m.wary < 0.18 ? "restless" : "wild") +
        ".</p>";
      cardBtn.textContent = "Unhood her";
    } else if (mode === "victory") {
      cardTitle.textContent = "The season opens";
      cardTag.textContent = "Five dawns flown. The ferreter wants your number.";
      const acc = stats.casts
        ? Math.round((stats.kills / stats.casts) * 100)
        : 0;
      cardBody.innerHTML =
        '<div class="statrow"><span>Rabbits in the bag</span><span>' +
        stats.bagTotal +
        "</span></div>" +
        '<div class="statrow"><span>Casts made</span><span>' +
        stats.casts +
        "</span></div>" +
        '<div class="statrow"><span>Best stoop</span><span>' +
        stats.bestStoop.toFixed(2) +
        " s</span></div>" +
        '<div class="statrow"><span>Strike rate</span><span>' +
        acc +
        "%</span></div>" +
        '<div class="statrow"><span>Best stoop</span><span>' +
        Math.round(stats.bestStoop / 10) / 100 +
        " s</span></div>" +
        '<p class="verdict">' +
        (acc > 60
          ? "A crack pair. The old man nods once — high praise."
          : acc > 35
            ? "Workmanlike. The warren remembers you now."
            : "She forgives you. The rabbits may not.") +
        "</p>";
      cardBtn.textContent = "Fly again";
    }
  }

  function hideCard() {
    veil.classList.add("hidden");
  }

  function cardAction() {
    sfx.click();
    if (cardMode === "start") {
      stats = freshStats();
      startMorning(0, true);
      showCard("dawn");
    } else if (cardMode === "help") {
      if (helpReturn === "pause") {
        showCard("pause");
      } else {
        paused = false;
        hideCard();
      }
    } else if (cardMode === "pause") {
      hideCard();
      paused = false;
    } else if (cardMode === "failed") {
      startMorning(morningIdx, true);
      phase = PHASE.COUNT;
      countT = 3.2;
      hideCard();
    } else if (cardMode === "dawn") {
      phase = PHASE.COUNT;
      countT = 3.2;
      hideCard();
    } else if (cardMode === "victory") {
      showMenu();
    }
  }

  let helpReturn = "resume";

  function showMenu() {
    phase = PHASE.MENU;
    paused = false;
    showCard("start");
  }

  function showHelp() {
    helpReturn = phase === PHASE.FLY && !paused ? "resume" : "pause";
    paused = true; // freeze while reading
    showCard("help");
  }

  function togglePause() {
    if (phase === PHASE.MENU || phase === PHASE.END) return;
    if (cardMode === "help" && !veil.classList.contains("hidden")) {
      hideCard();
      paused = false;
      return;
    }
    paused = !paused;
    if (paused) showCard("pause");
    else hideCard();
    sfx.click();
  }

  function restartMorning() {
    if (phase !== PHASE.FLY && phase !== PHASE.BANNER && phase !== PHASE.COUNT)
      return;
    paused = false;
    hideCard();
    startMorning(morningIdx, true);
    phase = PHASE.COUNT;
    countT = 3.2;
  }

  /* ------------------------------------------------------------------ */
  /* Gameplay updates                                                    */
  /* ------------------------------------------------------------------ */

  function updatePlayer(dt) {
    const p = world.player;
    let move = 0;
    if (keys.left) move -= 1;
    if (keys.right) move += 1;
    if (world.lure.held) move = 0; // planted while swinging
    p.moving = move !== 0;
    if (move !== 0) {
      p.dir = move;
      p.walkT += dt * 9;
      p.x = clamp(p.x + move * 128 * dt, 34, W - 34);
      p.plantT = 0;
    } else {
      p.plantT += dt;
    }
    p.y = hillY(p.x) + 14;

    // lure physics
    const lu = world.lure;
    if (lu.held) {
      lu.spin = Math.min(1, lu.spin + dt * 3.4);
      lu.phi += dt * (4 + lu.spin * 8);
      const r = 16 + lu.spin * 20;
      const nx = p.x + Math.cos(lu.phi) * r;
      const ny = p.y - 40 + Math.sin(lu.phi) * r * 0.38 - lu.spin * 6;
      lu.pvx = (nx - lu.tip.x) / Math.max(dt, 0.001);
      lu.pvy = (ny - lu.tip.y) / Math.max(dt, 0.001);
      lu.tip.x = nx;
      lu.tip.y = ny;
    } else {
      lu.spin = Math.max(0, lu.spin - dt * 4);
      lu.phi += dt * 2 * lu.spin;
      lu.pvx *= 0.9;
      lu.pvy *= 0.9;
      lu.tip.x = p.x + p.dir * 10;
      lu.tip.y = p.y - 26;
    }
  }

  function hawkGroundShadowAlpha() {
    const gy = hillY(world.hawk.x);
    return clamp(1 - (gy - world.hawk.y) / (H * 0.55), 0, 1);
  }

  function updateHawk(dt) {
    const hk = world.hawk;
    const p = world.player;
    const lu = world.lure;
    hk.flap += dt * (hk.state === HAWK.STOOP ? 3 : 7);
    if (hk.cool > 0) hk.cool -= dt;

    const circleTarget = () => {
      // wander the waiting-on station gently downwind of centre
      hk.cx +=
        (Math.sin(elapsedFly * 0.21) * W * 0.1 +
          world.wind * 0.8 -
          (hk.cx - W * 0.58) * 0.9) *
        dt;
      hk.cy = clamp(
        hk.cy + Math.sin(elapsedFly * 0.33) * 8 * dt,
        H * 0.12,
        H * 0.34,
      );
    };

    switch (hk.state) {
      case HAWK.FIST: {
        hk.x = p.x + p.dir * 12;
        hk.y = p.y - 38;
        if (hk.eatT > 0) hk.eatT -= dt;
        if (lu.held && lu.spin > 0.55 && hk.eatT <= 0) {
          hk.state = HAWK.LAUNCH;
          sfx.bell();
        }
        break;
      }
      case HAWK.LAUNCH: {
        hk.y -= 190 * dt;
        hk.x = lerp(hk.x, p.x, dt * 2);
        if (hk.y < p.y - 170) {
          hk.state = HAWK.ATTRACT;
          hk.cx = hk.x;
          hk.cy = hk.y;
          hk.ang = Math.atan2(hk.y - hk.cy, hk.x - hk.cx);
        }
        break;
      }
      case HAWK.CIRCLE:
      case HAWK.ATTRACT: {
        const attracting = hk.state === HAWK.ATTRACT;
        if (lu.held && !attracting && lu.spin > 0.4) {
          hk.state = HAWK.ATTRACT;
          sfx.bell();
        }
        if (!lu.held && attracting) hk.state = HAWK.CIRCLE;
        circleTarget();
        let wantCx = hk.cx;
        let wantCy = hk.cy;
        let wantR = 118;
        let speed = 1.05;
        if (hk.state === HAWK.ATTRACT) {
          wantCx = p.x;
          wantCy = clamp(p.y - H * 0.26, 60, H * 0.5);
          wantR = 62;
          speed = 1.9;
        }
        hk.cx = lerp(
          hk.cx,
          wantCx,
          dt * (hk.state === HAWK.ATTRACT ? 2.6 : 0.6),
        );
        hk.cy = lerp(
          hk.cy,
          wantCy,
          dt * (hk.state === HAWK.ATTRACT ? 2.6 : 0.6),
        );
        hk.ang += dt * speed;
        const rx = wantR * 1.25;
        const ry = wantR * 0.5;
        const tx = hk.cx + Math.cos(hk.ang) * rx;
        const ty = hk.cy + Math.sin(hk.ang) * ry;
        // follow the ring smoothly
        hk.vx = (tx - hk.x) * 6;
        hk.vy = (ty - hk.y) * 6;
        hk.x += hk.vx * dt;
        hk.y += hk.vy * dt;
        break;
      }
      case HAWK.STOOP: {
        hk.stoopT += dt;
        // gentle stoop homing: she bends toward quarry close to her line
        const sp0 = Math.max(1, Math.hypot(hk.vx, hk.vy));
        const ha = Math.atan2(hk.vy, hk.vx);

        let bestRb = null;
        let bestRy = 0;
        let bestOff = 130;
        for (const rb of world.rabbits) {
          if (rb.mode === "gone") continue;
          const ry = hillY(rb.x) + 4;
          const dxr = rb.x - hk.x;
          const dyr = ry - hk.y;
          const along = dxr * Math.cos(ha) + dyr * Math.sin(ha);
          if (along <= 8 || along > 320) continue;
          const off = Math.abs(-Math.sin(ha) * dxr + Math.cos(ha) * dyr);
          if (off < bestOff) {
            bestOff = off;
            bestRb = rb;
            bestRy = ry;
          }
        }
        if (bestRb) {
          const dxr = bestRb.x - hk.x;
          const dyr = bestRy - hk.y;
          const dl = Math.max(1, Math.hypot(dxr, dyr));
          const k = clamp(dt * 9, 0, 1);
          let nvx = lerp(hk.vx / sp0, dxr / dl, k);
          let nvy = lerp(hk.vy / sp0, dyr / dl, k);
          const nl = Math.max(1, Math.hypot(nvx, nvy));
          hk.vx = (nvx / nl) * sp0;
          hk.vy = (nvy / nl) * sp0;
        }
        hk.vy += 1500 * dt;
        hk.vx += world.wind * 2.4 * dt;
        hk.x += hk.vx * dt;
        hk.y += hk.vy * dt;
        hk.trail.push({ x: hk.x, y: hk.y, t: 0.4 });
        const hungry = hungerLevel() < 0.22;
        const reach = hungry ? 24 : 36;
        for (const rb of world.rabbits) {
          if (rb.mode === "gone") continue;
          const ry = hillY(rb.x) + 8;
          if (dist(hk.x, hk.y, rb.x, ry - 6) < reach) {
            grabRabbit(rb);
            return;
          }
        }
        const gy = hillY(hk.x);
        if (hk.y > gy - 10 || (hk.vy > 0 && hk.y > hk.target.y)) {
          // pull up — missed
          hk.state = HAWK.CLIMB;
          stats.misses++;
          world.shake = Math.min(1, world.shake + 0.4);
          sfx.miss();
          puff(hk.x, Math.min(gy, hk.y + 8), 8);
        }
        break;
      }
      case HAWK.CLIMB: {
        const tx = p.x;
        const ty = clamp(p.y - H * 0.3, 60, H * 0.5);
        hk.vx = lerp(hk.vx, (tx - hk.x) * 1.6, dt * 3);
        hk.vy = lerp(hk.vy, (ty - hk.y) * 1.6 - 120, dt * 3);
        hk.x += hk.vx * dt;
        hk.y += hk.vy * dt;
        hk.cx = lerp(hk.cx, tx, dt);
        hk.cy = lerp(hk.cy, ty, dt);
        hk.trail.push({ x: hk.x, y: hk.y, t: 0.25 });
        if (dist(hk.x, hk.y, hk.cx, hk.cy) < 30) {
          hk.state = lu.held ? HAWK.ATTRACT : HAWK.CIRCLE;
          hk.ang = Math.atan2(hk.y - hk.cy, hk.x - hk.cx);
        }
        break;
      }
      case HAWK.RETURN: {
        const tx = p.x + p.dir * 12;
        const ty = p.y - 38;
        const dx = tx - hk.x;
        const dy = ty - hk.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        hk.vx = lerp(hk.vx, (dx / d) * 330, dt * 4);
        hk.vy = lerp(hk.vy, (dy / d) * 330, dt * 4);
        hk.x += hk.vx * dt;
        hk.y += hk.vy * dt;
        if (d < 18) {
          hk.state = HAWK.FIST;
          if (hk.carry) {
            hk.carry = false;
            bag++;
            stats.kills++;
            stats.bagTotal++;
            stats.bestStoop = Math.max(stats.bestStoop, hk.stoopT);
            hk.eatT = 1.5;
            bannerText = "In the bag";
            bannerSub = "";
            bannerT = 1.4;
            sfx.good();
            checkQuota();
          }
        }
        break;
      }
      default:
        break;
    }

    // trail decay
    for (const tr of hk.trail) tr.t -= dt;
    while (hk.trail.length && hk.trail[0].t <= 0) hk.trail.shift();

    // wind bed loudness follows her height + wind
    if (audio.ready) {
      const target =
        0.05 + (world.wind / 70) * 0.09 + Math.abs(world.hawk.vy) / 4200;
      audio.windGain.gain.value +=
        (clamp(target, 0, 0.22) - audio.windGain.gain.value) * dt * 2;
      audio.windFilter.frequency.value =
        260 + Math.abs(world.wind) * 4 + Math.abs(world.hawk.vx) * 0.4;
    }
  }

  function hungerLevel() {
    // simple drain: 1.0 fresh, sinks while she waits on
    return clamp(hunger.value, 0, 1);
  }

  const hunger = { value: 1 };

  function castAttempt() {
    if (phase !== PHASE.FLY || paused) return;
    const hk = world.hawk;
    const lu = world.lure;
    if (hk.state === HAWK.FIST) {
      if (lu.spin > 0.5 && hk.eatT <= 0) {
        hk.state = HAWK.LAUNCH;
        sfx.bell();
      }
      return;
    }
    if (hk.state !== HAWK.ATTRACT && hk.state !== HAWK.CIRCLE) return;
    if (lu.spin < 0.45) return;
    const lead = 0.1;
    hk.target.x = lu.tip.x + lu.pvx * lead;
    hk.target.y = clamp(lu.tip.y + lu.pvy * lead + 30, 40, H - 40);
    const dx = hk.target.x - hk.x;
    const dy = hk.target.y - hk.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const hungry = hungerLevel() < 0.22;
    const v = hungry ? 830 : 990;
    hk.vx = (dx / d) * v;
    hk.vy = (dy / d) * v;
    hk.stoopT = 0;
    hk.state = HAWK.STOOP;
    stats.casts++;
    world.shake = Math.min(1, world.shake + 0.25);
    sfx.bell();
    sfx.whoosh();
  }

  function grabRabbit(rb) {
    rb.mode = "gone";
    const hk = world.hawk;
    hk.carry = true;
    hk.state = HAWK.RETURN;
    hunger.value = clamp(hunger.value + 0.2, 0, 1);
    world.shake = Math.min(1, world.shake + 0.5);
    puff(rb.x, hillY(rb.x) + 4, 12);
    sfx.catch();
    bannerText = "Struck!";
    bannerT = 0.8;
  }

  function checkQuota() {
    if (bag >= MORNINGS[morningIdx].quota) {
      phase = PHASE.BANNER;
      bannerText = "Quota met";
      bannerSub =
        morningIdx < 4
          ? "The mist holds a little longer."
          : "That is the week done.";
      bannerT = 2;
    }
  }

  function updateRabbits(dt) {
    const p = world.player;
    const hk = world.hawk;
    const m = MORNINGS[morningIdx];
    let alive = 0;
    for (const rb of world.rabbits) {
      if (rb.mode === "gone") continue;
      rb.fear = clamp(rb.fear - dt * 0.12, 0, 1);
      const pd = dist(p.x, 0, rb.x, 0);
      if (p.moving && pd < 95) rb.fear += dt * (1.1 - pd / 95) * (1 + m.wary);
      else if (!p.moving && pd < 46) rb.fear += dt * 0.35;
      if (world.lure.held && pd < 130) rb.fear += dt * 0.06;
      const sh = hawkGroundShadowAlpha();
      if (sh > 0.3 && (hk.state === HAWK.STOOP || hk.state === HAWK.CLIMB)) {
        const sd = Math.abs(hk.x - rb.x);
        if (sd < 80) rb.fear += dt * sh * 0.9;
      }

      if (rb.fear >= 1 && rb.mode === "graze") {
        rb.mode = "bolt";
        rb.scut = 1;
        // panic contagion
        for (const other of world.rabbits) {
          if (
            other !== rb &&
            other.mode === "graze" &&
            Math.abs(other.x - rb.x) < 150
          )
            other.fear = Math.min(1, other.fear + 0.55);
        }
      }
      if (rb.mode === "graze") {
        if (rb.wait > 0) {
          rb.wait -= dt;
        } else {
          rb.hop += dt * 7;
          rb.x += rb.dir * 26 * dt;
          if (rng() < dt * 0.7) {
            rb.dir = rng() < 0.5 ? -1 : 1;
            rb.wait = 0.6 + rng() * 1.8;
          }
          if (rb.x < 30 || rb.x > W - 30) rb.dir *= -1;
        }
      } else if (rb.mode === "bolt") {
        // run for nearest burrow
        let best = null;
        let bd = Infinity;
        for (const b of world.burrows) {
          const bx = b.nx * W;
          const d = Math.abs(bx - rb.x);
          if (d < bd) {
            bd = d;
            best = bx;
          }
        }
        rb.hop += dt * 17;
        rb.dir = best > rb.x ? 1 : -1;
        rb.x += rb.dir * (148 + morningIdx * 9) * dt;
        if (Math.abs(best - rb.x) < 7) {
          rb.mode = "gone";
          puff(rb.x, hillY(rb.x) + 6, 4);
        }
      }
    }
    // remove long-gone, respawn up to cap
    for (let i = world.rabbits.length - 1; i >= 0; i--) {
      if (world.rabbits[i].mode === "gone") world.rabbits.splice(i, 1);
    }
    if (alive < m.cap && rng() < dt * 0.55) spawnRabbit(false);
  }

  function puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      world.particles.push({
        x,
        y,
        vx: (rng() - 0.5) * 120,
        vy: -rng() * 90 - 20,
        t: 0.5 + rng() * 0.4,
        kind: "dust",
      });
    }
  }

  function updateWorld(dt) {
    const m = MORNINGS[morningIdx];
    world.wind =
      m.wind * (1 + 0.3 * Math.sin(elapsedFly * 0.4)) +
      world.gustMag * Math.sin(world.gustT * 2.2);
    if (world.gustT <= 0) {
      world.gustT = 5 + rng() * 7;
      world.gustMag = (rng() * 0.5 + 0.3) * m.wind * 0.9;
    }
    world.gustT -= dt;
    for (const mi of world.mist) {
      mi.x += (mi.spd + world.wind * 0.25) * dt;
      if (mi.x - mi.w > W) mi.x = -mi.w;
    }
    for (const cl of world.clouds) {
      cl.x += (cl.spd + world.wind * 0.12) * dt;
      if (cl.x - 120 * cl.s > W) cl.x = -120 * cl.s;
    }
    for (const pt of world.particles) {
      pt.t -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 160 * dt;
    }
    for (let i = world.particles.length - 1; i >= 0; i--) {
      if (world.particles[i].t <= 0) world.particles.splice(i, 1);
    }
    world.shake = Math.max(0, world.shake - dt * 1.6);
    world.larkT -= dt;
    if (world.larkT <= 0) {
      world.larkT = 7 + rng() * 9;
      sfx.lark();
    }
  }

  function update(dt) {
    if (phase === PHASE.COUNT) {
      const prev = Math.ceil(countT);
      countT -= dt;
      const now = Math.ceil(countT);
      if (now !== prev && now > 0) sfx.count(false);
      if (countT <= 0) {
        phase = PHASE.FLY;
        sfx.count(true);
      }
      updatePlayer(dt);
      return;
    }
    if (phase === PHASE.BANNER) {
      bannerT -= dt;
      updatePlayer(dt);
      updateHawk(dt);
      updateWorld(dt);
      if (bannerT <= 0) {
        if (bag >= MORNINGS[morningIdx].quota) {
          if (morningIdx < 4) {
            hunger.value = 1;
            startMorning(morningIdx + 1, true);
            showCard("dawn");
            phase = PHASE.DAWN;
          } else {
            phase = PHASE.END;
            showCard("victory");
            sfx.good();
          }
        }
      }
      return;
    }
    if (phase !== PHASE.FLY) return;

    elapsedFly += dt;
    clock -= dt;
    hunger.value = clamp(
      hunger.value - dt * (world.hawk.state === HAWK.FIST ? 0.004 : 0.02),
      0,
      1,
    );
    bannerT -= dt;
    hintT += dt;
    if (hintQueue.length && hintT > 4.4) {
      hintQueue.shift();
      hintT = 0;
    }
    updatePlayer(dt);
    updateHawk(dt);
    updateRabbits(dt);
    updateWorld(dt);
    if (clock <= 0 && phase === PHASE.FLY) {
      clock = 0;
      phase = PHASE.END;
      showCard("failed");
      sfx.bad();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function skyColors() {
    return SKIES[MORNINGS[morningIdx].sky];
  }

  function drawSky() {
    const c = skyColors();
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    g.addColorStop(0, c.top);
    g.addColorStop(0.72, c.mid);
    g.addColorStop(1, c.low);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // low sun
    const sx = W * 0.76;
    const sy = H * (0.3 - morningIdx * 0.015);
    const halo = ctx.createRadialGradient(sx, sy, 4, sx, sy, H * 0.3);
    halo.addColorStop(0, "rgba(255,244,214,0.85)");
    halo.addColorStop(1, "rgba(255,244,214,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(sx - H * 0.3, sy - H * 0.3, H * 0.6, H * 0.6);
    ctx.fillStyle = c.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, TAU);
    ctx.fill();

    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (const cl of world.clouds) {
      const s = cl.s;
      ctx.beginPath();
      ctx.ellipse(cl.x, cl.y, 46 * s, 13 * s, 0, 0, TAU);
      ctx.ellipse(cl.x + 30 * s, cl.y + 4 * s, 30 * s, 10 * s, 0, 0, TAU);
      ctx.ellipse(cl.x - 32 * s, cl.y + 5 * s, 26 * s, 9 * s, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawLand() {
    const c = skyColors();
    // far ridge
    ctx.fillStyle = c.ridge;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.52);
    for (let x = 0; x <= W; x += 24) {
      ctx.lineTo(
        x,
        H * 0.47 +
          Math.sin(x * 0.002 + hillSeed * 4) * H * 0.035 +
          Math.sin(x * 0.0007) * H * 0.02,
      );
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // main down
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, c.hillA);
    g.addColorStop(1, c.hillB);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, hillY(x));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // chalk path the falconer walks
    ctx.strokeStyle = "rgba(240,232,212,0.5)";
    ctx.lineWidth = 5;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    for (let x = 0; x <= W; x += 14) {
      const y = hillY(x) + 16;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // warren mound scars + burrows
    for (const b of world.burrows) {
      const bx = b.nx * W;
      const by = hillY(bx) + 12;
      ctx.fillStyle = "#4c4033";
      ctx.beginPath();
      ctx.ellipse(bx, by, 9, 5.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(60,50,38,0.55)";
      ctx.beginPath();
      ctx.ellipse(bx + 12, by + 3, 7, 2.6, 0, 0, TAU);
      ctx.fill();
    }

    // fence post
    const px = W * 0.09;
    const py = hillY(px);
    ctx.strokeStyle = "#4a3b2c";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px, py + 4);
    ctx.lineTo(px, py - 26);
    ctx.stroke();
  }

  function drawMist(fraction) {
    if (fraction <= 0.02) return;
    for (const mi of world.mist) {
      const g = ctx.createLinearGradient(0, mi.y - 26, 0, mi.y + 30);
      const a = 0.34 * fraction;
      g.addColorStop(0, "rgba(240,240,244,0)");
      g.addColorStop(0.5, "rgba(240,240,244," + a + ")");
      g.addColorStop(1, "rgba(240,240,244,0)");
      ctx.fillStyle = g;
      ctx.fillRect(mi.x - mi.w, mi.y - 30, mi.w * 2, 62);
    }
  }

  function drawRabbit(rb) {
    const x = rb.x;
    const y = hillY(x) + 8;
    const bob = Math.abs(Math.sin(rb.hop)) * (rb.mode === "bolt" ? 9 : 3);
    ctx.save();
    ctx.translate(x, y - bob);
    ctx.scale(rb.dir, 1);
    ctx.fillStyle = rb.mode === "bolt" ? "#8a6a48" : "#7d5f41";
    ctx.beginPath();
    ctx.ellipse(0, -5, 9, 5.6, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(8, -9, 3.4, 0, TAU);
    ctx.fill();
    // ears
    ctx.strokeStyle = "#6d5238";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(8, -11.5);
    ctx.lineTo(10.5, -18);
    ctx.moveTo(6.4, -11.6);
    ctx.lineTo(7.6, -17.6);
    ctx.stroke();
    // tail
    if (rb.scut > 0 || rb.mode === "bolt") {
      ctx.fillStyle = "#efe9df";
      ctx.beginPath();
      ctx.arc(-9, -6.5, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // fear marker
    if (rb.fear > 0.55 && rb.mode === "graze") {
      ctx.fillStyle = "rgba(60,40,20," + (rb.fear - 0.55) * 1.4 + ")";
      ctx.font = "bold 10px system-ui";
      ctx.fillText("!", x - 1.5, y - 24);
    }
  }

  function drawPlayer() {
    const p = world.player;
    const lu = world.lure;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(p.dir, 1);
    // legs
    const step = p.moving ? Math.sin(p.walkT) * 5 : 0;
    ctx.strokeStyle = "#33383d";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-2, -14);
    ctx.lineTo(-4 + step, 0);
    ctx.moveTo(2, -14);
    ctx.lineTo(4 - step, 0);
    ctx.stroke();
    // coat
    ctx.fillStyle = "#5a4a38";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-6, -30, 12, 18, 4);
    else ctx.rect(-6, -30, 12, 18);
    ctx.fill();

    // head + cap
    ctx.fillStyle = "#d9b38c";
    ctx.beginPath();
    ctx.arc(1, -35, 4.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3c4438";
    ctx.beginPath();
    ctx.arc(1, -37.4, 4.6, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(1, -38.6, 7.4, 1.8);
    ctx.restore();

    // raised arm + lure line while swinging
    const hx = p.x + p.dir * 7;
    const hy = p.y - 40;
    if (lu.spin > 0.02) {
      ctx.strokeStyle = "rgba(60,50,40,0.8)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(lu.tip.x, lu.tip.y);
      ctx.stroke();
      // lure: leather triangle with tassels
      ctx.save();
      ctx.translate(lu.tip.x, lu.tip.y);
      ctx.rotate(lu.phi);
      ctx.fillStyle = "#8c5a30";
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(5.4, 4);
      ctx.lineTo(-5.4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#d8c49a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(0, 9);
      ctx.stroke();
      ctx.restore();
      // swing arc ghost
      if (lu.spin > 0.5) {
        ctx.strokeStyle = "rgba(250,245,230,0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          p.x,
          p.y - 40 - lu.spin * 6,
          16 + lu.spin * 20,
          (16 + lu.spin * 20) * 0.38,
          0,
          0,
          TAU,
        );
        ctx.stroke();
      }
    }
    // glove dot
    ctx.fillStyle = "#7a5230";
    ctx.beginPath();
    ctx.arc(hx, hy, 2.6, 0, TAU);
    ctx.fill();
  }

  function drawHawk() {
    const hk = world.hawk;
    const gy = hillY(hk.x);
    const sh = clamp(1 - (gy - hk.y) / (H * 0.55), 0, 1);
    if (sh > 0.04 && hk.state !== HAWK.FIST) {
      ctx.fillStyle = "rgba(30,34,26," + 0.22 * sh + ")";
      ctx.beginPath();
      ctx.ellipse(hk.x, gy + 8, 16 + 10 * (1 - sh), 3.6, 0, 0, TAU);
      ctx.fill();
    }
    // stoop streaks
    if (hk.state === HAWK.STOOP || hk.trail.length) {
      ctx.strokeStyle = "rgba(255,252,240,0.4)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < hk.trail.length; i++) {
        const t = hk.trail[i];
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      }
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(hk.x, hk.y);
    let ang = 0;
    if (hk.state === HAWK.STOOP) ang = Math.atan2(hk.vy, hk.vx);
    else if (hk.state === HAWK.RETURN || hk.state === HAWK.CLIMB)
      ang = Math.atan2(hk.vy, hk.vx) * 0.6;
    else ang = Math.cos(hk.ang) >= 0 ? 0.1 : Math.PI - 0.1;
    ctx.rotate(ang);
    const flap = Math.sin(hk.flap * 2.2);
    ctx.fillStyle = "#6b4a2b";
    if (hk.state === HAWK.STOOP) {
      // folded — slim delta
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.quadraticCurveTo(0, -3.4, -9, -1.2);
      ctx.quadraticCurveTo(-4, 0, -9, 1.6);
      ctx.quadraticCurveTo(0, 3.2, 11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#57381f";
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(-6, -4.4);
      ctx.lineTo(-3.4, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      // spread with flapping wings
      const wy = -6 - flap * 5;
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.quadraticCurveTo(-4, wy - 4, -14, wy);
      ctx.quadraticCurveTo(-5, wy + 6, 1, 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.quadraticCurveTo(-4, -wy * 0.3 + 6, -13, 8 + flap * 2);
      ctx.quadraticCurveTo(-4, 5, 1, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8a6538";
      ctx.beginPath();
      ctx.ellipse(4, 0, 6.4, 2.6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#57381f";
      ctx.beginPath();
      ctx.arc(9.6, -0.6, 2, 0, TAU);
      ctx.fill();
    }
    // carried rabbit
    if (hk.carry) {
      ctx.fillStyle = "#7d5f41";
      ctx.beginPath();
      ctx.ellipse(2, 6, 6.4, 3.6, 0.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const pt of world.particles) {
      ctx.fillStyle = "rgba(122,104,78," + clamp(pt.t * 1.6, 0, 0.7) + ")";
      ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3);
    }
  }

  function fmtTime(t) {
    const s = Math.max(0, Math.ceil(t));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function drawHUD() {
    const m = MORNINGS[morningIdx];
    ctx.save();
    ctx.textBaseline = "top";
    // morning + bag
    ctx.font = "600 13px system-ui";
    ctx.fillStyle = "rgba(28,32,30,0.82)";
    ctx.textAlign = "left";
    ctx.fillText("DAWN " + (morningIdx + 1), 14, 12);
    ctx.font = "700 15px system-ui";
    ctx.fillStyle = "#2c2417";
    ctx.fillText("BAG " + bag + " / " + m.quota, 14, 30);

    // pip row
    for (let i = 0; i < m.quota; i++) {
      ctx.beginPath();
      ctx.arc(84 + i * 14, 38, 4.4, 0, TAU);
      ctx.fillStyle = i < bag ? "#b0512b" : "rgba(44,36,23,0.25)";
      ctx.fill();
    }

    // mist timer bar
    const frac = clamp(clock / m.time, 0, 1);
    ctx.fillStyle = "rgba(28,32,30,0.55)";
    ctx.fillRect(W / 2 - 90, 14, 180, 8);
    ctx.fillStyle = frac > 0.35 ? "#f2ead6" : "#e8b070";
    ctx.fillRect(W / 2 - 90, 14, 180 * frac, 8);
    ctx.font = "600 10.5px system-ui";
    ctx.fillStyle = "rgba(28,32,30,0.82)";
    ctx.textAlign = "center";
    ctx.fillText("MIST " + fmtTime(clock), W / 2, 26);

    // hunger gauge (right)
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(28,32,30,0.82)";
    ctx.font = "600 13px system-ui";
    ctx.fillText("KEEN", W - 14, 12);
    ctx.fillStyle = "rgba(28,32,30,0.55)";
    ctx.fillRect(W - 114, 30, 100, 8);
    const hg = hunger.value;
    ctx.fillStyle = hg > 0.35 ? "#7fa050" : hg > 0.18 ? "#d99a3c" : "#c4502e";
    ctx.fillRect(W - 114, 30, 100 * hg, 8);

    // wind arrow
    const wl = clamp(world.wind / 70, 0, 1);
    ctx.fillStyle = "rgba(28,32,30,0.7)";
    ctx.font = "600 11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("WIND", 14, 50);
    ctx.strokeStyle = "rgba(28,32,30,0.7)";
    ctx.lineWidth = 2;
    const ax = 62;
    const ay = 55;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + 14 + wl * 26, ay);
    ctx.moveTo(ax + 14 + wl * 26, ay);
    ctx.lineTo(ax + 8 + wl * 26, ay - 4);
    ctx.moveTo(ax + 14 + wl * 26, ay);
    ctx.lineTo(ax + 8 + wl * 26, ay + 4);
    ctx.stroke();

    // hint ticker
    if (hintQueue.length) {
      const h = hintQueue[0];
      ctx.font = "italic 13px Georgia, serif";
      ctx.fillStyle = "rgba(40,36,26,0.85)";
      ctx.textAlign = "center";
      ctx.fillText(h, W / 2, H - 34);
    }

    // banner
    if (bannerT > 0 && (phase === PHASE.BANNER || bannerText)) {
      const a = clamp(bannerT > 0.3 ? 1 : bannerT / 0.3, 0, 1);
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.font = "700 34px Georgia, serif";
      ctx.fillStyle = "#fdf6e4";
      ctx.strokeStyle = "rgba(40,32,20,0.75)";
      ctx.lineWidth = 5;
      ctx.strokeText(bannerText, W / 2, H * 0.3);
      ctx.fillText(bannerText, W / 2, H * 0.3);
      if (bannerSub) {
        ctx.font = "italic 15px Georgia, serif";
        ctx.strokeStyle = "rgba(40,32,20,0.6)";
        ctx.lineWidth = 4;
        ctx.strokeText(bannerSub, W / 2, H * 0.3 + 34);
        ctx.fillText(bannerSub, W / 2, H * 0.3 + 34);
      }
      ctx.globalAlpha = 1;
    }

    // countdown
    if (phase === PHASE.COUNT) {
      const n = Math.ceil(countT);
      ctx.textAlign = "center";
      ctx.font = "700 64px Georgia, serif";
      ctx.fillStyle = "rgba(253,246,228,0.94)";
      ctx.strokeStyle = "rgba(40,32,20,0.7)";
      ctx.lineWidth = 7;
      const label = n <= 0 ? "FLY" : String(n);
      ctx.strokeText(label, W / 2, H * 0.34);
      ctx.fillText(label, W / 2, H * 0.34);
    }
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (world.shake > 0) {
      ctx.translate(
        (rng() - 0.5) * 6 * world.shake,
        (rng() - 0.5) * 5 * world.shake,
      );
    }
    drawSky();
    drawLand();
    const mistFrac =
      phase === PHASE.FLY || phase === PHASE.COUNT || phase === PHASE.BANNER
        ? clamp(clock / MORNINGS[morningIdx].time, 0, 1)
        : 1;
    drawMist(phase === PHASE.DAWN || phase === PHASE.MENU ? 1 : mistFrac);
    for (const rb of world.rabbits) drawRabbit(rb);
    drawPlayer();
    drawHawk();
    drawParticles();
    drawHUD();
    ctx.restore();

    if (paused && veil.classList.contains("hidden")) {
      ctx.fillStyle = "rgba(20,26,30,0.35)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  let lastT = performance.now();

  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  resize();
  window.addEventListener("resize", resize);
  startMorning(0, false);
  stats = freshStats();
  showMenu();
  requestAnimationFrame(frame);

  // tiny debug/testing hook (also handy for the curious)
  window.__lure = {
    phase: () => phase,
    info: () => ({
      phase,
      morning: morningIdx,
      bag,
      quota: MORNINGS[morningIdx].quota,
      clock: Number(clock.toFixed(1)),
      hawk: world.hawk.state,
      hawkPos: { x: Math.round(world.hawk.x), y: Math.round(world.hawk.y) },
      target: {
        x: Math.round(world.hawk.target.x),
        y: Math.round(world.hawk.target.y),
      },
      missDbg: world.hawk.missDbg || null,

      rabbits: world.rabbits.filter((r) => r.mode !== "gone").length,
      hunger: Number(hunger.value.toFixed(2)),
      player: { x: Math.round(world.player.x), y: Math.round(world.player.y) },
    }),
    beginSwing,
    endSwing,
    callHawk,
    dropRabbit(x) {
      world.rabbits.push({
        x: clamp(x, 30, W - 30),
        y: 0,
        dir: 1,
        mode: "graze",
        fear: 0,
        hop: 0,
        tx: 0,
        wait: 9,
        scut: 0,
      });
    },
    walk(dir) {
      keys[dir < 0 ? "left" : "right"] = true;
      setTimeout(() => {
        keys[dir < 0 ? "left" : "right"] = false;
      }, 400);
    },
    skipClock(v) {
      clock = Math.min(clock, v);
    },
  };
})();
