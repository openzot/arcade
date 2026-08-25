/* Cascade — a closing-night juggling act for the arcade.
 *
 * Bostock & Verralli's Travelling Circus plays its last performance. Two
 * hands stand in the ring and catch whatever falls into them; the player
 * only decides when each hand throws, and how high. The stagehand feeds
 * balls until seven are in the air; every ball that kisses the sawdust
 * snuffs one of three lamps.
 *
 * Everything lives in this one classic script, wrapped in an IIFE.
 */

(function () {
  "use strict";

  /* ── dom ─────────────────────────────────────────────── */

  const cvs = document.getElementById("game");
  const ctx = cvs.getContext("2d");
  const overlay = document.getElementById("overlay");
  const introPanel = document.getElementById("introPanel");
  const endPanel = document.getElementById("endPanel");
  const endTitle = document.getElementById("endTitle");
  const endStats = document.getElementById("endStats");
  const endVerdict = document.getElementById("endVerdict");
  const beginBtn = document.getElementById("beginBtn");
  const againBtn = document.getElementById("againBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const restartBtn = document.getElementById("restartBtn");
  const soundBtn = document.getElementById("soundBtn");
  const toastEl = document.getElementById("toast");
  const scoreRead = document.getElementById("scoreRead");
  const actRead = document.getElementById("actRead");

  /* ── constants ───────────────────────────────────────── */

  const W = 720;
  const H = 720;
  const FLOOR = 636;
  const HAND_Y = 566;
  const HAND_R = 26;
  const BALL_R = 11;
  const G = 1500;
  const CHARGE_MS = 620;
  const CATCH_SLACK = 38;
  const IGNORE_S = 0.08;
  const COOLDOWN_S = 0.05;

  const FEED_EVERY = 1.15;
  const ACT_LEN = 118;
  const FINALE_AT = 98;
  const LAMPS = 3;

  const PHASES = [
    { at: 0, n: 3, cry: "The warm-up: three balls." },
    { at: 18, n: 4, cry: "Fourth ball! The house leans in." },
    { at: 40, n: 5, cry: "Five! Nobody breathes." },
    { at: 64, n: 6, cry: "Six balls. The band stops playing." },
    { at: 90, n: 7, cry: "SEVEN. Hold the ring, Odile." },
  ];

  const BALL_HUES = [
    ["#f4e3c1", "#c9a06a"],
    ["#e2574b", "#8f2a22"],
    ["#5fb8a5", "#2e6d60"],
    ["#ffd27a", "#c98f2e"],
    ["#b48ec9", "#6a4680"],
    ["#88a862", "#4c6434"],
    ["#6f9fd8", "#31578a"],
  ];

  /* ── state ───────────────────────────────────────────── */

  let state = "intro"; // intro | playing | paused | over
  let t = 0; // act clock (runs only while performing)
  let clock = 0; // ring clock (never stops)
  let phaseIdx = 0;
  let target = PHASES[0].n;
  let finale = false;
  let lamps = LAMPS;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let catches = 0;
  let drops = 0;
  let throwsMade = 0;
  let peakBalls = 0;
  let feedTimer = 0.5;
  let feedSide = 1;
  let hueIdx = 0;
  let crowdBoost = 0;

  let hands = [];
  let balls = [];
  let floats = []; // rising score texts
  let parts = []; // sparks & confetti
  const charging = { L: -1, R: -1 }; // performance.now() per side, or -1
  const ptrSide = new Map();

  const speckles = [];
  for (let i = 0; i < 90; i++) {
    speckles.push({
      x: Math.random() * W,
      y: FLOOR - 34 + Math.random() * 30,
      r: 0.6 + Math.random() * 1.6,
      a: 0.05 + Math.random() * 0.12,
    });
  }

  /* ── audio (Web Audio, all synthesised) ─────────────── */

  let AC = null;
  let master = null;
  let crowdGain = null;
  let audioReady = false;
  let muted = false;

  function initAudio() {
    if (audioReady) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      AC = new AudioCtx();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(AC.destination);
      // a whisper of audience: filtered noise on a loop
      const len = AC.sampleRate * 2;
      const buf = AC.createBuffer(1, len, AC.sampleRate);
      const d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) {
        v = v * 0.98 + (Math.random() * 2 - 1) * 0.02;
        d[i] = v * 6;
      }
      const src = AC.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = AC.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 480;
      crowdGain = AC.createGain();
      crowdGain.gain.value = 0;
      src.connect(lp).connect(crowdGain).connect(master);
      src.start();
      audioReady = true;
    } catch (err) {
      audioReady = false;
    }
  }

  function tone(freq, dur, type, vol, slideTo, when) {
    if (!audioReady) return;
    const at = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.03);
  }

  function noiseBurst(freq, dur, vol, type) {
    if (!audioReady) return;
    const n = AC.createBufferSource();
    const b = AC.createBuffer(
      1,
      Math.max(64, AC.sampleRate * dur),
      AC.sampleRate,
    );
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    n.buffer = b;
    const f = AC.createBiquadFilter();
    f.type = type || "highpass";
    f.frequency.value = freq;
    const g = AC.createGain();
    g.gain.value = vol;
    n.connect(f).connect(g).connect(master);
    n.start();
  }

  function sfxCatch() {
    tone(700 + Math.random() * 60, 0.07, "triangle", 0.12, 980);
  }

  function sfxThrow() {
    noiseBurst(900, 0.09, 0.09);
  }

  function sfxDrop() {
    tone(130, 0.28, "sine", 0.3, 52);
    noiseBurst(220, 0.16, 0.18, "lowpass");
    crowdBoost = 0.08;
  }

  function sfxHorn() {
    tone(392, 0.16, "sawtooth", 0.08);
    tone(523, 0.22, "sawtooth", 0.08, 0, 0.14);
  }

  function sfxFanfare() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, 0.24, "triangle", 0.12, 0, i * 0.13),
    );
    crowdBoost = 0.1;
  }

  function sfxBoo() {
    [330, 277, 220].forEach((f, i) =>
      tone(f, 0.32, "sawtooth", 0.09, f * 0.94, i * 0.28),
    );
    crowdBoost = 0.06;
  }

  /* ── helpers ─────────────────────────────────────────── */

  function mkHand(x) {
    return {
      x,
      y: HAND_Y,
      state: "empty", // empty | held | cooldown
      ball: null,
      heldSince: 0,
      cooldownUntil: 0,
      bob: Math.random() * Math.PI * 2,
    };
  }

  function spawnBall() {
    feedSide *= -1;
    const fromLeft = feedSide < 0;
    const x0 = fromLeft ? -24 : W + 24;
    // Toss toward whichever hand is free (the stagehand can see that much);
    // solve the arc so it arrives at that hand's catching height.
    let tx;
    const lFree = hands[0].state === "empty";
    const rFree = hands[1].state === "empty";
    if (lFree && !rFree) tx = hands[0].x;
    else if (rFree && !lFree) tx = hands[1].x;
    else tx = fromLeft ? W / 2 - 150 : W / 2 + 150;
    const ty = HAND_Y - HAND_R * 0.4;
    const y0 = 300;
    const T = 0.95 + Math.random() * 0.3;
    const vx = (tx - x0) / T;
    const vy = (ty - y0 - 0.5 * G * T * T) / T;

    balls.push({
      x: x0,
      y: y0,
      vx,
      vy,
      held: false,
      ignoreHand: -1,
      ignoreUntil: 0,
      hue: BALL_HUES[hueIdx % BALL_HUES.length],
      trail: [],
    });
    hueIdx++;
  }

  function burst(x, y, colors, count, spread) {
    for (let i = 0; i < count; i++) {
      parts.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (spread || 320),
        vy: -Math.random() * (spread ? spread * 0.7 : 260) - 60,
        life: 0.7 + Math.random() * 0.7,
        age: 0,
        c: colors[(Math.random() * colors.length) | 0],
        r: 2 + Math.random() * 3.5,
      });
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2100);
  }

  /* ── act control ─────────────────────────────────────── */

  function reset() {
    t = 0;
    clock = 0;
    phaseIdx = 0;
    target = PHASES[0].n;
    finale = false;
    lamps = LAMPS;
    score = 0;
    streak = 0;
    bestStreak = 0;
    catches = 0;
    drops = 0;
    throwsMade = 0;
    peakBalls = 0;
    feedTimer = 0.5;
    feedSide = 1;
    crowdBoost = 0;
    hands = [mkHand(W / 2 - 150), mkHand(W / 2 + 150)];
    balls = [];
    floats = [];
    parts = [];
    charging.L = -1;
    charging.R = -1;
    ptrSide.clear();
  }

  function begin() {
    initAudio();
    if (AC && AC.state === "suspended") AC.resume();
    reset();
    state = "playing";
    overlay.classList.add("hidden");
    introPanel.classList.add("hidden");
    endPanel.classList.add("hidden");
    pauseBtn.textContent = "Pause";
    toast("Ladies and gentlemen… Cascade!");
  }

  function endAct(win) {
    state = "over";
    charging.L = -1;
    charging.R = -1;
    ptrSide.clear();
    pauseBtn.textContent = "Pause";
    endTitle.textContent = win
      ? "The House Comes Down"
      : "Booed Off the Sawdust";
    endStats.textContent =
      score +
      " points · " +
      catches +
      " catches · best streak " +
      bestStreak +
      " · up to " +
      peakBalls +
      " balls airborne";
    let verdict;
    if (win && score >= 2200) {
      verdict = "A legend of the ring. They will name ponies after you.";
    } else if (win) {
      verdict = "The troupe carries you out on their shoulders.";
    } else if (score >= 800) {
      verdict = "A cruel ending to a beautiful act.";
    } else {
      verdict = "The manager clears his throat and turns to the ponies.";
    }
    endVerdict.textContent = verdict;
    introPanel.classList.add("hidden");
    endPanel.classList.remove("hidden");
    overlay.classList.remove("hidden");
    if (win) {
      sfxFanfare();
      burst(W / 2, 120, ["#ffcf6e", "#e2574b", "#5fb8a5", "#f4e3c1"], 90, 520);
    } else {
      sfxBoo();
    }
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      pauseBtn.textContent = "Resume";
      charging.L = -1;
      charging.R = -1;
      ptrSide.clear();
    } else if (state === "paused") {
      state = "playing";
      pauseBtn.textContent = "Pause";
    }
  }

  function toggleSound() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 1;
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", String(!muted));
  }

  /* ── throwing & catching ─────────────────────────────── */

  function handIdx(side) {
    return side === "L" ? 0 : 1;
  }

  function tryCharge(side) {
    if (state !== "playing") return;
    const h = hands[handIdx(side)];
    if (h && h.state === "held") charging[side] = performance.now();
  }

  function releaseThrow(side) {
    if (!(charging[side] >= 0)) return;
    const heldFor = performance.now() - charging[side];
    charging[side] = -1;
    if (state === "playing") {
      doThrow(handIdx(side), Math.max(0.05, Math.min(1, heldFor / CHARGE_MS)));
    }
  }

  function spaceThrow() {
    if (state !== "playing") return;
    let pick = -1;
    for (let i = 0; i < 2; i++) {
      if (
        hands[i].state === "held" &&
        (pick < 0 || hands[i].heldSince < hands[pick].heldSince)
      ) {
        pick = i;
      }
    }
    if (pick >= 0) {
      const charge = Math.max(
        0.05,
        Math.min(1, ((clock - hands[pick].heldSince) * 1000) / CHARGE_MS),
      );
      doThrow(pick, charge);
    }
  }

  function doThrow(i, q) {
    const h = hands[i];
    if (!h || h.state !== "held") return;
    const b = h.ball;
    const vy = -(760 + 620 * q);
    const T = (2 * Math.abs(vy)) / G;
    const other = hands[1 - i];
    b.vx = (other.x - h.x) / T + (Math.random() - 0.5) * 56;
    b.vy = vy;
    b.held = false;
    b.ignoreHand = i;
    b.ignoreUntil = clock + IGNORE_S;
    h.ball = null;
    h.state = "cooldown";
    h.cooldownUntil = clock + COOLDOWN_S;
    throwsMade++;
    sfxThrow();
  }

  function catchBall(i, b) {
    const h = hands[i];
    h.state = "held";
    h.ball = b;
    h.heldSince = clock;
    b.held = true;
    b.trail.length = 0;
    if (state !== "playing") return; // attract mode behind the panels
    catches++;
    streak++;
    if (streak > bestStreak) bestStreak = streak;
    const mult =
      Math.min(4, 1 + Math.floor(streak / 8) * 0.5) * (finale ? 2 : 1);
    const pts = Math.round(10 * mult);
    score += pts;
    floats.push({ x: b.x, y: b.y, txt: "+" + pts, age: 0 });
    burst(b.x, b.y, [b.hue[0], "#ffcf6e"], 5, 160);
    sfxCatch();
  }

  function dropBall(idx) {
    const b = balls[idx];
    if (!b) return;
    balls.splice(idx, 1);
    burst(b.x, FLOOR - 6, [b.hue[0], b.hue[1], "#caa06a"], 14, 340);
    if (state !== "playing") {
      feedTimer = Math.min(feedTimer, 0.35); // demo quietly replaces it
      return;
    }
    drops++;
    streak = 0;
    lamps--;
    crowdBoost = Math.max(crowdBoost, 0.07);
    feedTimer = Math.max(feedTimer, 0.9); // stagehand pauses so you can regroup
    sfxDrop();
    if (lamps === 2) toast("One lamp out. Two remain.");
    else if (lamps === 1) toast("One lamp left. Steady…");
    if (lamps <= 0) endAct(false);
  }

  /* ── update ──────────────────────────────────────────── */

  const demo = () => state === "intro" || state === "over";

  function update(dt) {
    clock += dt;
    const isDemo = demo();

    if (state === "playing") {
      t += dt;
      while (phaseIdx < PHASES.length - 1 && t >= PHASES[phaseIdx + 1].at) {
        phaseIdx++;
        target = PHASES[phaseIdx].n;
        peakBalls = Math.max(peakBalls, target);
        toast(PHASES[phaseIdx].cry);
        sfxHorn();
      }
      if (!finale && t >= FINALE_AT) {
        finale = true;
        toast("GRAND FINALE — double points!");
        sfxHorn();
      }
      if (t >= ACT_LEN) {
        endAct(true);
        return;
      }
    } else {
      target = 3; // attract mode keeps a calm three-ball cascade going
    }

    // stagehand feeds balls up to the act's count
    feedTimer -= dt;
    if (balls.length < target && feedTimer <= 0) {
      spawnBall();
      feedTimer = FEED_EVERY;
    }

    // hands
    for (const h of hands) {
      h.bob += dt * 3;
      if (h.state === "cooldown" && clock >= h.cooldownUntil) h.state = "empty";
    }

    // attract-mode autopilot: throw whenever a hand has held long enough
    if (isDemo) {
      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (h.state === "held" && clock - h.heldSince > 0.62) {
          doThrow(i, 0.62 + Math.random() * 0.2);
        }
      }
    }

    // balls
    for (let bi = balls.length - 1; bi >= 0; bi--) {
      const b = balls[bi];
      if (b.held) continue;
      b.vy += G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 7) b.trail.shift();

      if (b.x < BALL_R && b.vx < 0) {
        b.x = BALL_R;
        b.vx *= -0.55;
      } else if (b.x > W - BALL_R && b.vx > 0) {
        b.x = W - BALL_R;
        b.vx *= -0.55;
      }

      // auto-catch into an empty hand
      if (b.vy > 0 && !(b.ignoreHand >= 0 && clock < b.ignoreUntil)) {
        for (let i = 0; i < 2; i++) {
          const h = hands[i];
          if (h.state !== "empty") continue;
          const dx = b.x - h.x;
          const dy = b.y - (HAND_Y - HAND_R * 0.4);
          if (dx * dx + dy * dy < CATCH_SLACK * CATCH_SLACK) {
            catchBall(i, b);
            break;
          }
        }
      }

      if (!b.held && b.y > FLOOR - BALL_R * 0.4) dropBall(bi);
    }

    // particles & floats
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].age += dt;
      floats[i].y -= dt * 42;
      if (floats[i].age > 0.9) floats.splice(i, 1);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      p.vy += G * 0.55 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age > p.life) parts.splice(i, 1);
    }

    // audience swell
    crowdBoost = Math.max(0, crowdBoost - dt * 0.14);
    if (audioReady && crowdGain) {
      const want =
        state === "playing"
          ? Math.min(0.05, 0.012 + streak * 0.003) +
            (finale ? 0.018 : 0) +
            crowdBoost
          : crowdBoost * 0.5;
      const cur = crowdGain.gain.value;
      crowdGain.gain.value = cur + (want - cur) * Math.min(1, dt * 3);
    }
  }

  /* ── render ──────────────────────────────────────────── */

  let viewScale = 1;

  function fitCanvas() {
    const rect = cvs.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.max(1, Math.round(rect.width * dpr));
    cvs.height = Math.max(1, Math.round(rect.height * dpr));
    viewScale = cvs.width / W;
  }

  function drawBall(x, y, hue, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    const g = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, BALL_R + 2);
    g.addColorStop(0, hue[0]);
    g.addColorStop(1, hue[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);

    // night inside the tent
    const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
    sky.addColorStop(0, "#241228");
    sky.addColorStop(0.65, "#170e1e");
    sky.addColorStop(1, "#22121a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // spotlight beams that drift toward the action
    let focusX = W / 2;
    if (balls.length)
      focusX = balls.reduce((s, b) => s + b.x, 0) / balls.length;
    else if (hands.length === 2) focusX = (hands[0].x + hands[1].x) / 2;
    const sway = Math.sin(clock * 0.35) * 60;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const anchorX of [-40, W + 40]) {
      const aimX = anchorX < W / 2 ? focusX + sway : focusX - sway;
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = "#ffe9b0";
      ctx.beginPath();
      ctx.moveTo(anchorX, -10);
      ctx.lineTo(Math.max(-140, aimX - 130), FLOOR + 20);
      ctx.lineTo(Math.min(W + 140, aimX + 130), FLOOR + 20);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // sawdust ring floor
    ctx.fillStyle = "#3a2417";
    ctx.beginPath();
    ctx.ellipse(W / 2, FLOOR + 44, W * 0.64, 74, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#59391f";
    ctx.beginPath();
    ctx.ellipse(W / 2, FLOOR + 38, W * 0.58, 62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#caa06a";
    for (const s of speckles) {
      ctx.globalAlpha = s.a;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#7a2a24"; // ring wall
    ctx.fillRect(0, FLOOR + 58, W, H - FLOOR - 58);
    ctx.fillStyle = "#5d1220";
    ctx.fillRect(0, FLOOR + 58, W, 10);
    ctx.fillStyle = "#ffcf6e";
    ctx.fillRect(0, FLOOR + 68, W, 3);

    // side curtains
    for (const side of [0, 1]) {
      const x0 = side ? W - 46 : 0;
      const grad = ctx.createLinearGradient(x0, 0, x0 + 46, 0);
      grad.addColorStop(side ? 0 : 1, "#43101c");
      grad.addColorStop(side ? 1 : 0, "#6e1626");
      ctx.fillStyle = grad;
      ctx.fillRect(x0, 0, 46, H);
      ctx.strokeStyle = "rgba(255,207,110,0.18)";
      ctx.lineWidth = 2;
      for (const fx of [10, 23, 36]) {
        ctx.beginPath();
        ctx.moveTo(x0 + fx, 0);
        ctx.quadraticCurveTo(x0 + fx + (side ? 6 : -6), H / 2, x0 + fx, H);
        ctx.stroke();
      }
    }

    // top valance with scallops
    ctx.fillStyle = "#6e1626";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 26);
    for (let x = 0; x <= W; x += 72) {
      ctx.quadraticCurveTo(x + 36, 54, x + 72, 26);
    }
    ctx.lineTo(W, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,207,110,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 26);
    for (let x = 0; x <= W; x += 72) {
      ctx.quadraticCurveTo(x + 36, 54, x + 72, 26);
    }
    ctx.stroke();

    // the three lamps
    for (let i = 0; i < LAMPS; i++) {
      const lx = W - 132 + i * 42;
      const ly = 52;
      ctx.fillStyle = "#2b1a10";
      ctx.fillRect(lx - 3, ly - 20, 6, 10);
      if (i < lamps) {
        const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 20);
        glow.addColorStop(0, "rgba(255,214,120,0.85)");
        glow.addColorStop(1, "rgba(255,214,120,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(lx - 22, ly - 22, 44, 44);
        ctx.fillStyle = "#ffd27a";
      } else {
        ctx.fillStyle = "#4a3a33";
      }
      ctx.beginPath();
      ctx.arc(lx, ly, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // ball trails & balls
    for (const b of balls) {
      for (let i = 0; i < b.trail.length; i++) {
        drawBall(
          b.trail[i].x,
          b.trail[i].y,
          b.hue,
          ((i + 1) / b.trail.length) * 0.16,
        );
      }
    }
    for (const b of balls) {
      if (!b.held) drawBall(b.x, b.y, b.hue);
    }

    // hands (ivory gloves with gold cuffs)
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      if (!h) continue;
      const hy = HAND_Y + Math.sin(h.bob) * 2;
      const hx = h.x;
      if (h.state === "cooldown") ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#f3e7cf";
      ctx.beginPath();
      ctx.arc(hx, hy, HAND_R * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(60,30,20,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "#c98f2e";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(hx, hy + 6, HAND_R * 0.92, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (h.ball) drawBall(hx, hy - HAND_R * 0.75, h.ball.hue);

      // charge meter while this hand is wound up
      const side = i === 0 ? "L" : "R";
      if (charging[side] >= 0 && h.state === "held") {
        const q = Math.min(1, (performance.now() - charging[side]) / CHARGE_MS);
        ctx.strokeStyle = q >= 1 ? "#fff3d0" : "#ffcf6e";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(
          hx,
          hy,
          HAND_R + 12,
          -Math.PI * 0.5,
          -Math.PI * 0.5 + q * Math.PI * 2,
        );
        ctx.stroke();
      }
    }

    // particles & floating points
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    ctx.globalAlpha = 1;
    ctx.font = "600 17px Georgia, serif";
    ctx.textAlign = "center";
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, 1 - f.age / 0.9);
      ctx.fillStyle = "#ffe9b0";
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // finale banner
    if (finale && state === "playing") {
      ctx.globalAlpha = 0.75 + Math.sin(t * 6) * 0.25;
      ctx.fillStyle = "#ffd27a";
      ctx.font = "700 24px Georgia, serif";
      ctx.fillText("GRAND FINALE · ×2", W / 2, 96);
      ctx.globalAlpha = 1;
    }

    // paused veil
    if (state === "paused") {
      ctx.fillStyle = "rgba(10,5,10,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffcf6e";
      ctx.font = "700 40px Georgia, serif";
      ctx.fillText("PAUSED", W / 2, H / 2 - 10);
      ctx.fillStyle = "#c9b49a";
      ctx.font = "italic 19px Georgia, serif";
      ctx.fillText(
        "P or Resume lowers the house lights again",
        W / 2,
        H / 2 + 28,
      );
    }
  }

  /* ── readouts ────────────────────────────────────────── */

  let lastScoreTxt = "";
  let lastActTxt = "";
  function fmtClock(s) {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ":" + String(r).padStart(2, "0");
  }
  function syncReadouts() {
    const st = "Score " + score;
    if (st !== lastScoreTxt) {
      lastScoreTxt = st;
      scoreRead.textContent = st;
    }
    let at;
    if (state === "intro") at = "Warm-up";
    else if (finale)
      at = "Grand finale ×2 · " + fmtClock(Math.max(0, ACT_LEN - t));
    else if (state === "over") at = "Curtain";
    else
      at =
        "Act " + (phaseIdx + 1) + "/5 · " + target + " balls · " + fmtClock(t);
    if (at !== lastActTxt) {
      lastActTxt = at;
      actRead.textContent = at;
    }
  }

  /* ── input ───────────────────────────────────────────── */

  function canvasX(e) {
    const rect = cvs.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * W;
  }

  cvs.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (state !== "playing") return;
    try {
      cvs.setPointerCapture(e.pointerId);
    } catch (err) {
      /* older browsers */
    }
    const side = canvasX(e) < W / 2 ? "L" : "R";
    ptrSide.set(e.pointerId, side);
    tryCharge(side);
  });

  function pointerUp(e) {
    const side = ptrSide.get(e.pointerId);
    if (side) {
      ptrSide.delete(e.pointerId);
      releaseThrow(side);
    }
  }
  cvs.addEventListener("pointerup", pointerUp);
  cvs.addEventListener("pointercancel", pointerUp);
  cvs.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === " " || k === "Spacebar") {
      e.preventDefault(); // keep Space from clicking focused buttons or scrolling
      if (!e.repeat) spaceThrow();
      return;
    }
    if (k === "ArrowLeft" || k === "ArrowRight") e.preventDefault();
    if (e.repeat) return;
    if (k === "f" || k === "F" || k === "ArrowLeft") tryCharge("L");
    else if (k === "j" || k === "J" || k === "ArrowRight") tryCharge("R");
    else if (k === "p" || k === "P") togglePause();
    else if (k === "m" || k === "M") toggleSound();
    else if (k === "r" || k === "R") begin();
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "f" || k === "F" || k === "ArrowLeft") releaseThrow("L");
    else if (k === "j" || k === "J" || k === "ArrowRight") releaseThrow("R");
  });

  // Buttons hand focus back after a mouse press so Space keeps throwing
  // balls instead of re-clicking the last button.
  const onPress = (fn) => (e) => {
    fn();
    e.currentTarget.blur();
  };

  beginBtn.addEventListener("click", onPress(begin));
  againBtn.addEventListener("click", onPress(begin));
  restartBtn.addEventListener("click", onPress(begin));
  pauseBtn.addEventListener("click", onPress(togglePause));
  soundBtn.addEventListener("click", onPress(toggleSound));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  window.addEventListener("resize", fitCanvas);
  window.addEventListener("load", fitCanvas);

  // A tiny test hook, only mounted when the page is opened with #debug:
  // lets an automated harness peek at the act without touching gameplay.
  if (/debug/.test(window.location.hash)) {
    window.__cascade = {
      state: () => state,
      score: () => score,
      lamps: () => lamps,
      balls: () => balls.length,
      catches: () => catches,
      throws: () => throwsMade,
      held: () => hands.map((h) => h.state),
      forceDrop: () => dropBall(0),
      winNow: () => endAct(true),
    };
  }

  /* ── boot ────────────────────────────────────────────── */

  reset();
  fitCanvas();
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === "playing" || state === "intro" || state === "over")
      update(dt);
    else if (state === "paused" && audioReady && crowdGain) {
      // let the house fall quiet while the act is held
      const cur = crowdGain.gain.value;
      crowdGain.gain.value = cur + (0 - cur) * Math.min(1, dt * 4);
    }
    render();
    syncReadouts();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
