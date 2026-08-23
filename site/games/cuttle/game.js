/* Cuttle — mix your skin into the reef wall before the grouper's gaze finds you. */
(() => {
  "use strict";

  /* ---------------- tiny utils ---------------- */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const $ = (id) => document.getElementById(id);

  function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- pigments ---------------- */

  const PIGMENTS = [
    { key: "O", name: "Ochre", base: [192, 138, 78] },
    { key: "L", name: "Olive", base: [124, 138, 74] },
    { key: "R", name: "Rose", base: [196, 124, 134] },
    { key: "S", name: "Slate", base: [94, 114, 134] },
  ];

  // Blend a weight vector into an RGB colour.
  function blend(w, k = 1) {
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += Math.max(0, w[i]);
    if (sum < 1e-4) return [128, 128, 128];
    const c = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let i = 0; i < 4; i++)
        acc += (Math.max(0, w[i]) / sum) * PIGMENTS[i].base[j];
      c[j] = clamp(Math.round(acc * k), 0, 255);
    }
    return c;
  }

  const css = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  function mixVec(a, b, t) {
    return [
      lerp(a[0], b[0], t),
      lerp(a[1], b[1], t),
      lerp(a[2], b[2], t),
      lerp(a[3], b[3], t),
    ];
  }

  function vecDelta(a, b) {
    return (
      Math.abs(a[0] - b[0]) +
      Math.abs(a[1] - b[1]) +
      Math.abs(a[2] - b[2]) +
      Math.abs(a[3] - b[3])
    );
  }

  function randomTarget(rnd, prev) {
    for (let tries = 0; tries < 24; tries++) {
      const w = [
        Math.pow(rnd(), 1.3),
        Math.pow(rnd(), 1.3),
        Math.pow(rnd(), 1.3),
        Math.pow(rnd(), 1.3),
      ];
      const sum = w[0] + w[1] + w[2] + w[3];
      const v = w.map((x) => x / sum);
      if (!prev || vecDelta(v, prev) > 0.55) return v;
    }
    return [0.25, 0.25, 0.25, 0.25];
  }

  /* ---------------- audio ---------------- */

  const Sound = (() => {
    let ac = null;
    let master = null;
    let noiseBuf = null;
    let muted = false;

    function ensure() {
      if (ac) {
        if (ac.state === "suspended") ac.resume();
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(
        1,
        Math.floor(ac.sampleRate * 0.5),
        ac.sampleRate,
      );
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }

    function tone(
      freq,
      dur,
      type = "sine",
      vol = 0.12,
      slideTo = null,
      delay = 0,
    ) {
      if (!ac || muted) return;
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }

    function noise(dur, vol = 0.2, delay = 0, rate = 1) {
      if (!ac || muted) return;
      const t0 = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = rate;
      const g = ac.createGain();
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(900, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    }

    return {
      unlock: ensure,
      setMuted(m) {
        muted = m;
        if (master) master.gain.value = m ? 0 : 0.5;
      },
      tick() {
        tone(640, 0.05, "square", 0.022);
      },
      warn() {
        tone(96, 0.28, "triangle", 0.16);
        tone(96, 0.28, "triangle", 0.16, null, 0.34);
      },
      sweepCue() {
        tone(210, 0.4, "sawtooth", 0.05, 140);
      },
      safe(flawless) {
        const seq = flawless ? [520, 660, 784, 1046] : [520, 660, 784];
        seq.forEach((f, i) => tone(f, 0.14, "sine", 0.1, null, i * 0.08));
      },
      strike() {
        tone(180, 0.35, "sawtooth", 0.18, 55);
        noise(0.25, 0.22, 0, 0.7);
      },
      ink() {
        noise(0.45, 0.26, 0, 0.5);
        tone(320, 0.3, "sine", 0.06, 90);
      },
      over() {
        [330, 262, 196].forEach((f, i) =>
          tone(f, 0.32, "triangle", 0.13, null, i * 0.22),
        );
      },
      start() {
        tone(392, 0.12, "sine", 0.09);
        tone(587, 0.16, "sine", 0.09, null, 0.1);
      },
    };
  })();

  /* ---------------- layout constants ---------------- */

  const W = 960;
  const H = 640;
  const FISH = { x: 300, y: 348 };
  // Judgement is by perceived colour, not raw weights: many different mixes
  // render nearly identically, so the skin RGB is compared against the wall
  // RGB. MM_SCALE is the summed channel delta that maps to meter zero.
  const MM_SCALE = 240;
  const SLIDER = { y: 556, h: 30, laneW: 186, gap: 18 };
  SLIDER.x0 = (W - (4 * SLIDER.laneW + 3 * SLIDER.gap)) / 2;
  SLIDER.padX = 10;

  function laneRect(i) {
    return {
      x: SLIDER.x0 + i * (SLIDER.laneW + SLIDER.gap),
      y: SLIDER.y,
      w: SLIDER.laneW,
      h: SLIDER.h,
    };
  }

  /* ---------------- state ---------------- */

  const canvas = $("stage");
  const ctx = canvas.getContext("2d");

  const S = {
    mode: "title", // title | playing | paused | over
    time: 0,
    wave: 1,
    score: 0,
    streak: 0,
    hearts: 3,
    ink: 1,
    tol: 64,
    player: [0.25, 0.25, 0.25, 0.25],
    selected: 0,
    Tfrom: [0.3, 0.3, 0.2, 0.2],
    Tto: [0.3, 0.3, 0.2, 0.2],
    fadeT: 1, // target crossfade progress
    wanderSeed: [0, 0, 0, 0],
    wallSeed: 1234,
    skinSeed: 777,
    wt: 0, // time inside current wave
    phase: "cruise", // cruise | warn | sweep | result
    sweepU: 0,
    savedThisSweep: false,
    outcome: "", // safe | spotted | inked
    outcomeT: 0,
    shakeT: 0,
    flashT: 0,
    floaters: [],
    inkCloud: [],
    grouperX: 700,
    grouperY: 108,
    lastTick: 0,
    dragLane: -1,
    best: 0,
    wavesSurvived: 0,
  };

  try {
    S.best = Number(localStorage.getItem("cuttle.best") || 0) || 0;
  } catch (e) {
    S.best = 0;
  }

  function displayedTarget() {
    const base = mixVec(S.Tfrom, S.Tto, easeInOut(clamp(S.fadeT, 0, 1)));
    const amp = Math.min(0.032 + S.wave * 0.004, 0.07);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const ph = S.wanderSeed[i] * TAU;
      const f = 0.05 + 0.02 * i;
      out.push(base[i] + amp * Math.sin(S.time * f * TAU + ph));
    }
    return out.map((v) => clamp(v, 0.02, 0.94));
  }

  function normalizedPlayer() {
    const sum = S.player.reduce((a, b) => a + Math.max(0, b), 0);
    if (sum < 1e-3) return [0.25, 0.25, 0.25, 0.25];
    return S.player.map((v) => Math.max(0, v) / sum);
  }

  // Perceptual mismatch: summed RGB distance between the rendered skin and
  // the rendered wall colour.
  function mismatch() {
    const a = blend(normalizedPlayer());
    const b = blend(displayedTarget());
    return (
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    );
  }

  function quality() {
    return 1 - clamp(mismatch() / MM_SCALE, 0, 1);
  }

  function qSafe() {
    return 1 - S.tol / MM_SCALE;
  }

  function toleranceFor(n) {
    return Math.max(34, 64 - (n - 1) * 3.4);
  }

  function waveLengthFor(n) {
    return clamp(16.5 - (n - 1) * 0.62, 9.5, 16.5);
  }

  function warnAt(n) {
    return waveLengthFor(n) - 3.7;
  }

  function sweepAt(n) {
    return waveLengthFor(n) - 2.45;
  }
  function evalAt(n) {
    return waveLengthFor(n) - 1.15;
  }

  /* ---------------- flow ---------------- */

  function startRun() {
    const rnd = mulberry32((Math.random() * 1e9) | 0);
    S.mode = "playing";
    S.wave = 1;
    S.score = 0;
    S.streak = 0;
    S.hearts = 3;
    S.ink = 1;
    S.player = [0.25, 0.25, 0.25, 0.25];
    S.selected = 0;
    S.wavesSurvived = 0;
    S.floaters.length = 0;
    S.inkCloud.length = 0;
    S.shakeT = 0;
    S.flashT = 0;
    S.tol = toleranceFor(1);
    S.Tto = randomTarget(rnd, null);
    S.Tfrom = S.Tto.slice();
    S.fadeT = 1;
    S.wallSeed = (rnd() * 1e9) | 0;
    S.skinSeed = (rnd() * 1e9) | 0;
    beginWave(1, true);
    hideVeil();
    updateHud();
    Sound.start();
  }

  function beginWave(n, first = false) {
    S.wave = n;
    S.tol = toleranceFor(n);
    const rnd = mulberry32(((Math.random() * 1e9) | 0) ^ (n * 2654435761));
    const prev = displayedTarget().slice();
    const next = randomTarget(rnd, prev);
    S.Tfrom = prev;
    S.Tto = next;
    S.fadeT = first ? 1 : 0;
    S.wallSeed = (rnd() * 1e9) | 0;
    S.wanderSeed = [rnd(), rnd(), rnd(), rnd()];
    S.wt = 0;
    S.phase = "cruise";
    S.sweepU = 0;
    S.savedThisSweep = false;
    S.outcome = "";
    S.outcomeT = 0;
  }

  function nextWave() {
    beginWave(S.wave + 1);
    updateHud();
  }

  function spendInk() {
    if (S.mode !== "playing" || S.ink <= 0) return;
    S.ink -= 1;
    Sound.ink();
    spawnInkCloud(FISH.x, FISH.y);
    if ((S.phase === "sweep" || S.phase === "warn") && !S.savedThisSweep) {
      S.savedThisSweep = true;
      S.streak = Math.ceil(S.streak / 2);
      S.streak = Math.ceil(S.streak / 2);
      addFloater("vanished in ink", FISH.x, FISH.y - 130, "#cfd6e4");

      addFloater("ink spent", FISH.x, FISH.y - 130, "rgba(207,214,228,0.8)");
    }
    updateHud();
  }

  function resolveSweep() {
    if (S.savedThisSweep) {
      S.phase = "result";
      S.outcome = "inked";
      S.outcomeT = 0;
      return;
    }
    const q = quality();
    if (mismatch() <= S.tol) {
      S.phase = "result";
      S.outcome = "safe";
      S.outcomeT = 0;
      const flawless = q >= 0.9;
      const mult = 1 + 0.25 * Math.min(S.streak, 8);
      const pts = Math.round((50 + 300 * q) * mult) + (flawless ? 150 : 0);
      S.score += pts;
      S.streak += 1;
      S.wavesSurvived += 1;
      if (S.score > S.best) {
        S.best = S.score;
        try {
          localStorage.setItem("cuttle.best", String(S.best));
        } catch (e) {
          /* private mode */
        }
      }
      if (flawless)
        addFloater(`FLAWLESS +${pts}`, FISH.x, FISH.y - 150, "#ffd98a");
      else addFloater(`SAFE +${pts}`, FISH.x, FISH.y - 145, "#9fe0b0");
      if (S.wavesSurvived % 2 === 0 && S.ink < 1) {
        S.ink = 1;
        addFloater("ink replenished", FISH.x, FISH.y - 112, "#bfe8e2");
      }
      Sound.safe(flawless);
    } else {
      S.phase = "result";
      S.outcome = "spotted";
      S.outcomeT = 0;
      S.hearts -= 1;
      S.streak = 0;
      S.shakeT = 0.5;
      S.flashT = 0.35;
      addFloater("SPOTTED!", FISH.x, FISH.y - 145, "#ff8f80");
      Sound.strike();
      if (S.hearts <= 0) {
        gameOver();
        return;
      }
    }
    updateHud();
  }

  function gameOver() {
    S.mode = "over";
    if (S.score > S.best) {
      S.best = S.score;
      try {
        localStorage.setItem("cuttle.best", String(S.best));
      } catch (e) {
        /* private mode */
      }
    }
    $("overLine").textContent =
      `The grouper found you on wave ${S.wave}, ` +
      `${["first light", "mid-morning", "high sun", "long afternoon"][Math.min(3, Math.floor(S.wavesSurvived / 4))]}.`;
    $("overStats").textContent =
      `${S.score} points · ${S.wavesSurvived} wave${S.wavesSurvived === 1 ? "" : "s"} survived · best ${S.best}`;
    $("overBest").textContent = String(S.best);
    showPanel("panelOver");
    Sound.over();
  }

  /* ---------------- effects ---------------- */

  function addFloater(text, x, y, color) {
    S.floaters.push({ text, x, y, color, t: 0 });
  }

  function spawnInkCloud(x, y) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU;
      const sp = 30 + Math.random() * 130;
      S.inkCloud.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        r: 10 + Math.random() * 26,
        t: 0,
        life: 1.6 + Math.random() * 1.2,
      });
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    S.time += dt;
    if (S.mode !== "playing") {
      stepEffects(dt);
      return;
    }

    S.fadeT = Math.min(1, S.fadeT + dt / 1.2);
    S.wt += dt;
    const n = S.wave;

    if (S.phase !== "result") {
      if (S.wt >= sweepAt(n)) {
        if (S.phase !== "sweep") Sound.sweepCue();
        S.phase = "sweep";
        S.sweepU = clamp((S.wt - sweepAt(n)) / (evalAt(n) - sweepAt(n)), 0, 1);
        if (S.sweepU >= 1) resolveSweep();
      } else if (S.wt >= warnAt(n)) {
        if (S.phase !== "warn") Sound.warn();
        S.phase = "warn";
      }
    } else {
      S.outcomeT += dt;
      if (S.outcomeT > 1.15) nextWave();
    }

    // grouper drift
    const gxHome =
      S.phase === "warn" || S.phase === "sweep"
        ? 742
        : 700 + Math.sin(S.time * 0.5) * 60;
    S.grouperX = lerp(S.grouperX, gxHome, 1 - Math.pow(0.001, dt));
    S.grouperY = 108 + Math.sin(S.time * 1.3) * 8;

    stepEffects(dt);
  }

  function stepEffects(dt) {
    for (const f of S.floaters) f.t += dt;
    S.floaters = S.floaters.filter((f) => f.t < 1.6);
    for (const p of S.inkCloud) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
    }
    S.inkCloud = S.inkCloud.filter((p) => p.t < p.life);
    if (S.shakeT > 0) S.shakeT = Math.max(0, S.shakeT - dt);
    if (S.flashT > 0) S.flashT = Math.max(0, S.flashT - dt);
  }

  /* ---------------- drawing ---------------- */

  function drawWall(T) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(blend(T, 1.06)));
    g.addColorStop(1, css(blend(T, 0.78)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const rnd = mulberry32(S.wallSeed);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 24 + rnd() * 70;
      const jit = (rnd() - 0.5) * 0.24;
      const wob = Math.sin(S.time * 0.15 + i) * 0.03;
      const c = blend(
        T.map((v) => clamp(v + jit + wob, 0, 1)),
        0.86 + rnd() * 0.24,
      );
      ctx.fillStyle = css(c, 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, TAU);
      ctx.fill();
    }
    // crevices
    ctx.strokeStyle = css(blend(T, 0.55), 0.35);
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const x = mulberry32(S.wallSeed + i * 97)();
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.quadraticCurveTo(x + 60, H * 0.5, x - 30, H + 10);
      ctx.stroke();
    }
    // faint light shafts
    ctx.fillStyle = "rgba(255,240,200,0.045)";
    for (let i = 0; i < 3; i++) {
      const x = ((S.time * 8 + i * 340) % (W + 300)) - 150;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 90, 0);
      ctx.lineTo(x + 190, H);
      ctx.lineTo(x + 60, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawFish() {
    const P = normalizedPlayer();
    const skin = blend(P);
    const bob = Math.sin(S.time * 1.1) * 6;
    const hurt = S.flashT > 0;

    ctx.save();
    ctx.translate(FISH.x, FISH.y + bob);

    // contact shadow against the wall
    ctx.fillStyle = "rgba(10,14,18,0.28)";
    ctx.beginPath();
    ctx.ellipse(10, 66, 118, 26, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(
      Math.sin(S.time * 0.9) * 0.03 + (hurt ? Math.sin(S.time * 60) * 0.04 : 0),
    );

    // frilled fins behind the body
    ctx.strokeStyle = css(blend(P, 1.18), 0.85);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.82 + i * 0.16 + Math.sin(S.time * 3 + i) * 0.06;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 96, Math.sin(a) * 66);
      ctx.lineTo(
        Math.cos(a) * (132 + Math.sin(S.time * 2.4 + i * 2) * 10),
        Math.sin(a) * (96 + Math.sin(S.time * 2.4 + i) * 8),
      );
      ctx.stroke();
    }

    // arms fan at the front
    ctx.strokeStyle = css(blend(P, 0.88), 0.95);
    ctx.lineWidth = 9;
    for (let i = 0; i < 6; i++) {
      const a = 0.55 + i * 0.14 + Math.sin(S.time * 2.2 + i * 1.7) * 0.07;
      ctx.beginPath();
      ctx.moveTo(58, 34);
      ctx.quadraticCurveTo(
        58 + Math.cos(a) * 52,
        34 + Math.sin(a) * 40,
        58 + Math.cos(a) * 84,
        34 + Math.sin(a) * 62,
      );
      ctx.stroke();
    }

    // mantle
    ctx.fillStyle = hurt ? css([255, 205, 195]) : css(skin);
    ctx.beginPath();
    ctx.ellipse(0, 0, 118, 82, 0, 0, TAU);
    ctx.fill();

    // mottled chromatophores
    const rnd = mulberry32(S.skinSeed);
    for (let i = 0; i < 24; i++) {
      const ang = rnd() * TAU;
      const rad = Math.sqrt(rnd());
      const dx = Math.cos(ang) * rad * 100;
      const dy = Math.sin(ang) * rad * 68;
      const jit = (rnd() - 0.5) * 0.3;
      const c = blend(
        P.map((v) => clamp(v + jit, 0, 1)),
        0.85 + rnd() * 0.3,
      );
      ctx.fillStyle = css(c, 0.6);
      ctx.beginPath();
      ctx.ellipse(
        dx,
        dy,
        8 + rnd() * 17,
        6 + rnd() * 13,
        rnd() * Math.PI,
        0,
        TAU,
      );
      ctx.fill();
    }

    // sheen
    const sh = ctx.createLinearGradient(0, -82, 0, 60);
    sh.addColorStop(0, "rgba(255,255,255,0.16)");
    sh.addColorStop(1, "rgba(0,0,0,0.14)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(0, 0, 118, 82, 0, 0, TAU);
    ctx.fill();

    // eyes with W pupils
    for (const side of [-1, 1]) {
      const ex = side * 46;
      const ey = -26;
      ctx.fillStyle = "#e8e4cf";
      ctx.beginPath();
      ctx.ellipse(ex, ey, 21, 17, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(40,36,30,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#20242c";
      ctx.beginPath();
      ctx.arc(ex, ey, 10.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e8e4cf";
      for (const off of [-4.2, 4.2]) {
        ctx.beginPath();
        ctx.moveTo(ex + off - 4, ey - 12);
        ctx.lineTo(ex + off + 4, ey - 12);
        ctx.lineTo(ex + off, ey - 1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(ex - 4, ey + 3, 2.4, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawGrouper() {
    const gx = S.grouperX;
    const gy = S.grouperY;
    const active = S.phase === "warn" || S.phase === "sweep";

    ctx.save();
    ctx.translate(gx, gy);
    const wag = Math.sin(S.time * (active ? 6 : 2.4)) * 0.25;

    // tail
    ctx.fillStyle = "#4a5a4c";
    ctx.save();
    ctx.translate(86, 0);
    ctx.rotate(wag);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(52, -34);
    ctx.lineTo(40, 0);
    ctx.lineTo(52, 34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // body
    ctx.fillStyle = "#5b6a52";
    ctx.beginPath();
    ctx.ellipse(0, 0, 88, 52, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#79876a";
    ctx.beginPath();
    ctx.ellipse(-6, 16, 66, 28, 0, 0, TAU);
    ctx.fill();

    // dorsal spines
    ctx.strokeStyle = "#39443a";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const x = -50 + i * 18;
      ctx.beginPath();
      ctx.moveTo(x, -44 + Math.abs(i - 2.5) * 4);
      ctx.lineTo(x + 4, -72 + Math.abs(i - 2.5) * 7);
      ctx.stroke();
    }

    // lips
    ctx.fillStyle = "#8a6a5a";
    ctx.beginPath();
    ctx.ellipse(-84, 8, 20, 13, 0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-80, 20, 15, 8, 0.2, 0, TAU);
    ctx.fill();

    // pectoral fin
    ctx.fillStyle = "#49563f";
    ctx.save();
    ctx.translate(6, 8);
    ctx.rotate(Math.sin(S.time * 4) * 0.2 + 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 16, 10, 22, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // eye tracks the cuttlefish
    const ang = Math.atan2(FISH.y - gy, FISH.x - gx);
    ctx.fillStyle = "#ded6b8";
    ctx.beginPath();
    ctx.arc(-56, -14, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#181c16";
    ctx.beginPath();
    ctx.arc(-56 + Math.cos(ang) * 5, -14 + Math.sin(ang) * 5, 7.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#2c332a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-74, -30);
    ctx.lineTo(-40, -22); // angry brow
    ctx.stroke();

    ctx.restore();

    // warning exclamation
    if (S.phase === "warn") {
      const pulse = 1 + Math.sin(S.time * 10) * 0.12;
      ctx.save();
      ctx.translate(gx, gy - 92);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = "#ff8f80";
      ctx.font = "bold 34px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("!", 0, 0);
      ctx.restore();
    }
  }

  function drawGaze() {
    if (S.phase !== "sweep") return;
    const u = easeInOut(S.sweepU);
    const gx = S.grouperX - 60;
    const gy = S.grouperY - 14;
    const angF = Math.atan2(FISH.y - gy, FISH.x - gx);
    const spread = 1.15 * (1 - u) + 0.0001;
    const ang = angF - spread + spread * 2 * u;
    const len = 760;
    const hw = 0.14 + 0.1 * (1 - u);

    const grd = ctx.createRadialGradient(gx, gy, 10, gx, gy, len);
    grd.addColorStop(0, "rgba(255,233,176,0.34)");
    grd.addColorStop(1, "rgba(255,233,176,0.02)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.arc(gx, gy, len, ang - hw, ang + hw);
    ctx.closePath();
    ctx.fill();

    // beam edge
    ctx.strokeStyle = "rgba(255,233,176,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(ang - hw) * len, gy + Math.sin(ang - hw) * len);
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(ang + hw) * len, gy + Math.sin(ang + hw) * len);
    ctx.stroke();
  }

  function drawMeter() {
    if (S.mode === "title") return;
    const x = 34;
    const y = 30;
    const w = 250;
    const h = 15;
    const q = quality();
    const qs = qSafe();

    ctx.fillStyle = "rgba(6,24,30,0.66)";
    roundRect(x - 10, y - 12, w + 20, h + 38, 9);
    ctx.fill();

    ctx.font = "italic 12px Georgia, serif";
    ctx.fillStyle = "rgba(191,232,226,0.85)";
    ctx.textAlign = "left";
    ctx.fillText(`skin match ${Math.round(q * 100)}%`, x, y - 1);

    // track
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(x, y + 6, w, h, 7);
    ctx.fill();
    // safe zone
    const zx = qs * w;
    ctx.fillStyle = "rgba(127,201,143,0.22)";
    roundRect(x + zx, y + 6, w - zx, h, 7);
    ctx.fill();
    // fill
    const hue = lerp(
      8,
      130,
      clamp(
        ((q - qs) / Math.max(0.001, 1 - qs)) * 0.5 + (q >= qs ? 0.5 : 0),
        0,
        1,
      ),
    );
    const fillCol = q >= qs ? "rgba(127,201,143,0.9)" : `hsl(${hue} 70% 55%)`;
    ctx.fillStyle = fillCol;
    roundRect(x, y + 6, Math.max(h, q * w), h, 7);
    ctx.fill();
    // threshold tick
    ctx.strokeStyle = "#ffd98a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + zx, y + 2);
    ctx.lineTo(x + zx, y + h + 10);
    ctx.stroke();
  }

  function drawSliders() {
    if (S.mode === "title") return;
    const P = S.player;
    const mixed = blend(normalizedPlayer());
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "left";

    // backing strip
    ctx.fillStyle = "rgba(4,20,26,0.55)";
    roundRect(
      SLIDER.x0 - 22,
      SLIDER.y - 34,
      4 * SLIDER.laneW + 3 * SLIDER.gap + 44,
      SLIDER.h + 52,
      12,
    );
    ctx.fill();

    for (let i = 0; i < 4; i++) {
      const r = laneRect(i);
      const sel = i === S.selected;
      const col = PIGMENTS[i].base;

      ctx.fillStyle = sel ? "rgba(255,217,138,0.14)" : "transparent";
      roundRect(r.x - 8, r.y - 26, r.w + 16, r.h + 40, 9);
      if (sel) ctx.fill();

      ctx.fillStyle = sel ? "#ffd98a" : "rgba(191,232,226,0.8)";
      ctx.fillText(
        `${PIGMENTS[i].key} · ${PIGMENTS[i].name}${sel ? " ◂" : ""}`,
        r.x,
        r.y - 12,
      );

      // track
      ctx.fillStyle = "rgba(255,255,255,0.13)";
      roundRect(r.x + SLIDER.padX, r.y, r.w - SLIDER.padX * 2, r.h, r.h / 2);
      ctx.fill();
      const tw = r.w - SLIDER.padX * 2;
      const fw = Math.max(r.h, P[i] * tw);
      ctx.fillStyle = css(col, 0.95);
      roundRect(r.x + SLIDER.padX, r.y, fw, r.h, r.h / 2);
      ctx.fill();

      // knob shows resulting skin colour
      const kx = r.x + SLIDER.padX + P[i] * tw;
      ctx.beginPath();
      ctx.arc(kx, r.y + r.h / 2, r.h / 2 + 3, 0, TAU);
      ctx.fillStyle = sel ? "#ffd98a" : "rgba(230,230,220,0.9)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(kx, r.y + r.h / 2, r.h / 2 - 1, 0, TAU);
      ctx.fillStyle = css(mixed);
      ctx.fill();
    }
  }

  function drawCaptions() {
    if (S.mode !== "playing") return;
    let text = "";
    if (S.phase === "result") {
      if (S.outcome === "spotted") text = "the gaze found you";
      else if (S.outcome === "inked") text = "lost in the cloud";
      else text = "you were scenery";
    } else if (S.phase === "sweep") {
      text = S.savedThisSweep ? "gone blind up there" : "hold… hold…";
    } else if (S.phase === "warn") {
      text = "the grouper stirs";
    } else if (S.fadeT < 1) {
      text = "the wall turns over";
    } else {
      text = `read the wall · wave ${S.wave}`;
    }
    if (!text) return;
    ctx.font = "italic 19px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(10,22,26,0.55)";
    const w = ctx.measureText(text).width;
    roundRect(W / 2 - w / 2 - 14, 16, w + 28, 30, 9);
    ctx.fill();
    ctx.fillStyle = "rgba(224,242,236,0.92)";
    ctx.fillText(text, W / 2, 37);
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    for (const f of S.floaters) {
      const a = f.t < 1.1 ? 1 : 1 - (f.t - 1.1) / 0.5;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = "bold 22px Georgia, serif";
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 26);
      ctx.globalAlpha = 1;
    }
  }

  function drawInk() {
    for (const p of S.inkCloud) {
      const a = clamp(1 - p.t / p.life, 0, 1) * 0.75;
      ctx.fillStyle = `rgba(16,16,24,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + p.t * 0.8), 0, TAU);
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / W;
    ctx.setTransform(sx, 0, 0, sx, 0, 0);
    if (S.shakeT > 0) {
      ctx.translate(
        (Math.random() - 0.5) * 10 * S.shakeT,
        (Math.random() - 0.5) * 10 * S.shakeT,
      );
    }

    const T = displayedTarget();
    drawWall(T);
    drawGaze();
    drawFish();
    drawInk();
    drawGrouper();
    drawFloaters();
    drawMeter();
    drawSliders();
    drawCaptions();

    if (S.flashT > 0) {
      ctx.fillStyle = `rgba(255,90,70,${S.flashT * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------- hud ---------------- */

  function updateHud() {
    $("chipScore").textContent = `Score ${S.score}`;
    $("chipWave").textContent = `Wave ${S.wave}`;
    const mult = 1 + 0.25 * Math.min(S.streak, 8);
    $("chipStreak").textContent =
      S.streak > 0
        ? `Streak ${S.streak} · ×${mult.toFixed(2).replace(/\.?0+$/, "")}`
        : "Streak —";
    $("chipHearts").innerHTML =
      "&#9829;".repeat(Math.max(0, S.hearts)) +
      "&#9825;".repeat(Math.max(0, 3 - S.hearts));
    const inkChip = $("chipInk");
    inkChip.textContent = S.ink > 0 ? "Ink ready" : "Ink spent";
    inkChip.classList.toggle("spent", S.ink <= 0);
  }

  /* ---------------- veil / panels ---------------- */

  function showPanel(id) {
    $("veil").classList.remove("hidden");
    for (const p of ["panelTitle", "panelOver", "panelPaused"]) {
      $(p).classList.toggle("hidden", p !== id);
    }
  }

  function hideVeil() {
    $("veil").classList.add("hidden");
  }

  function setPaused(on) {
    if (on && S.mode === "playing") {
      S.mode = "paused";
      showPanel("panelPaused");
    } else if (!on && S.mode === "paused") {
      S.mode = "playing";
      hideVeil();
    }
  }

  /* ---------------- input ---------------- */

  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }

  function laneAt(x, y) {
    for (let i = 0; i < 4; i++) {
      const r = laneRect(i);
      if (
        x >= r.x - 12 &&
        x <= r.x + r.w + 12 &&
        y >= r.y - 34 &&
        y <= r.y + r.h + 12
      ) {
        return i;
      }
    }
    return -1;
  }

  function applyDrag(x, i) {
    const r = laneRect(i);
    const tw = r.w - SLIDER.padX * 2;
    const before = S.player[i];
    S.player[i] = clamp((x - (r.x + SLIDER.padX)) / tw, 0, 1);
    if (Math.abs(before - S.player[i]) > 0.012 && S.time - S.lastTick > 0.06) {
      S.lastTick = S.time;
      Sound.tick();
    }
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (S.mode !== "playing") return;
    ev.preventDefault();
    Sound.unlock();
    const p = canvasPoint(ev);
    const lane = laneAt(p.x, p.y);
    if (lane >= 0) {
      S.dragLane = lane;
      S.selected = lane;
      applyDrag(p.x, lane);
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (S.dragLane < 0 || S.mode !== "playing") return;
    ev.preventDefault();
    const p = canvasPoint(ev);
    applyDrag(p.x, S.dragLane);
  });

  const endDrag = (ev) => {
    if (S.dragLane >= 0) {
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (e) {
        /* already released */
      }
    }
    S.dragLane = -1;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", (ev) => {
    if (ev.repeat && [" ", "p", "m", "r"].includes(ev.key.toLowerCase()))
      return;
    const k = ev.key.toLowerCase();
    if (k === "p") {
      if (S.mode === "playing") setPaused(true);
      else if (S.mode === "paused") setPaused(false);
      ev.preventDefault();
      return;
    }
    if (k === "m") {
      toggleMute();
      return;
    }
    if (k === "r") {
      if (S.mode !== "title") startRun();
      ev.preventDefault();
      return;
    }
    if (S.mode !== "playing") {
      if ((k === " " || k === "enter") && S.mode === "title") {
        startRun();
        ev.preventDefault();
      }
      return;
    }
    switch (k) {
      case " ":
        spendInk();
        ev.preventDefault();
        break;
      case "arrowdown":
      case "s": {
        S.selected = (S.selected + 1) % 4;
        Sound.tick();
        ev.preventDefault();
        break;
      }
      case "arrowup":
      case "w": {
        S.selected = (S.selected + 3) % 4;
        Sound.tick();
        ev.preventDefault();
        break;
      }
      case "arrowleft":
      case "a": {
        nudge(S.selected, -0.03);
        ev.preventDefault();
        break;
      }
      case "arrowright":
      case "d": {
        nudge(S.selected, 0.03);
        ev.preventDefault();
        break;
      }
      case "1":
      case "2":
      case "3":
      case "4": {
        S.selected = Number(k) - 1;
        Sound.tick();
        break;
      }
      default:
        break;
    }
  });

  function nudge(i, d) {
    const before = S.player[i];
    S.player[i] = clamp(S.player[i] + d, 0, 1);
    if (before !== S.player[i]) Sound.tick();
  }

  /* ---------------- buttons ---------------- */

  let muted = false;
  function toggleMute() {
    muted = !muted;
    Sound.unlock();
    Sound.setMuted(muted);
    $("btnSound").innerHTML = muted ? "&#9834;&#215;" : "&#9834;";
    $("btnSound").style.opacity = muted ? "0.55" : "1";
  }

  $("btnPlay").addEventListener("click", () => {
    Sound.unlock();
    startRun();
  });
  $("btnAgain").addEventListener("click", () => {
    Sound.unlock();
    startRun();
  });
  $("btnResume").addEventListener("click", () => setPaused(false));
  $("btnPause").addEventListener("click", () => {
    if (S.mode === "playing") setPaused(true);
    else if (S.mode === "paused") setPaused(false);
  });
  $("btnSound").addEventListener("click", toggleMute);
  $("btnRestart").addEventListener("click", () => startRun());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && S.mode === "playing") setPaused(true);
  });

  /* ---------------- sizing ---------------- */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * dpr * (H / W));
  }
  window.addEventListener("resize", resize);

  /* ---------------- main loop ---------------- */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (S.mode === "playing") update(dt);
    else {
      S.time += dt;
      stepEffects(dt);
    }
    render();
    requestAnimationFrame(frame);
  }

  // seed an idle scene behind the title veil
  (() => {
    const rnd = mulberry32(20260823);
    S.Tto = randomTarget(rnd, null);
    S.Tfrom = S.Tto.slice();
    S.fadeT = 1;
    S.wallSeed = (rnd() * 1e9) | 0;
    S.wanderSeed = [rnd(), rnd(), rnd(), rnd()];
  })();
  resize();
  updateHud();
  showPanel("panelTitle");
  requestAnimationFrame(frame);
})();
