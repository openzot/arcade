/* Pier Pressure — five balls on the oldest table in the arcade.
   Vanilla canvas pinball: flippers, plunger, bumpers, drop targets,
   a siren's-shell kicker and a plumb-bob tilt trap for greedy hands. */
(() => {
  "use strict";

  /* ---------------- dom ---------------- */

  const $ = (id) => document.getElementById(id);

  const el = {
    score: $("score"),
    ballN: $("ball"),
    best: $("best"),
    mult: $("mult"),
    lampS: $("lamp-S"),
    lampE: $("lamp-E"),
    lampA: $("lamp-A"),
    lampShell: $("lamp-shell"),
    lampAgain: $("lamp-again"),
    lampTilt: $("lamp-tilt"),
    ticker: $("ticker"),
    canvas: $("table"),
    startOv: $("start-overlay"),
    pauseOv: $("pause-overlay"),
    overOv: $("over-overlay"),
    overLine: $("over-line"),
    finalScore: $("final-score"),
    btnStart: $("btn-start"),
    btnResume: $("btn-resume"),
    btnAgain: $("btn-again"),
    btnPause: $("btn-pause"),
    btnSound: $("btn-sound"),
    btnRestart: $("btn-restart"),
  };

  /* ---------------- helpers ---------------- */

  const W = 480;
  const H = 780;
  const BALL_R = 9;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- audio (synthesised, lazy) ---------------- */

  let AC = null;
  let master = null;
  let muted = false;

  function audioInit() {
    if (AC) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = 0.4;
      master.connect(AC.destination);
    } catch (e) {
      AC = null;
    }
  }
  function audioWake() {
    if (AC && AC.state === "suspended") AC.resume();
  }

  function tone(f0, f1, dur, type, vol, when) {
    if (!AC || muted) return;
    const t0 = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(f0, t0);
    if (f1)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function hiss(dur, vol, fc) {
    if (!AC || muted) return;
    const n = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = fc || 800;
    const g = AC.createGain();
    g.gain.value = vol || 0.2;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
  }

  const SFX = {
    flip() {
      hiss(0.04, 0.22, 500);
      tone(95, 60, 0.05, "square", 0.12);
    },
    bounce(v) {
      tone(160 + v * 40, 120, 0.035, "triangle", clamp(v * 0.1, 0.02, 0.09));
    },
    bumper() {
      tone(340, 170, 0.09, "square", 0.16);
      tone(1200, 900, 0.04, "sine", 0.08);
      hiss(0.03, 0.12, 1400);
    },
    sling() {
      tone(210, 150, 0.07, "triangle", 0.17);
      hiss(0.03, 0.1, 900);
    },
    target() {
      tone(680, 520, 0.05, "square", 0.14);
      hiss(0.025, 0.14, 2000);
    },
    roll() {
      tone(920, 880, 0.06, "sine", 0.09);
    },
    laneSet() {
      tone(523, 0, 0.09, "square", 0.13);
      tone(659, 0, 0.09, "square", 0.13, 0.09);
      tone(784, 0, 0.14, "square", 0.13, 0.18);
    },
    bank() {
      tone(392, 0, 0.1, "square", 0.14);
      tone(523, 0, 0.1, "square", 0.14, 0.1);
      tone(659, 0, 0.1, "square", 0.14, 0.2);
      tone(880, 0, 0.2, "square", 0.14, 0.3);
    },
    shell() {
      tone(660, 0, 0.12, "sine", 0.16);
      tone(880, 0, 0.12, "sine", 0.16, 0.1);
      tone(1318, 0, 0.25, "sine", 0.16, 0.2);
    },
    launch(p) {
      tone(120 + p * 80, 620 + p * 400, 0.28, "sawtooth", 0.14);
      hiss(0.12, 0.1, 1200);
    },
    drain() {
      tone(300, 55, 0.5, "sawtooth", 0.16);
      hiss(0.2, 0.12, 300);
    },
    tiltBuzz() {
      tiltBuzzNow();
    },
    thud() {
      tone(70, 45, 0.09, "square", 0.2);
      hiss(0.05, 0.16, 350);
    },
    over() {
      tone(392, 0, 0.16, "square", 0.13);
      tone(311, 0, 0.16, "square", 0.13, 0.17);
      tone(233, 0, 0.4, "square", 0.13, 0.34);
    },
    bonusTick() {
      tone(1040, 0, 0.05, "square", 0.1);
    },
  };
  function tiltBuzzNow() {
    tone(110, 90, 0.6, "square", 0.2);
  }

  /* ---------------- table geometry ---------------- */

  // Colliders: segments (with optional radius -> capsule) and circles.
  const COLLS = [];
  const seg = (x1, y1, x2, y2, o) =>
    COLLS.push(
      Object.assign({ type: "seg", x1, y1, x2, y2, r: 0, e: 0.42 }, o),
    );
  const circ = (x, y, r, o) =>
    COLLS.push(Object.assign({ type: "circ", x, y, r, e: 0.6 }, o));

  // outer box + arch
  seg(14, 240, 14, 596, { e: 0.4 }); // left wall
  seg(466, 240, 466, 752, { e: 0.4 }); // right wall (shooter lane outer)
  (() => {
    // top arch, centre (240,240) r 226, drawn as a polyline
    const N = 30;
    let px = 14;
    let py = 240;
    for (let i = 1; i <= N; i++) {
      const a = Math.PI - (Math.PI * i) / N;
      const x = 240 + 226 * Math.cos(a);
      const y = 240 - 226 * Math.sin(a);
      seg(px, py, x, y, { e: 0.4 });
      px = x;
      py = y;
    }
  })();

  // shooter lane
  seg(430, 300, 430, 600, { e: 0.35 }); // lane inner wall
  seg(430, 752, 466, 752, { e: 0.2 }); // lane floor
  // one-way gate across the lane mouth (blocks re-entry, lets launches out)
  (() => {
    const x1 = 430;
    const y1 = 296;
    const x2 = 466;
    const y2 = 288;
    let nx = y1 - y2;
    let ny = x2 - x1;
    const l = Math.hypot(nx, ny);
    nx /= l;
    ny /= l;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    } // normal points up into the playfield
    seg(x1, y1, x2, y2, { gate: true, gnx: nx, gny: ny, e: 0.2 });
  })();

  // target backing wall (diagonal, upper left)
  seg(14, 262, 132, 342, { e: 0.4 });

  // lower funnels down to the flippers (steep final drop: no shelves)
  seg(14, 596, 96, 668, { e: 0.35 });
  seg(96, 668, 146, 677, { e: 0.35 });
  seg(146, 677, 172, 706, { e: 0.35 });
  seg(430, 600, 348, 668, { e: 0.35 });
  seg(348, 668, 298, 676, { e: 0.35 });
  seg(298, 676, 272, 706, { e: 0.35 });

  // S-E-A lane guides hanging under the arch
  seg(172, 30, 172, 92, { r: 5, e: 0.5, kind: "guide" });
  seg(216, 22, 216, 92, { r: 5, e: 0.5, kind: "guide" });
  seg(268, 22, 268, 92, { r: 5, e: 0.5, kind: "guide" });
  seg(312, 32, 312, 92, { r: 5, e: 0.5, kind: "guide" });

  // slingshot triangles (hypotenuse kicks)
  seg(112, 592, 112, 650, { e: 0.4 }); // left triangle, plain edges
  seg(112, 650, 154, 658, { e: 0.4 });
  seg(154, 658, 112, 592, { kind: "sling", e: 0.4, cool: 0 });
  seg(332, 592, 332, 650, { e: 0.4 }); // right triangle
  seg(332, 650, 290, 658, { e: 0.4 });
  seg(290, 658, 332, 592, { kind: "sling", e: 0.4, cool: 0 });

  // pop bumpers
  const BUMPERS = [
    { x: 170, y: 336, r: 22, flash: 0, cool: 0 },
    { x: 246, y: 286, r: 22, flash: 0, cool: 0 },
    { x: 312, y: 352, r: 22, flash: 0, cool: 0 },
    { x: 64, y: 520, r: 16, flash: 0, cool: 0 },
    { x: 380, y: 520, r: 16, flash: 0, cool: 0 },
  ];
  BUMPERS.forEach((b) => circ(b.x, b.y, b.r, { e: 1, kind: "bumper", ref: b }));

  // SIREN drop targets along the diagonal
  const TARGETS = [];
  (() => {
    const dx = 0.83;
    const dy = 0.563; // along-wall unit vector
    for (let i = 0; i < 5; i++) {
      const bx = lerp(22, 122, i / 4);
      const by = lerp(266, 340, i / 4);
      TARGETS.push({
        cx: bx + 6.2,
        cy: by - 9.1,
        hx: dx,
        hy: dy, // capsule axis
        hl: 9,
        r: 10,
        up: true,
        letter: "SIREN"[i],
        flash: 0,
        idx: i,
      });
    }
  })();

  // SIREN shell kicker hole
  const SHELL = { x: 86, y: 420, r: 15 };

  // flippers
  const FLIP = {
    L: {
      px: 161,
      py: 684,
      len: 58,
      rf: 8.5,
      rest: (46 * Math.PI) / 180,
      lift: (-28 * Math.PI) / 180,
      ang: (46 * Math.PI) / 180,
      angV: 0,
      pressed: false,
    },
    R: {
      px: 283,
      py: 684,
      len: 58,
      rf: 8.5,
      rest: (46 * Math.PI) / 180,
      lift: (-28 * Math.PI) / 180,
      ang: (46 * Math.PI) / 180,
      angV: 0,
      pressed: false,
    },
  };

  const SEA_SENSORS = [
    { x: 194, y: 106, r: 11, letter: "S", inside: false },
    { x: 242, y: 106, r: 11, letter: "E", inside: false },
    { x: 290, y: 106, r: 11, letter: "A", inside: false },
  ];

  /* ---------------- state ---------------- */

  const GAME_BALLS = 5;
  const STEP = 1 / 240;
  const GRAV_Y = 1250;
  const MAX_SPEED = 1550;

  let state = "attract"; // attract | ready | play | over (+ paused flag)
  let paused = false;
  let score = 0;
  let best = 0;
  let bestAtBoot = 0;
  try {
    best = Number(localStorage.getItem("pier-pressure-best")) || 0;
    bestAtBoot = best;
  } catch (e) {
    best = 0;
  }
  let ballNo = 1;
  let mult = 1;
  let extraBall = false;
  let tilted = false;
  let heat = 0;
  let letters = { S: false, E: false, A: false };
  let shellLit = false;
  let targetsDownCount = 0;
  let bankTimer = 0;
  let saveT = 0;
  let saveUsed = false;
  let ballFresh = false;
  let skillLane = 1;
  let stillT = 0;
  let restT = 0;
  let shoves = 0;
  let onHeldFlipper = false;
  let msgAge = 0;
  let shakeAmp = 0;
  let plungerPower = 0;
  let charging = false;
  let captureT = 0;
  let captured = false;

  const ball = { x: 448, y: 743, vx: 0, vy: 0 };
  const floaters = [];
  const sparks = [];
  const CNT = { bumper: 0, sling: 0, target: 0, shell: 0, drain: 0, launch: 0 };

  /* ---------------- hud ---------------- */

  const hudCache = {};
  function setText(node, key, val) {
    if (hudCache[key] !== val) {
      hudCache[key] = val;
      node.textContent = val;
    }
  }
  function fmt(n) {
    return String(Math.round(n));
  }
  function updateHud() {
    setText(el.score, "sc", fmt(score));
    setText(el.ballN, "bl", String(ballNo));
    setText(el.mult, "mu", "\u00d7" + mult);
    setText(el.best, "be", fmt(best));
    el.lampS.classList.toggle("lit", letters.S && !tilted);
    el.lampE.classList.toggle("lit", letters.E && !tilted);
    el.lampA.classList.toggle("lit", letters.A && !tilted);
    el.lampShell.classList.toggle("lit", shellLit && !tilted);
    el.lampAgain.classList.toggle("lit", extraBall);
    el.lampTilt.classList.toggle("lit", tilted || heat > 55);
    el.btnPause.textContent = paused ? "Resume (P)" : "Pause (P)";
    el.btnSound.textContent = muted ? "Sound: off (M)" : "Sound: on (M)";
  }

  function say(txt) {
    el.ticker.textContent = txt;
    msgAge = 2.2;
  }

  /* ---------------- scoring ---------------- */

  function addScore(pts, x, y, label) {
    if (tilted) return;
    score += pts;
    if (x !== undefined) {
      floaters.push({ x, y, txt: label || String(pts), age: 0 });
    }
    if (!extraBall && score >= 30000) {
      extraBall = true;
      say("SHOOT AGAIN LIT \u2014 one more for the road");
      SFX.bonusTick();
    }
    if (score > best) best = score;
  }

  /* ---------------- game flow ---------------- */

  function parkBall() {
    ball.x = 448;
    ball.y = 743;
    ball.vx = 0;
    ball.vy = 0;
    plungerPower = 0;
    charging = false;
    state = "ready";
  }

  function newBallReset() {
    letters = { S: false, E: false, A: false };
    mult = 1;
    tilted = false;
    heat = 0;
    TARGETS.forEach((t) => (t.up = true));
    targetsDownCount = 0;
    bankTimer = 0;
    shellLit = false;
    saveT = 0;
    saveUsed = false;
    ballFresh = false;
    captured = false;
    stillT = 0;
    restT = 0;
    shoves = 0;
    onHeldFlipper = false;
  }

  function hideOverlays() {
    el.startOv.classList.remove("show");
    el.pauseOv.classList.remove("show");
    el.overOv.classList.remove("show");
  }

  function newGame() {
    audioInit();
    audioWake();
    bestAtBoot = best;
    score = 0;
    ballNo = 1;
    extraBall = false;
    paused = false;
    newBallReset();
    floaters.length = 0;
    sparks.length = 0;
    say("Pull the plunger \u2014 hold Space, let go.");
    parkBall();
    hideOverlays();
    updateHud();
  }

  const OVER_LINES = [
    "The shilling is spent. The sea keeps playing.",
    "Rain on the pier roof. Somebody feed the gulls.",
    "The attendant winds his clock. Time, folks.",
    "One more shilling and you had it. One more.",
  ];

  function gameOver() {
    state = "over";
    charging = false;
    try {
      localStorage.setItem("pier-pressure-best", String(best));
    } catch (e) {
      /* private mode: the memory of a good game suffices */
    }
    el.finalScore.textContent = fmt(score);
    el.overLine.textContent =
      score > bestAtBoot && score > 0
        ? "A house record, that. The lad at the change machine nods."
        : OVER_LINES[Math.floor(Math.random() * OVER_LINES.length)];
    el.overOv.classList.add("show");
    SFX.over();
    updateHud();
  }

  function onBallLost() {
    SFX.drain();
    CNT.drain++;
    if (saveT > 0 && !tilted && !saveUsed) {
      saveUsed = true;
      saveT = 0;
      say("BALL SAVED \u2014 the attendant looks away");
      parkBall();
      state = "ready";
      updateHud();
      return;
    }
    if (!tilted) {
      const b =
        ((letters.S ? 1 : 0) + (letters.E ? 1 : 0) + (letters.A ? 1 : 0)) *
          200 +
        targetsDownCount * 150 +
        (shellLit ? 300 : 0);
      const total = b * mult;
      if (total > 0) {
        addScore(total);
        say("BONUS " + fmt(total));
        SFX.bonusTick();
      }
    } else {
      say("No bonus. The plumb bob saw everything.");
    }
    if (extraBall) {
      extraBall = false;
      say("SHOOT AGAIN \u2014 on the house");
      newBallReset();
      parkBall();
      updateHud();
      return;
    }
    if (ballNo >= GAME_BALLS) {
      gameOver();
      return;
    }
    ballNo++;
    newBallReset();
    parkBall();
    say("Ball " + ballNo + " of " + GAME_BALLS + ". Mind the plumb bob.");
    updateHud();
  }

  function launch() {
    if (state !== "ready" || paused) return;
    const p = plungerPower;
    state = "play";
    ballFresh = true;
    saveT = 5;
    stillT = 0;
    skillLane = Math.floor(Math.random() * 3);
    ball.vx = -26;
    ball.vy = -(1020 + 520 * p);
    SFX.launch(p);
    CNT.launch++;
    say(p > 0.85 ? "Full pull! Off she goes." : "Away she goes.");
  }

  function doTilt() {
    if (tilted) return;
    tilted = true;
    heat = 100;
    FLIP.L.pressed = false;
    FLIP.R.pressed = false;
    say("TILT \u2014 the plumb bob swung. Scoring dead.");
    SFX.tiltBuzz();
    shakeAmp = 10;
  }

  function nudge(dx, dy) {
    if (paused) return;
    if (state !== "play" || tilted || captured) return;
    ball.vx += dx;
    ball.vy += dy;
    heat += dy < 0 ? 26 : 22;
    shakeAmp = Math.max(shakeAmp, 6);
    SFX.thud();
    if (heat >= 100) doTilt();
  }

  /* ---------------- physics ---------------- */

  function stepFlippers(dt) {
    ["L", "R"].forEach((k) => {
      const f = FLIP[k];
      const want =
        f.pressed && !(tilted || state === "attract" || state === "over")
          ? f.lift
          : f.rest;
      const speed = f.pressed ? 24 : 14;
      const prev = f.ang;
      if (f.ang > want) f.ang = Math.max(want, f.ang - speed * dt);
      else if (f.ang < want) f.ang = Math.min(want, f.ang + speed * dt);
      f.angV = (f.ang - prev) / dt;
    });
  }

  function flipperDir(k) {
    const f = FLIP[k];
    const a = k === "L" ? f.ang : Math.PI - f.ang;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  function collideFlipper(k) {
    if (captured) return;
    const f = FLIP[k];
    const d = flipperDir(k);
    // collide with the outer span only: the boss around the pivot sits
    // behind the funnel wall and must never pinch the ball against it
    const s0 = 14;
    const ax = f.px + d.x * s0;
    const ay = f.py + d.y * s0;
    const qx = f.px + d.x * f.len;
    const qy = f.py + d.y * f.len;
    // closest point on the (ax,ay)->tip segment
    const ex = qx - ax;
    const ey = qy - ay;
    const ll = ex * ex + ey * ey;
    const t = clamp(((ball.x - ax) * ex + (ball.y - ay) * ey) / ll, 0, 1);
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    let nx = ball.x - cx;
    let ny = ball.y - cy;
    let dist = Math.hypot(nx, ny);
    const rr = BALL_R + f.rf;
    if (dist >= rr) return;
    if (dist < 0.0001) {
      nx = 0;
      ny = -1;
      dist = 0.0001;
    }
    nx /= dist;
    ny /= dist;
    // push out
    ball.x += nx * (rr - dist);
    ball.y += ny * (rr - dist);
    // surface velocity of the flipper at the contact point
    const rx = cx - f.px;
    const ry = cy - f.py;
    const svx = -f.angV * ry;
    const svy = f.angV * rx;
    let rvx = ball.vx - svx;
    let rvy = ball.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = 0.32;
      rvx -= (1 + e) * vn * nx;
      rvy -= (1 + e) * vn * ny;
      ball.vx = rvx + svx;
      ball.vy = rvy + svy;
      if (Math.abs(f.angV) > 3) SFX.flip();
    }
    if (f.pressed && !tilted) onHeldFlipper = true;
  }

  function hitSparks(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      sparks.push({
        x,
        y,
        vx: rand(-140, 140),
        vy: rand(-190, -20),
        life: rand(0.18, 0.4),
        col: col || "#ffd27a",
      });
    }
  }

  function collideWorld() {
    for (let i = 0; i < COLLS.length; i++) {
      const c = COLLS[i];
      let nx = 0;
      let ny = 0;
      let pen = 0;
      if (c.type === "seg") {
        const ex = c.x2 - c.x1;
        const ey = c.y2 - c.y1;
        const ll = ex * ex + ey * ey;
        let t = ll > 0 ? ((ball.x - c.x1) * ex + (ball.y - c.y1) * ey) / ll : 0;
        t = clamp(t, 0, 1);
        const cx = c.x1 + ex * t;
        const cy = c.y1 + ey * t;
        nx = ball.x - cx;
        ny = ball.y - cy;
        const dist = Math.hypot(nx, ny);
        const rr = BALL_R + c.r;
        if (dist >= rr) continue;
        if (dist < 0.0001) {
          nx = 0;
          ny = -1;
        } else {
          nx /= dist;
          ny /= dist;
        }
        pen = rr - dist;
        if (c.gate) {
          // one-way: solid only against traffic heading back down the lane
          if (ball.vx * c.gnx + ball.vy * c.gny >= 0) continue;
        }
      } else {
        nx = ball.x - c.x;
        ny = ball.y - c.y;
        const dist = Math.hypot(nx, ny);
        const rr = BALL_R + c.r;
        if (dist >= rr) continue;
        if (dist < 0.0001) {
          nx = 0;
          ny = -1;
        } else {
          nx /= dist;
          ny /= dist;
        }
        pen = rr - dist;
      }

      // positional correction
      ball.x += nx * pen;
      ball.y += ny * pen;

      const vn = ball.vx * nx + ball.vy * ny;
      if (vn > 0) continue; // separating already

      if (c.kind === "bumper") {
        const b = c.ref;
        if (b.cool <= 0) {
          b.cool = 0.06;
          b.flash = 0.22;
          CNT.bumper++;
          ball.vx = nx * 540;
          ball.vy = ny * 540;
          addScore(150 * mult, b.x, b.y - b.r - 6);
          hitSparks(ball.x, ball.y, 6, "#ff8fb4");
          SFX.bumper();
          shakeAmp = Math.max(shakeAmp, 3);
        }
        continue;
      }
      if (c.kind === "sling") {
        if (c.cool <= 0 && vn < -60) {
          c.cool = 0.08;
          CNT.sling++;
          ball.vx = nx * 470 - ny * ball.vx * 0.25;
          ball.vy = ny * 470 + nx * ball.vy * 0.25;
          addScore(120 * mult, ball.x, ball.y - 14);
          hitSparks(ball.x, ball.y, 4, "#7fe0d2");
          SFX.sling();
        } else {
          ball.vx -= 1.4 * vn * nx;
          ball.vy -= 1.4 * vn * ny;
        }
        continue;
      }
      // plain bounce
      const e = c.e;
      ball.vx -= (1 + e) * vn * nx;
      ball.vy -= (1 + e) * vn * ny;
      if (vn < -260 && !c.gate) {
        SFX.bounce(clamp(-vn / 900, 0, 1));
      }
    }
    for (let i = 0; i < COLLS.length; i++) {
      const c = COLLS[i];
      if (c.kind === "sling" && c.cool > 0) c.cool -= STEP;
    }
  }

  function collideTargets(dt) {
    for (let i = 0; i < TARGETS.length; i++) {
      const tg = TARGETS[i];
      if (!tg.up) continue;
      // capsule: centre +- axis*hl, radius r
      const ax = tg.cx - tg.hx * tg.hl;
      const ay = tg.cy - tg.hy * tg.hl;
      const ex = tg.hx * tg.hl * 2;
      const ey = tg.hy * tg.hl * 2;
      const ll = ex * ex + ey * ey;
      let t = ((ball.x - ax) * ex + (ball.y - ay) * ey) / ll;
      t = clamp(t, 0, 1);
      const cx = ax + ex * t;
      const cy = ay + ey * t;
      let nx = ball.x - cx;
      let ny = ball.y - cy;
      const dist = Math.hypot(nx, ny);
      const rr = BALL_R + tg.r;
      if (dist >= rr) continue;
      if (dist < 0.0001) {
        nx = 0;
        ny = -1;
      } else {
        nx /= dist;
        ny /= dist;
      }
      ball.x += nx * (rr - dist);
      ball.y += ny * (rr - dist);
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        if (-vn > 90) {
          tg.up = false;
          tg.flash = 0.3;
          targetsDownCount++;
          CNT.target++;
          addScore(500 * mult, tg.cx + 20, tg.cy);
          hitSparks(cx, cy, 5, "#ffe9ad");
          SFX.target();
          if (targetsDownCount >= 5) bankComplete();
        } else {
          ball.vx -= 1.3 * vn * nx;
          ball.vy -= 1.3 * vn * ny;
        }
      }
    }
    for (let i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].flash > 0) TARGETS[i].flash -= dt;
    }
  }

  function bankComplete() {
    addScore(2500 * mult, 150, 380, "BANK +" + fmt(2500 * mult));
    shellLit = true;
    bankTimer = 1.5;
    say("SIREN BANK DOWN \u2014 the shell is lit!");
    SFX.bank();
  }

  function stepTimers(dt) {
    for (let i = 0; i < BUMPERS.length; i++) {
      const b = BUMPERS[i];
      if (b.cool > 0) b.cool -= dt;
      if (b.flash > 0) b.flash -= dt;
    }
    if (bankTimer > 0) {
      bankTimer -= dt;
      if (bankTimer <= 0) {
        TARGETS.forEach((t) => (t.up = true));
        targetsDownCount = 0;
        SFX.target();
      }
    }
    if (msgAge > 0) {
      msgAge -= dt;
      if (msgAge <= 0) {
        msgAge = 0;
        el.ticker.textContent =
          state === "play"
            ? saveT > 0
              ? "Ball saved \u2014 settle in."
              : "\u00b7"
            : "\u00b7";
      }
    }
    if (shakeAmp > 0) shakeAmp = Math.max(0, shakeAmp - 26 * dt);
    if (heat > 0 && !tilted) heat = Math.max(0, heat - 14 * dt);
  }

  function checkSeaSensors() {
    for (let i = 0; i < SEA_SENSORS.length; i++) {
      const s = SEA_SENSORS[i];
      const d = Math.hypot(ball.x - s.x, ball.y - s.y);
      const insideNow = d < s.r + BALL_R * 0.4;
      if (insideNow && !s.inside) {
        s.inside = true;
        if (!letters[s.letter]) {
          letters[s.letter] = true;
          addScore(300 * mult, s.x, s.y - 18);
          SFX.roll();
          if (letters.S && letters.E && letters.A) {
            letters = { S: false, E: false, A: false };
            mult = Math.min(5, mult + 1);
            addScore(1000 * mult, 242, 140, "SWELL \u00d7" + mult);
            say("SEA SWELL \u2014 bonus \u00d7" + mult);
            SFX.laneSet();
          }
        } else {
          SFX.roll();
        }
        if (ballFresh) {
          ballFresh = false;
          if (i === skillLane) {
            addScore(1000 * mult, s.x, s.y + 30, "SKILL +");
            say("Skill shilling! Right first throw.");
            SFX.laneSet();
          }
        }
      } else if (!insideNow) {
        s.inside = false;
      }
    }
  }

  function checkShell() {
    if (captured) return;
    const d = Math.hypot(ball.x - SHELL.x, ball.y - SHELL.y);
    const sp = Math.hypot(ball.vx, ball.vy);
    if (d < SHELL.r - 3 && sp < 620) {
      captured = true;
      CNT.shell++;
      captureT = 1.05;
      if (shellLit) {
        const pts = 2500 * mult;
        shellLit = false;
        addScore(pts, SHELL.x + 10, SHELL.y - 26, "+" + fmt(pts));
        say("THE SIREN SINGS \u2014 " + fmt(pts));
        SFX.shell();
        hitSparks(SHELL.x, SHELL.y, 12, "#57d7c8");
      } else {
        addScore(500, SHELL.x + 10, SHELL.y - 26);
        say("The shell is cold. Light the SIREN bank.");
        SFX.roll();
      }
    }
  }

  function physStep(dt) {
    stepFlippers(dt);
    stepTimers(dt);

    // floaters & sparks age in every state
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.age += dt;
      f.y -= 22 * dt;
      if (f.age > 1) floaters.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 500 * dt;
      if (s.life <= 0) sparks.splice(i, 1);
    }

    if (state === "ready") {
      if (charging) plungerPower = Math.min(1, plungerPower + dt / 0.9);
      return;
    }
    if (state !== "play") return;

    if (saveT > 0) saveT -= dt;
    if (ballFresh && saveT <= 0) ballFresh = false;
    onHeldFlipper = false;

    if (captured) {
      captureT -= dt;
      if (captureT <= 0) {
        captured = false;
        ball.x = SHELL.x + 12;
        ball.y = SHELL.y + 8;
        ball.vx = 250;
        ball.vy = 130;
      }
      return;
    }

    // integrate
    ball.vy += GRAV_Y * dt;
    ball.vx *= Math.exp(-0.05 * dt);
    ball.vy *= Math.exp(-0.02 * dt);
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) {
      ball.vx *= MAX_SPEED / sp;
      ball.vy *= MAX_SPEED / sp;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    collideWorld();
    collideTargets(dt);
    collideFlipper("L");
    collideFlipper("R");
    checkSeaSensors();
    checkShell();

    // anti-stuck: a lonely still ball gets a shove from the tide.
    // (Cradling on a deliberately held, live flipper is respected; a tilted
    // or wedged table never is. Three shoves and the attendant simply
    // fishes the ball out, so a table can never hang forever.)
    const slow = Math.hypot(ball.vx, ball.vy) < 14;
    if (slow && !onHeldFlipper) {
      restT += dt;
      if (shoves >= 3) {
        if (restT > 3) {
          say("The attendant fishes it out. Unlucky.");
          saveT = 0;
          ball.x = 240;
          ball.y = H + 40;
          onBallLost();
          return;
        }
      } else if (restT > 2.4) {
        restT = 1.2;
        shoves++;
        const uphill = ball.x > 222 ? rand(160, 260) : rand(-260, -160);
        ball.vx += uphill;
        ball.vy -= rand(150, 230);
        heat += 8;
        say("The attendant leans on the glass.");
        SFX.thud();
      }
    } else if (!slow) {
      restT = 0;
    }

    // a feeble launch dribbles back onto the plunger: have another go
    if (ball.x > 434 && ball.y > 660 && Math.hypot(ball.vx, ball.vy) < 70) {
      parkBall();
      say("Back on the plunger. Again, then.");
      return;
    }

    // drained?
    if (ball.y > H + 24) {
      onBallLost();
    }
  }

  /* ---------------- rendering ---------------- */

  const ctx = el.canvas.getContext("2d");
  let dpr = 1;
  function fitCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = W * dpr;
    el.canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayfieldBase(shx, shy) {
    ctx.save();
    ctx.translate(shx, shy);

    // felt
    const bg = ctx.createRadialGradient(240, 330, 60, 240, 430, 560);
    bg.addColorStop(0, "#1c4437");
    bg.addColorStop(1, "#0e2a22");
    ctx.fillStyle = bg;
    ctx.fillRect(-12, -12, W + 24, H + 24);

    // painted wave scrollwork
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = "#7fe0d2";
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(240, 600, 130 + i * 36, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 4.6; a += 0.2) {
      const rr = 3 + a * 2.6;
      const x = 168 + Math.cos(a) * rr;
      const y = 500 + Math.sin(a) * rr * 0.85;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // lantern pools
    const lp1 = ctx.createRadialGradient(120, 210, 10, 120, 210, 200);
    lp1.addColorStop(0, "rgba(255, 214, 150, 0.10)");
    lp1.addColorStop(1, "rgba(255, 214, 150, 0)");
    ctx.fillStyle = lp1;
    ctx.fillRect(0, 40, 320, 360);
    const lp2 = ctx.createRadialGradient(370, 450, 10, 370, 450, 210);
    lp2.addColorStop(0, "rgba(255, 143, 180, 0.07)");
    lp2.addColorStop(1, "rgba(255, 143, 180, 0)");
    ctx.fillStyle = lp2;
    ctx.fillRect(160, 280, 300, 340);

    // wooden rails along every wall segment
    ctx.lineCap = "round";
    for (let i = 0; i < COLLS.length; i++) {
      const c = COLLS[i];
      if (c.kind === "bumper" || c.kind === "sling") continue;
      const wide = c.r > 0 ? c.r * 2 : 8;
      ctx.strokeStyle = "#5f3714";
      ctx.lineWidth = wide + 6;
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
      ctx.strokeStyle = "#8a5424";
      ctx.lineWidth = wide;
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 214, 150, 0.28)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1 - 1);
      ctx.lineTo(c.x2, c.y2 - 1);
      ctx.stroke();
      if (c.gate) {
        ctx.strokeStyle = "rgba(127, 224, 210, 0.85)";
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(c.x1, c.y1);
        ctx.lineTo(c.x2, c.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  const TG_HW = 11;

  function drawTargets() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i];
      const ang = Math.atan2(t.hy, t.hx);
      ctx.save();
      ctx.translate(t.cx, t.cy);
      ctx.rotate(ang);
      if (t.up) {
        ctx.fillStyle = t.flash > 0 ? "#fff3cf" : "#e8574a";
        roundRect(-TG_HW, -t.r * 0.72, TG_HW * 2, t.r * 1.44, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,233,173,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        roundRect(-TG_HW, -t.r * 0.72, TG_HW * 2, t.r * 1.44, 4);
        ctx.fill();
      }
      ctx.restore();
      const lx = t.cx - t.hx * (TG_HW + 13);
      const ly = t.cy - t.hy * (TG_HW + 13);
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillStyle = t.up
        ? "rgba(255,233,173,0.85)"
        : "rgba(255,233,173,0.25)";
      ctx.fillText(t.letter, lx, ly);
    }
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.fillStyle = "rgba(244,230,200,0.45)";
    ctx.fillText("S I R E N   B A N K", 118, 372);
  }

  function drawFeatures() {
    // S-E-A lanes
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const laneLetters = ["S", "E", "A"];
    const laneXs = [194, 242, 290];
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    for (let i = 0; i < 3; i++) {
      const lit = letters[laneLetters[i]];
      ctx.fillStyle = lit ? "#ffe9ad" : "rgba(244,230,200,0.4)";
      if (lit) {
        ctx.shadowColor = "#ffd27a";
        ctx.shadowBlur = 12;
      }
      ctx.fillText(laneLetters[i], laneXs[i], 84);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = lit ? "rgba(255,233,173,0.9)" : "rgba(244,230,200,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(laneXs[i], 106, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // bumpers
    for (let i = 0; i < BUMPERS.length; i++) {
      const b = BUMPERS[i];
      const hot = b.flash > 0;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fill();
      const grad = ctx.createRadialGradient(b.x - 6, b.y - 8, 3, b.x, b.y, b.r);
      grad.addColorStop(0, hot ? "#fff3cf" : "#ff8fb4");
      grad.addColorStop(1, hot ? "#ff8fb4" : "#b23a63");
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#d8a94e";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = hot ? "#fff" : "#ffe9ad";
      ctx.fill();
      ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
      ctx.fillStyle = "rgba(244,230,200,0.5)";
      ctx.fillText("150", b.x, b.y + b.r + 13);
    }

    // slingshots
    drawTri([
      [112, 592],
      [112, 650],
      [154, 658],
    ]);
    drawTri([
      [332, 592],
      [332, 650],
      [290, 658],
    ]);

    drawShell();
    drawTargets();
  }

  function drawTri(v) {
    ctx.beginPath();
    ctx.moveTo(v[0][0], v[0][1]);
    ctx.lineTo(v[1][0], v[1][1]);
    ctx.lineTo(v[2][0], v[2][1]);
    ctx.closePath();
    ctx.fillStyle = "#e8574a";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,233,173,0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawShell() {
    const pul = shellLit ? 0.5 + 0.5 * Math.sin(performance.now() / 180) : 0;
    ctx.beginPath();
    ctx.arc(SHELL.x, SHELL.y, SHELL.r + 6 + pul * 4, 0, Math.PI * 2);
    ctx.fillStyle = shellLit
      ? "rgba(87, 215, 200, " + (0.25 + pul * 0.3).toFixed(2) + ")"
      : "rgba(0,0,0,0.4)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(SHELL.x, SHELL.y, SHELL.r, 0, Math.PI * 2);
    ctx.fillStyle = "#08201a";
    ctx.fill();
    ctx.strokeStyle = shellLit ? "#7fe0d2" : "#5f3714";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.save();
    ctx.translate(SHELL.x, SHELL.y);
    ctx.strokeStyle = shellLit ? "#bff5ec" : "rgba(127,224,210,0.4)";
    ctx.lineWidth = 1.6;
    for (let a = -2; a <= 2; a++) {
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.quadraticCurveTo(a * 4, -6, a * 6, -11);
      ctx.stroke();
    }
    ctx.restore();
    if (shellLit) {
      ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = "#bff5ec";
      ctx.fillText("2500", SHELL.x, SHELL.y - 24);
    }
  }

  function drawFlippers() {
    ["L", "R"].forEach((k) => {
      const f = FLIP[k];
      const d = flipperDir(k);
      const qx = f.px + d.x * f.len;
      const qy = f.py + d.y * f.len;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#241305";
      ctx.lineWidth = f.rf * 2 + 4;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(qx, qy);
      ctx.stroke();
      const g = ctx.createLinearGradient(f.px, f.py, qx, qy);
      g.addColorStop(0, "#ffe9ad");
      g.addColorStop(1, "#d8a94e");
      ctx.strokeStyle = g;
      ctx.lineWidth = f.rf * 2;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(qx, qy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.px, f.py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#241305";
      ctx.fill();
    });
  }

  function drawPlunger() {
    const bx = 448;
    const topY = 752 - 26 + plungerPower * 18;
    ctx.strokeStyle = "#9aa7b8";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(bx, topY + 8);
    ctx.lineTo(bx, 772);
    ctx.stroke();
    ctx.strokeStyle = "#d8a94e";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    const coils = 5;
    for (let i = 0; i <= coils * 2; i++) {
      const yy = topY + 10 + (i / (coils * 2)) * (764 - topY - 10);
      const xx = bx + (i % 2 === 0 ? -7 : 7);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, topY + 4, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#e8574a";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,233,173,0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (state === "ready") {
      ctx.fillStyle = "rgba(244,230,200,0.75)";
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(charging ? "\u00b7 \u00b7 \u00b7" : "hold SPACE", bx, 700);
      if (charging) {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        roundRect(bx - 26, 708, 52, 7, 3);
        ctx.fill();
        ctx.fillStyle = plungerPower > 0.85 ? "#7fe0d2" : "#ffe9ad";
        roundRect(bx - 25, 709, 50 * plungerPower, 5, 2.5);
        ctx.fill();
      }
    }
  }

  function drawBall() {
    if (captured) return;
    if (state === "attract" || state === "over") return;
    ctx.beginPath();
    ctx.ellipse(
      ball.x + 3,
      ball.y + 5,
      BALL_R * 0.9,
      BALL_R * 0.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();
    const g = ctx.createRadialGradient(
      ball.x - 3.4,
      ball.y - 3.6,
      1.5,
      ball.x,
      ball.y,
      BALL_R,
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.55, "#c3ccd8");
    g.addColorStop(1, "#5d6a7a");
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawFx() {
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      ctx.globalAlpha = clamp(s.life * 3.4, 0, 1);
      ctx.fillStyle = s.col;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.textAlign = "center";
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      ctx.globalAlpha = clamp(1.4 - f.age * 1.4, 0, 1);
      ctx.fillStyle = "#ffe9ad";
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    if (heat > 55 && !tilted && (state === "play" || state === "ready")) {
      ctx.fillStyle =
        "rgba(255,83,64," +
        (0.04 + 0.04 * Math.sin(performance.now() / 90)).toFixed(3) +
        ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (saveT > 0 && state === "play" && !tilted) {
      ctx.fillStyle = "rgba(87,215,200,0.05)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render() {
    const shx = shakeAmp > 0 ? rand(-shakeAmp, shakeAmp) : 0;
    const shy = shakeAmp > 0 ? rand(-shakeAmp, shakeAmp) : 0;
    ctx.clearRect(-14, -14, W + 28, H + 28);
    drawPlayfieldBase(shx, shy);
    drawFeatures();
    drawFlippers();
    drawPlunger();
    drawBall();
    drawFx();
  }

  /* ---------------- input ---------------- */

  function togglePause(force) {
    if (state === "attract" || state === "over") return;
    paused = force !== undefined ? force : !paused;
    el.pauseOv.classList.toggle("show", paused);
    if (!paused) audioWake();
    updateHud();
  }

  function toggleMute() {
    muted = !muted;
    updateHud();
  }

  function beginCharge() {
    if (paused) return;
    if (state === "ready") {
      charging = true;
    } else if (state === "play") {
      nudge(0, -150);
    }
  }
  function endCharge() {
    if (state === "ready" && charging) {
      charging = false;
      launch();
    }
  }

  function press(key, down) {
    if (key === "FlipL") {
      if (!FLIP.L.pressed && down && !paused) SFX.flip();
      FLIP.L.pressed = down;
    } else if (key === "FlipR") {
      if (!FLIP.R.pressed && down && !paused) SFX.flip();
      FLIP.R.pressed = down;
    }
  }

  const KEYMAP = {
    KeyZ: "FlipL",
    KeyA: "FlipL",
    ArrowLeft: "FlipL",
    Slash: "FlipR",
    ArrowRight: "FlipR",
    KeyL: "FlipR",
  };

  document.addEventListener("keydown", (e) => {
    if (
      [
        "Space",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Slash",
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    audioInit();

    if (state === "attract" || state === "over") {
      if (e.code === "Space" || e.code === "Enter") newGame();
      return;
    }
    if (e.code === "KeyP") {
      togglePause();
      return;
    }
    if (e.code === "KeyM") {
      toggleMute();
      return;
    }
    if (e.code === "KeyR") {
      newGame();
      return;
    }
    if (paused) return;
    const mapped = KEYMAP[e.code];
    if (mapped) {
      press(mapped, true);
      return;
    }
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown") {
      beginCharge();
      return;
    }
    if (e.code === "Comma") {
      nudge(-170, 0);
      return;
    }
    if (e.code === "Period") {
      nudge(170, 0);
    }
  });

  document.addEventListener("keyup", (e) => {
    const mapped = KEYMAP[e.code];
    if (mapped) {
      press(mapped, false);
      return;
    }
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown") {
      endCharge();
    }
  });

  // touch pads

  function bindHold(node, downFn, upFn) {
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      audioInit();
      audioWake();
      try {
        node.setPointerCapture(e.pointerId);
      } catch (err) {
        /* older browsers shrug */
      }
      downFn();
    });
    const up = (e) => {
      e.preventDefault();
      upFn();
    };
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }
  bindHold(
    $("pad-flip-l"),
    () => press("FlipL", true),
    () => press("FlipL", false),
  );
  bindHold(
    $("pad-flip-r"),
    () => press("FlipR", true),
    () => press("FlipR", false),
  );
  bindHold($("pad-launch"), beginCharge, endCharge);
  bindHold(
    $("pad-nudge-l"),
    () => nudge(-170, 0),
    () => {},
  );
  bindHold(
    $("pad-nudge-r"),
    () => nudge(170, 0),
    () => {},
  );
  bindHold(
    $("pad-nudge-u"),
    () => nudge(0, -150),
    () => {},
  );

  // tapping the table sides flips (handy on touch screens)
  const sidePointers = {};
  el.canvas.addEventListener("pointerdown", (e) => {
    if (state === "attract" || state === "over" || paused) return;
    const rect = el.canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    if (fx < 0.42) {
      sidePointers[e.pointerId] = "FlipL";
      press("FlipL", true);
    } else if (fx > 0.58) {
      sidePointers[e.pointerId] = "FlipR";
      press("FlipR", true);
    }
  });
  const sideRelease = (e) => {
    const k = sidePointers[e.pointerId];
    if (k) {
      press(k, false);
      delete sidePointers[e.pointerId];
    }
  };
  el.canvas.addEventListener("pointerup", sideRelease);
  el.canvas.addEventListener("pointercancel", sideRelease);

  // buttons
  el.btnStart.addEventListener("click", () => newGame());
  el.btnAgain.addEventListener("click", () => newGame());
  el.btnResume.addEventListener("click", () => togglePause(false));
  el.btnPause.addEventListener("click", () => togglePause());
  el.btnSound.addEventListener("click", () => toggleMute());
  el.btnRestart.addEventListener("click", () => newGame());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (state === "play" || state === "ready")) {
      togglePause(true);
    }
  });

  /* ---------------- boot & loop ---------------- */

  updateHud();

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.06) dt = 0.06;
    if (!paused && (state === "ready" || state === "play")) {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard < 20) {
        physStep(STEP);
        acc -= STEP;
        guard++;
      }
      if (guard >= 20) acc = 0;
      updateHud();
    } else {
      // keep lamps/ticker fresh even while parked
      stepTimersPausedOnly();
    }
    render();
  }

  function stepTimersPausedOnly() {
    if (msgAge > 0) {
      msgAge -= 1 / 60;
      if (msgAge <= 0) el.ticker.textContent = "\u00b7";
    }
    if (shakeAmp > 0) shakeAmp = Math.max(0, shakeAmp - 0.4);
  }

  requestAnimationFrame(frame);

  // tiny hook for the factory's playtest rig
  window.__PP = {
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    get score() {
      return score;
    },
    get ballNo() {
      return ballNo;
    },
    get multVal() {
      return mult;
    },
    get ballPos() {
      return { x: ball.x, y: ball.y };
    },
    get tiltedFlag() {
      return tilted;
    },
    get targetsUp() {
      return TARGETS.filter((t) => t.up).length;
    },
    get stats() {
      return Object.assign({}, CNT);
    },
    targetUp(i) {
      return !!TARGETS[i].up;
    },

    flipL(down) {
      press("FlipL", !!down);
    },
    flipR(down) {
      press("FlipR", !!down);
    },
    beginCharge,
    endCharge,
    nudge,
    newGame,
    warp(x, y, vx, vy) {
      if (state !== "play" || paused) return;
      captured = false;
      ball.x = x;
      ball.y = y;
      ball.vx = vx;
      ball.vy = vy;
    },
  };
})();
