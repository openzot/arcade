/* Chartwright — glimpse a fog-bound island, then redraw its coastline from
   memory. Ink is scored by how much of the true landmass your chart holds.
   All behaviour lives here; the page stays markup-only. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ dom */
  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const ui = {
    chartNo: $("chartNo"),
    quills: $("quills"),
    score: $("score"),
    status: $("status"),
    commit: $("commitBtn"),
    undo: $("undoBtn"),
    clear: $("clearBtn"),
    sound: $("soundBtn"),
    pause: $("pauseBtn"),
    restart: $("restartBtn"),
    veil: $("veil"),
    panelStart: $("panelStart"),
    panelEnd: $("panelEnd"),
    start: $("startBtn"),
    again: $("againBtn"),
    endTitle: $("endTitle"),
    endLede: $("endLede"),
    endStats: $("endStats"),
    endRank: $("endRank"),
    pauseTag: $("pauseTag"),
  };

  /* ------------------------------------------------------------ constants */
  const W = canvas.width;
  const H = canvas.height;
  const PAPER = { x: 64, y: 44, w: 832, h: 512 };
  const TAU = Math.PI * 2;

  const ROUNDS = [
    { lobes: 6, glimpse: 5.2, draw: 14 },
    { lobes: 7, glimpse: 4.5, draw: 13 },
    { lobes: 8, glimpse: 3.9, draw: 12 },
    { lobes: 9, glimpse: 3.3, draw: 11 },
    { lobes: 10, glimpse: 2.8, draw: 10 },
    { lobes: 11, glimpse: 2.4, draw: 9 },
  ];
  const QUOTA = [46, 48, 50, 52, 54, 56];
  const GRADE = [
    { min: 80, word: "TRUE CHART", hue: "#2f6f4f" },
    { min: 65, word: "FINE CHART", hue: "#3f6b5e" },
    { min: 0, word: "FAIR CHART", hue: "#8a6d3b" },
  ];

  const COL = {
    desk: "#241c13",
    deskHi: "#3a2d1e",
    paper: "#eadfc4",
    paperDim: "#dccda6",
    paperEdge: "#c3b184",
    ink: "#2f2a22",
    inkSoft: "rgba(47, 42, 34, 0.55)",
    sea: "#27494f",
    wax: "#9c3a2b",
    brass: "#a5813f",
    cream: "#f2ead6",
    fog: "rgba(224, 226, 222, 1)",
  };

  /* -------------------------------------------------------------- helpers */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
  const roman = (i) => ROMAN[i] || String(i + 1);

  /* ---------------------------------------------------------------- audio */
  let ac = null;
  let master = null;
  let scratchGain = null;
  let muted = false;

  function ensureAudio() {
    if (ac) {
      if (ac.state === "suspended") ac.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ac.destination);

    // pen scratch: looped noise through a bandpass, level driven by pen speed
    const len = ac.sampleRate;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const band = ac.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2100;
    band.Q.value = 0.9;
    scratchGain = ac.createGain();
    scratchGain.gain.value = 0;
    src.connect(band).connect(scratchGain).connect(master);
    src.start();
  }

  function blip(freq, dur, type, vol, delay) {
    if (!ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function sfxStart() {
    blip(392, 0.35, "triangle", 0.14);
    blip(523.25, 0.5, "triangle", 0.12, 0.12);
  }
  function sfxFog() {
    blip(233.08, 0.6, "sine", 0.1);
    blip(155.56, 0.8, "sine", 0.08, 0.1);
  }
  function sfxPass() {
    blip(523.25, 0.16, "triangle", 0.12);
    blip(659.25, 0.16, "triangle", 0.12, 0.1);
    blip(783.99, 0.3, "triangle", 0.12, 0.2);
  }
  function sfxTrue() {
    blip(523.25, 0.14, "triangle", 0.12);
    blip(659.25, 0.14, "triangle", 0.12, 0.09);
    blip(783.99, 0.14, "triangle", 0.12, 0.18);
    blip(1046.5, 0.4, "triangle", 0.12, 0.27);
  }
  function sfxFail() {
    blip(146.83, 0.5, "sawtooth", 0.07);
    blip(98, 0.7, "sine", 0.1, 0.08);
  }
  function sfxStamp() {
    blip(90, 0.12, "sine", 0.22);
    blip(60, 0.18, "sine", 0.16, 0.02);
  }
  function sfxTick() {
    blip(880, 0.05, "square", 0.03);
  }
  function setScratch(level) {
    if (!scratchGain) return;
    scratchGain.gain.setTargetAtTime(level, ac.currentTime, 0.06);
  }

  /* ---------------------------------------------------------------- state */
  const S = {
    mode: "title", // title | intro | glimpse | fog | draw | reveal | end
    t: 0,
    dur: 0,
    paused: false,
    round: 0,
    quills: 3,
    score: 0,
    island: null, // { pts: [{x,y}] }
    strokes: [], // finished strokes: [{ x, y, w }]
    cur: null, // stroke in progress
    fidelity: 0,
    grade: null,
    passed: false,
    blank: false,
    stats: { sum: 0, best: 0, landed: 0 },
    attract: null, // island for the title / end backdrop
    lastTick: 0,
  };

  const fog = [];
  for (let i = 0; i < 16; i++) {
    fog.push({
      x: rand(-100, W + 100),
      y: rand(-60, H + 60),
      r: rand(70, 170),
      vx: rand(6, 26) * (Math.random() < 0.5 ? -1 : 1),
      vy: rand(-7, 7),
      ph: rand(0, TAU),
    });
  }

  function setPhase(mode, dur) {
    S.mode = mode;
    S.t = 0;
    S.dur = dur || 0;
    syncButtons();
    syncStatus();
  }

  /* ------------------------------------------------------ island creation */
  function makeIsland(round) {
    const cfg = ROUNDS[round];
    const n = cfg.lobes;
    const base = Math.min(PAPER.w, PAPER.h) * (0.3 + rand(-0.02, 0.04));
    let r = base * rand(0.8, 1.05);
    const radii = [];
    for (let i = 0; i < n; i++) {
      r += rand(-0.42, 0.42) * base;
      r = clamp(r, base * 0.5, base * 1.45);
      radii.push(r);
    }
    const raw = [];
    const STEPS = 288;
    for (let s = 0; s < STEPS; s++) {
      const t = (s / STEPS) * TAU;
      const f = (s / STEPS) * n;
      const i0 = Math.floor(f) % n;
      const fr = f - Math.floor(f);
      const m = (1 - Math.cos(fr * Math.PI)) / 2;
      const rad = radii[i0] * (1 - m) + radii[(i0 + 1) % n] * m;
      raw.push({ x: Math.cos(t) * rad, y: Math.sin(t) * rad * 0.8 });
    }
    // fit the island inside the vellum with a comfortable margin
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (const p of raw) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const margin = 30;
    const s = Math.min(
      1,
      (PAPER.w - margin * 2) / (maxX - minX),
      (PAPER.h - margin * 2) / (maxY - minY),
    );
    const cx = PAPER.x + PAPER.w / 2 + rand(-36, 36);
    const cy = PAPER.y + PAPER.h / 2 + rand(-24, 24);
    const pts = raw.map((p) => ({
      x: cx + (p.x - (minX + maxX) / 2) * s,
      y: cy + (p.y - (minY + maxY) / 2) * s,
    }));
    return { pts };
  }

  /* ------------------------------------------------------ fidelity scoring */
  const RASTER = 240;
  const RH = Math.round((RASTER * PAPER.h) / PAPER.w);
  const rCan = document.createElement("canvas");
  rCan.width = RASTER;
  rCan.height = RH;
  const rctx = rCan.getContext("2d", { willReadFrequently: true });
  const KX = RASTER / PAPER.w;
  const KY = RH / PAPER.h;

  function maskOf(paint) {
    rctx.clearRect(0, 0, RASTER, RH);
    rctx.fillStyle = "#fff";
    paint(rctx);
    const d = rctx.getImageData(0, 0, RASTER, RH).data;
    const m = new Uint8Array(RASTER * RH);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return m;
  }

  function tracePath(c, pts) {
    c.beginPath();
    c.moveTo((pts[0].x - PAPER.x) * KX, (pts[0].y - PAPER.y) * KY);
    for (let i = 1; i < pts.length; i++) {
      c.lineTo((pts[i].x - PAPER.x) * KX, (pts[i].y - PAPER.y) * KY);
    }
    c.closePath();
  }

  function fidelityOf(strokes) {
    const truth = maskOf((c) => {
      tracePath(c, S.island.pts);
      c.fill();
    });

    const user = maskOf((c) => {
      for (const st of strokes) {
        tracePath(c, st);
        c.fill();
      }
    });
    let tp = 0;
    let fp = 0;
    let inked = 0;
    for (let i = 0; i < user.length; i++) {
      if (user[i]) {
        inked++;
        if (truth[i]) tp++;
        else fp++;
      }
    }
    let fn = 0;
    for (let i = 0; i < truth.length; i++) if (truth[i] && !user[i]) fn++;
    const blank = inked < 40;
    const f1 = tp + fp + fn === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
    return { fid: Math.round(f1 * 100), blank };
  }

  /* ------------------------------------------------------------- game flow */
  function startGame() {
    S.round = 0;
    S.quills = 3;
    S.score = 0;
    S.stats = { sum: 0, best: 0, landed: 0 };
    setPaused(false);
    ui.veil.classList.add("hidden");
    ui.panelStart.classList.add("hidden");
    ui.panelEnd.classList.add("hidden");
    ensureAudio();
    startRound();
  }

  function startRound() {
    S.island = makeIsland(S.round);
    S.strokes = [];
    S.cur = null;
    syncHud();
    setPhase("intro", 1.7);
  }

  function commitChart() {
    if (S.mode !== "draw") return;
    const res = fidelityOf(S.strokes);
    S.fidelity = res.fid;
    S.blank = res.blank;
    const quota = QUOTA[S.round];
    S.passed = !res.blank && res.fid >= quota;
    S.grade = res.blank
      ? { word: "BLANK VELLUM", hue: COL.wax }
      : res.fid < quota
        ? { word: "LOST CHART", hue: COL.wax }
        : GRADE.find((g) => res.fid >= g.min);
    S.score += res.blank ? 0 : res.fid;
    S.stats.sum += res.blank ? 0 : res.fid;
    if (!res.blank && res.fid > S.stats.best) S.stats.best = res.fid;
    if (S.passed) S.stats.landed++;
    else S.quills--;
    syncHud();
    sfxStamp();
    if (S.passed) {
      if (S.fidelity >= 80) sfxTrue();
      else sfxPass();
    } else {
      sfxFail();
    }
    setPhase("reveal", 3.6);
  }

  function afterReveal() {
    if (S.quills <= 0) {
      endGame(false);
    } else if (S.round + 1 >= ROUNDS.length) {
      endGame(true);
    } else {
      S.round++;
      startRound();
    }
  }

  function endGame(won) {
    const avg = Math.round(S.stats.sum / ROUNDS.length);

    let rank = "Lost a good pen";
    if (avg >= 80) rank = "Master Chartwright";
    else if (avg >= 68) rank = "Sailing Master";
    else if (avg >= 55) rank = "Ship's Chartwright";
    else if (avg >= 40) rank = "Able Seaman";
    ui.endTitle.textContent = won ? "Landfall!" : "Lost in the fog";
    ui.endLede.textContent = won
      ? "The fleet threads the last channel on your six charts and drops anchor by noon."
      : "The quills are spent and the coasts stay guesses. The fleet turns back for repairs.";
    ui.endStats.innerHTML = "";
    const rows = [
      [
        "voyage",
        won ? "survived all six charts" : "ended at chart " + roman(S.round),
      ],
      ["charts landed", S.stats.landed + " of " + ROUNDS.length],
      ["total score", S.score + " pts"],
      ["average fidelity", avg + "%"],
      ["finest chart", S.stats.best + "%"],
    ];
    for (const [k, v] of rows) {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = k;
      li.appendChild(b);
      li.appendChild(document.createTextNode(v));
      ui.endStats.appendChild(li);
    }
    ui.endRank.textContent = "rank — " + rank;
    ui.panelEnd.classList.remove("hidden");
    ui.veil.classList.remove("hidden");
    setPhase("end", 0);
  }

  /* ----------------------------------------------------------------- hud */
  function syncHud() {
    const inRun = S.mode !== "title" && S.mode !== "end";
    ui.chartNo.textContent = inRun
      ? "chart " + roman(S.round) + " of " + roman(ROUNDS.length - 1)
      : "chart —";
    let hearts = "";
    for (let i = 0; i < 3; i++) hearts += i < S.quills ? "\u25CF" : "\u25CB";
    ui.quills.textContent = "quills " + hearts;
    ui.score.textContent = S.score + " pts";
  }

  function syncStatus() {
    const q = QUOTA[S.round];
    switch (S.mode) {
      case "title":
        ui.status.textContent = "the fleet waits";
        break;
      case "intro":
        ui.status.textContent =
          "chart " + roman(S.round) + " of VI — quota " + q + "% fidelity";
        break;
      case "glimpse":
        ui.status.textContent = "memorise the coast!";
        break;
      case "fog":
        ui.status.textContent = "the fog takes it back…";
        break;
      case "draw":
        ui.status.textContent =
          "draw what you saw — Z undo, C clear, Space commits";
        break;
      case "reveal":
        ui.status.textContent = S.passed
          ? "fidelity " + S.fidelity + "% — the pilot approves"
          : S.blank
            ? "the vellum stayed blank — a chart is owed"
            : "fidelity " + S.fidelity + "% — below the " + q + "% quota";
        break;
      case "end":
        ui.status.textContent = "voyage over";
        break;
    }
  }

  function syncButtons() {
    const drawing = S.mode === "draw";
    ui.commit.disabled = !drawing;
    ui.undo.disabled = !drawing || S.strokes.length === 0;
    ui.clear.disabled = !drawing || (S.strokes.length === 0 && !S.cur);
    syncHud();
  }

  /* ---------------------------------------------------------------- input */
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * W) / rect.width,
      y: ((e.clientY - rect.top) * H) / rect.height,
    };
  }

  let lastPt = null;
  let lastT = 0;

  canvas.addEventListener("pointerdown", (e) => {
    if (S.mode !== "draw") return;
    e.preventDefault();
    ensureAudio();
    canvas.setPointerCapture(e.pointerId);
    const p = canvasPoint(e);
    S.cur = { pts: [{ x: p.x, y: p.y, w: 6.5 }], len: 0 };
    lastPt = p;
    lastT = performance.now();
    syncButtons();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!S.cur) return;
    const p = canvasPoint(e);
    const dx = p.x - lastPt.x;
    const dy = p.y - lastPt.y;
    const d = Math.hypot(dx, dy);
    if (d < 2.5) return;
    const now = performance.now();
    const speed = d / Math.max(8, now - lastT); // px per ms
    const w = clamp(9.5 - speed * 3.4, 2.4, 9.5);
    S.cur.pts.push({ x: p.x, y: p.y, w });
    S.cur.len += d;
    lastPt = p;
    lastT = now;
    setScratch(clamp(speed / 1.6, 0, 0.09));
  });

  function endStroke() {
    if (!S.cur) return;
    setScratch(0);
    if (S.cur.pts.length >= 4 && S.cur.len >= 28) {
      S.strokes.push(S.cur.pts);
    }
    S.cur = null;
    syncButtons();
  }

  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  ui.start.addEventListener("click", () => {
    ui.start.blur();
    startGame();
  });
  ui.again.addEventListener("click", () => {
    ui.again.blur();
    startGame();
  });
  ui.commit.addEventListener("click", () => {
    ui.commit.blur();
    commitChart();
  });
  ui.undo.addEventListener("click", () => {
    ui.undo.blur();
    if (S.mode === "draw") {
      S.strokes.pop();
      syncButtons();
    }
  });
  ui.clear.addEventListener("click", () => {
    ui.clear.blur();
    if (S.mode === "draw") {
      S.strokes = [];
      syncButtons();
    }
  });
  ui.sound.addEventListener("click", () => {
    ui.sound.blur();
    toggleMute();
  });
  ui.pause.addEventListener("click", () => {
    ui.pause.blur();
    setPaused(!S.paused);
  });
  ui.restart.addEventListener("click", () => {
    ui.restart.blur();
    startGame();
  });

  function toggleMute() {
    muted = !muted;
    ui.sound.textContent = "sound: " + (muted ? "off" : "on");
    if (master) master.gain.value = muted ? 0 : 1;
  }

  function setPaused(p) {
    if (S.mode === "title" || S.mode === "end") p = false;
    S.paused = p;
    ui.pauseTag.classList.toggle("hidden", !p);
    ui.pause.textContent = p ? "resume" : "pause";
    setScratch(0);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(true);
  });

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case "Space":
      case "Enter":
        e.preventDefault();
        primary();
        break;
      case "KeyZ":
      case "KeyU":
        if (S.mode === "draw") {
          S.strokes.pop();
          syncButtons();
        }
        break;
      case "KeyC":
        if (S.mode === "draw") {
          S.strokes = [];
          syncButtons();
        }
        break;
      case "KeyM":
        toggleMute();
        break;
      case "KeyP":
        setPaused(!S.paused);
        break;
      case "KeyR":
        startGame();
        break;
    }
  });

  function primary() {
    switch (S.mode) {
      case "title":
      case "end":
        startGame();
        break;
      case "draw":
        commitChart();
        break;
      case "reveal":
        S.t = S.dur; // skip ahead
        break;
    }
  }

  /* --------------------------------------------------------------- update */
  function update(dt) {
    for (const f of fog) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -180) f.x = W + 170;
      if (f.x > W + 180) f.x = -170;
      if (f.y < -140) f.y = H + 130;
      if (f.y > H + 140) f.y = -130;
    }
    S.t += dt;

    if (S.mode === "intro" && S.t >= S.dur) {
      setPhase("glimpse", ROUNDS[S.round].glimpse);
      sfxStart();
    } else if (S.mode === "glimpse") {
      const left = S.dur - S.t;
      if (left <= 1.2 && left + dt > 1.2) sfxTick();
      if (S.t >= S.dur) {
        setPhase("fog", 0.85);
        sfxFog();
      }
    } else if (S.mode === "fog" && S.t >= S.dur) {
      setPhase("draw", ROUNDS[S.round].draw);
    } else if (S.mode === "draw" && S.t >= S.dur) {
      endStroke();
      commitChart();
    } else if (S.mode === "reveal" && S.t >= S.dur) {
      afterReveal();
    }
  }

  /* --------------------------------------------------------------- render */
  function render() {
    drawDesk();
    drawPaper();
    const t = S.t;

    if (S.mode === "title" || S.mode === "end") {
      if (!S.attract) S.attract = makeIsland(0);
      const pulse =
        0.16 + 0.12 * (0.5 + 0.5 * Math.sin(performance.now() / 1600));
      drawIsland(S.attract.pts, {
        fill: "rgba(47, 42, 34, " + pulse.toFixed(3) + ")",
        stroke: "rgba(47, 42, 34, " + (pulse + 0.1).toFixed(3) + ")",
      });
      caption(
        "SIX ISLANDS LIE BETWEEN YOU AND LANDFALL",
        "each shows itself through the fog just once",
      );
    } else if (S.mode === "intro") {
      caption(
        "CHART " + roman(S.round) + " OF VI",
        "quota " + QUOTA[S.round] + "% fidelity",
      );
    } else if (S.mode === "glimpse") {
      drawIsland(S.island.pts, {
        fill: "rgba(47, 42, 34, 0.82)",
        stroke: COL.ink,
        width: 2.5,
      });
      drawTimerBar(S.t / S.dur, COL.sea);
      caption("MEMORISE THE COAST", (S.dur - S.t).toFixed(1) + "s of light");
    } else if (S.mode === "fog") {
      const k = Math.min(1, S.t / (S.dur * 0.6));
      drawIsland(S.island.pts, {
        fill: "rgba(47, 42, 34, " + (0.82 * (1 - k)).toFixed(3) + ")",
        stroke: "rgba(47, 42, 34, " + (1 - k).toFixed(3) + ")",
      });
      caption("THE FOG TAKES IT BACK", "hold the shape in mind");
    } else if (S.mode === "draw") {
      drawInk();
      drawInkwell(S.t / S.dur);
      caption("DRAW THE COAST FROM MEMORY", "one outline is enough");
    } else if (S.mode === "reveal") {
      drawIsland(S.island.pts, {
        fill: "rgba(39, 73, 79, 0.16)",
        stroke: "rgba(39, 73, 79, 0.75)",
        width: 2,
        dash: true,
      });
      drawInk();
      drawStamp(t);
      caption(
        "TRUE COAST GHOSTED BENEATH YOUR INK",
        S.passed ? "the pilot plots a course" : "the pilot shakes his head",
      );
    }

    drawFog();
  }

  function drawDesk() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, COL.deskHi);
    g.addColorStop(0.55, COL.desk);
    g.addColorStop(1, "#191209");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPaper() {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = COL.paper;
    ctx.fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h);
    ctx.restore();

    // graticule
    ctx.strokeStyle = "rgba(47, 42, 34, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = PAPER.x + 52; x < PAPER.x + PAPER.w; x += 52) {
      ctx.moveTo(x, PAPER.y);
      ctx.lineTo(x, PAPER.y + PAPER.h);
    }
    for (let y = PAPER.y + 52; y < PAPER.y + PAPER.h; y += 52) {
      ctx.moveTo(PAPER.x, y);
      ctx.lineTo(PAPER.x + PAPER.w, y);
    }
    ctx.stroke();

    // rhumb lines from the compass
    const cx = PAPER.x + PAPER.w - 74;
    const cy = PAPER.y + PAPER.h - 74;
    ctx.strokeStyle = "rgba(47, 42, 34, 0.05)";
    ctx.beginPath();
    for (const [tx, ty] of [
      [PAPER.x, PAPER.y],
      [PAPER.x + PAPER.w, PAPER.y],
      [PAPER.x, PAPER.y + PAPER.h],
    ]) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
    }
    ctx.stroke();

    drawCompass(cx, cy, 40, 0.28);

    // double frame
    ctx.strokeStyle = "rgba(47, 42, 34, 0.65)";
    ctx.lineWidth = 2;
    ctx.strokeRect(PAPER.x + 5, PAPER.y + 5, PAPER.w - 10, PAPER.h - 10);
    ctx.lineWidth = 0.8;
    ctx.strokeRect(PAPER.x + 11, PAPER.y + 11, PAPER.w - 22, PAPER.h - 22);

    // edge shading
    const eg = ctx.createLinearGradient(0, PAPER.y, 0, PAPER.y + PAPER.h);
    eg.addColorStop(0, "rgba(120, 96, 60, 0.18)");
    eg.addColorStop(0.12, "rgba(120, 96, 60, 0)");
    eg.addColorStop(0.9, "rgba(120, 96, 60, 0)");
    eg.addColorStop(1, "rgba(120, 96, 60, 0.22)");
    ctx.fillStyle = eg;
    ctx.fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h);
  }

  function drawCompass(x, y, r, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.ink;
    ctx.fillStyle = COL.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const long = i % 2 === 0;
      const len = long ? r * 0.92 : r * 0.78;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
      if (long) {
        ctx.save();
        ctx.translate(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
        ctx.rotate(a + Math.PI / 2);
        ctx.font = "700 " + Math.round(r * 0.22) + "px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText("NESW".charAt(i / 2), 0, r * 0.08);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function islandPath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function drawIsland(pts, opt) {
    islandPath(pts);
    if (opt.fill) {
      ctx.fillStyle = opt.fill;
      ctx.fill();
    }
    if (opt.stroke) {
      ctx.save();
      if (opt.dash) ctx.setLineDash([7, 6]);
      ctx.strokeStyle = opt.stroke;
      ctx.lineWidth = opt.width || 2;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawInk() {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = S.cur ? S.strokes.concat([S.cur.pts]) : S.strokes;
    for (const pts of all) {
      if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = COL.ink;
        ctx.lineWidth = (pts[i - 1].w + pts[i].w) / 2;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      // closing tick so the shape reads as an island, not a squiggle
      if (!S.cur || pts !== S.cur.pts) {
        const a = pts[0];
        const b = pts[pts.length - 1];
        ctx.strokeStyle = "rgba(47, 42, 34, 0.45)";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawTimerBar(k, hue) {
    const bw = PAPER.w - 40;
    const x = PAPER.x + 20;
    const y = PAPER.y + 26;
    ctx.fillStyle = "rgba(47, 42, 34, 0.15)";
    ctx.fillRect(x, y, bw, 7);
    ctx.fillStyle = hue;
    ctx.fillRect(x, y, bw * (1 - k), 7);
    ctx.strokeStyle = "rgba(47, 42, 34, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, bw, 7);
  }

  function drawInkwell(k) {
    const frac = 1 - k;
    const bw = PAPER.w - 40;
    const x = PAPER.x + 20;
    const y = PAPER.y + PAPER.h - 34;
    ctx.fillStyle = "rgba(47, 42, 34, 0.15)";
    ctx.fillRect(x, y, bw, 7);
    ctx.fillStyle = frac < 0.25 ? COL.wax : COL.ink;
    ctx.fillRect(x, y, bw * frac, 7);
    ctx.strokeStyle = "rgba(47, 42, 34, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, bw, 7);
    ctx.fillStyle = "rgba(47, 42, 34, 0.6)";
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "left";
    ctx.fillText("inkwell", x, y - 6);
    ctx.textAlign = "right";
    ctx.fillText(Math.ceil(Math.max(0, S.dur - S.t)) + "s", x + bw, y - 6);
  }

  function caption(big, small) {
    const spaced = big.split("").join(" ");
    let size = 21;
    ctx.textAlign = "center";
    for (;;) {
      ctx.font = "700 " + size + "px Georgia, serif";
      if (ctx.measureText(spaced).width <= PAPER.w - 70 || size <= 13) break;
      size -= 1;
    }
    ctx.fillStyle = "rgba(47, 42, 34, 0.78)";
    ctx.fillText(spaced, PAPER.x + PAPER.w / 2, PAPER.y + 62);
    ctx.fillStyle = "rgba(47, 42, 34, 0.55)";
    ctx.font = "italic 14px Georgia, serif";
    ctx.fillText(small, PAPER.x + PAPER.w / 2, PAPER.y + 84);
  }

  function drawStamp(t) {
    const pop = clamp(t / 0.22, 0, 1);
    const e = 1 - (1 - pop) * (1 - pop);
    const x = PAPER.x + 58;
    const y = PAPER.y + 128;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.09);
    ctx.scale(0.7 + 0.3 * e, 0.7 + 0.3 * e);
    ctx.globalAlpha = e;
    ctx.strokeStyle = S.grade.hue;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(-92, -34, 184, 68);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-86, -28, 172, 56);
    ctx.fillStyle = S.grade.hue;
    ctx.textAlign = "center";
    ctx.font = "700 21px Georgia, serif";
    ctx.fillText(S.grade.word, 0, -4);
    ctx.font = "700 26px Georgia, serif";
    ctx.fillText(S.fidelity + "%", 0, 26);
    ctx.restore();
  }

  function drawFog() {
    const base =
      S.mode === "fog"
        ? 0.85
        : S.mode === "title" || S.mode === "end"
          ? 0.4
          : S.mode === "glimpse"
            ? 0.22
            : S.mode === "intro"
              ? 0.3
              : S.mode === "reveal"
                ? 0.12
                : 0.24;
    for (const f of fog) {
      const a = base * (0.55 + 0.45 * Math.sin(S.t * 0.7 + f.ph));
      if (a <= 0.01) continue;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, COL.fog.replace("1)", a.toFixed(3)));
      g.addColorStop(1, COL.fog.replace("1)", "0)"));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ loop */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.paused && !document.hidden) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  syncButtons();
  syncStatus();
  syncHud();
})();
