/* Tin Parade — pump a wind-up tin soldier down a moonlit toyshop shelf.
   Verlet ragdoll, four coupled muscles (hips + knees), one long shelf, one bell. */
(() => {
  "use strict";

  /* ---------- world constants ---------- */
  const VIEW_W = 960;
  const VIEW_H = 540;
  const FLOOR = 470; // shelf top surface (virtual px)
  const WORLD_W = 2600;
  const START_X = 170;
  const FINISH_X = 2465;
  const PX_PER_CM = 6;
  const TOTAL_CM = Math.round((FINISH_X - START_X) / PX_PER_CM);
  const GRAVITY = 1500;
  const SUBSTEP = 1 / 240;

  /* muscle tuning: strings contract toward their short length while held */
  const STRING_STIFF = 0.3;
  const SK_SWING = 24; // shoulder<->knee string contraction (hip swing)
  const SK_TRAIL = 2; // opposite leg extension
  const HF_FOLD = 24; // hip<->foot contraction (knee bend)
  const RATE_ATTACK = 215; // px/s while the key is held
  const RATE_RELEASE = 200; // px/s relax back to neutral
  const ASSIST_KP = 30;
  const ASSIST_KD = 3.4;
  const ASSIST_GAIN = 1850;
  const IDLE_KP = 10;
  const IDLE_GAIN = 1500;
  const LEAN_TARGET = 0.14;

  /* ---------- dom ---------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const elDist = $("dist");
  const elBest = $("best");
  const elFalls = $("falls");
  const elBar = $("bar-fill");
  const ovlStart = $("ovl-start");
  const ovlPause = $("ovl-pause");
  const ovlOver = $("ovl-over");
  const ovlWin = $("ovl-win");
  const btnMute = $("btn-mute");

  if (!ctx.roundRect) {
    ctx.roundRect = function (x, y, w, h) {
      this.rect(x, y, w, h);
    };
  }

  /* ---------- state ---------- */
  const S = {
    mode: "title", // title | run | pause | over | win
    paused: false,
    time: 0,
    runTime: 0,
    started: false,
    falls: 0,
    best: 0,
    winT: 0,
    keyPhase: 0,
    shake: 0,
    muted: false,
    tipIdx: 0,
  };
  const TIPS = [
    "Hips first, then knees.",
    "Small steps. Tiny, dignified steps.",
    "Lean brave, land soft.",
    "The bell is closer than the floor. Probably.",
  ];

  try {
    S.best = parseInt(localStorage.getItem("tinparade.best") || "0", 10) || 0;
  } catch (e) {
    S.best = 0;
  }
  elBest.textContent = String(S.best);

  /* ---------- vec helpers ---------- */
  const vec = (x, y) => ({ x, y });
  const lenOf = (v) => Math.hypot(v.x, v.y);
  const normOf = (v) => {
    const l = lenOf(v) || 1;
    return vec(v.x / l, v.y / l);
  };
  const crossZ = (a, b) => a.x * b.y - a.y * b.x;
  const dotVV = (a, b) => a.x * b.x + a.y * b.y;
  const angBetween = (a, b) => Math.atan2(crossZ(a, b), dotVV(a, b));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* ---------- particles & sticks ---------- */
  function makeParticle(x, y, r, invMass) {
    return {
      x,
      y,
      px: x,
      py: y,
      r,
      im: invMass,
      ground: false,
      groundPrev: false,
    };
  }

  const P = {};
  const STICKS = [];
  const STRINGS = []; // { a, b, rest, neutral, lo, hi } - muscle actuators
  const JOINTS = {};

  function buildPose(atX) {
    const parts = {
      head: makeParticle(0, -152, 11, 1.2),
      shoulder: makeParticle(0, -132, 6, 0.45),
      hip: makeParticle(0, -88, 7, 0.45),
      lKnee: makeParticle(-7, -45, 4.5, 1),
      lFoot: makeParticle(-9, -6, 5, 0.9),
      rKnee: makeParticle(7, -45, 4.5, 1),
      rFoot: makeParticle(9, -6, 5, 0.9),
      lToe: makeParticle(2, -6, 4, 1),
      rToe: makeParticle(18, -6, 4, 1),
      lHand: makeParticle(7, -98, 3.5, 1.4),
      rHand: makeParticle(-7, -98, 3.5, 1.4),
    };
    for (const k in parts) {
      parts[k].x += atX;
      parts[k].y += FLOOR;
      parts[k].px = parts[k].x;
      parts[k].py = parts[k].y;
    }
    STICKS.length = 0;
    const stick = (a, b, stiff) =>
      STICKS.push({
        a: parts[a],
        b: parts[b],
        len: Math.hypot(parts[a].x - parts[b].x, parts[a].y - parts[b].y),
        stiff,
      });
    stick("shoulder", "hip", 1);
    stick("head", "shoulder", 1);
    stick("hip", "lKnee", 1);
    stick("lKnee", "lFoot", 1);
    stick("hip", "rKnee", 1);
    stick("rKnee", "rFoot", 1);
    stick("lFoot", "lToe", 1);
    stick("rFoot", "rToe", 1);
    stick("shoulder", "lHand", 1);
    stick("shoulder", "rHand", 1);
    STICKS.push({
      a: parts.head,
      b: parts.hip,
      len: Math.hypot(parts.head.x - parts.hip.x, parts.head.y - parts.hip.y),
      stiff: 0.06,
    });
    JOINTS.torso = 0;

    /* muscle strings: Q/W swing hips via shoulder-knee strings, O/P fold knees
       via hip-foot strings. Rest lengths ease toward targets each substep. */
    STRINGS.length = 0;
    const mkString = (a, b, swing, trail) => {
      const neutral = Math.hypot(
        parts[a].x - parts[b].x,
        parts[a].y - parts[b].y,
      );
      STRINGS.push({
        a: parts[a],
        b: parts[b],
        rest: neutral,
        neutral,
        lo: neutral - swing,
        hi: neutral + trail,
      });
    };
    mkString("shoulder", "lKnee", SK_SWING, SK_TRAIL); // 0: Q contracts
    mkString("shoulder", "rKnee", SK_SWING, SK_TRAIL); // 1: W contracts
    mkString("hip", "lFoot", HF_FOLD, 0.5); // 2: O contracts
    mkString("hip", "rFoot", HF_FOLD, 0.5); // 3: P contracts
    return parts;
  }

  /* ---------- input ---------- */
  const keys = { q: false, w: false, o: false, p: false };

  function setKey(k, down) {
    if (!(k in keys)) return;
    keys[k] = down;
    const pad = document.querySelector('.pad[data-key="' + k + '"]');
    if (pad) pad.classList.toggle("down", down);
    if (down && S.mode === "run") S.started = true;
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "Escape") {
      togglePause();
      e.preventDefault();
      return;
    }
    if (k === "m" && !e.repeat) {
      ensureAudio();
      toggleMute();
      return;
    }
    if (k === "r" && !e.repeat) {
      newRun();
      return;
    }
    if ((k === "?" || k === "h") && !e.repeat) {
      helpToggle();
      return;
    }
    if (k === "q" || k === "w" || k === "o" || k === "p") {
      e.preventDefault();
      setKey(k, true);
    } else if (k === " ") {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "q" || k === "w" || k === "o" || k === "p") setKey(k, false);
  });
  window.addEventListener("blur", () => {
    for (const k in keys) setKey(k, false);
  });

  document.querySelectorAll(".pad").forEach((pad) => {
    const k = pad.dataset.key;
    const down = (e) => {
      e.preventDefault();
      try {
        pad.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture unsupported */
      }
      ensureAudio();
      setKey(k, true);
    };
    const up = (e) => {
      e.preventDefault();
      setKey(k, false);
    };
    pad.addEventListener("pointerdown", down);
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("lostpointercapture", () => setKey(k, false));
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  /* ---------- audio (synthesised, lazy) ---------- */
  let AC = null;
  let master = null;
  let noiseBuf = null;

  function ensureAudio() {
    if (AC) {
      if (AC.state === "suspended") AC.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = S.muted ? 0 : 0.5;
      master.connect(AC.destination);
      const n = AC.sampleRate * 1.2;
      noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      AC = null;
    }
  }

  function env(gainVal, dur, t0) {
    const g = AC.createGain();
    g.gain.setValueAtTime(gainVal, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(master);
    return g;
  }

  function sfxThud(v) {
    if (!AC || S.muted) return;
    const t = AC.currentTime;
    const src = AC.createBufferSource();
    src.buffer = noiseBuf;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 340;
    src.connect(f);
    f.connect(env(clamp(v, 0.05, 0.4), 0.09, t));
    src.start(t);
    src.stop(t + 0.1);
  }

  function sfxClank() {
    if (!AC || S.muted) return;
    const t = AC.currentTime;
    [186, 279, 421].forEach((freq, i) => {
      const o = AC.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.3);
      o.connect(env(0.12 / (i + 1), 0.32, t));
      o.start(t);
      o.stop(t + 0.34);
    });
    const src = AC.createBufferSource();
    src.buffer = noiseBuf;
    const f = AC.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 2400;
    src.connect(f);
    f.connect(env(0.18, 0.12, t));
    src.start(t);
    src.stop(t + 0.14);
  }

  function sfxDing() {
    if (!AC || S.muted) return;
    const t = AC.currentTime;
    [
      [1319, 0.22, 1.5],
      [1979, 0.1, 0.9],
      [659, 0.08, 1.8],
    ].forEach((triple) => {
      const o = AC.createOscillator();
      o.type = "sine";
      o.frequency.value = triple[0];
      o.connect(env(triple[1], triple[2], t));
      o.start(t);
      o.stop(t + triple[2] + 0.05);
    });
  }

  function sfxApplause() {
    if (!AC || S.muted) return;
    const t = AC.currentTime;
    for (let i = 0; i < 7; i++) {
      const src = AC.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = 0.7 + Math.random() * 0.5;
      const f = AC.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1500 + Math.random() * 2200;
      f.Q.value = 0.8;
      const st = t + i * 0.16 + Math.random() * 0.08;
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.09, st + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.75);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(st);
      src.stop(st + 0.8);
    }
  }

  function sfxBlip(step) {
    if (!AC || S.muted) return;
    const t = AC.currentTime;
    const o = AC.createOscillator();
    o.type = "triangle";
    o.frequency.value = 620 * Math.pow(1.14, step % 8);
    o.connect(env(0.1, 0.12, t));
    o.start(t);
    o.stop(t + 0.14);
  }

  function toggleMute() {
    S.muted = !S.muted;
    btnMute.setAttribute("aria-pressed", String(S.muted));
    btnMute.textContent = S.muted ? "\u266A\u0338" : "\u266A";
    if (master) master.gain.value = S.muted ? 0 : 0.5;
  }

  /* ---------- fx particles ---------- */
  const dust = [];
  const confetti = [];
  const motes = [];
  for (let i = 0; i < 26; i++) {
    motes.push({
      x: Math.random() * VIEW_W,
      y: Math.random() * VIEW_H,
      s: 0.4 + Math.random(),
      ph: Math.random() * 9,
    });
  }

  function puff(x, y, n, spread) {
    for (let i = 0; i < n; i++) {
      dust.push({
        x: x + (Math.random() - 0.5) * spread,
        y,
        vx: (Math.random() - 0.5) * 60,
        vy: -20 - Math.random() * 50,
        r: 2 + Math.random() * 4,
        life: 0.5 + Math.random() * 0.4,
        t: 0,
      });
    }
  }

  function burstConfetti(x, y) {
    for (let i = 0; i < 70; i++) {
      confetti.push({
        x,
        y: y - Math.random() * 60,
        vx: (Math.random() - 0.5) * 220,
        vy: -120 - Math.random() * 160,
        rot: Math.random() * 7,
        vr: (Math.random() - 0.5) * 12,
        c: ["#d9a441", "#c94f3d", "#b9c2cf", "#e6c26a"][i % 4],
        t: 0,
        life: 2.2 + Math.random(),
      });
    }
  }

  /* ---------- physics ---------- */
  let lastMilestone = 0;

  function reset() {
    let atX = START_X;
    if ((S.mode === "over" || S.mode === "win") && P.hip && isFinite(P.hip.x)) {
      atX = clamp(P.hip.x, START_X, FINISH_X - 220);
    }
    const parts = buildPose(atX);
    for (const k in parts) P[k] = parts[k];
    S.time = 0;
    S.runTime = 0;
    S.started = false;
    lastMilestone = 0;
    dust.length = 0;
    camSnap();
  }

  /* PD-controlled joint drive: torque toward a target angle between two body directions.
     Force lands on the child particle along the direction that increases the angle;
     equal-and-opposite reactions land on the given anchors. Returns new relative angle. */
  function driveJoint(
    refDir,
    childDir,
    target,
    kp,
    kd,
    prevAng,
    gain,
    dt,
    child,
    anchors,
  ) {
    const rel = angBetween(refDir, childDir);
    let w = (rel - prevAng) / dt;
    w = clamp(w, -18, 18);
    const tau = clamp(kp * (target - rel) - kd * w, -1.3, 1.3) * gain;
    // tangent that increases rel: d/dalpha [R(alpha) d] at 0 = (-d.y, d.x)
    const fx = -childDir.y * tau;
    const fy = childDir.x * tau;
    const hh = dt * dt;
    child.x += fx * child.im * hh;
    child.y += fy * child.im * hh;
    for (const an of anchors) {
      an.p.x -= fx * an.share * an.p.im * hh;
      an.p.y -= fy * an.share * an.p.im * hh;
    }
    return rel;
  }

  function physStep(h) {
    S.time += h;
    if (S.mode === "run" && S.started) S.runTime += h;
    if (S.mode === "win") S.winT += h;

    const running = S.mode === "run";
    const posing = S.mode === "win";
    const alive = running || S.mode === "title" || posing;

    if (alive) {
      const upBody = normOf(
        vec(P.hip.x - P.shoulder.x, P.hip.y - P.shoulder.y),
      ); // body "down"
      const torsoUp = vec(-upBody.x, -upBody.y);
      const speed = Math.abs(P.hip.x - P.hip.px) / h;
      const assist = running ? Math.max(0.5, 1 - speed / 500) : 1;
      const inputOn = running && S.started;
      const hh = h;

      /* --- muscle strings --- */
      const ease = (s, contract, dt2) => {
        const target = contract ? s.lo : s.neutral;
        const extend = s.hi;
        let want = target;
        if (!contract && s.rest < s.neutral) want = s.neutral;
        else if (!contract && s.rest > s.neutral)
          want = Math.min(s.neutral + 0.001, extend);
        const rate = (contract ? RATE_ATTACK : RATE_RELEASE) * dt2;
        s.rest += clamp(want - s.rest, -rate, rate);
      };
      const lFwd = inputOn && keys.q;
      const rFwd = inputOn && keys.w;
      const lFold = inputOn && keys.o;
      const rFold = inputOn && keys.p;

      // Q: left leg swings forward, right trails. W: mirrored.
      ease(STRINGS[0], lFwd, hh);
      if (lFwd && !rFwd)
        STRINGS[1].rest += clamp(
          STRINGS[1].hi - STRINGS[1].rest,
          -RATE_RELEASE * hh,
          RATE_RELEASE * hh,
        );
      else ease(STRINGS[1], rFwd, hh);
      if (rFwd && !lFwd)
        STRINGS[0].rest += clamp(
          STRINGS[0].hi - STRINGS[0].rest,
          -RATE_RELEASE * hh,
          RATE_RELEASE * hh,
        );

      // O: left knee folds (right straightens). P: mirrored.
      ease(STRINGS[2], lFold, hh);
      if (lFold && !rFold)
        STRINGS[3].rest += clamp(
          STRINGS[3].neutral - STRINGS[3].rest,
          -RATE_RELEASE * hh,
          RATE_RELEASE * hh,
        );
      else ease(STRINGS[3], rFold, hh);
      if (rFold && !lFold)
        STRINGS[2].rest += clamp(
          STRINGS[2].neutral - STRINGS[2].rest,
          -RATE_RELEASE * hh,
          RATE_RELEASE * hh,
        );

      // idle posture tone keeps the tin legs from sagging
      if (!inputOn && !posing) {
        for (const leg of [
          ["lKnee", "lFoot", "lHip"],
          ["rKnee", "rFoot", "rHip"],
        ]) {
          const knee = P[leg[0]];
          const foot = P[leg[1]];
          const thigh = normOf(vec(knee.x - P.hip.x, knee.y - P.hip.y));
          const shin = normOf(vec(foot.x - knee.x, foot.y - knee.y));
          JOINTS[leg[2]] = driveJoint(
            upBody,
            thigh,
            0,
            IDLE_KP,
            1.1,
            JOINTS[leg[2]] || 0,
            IDLE_GAIN,
            hh,
            knee,
            [{ p: P.shoulder, share: 0.35 }],
          );
          JOINTS[leg[2] + "K"] = driveJoint(
            thigh,
            shin,
            0.12,
            IDLE_KP,
            0.8,
            JOINTS[leg[2] + "K"] || 0,
            IDLE_GAIN,
            hh,
            foot,
            [{ p: knee, share: 1 }],
          );
        }
      }

      /* upright assist: spring holding body-down near world-down, faded once moving fast */
      let lean = LEAN_TARGET * assist;
      if (inputOn && (keys.q || keys.w)) lean += 0.24;
      if (posing) lean += Math.min(0.5, S.winT * 0.35);
      JOINTS.torso = driveJoint(
        vec(0, -1),
        torsoUp,
        lean,
        ASSIST_KP * (0.4 + assist),
        ASSIST_KD,
        JOINTS.torso,
        ASSIST_GAIN * (0.35 + 0.65 * assist),
        hh,
        P.shoulder,
        [{ p: P.hip, share: 1 }],
      );
    }

    /* integrate verlet */
    for (const k in P) {
      const p = P[k];
      let vx = (p.x - p.px) * 0.999;
      let vy = (p.y - p.py) * 0.999;
      const sp = Math.hypot(vx, vy);
      if (sp > 4.2) {
        // hard speed cap (~1000 px/s) so nothing can explode
        vx = (vx / sp) * 4.2;
        vy = (vy / sp) * 4.2;
      }
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + GRAVITY * h * h;
    }

    /* distance constraints (+ muscle strings while alive) */
    for (let iter = 0; iter < 9; iter++) {
      for (
        let si = 0;
        si < STICKS.length + (alive ? STRINGS.length : 0);
        si++
      ) {
        const st =
          si < STICKS.length ? STICKS[si] : STRINGS[si - STICKS.length];
        const len = si < STICKS.length ? st.len : st.rest;
        const stiff = si < STICKS.length ? st.stiff : STRING_STIFF;
        const dx = st.b.x - st.a.x;
        const dy = st.b.y - st.a.y;
        const d = Math.hypot(dx, dy) || 1;
        const diff = ((d - len) / d) * stiff;
        const wSum = st.a.im + st.b.im;
        const ka = st.a.im / wSum;
        const kb = st.b.im / wSum;
        st.a.x += dx * diff * ka;
        st.a.y += dy * diff * ka;
        st.b.x -= dx * diff * kb;
        st.b.y -= dy * diff * kb;
      }
    }

    /* ground + walls */
    for (const k in P) {
      const p = P[k];
      const floorC = FLOOR - p.r;
      if (p.y >= floorC) {
        const vy = p.y - p.py;
        const vx = p.x - p.px;
        p.y = floorC;
        const rest =
          k === "head" ? 0.28 : k === "lFoot" || k === "rFoot" ? 0.06 : 0.03;
        p.py = p.y + vy * rest; // reflect upward
        const grip =
          k === "lFoot" || k === "rFoot"
            ? 0.72
            : k === "lKnee" || k === "rKnee"
              ? 0.93
              : 0.9;
        const isFoot = k === "lFoot" || k === "rFoot";
        // sticky boots: kill residual skate below a creep threshold
        p.px = isFoot && Math.abs(vx) < 1.1 ? p.x : p.x - vx * grip;
        const impactV = vy / h;
        if (!p.groundPrev && isFoot && p.x > P.hip.x + 6 && S.mode === "run") {
          P.hip.px -= 0.16; // toe-off shove: planted-ahead feet push the march along
        }
        if (!p.groundPrev && impactV > 140) {
          puff(p.x, FLOOR, 3, p.r * 3);
          if (impactV > 340) sfxThud(impactV * 0.00045);
        }
        p.groundPrev = true;
        p.ground = true;
      } else {
        p.groundPrev = false;
        p.ground = false;
      }
      if (p.x < 46 + p.r) {
        p.x = 46 + p.r;
        p.px = p.x + (p.px - p.x) * 0.5;
      }
      if (p.x > WORLD_W - 30 - p.r) {
        p.x = WORLD_W - 30 - p.r;
        p.px = p.x + (p.px - p.x) * 0.5;
      }
    }

    /* winding-key animation */
    if (alive) {
      const active =
        running && (keys.q || keys.w || keys.o || keys.p) && S.started;
      S.keyPhase = active
        ? S.keyPhase + h * 11
        : Math.max(0, S.keyPhase - h * 5);
    }

    /* milestones every 50 cm */
    if (running) {
      const m = Math.floor(Math.max(0, P.hip.x - START_X) / (PX_PER_CM * 50));
      if (m > lastMilestone) {
        lastMilestone = m;
        sfxBlip(m);
      }
    }

    /* fall check */
    if (running && S.time > 0.45) {
      if (
        P.head.y > FLOOR - P.head.r - 0.5 ||
        P.shoulder.y > FLOOR - P.shoulder.r - 2 ||
        P.hip.y > FLOOR - P.hip.r - 2
      ) {
        doFall();
      }
    }

    /* win check */
    if (running && P.hip.x >= FINISH_X) doWin();

    /* NaN guard */
    if (!isFinite(P.hip.x) || !isFinite(P.head.y) || Math.abs(P.hip.x) > 1e6) {
      reset();
    }
  }

  function doFall() {
    S.mode = "over";
    S.falls++;
    S.shake = 9;
    elFalls.textContent = String(S.falls);
    sfxClank();
    puff(P.head.x, FLOOR - 4, 12, 40);
    saveBest();
    S.tipIdx = (S.tipIdx + 1) % TIPS.length;
    setTimeout(() => {
      if (S.mode !== "over") return;
      $("tip").textContent = TIPS[S.tipIdx];
      $("over-dist").textContent = String(
        Math.max(0, Math.round((P.hip.x - START_X) / PX_PER_CM)),
      );
      $("over-falls").textContent = String(S.falls);
      showOnly(ovlOver);
    }, 850);
  }

  function doWin() {
    S.mode = "win";
    S.winT = 0;
    saveBest();
    setTimeout(() => {
      sfxDing();
      sfxApplause();
      burstConfetti(FINISH_X + 40, FLOOR - 120);
      S.shake = 4;
    }, 1000);
    setTimeout(() => {
      if (S.mode !== "win") return;
      const grade =
        S.falls === 0
          ? "Mirror Polish"
          : S.falls <= 2
            ? "Regulation Tin"
            : S.falls <= 5
              ? "Battle-Dented"
              : "Heroic Wreckage";
      $("win-time").textContent = S.runTime.toFixed(1) + " s";
      $("win-falls").textContent = String(S.falls);
      $("win-grade").textContent = grade;
      showOnly(ovlWin);
    }, 2300);
  }

  function saveBest() {
    const cm = Math.round((P.hip.x - START_X) / PX_PER_CM);
    if (cm > S.best) {
      S.best = cm;
      elBest.textContent = String(S.best);
      try {
        localStorage.setItem("tinparade.best", String(S.best));
      } catch (e) {
        /* storage unavailable */
      }
    }
  }

  /* ---------- flow ---------- */
  function showOnly(ovl) {
    [ovlStart, ovlPause, ovlOver, ovlWin].forEach((o) =>
      o.classList.toggle("show", o === ovl),
    );
  }
  function hideOverlays() {
    [ovlStart, ovlPause, ovlOver, ovlWin].forEach((o) =>
      o.classList.remove("show"),
    );
  }

  function newRun() {
    S.mode = "run";
    S.paused = false;
    reset();
    hideOverlays();
    ensureAudio();
  }

  function togglePause(force) {
    if (S.mode === "run") {
      S.paused = force !== undefined ? force : !S.paused;
      if (S.paused) showOnly(ovlPause);
      else hideOverlays();
    } else if (S.mode === "pause") {
      S.mode = "run";
      S.paused = false;
      hideOverlays();
    }
  }

  function helpToggle() {
    if (S.mode === "title") return;
    if (ovlStart.classList.contains("show")) {
      S.mode = "run";
      S.paused = false;
      hideOverlays();
    } else if (S.mode === "run" || S.mode === "pause") {
      S.mode = "pause";
      S.paused = true;
      showOnly(ovlStart);
    }
  }

  $("btn-start").addEventListener("click", () => {
    ensureAudio();
    if (S.mode === "title") newRun();
    else togglePause(false);
  });
  $("btn-again").addEventListener("click", newRun);
  $("btn-bow").addEventListener("click", newRun);
  $("btn-resume").addEventListener("click", () => togglePause(false));
  $("btn-help").addEventListener("click", helpToggle);
  $("btn-pause").addEventListener("click", () => togglePause());
  $("btn-mute").addEventListener("click", () => {
    ensureAudio();
    toggleMute();
  });
  $("btn-restart").addEventListener("click", newRun);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && S.mode === "run" && !S.paused) togglePause(true);
  });

  /* ---------- camera ---------- */
  let camX = 0;
  function camSnap() {
    camX = clamp(P.hip.x - 360, -40, WORLD_W - VIEW_W + 40);
  }
  function camStep(dt) {
    const want = clamp(P.hip.x - 360, -40, WORLD_W - VIEW_W + 40);
    camX += (want - camX) * Math.min(1, dt * 3.2);
  }

  /* ---------- rendering ---------- */
  const PROPS = [
    { x: 430, kind: "blocks" },
    { x: 720, kind: "ball" },
    { x: 1010, kind: "duck" },
    { x: 1290, kind: "drum" },
    { x: 1560, kind: "jack" },
    { x: 1840, kind: "robot" },
    { x: 2090, kind: "boat" },
    { x: 2280, kind: "bear" },
  ];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 1;
    const hgt = canvas.clientHeight || 1;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(hgt * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
  }

  function drawWall(t) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "#181d31");
    g.addColorStop(1, "#11141f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    /* wallpaper stripes */
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    const off = (camX * 0.18) % 56;
    for (let x = -off; x < VIEW_W; x += 56) ctx.fillRect(x, 0, 22, VIEW_H);

    /* windows (wall space, parallax 0.22) */
    const wOff = camX * 0.22;
    [330, 1210].forEach((wx, wi) => {
      const sx = wx - wOff;
      if (sx < -260 || sx > VIEW_W + 60) return;
      ctx.fillStyle = "#0d1122";
      ctx.fillRect(sx, 74, 210, 250);
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx + 4, 78, 202, 242);
      ctx.clip();
      const sg = ctx.createLinearGradient(0, 74, 0, 324);
      sg.addColorStop(0, "#232a52");
      sg.addColorStop(1, "#141a36");
      ctx.fillStyle = sg;
      ctx.fillRect(sx + 4, 78, 202, 242);
      if (wi === 0) {
        ctx.fillStyle = "#e9edf5";
        ctx.beginPath();
        ctx.arc(sx + 148, 138, 26, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#cdd4e4";
        ctx.beginPath();
        ctx.arc(sx + 140, 132, 5, 0, 7);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx + 155, 146, 3.4, 0, 7);
        ctx.fill();
      }
      for (let i = 0; i < 14; i++) {
        const stx = sx + 12 + ((i * 61) % 186);
        const sty = 92 + ((i * 43) % 120);
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.6 + i * 1.7));
        ctx.fillStyle = "rgba(233,237,245," + (tw * 0.8).toFixed(2) + ")";
        ctx.fillRect(stx, sty, 2, 2);
      }
      ctx.fillStyle = "#0a0e1d";
      ctx.beginPath();
      ctx.moveTo(sx + 4, 320);
      let rx = sx + 4;
      let ri = wi;
      while (rx < sx + 206) {
        const bh = 26 + ((ri * 37) % 34);
        ctx.lineTo(rx, 320 - bh);
        ctx.lineTo(rx + 34, 320 - bh);
        rx += 34;
        ri++;
      }
      ctx.lineTo(sx + 206, 320);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#2a3050";
      ctx.lineWidth = 7;
      ctx.strokeRect(sx, 74, 210, 250);
      ctx.beginPath();
      ctx.moveTo(sx + 105, 77);
      ctx.lineTo(sx + 105, 321);
      ctx.moveTo(sx + 3, 199);
      ctx.lineTo(sx + 207, 199);
      ctx.stroke();
    });

    /* price-tag garland */
    const gOff = camX * 0.45;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 9; i++) {
      const gx = 100 + i * 300 - gOff;
      if (gx < -80 || gx > VIEW_W + 80) continue;
      const sway = Math.sin(t * 1.1 + i * 1.3) * 7;
      ctx.strokeStyle = "rgba(217,164,65,0.28)";
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.quadraticCurveTo(gx + sway * 0.4, 40, gx + sway, 84);
      ctx.stroke();
      ctx.save();
      ctx.translate(gx + sway, 86);
      ctx.rotate(Math.sin(t * 1.1 + i * 1.3) * 0.1);
      ctx.fillStyle = i % 2 ? "rgba(233,228,216,0.75)" : "rgba(201,79,61,0.8)";
      ctx.fillRect(-17, -12, 34, 24);
      ctx.fillStyle = "rgba(20,24,40,0.85)";
      ctx.beginPath();
      ctx.arc(0, -6, 2.4, 0, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(20,24,40,0.55)";
      ctx.fillRect(-9, 2, 18, 2);
      ctx.fillRect(-9, 6, 12, 2);
      ctx.restore();
    }

    /* moonbeam onto the shelf */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const bx = 330 - wOff + 148;
    const bg = ctx.createLinearGradient(bx, 164, bx + 240, FLOOR);
    bg.addColorStop(0, "rgba(190,210,255,0.09)");
    bg.addColorStop(1, "rgba(190,210,255,0)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(bx - 34, 168);
    ctx.lineTo(bx + 34, 168);
    ctx.lineTo(bx + 300, FLOOR);
    ctx.lineTo(bx + 60, FLOOR);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShelf() {
    /* plank top */
    ctx.fillStyle = "#8a5a31";
    ctx.fillRect(0, FLOOR, VIEW_W, 4);
    ctx.fillStyle = "#6d4526";
    ctx.fillRect(0, FLOOR + 4, VIEW_W, 5);
    /* front face */
    const g = ctx.createLinearGradient(0, FLOOR + 9, 0, VIEW_H);
    g.addColorStop(0, "#54331a");
    g.addColorStop(1, "#38210f");
    ctx.fillStyle = g;
    ctx.fillRect(0, FLOOR + 9, VIEW_W, VIEW_H - FLOOR);
    /* grain */
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    const goff = camX % 90;
    for (let x = -goff; x < VIEW_W + 90; x += 90) {
      ctx.beginPath();
      ctx.moveTo(x + 8, FLOOR + 18);
      ctx.bezierCurveTo(
        x + 30,
        FLOOR + 32,
        x - 6,
        FLOOR + 46,
        x + 16,
        VIEW_H - 6,
      );
      ctx.stroke();
    }
    /* ruler ticks: one per 10 cm */
    const startX = START_X - camX;
    ctx.font = "10px sans-serif";
    for (let cm = 0; cm <= TOTAL_CM; cm += 10) {
      const x = startX + cm * PX_PER_CM;
      if (x < -20 || x > VIEW_W + 20) continue;
      const major = cm % 50 === 0;
      ctx.strokeStyle = major
        ? "rgba(233,228,216,0.5)"
        : "rgba(233,228,216,0.22)";
      ctx.beginPath();
      ctx.moveTo(x, VIEW_H - 4);
      ctx.lineTo(x, VIEW_H - (major ? 18 : 10));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(233,228,216,0.4)";
        ctx.fillText(String(cm), x - 8, VIEW_H - 22);
      }
    }
    /* start mark */
    if (startX > -70 && startX < VIEW_W + 70) {
      ctx.fillStyle = "rgba(233,228,216,0.35)";
      ctx.font = "700 11px sans-serif";
      ctx.fillText("START", startX - 16, FLOOR - 12);
      ctx.fillStyle = "rgba(201,79,61,0.55)";
      ctx.fillRect(startX - 2, FLOOR - 4, 4, 4);
    }
  }

  function drawFinish(t) {
    const x = FINISH_X - camX;
    if (x < -140 || x > VIEW_W + 140) return;
    ctx.fillStyle = "#4a2f18";
    ctx.fillRect(x, FLOOR - 26, 92, 28);
    ctx.fillStyle = "#5f3f22";
    ctx.fillRect(x, FLOOR - 26, 92, 6);
    const glow = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.save();
    ctx.shadowColor = "rgba(233,197,106," + (0.5 + glow * 0.4).toFixed(2) + ")";
    ctx.shadowBlur = 16 + glow * 10;
    ctx.fillStyle = "#e8c56a";
    ctx.beginPath();
    ctx.arc(x + 46, FLOOR - 44, 20, Math.PI, 0);
    ctx.lineTo(x + 58, FLOOR - 30);
    ctx.lineTo(x + 34, FLOOR - 30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#b98f3e";
    ctx.fillRect(x + 42, FLOOR - 68, 8, 6);
    ctx.beginPath();
    ctx.arc(x + 46, FLOOR - 62, 3.4, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#7a5a22";
    ctx.beginPath();
    ctx.arc(x + 46, FLOOR - 29, 4, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(233,228,216,0.75)";
    ctx.font = "700 9px sans-serif";
    ctx.fillText("RING", x + 33, FLOOR - 8);
  }

  function drawProp(p) {
    const x = p.x - camX;
    if (x < -90 || x > VIEW_W + 90) return;
    ctx.save();
    ctx.translate(x, FLOOR);
    switch (p.kind) {
      case "blocks": {
        const word = ["T", "I", "N"];
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = ["#a8563e", "#8f9db3", "#c8a04c"][i];
          ctx.fillRect(i * 26 - 30, -26, 24, 24);
          ctx.fillStyle = "rgba(20,24,40,0.8)";
          ctx.font = "700 14px sans-serif";
          ctx.fillText(word[i], i * 26 - 23, -8);
        }
        break;
      }
      case "ball":
        ctx.fillStyle = "#7f8aa5";
        ctx.beginPath();
        ctx.arc(0, -16, 16, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#a8563e";
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.arc(0, -16, 16, -0.5, 0.6);
        ctx.closePath();
        ctx.fill();
        break;
      case "duck":
        ctx.fillStyle = "#c8b04c";
        ctx.beginPath();
        ctx.ellipse(-2, -10, 13, 9, 0, 0, 7);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(8, -20, 7, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#a8563e";
        ctx.fillRect(13, -21, 6, 3);
        break;
      case "drum":
        ctx.fillStyle = "#8f3d33";
        ctx.fillRect(-13, -24, 26, 20);
        ctx.fillStyle = "#ddd5c2";
        ctx.beginPath();
        ctx.ellipse(0, -24, 13, 4.4, 0, 0, 7);
        ctx.fill();
        break;
      case "jack":
        ctx.fillStyle = "#54457c";
        ctx.fillRect(-15, -26, 30, 24);
        ctx.fillStyle = "#8f6cc9";
        ctx.beginPath();
        ctx.arc(0, -32, 8, Math.PI, 0);
        ctx.fill();
        break;
      case "robot":
        ctx.fillStyle = "#6d7f96";
        ctx.fillRect(-11, -30, 22, 26);
        ctx.fillRect(-7, -40, 14, 10);
        ctx.fillStyle = "#c94f3d";
        ctx.fillRect(-4, -37, 8, 3);
        ctx.strokeStyle = "#6d7f96";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -40);
        ctx.lineTo(3, -47);
        ctx.stroke();
        break;
      case "boat":
        ctx.fillStyle = "#8f6c46";
        ctx.beginPath();
        ctx.moveTo(-18, -6);
        ctx.lineTo(18, -6);
        ctx.lineTo(10, -14);
        ctx.lineTo(-10, -14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ddd5c2";
        ctx.beginPath();
        ctx.moveTo(0, -46);
        ctx.lineTo(0, -16);
        ctx.lineTo(14, -16);
        ctx.closePath();
        ctx.fill();
        break;
      case "bear":
        ctx.fillStyle = "#7c5a3c";
        ctx.beginPath();
        ctx.arc(-8, -30, 6, 0, 7);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(8, -30, 6, 0, 7);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -18, 12, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#c9ab86";
        ctx.beginPath();
        ctx.arc(0, -14, 5, 0, 7);
        ctx.fill();
        break;
    }
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, -1, 20, 3.4, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  function limb(a, b, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x - camX, a.y);
    ctx.lineTo(b.x - camX, b.y);
    ctx.stroke();
  }

  function dotAt(p, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x - camX, p.y, r, 0, 7);
    ctx.fill();
  }

  function bootDraw(foot, knee, dark) {
    const ang = Math.atan2(foot.y - knee.y, foot.x - knee.x) - Math.PI / 2;
    ctx.save();
    ctx.translate(foot.x - camX, foot.y);
    ctx.rotate(ang);
    ctx.fillStyle = dark ? "#2e2a26" : "#3c3630";
    ctx.beginPath();
    ctx.roundRect(-5, -4, 16, 10, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawSoldier() {
    const cx = P.hip.x - camX;
    if (cx < -140 || cx > VIEW_W + 140) return;

    /* ground shadow */
    const hAbove = clamp((FLOOR - P.hip.y) / 120, 0, 1);
    ctx.fillStyle = "rgba(0,0,0," + (0.34 - hAbove * 0.18).toFixed(2) + ")";
    ctx.beginPath();
    ctx.ellipse(cx, FLOOR - 1, 26 - hAbove * 10, 4.4, 0, 0, 7);
    ctx.fill();

    const tinFar = "#8d97a8";
    const tinNear = "#bcc5d3";

    /* far arm */
    limb(P.shoulder, P.lHand, 6.5, "#7c6a58");
    dotAt(P.lHand, 3.4, "#7c6a58");

    /* far leg */
    limb(P.hip, P.lKnee, 10, tinFar);
    limb(P.lKnee, P.lFoot, 8, tinFar);
    bootDraw(P.lFoot, P.lKnee, true);

    /* torso jacket */
    limb(P.shoulder, P.hip, 17, "#c94f3d");
    limb(P.shoulder, P.hip, 5, "rgba(20,24,40,0.35)");
    const beltX = P.hip.x - camX + (P.shoulder.x - P.hip.x) * 0.18;
    const beltY = P.hip.y + (P.shoulder.y - P.hip.y) * 0.18;
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(beltX - 8, beltY - 2.4, 16, 4.8);

    /* wind-up key on his back */
    const mx = (P.hip.x + P.shoulder.x) / 2 - camX;
    const my = (P.hip.y + P.shoulder.y) / 2;
    let bd = normOf(vec(P.shoulder.y - P.hip.y, -(P.shoulder.x - P.hip.x)));
    if (bd.x > 0) bd = vec(-bd.x, -bd.y);
    const kx = mx + bd.x * 13;
    const ky = my + bd.y * 13;
    ctx.strokeStyle = "#d9a441";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(mx + bd.x * 4, my + bd.y * 4);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    const squish = Math.cos(S.keyPhase);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.ellipse(
      kx + bd.x * 7,
      ky + bd.y * 7,
      7,
      Math.max(1.6, 7 * Math.abs(squish)),
      Math.atan2(bd.y, bd.x),
      0,
      7,
    );
    ctx.stroke();

    /* near leg */
    limb(P.hip, P.rKnee, 11, tinNear);
    limb(P.rKnee, P.rFoot, 9, tinNear);
    bootDraw(P.rFoot, P.rKnee, false);

    /* rivets */
    dotAt(P.hip, 2.1, "#5d6675");
    dotAt(P.rKnee, 2.1, "#5d6675");

    /* head + shako */
    const hx = P.head.x - camX;
    const hy = P.head.y;
    ctx.fillStyle = tinNear;
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#20242f";
    ctx.beginPath();
    ctx.arc(hx + 4.6, hy - 2, 1.6, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(201,79,61,0.5)";
    ctx.beginPath();
    ctx.arc(hx + 5.4, hy + 2.6, 2.6, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#20242f";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(hx + 2.4, hy + 2.2, 3.4, 0.2, 1.5);
    ctx.stroke();
    ctx.fillStyle = "#3a2f4f";
    ctx.beginPath();
    ctx.roundRect(hx - 8, hy - 22, 16, 12, 3);
    ctx.fill();
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(hx - 8, hy - 13, 16, 2.6);
    ctx.strokeStyle = "#c94f3d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx - 2, hy - 22);
    ctx.quadraticCurveTo(hx - 10, hy - 30, hx - 16, hy - 26);
    ctx.stroke();

    /* near arm */
    limb(P.shoulder, P.rHand, 7, "#a08a72");
    dotAt(P.rHand, 3.6, "#a08a72");
  }

  function drawFx(dt) {
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.t += dt;
      if (d.t > d.life) {
        dust.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 60 * dt;
      const a = 0.35 * (1 - d.t / d.life);
      ctx.fillStyle = "rgba(196,178,148," + a.toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(d.x - camX, d.y, d.r * (1 + d.t), 0, 7);
      ctx.fill();
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.t += dt;
      if (c.t > c.life || c.y > FLOOR - 2) {
        confetti.splice(i, 1);
        continue;
      }
      c.vy += 240 * dt;
      c.vx *= 0.99;
      c.x += c.vx * dt + Math.sin(c.t * 9 + c.rot) * 30 * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      ctx.save();
      ctx.translate(c.x - camX, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = clamp(2 - (c.t / c.life) * 2, 0, 1);
      ctx.fillStyle = c.c;
      ctx.fillRect(-3, -1.6, 6, 3.2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const m of motes) {
      m.ph += dt * m.s;
      const mx = (((m.x - camX * 0.1) % VIEW_W) + VIEW_W) % VIEW_W;
      const my = (((m.y + Math.sin(m.ph) * 14) % VIEW_H) + VIEW_H) % VIEW_H;
      ctx.fillStyle = "rgba(233,228,216,0.05)";
      ctx.beginPath();
      ctx.arc(mx, my, 1.4, 0, 7);
      ctx.fill();
    }
  }

  function render(dt, t) {
    resize();
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.min(cw / VIEW_W, ch / VIEW_H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      (cw - VIEW_W * scale) / 2,
      (ch - VIEW_H * scale) / 2,
    );

    if (S.shake > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * S.shake,
        (Math.random() - 0.5) * S.shake,
      );
      S.shake *= Math.pow(0.02, dt);
    } else {
      S.shake = 0;
    }

    drawWall(t);
    for (const p of PROPS) drawProp(p);
    drawShelf();
    drawFinish(t);
    drawSoldier();
    drawFx(dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vg = ctx.createRadialGradient(
      cw / 2,
      ch / 2,
      Math.min(cw, ch) * 0.42,
      cw / 2,
      ch / 2,
      Math.max(cw, ch) * 0.75,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(4,6,14,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cw, ch);
  }

  /* ---------- hud sync ---------- */
  let shownDist = -1;
  function hudSync() {
    const cm = Math.max(0, Math.round((P.hip.x - START_X) / PX_PER_CM));
    if (cm !== shownDist) {
      shownDist = cm;
      elDist.textContent = String(cm);
      elBar.style.width = clamp((cm / TOTAL_CM) * 100, 0, 100).toFixed(1) + "%";
    }
  }

  /* ---------- main loop ---------- */
  reset();
  let lastTs = 0;
  let acc = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    let frameDt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (frameDt > 0.05) frameDt = 0.05;

    const frozen = (S.paused && S.mode === "run") || S.mode === "pause";
    if (!frozen) {
      acc += frameDt;
      let steps = 0;
      while (acc >= SUBSTEP && steps < 14) {
        physStep(SUBSTEP);
        acc -= SUBSTEP;
        steps++;
      }
      if (acc > 0.25) acc = 0;
      camStep(frameDt);
    }
    render(frameDt, S.time);
    hudSync();
  }
  requestAnimationFrame(loop);

  /* ---------- debug hook (only with #debug hash) ---------- */
  if (location.hash.indexOf("debug") !== -1) {
    window.__TP = {
      mode: () => S.mode,
      pos: () => ({ x: P.hip.x, y: P.hip.y }),
      parts: () => {
        const o = {};
        for (const k in P) o[k] = [Math.round(P[k].x), Math.round(P[k].y)];
        return o;
      },
      joints: () => ({ ...JOINTS }),
      stepOnce: () => physStep(1 / 240),
      ang: () => JOINTS.torso,
      poke: () => {
        P.head.y = FLOOR - 5;
        P.shoulder.y = FLOOR - 4;
        P.hip.y = FLOOR - 3;
      },
      winNow: () => {
        const dx = FINISH_X - 12 - P.hip.x;
        for (const k in P) {
          P[k].x += dx;
          P[k].px += dx;
        }
      },
      reset: newRun,
      keys,
    };
  }
})();
