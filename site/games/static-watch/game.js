/* Static Watch - hunt drifting voices on an analogue trawler radio.
   Everything you hear is synthesised live with the Web Audio API. */
(() => {
  "use strict";

  /* ---------------- helpers ---------------- */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const TAU = Math.PI * 2;

  function mulberry(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const seedMatch = /#seed=(\d+)/.exec(location.hash);
  const rng = mulberry(
    seedMatch ? parseInt(seedMatch[1], 10) : Date.now() % 2147483647,
  );

  /* ---------------- constants ---------------- */

  const W = 960;
  const H = 600;
  const F_MIN = 88.0;
  const F_MAX = 108.0;
  const BAND = F_MAX - F_MIN;
  const SHIFT_LEN = 135; // seconds on watch
  const WIN_LOGS = 7; // stations needed to clear the shift

  const AMBER = "#ffb454";
  const AMBER_DIM = "#b97f3a";
  const GREEN = "#86ffa1";
  const VIOLET = "#c9a2ff";
  const PAPER = "#dfe7ee";
  const FAINT = "#6d7d90";
  const EDGE = "#2a333d";

  const MONO = '"SF Mono",ui-monospace,Menlo,Consolas,monospace';

  const NAMES = [
    "The Midnight Lantern",
    "North Carr Light",
    "Salt & Static",
    "Harbour Vespers",
    "The Long Wave",
    "Codling Bank Report",
    "The Night Net",
    "Marram FM",
    "Petrel Calling",
    "The Foghouse Hour",
    "Low Tide Serenade",
    "Wrecklight",
    "The Brine Bulletin",
    "Gannet Rock Requests",
    "Nine Fathoms Nonsense",
    "The Kelpie Waltz",
    "Dolphin Head Weather",
    "The Quiet Hour",
  ];
  const CALL_PRE = ["RV", "MV", "LT", "TB", "ND"];

  /* ---------------- dom ---------------- */

  const cv = $("radio");
  const ctx2d = cv.getContext("2d");
  const readout = $("readout");
  const veil = $("veil");
  const panelStart = $("panelStart");
  const panelPause = $("panelPause");
  const panelEnd = $("panelEnd");
  const endHead = $("endHead");
  const endGrade = $("endGrade");
  const endLogs = $("endLogs");
  const endQual = $("endQual");
  const endScore = $("endScore");
  const endBest = $("endBest");
  const endList = $("endList");
  const bestLine = $("bestLine");
  const soundBtn = $("soundBtn");
  const pauseBtn = $("pauseBtn");
  const restartBtn = $("restartBtn");

  /* ---------------- state ---------------- */

  let mode = "intro"; // intro | play | pause | over
  let autoPaused = false;
  let freq = 92.0;
  let st = null; // current station
  let stationIdx = 0;
  let pendingSpawn = 0;
  let logs = [];
  let score = 0;
  let qSumAll = 0;
  let qCount = 0;
  let timeLeft = SHIFT_LEN;
  let lockFx = 0;
  let lastLocked = "";
  let expireFx = 0;
  let bestScore = 0;

  // storm crash: 0 calm, 1 warning rumble, 2 full washout
  let crashPhase = 0;
  let crashT = 0;
  let crashNext = 7 + rng() * 6;

  // input bookkeeping
  let coarseHeld = 0;
  let blipCool = 0;
  const dragging = { on: false, x: 0, moved: 0, t0: 0 };
  let trimTimer = 0;

  // canvas scaling
  let scaleF = 1;

  // oscilloscope phase
  let scopePhase = 0;
  let nowSec = 0;

  /* ---------------- audio engine ---------------- */

  let actx = null;
  let master = null;
  let staticGain = null;
  let beatOsc = null;
  let beatGain = null;
  let humOsc = null;
  let humGain = null;
  let ghostOsc = null;
  let ghostGain = null;
  let noiseBuf = null;
  let muted = false;
  let melNext = 0;
  let melStep = 2;
  const PENTA = [0, 3, 5, 7, 10, 12];

  function beginAudio() {
    if (actx) {
      if (actx.state === "suspended") actx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(actx.destination);

    // looped white noise -> bandpass -> static bed
    const len = actx.sampleRate * 2;
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = actx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 750;
    bp.Q.value = 0.55;
    staticGain = actx.createGain();
    staticGain.gain.value = 0;
    noise.connect(bp).connect(staticGain).connect(master);
    noise.start();

    // heterodyne whistle - pitch falls as you approach the carrier
    beatOsc = actx.createOscillator();
    beatOsc.type = "triangle";
    beatOsc.frequency.value = 600;
    beatGain = actx.createGain();
    beatGain.gain.value = 0;
    beatOsc.connect(beatGain).connect(master);
    beatOsc.start();

    // warm hum heard only inside the lock window
    humOsc = actx.createOscillator();
    humOsc.type = "sine";
    humOsc.frequency.value = 98;
    humGain = actx.createGain();
    humGain.gain.value = 0;
    humOsc.connect(humGain).connect(master);
    humOsc.start();

    // ghost voice beacon
    ghostOsc = actx.createOscillator();
    ghostOsc.type = "sine";
    ghostOsc.frequency.value = 740;
    ghostGain = actx.createGain();
    ghostGain.gain.value = 0;
    ghostOsc.connect(ghostGain).connect(master);
    ghostOsc.start();

    melNext = actx.currentTime + 0.1;
  }

  function pluck(freqHz, t, dur, peak, type) {
    if (!actx) return;
    const o = actx.createOscillator();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freqHz, t);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function blip(freqHz) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    pluck(freqHz, t, 0.045, 0.05, "square");
  }

  function chime() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    [587, 784, 880, 1175].forEach((f, i) =>
      pluck(f, t + i * 0.07, 0.38, 0.16, "sine"),
    );
  }

  function sadFade() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    pluck(392, t, 0.3, 0.08, "sine");
    pluck(311, t + 0.16, 0.42, 0.08, "sine");
  }

  function crackleBurst(strong) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const hp = actx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = strong ? 900 : 2400;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(strong ? 0.28 : 0.1, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (strong ? 0.7 : 0.1));
    src.connect(hp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.8);
  }

  function playMelNote(t) {
    if (!actx) return;
    melStep = clamp(melStep + (Math.floor(rng() * 3) - 1), 0, PENTA.length - 1);
    const hz = 220 * Math.pow(2, PENTA[melStep] / 12);
    const o = actx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(hz, t);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.26);
  }

  function proximity() {
    if (!st) return 0;
    return clamp(1 - Math.abs(freq - st.f) / 2.6, 0, 1);
  }

  function inWindow() {
    return !!st && Math.abs(freq - st.f) <= st.tol;
  }

  function updateAudio() {
    if (!actx || actx.state !== "running") return;
    const t = actx.currentTime;
    const p = proximity();
    const win = inWindow() && !!st;
    const duck = crashPhase === 2 ? 0.1 : crashPhase === 1 ? 0.45 : 1;

    const statBase =
      (0.2 - 0.165 * Math.pow(p, 1.2)) * (crashPhase === 2 ? 1.5 : 1);
    staticGain.gain.setTargetAtTime(clamp(statBase, 0, 0.32), t, 0.06);

    const off = st ? Math.abs(freq - st.f) : 99;
    const bf = 110 + 1350 * Math.pow(clamp(off / 1.6, 0, 1), 1.2);
    beatOsc.frequency.setTargetAtTime(bf, t, 0.03);
    beatGain.gain.setTargetAtTime(
      0.15 * Math.pow(p, 1.5) * duck * (win ? 0.35 : 1),
      t,
      0.04,
    );

    humGain.gain.setTargetAtTime(win ? 0.07 * duck : 0, t, 0.05);

    const gp = st && st.ttl != null ? clamp(1 - off / 3.2, 0, 1) : 0;
    ghostGain.gain.setTargetAtTime(
      0.09 * gp * (0.55 + 0.45 * Math.sin(nowSec * 6.5)),
      t,
      0.05,
    );

    // station jingle plays only while held in the window
    if (win && crashPhase !== 2 && mode === "play") {
      if (melNext < t) melNext = t + 0.05;
      while (melNext < t + 0.18) {
        playMelNote(melNext);
        melNext += 0.21;
      }
    } else {
      melNext = t + 0.05;
    }
  }

  /* ---------------- station logic ---------------- */

  function spawnStation() {
    const d01 = clamp(stationIdx / 9, 0, 1);
    const side = rng() < 0.5 ? -1 : 1;
    let f = freq + side * (3.5 + rng() * 13);
    const lo = F_MIN + 0.6;
    const hi = F_MAX - 0.6;
    while (f < lo || f > hi) {
      if (f > hi) f = 2 * hi - f;
      if (f < lo) f = 2 * lo - f;
    }
    const ghost = stationIdx >= 2 && rng() < 0.33;
    const name = NAMES[stationIdx % NAMES.length];
    const call =
      CALL_PRE[Math.floor(rng() * CALL_PRE.length)] +
      "-" +
      (100 + Math.floor(rng() * 900));
    st = {
      f,
      v: (rng() * 2 - 1) * (0.006 + 0.017 * d01),
      driftMax: 0.006 + 0.017 * d01,
      wanderT: 1.2 + rng() * 1.6,
      jumpP: 0.05 + 0.22 * d01,
      jumpAmp: 0.05 + 0.09 * rng() * (0.6 + d01),
      tol: 0.075 - 0.022 * d01,
      holdNeed: 2.6 - 0.55 * d01,
      hold: 0,
      qSum: 0,
      qTime: 0,
      t: 0,
      ttl: ghost ? 7 : null,
      ghost,
      name,
      call,
    };
    stationIdx++;
  }

  function lockStation() {
    const q = clamp(st.qSum / Math.max(st.qTime, 0.001), 0, 1);
    const speedBonus = Math.max(0, 150 - Math.floor(st.t * 12));
    let pts = 100 + Math.round(210 * q) + speedBonus;
    if (st.ghost) pts += 250;
    score += pts;
    qSumAll += q;
    qCount++;
    lastLocked = st.call + " \u00b7 " + st.name;
    logs.push({
      call: st.call,
      name: st.name,
      f: st.f.toFixed(1),
      pts,
      ghost: st.ghost,
    });
    lockFx = 1;
    chime();
    st = null;
    pendingSpawn = 0.85;
  }

  function update(dt) {
    nowSec += dt;
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endShift();
      return;
    }

    // storm cycle
    if (crashPhase === 0) {
      crashNext -= dt;
      if (crashNext <= 0) {
        crashPhase = 1;
        crashT = 0.5;
      }
    } else {
      crashT -= dt;
      if (crashT <= 0) {
        if (crashPhase === 1) {
          crashPhase = 2;
          crashT = 0.75;
          crackleBurst(true);
        } else {
          crashPhase = 0;
          crashNext = 8 + rng() * 7;
        }
      }
    }

    lockFx = Math.max(0, lockFx - dt / 0.9);
    expireFx = Math.max(0, expireFx - dt);

    // coarse tuning: hold arrows, accelerating
    const dir =
      (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    if (dir !== 0) {
      coarseHeld += dt;
      const rate = 0.5 + 2.4 * Math.min(1, coarseHeld / 1.1);
      tuneTo(freq + dir * rate * dt);
      blipCool -= dt;
      if (blipCool <= 0) {
        blip(dir > 0 ? 520 : 480);
        blipCool = 0.11;
      }
    } else {
      coarseHeld = 0;
    }
    blipCool -= dt;

    if (pendingSpawn > 0) {
      pendingSpawn -= dt;
      if (pendingSpawn <= 0) spawnStation();
    } else if (st) {
      st.t += dt;

      // carrier drift
      st.wanderT -= dt;
      if (st.wanderT <= 0) {
        st.v = (rng() * 2 - 1) * st.driftMax;
        st.wanderT = 1.2 + rng() * 1.6;
      }
      if (st.f < F_MIN + 0.4 || st.f > F_MAX - 0.4) st.v *= -1;
      st.f = clamp(st.f + st.v * dt, F_MIN + 0.2, F_MAX - 0.2);
      if (rng() < st.jumpP * dt) {
        st.f = clamp(
          st.f + (rng() < 0.5 ? -1 : 1) * st.jumpAmp,
          F_MIN + 0.2,
          F_MAX - 0.2,
        );
        crackleBurst(false);
      }

      // ghost expiry
      if (st.ttl != null) {
        st.ttl -= dt;
        if (st.ttl <= 0) {
          expireFx = 1.2;
          sadFade();
          lastLocked = "";
          st = null;
          pendingSpawn = 0.6;
        }
      }
    }

    // lock progress
    if (st) {
      if (inWindow()) {
        const inst = 1 - Math.abs(freq - st.f) / st.tol;
        st.qSum += inst * dt;
        st.qTime += dt;
        st.hold += dt;
        if (st.hold >= st.holdNeed) lockStation();
      } else {
        st.hold = Math.max(0, st.hold - dt * 1.6);
      }
    }
  }

  function tuneTo(v) {
    freq = clamp(v, F_MIN, F_MAX);
  }

  /* ---------------- shift flow ---------------- */

  function initRun() {
    freq = 92.0;
    st = null;
    stationIdx = 0;
    pendingSpawn = 0.4;
    logs = [];
    score = 0;
    qSumAll = 0;
    qCount = 0;
    timeLeft = SHIFT_LEN;
    lockFx = 0;
    expireFx = 0;
    lastLocked = "";
    crashPhase = 0;
    crashT = 0;
    crashNext = 7 + rng() * 6;
  }

  function showPanel(which) {
    veil.classList.remove("off");
    for (const p of [panelStart, panelPause, panelEnd])
      p.classList.toggle("hidden", p !== which);
  }

  function hidePanels() {
    veil.classList.add("off");
  }

  function startWatch() {
    beginAudio();
    initRun();
    mode = "play";
    autoPaused = false;
    hidePanels();
    pauseBtn.textContent = "pause";
  }

  function restart() {
    if (mode === "intro") {
      startWatch();
      return;
    }
    startWatch();
  }

  function pauseWatch(auto) {
    if (mode !== "play") return;
    mode = "pause";
    autoPaused = !!auto;
    showPanel(panelPause);
    pauseBtn.textContent = "resume";
    if (actx) actx.suspend();
  }

  function resumeWatch() {
    if (mode !== "pause") return;
    mode = "play";
    autoPaused = false;
    hidePanels();
    pauseBtn.textContent = "pause";
    if (actx) actx.resume();
  }

  function togglePause() {
    if (mode === "play") pauseWatch(false);
    else if (mode === "pause") resumeWatch();
  }

  function gradeFor(n) {
    if (n >= 9) return "S";
    if (n >= 8) return "A+";
    if (n >= WIN_LOGS) return "A";
    if (n >= 5) return "B";
    if (n >= 3) return "C";
    return "D";
  }

  function endShift() {
    mode = "over";
    if (score > bestScore) bestScore = score;
    const cleared = logs.length >= WIN_LOGS;
    const avgQ = qCount ? Math.round((qSumAll / qCount) * 100) : 0;
    endHead.textContent = cleared ? "Shift cleared." : "Relieved of duty.";
    endGrade.textContent = gradeFor(logs.length);
    endGrade.classList.toggle("fail", !cleared);
    endLogs.textContent =
      logs.length + " logged \u00b7 " + WIN_LOGS + " needed";
    endQual.textContent = avgQ + "%";
    endScore.textContent = String(score);
    endBest.textContent = String(bestScore);
    endList.innerHTML = "";
    if (!logs.length) {
      const li = document.createElement("li");
      li.textContent = "nothing but static tonight\u2026";
      endList.appendChild(li);
    }
    logs.forEach((l, i) => {
      const li = document.createElement("li");
      if (l.ghost) li.className = "ghost";
      li.textContent =
        i +
        1 +
        ". " +
        l.call +
        " \u00b7 " +
        l.name +
        " (" +
        l.f +
        " MHz) +" +
        l.pts;
      endList.appendChild(li);
    });
    bestLine.textContent = "best this session: " + bestScore;
    bestLine.classList.toggle("hidden", bestScore === 0);
    showPanel(panelEnd);
    if (actx) actx.suspend();
  }

  /* ---------------- input ---------------- */

  const keys = new Set();

  function isFormTag(el) {
    const t = el.tagName;
    return (
      t === "BUTTON" || t === "INPUT" || t === "TEXTAREA" || t === "SELECT"
    );
  }

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;

    if (k === "m" || k === "M") {
      toggleSound();
      return;
    }
    if ((k === "r" || k === "R") && mode !== "over") {
      restart();
      return;
    }
    if (k === "p" || k === "P" || k === "Escape") {
      togglePause();
      return;
    }
    if (k === "Enter" || k === " ") {
      if (mode === "intro" || mode === "over") {
        e.preventDefault();
        startWatch();
      } else if (mode === "pause") {
        e.preventDefault();
        resumeWatch();
      }
      return;
    }
    if (isFormTag(e.target)) return;

    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      keys.add(k);
    } else if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      tuneTo(freq + (k === "ArrowUp" ? 0.02 : -0.02));
      blip(k === "ArrowUp" ? 880 : 800);
    }
  });

  document.addEventListener("keyup", (e) => {
    keys.delete(e.key);
  });

  function freqAtClientX(clientX) {
    const r = cv.getBoundingClientRect();
    const padL = 70;
    const padR = 70;
    const x = ((clientX - r.left) / r.width) * W;
    return F_MIN + ((x - padL) / (W - padL - padR)) * BAND;
  }

  function dragSensitivity(off) {
    if (off > 0.5) return 1;
    return lerp(0.06, 1, smooth(off / 0.5));
  }

  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    dragging.on = true;
    dragging.x = e.clientX;
    dragging.moved = 0;
    dragging.t0 = performance.now();
  });

  cv.addEventListener("pointermove", (e) => {
    if (!dragging.on) return;
    const r = cv.getBoundingClientRect();
    const dx = e.clientX - dragging.x;
    dragging.x = e.clientX;
    dragging.moved += Math.abs(dx);
    const off = st ? Math.abs(freq - st.f) : 1;
    const mPerPx = (BAND / r.width) * dragSensitivity(off);
    tuneTo(freq + dx * mPerPx);
  });

  function endDrag(e) {
    if (!dragging.on) return;
    dragging.on = false;
    if (
      dragging.moved < 5 &&
      performance.now() - dragging.t0 < 400 &&
      mode === "play"
    ) {
      tuneTo(freqAtClientX(e.clientX));
      blip(700);
    }
  }

  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", () => {
    dragging.on = false;
  });

  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      tuneTo(freq + Math.sign(e.deltaY) * 0.04);
      blip(Math.sign(e.deltaY) > 0 ? 500 : 560);
    },
    { passive: false },
  );

  function bindTrim(btn, dir) {
    const stepOnce = () => {
      if (mode !== "play") return;
      tuneTo(freq + dir * 0.02);
      blip(dir > 0 ? 880 : 800);
    };
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stepOnce();
      clearInterval(trimTimer);
      trimTimer = setInterval(stepOnce, 80);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
      btn.addEventListener(ev, () => clearInterval(trimTimer)),
    );
  }
  bindTrim($("fineDown"), -1);
  bindTrim($("fineUp"), 1);

  function toggleSound() {
    muted = !muted;
    soundBtn.textContent = muted ? "sound: off" : "sound: on";
    if (master)
      master.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.02);
  }
  soundBtn.addEventListener("click", () => {
    beginAudio();
    toggleSound();
  });

  pauseBtn.addEventListener("click", () => {
    beginAudio();
    togglePause();
  });
  restartBtn.addEventListener("click", () => {
    beginAudio();
    restart();
  });
  $("btnStart").addEventListener("click", startWatch);
  $("btnAgain").addEventListener("click", startWatch);
  $("btnResume").addEventListener("click", resumeWatch);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (mode === "play") pauseWatch(true);
    } else if (mode === "pause" && autoPaused) {
      resumeWatch();
    }
  });

  /* ---------------- drawing ---------------- */

  function roundRect(x, y, w, h, r) {
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);

    ctx2d.closePath();
  }

  function fmtClock(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function strength() {
    const p = proximity();
    let s = Math.pow(p, 1.4);
    if (crashPhase === 2) s *= 0.25 + Math.random() * 0.2;
    return s;
  }

  function coachText() {
    if (mode !== "play") return "";
    if (expireFx > 0) return "the ghost voice faded back into the sea\u2026";
    if (lockFx > 0) return lastLocked ? "LOGGED \u00b7 " + lastLocked : "";
    if (crashPhase === 2) return "storm crash \u2014 trust the eye";
    if (!st) return "finding the next voice\u2026";
    const off = Math.abs(freq - st.f);
    if (off <= st.tol)
      return (
        (st.ghost ? "\u25c6 ghost \u2014 " : "") +
        "hold it\u2026 " +
        Math.max(0, st.holdNeed - st.hold).toFixed(1) +
        "s"
      );
    if (st.ghost && off < 3)
      return "\u25c6 a ghost voice pulses nearby \u2014 be quick";
    if (off <= 0.35) return "carrier here \u2014 ease it in";
    if (off <= 1.2) return "whistle falling \u2014 nearly there";
    return "sweep the band \u2014 listen for the whistle";
  }

  function drawPanelBg() {
    const g = ctx2d.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1c232b");
    g.addColorStop(0.5, "#141a20");
    g.addColorStop(1, "#10151b");
    ctx2d.fillStyle = g;
    roundRect(10, 10, W - 20, H - 20, 16);
    ctx2d.fill();
    ctx2d.strokeStyle = EDGE;
    ctx2d.lineWidth = 2;
    ctx2d.stroke();

    // corner screws
    ctx2d.fillStyle = "#0b0f13";
    [
      [26, 26],
      [W - 26, 26],
      [26, H - 26],
      [W - 26, H - 26],
    ].forEach(([x, y]) => {
      ctx2d.beginPath();
      ctx2d.arc(x, y, 5, 0, TAU);
      ctx2d.fill();
      ctx2d.strokeStyle = "#39434e";
      ctx2d.lineWidth = 1.5;
      ctx2d.beginPath();
      ctx2d.moveTo(x - 3, y);
      ctx2d.lineTo(x + 3, y);
      ctx2d.stroke();
    });
  }

  function drawHeader() {
    ctx2d.font = "13px " + MONO;
    ctx2d.fillStyle = FAINT;
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "alphabetic";
    ctx2d.fillText(
      "NORDSEE MARINE \u00b7 KW-62 \u00b7 BAND 88\u2013108 MHz",
      40,
      48,
    );

    // clock
    let col = AMBER;
    if (timeLeft <= 10) {
      col = Math.sin(nowSec * 8) > 0 ? "#ff7d6e" : "#a04a41";
    } else if (timeLeft <= 30) {
      col = "#ffcf87";
    }
    ctx2d.font = "bold 26px " + MONO;
    ctx2d.fillStyle = col;
    ctx2d.textAlign = "right";
    ctx2d.fillText(fmtClock(timeLeft), W - 44, 52);
    ctx2d.font = "11px " + MONO;
    ctx2d.fillStyle = FAINT;
    ctx2d.fillText("TO END OF WATCH", W - 44, 68);

    // score line
    ctx2d.textAlign = "left";
    ctx2d.font = "14px " + MONO;
    ctx2d.fillStyle = GREEN;
    ctx2d.fillText(
      "LOG " + logs.length + "   SCORE " + score + "   BEST " + bestScore,
      40,
      76,
    );
  }

  function drawStatus() {
    const txt = coachText();
    if (!txt) return;
    ctx2d.save();
    ctx2d.font = "bold italic 25px Georgia, serif";
    ctx2d.textAlign = "center";
    const urgent = txt.startsWith("hold") || txt.indexOf("LOGGED") === 0;
    ctx2d.fillStyle = urgent
      ? GREEN
      : txt.indexOf("\u25c6") === 0
        ? VIOLET
        : AMBER;
    ctx2d.shadowColor = ctx2d.fillStyle;
    ctx2d.shadowBlur = urgent || lockFx > 0 ? 12 : 5;
    ctx2d.globalAlpha = lockFx > 0 ? clamp(lockFx + 0.3, 0, 1) : 0.98;
    ctx2d.fillText(txt, W / 2, 124);
    ctx2d.restore();
    ctx2d.textAlign = "left";
  }

  function drawDial() {
    const x0 = 70;
    const x1 = W - 70;
    const y0 = 196;
    const hh = 96;

    // inset strip
    ctx2d.fillStyle = "#0a0f14";
    roundRect(x0, y0, x1 - x0, hh, 10);
    ctx2d.fill();
    ctx2d.strokeStyle = EDGE;
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();

    const fx = (f) => x0 + ((f - F_MIN) / BAND) * (x1 - x0);

    // ticks
    for (let f = F_MIN; f <= F_MAX + 1e-9; f += 0.5) {
      const major = Math.abs(f % 2) < 1e-9;
      const x = fx(f);
      ctx2d.strokeStyle = major ? "#4a5866" : "#2c3742";
      ctx2d.lineWidth = major ? 2 : 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y0 + hh - 8);
      ctx2d.lineTo(x, y0 + hh - (major ? 34 : 20));
      ctx2d.stroke();
      if (major) {
        ctx2d.fillStyle = FAINT;
        ctx2d.font = "14px " + MONO;
        ctx2d.textAlign = "center";
        ctx2d.fillText(String(f), x, y0 + hh - 42);
      }
    }
    ctx2d.textAlign = "left";

    // logged markers
    for (const l of logs) {
      const x = fx(parseFloat(l.f));
      ctx2d.fillStyle = l.ghost ? VIOLET : AMBER_DIM;
      if (l.ghost) {
        ctx2d.save();
        ctx2d.translate(x, y0 + hh - 12);
        ctx2d.rotate(Math.PI / 4);
        ctx2d.fillRect(-3, -3, 6, 6);
        ctx2d.restore();
      } else {
        ctx2d.beginPath();
        ctx2d.arc(x, y0 + hh - 12, 3, 0, TAU);
        ctx2d.fill();
      }
    }

    // carrier shimmer when close (visual mercy alongside the audio)
    if (st) {
      const off = Math.abs(freq - st.f);
      if (off < 1.3) {
        const a = Math.pow(1 - off / 1.3, 2) * (crashPhase === 2 ? 0.35 : 0.8);
        const x = fx(st.f);
        const gr = ctx2d.createRadialGradient(
          x,
          y0 + hh - 30,
          2,
          x,
          y0 + hh - 30,
          64,
        );
        const col = st.ghost ? "201,162,255" : "255,235,190";
        gr.addColorStop(0, "rgba(" + col + "," + (a * 0.5).toFixed(3) + ")");
        gr.addColorStop(1, "rgba(" + col + ",0)");
        ctx2d.fillStyle = gr;
        ctx2d.fillRect(x - 66, y0 + 4, 132, hh - 8);
      }
    }

    // needle
    const nx = fx(freq);
    ctx2d.save();
    ctx2d.shadowColor = AMBER;
    ctx2d.shadowBlur = 14;
    ctx2d.strokeStyle = AMBER;
    ctx2d.lineWidth = 3;
    ctx2d.beginPath();
    ctx2d.moveTo(nx, y0 - 8);
    ctx2d.lineTo(nx, y0 + hh + 14);
    ctx2d.stroke();
    ctx2d.restore();
    ctx2d.fillStyle = AMBER;
    ctx2d.beginPath();
    ctx2d.moveTo(nx - 7, y0 - 8);
    ctx2d.lineTo(nx + 7, y0 - 8);
    ctx2d.lineTo(nx, y0 + 4);
    ctx2d.closePath();
    ctx2d.fill();

    // ghost countdown ring riding the needle
    if (st && st.ttl != null) {
      const frac = clamp(st.ttl / 7, 0, 1);
      ctx2d.strokeStyle = VIOLET;
      ctx2d.lineWidth = 3;
      ctx2d.beginPath();
      ctx2d.arc(nx, y0 - 26, 12, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx2d.stroke();
      ctx2d.strokeStyle = "rgba(201,162,255,0.25)";
      ctx2d.beginPath();
      ctx2d.arc(nx, y0 - 26, 12, 0, TAU);
      ctx2d.stroke();
    }

    // lock ripple
    if (lockFx > 0) {
      const t = 1 - lockFx;
      ctx2d.strokeStyle = "rgba(134,255,161," + (lockFx * 0.9).toFixed(3) + ")";
      ctx2d.lineWidth = 3;
      ctx2d.beginPath();
      ctx2d.arc(nx, y0 + hh / 2, 14 + t * 90, 0, TAU);
      ctx2d.stroke();
    }
  }

  function drawEye(s) {
    const cx = 152;
    const cy = 452;
    const r = 60;

    ctx2d.fillStyle = "#05080b";
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r + 10, 0, TAU);
    ctx2d.fill();
    ctx2d.strokeStyle = EDGE;
    ctx2d.lineWidth = 3;
    ctx2d.stroke();

    // phosphor glow
    const glow = ctx2d.createRadialGradient(cx, cy, 4, cx, cy, r);
    glow.addColorStop(
      0,
      "rgba(134,255,161," + (0.25 + 0.65 * s).toFixed(3) + ")",
    );
    glow.addColorStop(1, "rgba(134,255,161,0.05)");
    ctx2d.fillStyle = glow;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, TAU);
    ctx2d.fill();

    // shadow wedge narrows as the signal strengthens
    const ang = lerp(1.5, 0.12, smooth(s));
    ctx2d.fillStyle = "rgba(4,7,10,0.94)";
    ctx2d.beginPath();
    ctx2d.moveTo(cx, cy);
    ctx2d.arc(cx, cy, r + 2, -Math.PI / 2 - ang, -Math.PI / 2 + ang);
    ctx2d.closePath();
    ctx2d.fill();

    ctx2d.strokeStyle = "rgba(134,255,161,0.5)";
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, TAU);
    ctx2d.stroke();

    ctx2d.fillStyle = FAINT;
    ctx2d.font = "12px " + MONO;
    ctx2d.textAlign = "center";
    ctx2d.fillText("MAGIC EYE", cx, cy + r + 26);
    ctx2d.textAlign = "left";
  }

  function drawScope(s) {
    const x = 256;
    const y = 386;
    const w = 384;
    const h = 128;
    ctx2d.fillStyle = "#060a0e";
    roundRect(x, y, w, h, 8);
    ctx2d.fill();
    ctx2d.strokeStyle = EDGE;
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();

    const mid = y + h / 2;
    ctx2d.strokeStyle = "rgba(134,255,161,0.15)";
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(x + 8, mid);
    ctx2d.lineTo(x + w - 8, mid);
    ctx2d.stroke();

    const amp = 8 + 44 * s;
    const chaos = crashPhase === 2 ? 1 : crashPhase === 1 ? 0.4 : 0;
    ctx2d.strokeStyle = GREEN;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    const n = 130;
    for (let i = 0; i <= n; i++) {
      const px = x + 8 + ((w - 16) * i) / n;
      let v =
        Math.sin(i * 0.32 + scopePhase) * amp * (1 - chaos * 0.6) +
        (Math.random() - 0.5) * (4 + 90 * chaos);
      v = clamp(v, -h / 2 + 6, h / 2 - 6);
      if (i === 0) ctx2d.moveTo(px, mid + v);
      else ctx2d.lineTo(px, mid + v);
    }
    ctx2d.stroke();

    ctx2d.fillStyle = FAINT;
    ctx2d.font = "12px " + MONO;
    ctx2d.fillText("SCOPE", x + 8, y + h - 8);
  }

  function drawMeter(s) {
    const cx = 796;
    const cy = 452;
    const r = 74;
    const a0 = Math.PI * 0.82;
    const a1 = Math.PI * 0.18;

    ctx2d.fillStyle = "#0a0f14";
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r + 14, Math.PI, TAU);
    ctx2d.fill();
    ctx2d.strokeStyle = EDGE;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r + 14, Math.PI, TAU);
    ctx2d.stroke();

    // coloured arc segments
    const segs = [
      [0, 0.55, "#3d4954"],
      [0.55, 0.85, AMBER_DIM],
      [0.85, 1, "#4f8f63"],
    ];
    segs.forEach(([t0, t1, col]) => {
      ctx2d.strokeStyle = col;
      ctx2d.lineWidth = 7;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, lerp(a0, a1, t0), lerp(a0, a1, t1));
      ctx2d.stroke();
    });

    // ticks
    for (let i = 0; i <= 5; i++) {
      const a = lerp(a0, a1, i / 5);
      ctx2d.strokeStyle = "#4a5866";
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
      ctx2d.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
      ctx2d.stroke();
    }

    // needle
    const a = lerp(a0, a1, clamp(s, 0.02, 1));
    ctx2d.strokeStyle = PAPER;
    ctx2d.lineWidth = 2.5;
    ctx2d.beginPath();
    ctx2d.moveTo(cx, cy);
    ctx2d.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx2d.stroke();
    ctx2d.fillStyle = "#39434e";
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, 6, 0, TAU);
    ctx2d.fill();

    // lock lamps
    const win = inWindow();
    ctx2d.beginPath();
    ctx2d.arc(cx - 34, cy + 22, 5, 0, TAU);
    ctx2d.fillStyle = win ? GREEN : "#173021";
    if (win) {
      ctx2d.shadowColor = GREEN;
      ctx2d.shadowBlur = 10;
    }
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.fillStyle = FAINT;
    ctx2d.font = "11px " + MONO;
    ctx2d.fillText("LOCK", cx - 52, cy + 42);

    ctx2d.beginPath();
    ctx2d.arc(cx + 34, cy + 22, 5, 0, TAU);
    const gh = !!st && st.ttl != null;
    ctx2d.fillStyle = gh ? VIOLET : "#241f33";
    if (gh) {
      ctx2d.shadowColor = VIOLET;
      ctx2d.shadowBlur = 10;
    }
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.fillStyle = FAINT;
    ctx2d.fillText("GHOST", cx + 12, cy + 42);

    ctx2d.textAlign = "center";
    ctx2d.fillText("SIGNAL", cx, cy - r - 2);
    ctx2d.textAlign = "left";
  }

  function drawTicker() {
    ctx2d.font = "13px " + MONO;
    ctx2d.fillStyle = AMBER_DIM;
    const recent = logs.slice(-2);
    recent.forEach((l, i) => {
      ctx2d.fillStyle = l.ghost ? VIOLET : AMBER_DIM;
      ctx2d.fillText(
        "\u2713 " +
          l.call +
          " \u00b7 " +
          l.name +
          " \u00b7 " +
          l.f +
          " MHz \u00b7 +" +
          l.pts,
        40,
        562 + i * 18,
      );
    });
    if (expireFx > 0) {
      ctx2d.fillStyle =
        "rgba(201,162,255," + clamp(expireFx, 0, 1).toFixed(2) + ")";
      ctx2d.fillText("\u25c6 a ghost voice faded\u2026", W - 300, 562);
    }
  }

  function drawCrash() {
    if (crashPhase === 2) {
      const a = clamp(crashT / 0.75, 0, 1);
      ctx2d.fillStyle = "rgba(210,225,240," + (a * 0.42).toFixed(3) + ")";
      roundRect(10, 10, W - 20, H - 20, 16);
      ctx2d.fill();
    } else if (crashPhase === 1) {
      ctx2d.fillStyle =
        "rgba(210,225,240," + (0.08 * Math.sin(nowSec * 30)).toFixed(3) + ")";
      roundRect(10, 10, W - 20, H - 20, 16);
      ctx2d.fill();
    }
  }

  function draw() {
    ctx2d.setTransform(scaleF, 0, 0, scaleF, 0, 0);
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = "#04070a";
    ctx2d.fillRect(0, 0, W, H);
    drawPanelBg();
    drawHeader();
    drawStatus();
    drawDial();
    const s = mode === "play" || mode === "pause" ? strength() : 0;
    drawEye(s);
    drawScope(s);
    drawMeter(s);
    drawTicker();
    drawCrash();
  }

  /* ---------------- loop & boot ---------------- */

  let lastTs = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    scopePhase += dt * (2 + strength() * 9);
    if (mode === "play") update(dt);
    updateAudio();
    draw();
    readout.textContent = freq.toFixed(2) + " MHz";
  }

  function fit() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(320, Math.round(r.width * dpr));
    cv.height = Math.round((cv.width * H) / W);
    scaleF = cv.width / W;
  }

  window.addEventListener("resize", fit);

  // test hook - read-only helpers for automated checks
  Object.defineProperty(window, "__STATICWATCH__", {
    value: Object.freeze({
      get state() {
        return mode;
      },
      get tuned() {
        return freq;
      },
      get station() {
        return st ? st.f : null;
      },
      get tolerance() {
        return st ? st.tol : null;
      },
      get logs() {
        return logs.slice();
      },
      get timeLeft() {
        return timeLeft;
      },
      seekNear() {
        if (st) tuneTo(st.f + st.tol * 0.4);
      },
      forceEnd() {
        // test helper: cut the watch short and show the report
        if (mode === "play") {
          timeLeft = 0.01;
        }
      },
    }),
    writable: false,
  });

  fit();
  showPanel(panelStart);
  requestAnimationFrame(loop);
})();
