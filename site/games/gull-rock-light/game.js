/* Gull Rock Light — swing the lamp, walk the fleet home. */
(() => {
  "use strict";

  /* ---------------- helpers ---------------- */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const hyp = Math.hypot;
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  };
  const mulberry32 = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------------- dom ---------------- */
  const W = 960;
  const H = 600;
  const cv = document.getElementById("sea");
  const cx = cv.getContext("2d");
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * DPR;
  cv.height = H * DPR;

  const $ = (id) => document.getElementById(id);
  const elStage = $("stage");
  const elShips = $("ships-home");
  const elOilFill = $("oil-fill");
  const elOilBar = $("oil-bar");
  const elLamps = $("pill-lamps").querySelectorAll(".lamp");
  const elWind = $("wind-arrow");
  const elTicker = $("ticker");
  const elOverlay = $("overlay");
  const elKicker = $("ov-kicker");
  const elTitle = $("ov-title");
  const elText = $("ov-text");
  const elGrade = $("ov-grade");
  const elBtn = $("ov-btn");
  const btnSound = $("btn-sound");
  const btnPause = $("btn-pause");
  const btnRestart = $("btn-restart");
  const padBoost = $("pad-boost");

  /* ---------------- constants ---------------- */
  const QUOTA = 6;
  const MAX_WRECKS = 3;
  const OIL_START = 92;
  const OIL_MAX = 100;
  const RANGE_BASE = 640;
  const RANGE_BOOST = 900;
  const CATCH_HALF = 0.135;
  const SLEW = 2.0;
  const SLEW_BOOST = 2.4;
  const GATE = { x: 884, y: 540, r: 42 };
  const STANDOFF = { x: 520, y: 306 };
  const LAMP = { x: 96, y: 318 };
  const ISLET_R = 50;

  /* reef anchors: x, y, collision radius */
  const ROCK_ANCHORS = [
    [60, 84, 22],
    [150, 64, 18],
    [232, 120, 24],
    [70, 240, 18],
    [470, 296, 24],
    [596, 338, 26],
    [705, 360, 24],
    [810, 380, 22],
    [874, 300, 14],
    [660, 190, 18],
    [742, 236, 16],
    [742, 478, 24],
    [838, 448, 20],
    [922, 480, 22],
    [838, 592, 18],
    [60, 470, 18],
    [150, 556, 22],
    [320, 572, 18]
  ];

  const TYPES = {
    skiff: { len: 24, wid: 9, spd: 47, turn: 1.6 },
    smack: { len: 32, wid: 12, spd: 40, turn: 1.25 },
    coaster: { len: 44, wid: 15, spd: 33, turn: 0.95 }
  };

  /* ---------------- static geometry ---------------- */
  const rockRng = mulberry32(7);
  const ROCKS = ROCK_ANCHORS.map(([x, y, r]) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      pts.push({ a: (i / 10) * TAU + rockRng() * 0.4, rr: r * (0.84 + rockRng() * 0.34) });
    }
    return { x, y, r, pts };
  });
  const ISLET_PTS = [];
  for (let i = 0; i < 12; i++) {
    ISLET_PTS.push({ a: (i / 12) * TAU, rr: ISLET_R * (0.86 + rockRng() * 0.28) });
  }
  const GLINTS = [];
  for (let i = 0; i < 46; i++) {
    GLINTS.push({
      x: 30 + rockRng() * 900,
      y: 30 + rockRng() * 540,
      sp: 0.6 + rockRng() * 1.6,
      ph: rockRng() * TAU,
      s: 0.8 + rockRng() * 1.6
    });
  }
  const RAIN = [];
  for (let i = 0; i < 70; i++) {
    RAIN.push({ x: rockRng() * 1000, y: rockRng() * 640, sp: 380 + rockRng() * 220 });
  }

  /* ---------------- audio ---------------- */
  let AC = null;
  let master = null;
  let boostGainNode = null;
  let muted = false;

  function ensureAC() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
      } catch (err) {
        AC = null;
        return;
      }
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(AC.destination);

      /* sea ambience: filtered looping noise */
      const len = AC.sampleRate * 2;
      const buf = AC.createBuffer(1, len, AC.sampleRate);
      const d = buf.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        d[i] = lastOut * 3.5;
      }
      const src = AC.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = AC.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 260;
      const ambG = AC.createGain();
      ambG.gain.value = 0.05;
      src.connect(lp);
      lp.connect(ambG);
      ambG.connect(master);
      src.start();

      const lfo = AC.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = AC.createGain();
      lfoG.gain.value = 110;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
      lfo.start();

      /* lamp roar while boosted */
      const bsrc = AC.createBufferSource();
      bsrc.buffer = buf;
      bsrc.loop = true;
      const bp = AC.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 780;
      bp.Q.value = 0.8;
      boostGainNode = AC.createGain();
      boostGainNode.gain.value = 0;
      bsrc.connect(bp);
      bp.connect(boostGainNode);
      boostGainNode.connect(master);
      bsrc.start();
    }
    if (AC.state === "suspended") AC.resume();
  }

  function setBoostSound(on) {
    if (!AC || !boostGainNode) return;
    boostGainNode.gain.setTargetAtTime(on ? 0.11 : 0, AC.currentTime, 0.09);
  }

  function tone(freq, type, dur, vol, when, slideTo) {
    if (!AC) return;
    const t0 = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function sndHorn() {
    tone(97, "triangle", 1.1, 0.2, 0);
    tone(146, "triangle", 1.1, 0.12, 0);
  }
  function sndChime() {
    tone(659, "sine", 0.5, 0.11, 0);
    tone(784, "sine", 0.5, 0.1, 0.09);
    tone(988, "sine", 0.7, 0.1, 0.18);
  }
  function sndCrash() {
    if (!AC) return;
    const dur = 0.7;
    const buf = AC.createBuffer(1, AC.sampleRate * dur, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const lp = AC.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, AC.currentTime);
    lp.frequency.exponentialRampToValueAtTime(140, AC.currentTime + dur);
    const g = AC.createGain();
    g.gain.value = 0.5;
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start();
    tone(72, "sine", 0.8, 0.22, 0, 40);
  }
  function sndGutter() {
    tone(210, "sine", 1.7, 0.18, 0, 48);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = muted ? 0 : 0.5;
    btnSound.classList.toggle("off", muted);
  }

  /* ---------------- state ---------------- */
  let state = "title"; // title | playing | paused | ended
  let ships = [];
  let particles = [];
  let debris = [];
  let fogs = [];
  let oil = OIL_START;
  let docked = 0;
  let wrecks = 0;
  let elapsed = 0;
  let gt = 0; // global ambient clock
  let spawnT = 1.2;
  let aimCur = -0.55;
  let aimTgt = -0.55;
  let beamE = { x: 0, y: 0 }; // bright patch the ships steer for
  let beamLen = 430;
  let beamLenTgt = 430; // how far the keeper is throwing the light
  let rangeEff = RANGE_BASE;
  let wX = 0;
  let wY = 0;
  let windDeg = 0;
  let gustCd = 9;
  let gustT = 0;
  let shakeT = 0;
  let testBoost = false;
  const keys = { left: false, right: false, space: false };
  let padDown = false;
  let warnedHalf = false;
  let warnedLow = false;
  let firstSpawnDone = false;
  let lastShipId = 0;

  const boosting = () => state === "playing" && (keys.space || padDown || testBoost);

  /* ---------------- ticker ---------------- */
  let tickerTimer = null;
  function say(msg, dur) {
    elTicker.textContent = msg;
    elTicker.classList.add("show");
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => elTicker.classList.remove("show"), (dur || 2.6) * 1000);
  }

  /* ---------------- spawning ---------------- */
  function pickType() {
    const r = Math.random();
    if (docked >= 3 && r < 0.24) return TYPES.coaster;
    if (r < 0.56 || docked === 0) return TYPES.skiff;
    return TYPES.smack;
  }

  function spawn(forceTopX) {
    const type = pickType();
    let x;
    let y;
    if (forceTopX !== undefined || Math.random() < 0.62) {
      x = forceTopX !== undefined ? forceTopX : rand(300, 860);
      y = -34;
    } else {
      x = W + 34;
      y = rand(40, 300);
    }
    const hdg = Math.atan2(STANDOFF.y - y, STANDOFF.x - x) + rand(-0.12, 0.12);
    const scale = 1 + docked * 0.035;
    lastShipId += 1;
    ships.push({
      id: lastShipId,
      x,
      y,
      hdg,
      type,
      spd: type.spd * scale * rand(0.96, 1.04),
      turn: type.turn,
      len: type.len,
      wid: type.wid,
      lit: 0,
      wakeT: 0
    });
  }

  function syncFog() {
    const want = docked >= 5 ? 3 : docked >= 4 ? 2 : docked >= 2 ? 1 : 0;
    while (fogs.length < want) {
      fogs.push({
        x: rand(250, 850),
        y: rand(80, 500),
        r: rand(95, 150),
        vx: rand(-13, 13),
        vy: rand(-9, 9),
        ph: rand(0, TAU)
      });
    }
    while (fogs.length > want) fogs.pop();
  }

  /* ---------------- particles ---------------- */
  function puff(x, y, n, col, spread, up) {
    for (let i = 0; i < n; i++) {
      if (particles.length > 420) break;
      const a = rand(0, TAU);
      const v = rand(4, spread);
      particles.push({
        x: x + rand(-3, 3),
        y: y + rand(-3, 3),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (up || 0),
        life: rand(0.5, 1.3),
        max: 1.3,
        r: rand(1.5, 3.6),
        col
      });
    }
  }

  /* ---------------- events within the sim ---------------- */
  const WRECK_MSGS = [
    "She's on the rocks! God rest her.",
    "Splinters and spray - a hull lost!",
    "Too late for that one. The reef takes her."
  ];
  const DOCK_MSGS = [
    "Safe harbour! Her oil drum comes ashore.",
    "Another one home. The coffer fills.",
    "Made fast! Fresh oil for the lamp."
  ];

  function wreckShip(i) {
    const s = ships[i];
    ships.splice(i, 1);
    debris.push({ x: s.x, y: s.y, hdg: s.hdg, len: s.len });
    puff(s.x, s.y, 26, "foam", 60, 20);
    wrecks += 1;
    shakeT = 0.5;
    sndCrash();
    say(WRECK_MSGS[Math.floor(Math.random() * WRECK_MSGS.length)]);
    if (wrecks >= MAX_WRECKS) endGame(false, "rocks");
  }

  function dockShip(i) {
    const s = ships[i];
    ships.splice(i, 1);
    docked += 1;
    oil = Math.min(OIL_MAX, oil + 14);
    puff(GATE.x - 10, GATE.y - 10, 18, "spark", 40, 30);
    sndChime();
    say(DOCK_MSGS[Math.floor(Math.random() * DOCK_MSGS.length)]);
    if (docked >= QUOTA) endGame(true);
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  }

  function endGame(win, why) {
    state = "ended";
    setBoostSound(false);
    if (win) {
      const grade =
        wrecks === 0 && oil >= 35 ? "S" : wrecks <= 1 ? "A" : wrecks === 2 ? "B" : "C";
      ovShow(
        "the fleet is home",
        "All Safe",
        "Six boats brought home \u00b7 " +
          wrecks +
          (wrecks === 1 ? " hull" : " hulls") +
          " lost \u00b7 " +
          Math.round(oil) +
          " oil to spare \u00b7 " +
          fmtTime(elapsed) +
          ". The keeper banks the coals and climbs to bed.",
        "Another night",
        grade
      );
      sndChime();
    } else {
      ovShow(
        "the light has failed",
        why === "oil" ? "The Oil Burned Dry" : "Hulls on the Rocks",
        why === "oil"
          ? "The wick drinks the last of it and gutters out. Out in the dark, the gale keeps what it finds \u00b7 " +
            docked +
            "/6 home \u00b7 " +
            fmtTime(elapsed) +
            "."
          : "Three hulls on the reef is three too many. The relief boat takes your name \u00b7 " +
            docked +
            "/6 home \u00b7 " +
            fmtTime(elapsed) +
            ".",
        "Try another night",
        null
      );
      if (why === "oil") sndGutter();
    }
  }

  /* ---------------- overlay ---------------- */
  function ovShow(kicker, title, text, btnLabel, grade) {
    elKicker.textContent = kicker;
    elTitle.textContent = title;
    elText.textContent = text;
    elBtn.textContent = btnLabel;
    if (grade) {
      elGrade.hidden = false;
      elGrade.textContent = "keeper's grade \u2014 " + grade;
      elGrade.classList.toggle("bad", grade === "C");
    } else {
      elGrade.hidden = true;
    }
    elOverlay.classList.remove("hidden");
  }
  function ovHide() {
    elOverlay.classList.add("hidden");
  }

  /* ---------------- game flow ---------------- */
  function startGame() {
    ships = [];
    particles = [];
    debris = [];
    fogs = [];
    oil = OIL_START;
    docked = 0;
    wrecks = 0;
    elapsed = 0;
    spawnT = 1.2;
    aimCur = -0.55;
    aimTgt = -0.55;
    beamLen = 430;
    beamLenTgt = 430;
    gustCd = 9;
    gustT = 0;
    shakeT = 0;
    testBoost = false;
    warnedHalf = false;
    warnedLow = false;
    firstSpawnDone = false;
    state = "playing";
    elLamps.forEach((l) => l.classList.add("on"));
    btnPause.textContent = "II";
    ovHide();
    say("A sou'wester rolling in. Watch the wind.", 3.2);
    sndHorn();
  }

  function setPaused(p) {
    if (p && state === "playing") {
      state = "paused";
      setBoostSound(false);
      btnPause.textContent = "\u25b6";
      ovShow(
        "all hands resting",
        "Paused",
        "The lamp turns, the sea waits. Six boats still out there.",
        "Back to the rail"
      );
    } else if (!p && state === "paused") {
      state = "playing";
      btnPause.textContent = "II";
      ovHide();
    }
  }

  /* ---------------- input ---------------- */
  function stagePoint(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height)
    };
  }
  function aimFromEvent(e) {
    if (state !== "playing") return;
    const p = stagePoint(e);
    aimTgt = Math.atan2(p.y - LAMP.y, p.x - LAMP.x);
    /* the bright patch sits under the keeper's hand, not always at full throw */
    beamLenTgt = Math.min(hyp(p.x - LAMP.x, p.y - LAMP.y), RANGE_BOOST);
  }
  elStage.addEventListener("pointermove", aimFromEvent);
  elStage.addEventListener("pointerdown", (e) => {
    ensureAC();
    aimFromEvent(e);
  });

  padBoost.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ensureAC();
    padDown = true;
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    padBoost.addEventListener(ev, () => {
      padDown = false;
    })
  );
  padBoost.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") {
      keys.left = true;
      e.preventDefault();
    } else if (k === "ArrowRight" || k === "d" || k === "D") {
      keys.right = true;
      e.preventDefault();
    } else if (k === " ") {
      e.preventDefault();
      ensureAC();
      if (!elOverlay.classList.contains("hidden")) elBtn.click();
      else keys.space = true;
    } else if (k === "Enter") {
      if (!elOverlay.classList.contains("hidden")) elBtn.click();
    } else if (k === "p" || k === "P" || k === "Escape") {
      if (state === "playing") setPaused(true);
      else if (state === "paused") setPaused(false);
    } else if (k === "m" || k === "M") {
      setMuted(!muted);
    } else if (k === "r" || k === "R") {
      if (state !== "title") startGame();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    else if (k === " ") keys.space = false;
  });

  elBtn.addEventListener("click", () => {
    ensureAC();
    elBtn.blur();
    if (state === "title" || state === "ended") startGame();
    else if (state === "paused") setPaused(false);
  });
  btnPause.addEventListener("click", () => {
    if (state === "playing") setPaused(true);
    else if (state === "paused") setPaused(false);
  });
  btnRestart.addEventListener("click", () => startGame());
  btnSound.addEventListener("click", () => {
    ensureAC();
    setMuted(!muted);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") setPaused(true);
  });

  /* ---------------- update ---------------- */
  function update(dt) {
    elapsed += dt;

    /* oil */
    oil -= dt * (1.02 + (boosting() ? 2.3 : 0));
    if (oil < 40 && !warnedHalf) {
      warnedHalf = true;
      say("Oil below half. Mind your burning.", 2.8);
    }
    if (oil < 22 && !warnedLow) {
      warnedLow = true;
      say("The reservoir runs low!", 2.8);
    }
    if (oil <= 0) {
      oil = 0;
      endGame(false, "oil");
      return;
    }

    /* beam slew */
    if (keys.left) aimTgt -= SLEW * dt;
    if (keys.right) aimTgt += SLEW * dt;
    rangeEff = boosting() ? RANGE_BOOST : RANGE_BASE;
    const slew = boosting() ? SLEW_BOOST : SLEW;
    aimCur += clamp(angDiff(aimCur, aimTgt), -slew * dt, slew * dt);
    setBoostSound(boosting());

    /* beam endpoint: keeper's chosen throw, clipped by the world box */
    const dx = Math.cos(aimCur);
    const dy = Math.sin(aimCur);
    let tBox = Infinity;
    if (dx > 1e-6) tBox = Math.min(tBox, (930 - LAMP.x) / dx);
    if (dx < -1e-6) tBox = Math.min(tBox, (30 - LAMP.x) / dx);
    if (dy > 1e-6) tBox = Math.min(tBox, (566 - LAMP.y) / dy);
    if (dy < -1e-6) tBox = Math.min(tBox, (34 - LAMP.y) / dy);
    beamLen += clamp(beamLenTgt - beamLen, -320 * dt, 320 * dt);
    beamLen = clamp(Math.min(beamLen, tBox), 60, rangeEff);
    beamE.x = LAMP.x + dx * beamLen;
    beamE.y = LAMP.y + dy * beamLen;

    /* wind */
    if (gustT > 0) gustT -= dt;
    if (docked >= 3) {
      gustCd -= dt;
      if (gustCd <= 0) {
        gustT = 2.4;
        gustCd = rand(7, 12);
        say("A squally gust!", 2.2);
      }
    }
    const wa =
      2.35 + 0.55 * Math.sin(elapsed * 0.05 + 0.8) + 0.25 * Math.sin(elapsed * 0.013);
    const str = Math.min(16, 4 + docked * 2.4) * (gustT > 0 ? 1.9 : 1);
    wX = Math.cos(wa) * str * 0.9;
    wY = Math.sin(wa) * str * 0.9;
    windDeg = (wa * 180) / Math.PI;

    /* spawning */
    spawnT -= dt;
    if (spawnT <= 0 && ships.length < 5 && docked < QUOTA) {
      if (!firstSpawnDone) {
        spawn(520);
        firstSpawnDone = true;
      } else {
        spawn();
      }
      spawnT = Math.max(6.8, 12.6 - docked * 1.15) + rand(-0.8, 1.2);
    }

    /* ships */
    for (let i = ships.length - 1; i >= 0; i--) {
      const s = ships[i];
      const dxl = s.x - LAMP.x;
      const dyl = s.y - LAMP.y;
      const dl = hyp(dxl, dyl);
      const brg = Math.atan2(dyl, dxl);
      let tx;
      let ty;
      const fogged = inFog(s.x, s.y);
      const dg = hyp(GATE.x - s.x, GATE.y - s.y);
      const ds = hyp(STANDOFF.x - s.x, STANDOFF.y - s.y);
      let heave = 1;
      if (dl > 64 && dl < rangeEff + 26 && Math.abs(angDiff(aimCur, brg)) < CATCH_HALF && !fogged) {
        s.lit = Math.min(1, s.lit + dt * 4);
        /* close to harbour the pier lights take over the con */
        if (dg < 170) {
          tx = GATE.x;
          ty = GATE.y;
        } else {
          tx = beamE.x;
          ty = beamE.y;
        }
      } else {
        s.lit = Math.max(0, s.lit - dt * 3);
        if (ds > 80) {
          tx = STANDOFF.x;
          ty = STANDOFF.y;
        } else {
          /* hove to off the channel mouth, waiting for the light */
          heave = 0.55;
          tx = s.x + Math.cos(s.hdg + Math.PI * 0.45) * 60;
          ty = s.y + Math.sin(s.hdg + Math.PI * 0.45) * 60;
        }
      }
      /* unattended helmsmen stand off the reefs warily; a lit ship trusts
         its keeper, and fog blinds everyone */
      let ax = 0;
      let ay = 0;
      const wary = s.lit > 0.5 ? 0.5 : 1;
      if (!fogged) {
        for (const rk of ROCKS) {
          const rdx = rk.x - s.x;
          const rdy = rk.y - s.y;
          const rd = hyp(rdx, rdy);
          const danger = rk.r + 34;
          if (rd < danger && rd > 0.01) {
            const wgt = ((danger - rd) / danger) * 2.2 * wary;
            ax -= (rdx / rd) * wgt;
            ay -= (rdy / rd) * wgt;
          }
        }
        const ldx = LAMP.x - s.x;
        const ldy = LAMP.y - s.y;
        const ld = hyp(ldx, ldy);
        const ldanger = ISLET_R + 30;
        if (ld < ldanger && ld > 0.01) {
          const wgt = ((ldanger - ld) / ldanger) * 2.2 * wary;
          ax -= (ldx / ld) * wgt;
          ay -= (ldy / ld) * wgt;
        }
      }
      /* a lit ship sitting on its bright patch holds steady instead of
         spinning circles on the reef's doorstep */
      const onPatch = s.lit > 0.5 && hyp(tx - s.x, ty - s.y) < 26;
      if (!onPatch) {
        const desA = Math.atan2(ty - s.y, tx - s.x);
        const des = Math.atan2(Math.sin(desA) + ay, Math.cos(desA) + ax);
        s.hdg += clamp(angDiff(s.hdg, des), -s.turn * dt, s.turn * dt);
      }
      s.x += (Math.cos(s.hdg) * s.spd * heave + wX) * dt;
      s.y += (Math.sin(s.hdg) * s.spd * heave + wY) * dt;

      /* soft boundary */
      if (s.x < 24) s.x += 70 * dt;
      if (s.x > W - 24) s.x -= 70 * dt;
      if (s.y < 24) s.y += 70 * dt;
      if (s.y > H - 24) s.y -= 70 * dt;

      /* wake */
      s.wakeT -= dt;
      if (s.wakeT <= 0) {
        s.wakeT = 0.08;
        if (particles.length < 400) {
          particles.push({
            x: s.x - Math.cos(s.hdg) * s.len * 0.5,
            y: s.y - Math.sin(s.hdg) * s.len * 0.5,
            vx: rand(-3, 3),
            vy: rand(-3, 3),
            life: 1.1,
            max: 1.1,
            r: rand(1.2, 2.4),
            col: "wake"
          });
        }
      }

      /* collisions */
      let dead = false;
      for (const rk of ROCKS) {
        if (hyp(s.x - rk.x, s.y - rk.y) < rk.r + 7) {
          wreckShip(i);
          dead = true;
          break;
        }
      }
      if (dead) continue;
      if (hyp(s.x - LAMP.x, s.y - LAMP.y) < ISLET_R + 6) {
        wreckShip(i);
        continue;
      }
      if (dg < 42) {
        dockShip(i);
        continue;
      }
    }

    /* separation so convoys don't stack */
    for (let a = 0; a < ships.length; a++) {
      for (let b = a + 1; b < ships.length; b++) {
        const p = ships[a];
        const q = ships[b];
        const dd = hyp(q.x - p.x, q.y - p.y);
        if (dd < 26 && dd > 0.01) {
          const push = ((26 - dd) / 26) * 22 * dt;
          const nx = (q.x - p.x) / dd;
          const ny = (q.y - p.y) / dd;
          p.x -= nx * push;
          p.y -= ny * push;
          q.x += nx * push;
          q.y += ny * push;
        }
      }
    }

    /* fog drift */
    syncFog();
    for (const f of fogs) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < 60 || f.x > W - 60) f.vx *= -1;
      if (f.y < 50 || f.y > H - 50) f.vy *= -1;
    }

    /* particles */
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
    }

    if (shakeT > 0) shakeT -= dt;
  }

  function inFog(x, y) {
    for (const f of fogs) {
      if (hyp(x - f.x, y - f.y) < f.r * 0.85) return true;
    }
    return false;
  }

  /* ---------------- render ---------------- */
  function poly(pts, ox, oy, scale) {
    cx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = ox + Math.cos(pts[i].a) * pts[i].rr * (scale || 1);
      const py = oy + Math.sin(pts[i].a) * pts[i].rr * (scale || 1);
      if (i === 0) cx.moveTo(px, py);
      else cx.lineTo(px, py);
    }
    cx.closePath();
  }

  function drawShip(s) {
    cx.save();
    cx.translate(s.x, s.y);
    cx.rotate(s.hdg);
    const hl = s.len / 2;
    /* hull */
    cx.beginPath();
    cx.moveTo(hl, 0);
    cx.lineTo(-hl * 0.62, s.wid);
    cx.lineTo(-hl, s.wid * 0.55);
    cx.lineTo(-hl, -s.wid * 0.55);
    cx.lineTo(-hl * 0.62, -s.wid);
    cx.closePath();
    cx.fillStyle = "#22374a";
    cx.fill();
    cx.strokeStyle = "#0a141d";
    cx.lineWidth = 1;
    cx.stroke();
    /* deck line */
    cx.strokeStyle = "#3d5a72";
    cx.beginPath();
    cx.moveTo(hl * 0.55, 0);
    cx.lineTo(-hl * 0.7, 0);
    cx.stroke();
    /* cabin */
    cx.fillStyle = "#16283a";
    cx.fillRect(-hl * 0.55, -s.wid * 0.4, s.len * 0.28, s.wid * 0.8);
    /* mast / sail hint on smacks */
    if (s.type === TYPES.smack) {
      cx.fillStyle = "#cfc4a4";
      cx.beginPath();
      cx.moveTo(0, -s.wid * 0.9);
      cx.lineTo(-s.len * 0.3, 0);
      cx.lineTo(0, s.wid * 0.9);
      cx.closePath();
      cx.fill();
    }
    /* bow lantern when lit by the beam */
    if (s.lit > 0.03) {
      const g = cx.createRadialGradient(hl * 0.8, 0, 0, hl * 0.8, 0, 12);
      g.addColorStop(0, "rgba(255,230,160," + 0.75 * s.lit + ")");
      g.addColorStop(1, "rgba(255,230,160,0)");
      cx.fillStyle = g;
      cx.fillRect(-14, -14, s.len + 20, s.wid + 22);
      cx.fillStyle = "rgba(255,244,200," + 0.9 * s.lit + ")";
      cx.beginPath();
      cx.arc(hl * 0.8, 0, 2, 0, TAU);
      cx.fill();
    }
    cx.restore();
  }

  function render() {
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (shakeT > 0) {
      cx.translate(rand(-1, 1) * shakeT * 9, rand(-1, 1) * shakeT * 9);
    }

    /* sea */
    cx.fillStyle = "#071523";
    cx.fillRect(-12, -12, W + 24, H + 24);
    const seaG = cx.createLinearGradient(0, 0, W, H);
    seaG.addColorStop(0, "#0a1c2e");
    seaG.addColorStop(0.5, "#081827");
    seaG.addColorStop(1, "#0a2033");
    cx.fillStyle = seaG;
    cx.fillRect(-12, -12, W + 24, H + 24);

    /* wave lines */
    cx.lineWidth = 1.4;
    for (let k = 0; k < 6; k++) {
      cx.strokeStyle = "rgba(159,212,232,0.035)";
      cx.beginPath();
      const yB = 70 + k * 94;
      for (let x = -10; x <= W + 10; x += 30) {
        const yy = yB + Math.sin(x * 0.02 + gt * (0.7 + k * 0.13) + k * 2.1 + gt * 0.9) * (4 + k * 0.7);
        if (x === -10) cx.moveTo(x, yy);
        else cx.lineTo(x, yy);
      }
      cx.stroke();
    }
    /* glints */
    for (const gl of GLINTS) {
      const tw = Math.pow(Math.sin(gt * gl.sp + gl.ph), 2);
      cx.fillStyle = "rgba(191,227,236," + tw * 0.14 + ")";
      cx.fillRect(gl.x, gl.y, gl.s, gl.s);
    }

    /* beam */
    const playingish = state === "playing" || state === "ended";
    let flick = 0.9 + 0.1 * Math.sin(gt * 11) + 0.03 * Math.sin(gt * 23);
    if (oil < 25 && state !== "title") flick *= 0.72 + 0.28 * Math.abs(Math.sin(gt * 9));
    const dimFactor = playingish ? 1 : 0.55;
    const halfFar = (boosting() ? 0.075 : 0.055) + (beamLen / RANGE_BOOST) * 0.05;
    cx.save();
    cx.globalCompositeOperation = "lighter";
    const bg = cx.createRadialGradient(LAMP.x, LAMP.y, 12, LAMP.x, LAMP.y, beamLen);
    bg.addColorStop(0, "rgba(255,228,150," + 0.32 * flick * dimFactor + ")");
    bg.addColorStop(0.55, "rgba(255,214,120," + 0.11 * flick * dimFactor + ")");
    bg.addColorStop(1, "rgba(255,200,100,0)");
    cx.fillStyle = bg;
    cx.beginPath();
    cx.moveTo(LAMP.x, LAMP.y);
    cx.arc(LAMP.x, LAMP.y, beamLen, aimCur - halfFar, aimCur + halfFar);
    cx.closePath();
    cx.fill();

    /* bright patch where the beam lands */
    const pg = cx.createRadialGradient(beamE.x, beamE.y, 2, beamE.x, beamE.y, 54);
    pg.addColorStop(0, "rgba(255,236,180," + 0.4 * flick * dimFactor + ")");
    pg.addColorStop(1, "rgba(255,236,180,0)");
    cx.fillStyle = pg;
    cx.beginPath();
    cx.arc(beamE.x, beamE.y, 54, 0, TAU);
    cx.fill();

    /* lens bloom */
    const lg = cx.createRadialGradient(LAMP.x, LAMP.y, 0, LAMP.x, LAMP.y, 30);
    lg.addColorStop(0, "rgba(255,242,200," + 0.85 * flick * dimFactor + ")");
    lg.addColorStop(1, "rgba(255,242,200,0)");
    cx.fillStyle = lg;
    cx.beginPath();
    cx.arc(LAMP.x, LAMP.y, 30, 0, TAU);
    cx.fill();
    cx.restore();

    /* islet + tower */
    poly(ISLET_PTS, LAMP.x, LAMP.y, 1);
    cx.fillStyle = "#12202b";
    cx.fill();
    cx.strokeStyle = "rgba(207,232,239," + (0.1 + 0.05 * Math.sin(gt * 2)) + ")";
    cx.lineWidth = 3;
    poly(ISLET_PTS, LAMP.x, LAMP.y, 1.1);
    cx.stroke();
    cx.fillStyle = "#e9e2cf";
    cx.beginPath();
    cx.arc(LAMP.x, LAMP.y, 13, 0, TAU);
    cx.fill();
    cx.fillStyle = "#b8452f";
    cx.beginPath();
    cx.arc(LAMP.x, LAMP.y, 8.5, 0, TAU);
    cx.fill();
    cx.fillStyle = "#ffe9b0";
    cx.beginPath();
    cx.arc(LAMP.x, LAMP.y, 4.5, 0, TAU);
    cx.fill();

    /* rocks */
    ROCKS.forEach((rk, i) => {
      poly(rk.pts, rk.x, rk.y, 1);
      cx.fillStyle = "#0f1b24";
      cx.fill();
      cx.strokeStyle = "#27455c";
      cx.lineWidth = 1.5;
      cx.stroke();
      cx.strokeStyle = "rgba(207,232,239," + (0.08 + 0.05 * Math.sin(gt * 2 + i)) + ")";
      cx.lineWidth = 2;
      poly(rk.pts, rk.x, rk.y, 1.12);
      cx.stroke();
    });

    /* harbour mouth */
    cx.strokeStyle = "rgba(216,171,94,0.16)";
    cx.setLineDash([6, 8]);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.arc(GATE.x, GATE.y, 46, 0, TAU);
    cx.stroke();
    cx.setLineDash([]);
    const blink = Math.sin(gt * 3) > 0;
    const pierLights = [
      [916, 474, blink ? "#ff6b57" : "#57271f"],
      [832, 586, blink ? "#57e39a" : "#1d4d33"]
    ];
    for (const pl of pierLights) {
      cx.fillStyle = pl[2];
      cx.beginPath();
      cx.arc(pl[0], pl[1], 3, 0, TAU);
      cx.fill();
    }

    /* wreckage */
    for (const d of debris) {
      cx.save();
      cx.translate(d.x, d.y);
      cx.rotate(d.hdg);
      cx.globalAlpha = 0.9;
      cx.fillStyle = "#131f2a";
      cx.beginPath();
      cx.moveTo(d.len * 0.3, 0);
      cx.lineTo(-d.len * 0.5, d.len * 0.16);
      cx.lineTo(-d.len * 0.2, 0);
      cx.closePath();
      cx.fill();
      cx.strokeStyle = "#0a1219";
      cx.stroke();
      cx.globalAlpha = 1;
      cx.restore();
    }

    /* ships */
    for (const s of ships) drawShip(s);

    /* particles */
    for (const p of particles) {
      const a = p.life / p.max;
      if (p.col === "wake") cx.fillStyle = "rgba(159,212,232," + 0.2 * a + ")";
      else if (p.col === "foam") cx.fillStyle = "rgba(222,242,248," + 0.75 * a + ")";
      else cx.fillStyle = "rgba(255,215,130," + 0.85 * a + ")";
      cx.beginPath();
      cx.arc(p.x, p.y, p.r * (0.6 + 0.6 * a), 0, TAU);
      cx.fill();
    }

    /* fog banks */
    for (const f of fogs) {
      const fg = cx.createRadialGradient(f.x, f.y, f.r * 0.15, f.x, f.y, f.r);
      fg.addColorStop(0, "rgba(188,204,216,0.34)");
      fg.addColorStop(1, "rgba(188,204,216,0)");
      cx.fillStyle = fg;
      cx.beginPath();
      cx.arc(f.x, f.y, f.r, 0, TAU);
      cx.fill();
      const fg2 = cx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 0.55);
      fg2.addColorStop(0, "rgba(200,214,224,0.22)");
      fg2.addColorStop(1, "rgba(200,214,224,0)");
      cx.fillStyle = fg2;
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * 0.55, 0, TAU);
      cx.fill();
    }

    /* rain in the late watch */
    if (docked >= 4 && state !== "title") {
      cx.strokeStyle = "rgba(159,212,232,0.06)";
      cx.lineWidth = 1;
      cx.beginPath();
      for (const rp of RAIN) {
        const ry = ((rp.y + gt * rp.sp) % (H + 40)) - 20;
        const rx = ((rp.x - gt * rp.sp * 0.12) % (W + 40)) - 20;
        cx.moveTo(rx, ry);
        cx.lineTo(rx - 5, ry + 15);
      }
      cx.stroke();
    }

    /* vignette */
    const vg = cx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, "rgba(0,0,10,0)");
    vg.addColorStop(1, "rgba(0,0,10,0.45)");
    cx.fillStyle = vg;
    cx.fillRect(0, 0, W, H);

    syncHud();
  }

  /* ---------------- hud ---------------- */
  let hudDocked = -1;
  let hudOil = -1;
  let hudWrecks = -1;
  let hudWind = -999;
  function syncHud() {
    if (docked !== hudDocked) {
      hudDocked = docked;
      elShips.textContent = String(docked);
    }
    const oi = Math.ceil(oil);
    if (oi !== hudOil) {
      hudOil = oi;
      elOilFill.style.width = clamp((oi / OIL_MAX) * 100, 0, 100) + "%";
      elOilBar.classList.toggle("low", oi < 25);
    }
    if (wrecks !== hudWrecks) {
      hudWrecks = wrecks;
      elLamps.forEach((lamp, idx) => lamp.classList.toggle("on", idx >= wrecks));
    }
    const wd = Math.round(windDeg);
    if (wd !== hudWind) {
      hudWind = wd;
      elWind.style.transform = "rotate(" + wd + "deg)";
    }
  }

  /* ---------------- main loop ---------------- */
  let lastFrame = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    gt += dt;

    if (state === "playing") {
      update(dt);
    } else if (state === "title") {
      /* lazy demo sweep behind the card */
      aimTgt = -0.9 + 0.5 * Math.sin(gt * 0.22);
      aimCur += clamp(angDiff(aimCur, aimTgt), -SLEW * dt, SLEW * dt);
      beamLen = 430;
      beamE.x = LAMP.x + Math.cos(aimCur) * beamLen;
      beamE.y = LAMP.y + Math.sin(aimCur) * beamLen;
      particles.length = 0;
    }

    render();
  }

  /* ---------------- boot ---------------- */
  beamE.x = LAMP.x + Math.cos(aimCur) * beamLen;
  beamE.y = LAMP.y + Math.sin(aimCur) * beamLen;
  ovShow(
    "a night at the lamp",
    "Gull Rock Light",
    "Six boats are still out in the rising gale. A helmsman steers for whatever your beam shines upon \u2014 lay the bright patch ahead of each hull and walk it through the reef channel into harbour before the oil burns dry.",
    "Light the lamp"
  );
  requestAnimationFrame(frame);

  /* ---------------- test hook (only with ?test) ---------------- */
  if (/[?&]test\b/.test(location.search)) {
    window.__gr = {
      state: () => state,
      aimAt: (x, y) => {
        aimTgt = Math.atan2(y - LAMP.y, x - LAMP.x);
        beamLenTgt = Math.min(hyp(x - LAMP.x, y - LAMP.y), RANGE_BOOST);
      },
      boost: (v) => {
        testBoost = !!v;
      },
      oil: () => oil,
      setOil: (v) => {
        oil = v;
      },
      docked: () => docked,
      wrecks: () => wrecks,
      ships: () => ships.map((s) => ({ x: s.x, y: s.y, h: s.hdg, v: s.spd, l: s.lit })),
      beam: () => ({ a: aimCur, e: { x: beamE.x, y: beamE.y }, len: beamLen }),
      forceSpawn: () => spawn(),
      restart: () => startGame()
    };
  }
})();
