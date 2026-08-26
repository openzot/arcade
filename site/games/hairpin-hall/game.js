/* Hairpin Hall — slot-car club night.
   One trigger, no steering: the slot drives, you ration the power. */
(() => {
  "use strict";

  /* ---------------- dom ---------------- */

  const $ = (id) => document.getElementById(id);
  const canvas = $("rink");
  const ctx = canvas.getContext("2d");
  const stage = $("stage");
  const veil = $("veil");
  const panels = {
    menu: $("menuPanel"),
    result: $("resultPanel"),
    pause: $("pausePanel"),
  };
  const cells = {
    lap: $("lapCell"),
    pos: $("posCell"),
    cur: $("curCell"),
    best: $("bestCell"),
    gap: $("gapCell"),
  };
  const tickerEl = $("ticker");
  const brakePad = $("brakePad");
  const pauseBtn = $("pauseBtn");
  const muteBtn = $("muteBtn");

  /* ---------------- helpers ---------------- */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmt(t) {
    if (!isFinite(t) || t <= 0) return "–";
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ":" + s.toFixed(1).padStart(4, "0");
  }

  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------------- world & track ---------------- */

  const W = 1280;
  const H = 820;
  const STEP = 4; // px between centreline samples
  const TRACK_HALF = 34; // half width of the ribbon
  const LANE_OFF = 16; // slot centres from the middle

  const CTRL = [
    [170, 690],
    [540, 706],
    [930, 700],
    [1135, 640],
    [1205, 470],
    [1140, 285],
    [975, 185],
    [770, 215],
    [640, 150],
    [420, 140],
    [205, 205],
    [105, 400],
    [135, 580],
  ];

  // physics feel
  const ENG_A = 430; // low-speed punch
  const ENG_VT = 640; // asymptotic top speed
  const BRAKE_D = 520; // brake decel
  const COAST_A = 24; // rolling drag when coasting
  const COAST_Q = 0.00055; // air drag when coasting
  const LATG = 470; // lateral grip, px/s^2 -> corner speed = sqrt(R*LATG)
  const SLIP_GROW = 3.0;
  const SLIP_DECAY = 1.15;

  const LAPS = 6;

  function crPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const f = (a, b, c, d) =>
      0.5 *
      (2 * b +
        (-a + c) * t +
        (2 * a - 5 * b + 4 * c - d) * t2 +
        (-a + 3 * b - 3 * c + d) * t3);
    return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
  }

  const rawPts = [];
  {
    const n = CTRL.length;
    for (let i = 0; i < n; i++) {
      const p0 = CTRL[(i - 1 + n) % n];
      const p1 = CTRL[i];
      const p2 = CTRL[(i + 1) % n];
      const p3 = CTRL[(i + 2) % n];
      for (let j = 0; j < 36; j++) rawPts.push(crPoint(p0, p1, p2, p3, j / 36));
    }
  }

  const PTS = [];
  {
    let acc = 0;
    let prev = rawPts[0].slice();
    PTS.push(prev.slice());
    const walk = rawPts.concat([rawPts[0]]);
    for (let i = 1; i < walk.length; i++) {
      const cur = walk[i];
      let d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      while (acc + d >= STEP) {
        const t = (STEP - acc) / d;
        prev = [
          prev[0] + (cur[0] - prev[0]) * t,
          prev[1] + (cur[1] - prev[1]) * t,
        ];
        PTS.push(prev.slice());
        d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
        acc = 0;
      }
      acc += d;
      prev = cur;
    }
  }

  const N = PTS.length;
  const L = N * STEP;

  const TH = new Float32Array(N); // tangent angle
  const KAP = new Float32Array(N); // smoothed curvature
  {
    for (let i = 0; i < N; i++) {
      const a = PTS[(i - 1 + N) % N];
      const b = PTS[(i + 1) % N];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      TH[i] = Math.atan2(dy, dx);
    }
    const rawK = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t0 = TH[(i - 2 + N) % N];
      let d = TH[(i + 2) % N] - t0;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      rawK[i] = Math.abs(d) / (4 * STEP);
    }
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -3; o <= 3; o++) s += rawK[(i + o + N) % N];
      KAP[i] = s / 7;
    }
  }

  const VC = new Float32Array(N); // corner-limited speed
  const SAFE = new Float32Array(N); // corner speed with braking envelope
  for (let i = 0; i < N; i++) {
    VC[i] = Math.min(ENG_VT * 0.97, Math.sqrt(LATG / Math.max(KAP[i], 1e-5)));
  }
  SAFE.set(VC);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const nx = SAFE[(i + 1) % N];
      SAFE[i] = Math.min(
        SAFE[i],
        Math.sqrt(nx * nx + 2 * BRAKE_D * STEP * 0.92),
      );
    }
  }

  const idxOf = (s) => Math.floor(s / STEP) % N;

  function posAt(s, lane) {
    s = ((s % L) + L) % L;
    const f = s / STEP;
    const i = Math.floor(f) % N;
    const t = f - Math.floor(f);
    const j = (i + 1) % N;
    let tx = lerp(Math.cos(TH[i]), Math.cos(TH[j]), t);
    let ty = lerp(Math.sin(TH[i]), Math.sin(TH[j]), t);
    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;
    const cx = lerp(PTS[i][0], PTS[j][0], t);
    const cy = lerp(PTS[i][1], PTS[j][1], t);
    return {
      x: cx - ty * lane,
      y: cy + tx * lane,
      ang: Math.atan2(ty, tx),
      nx: -ty,
      ny: tx,
    };
  }

  /* ---------------- state ---------------- */

  const S = {
    mode: "menu", // menu | countdown | race | results
    paused: false,
    muted: false,
    pace: "colonel",
    raceT: 0,
    cd: 0,
    goFlash: 0,
  };

  const PACES = {
    curate: { base: 0.8, name: "the New Curate", flub: 0.6 },
    colonel: { base: 0.945, name: "the Colonel", flub: 0.45 },
    vicar: { base: 1.005, name: "the Vicar", flub: 0.3 },
  };

  function mkCar(lane, col, stripe, ai) {
    return {
      lane,
      col,
      stripe,
      ai,
      s: 0,
      v: 0,
      slip: 0,
      spin: 0, // 0 run, 1 spinning, 2 waiting for the marshal
      spinT: 0,
      slide: 0,
      lapsDone: 0,
      distSince: 0,
      lapStart: 0,
      laps: [],
      best: Infinity,
      finished: false,
      finishT: 0,
      skill: 1,
      skillTarget: 1,
      lapseT: 0,
      lapseKind: "",
      nextFlub: 6,
      flubChance: 0.45,
    };
  }

  const P = mkCar(-1, "#d24a32", "#f3e7cf", false); // you, inner slot
  const R = mkCar(1, "#3f7d4e", "#e8d9ae", true); // the rival, outer

  let hallRecord = null;
  try {
    const rawRec = localStorage.getItem("hairpin-hall.record.v1");
    if (rawRec) hallRecord = JSON.parse(rawRec);
  } catch (e) {
    hallRecord = null;
  }
  function saveRecord(rec) {
    hallRecord = rec;
    try {
      localStorage.setItem("hairpin-hall.record.v1", JSON.stringify(rec));
    } catch (e) {
      /* private mode etc — the board just forgets */
    }
  }

  /* ---------------- ticker ---------------- */

  let tickerTimer = 0;
  function say(msg, ms) {
    tickerEl.textContent = msg;
    tickerEl.classList.add("show");
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(
      () => tickerEl.classList.remove("show"),
      ms || 2400,
    );
  }

  /* ---------------- audio ---------------- */

  let AC = null;
  let master = null;
  let motorP = null;
  let motorR = null;
  let skidGain = null;

  function mkMotor(vol) {
    const o1 = AC.createOscillator();
    const o2 = AC.createOscillator();
    const f = AC.createBiquadFilter();
    const g = AC.createGain();
    o1.type = "sawtooth";
    o2.type = "sawtooth";
    o1.frequency.value = 60;
    o2.frequency.value = 62;
    f.type = "lowpass";
    f.frequency.value = 320;
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(master);
    o1.start();
    o2.start();
    return { o1, o2, f, g, vol };
  }

  function ensureAudio() {
    if (AC) {
      if (AC.state === "suspended") AC.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      AC = new Ctor();
    } catch (e) {
      AC = null;
      return;
    }
    master = AC.createGain();
    master.gain.value = S.muted ? 0 : 1;
    master.connect(AC.destination);
    motorP = mkMotor(0.05);
    motorR = mkMotor(0.022);
    const buf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 880;
    bp.Q.value = 0.8;
    skidGain = AC.createGain();
    skidGain.gain.value = 0;
    src.connect(bp);
    bp.connect(skidGain);
    skidGain.connect(master);
    src.start();
  }

  function setMotor(m, v, on) {
    if (!AC || !m) return;
    const t = AC.currentTime;
    const fr = 56 + v * 178;
    m.o1.frequency.setTargetAtTime(fr, t, 0.04);
    m.o2.frequency.setTargetAtTime(fr * 1.012 + 1.5, t, 0.04);
    m.f.frequency.setTargetAtTime(240 + v * 1500, t, 0.06);
    m.g.gain.setTargetAtTime(on ? m.vol * (0.4 + 0.6 * v) : 0, t, 0.06);
  }

  function setSkid(a) {
    if (!AC || !skidGain) return;
    skidGain.gain.setTargetAtTime(a, AC.currentTime, 0.05);
  }

  function beep(freq, dur, type, vol, when) {
    if (!AC) return;
    const t = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function thunk() {
    if (!AC) return;
    const t = AC.currentTime;
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.28);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.35);
  }

  function jingle(win) {
    const seq = win ? [523, 659, 784, 1046] : [392, 330, 262];
    seq.forEach((f, i) => beep(f, 0.16, "square", 0.14, i * 0.13));
  }

  /* ---------------- input ---------------- */

  const input = { thr: false, brk: false };
  const keyThr = { on: false };
  const keyBrk = { on: false };
  const touchThr = new Set();
  let padBrake = false;
  let mouseBrake = false;

  window.addEventListener("keydown", (e) => {
    if (
      e.repeat &&
      (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown")
    ) {
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case "Space":
      case "ArrowUp":
      case "KeyW":
        keyThr.on = true;
        e.preventDefault();
        ensureAudio();
        break;
      case "ShiftLeft":
      case "ShiftRight":
      case "ArrowDown":
      case "KeyS":
      case "KeyX":
        keyBrk.on = true;
        break;
      case "KeyP":
      case "Escape":
        togglePause();
        break;
      case "KeyM":
        toggleMute();
        break;
      case "KeyR":
        if (S.mode !== "menu") startHeat(S.pace);
        break;
      default:
        return;
    }
    syncInput();
  });

  window.addEventListener("keyup", (e) => {
    switch (e.code) {
      case "Space":
      case "ArrowUp":
      case "KeyW":
        keyThr.on = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
      case "ArrowDown":
      case "KeyS":
      case "KeyX":
        keyBrk.on = false;
        break;
    }
    syncInput();
  });

  function syncInput() {
    if (S.paused) {
      input.thr = false;
      input.brk = false;
      return;
    }
    input.thr = keyThr.on || touchThr.size > 0;
    input.brk = keyBrk.on || padBrake || mouseBrake;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    ensureAudio();
    if (e.button === 2) {
      mouseBrake = true;
    } else {
      touchThr.add(e.pointerId);
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (err) {
        /* fine without */
      }
    }
    syncInput();
    e.preventDefault();
  });

  function dropPointer(e) {
    touchThr.delete(e.pointerId);
    if (e.button === 2) mouseBrake = false;
    syncInput();
  }
  stage.addEventListener("pointerup", dropPointer);
  stage.addEventListener("pointercancel", dropPointer);
  stage.addEventListener("contextmenu", (e) => e.preventDefault());

  brakePad.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    padBrake = true;
    brakePad.classList.add("on");
    try {
      brakePad.setPointerCapture(e.pointerId);
    } catch (err) {
      /* fine without */
    }
    e.preventDefault();
  });
  const padOff = () => {
    padBrake = false;
    brakePad.classList.remove("on");
  };
  brakePad.addEventListener("pointerup", padOff);
  brakePad.addEventListener("pointercancel", padOff);

  /* ---------------- buttons ---------------- */

  document.querySelectorAll("#menuPanel .paces button").forEach((b) => {
    b.addEventListener("click", () => {
      ensureAudio();
      startHeat(b.dataset.pace);
    });
  });
  $("rematchBtn").addEventListener("click", () => startHeat(S.pace));
  $("menuBtn").addEventListener("click", toMenu);
  $("resumeBtn").addEventListener("click", () => setPause(false));
  $("restartBtn").addEventListener("click", () => startHeat(S.pace));
  $("toMenuBtn").addEventListener("click", () => {
    setPause(false);
    toMenu();
  });
  pauseBtn.addEventListener("click", togglePause);
  muteBtn.addEventListener("click", toggleMute);

  function toggleMute() {
    S.muted = !S.muted;
    muteBtn.textContent = S.muted ? "♪ Sound off" : "♪ Sound on";
    if (master) master.gain.value = S.muted ? 0 : 1;
  }

  function togglePause() {
    if (S.mode !== "race" && S.mode !== "countdown") return;
    setPause(!S.paused);
  }

  function setPause(on) {
    if (S.paused === on) return;
    S.paused = on;
    pauseBtn.textContent = on ? "▶ Go" : "⏸ Pause";
    veil.classList.toggle("hidden", !on);
    panels.menu.classList.add("hidden");
    panels.result.classList.add("hidden");
    panels.pause.classList.toggle("hidden", !on);
    setMotor(motorP, 0, false);
    setMotor(motorR, 0, false);
    setSkid(0);
    syncInput();
  }

  function toMenu() {
    S.mode = "menu";
    S.paused = false;
    pauseBtn.textContent = "⏸ Pause";
    veil.classList.remove("hidden");
    panels.pause.classList.add("hidden");
    panels.result.classList.add("hidden");
    panels.menu.classList.remove("hidden");
    setMotor(motorP, 0, false);
    setMotor(motorR, 0, false);
    setSkid(0);
    syncInput();
  }

  /* ---------------- race flow ---------------- */

  function startHeat(pace) {
    S.pace = PACES[pace] ? pace : "colonel";
    const pc = PACES[S.pace];

    for (const c of [P, R]) {
      c.s = c.lane < 0 ? L - 92 : L - 54;
      c.v = 0;
      c.slip = 0;
      c.spin = 0;
      c.spinT = 0;
      c.slide = 0;
      c.lapsDone = 0;
      c.distSince = 0;
      c.lapStart = 0;
      c.laps = [];
      c.best = Infinity;
      c.finished = false;
      c.finishT = 0;
      c.lapseT = 0;
      c.nextFlub = rand(5, 10);
      c.skill = pc.base;
      c.skillTarget = pc.base;
      c.flubChance = pc.flub;
    }

    S.mode = "countdown";
    S.cd = 0;
    S.goFlash = 0;
    S.raceT = 0;
    S.paused = false;
    pauseBtn.textContent = "⏸ Pause";

    veil.classList.add("hidden");
    for (const k in panels) panels[k].classList.add("hidden");
    clearMarks();
    parts.length = 0;
    ensureAudio();
    setMotor(motorP, 0, false);
    setMotor(motorR, 0, false);
    setSkid(0);
    say("Heat on against " + pc.name + " — six laps", 2200);
    syncInput();
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function lapDone(c) {
    const t = S.raceT - c.lapStart;
    c.laps.push(t);
    c.best = Math.min(c.best, t);
    c.lapStart = S.raceT;
    c.lapsDone++;
    if (c === P && !c.finished) {
      if (c.lapsDone === LAPS - 1) say("Last lap!", 1800);
      if (hallRecord === null || c.best < hallRecord.ms) {
        saveRecord({
          ms: c.best,
          holder: "you v " + PACES[S.pace].name,
          day: today(),
        });
        say("New hall record lap! " + fmt(c.best), 2600);
        beep(1174, 0.2, "square", 0.12, 0.08);
      } else {
        beep(660, 0.09, "square", 0.1);
        beep(880, 0.12, "square", 0.1, 0.1);
      }
    }
    if (c.lapsDone >= LAPS && !c.finished) {
      c.finished = true;
      c.finishT = S.raceT;
      if (c === P) beep(1046, 0.25, "square", 0.16);
    }
  }

  function progressOf(c) {
    return c.lapsDone * L + c.s;
  }

  function finishRace() {
    S.mode = "results";
    const pc = PACES[S.pace];
    const youWon = P.finished && (!R.finished || P.finishT <= R.finishT);
    $("resTitle").textContent = youWon ? "Chequered flag!" : "Second best.";
    let line;
    if (!P.finished) {
      line = "You failed to finish. The marshals sympathise.";
    } else if (youWon && R.finished) {
      line =
        "You take the heat off " +
        pc.name +
        " by " +
        (R.finishT - P.finishT).toFixed(1) +
        "s.";
    } else if (youWon) {
      line = pc.name + " retires — the heat is yours.";
    } else {
      line =
        pc.name + " takes it by " + (P.finishT - R.finishT).toFixed(1) + "s.";
    }
    $("resLine").textContent = line;

    const body = $("lapBody");
    body.textContent = "";
    const rows = Math.max(P.laps.length, R.laps.length);
    for (let i = 0; i < rows; i++) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = String(i + 1);
      const td2 = document.createElement("td");
      td2.textContent = P.laps[i] ? fmt(P.laps[i]) : "—";
      if (P.laps[i] === P.best) td2.style.fontWeight = "700";
      const td3 = document.createElement("td");
      td3.textContent = R.laps[i] ? fmt(R.laps[i]) : "—";
      tr.append(td1, td2, td3);
      body.append(tr);
    }

    $("recordLine").textContent = hallRecord
      ? "Hall board: fastest lap " +
        fmt(hallRecord.ms) +
        " — " +
        hallRecord.holder +
        ", " +
        hallRecord.day +
        "."
      : "The club board is blank. For now.";

    veil.classList.remove("hidden");
    panels.menu.classList.add("hidden");
    panels.pause.classList.add("hidden");
    panels.result.classList.remove("hidden");
    jingle(youWon);
  }

  /* ---------------- car physics ---------------- */

  function deslot(c) {
    c.spin = 1;
    c.spinT = 0;
    c.slide = 0;
    burst(c);
    if (c === P) {
      const cries = [
        "Deslotted! Marshal coming…",
        "Off the slot — sit tight!",
        "Too much trigger! Spin!",
      ];
      say(cries[(Math.random() * cries.length) | 0], 2000);
      thunk();
    }
  }

  function updateCar(c, thr, brk, dt) {
    const spinning = c.spin > 0;

    if (spinning) {
      c.spinT += dt;
      if (c.spin === 1) {
        c.v *= Math.pow(0.002, dt);
        c.slide = Math.min(1, c.spinT / 0.5);
        if (c.spinT >= 0.85) {
          c.spin = 2;
          c.spinT = 0;
        }
      } else if (c.spin === 2 && c.spinT >= 0.6) {
        c.spin = 0;
        c.slip = 0;
        c.slide = 0;
        c.v = 0;
      }
    } else {
      const vc = VC[idxOf(c.s)];
      let a = 0;
      if (brk) {
        a -= BRAKE_D;
      } else {
        if (thr) a += ENG_A * (1 - (c.v / ENG_VT) * (c.v / ENG_VT));
        a -= COAST_A + COAST_Q * c.v * c.v;
      }
      c.v = Math.max(0, c.v + a * dt);

      const excess = c.v - vc * 0.99;
      if (excess > 0) {
        const e = excess / 65;
        c.slip += e * e * SLIP_GROW * dt;
      } else {
        c.slip = Math.max(0, c.slip - SLIP_DECAY * dt);
      }
      if (c.slip < 1) {
        // fall through to the advance below
      } else {
        deslot(c);
      }
    }

    // every car advances and takes its lap reading, spun or not
    const moved = c.v * dt;
    const prevS = c.s;
    c.s = (c.s + moved) % L;
    c.distSince += moved;
    if (c.s < prevS) {
      if (c.distSince > 0.5 * L) lapDone(c);
      else c.lapStart = S.raceT;
      c.distSince = 0;
    }
  }

  function aiDrive(c, dt) {
    const pc = PACES[S.pace];
    const behind = progressOf(P) - progressOf(c); // >0: the human leads
    const pull =
      behind > 0
        ? clamp(behind * 0.00009, 0, 0.04)
        : clamp(behind * 0.00007, -0.03, 0);
    c.skillTarget = pc.base + pull;
    c.skill += (c.skillTarget - c.skill) * Math.min(1, dt * 1.4);

    c.nextFlub -= dt;
    if (c.nextFlub <= 0 && c.lapseT <= 0) {
      c.nextFlub = rand(6, 13);
      if (Math.random() < c.flubChance) {
        if (Math.random() < 0.5) {
          c.lapseT = rand(0.3, 0.6);
          c.lapseKind = "hot";
        } else {
          c.lapseT = rand(0.5, 1.0);
          c.lapseKind = "shy";
        }
      }
    }
    let mul = 1;
    if (c.lapseT > 0) {
      c.lapseT -= dt;
      mul = c.lapseKind === "hot" ? 1.09 : 0.78;
    }

    const la = Math.round(clamp(c.v * 0.26, 64, 260) / STEP);
    const from = idxOf(c.s);
    let cap = SAFE[from];
    for (let k = 4; k <= la; k += 4) {
      const q = SAFE[(from + k) % N];
      if (q < cap) cap = q;
    }
    const want = cap * c.skill * mul;

    let thr = false;
    let brk = false;
    if (c.v < want - 6) thr = true;
    else if (c.v > want + 14) brk = c.v > want + 30;
    updateCar(c, thr, brk, dt);
  }

  /* ---------------- particles & marks ---------------- */

  const parts = [];

  function spawnSmoke(c, dt) {
    if (Math.random() > dt * 26) return;
    const p = posAt(c.s, LANE_OFF * c.lane);
    parts.push({
      x: p.x - Math.cos(p.ang) * 16,
      y: p.y - Math.sin(p.ang) * 16,
      vx: rand(-14, 14),
      vy: rand(-22, -6),
      life: rand(0.5, 0.9),
      age: 0,
      r: rand(3, 6),
      col: "190,186,182",
    });
  }

  function burst(c) {
    const p = posAt(c.s, LANE_OFF * c.lane);
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 170);
      parts.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.3, 0.6),
        age: 0,
        r: rand(1.5, 3),
        col: "255,184,77",
      });
    }
  }

  let marksCv = null;
  let marksCtx = null;

  function clearMarks() {
    if (marksCtx) {
      marksCtx.save();
      marksCtx.setTransform(1, 0, 0, 1, 0, 0);
      marksCtx.clearRect(0, 0, marksCv.width, marksCv.height);
      marksCtx.restore();
    }
    parts.length = 0;
  }

  function bakeSkids(c) {
    if (c.slip < 0.45 || c.spin > 0) return;
    const g = marksCtx;
    if (!g) return;
    const p = posAt(c.s, LANE_OFF * c.lane);
    g.strokeStyle =
      "rgba(16,14,12," + Math.min(0.4, c.slip * 0.4).toFixed(3) + ")";
    g.lineWidth = 3.4;
    g.beginPath();
    const bx = p.x - Math.cos(p.ang) * 13;
    const by = p.y - Math.sin(p.ang) * 13;
    const ox = -Math.sin(p.ang) * 8;
    const oy = Math.cos(p.ang) * 8;
    g.moveTo(bx + ox, by + oy);
    g.lineTo(bx - Math.cos(p.ang) * 8 + ox, by - Math.sin(p.ang) * 8 + oy);
    g.moveTo(bx - ox, by - oy);
    g.lineTo(bx - Math.cos(p.ang) * 8 - ox, by - Math.sin(p.ang) * 8 - oy);
    g.stroke();
  }

  /* ---------------- rendering ---------------- */

  const view = { px: 0, staticCv: null };

  function rebuildStatic() {
    const px = view.px;
    if (px <= 0) return;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(W * px));
    cv.height = Math.max(1, Math.round(H * px));
    const g = cv.getContext("2d");
    g.scale(px, px);
    paintWorld(g);
    view.staticCv = cv;

    if (!marksCv) {
      marksCv = document.createElement("canvas");
      marksCtx = marksCv.getContext("2d");
    }
    marksCv.width = cv.width;
    marksCv.height = cv.height;
    marksCtx.setTransform(px, 0, 0, px, 0, 0);
  }

  function paintWorld(g) {
    const rng = mulberry(1961);

    // floorboards
    g.fillStyle = "#3a2c20";
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 44) {
      const shade = 0.85 + rng() * 0.3;
      g.fillStyle =
        "rgb(" +
        Math.round(58 * shade) +
        "," +
        Math.round(44 * shade) +
        "," +
        Math.round(31 * shade) +
        ")";
      g.fillRect(x, 0, 43, H);
      g.strokeStyle = "rgba(24,16,10,0.5)";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
      g.stroke();
      for (let y = rng() * 200; y < H; y += 160 + rng() * 220) {
        g.beginPath();
        g.moveTo(x + 2, y);
        g.lineTo(x + 42, y + rng() * 6 - 3);
        g.strokeStyle = "rgba(24,16,10,0.28)";
        g.stroke();
      }
    }

    // painted club sign in the infield
    g.save();
    g.translate(660, 445);
    g.rotate(-0.06);
    g.textAlign = "center";
    g.fillStyle = "rgba(217,201,168,0.16)";
    g.font = "700 46px Georgia, serif";
    g.fillText("HAIRPIN  HALL", 0, -14);
    g.font = "italic 21px Georgia, serif";
    g.fillText("model racing club — est. 1961 — fridays seven o'clock", 0, 26);
    g.restore();

    // trestle tables under the track
    g.save();
    g.shadowColor = "rgba(0,0,0,0.4)";
    g.shadowBlur = 26;
    g.shadowOffsetY = 14;
    rr(g, 66, 108, W - 132, H - 176, 26);
    g.fillStyle = "#57402c";
    g.fill();
    g.restore();
    rr(g, 66, 108, W - 132, H - 176, 26);
    g.strokeStyle = "#2e2015";
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = "rgba(40,27,17,0.5)";
    g.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const yy = 108 + ((H - 176) / 5) * i;
      g.beginPath();
      g.moveTo(80, yy);
      g.bezierCurveTo(W * 0.3, yy + 8, W * 0.7, yy - 8, W - 80, yy);
      g.stroke();
    }

    // chairs around the hall
    const chairs = [
      [52, 64],
      [128, 46],
      [1190, 58],
      [1236, 150],
      [1244, 430],
      [1226, 764],
      [1096, 788],
      [688, 792],
      [296, 788],
      [58, 748],
      [36, 480],
      [40, 236],
    ];
    for (const ch of chairs) {
      g.save();
      g.translate(ch[0], ch[1]);
      g.rotate(rng() * TAU);
      g.fillStyle = "#221912";
      rr(g, -13, -9, 26, 18, 4);
      g.fill();
      g.fillRect(-13, -17, 26, 6);
      g.fillStyle = "#160f0a";
      g.fillRect(-11, 8, 4, 6);
      g.fillRect(7, 8, 4, 6);
      g.restore();
    }

    // bunting across the top corners
    const flagCols = ["#c8452f", "#d9a441", "#5b7d8a", "#6b8f5a"];
    const strand = (x0, y0, cx, cy, x1, y1) => {
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(cx, cy, x1, y1);
      g.strokeStyle = "rgba(30,22,16,0.85)";
      g.lineWidth = 2.4;
      g.stroke();
      for (let i = 1; i < 13; i++) {
        const t = i / 13;
        const bx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
        const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
        g.fillStyle = flagCols[i % flagCols.length];
        g.beginPath();
        g.moveTo(bx - 8, by);
        g.lineTo(bx + 8, by);
        g.lineTo(bx, by + 17);
        g.closePath();
        g.fill();
      }
    };
    strand(-10, 26, 200, 128, 400, 66);
    strand(880, 62, 1080, 130, 1290, 22);

    // ---- the track itself ----
    const path = () => {
      g.beginPath();
      g.moveTo(PTS[0][0], PTS[0][1]);
      for (let i = 1; i < N; i++) g.lineTo(PTS[i][0], PTS[i][1]);
      g.closePath();
    };
    g.lineJoin = "round";
    g.lineCap = "round";
    path();
    g.strokeStyle = "#15141b";
    g.lineWidth = TRACK_HALF * 2 + 10;
    g.stroke();
    path();
    g.strokeStyle = "#2c2b36";
    g.lineWidth = TRACK_HALF * 2;
    g.stroke();

    // rubbered racing line
    path();
    g.strokeStyle = "rgba(12,11,15,0.22)";
    g.lineWidth = 22;
    g.stroke();

    // faint centre dashes
    g.setLineDash([13, 21]);
    path();
    g.strokeStyle = "rgba(232,220,200,0.13)";
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);

    // the two slots
    for (const lane of [-1, 1]) {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const q = PTS[i % N];
        const nx = -Math.sin(TH[i % N]) * lane * LANE_OFF;
        const ny = Math.cos(TH[i % N]) * lane * LANE_OFF;
        if (i === 0) g.moveTo(q[0] + nx, q[1] + ny);
        else g.lineTo(q[0] + nx, q[1] + ny);
      }
      g.strokeStyle = "#101018";
      g.lineWidth = 3.4;
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.06)";
      g.lineWidth = 1;
      g.stroke();
    }

    // kerbs where it turns hard
    for (let i = 0; i < N; i += 4) {
      if (KAP[i] < 1 / 240) continue;
      for (const side of [-1, 1]) {
        const q = PTS[i];
        const nx = -Math.sin(TH[i]) * side * (TRACK_HALF - 5);
        const ny = Math.cos(TH[i]) * side * (TRACK_HALF - 5);
        g.fillStyle = (i / 4) % 2 === 0 ? "#c8452f" : "#e8dcc8";
        g.beginPath();
        g.arc(q[0] + nx, q[1] + ny, 4.4, 0, TAU);
        g.fill();
      }
    }

    // start / finish checker
    {
      const q0 = posAt(0, 0);
      g.save();
      g.translate(q0.x, q0.y);
      g.rotate(q0.ang);
      const cols = 8;
      const cw = (TRACK_HALF * 2) / cols;
      for (let rI = 0; rI < 2; rI++)
        for (let cI = 0; cI < cols; cI++) {
          g.fillStyle = (rI + cI) % 2 === 0 ? "#efe6cf" : "#191720";
          g.fillRect(-cw + rI * cw, -TRACK_HALF + cI * cw, cw, cw);
        }
      g.restore();
    }

    // gantry posts & bar
    {
      const q0 = posAt(0, 0);
      for (const side of [-1, 1]) {
        const gx = q0.x + q0.nx * side * (TRACK_HALF + 16);
        const gy = q0.y + q0.ny * side * (TRACK_HALF + 16);
        g.fillStyle = "#241a12";
        g.beginPath();
        g.arc(gx, gy, 6.5, 0, TAU);
        g.fill();
      }
      g.strokeStyle = "#241a12";
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(
        q0.x + q0.nx * -(TRACK_HALF + 16),
        q0.y + q0.ny * -(TRACK_HALF + 16),
      );
      g.lineTo(
        q0.x + q0.nx * (TRACK_HALF + 16),
        q0.y + q0.ny * (TRACK_HALF + 16),
      );
      g.stroke();
    }
  }

  function drawCar(g, c) {
    const p = posAt(c.s, LANE_OFF * c.lane);
    let rot = 0;
    let slide = 0;
    if (c.spin === 1) {
      rot = c.spinT * 11;
      slide = c.slide * 52 * c.lane;
    } else if (c.spin === 2) {
      slide = 52 * c.lane;
    }
    const wob =
      c.spin === 0 ? Math.sin(performance.now() * 0.03) * c.slip * 0.22 : 0;

    g.save();
    g.translate(p.x, p.y);
    g.save();
    g.rotate(p.ang);
    g.fillStyle = "rgba(0,0,0,0.34)";
    g.beginPath();
    g.ellipse(2, 5, 21, 12, 0, 0, TAU);
    g.fill();
    g.restore();

    g.translate(p.nx * slide, p.ny * slide);
    g.rotate(p.ang + rot + wob);

    g.fillStyle = "#141218";
    for (const wx of [-12, 12])
      for (const wy of [-11, 11]) g.fillRect(wx - 5, wy - 2.8, 10, 5.6);
    g.fillStyle = c.col;
    rr(g, -18, -10, 37, 20, 7);
    g.fill();
    g.beginPath();
    g.moveTo(19, -8);
    g.lineTo(25, 0);
    g.lineTo(19, 8);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(-22, -11, 6, 22); // rear wing
    g.fillStyle = c.stripe;
    g.fillRect(-18, -2.6, 37, 5.2);
    g.fillStyle = "#1d1b22";
    g.beginPath();
    g.arc(1, 0, 5, 0, TAU);
    g.fill();
    g.fillStyle = c.ai ? "#e8dcc8" : "#ffd98a";
    g.beginPath();
    g.arc(1, 0, 2.4, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawGauge(g) {
    const cx = 352;
    const cy = 772;
    const rad = 40;
    g.save();
    g.fillStyle = "#efe4cc";
    g.strokeStyle = "#241a12";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, rad, 0, TAU);
    g.fill();
    g.stroke();

    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    g.strokeStyle = "#b0392b";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, rad - 8, a0 + (a1 - a0) * 0.82, a1);
    g.stroke();

    g.strokeStyle = "#241a12";
    g.fillStyle = "#241a12";
    for (let i = 0; i <= 8; i++) {
      const a = a0 + ((a1 - a0) * i) / 8;
      const inner = i % 2 === 0 ? rad - 12 : rad - 8;
      g.lineWidth = i % 2 === 0 ? 2.4 : 1.3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * (rad - 5), cy + Math.sin(a) * (rad - 5));
      g.stroke();
    }

    const frac = clamp(P.v / ENG_VT, 0, 1);
    const na = a0 + (a1 - a0) * frac;
    g.strokeStyle = "#7a2c1e";
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(cx - Math.cos(na) * 6, cy - Math.sin(na) * 6);
    g.lineTo(cx + Math.cos(na) * (rad - 13), cy + Math.sin(na) * (rad - 13));
    g.stroke();
    g.fillStyle = "#241a12";
    g.beginPath();
    g.arc(cx, cy, 4, 0, TAU);
    g.fill();

    g.font = "700 9px Georgia, serif";
    g.textAlign = "center";
    g.fillText("AMPERES", cx, cy + 22);

    g.font = "italic 11px Georgia, serif";
    g.fillStyle = "rgba(243,231,207,0.85)";
    g.textAlign = "left";
    g.fillText("hold = power", cx + rad + 12, cy - 4);
    g.fillText("red = asking for it", cx + rad + 12, cy + 12);
    g.restore();
  }

  function drawLights(g) {
    if (S.mode !== "countdown" && S.goFlash <= 0) return;
    const q0 = posAt(0, 0);
    const lit = Math.min(3, Math.max(0, Math.ceil(S.cd - 0.2)));
    const go = S.mode !== "countdown";
    for (let i = -1; i <= 1; i++) {
      const lx = q0.x + q0.nx * i * 22;
      const ly = q0.y + q0.ny * i * 22;
      g.beginPath();
      g.arc(lx, ly, 8, 0, TAU);
      g.fillStyle = go ? "#59d16b" : i + 1 <= lit ? "#e74c3c" : "#3a3340";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#241a12";
      g.stroke();
    }
    if (!go && S.cd > 0.2) {
      const num = String(Math.max(1, 3 - Math.floor(S.cd - 0.2)));
      const fracPart = (S.cd - 0.2) % 1;
      g.save();
      g.translate(W / 2, H / 2 - 30);
      const pop = 1 + (1 - fracPart) * 0.18;
      g.scale(pop, pop);
      g.font = "700 120px Georgia, serif";
      g.textAlign = "center";
      g.fillStyle = "rgba(243,231,207," + (0.35 + fracPart * 0.5) + ")";
      g.fillText(num, 0, 40);
      g.restore();
    } else if (go) {
      g.save();
      g.font = "700 96px Georgia, serif";
      g.textAlign = "center";
      g.fillStyle = "rgba(89,209,107," + clamp(S.goFlash / 0.7, 0, 1) + ")";
      g.fillText("GO!", W / 2, H / 2 + 20);
      g.restore();
    }
  }

  function renderFrame(dtStep) {
    const px = view.px;
    if (px <= 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(view.staticCv, 0, 0);
    ctx.drawImage(marksCv, 0, 0);
    ctx.setTransform(px, 0, 0, px, 0, 0);

    const step = dtStep || 0.016;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.age += step;
      if (p.age >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      const a = 1 - p.age / p.life;
      ctx.fillStyle = "rgba(" + p.col + "," + (a * 0.7).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + (1 - a) * 1.6), 0, TAU);
      ctx.fill();
    }

    drawCar(ctx, R);
    drawCar(ctx, P);
    drawLights(ctx);
    if (S.mode !== "menu") drawGauge(ctx);

    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.36,
      W / 2,
      H / 2,
      H * 0.78,
    );
    vg.addColorStop(0, "rgba(8,6,4,0)");
    vg.addColorStop(1, "rgba(8,6,4,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function resize() {
    const cssW = canvas.clientWidth || W;
    const px = Math.min(window.devicePixelRatio || 1, 2) * (cssW / W);
    view.px = px;
    const w = Math.round(W * px);
    const h = Math.round(H * px);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    rebuildStatic();
  }

  window.addEventListener("resize", resize);

  /* ---------------- hud ---------------- */

  const hudCache = {};
  function put(el, txt) {
    if (hudCache[el.id] !== txt) {
      hudCache[el.id] = txt;
      el.textContent = txt;
    }
  }

  function hud() {
    if (S.mode === "menu") {
      put(cells.lap, "–");
      put(cells.pos, "–");
      put(cells.cur, "–");
      put(cells.best, "–");
      put(cells.gap, "–");
      cells.gap.className = "";
      return;
    }
    const shown = Math.min(
      LAPS,
      Math.max(1, P.lapsDone + (P.finished ? 0 : 1)),
    );
    put(cells.lap, shown + "/" + LAPS);

    let posTxt = "–";
    if (P.finished || R.finished) {
      posTxt =
        P.finished && (!R.finished || P.finishT <= R.finishT) ? "1st" : "2nd";
    } else if (S.mode === "race") {
      posTxt = progressOf(P) >= progressOf(R) ? "1st" : "2nd";
    }
    put(cells.pos, posTxt);

    put(
      cells.cur,
      S.mode === "race" && !P.finished ? fmt(S.raceT - P.lapStart) : "–",
    );
    put(cells.best, isFinite(P.best) ? fmt(P.best) : "–");

    let gapTxt = "–";
    cells.gap.className = "";
    if (S.mode === "race" && !P.finished && !R.finished) {
      const dp = progressOf(P) - progressOf(R);
      const ref = Math.max(Math.min(P.v, R.v), 150);
      const sec = Math.abs(dp) / ref;
      if (dp >= 0) {
        gapTxt = "+" + sec.toFixed(1) + "s";
        cells.gap.className = "ahead";
      } else {
        gapTxt = "−" + sec.toFixed(1) + "s";
        cells.gap.className = "behind";
      }
    }
    put(cells.gap, gapTxt);
  }

  /* ---------------- main tick ---------------- */

  function tick(dt) {
    if (S.mode === "countdown") {
      const before = S.cd;
      S.cd += dt;
      for (const mark of [0.2, 1.2, 2.2])
        if (before < mark && S.cd >= mark) beep(440, 0.12, "square", 0.14);
      if (S.cd >= 3.2) {
        S.mode = "race";
        S.goFlash = 0.7;
        beep(880, 0.4, "square", 0.16);
        for (const c of [P, R]) c.lapStart = 0;
      }
      return;
    }
    if (S.goFlash > 0) S.goFlash -= dt;

    if (S.mode !== "race" && S.mode !== "results") return;

    if (S.mode === "race") S.raceT += dt;

    const pThr = input.thr && !P.finished;
    const pBrk = input.brk && !P.finished;
    updateCar(P, pThr, pBrk, dt);
    if (!R.finished) aiDrive(R, dt);
    else updateCar(R, false, false, dt);

    setMotor(
      motorP,
      clamp(P.v / ENG_VT, 0, 1),
      S.mode === "race" && P.spin === 0,
    );
    setMotor(
      motorR,
      clamp(R.v / ENG_VT, 0, 1),
      S.mode === "race" && R.spin === 0,
    );
    setSkid(
      S.mode === "race" && P.spin === 0 ? clamp(P.slip - 0.25, 0, 1) * 0.22 : 0,
    );

    if (S.mode === "race") {
      bakeSkids(P);
      if (P.slip > 0.5 || P.spin > 0) spawnSmoke(P, dt);
      if (R.slip > 0.55) spawnSmoke(R, dt);
      if (P.finished && (R.finished || S.raceT - P.finishT > 6)) finishRace();
    }
  }

  /* ---------------- boot & loop ---------------- */

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (S.mode === "race" || S.mode === "countdown"))
      setPause(true);
  });

  resize();
  hud();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (!S.paused) tick(dt);
    renderFrame(dt);
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* test hook (harmless in play) */
  window.__hairpin = {
    mode: () => S.mode,
    info: () => ({
      mode: S.mode,
      pace: S.pace,
      lap: P.lapsDone,
      v: Math.round(P.v),
      slip: +P.slip.toFixed(2),
      spin: P.spin,
      rivalLap: R.lapsDone,
      finished: P.finished,
      rivalFinished: R.finished,
      best: isFinite(P.best) ? +P.best.toFixed(2) : null,
      trackLen: Math.round(L),
      samples: N,
    }),
    start: (pace) => startHeat(pace || "colonel"),
    hold: (on) => {
      keyThr.on = !!on;
      syncInput();
    },
    brake: (on) => {
      keyBrk.on = !!on;
      syncInput();
    },
    step: (sec) => {
      let n = Math.ceil(sec / 0.033);
      while (n-- > 0) tick(0.033);
      renderFrame(0.033);
      hud();
    },
  };
})();
