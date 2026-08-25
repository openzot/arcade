(() => {
  "use strict";

  // ------------------------------------------------------------------
  // Pin Money — the pit boy's game.
  // A bowling alley in 1959 has no pinsetter machine. You are the
  // machine: drag the deadwood home, carry split pins to the spare
  // bin, and rack all ten before the bowler's patience runs dry.
  // ------------------------------------------------------------------

  const W = 900;
  const H = 560;

  // ---- rack geometry (viewed from behind, pin 1 farthest away) ----
  const HOLE_R = 16;
  const ROW_Y = [200, 233, 266, 299];
  const HOLES = [];
  {
    const counts = [1, 2, 3, 4];
    for (let r = 0; r < 4; r++) {
      const n = counts[r];
      for (let i = 0; i < n; i++) {
        HOLES.push({
          x: 450 + (i - (n - 1) / 2) * 38,
          y: ROW_Y[r],
          filled: false,
          flash: 0,
        });
      }
    }
  }

  const PIT = { l: 132, r: 768, t: 186, b: 540 };
  const BIN = { l: 764, t: 448, r: 884, b: 544 };
  const BALL_R = 17;
  const PIN_R = 11;
  const FRAMES_TOTAL = 12;

  const FRAME_SUBS = [
    "Open frame. The league crowd settles in.",
    "The Gibsons take lane six. Loud lot.",
    "Somebody orders chips. The fryer howls.",
    "Rain outside, beer inside, balls overhead.",
    "Word is the boss watches frame five.",
    "A birthday party arrives. Twelve kids, zero manners.",
    "The mechanical-man salesman pokes his head in. You scowl.",
    "League night proper. Don't disgrace lane six.",
    "Your shoulders know the work now.",
    "The regulars are betting on your rack time.",
    "One more than ten. Legs, don't fail.",
    "Last frame. The envelope is on the desk.",
  ];

  // ---- DOM -------------------------------------------------------
  const cv = document.getElementById("stage");
  const ctx = cv.getContext("2d");
  const hudFrame = document.getElementById("hud-frame");
  const hudRack = document.getElementById("hud-rack");
  const hudWage = document.getElementById("hud-wage");
  const patFill = document.getElementById("pat-fill");
  const btnPause = document.getElementById("btn-pause");
  const btnSound = document.getElementById("btn-sound");
  const ovMenu = document.getElementById("ov-menu");
  const ovPause = document.getElementById("ov-pause");
  const ovSacked = document.getElementById("ov-sacked");
  const ovPaid = document.getElementById("ov-paid");
  const sackedNote = document.getElementById("sacked-note");
  const sackedWage = document.getElementById("sacked-wage");
  const paidNote = document.getElementById("paid-note");
  const paidWage = document.getElementById("paid-wage");

  // ---- audio -----------------------------------------------------
  let AC = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  function audioInit() {
    if (AC) {
      if (AC.state === "suspended") AC.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    AC = new Ctor();
    master = AC.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function setMuted(m) {
    muted = m;
    btnSound.classList.toggle("is-off", m);
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  function tone(type, freq, dur, vol, when, slideTo) {
    if (!AC || muted) return;
    const t0 = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function thud(freqCut, vol, dur, when) {
    if (!AC || muted) return;
    const t0 = AC.currentTime + (when || 0);
    const src = AC.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freqCut;
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function sfxKnock(power) {
    const p = Math.min(1, power);
    thud(900 + p * 2200, 0.22 + p * 0.35, 0.09 + p * 0.05);
    tone("triangle", 150 + Math.random() * 60 + p * 90, 0.1, 0.16 + p * 0.18);
  }

  function sfxCrack() {
    thud(2600, 0.38, 0.06);
    thud(3200, 0.3, 0.05, 0.05);
    tone("square", 720, 0.04, 0.09, 0.02);
  }

  function sfxSeat() {
    tone("square", 560, 0.05, 0.12);
    thud(1400, 0.14, 0.05);
  }

  function sfxBuzz() {
    tone("sawtooth", 96, 0.16, 0.16, 0, 70);
  }

  function sfxCoin() {
    tone("sine", 880, 0.07, 0.14);
    tone("sine", 1318, 0.09, 0.12, 0.07);
  }

  function sfxTip() {
    tone("sine", 659, 0.08, 0.13);
    tone("sine", 880, 0.08, 0.13, 0.08);
    tone("sine", 1174, 0.12, 0.13, 0.16);
  }

  function sfxThrow() {
    thud(500, 0.22, 0.3);
  }

  function sfxRack() {
    tone("triangle", 523, 0.14, 0.16);
    tone("triangle", 659, 0.14, 0.16, 0.09);
    tone("triangle", 784, 0.22, 0.18, 0.18);
    thud(1200, 0.18, 0.12, 0.18);
  }

  function sfxSack() {
    tone("sawtooth", 220, 0.4, 0.16, 0, 110);
    tone("sawtooth", 165, 0.5, 0.14, 0.25, 82);
  }

  function sfxEnvelope() {
    for (let i = 0; i < 5; i++) {
      tone("triangle", [523, 587, 659, 784, 1046][i], 0.16, 0.15, i * 0.09);
    }
  }

  let rumbleSrc = null;
  function rumbleStart() {
    if (!AC || muted || rumbleSrc) return;
    rumbleSrc = AC.createBufferSource();
    rumbleSrc.buffer = noiseBuf;
    rumbleSrc.loop = true;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 140;
    const g = AC.createGain();
    g.gain.value = 0.28;
    rumbleSrc.connect(f);
    f.connect(g);
    g.connect(master);
    rumbleSrc.start();
  }
  function rumbleStop() {
    if (!rumbleSrc) return;
    try {
      rumbleSrc.stop();
    } catch (err) {
      /* already stopped */
    }
    rumbleSrc = null;
  }

  // ---- state -----------------------------------------------------
  const S = {
    phase: "menu", // menu | roll | set | pay | over | done
    frame: 1,
    wage: 0,
    tips: 0,
    swaps: 0,
    patience: 15,
    patienceMax: 15,
    awaitingThrow: false,
    ballTimer: 0,
    secondPending: false,
    secondTimer: -1,
    payTimer: 0,
    bannerText: "",
    bannerSub: "",
    bannerDur: 1,
    bannerT: 0,
    toasts: [],
  };

  let pins = [];
  let ball = null;
  let held = null;
  const pointer = { x: 450, y: 460, has: false };
  let lastInput = "pointer";
  const kbHand = { x: 450, y: 480 };
  const keys = {};

  function handPos() {
    if (lastInput === "pointer" && pointer.has) {
      return { x: pointer.x, y: pointer.y };
    }
    return kbHand;
  }

  function makePins() {
    for (const h of HOLES) {
      h.filled = false;
      h.flash = 0;
    }
    pins = HOLES.map((h) => ({
      hole: h,
      x: h.x,
      y: h.y,
      vx: 0,
      vy: 0,
      ang: 0,
      vang: 0,
      rest: 0,
      cracked: false,
      state: "seated",
    }));
  }

  function seatedCount() {
    let n = 0;
    for (const p of pins) if (p.state === "seated") n++;
    return n;
  }

  function fmtWage(d) {
    const s = Math.floor(d / 12);
    const p = d % 12;
    return s > 0 ? `${s}s ${p}d` : `${p}d`;
  }

  function toast(text, x, y, color) {
    S.toasts.push({ text, x, y, color: color || "#f5ead2", t: 0 });
  }

  function banner(main, sub, dur) {
    S.bannerText = main;
    S.bannerSub = sub || "";
    S.bannerDur = dur || 1.5;
    S.bannerT = S.bannerDur;
  }

  // ---- frame flow ------------------------------------------------
  function beginFrame(f) {
    S.frame = f;
    S.phase = "roll";
    makePins();
    held = null;
    ball = null;
    rumbleStop();
    S.patienceMax = Math.max(8.5, 15.5 - (f - 1) * 0.58);
    S.patience = S.patienceMax;
    S.awaitingThrow = true;
    S.ballTimer = f === 1 ? 1.6 : 1.0 + Math.random() * 0.5;
    S.secondPending = f >= 4 && Math.random() < Math.min(0.5, 0.1 + f * 0.035);
    S.secondTimer = -1;
    banner(`Frame ${f}`, FRAME_SUBS[f - 1], f === 1 ? 2.2 : 1.5);
    syncHud();
  }

  function throwBall(aimAtSeated) {
    const speed = 330 + S.frame * 6 + Math.random() * 30;
    const x0 = 430 + Math.random() * 40;
    const y0 = -BALL_R - 6;
    let tx = 405 + Math.random() * 90;
    if (aimAtSeated) {
      const st = pins.filter((p) => p.state === "seated");
      if (st.length) {
        tx =
          st.reduce((a, p) => a + p.hole.x, 0) / st.length +
          (Math.random() * 60 - 30);
      }
    }
    const tt = (ROW_Y[0] - y0) / speed;
    ball = {
      x: x0,
      y: y0,
      vx: (tx - x0) / tt,
      vy: speed,
      rot: 0,
      sinking: false,
      sink: 0,
    };
    sfxThrow();
    rumbleStart();
  }

  function endShift(won) {
    rumbleStop();
    held = null;
    if (won) {
      S.phase = "done";
      paidNote.textContent =
        `Twelve frames racked across a whole shift. ` +
        `${S.tips} tip${S.tips === 1 ? "" : "s"} earned, ` +
        `${S.swaps} piece${S.swaps === 1 ? "" : "s"} of split wood swapped.`;
      paidWage.textContent = `Envelope: ${fmtWage(S.wage)} — spend it well.`;
      show(ovPaid);
      sfxEnvelope();
    } else {
      S.phase = "over";
      sackedNote.textContent =
        `The wood lay too long on frame ${S.frame} and the bowler told ` +
        `the manager. There are other alleys.`;
      sackedWage.textContent = `Take your partial wage: ${fmtWage(S.wage)}.`;
      show(ovSacked);
      sfxSack();
    }
    syncHud();
  }

  function frameRacked() {
    S.phase = "pay";
    S.payTimer = 1.25;
    S.secondTimer = -1;
    S.secondPending = false;
    S.awaitingThrow = false;
    const frac = S.patience / S.patienceMax;
    banner("Racked!", frac > 0.5 ? "Quick hands. Tip earned." : "", 1.1);
    if (frac > 0.5) {
      S.wage += 6;
      S.tips++;
      toast("+6d tip", 450, 250, "#62c9b4");
      sfxTip();
    } else {
      sfxRack();
    }
    syncHud();
  }

  // ---- physics ---------------------------------------------------
  function knockPin(p, ix, iy, power, fromBall) {
    if (p.state === "seated" && p.hole) p.hole.filled = false;
    p.state = "loose";
    p.x += ix * 2;
    p.y += iy * 2;
    p.vx = ix * power + (Math.random() * 60 - 30);
    p.vy = iy * power + (Math.random() * 60 - 30);
    p.vang = ((Math.random() * 10 - 5) * power) / 260;
    p.rest =
      ((Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 25) * Math.PI) /
      180;
    sfxKnock(power / 420);
    if (fromBall && !p.cracked && power > 390 && Math.random() < 0.22) {
      p.cracked = true;
      toast("split!", p.x, p.y - 20, "#ff6d8a");
      sfxCrack();
    }
  }

  function stepBall(dt) {
    if (!ball) return;
    if (ball.sinking) {
      ball.sink += dt * 2.4;
      if (ball.sink >= 1) {
        ball = null;
        rumbleStop();
      }
      return;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.rot += (Math.abs(ball.vy) * dt) / BALL_R;
    if (ball.x < PIT.l + BALL_R) {
      ball.x = PIT.l + BALL_R;
      ball.vx = Math.abs(ball.vx) * 0.5;
    }
    if (ball.x > PIT.r - BALL_R) {
      ball.x = PIT.r - BALL_R;
      ball.vx = -Math.abs(ball.vx) * 0.5;
    }
    if (ball.y > 330) {
      ball.vy -= 900 * dt;
      ball.vx *= 0.98;
      if (ball.vy <= 40) {
        ball.vy = 0;
        ball.vx = 0;
        ball.sinking = true;
        thud(220, 0.3, 0.25);
      }
    }
    for (const p of pins) {
      if (p.state !== "seated" && p.state !== "loose") continue;
      const dx = p.x - ball.x;
      const dy = p.y - ball.y;
      const rr = BALL_R + PIN_R + 2;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const power = Math.min(520, Math.hypot(ball.vx, ball.vy) * 0.95 + 120);
        knockPin(p, nx, ny, power, true);
        ball.vx = ball.vx * 0.86 + nx * 26;
        ball.vy = ball.vy * 0.86 + ny * 10;
      }
    }
  }

  function stepPins(dt) {
    for (const p of pins) {
      if (p.state !== "loose") continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 3.4);
      p.vy *= Math.exp(-dt * 3.4);
      p.ang += p.vang * dt;
      p.vang *= Math.exp(-dt * 2.6);
      if (p.vx * p.vx + p.vy * p.vy < 64) {
        p.vx = 0;
        p.vy = 0;
        const k = Math.min(1, dt * 6);
        p.ang += (p.rest - p.ang) * k;
      }
      if (p.x < PIT.l + PIN_R) {
        p.x = PIT.l + PIN_R;
        p.vx = Math.abs(p.vx) * 0.5;
      }
      if (p.x > PIT.r - PIN_R) {
        p.x = PIT.r - PIN_R;
        p.vx = -Math.abs(p.vx) * 0.5;
      }
      if (p.y < PIT.t) {
        p.y = PIT.t;
        p.vy = Math.abs(p.vy) * 0.5;
      }
      if (p.y > PIT.b) {
        p.y = PIT.b;
        p.vy = -Math.abs(p.vy) * 0.5;
      }
    }
    for (let i = 0; i < pins.length; i++) {
      const a = pins[i];
      if (a.state !== "seated" && a.state !== "loose") continue;
      for (let j = i + 1; j < pins.length; j++) {
        const b = pins[j];
        if (b.state !== "seated" && b.state !== "loose") continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = PIN_R * 2 + 1;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.001) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const push = (rr - d) / 2;
        if (a.state === "loose") {
          a.x -= nx * push;
          a.y -= ny * push;
        }
        if (b.state === "loose") {
          b.x += nx * push;
          b.y += ny * push;
        }
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 40 && a.state === "loose") {
          knockPin(b, nx, ny, rel * 0.85 + 90, false);
        } else if (rel < -40 && b.state === "loose") {
          knockPin(a, -nx, -ny, -rel * 0.85 + 90, false);
        }
      }
    }
  }

  // ---- placing ---------------------------------------------------
  function nearestHole(x, y) {
    let best = null;
    let bd = 1e9;
    for (const h of HOLES) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return { hole: best, dist: bd };
  }

  function grabNear(x, y, radius) {
    let best = null;
    let bs = radius; // score: distance, loose pins get a bonus
    for (const p of pins) {
      if (p.state !== "seated" && p.state !== "loose") continue;
      const d = Math.hypot(p.x - x, p.y - y) - (p.state === "loose" ? 6 : 0);
      if (d < bs) {
        bs = d;
        best = p;
      }
    }
    return best;
  }

  function pickUp(p) {
    if (p.state === "seated" && p.hole) p.hole.filled = false;
    p.state = "held";
    p.vx = 0;
    p.vy = 0;
    p.vang = 0;
    p.hole = null;
    held = p;
  }

  function spawnSpare() {
    if (S.phase === "menu") return;
    const spare = {
      hole: null,
      x: 690 + Math.random() * 40,
      y: 490 + Math.random() * 30,
      vx: -30,
      vy: -20,
      ang: 1.3,
      vang: 0,
      rest: 1.3 + (Math.random() - 0.5),
      cracked: false,
      state: "loose",
    };
    pins.push(spare);
    toast("+1 fresh pine", spare.x, spare.y - 24, "#62c9b4");
    thud(700, 0.2, 0.12);
  }

  function placeHeld(x, y) {
    const p = held;
    if (!p) return;
    const { hole, dist } = nearestHole(x, y);
    const inBin = x > BIN.l && x < BIN.r && y > BIN.t && y < BIN.b;
    if (inBin) {
      if (p.cracked) {
        p.state = "gone";
        held = null;
        S.swaps++;
        toast("into the bin…", 824, 480, "#c9b591");
        setTimeout(spawnSpare, 260);
        return;
      }
      p.x = BIN.l - 24;
      p.y = y;
      p.ang = 1.2;
      p.rest = 1.3;
      p.state = "loose";
      held = null;
      thud(500, 0.18, 0.1);
      toast("good wood stays", p.x, p.y - 20, "#c9b591");
      return;
    }
    if (hole && dist < 26) {
      if (p.cracked) {
        sfxBuzz();
        hole.flash = 1;
        toast("split wood won't stand", x, y - 28, "#ff6d8a");
      } else if (!hole.filled) {
        p.state = "seated";
        p.hole = hole;
        p.x = hole.x;
        p.y = hole.y;
        p.vx = 0;
        p.vy = 0;
        p.vang = 0;
        p.ang = 0;
        hole.filled = true;
        held = null;
        S.wage += 3;
        sfxSeat();
        toast("+3d", p.x, p.y - 28, "#f5ead2");
        syncHud();
        return;
      }
    }
    p.state = "loose";
    p.x = Math.max(PIT.l + PIN_R, Math.min(PIT.r - PIN_R, x));
    p.y = Math.max(PIT.t, Math.min(PIT.b, y));
    p.vx = 0;
    p.vy = 0;
    if (!p.rest) p.rest = 1.3;
    held = null;
    thud(800, 0.12, 0.06);
  }

  // ---- input -----------------------------------------------------
  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  }

  function inputAllowed() {
    return S.phase === "roll" || S.phase === "set";
  }

  cv.addEventListener("pointerdown", (e) => {
    audioInit();
    lastInput = "pointer";
    const pt = canvasPos(e);
    pointer.x = pt.x;
    pointer.y = pt.y;
    pointer.has = true;
    if (inputAllowed()) {
      const p = grabNear(pt.x, pt.y, 36);
      if (p) pickUp(p);
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    e.preventDefault();
  });

  cv.addEventListener("pointermove", (e) => {
    const pt = canvasPos(e);
    pointer.x = pt.x;
    pointer.y = pt.y;
    pointer.has = true;
    lastInput = "pointer";
  });

  cv.addEventListener("pointerup", (e) => {
    if (held && inputAllowed()) {
      const pt = canvasPos(e);
      placeHeld(pt.x, pt.y);
    }
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (
      k === "arrowleft" ||
      k === "arrowright" ||
      k === "arrowup" ||
      k === "arrowdown" ||
      k === " "
    ) {
      e.preventDefault();
    }
    if (k === "m") {
      audioInit();
      setMuted(!muted);
      return;
    }
    if (k === "p") {
      togglePause();
      return;
    }
    if (k === "r") {
      if (S.phase !== "menu") restart();
      return;
    }
    if (k === " ") {
      if (e.repeat) return;
      audioInit();
      lastInput = "key";
      if (inputAllowed()) {
        if (held) {
          placeHeld(kbHand.x, kbHand.y);
        } else {
          const p = grabNear(kbHand.x, kbHand.y, 46);
          if (p) {
            pickUp(p);
          } else {
            sfxBuzz();
          }
        }
      }
      return;
    }
    if (k.startsWith("arrow") || "wasd".includes(k)) lastInput = "key";
    keys[k] = true;
  });

  window.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  function stepKb(dt) {
    if (!(inputAllowed() || S.phase === "menu")) return;
    const sp = 340 * dt;
    let moved = false;
    if (keys["arrowleft"] || keys["a"]) {
      kbHand.x -= sp;
      moved = true;
    }
    if (keys["arrowright"] || keys["d"]) {
      kbHand.x += sp;
      moved = true;
    }
    if (keys["arrowup"] || keys["w"]) {
      kbHand.y -= sp;
      moved = true;
    }
    if (keys["arrowdown"] || keys["s"]) {
      kbHand.y += sp;
      moved = true;
    }
    if (moved) {
      kbHand.x = Math.max(PIT.l, Math.min(PIT.r, kbHand.x));
      kbHand.y = Math.max(PIT.t, Math.min(PIT.b, kbHand.y));
      lastInput = "key";
    }
  }

  // ---- overlays / buttons ----------------------------------------
  function show(ov) {
    for (const o of [ovMenu, ovPause, ovSacked, ovPaid]) {
      o.classList.toggle("is-hidden", o !== ov);
    }
  }

  function hideOverlays() {
    for (const o of [ovMenu, ovPause, ovSacked, ovPaid]) {
      o.classList.add("is-hidden");
    }
  }

  let paused = false;
  function togglePause(force) {
    if (S.phase === "menu" || S.phase === "over" || S.phase === "done") return;
    paused = force !== undefined ? force : !paused;
    btnPause.textContent = paused ? "▶" : "⏸";
    if (paused) show(ovPause);
    else hideOverlays();
  }

  function restart() {
    hideOverlays();
    paused = false;
    btnPause.textContent = "⏸";
    S.wage = 0;
    S.tips = 0;
    S.swaps = 0;
    S.toasts = [];
    S.bannerT = 0;
    beginFrame(1);
  }

  document.getElementById("btn-play").addEventListener("click", () => {
    audioInit();
    restart();
  });
  document.getElementById("btn-resume").addEventListener("click", () => {
    togglePause(false);
  });
  document.getElementById("btn-restart").addEventListener("click", () => {
    restart();
  });
  document.getElementById("btn-again").addEventListener("click", () => {
    restart();
  });
  document.getElementById("btn-envelope").addEventListener("click", () => {
    restart();
  });
  btnPause.addEventListener("click", () => togglePause());
  btnSound.addEventListener("click", () => {
    audioInit();
    setMuted(!muted);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !paused) togglePause(true);
  });

  function syncHud() {
    hudFrame.textContent =
      S.phase === "menu"
        ? "–"
        : `${Math.min(S.frame, FRAMES_TOTAL)} / ${FRAMES_TOTAL}`;
    hudRack.textContent = S.phase === "menu" ? "–" : `${seatedCount()} / 10`;
    hudWage.textContent = fmtWage(S.wage);
    const frac =
      S.phase === "set" ? Math.max(0, S.patience / S.patienceMax) : 1;
    patFill.style.width = `${frac * 100}%`;
    patFill.classList.toggle("is-low", frac < 0.35);
  }

  // ---- update ----------------------------------------------------
  function update(dt) {
    if (paused) return;
    stepKb(dt);
    for (const h of HOLES) h.flash = Math.max(0, h.flash - dt * 2.4);

    if (S.phase === "roll" || S.phase === "set") {
      if (ball) {
        stepBall(dt);
      }
      if (!ball) {
        if (S.secondTimer > 0) {
          S.secondTimer -= dt;
          if (S.secondTimer <= 0) {
            S.secondTimer = -1;
            toast("he's throwing again!", 450, 150, "#ff6d8a");
            throwBall(true);
          }
        } else if (S.awaitingThrow) {
          S.ballTimer -= dt;
          if (S.ballTimer <= 0) {
            S.awaitingThrow = false;
            throwBall(false);
          }
        } else if (S.phase === "roll") {
          S.phase = "set";
        }
      }
      stepPins(dt);
      if (S.phase === "set") {
        S.patience -= dt;
        if (S.patience <= 0) {
          S.patience = 0;
          endShift(false);
        } else if (seatedCount() >= 10) {
          frameRacked();
        }
      }
    } else if (S.phase === "pay") {
      S.payTimer -= dt;
      stepPins(dt);
      if (S.payTimer <= 0) {
        if (S.frame >= FRAMES_TOTAL) endShift(true);
        else beginFrame(S.frame + 1);
      }
    }

    for (const t of S.toasts) t.t += dt;
    S.toasts = S.toasts.filter((t) => t.t < 1.1);
    if (S.bannerT > 0) S.bannerT -= dt;
    syncHud();
  }

  // ---- drawing ---------------------------------------------------
  function drawWood() {
    const g = ctx.createLinearGradient(0, 196, 0, H);
    g.addColorStop(0, "#3a2717");
    g.addColorStop(1, "#241708");
    ctx.fillStyle = g;
    ctx.fillRect(0, 196, W, H - 196);
    ctx.strokeStyle = "#00000030";
    ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, 196);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(340, 0);
    ctx.lineTo(560, 0);
    ctx.lineTo(608, 198);
    ctx.lineTo(292, 198);
    ctx.closePath();
    const lg = ctx.createLinearGradient(0, 0, 0, 198);
    lg.addColorStop(0, "#8a6437");
    lg.addColorStop(1, "#d9ae74");
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "#00000022";
    for (let i = 0; i <= 12; i++) {
      const xTop = 340 + ((560 - 340) * i) / 12;
      const xBot = 292 + ((608 - 292) * i) / 12;
      ctx.beginPath();
      ctx.moveTo(xTop, 0);
      ctx.lineTo(xBot, 198);
      ctx.stroke();
    }
    ctx.fillStyle = "#24170866";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(450 + i * 46, 74);
      ctx.lineTo(442 + i * 46, 92);
      ctx.lineTo(458 + i * 46, 92);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#17100a";
    ctx.beginPath();
    ctx.moveTo(340, 0);
    ctx.lineTo(292, 198);
    ctx.lineTo(270, 198);
    ctx.lineTo(310, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(560, 0);
    ctx.lineTo(608, 198);
    ctx.lineTo(630, 198);
    ctx.lineTo(590, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e04b3aaa";
    ctx.fillRect(292, 192, 316, 5);
    ctx.fillStyle = "#4a3220";
    ctx.fillRect(PIT.l - 14, 170, 14, H - 170);
    ctx.fillRect(PIT.r, 170, 14, H - 170);
    ctx.strokeStyle = "#00000040";
    ctx.strokeRect(PIT.l - 14, 170, 14, H - 170);
    ctx.strokeRect(PIT.r, 170, 14, H - 170);
  }

  function drawBin() {
    const bw = BIN.r - BIN.l;
    const bh = BIN.b - BIN.t;
    ctx.save();
    ctx.translate(BIN.l, BIN.t);
    ctx.fillStyle = "#5a3d22";
    ctx.fillRect(0, 0, bw, bh);
    ctx.strokeStyle = "#2a1c11";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, bw, bh);
    ctx.strokeStyle = "#00000040";
    ctx.lineWidth = 2;
    for (let y = 56; y < bh; y += 16) {
      ctx.beginPath();
      ctx.moveTo(4, y);
      ctx.lineTo(bw - 4, y);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5ead2cc";
    ctx.font = "bold 15px Georgia, serif";
    ctx.fillText("SPARES", bw / 2, 26);
    ctx.font = "italic 11px Georgia, serif";
    ctx.fillStyle = "#f5ead288";
    ctx.fillText("split wood here", bw / 2, 42);
    ctx.restore();
  }

  function drawHoles() {
    for (const h of HOLES) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, HOLE_R, 0, Math.PI * 2);
      ctx.fillStyle = h.filled ? "#1b1108" : "#120b06";
      ctx.fill();
      ctx.strokeStyle = "#00000055";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!h.filled) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, HOLE_R - 5, 0, Math.PI * 2);
        ctx.strokeStyle = "#d9ae7422";
        ctx.stroke();
      }
      if (h.flash > 0) {
        ctx.strokeStyle = `rgba(224,75,58,${h.flash})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, HOLE_R + 4, 0, Math.PI * 2);
        ctx.stroke();
        const s = HOLE_R * 0.55;
        ctx.beginPath();
        ctx.moveTo(h.x - s, h.y - s);
        ctx.lineTo(h.x + s, h.y + s);
        ctx.moveTo(h.x + s, h.y - s);
        ctx.lineTo(h.x - s, h.y + s);
        ctx.stroke();
      }
    }
  }

  function drawPin(p, lift) {
    const lying = p.state === "loose";
    ctx.save();
    ctx.translate(p.x, p.y - (lift || 0));
    if (lying) {
      ctx.save();
      ctx.rotate(p.ang);
      ctx.scale(1, 0.45);
      ctx.fillStyle = "#00000045";
      ctx.beginPath();
      ctx.ellipse(0, 14, 17, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.rotate(p.ang);
    }
    const body = p.cracked ? "#ded4bd" : "#f7f0e1";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#00000055";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-9, 4, -9.5, -8, -4.5, -14);
    ctx.bezierCurveTo(-2.5, -17, -2.5, -22, -3.2, -26);
    ctx.bezierCurveTo(-3.6, -32, 3.6, -32, 3.2, -26);
    ctx.bezierCurveTo(2.5, -22, 2.5, -17, 4.5, -14);
    ctx.bezierCurveTo(9.5, -8, 9, 4, 0, 6);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.cracked ? "#b06a63" : "#e04b3a";
    ctx.fillRect(-3.1, -25, 6.2, 2.4);
    ctx.fillRect(-3.1, -21, 6.2, 2.4);
    if (p.cracked) {
      ctx.strokeStyle = "#3a2a1acc";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-1.5, -30);
      ctx.lineTo(1, -22);
      ctx.lineTo(-2, -14);
      ctx.lineTo(1.5, -6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBall() {
    if (!ball) return;
    const sk = ball.sinking ? Math.max(0.05, 1 - ball.sink) : 1;
    ctx.save();
    ctx.globalAlpha = ball.sinking ? Math.max(0, 1 - ball.sink * 0.8) : 1;
    ctx.fillStyle = "#00000050";
    ctx.beginPath();
    ctx.ellipse(
      ball.x + 6,
      ball.y + 10,
      BALL_R * sk,
      BALL_R * 0.5 * sk,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.translate(ball.x, ball.y);
    ctx.scale(sk, sk);
    ctx.rotate(ball.rot);
    const bg = ctx.createRadialGradient(-5, -6, 3, 0, 0, BALL_R);
    bg.addColorStop(0, "#7fd6c2");
    bg.addColorStop(0.55, "#3a9c87");
    bg.addColorStop(1, "#175246");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0d2b25";
    for (const spot of [
      [-4, -5],
      [4.5, -3],
      [-0.5, 4],
    ]) {
      ctx.beginPath();
      ctx.arc(spot[0], spot[1], 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHandHints() {
    const hp = handPos();
    if (lastInput === "key" && !held) {
      ctx.strokeStyle = "#f5ead255";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(kbHand.x, kbHand.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!held) return;
    const { hole, dist } = nearestHole(hp.x, hp.y);
    if (hole && dist < 34) {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, HOLE_R + 3, 0, Math.PI * 2);
      if (!hole.filled && !held.cracked) {
        ctx.strokeStyle = "#62c9b4";
        ctx.setLineDash([5, 4]);
      } else {
        ctx.strokeStyle = "#e04b3a99";
        ctx.setLineDash([2, 4]);
      }
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (held.cracked) {
      ctx.strokeStyle = "rgba(255,109,138,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        BIN.l - 3,
        BIN.t - 3,
        BIN.r - BIN.l + 6,
        BIN.b - BIN.t + 6,
      );
    }
  }

  function drawToasts() {
    ctx.font = "bold 15px Georgia, serif";
    ctx.textAlign = "center";
    for (const t of S.toasts) {
      ctx.globalAlpha = Math.max(0, 1 - t.t / 1.1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - t.t * 36);
    }
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    if (S.bannerT <= 0) return;
    const t = S.bannerT;
    const prog = 1 - t / S.bannerDur;
    const a = Math.max(0, Math.min(1, prog * 5, t * 2.5));
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.shadowColor = "#00000099";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#f5ead2";
    ctx.font = "bold 44px Georgia, serif";
    ctx.fillText(S.bannerText, 450, 118);
    if (S.bannerSub) {
      ctx.font = "italic 16px Georgia, serif";
      ctx.fillStyle = "#c9b591";
      ctx.fillText(S.bannerSub, 450, 146);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    const amb = ctx.createRadialGradient(450, 60, 60, 450, 280, 620);
    amb.addColorStop(0, "#2e2013");
    amb.addColorStop(1, "#120b07");
    ctx.fillStyle = amb;
    ctx.fillRect(0, 0, W, H);

    drawWood();

    const lamp = ctx.createLinearGradient(0, 0, 0, 320);
    lamp.addColorStop(0, "#ffd9a01f");
    lamp.addColorStop(1, "#ffd9a000");
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.moveTo(450, -10);
    ctx.lineTo(240, 330);
    ctx.lineTo(660, 330);
    ctx.closePath();
    ctx.fill();

    drawBin();
    drawHoles();

    for (const p of pins) {
      if (p.state === "gone" || p === held) continue;
      drawPin(p, 0);
    }

    drawBall();
    drawHandHints();

    if (held) {
      const hp = handPos();
      held.x = Math.max(20, Math.min(W - 20, hp.x));
      held.y = Math.max(30, Math.min(H - 10, hp.y - 14));
      held.ang = 0;
      drawPin(held, 26);
    }

    drawToasts();
    drawBanner();

    const vig = ctx.createRadialGradient(450, 280, 260, 450, 280, 640);
    vig.addColorStop(0, "#00000000");
    vig.addColorStop(1, "#00000066");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    if (S.phase === "menu") {
      ctx.fillStyle = "#00000088";
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- main loop -------------------------------------------------
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(tick);
  }

  makePins();
  syncHud();
  requestAnimationFrame(tick);

  // hidden debug hook — only active when opened with #debug in the URL
  if (/^#debug/.test(location.hash)) {
    window.__PM = { S, HOLES, pins: () => pins, ball: () => ball };
  }
})();
