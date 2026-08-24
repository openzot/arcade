/* Ring Out — a change-ringing game for New Year's Eve.
   Strike the numbered ropes on the beat; each completed row permutes the
   neighbours (plain hunt). Five candles of parish sleep. Vanilla canvas +
   Web Audio, wrapped in an IIFE, no external requests. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* DOM & canvas                                                        */
  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const overlayEl = $("overlay");
  const ovTitle = $("ov-title");
  const ovBody = $("ov-body");
  const ovList = $("ov-list");
  const ovBtn = $("ov-btn");
  const btnPause = $("btn-pause");
  const btnMute = $("btn-mute");
  const btnRestart = $("btn-restart");
  const kicker = $("kicker");

  const W = 720;
  const H = 1020;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const KICKER_NIGHT =
    "St. Aubric's tower \u00b7 31 December, four minutes to midnight";
  const KICKER_DAY =
    "St. Aubric's tower \u00b7 midnight, and the new year begun";

  /* ------------------------------------------------------------------ */
  /* Tuning                                                              */
  /* ------------------------------------------------------------------ */

  const STAGES = [
    {
      num: "ONE",
      label: "FOUR BELLS",
      flavor: "Look to. Treble's going\u2026",
      bells: 4,
      beat: 0.56,
      root: 174.61,
    },
    {
      num: "TWO",
      label: "FIVE BELLS",
      flavor: "Five bells. Quicker now.",
      bells: 5,
      beat: 0.48,
      root: 196.0,
    },
    {
      num: "THREE",
      label: "SIX BELLS",
      flavor: "Six bells. The year's last minute.",
      bells: 6,
      beat: 0.42,
      root: 220.0,
    },
  ];
  const BANNER_T = 1.5; // stage intro card, seconds
  const COUNT_BEATS = 4; // metronome count-in
  const CLEAR_T = 1.8; // pause between stages
  const START_HEARTS = 5;

  const COL = {
    nightTop: "#141b3a",
    night: "#0b1126",
    nightDeep: "#06091a",
    stone: "#3a436b",
    stoneDark: "#262e52",
    skyWin: "#0a1030",
    wood: "#4a3018",
    woodLight: "#6b4a2f",
    beamDark: "#33200f",
    parchment: "#f4e8cb",
    parchEdge: "#c9b58a",
    ink: "#241c12",
    inkSoft: "#7a6b50",
    struck: "#b39b6f",
    amber: "#ffbf5e",
    gold: "#ffd98a",
    red: "#d05545",
    grey: "#8b93ad",
    cream: "#efe4cc",
  };

  /* ------------------------------------------------------------------ */
  /* Plain hunt permutations                                             */
  /* ------------------------------------------------------------------ */

  function buildRows(n) {
    const rounds = [];
    for (let i = 1; i <= n; i++) rounds.push(i);
    const rows = [rounds.slice()];
    const cur = rounds.slice();
    for (let s = 1; s <= 2 * n; s++) {
      if (s % 2 === 1) {
        for (let p = 0; p + 1 < n; p += 2) {
          const t = cur[p];
          cur[p] = cur[p + 1];
          cur[p + 1] = t;
        }
      } else {
        for (let p = 1; p + 1 < n; p += 2) {
          const t = cur[p];
          cur[p] = cur[p + 1];
          cur[p + 1] = t;
        }
      }
      rows.push(cur.slice());
    }
    return rows; // starts and ends on rounds
  }

  function makeSchedule(stage) {
    const rows = buildRows(stage.bells);
    const B = stage.beat;
    const rowLen = (stage.bells + 1) * B; // n strike beats + one breath beat
    const starts = [];
    let t = BANNER_T + COUNT_BEATS * B;
    for (let r = 0; r < rows.length; r++) {
      starts.push(t);
      t += rowLen;
    }
    return { rows, B, rowLen, starts };
  }

  /* ------------------------------------------------------------------ */
  /* Audio (all synthesised)                                             */
  /* ------------------------------------------------------------------ */

  let actx = null;
  let master = null;

  function ensureAudio() {
    try {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = G.muted ? 0 : 0.5;
        master.connect(actx.destination);
      }
      if (actx.state === "suspended") actx.resume();
    } catch (err) {
      /* audio unavailable; the game plays silently */
    }
  }

  function tone(freq, type, peak, dur, delay) {
    if (!actx) return;
    const t0 = actx.currentTime + (delay || 0);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const SEMIS = [0, 3, 5, 7, 10, 12]; // minor pentatonic: any order sings

  function bellTone(j) {
    if (!actx) return;
    const st = STAGES[G.stageIdx];
    const f = st.root * Math.pow(2, SEMIS[j - 1] / 12);
    const partials = [
      [0.5, 0.5, 3.8],
      [1, 0.85, 2.8],
      [1.188, 0.2, 1.7],
      [1.5, 0.16, 1.25],
      [2, 0.36, 1.05],
      [2.756, 0.09, 0.7],
    ];
    const size = 0.8 + (STAGES[G.stageIdx].bells - j) * 0.06;
    for (const p of partials) {
      tone(
        f * p[0] * (1 + (Math.random() - 0.5) * 0.003),
        "sine",
        p[1] * 0.12 * size,
        p[2] * size,
        0,
      );
    }
  }

  function tickSound(accent) {
    tone(accent ? 1480 : 1180, "triangle", accent ? 0.05 : 0.035, 0.05, 0);
  }

  function clashSound() {
    tone(94, "sawtooth", 0.13, 0.5, 0);
    tone(99.5, "sawtooth", 0.11, 0.5, 0);
    tone(63, "square", 0.07, 0.65, 0);
  }

  function missSound() {
    tone(76, "sine", 0.15, 0.16, 0);
  }

  function chimeUp() {
    for (let i = 0; i < 4; i++)
      tone(520 + i * 130, "sine", 0.09, 0.5, i * 0.11);
  }

  function winTune() {
    const st = STAGES[G.stageIdx];
    for (let i = 0; i <= st.bells; i++) {
      const f =
        st.root *
        Math.pow(2, SEMIS[i % st.bells === 0 ? st.bells - 1 : i - 1] / 12);
      tone(f * 2, "sine", 0.12, 1.1, 0.25 + i * 0.14);
    }
    tone(st.root * 2, "sine", 0.1, 1.6, 0.25 + (st.bells + 1) * 0.14);
    tone(st.root * 2.5, "sine", 0.08, 1.6, 0.25 + (st.bells + 1) * 0.14);
  }

  function loseSound() {
    tone(190, "sawtooth", 0.08, 0.9, 0);
    tone(126, "sawtooth", 0.07, 1.1, 0.12);
    tone(60, "sine", 0.14, 0.5, 0);
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  const G = {
    mode: "title", // title | ringing | cleared | won | lost
    paused: false,
    muted: false,
    stageIdx: 0,
    sch: null,
    stageTime: 0,
    lastNow: 0,
    phase: "",
    rowIdx: 0,
    resolved: [],
    rowFaults: 0,
    missPtr: 0,
    lastCountBeat: -1,
    hearts: START_HEARTS,
    score: 0,
    streak: 0,
    stats: { good: 0, clash: 0, bestStreak: 0 },
    history: [],
    banners: [],
    floats: [],
    sparks: [],
    bursts: [],
    burstTimer: 0,
    pulls: [-99, -99, -99, -99, -99, -99],
    shake: 0,
    clearLeft: 0,
    best: 0,
    geo: null,
  };

  try {
    G.best = parseInt(localStorage.getItem("ring-out-best") || "0", 10) || 0;
  } catch (err) {
    G.best = 0;
  }

  function saveBest() {
    if (G.score > G.best) {
      G.best = G.score;
      try {
        localStorage.setItem("ring-out-best", String(G.best));
      } catch (err) {
        /* private mode: best simply won't persist */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Geometry                                                            */
  /* ------------------------------------------------------------------ */

  const PX = 54;
  const PY = 332;
  const PW = 612;
  const PH = 228;
  const FLOOR_Y = 952;

  function layoutFor(bells) {
    const margin = 84;
    const step = (W - margin * 2) / bells;
    const xs = [];
    for (let i = 0; i < bells; i++) xs.push(margin + step * (i + 0.5));
    return {
      bells,
      step,
      xs,
      gapL: xs[0] - 40,
      gapR: xs[bells - 1] + 40,
      cw: Math.min(96, (PW - 64) / bells),
    };
  }

  function cellX(k) {
    const n = G.sch.rows[0].length;
    return PX + PW / 2 - ((n - 1) * G.geo.cw) / 2 + k * G.geo.cw;
  }

  function ropeHit(x, y) {
    if (!G.geo) return -1;
    for (let i = 0; i < G.geo.bells; i++) {
      const gx = G.geo.xs[i];
      if (Math.abs(x - gx) < 48 && y > 740 && y < 950) return i;
    }
    return -1;
  }

  /* ------------------------------------------------------------------ */
  /* Flow                                                                */
  /* ------------------------------------------------------------------ */

  let ovAction = null;

  function showOverlay(title, body, items, btnLabel, action) {
    ovTitle.textContent = title;
    ovBody.textContent = body;
    ovList.innerHTML = "";
    if (items && items.length) {
      for (const it of items) {
        const li = document.createElement("li");
        li.innerHTML = it;
        ovList.appendChild(li);
      }
      ovList.style.display = "";
    } else {
      ovList.style.display = "none";
    }
    ovBtn.textContent = btnLabel;
    ovAction = action;
    overlayEl.classList.remove("hidden");
  }

  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }

  function banner(txt, color) {
    G.banners.push({ txt, color: color || COL.amber, t: 0, T: 1.5 });
  }

  function startStage(i) {
    G.stageIdx = i;
    G.sch = makeSchedule(STAGES[i]);
    G.geo = layoutFor(STAGES[i].bells);
    G.stageTime = 0;
    G.phase = "banner";
    G.rowIdx = 0;
    G.rowFaults = 0;
    G.missPtr = 0;
    G.resolved = new Array(STAGES[i].bells).fill(false);
    G.lastCountBeat = -1;
    G.pulls = [-99, -99, -99, -99, -99, -99];
    G.mode = "ringing";
    G.paused = false;
    syncPauseBtn();
  }

  function restartRun() {
    kicker.textContent = KICKER_NIGHT;
    G.hearts = START_HEARTS;
    G.score = 0;
    G.streak = 0;
    G.stats = { good: 0, clash: 0, bestStreak: 0 };
    G.history = [];
    G.banners = [];
    G.floats = [];
    G.sparks = [];
    G.shake = 0;
    hideOverlay();
    startStage(0);
  }

  function prepRow() {
    G.resolved = new Array(G.sch.rows[0].length).fill(false);
    G.rowFaults = 0;
    G.missPtr = 0;
  }

  function finalizeRow() {
    const row = G.sch.rows[G.rowIdx];
    G.history.push(row.join("\u2009"));
    if (G.history.length > 3) G.history.shift();
    if (G.rowFaults === 0) {
      const bonus = row.length * 15;
      G.score += bonus;
      banner("Clean row +" + bonus, COL.gold);
    }
  }

  function stageComplete() {
    if (G.stageIdx >= STAGES.length - 1) {
      doWin();
    } else {
      G.mode = "cleared";
      G.clearLeft = CLEAR_T;
      if (G.hearts < START_HEARTS) {
        G.hearts++;
        healFx(G.hearts - 1);
        banner("A candle steadies.", "#a7e3a1");
      } else {
        banner("All told! Stand your bells.", "#a7e3a1");
      }
      chimeUp();
    }
  }

  function accuracyPct() {
    const att = G.stats.good + G.stats.clash;
    return att ? Math.round((100 * G.stats.good) / att) : 100;
  }

  function doWin() {
    saveBest();
    G.mode = "won";
    kicker.textContent = KICKER_DAY;
    winTune();
    showOverlay(
      "Midnight.",
      "Rounds all round, and the year rung out. Score " +
        G.score +
        " (best " +
        G.best +
        "), " +
        accuracyPct() +
        "% clean strikes, longest run " +
        G.stats.bestStreak +
        ". Down in the village, they will say the bells were well rung.",
      null,
      "Ring in the new year",
      restartRun,
    );
  }

  function doLose() {
    saveBest();
    G.mode = "lost";
    loseSound();
    showOverlay(
      "The parish wakes.",
      "A rope went over the beat on row " +
        (G.rowIdx + 1) +
        ". Score " +
        G.score +
        ". Upstairs, a light comes on, and someone is reaching for a dressing gown.",
      null,
      "Try again",
      restartRun,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Judging                                                             */
  /* ------------------------------------------------------------------ */

  function inputTime() {
    const delta = Math.max(
      0,
      Math.min(0.06, performance.now() / 1000 - G.lastNow),
    );
    return G.stageTime + delta;
  }

  function applyResult(kind, k) {
    const row = G.sch.rows[G.rowIdx];
    G.resolved[k] = true;
    const cx = cellX(k);
    const cy = PY + 112;
    if (kind === "good") {
      const digit = row[k];
      G.streak++;
      G.stats.good++;
      if (G.streak > G.stats.bestStreak) G.stats.bestStreak = G.streak;
      const pts = 10 + Math.min(G.streak, 15);
      G.score += pts;
      G.pulls[digit - 1] = G.stageTime;
      bellTone(digit);
      goldSpark(cx, cy);
      G.floats.push({
        x: cx,
        y: cy - 34,
        txt: "+" + pts,
        col: COL.gold,
        t: 0,
        T: 0.9,
      });
    } else if (kind === "clash") {
      G.stats.clash++;
      G.rowFaults++;
      G.streak = 0;
      G.shake = 0.32;
      loseHeart();
      clashFx(cx, cy);
      clashSound();
      if (G.hearts <= 0) doLose();
    } else {
      G.rowFaults++;
      G.streak = 0;
      loseHeart();
      missFx(cx, cy);
      missSound();
      if (G.hearts <= 0) doLose();
    }
  }

  function loseHeart() {
    G.hearts--;
    if (G.hearts >= 0) candleOutFx(G.hearts);
    if (G.hearts < 3 && G.hearts > 0) banner("Careful\u2026", COL.red);
  }

  /* Time-driven bookkeeping shared by the frame loop and by judge(): resolve
     missed slots, close finished rows. A row is closed half a beat before its
     rest beat ends, so an eager pull between rows already belongs to the next
     row's first bell instead of being punished as a stray. */
  function advanceRinging(now) {
    const sch = G.sch;
    if (!sch || G.mode !== "ringing") return;
    const n = sch.rows[0].length;
    let guard = 0;
    while (G.mode === "ringing" && G.rowIdx < sch.rows.length && ++guard < 64) {
      const u = now - sch.starts[G.rowIdx];
      while (G.missPtr < n && u > G.missPtr * sch.B + sch.B * 0.5) {
        if (!G.resolved[G.missPtr]) applyResult("miss", G.missPtr);
        G.missPtr++;
        if (G.mode !== "ringing") return;
      }
      if (u >= sch.rowLen - sch.B * 0.5) {
        finalizeRow();
        G.rowIdx++;
        if (G.rowIdx < sch.rows.length) {
          prepRow();
          continue;
        }
        stageComplete();
      }
      break;
    }
  }

  function judge(digit) {
    if (G.mode !== "ringing" || G.paused) return;
    const n = G.sch.rows[0].length;
    if (digit < 1 || digit > n) return;
    const now = inputTime();
    if (now < G.sch.starts[0] - G.sch.B * 0.5) return; // still counting in
    advanceRinging(now);
    if (G.mode !== "ringing" || G.rowIdx >= G.sch.rows.length) return;
    const u = now - G.sch.starts[G.rowIdx];
    if (u < -G.sch.B * 0.5) return;
    let k = Math.round(u / G.sch.B);
    if (k < 0) k = 0;
    if (k > n - 1) k = n - 1; // pulls on the rest beat save the last bell
    if (G.resolved[k]) return;
    applyResult(G.sch.rows[G.rowIdx][k] === digit ? "good" : "clash", k);
  }

  /* ------------------------------------------------------------------ */
  /* Effects                                                             */
  /* ------------------------------------------------------------------ */

  function goldSpark(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      G.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        g: 160,
        t: 0,
        T: 0.5 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 2,
        col: COL.gold,
      });
    }
  }

  function clashFx(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 130;
      G.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: 200,
        t: 0,
        T: 0.4 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 2.5,
        col: COL.red,
      });
    }
  }

  function missFx(x, y) {
    for (let i = 0; i < 6; i++) {
      G.sparks.push({
        x: x + (Math.random() - 0.5) * 20,
        y,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 30,
        g: -20,
        t: 0,
        T: 0.6,
        size: 2 + Math.random() * 2,
        col: COL.grey,
      });
    }
  }

  function candleOutFx(idx) {
    const c = candlePos(idx);
    for (let i = 0; i < 8; i++) {
      G.sparks.push({
        x: c.x,
        y: c.y,
        vx: (Math.random() - 0.5) * 26,
        vy: -30 - Math.random() * 40,
        g: -40,
        t: 0,
        T: 0.7,
        size: 1.5 + Math.random() * 2,
        col: "#aab4d4",
      });
    }
  }

  function healFx(idx) {
    const c = candlePos(idx);
    for (let i = 0; i < 8; i++) {
      G.sparks.push({
        x: c.x + (Math.random() - 0.5) * 10,
        y: c.y,
        vx: (Math.random() - 0.5) * 20,
        vy: -40 - Math.random() * 30,
        g: 30,
        t: 0,
        T: 0.6,
        size: 1.5 + Math.random() * 2,
        col: COL.amber,
      });
    }
  }

  function candlePos(idx) {
    return { x: W - 30 - idx * 34, y: 52 };
  }

  const SNOW = [];
  for (let i = 0; i < 70; i++) {
    SNOW.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 1 + Math.random() * 2.2,
      spd: 14 + Math.random() * 30,
      ph: Math.random() * Math.PI * 2,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Update                                                              */
  /* ------------------------------------------------------------------ */

  function update(dt) {
    if (G.mode === "cleared") {
      G.clearLeft -= dt;
      if (G.clearLeft <= 0) startStage(G.stageIdx + 1);
    }
    if (G.mode !== "ringing" || G.paused) {
      stepEffects(dt, false);
      return;
    }
    G.stageTime += dt;
    const t = G.stageTime;
    const sch = G.sch;

    if (t < BANNER_T) {
      G.phase = "banner";
    } else if (t < sch.starts[0]) {
      G.phase = "countin";
      const beat = Math.floor((t - BANNER_T) / sch.B);
      if (beat > G.lastCountBeat) {
        G.lastCountBeat = beat;
        tickSound(beat === 0);
      }
    } else {
      G.phase = "rows";
      advanceRinging(t);
      if (G.mode !== "ringing") {
        stepEffects(dt, true);
        return;
      }
    }
    stepEffects(dt, true);
  }

  function stepEffects(dt, alive) {
    for (const b of G.banners) b.t += dt;
    G.banners = G.banners.filter((b) => b.t < b.T);
    for (const f of G.floats) f.t += dt;
    G.floats = G.floats.filter((f) => f.t < f.T);
    for (const s of G.sparks) {
      s.t += dt;
      s.vy += s.g * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    G.sparks = G.sparks.filter((s) => s.t < s.T);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt);
    for (const f of SNOW) {
      f.y += f.spd * dt;
      f.x += Math.sin(f.y * 0.01 + f.ph) * 12 * dt;
      if (f.y > H + 8) {
        f.y = -8;
        f.x = Math.random() * W;
      }
      if (f.x > W + 8) f.x = -8;
      if (f.x < -8) f.x = W + 8;
    }
    if (G.mode === "won") {
      G.burstTimer -= dt;
      if (G.burstTimer <= 0) {
        G.burstTimer = 0.55 + Math.random() * 0.5;
        fireworkBurst();
      }
      for (const s of G.bursts) {
        s.t += dt;
        s.vy += 60 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
      G.bursts = G.bursts.filter((s) => s.t < s.T);
    }
    void alive;
  }

  const FW_COLS = ["#ffd98a", "#ff9d5c", "#9adfff", "#ffb3c8", "#c9f2c7"];

  function fireworkBurst() {
    const side = Math.random() < 0.5;
    const cx = side ? 105 + Math.random() * 40 : 615 + Math.random() * 40;
    const cy = 150 + Math.random() * 110;
    const col = FW_COLS[Math.floor(Math.random() * FW_COLS.length)];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const sp = 50 + Math.random() * 70;
      G.bursts.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        t: 0,
        T: 0.8 + Math.random() * 0.5,
        size: 1.4 + Math.random() * 1.8,
        col,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render(rt) {
    ctx.save();
    if (G.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * G.shake * 14,
        (Math.random() - 0.5) * G.shake * 14,
      );
    }

    /* wall */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#182045");
    bg.addColorStop(0.5, COL.night);
    bg.addColorStop(1, "#080c1e");
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 2;
    for (let y = 40; y < FLOOR_Y; y += 46) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    drawWindow(44, 116, 122, 192, rt, false);
    drawWindow(W - 44 - 122, 116, 122, 192, rt, true);

    drawTower(rt);
    drawHud(rt);
    drawStageLabel();
    drawPanel(rt);
    drawRopes(rt);
    drawFloor();
    drawBanners();
    drawFloats();
    drawSparks();
    drawSnow(rt);

    ctx.restore();

    if (G.paused) {
      ctx.fillStyle = "rgba(6,9,22,0.66)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COL.parchment;
      ctx.textAlign = "center";
      ctx.font = "700 46px Georgia, serif";
      ctx.fillText("PAUSED", W / 2, H / 2 - 10);
      ctx.font = "400 19px Georgia, serif";
      ctx.fillStyle = COL.grey;
      ctx.fillText("press P to take the ropes again", W / 2, H / 2 + 30);
    }
  }

  function drawWindow(x, y, w, h, rt, right) {
    const r = w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = COL.skyWin;
    ctx.fill();
    ctx.clip();
    /* stars */
    for (let i = 0; i < 4; i++) {
      const sx = x + 14 + ((i * 29 + (right ? 13 : 5)) % (w - 24));
      const sy = y + 16 + ((i * 37 + (right ? 21 : 9)) % (h - 40));
      const tw = 0.35 + 0.3 * Math.sin(rt * 1.7 + i * 2.1 + (right ? 1 : 0));
      ctx.fillStyle = "rgba(238,240,255," + tw.toFixed(3) + ")";
      ctx.fillRect(sx, sy, 2, 2);
    }
    /* snow streaks inside */
    ctx.strokeStyle = "rgba(220,228,255,0.25)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const sx = x + ((rt * 22 + i * 27) % (w + 20)) - 10;
      const sy = y + ((i * 53 + rt * 46) % h);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 4, sy + 9);
      ctx.stroke();
    }
    /* fireworks on victory */
    if (G.mode === "won") {
      for (const s of G.bursts) {
        const a = Math.max(0, 1 - s.t / s.T);
        ctx.globalAlpha = a;
        ctx.fillStyle = s.col;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    /* frame */
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.strokeStyle = COL.stone;
    ctx.lineWidth = 9;
    ctx.stroke();
    /* mullion */
    ctx.strokeStyle = COL.stoneDark;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + r, y + 4);
    ctx.lineTo(x + r, y + h - 4);
    ctx.moveTo(x, y + h * 0.55);
    ctx.lineTo(x + w, y + h * 0.55);
    ctx.stroke();
    /* sill */
    ctx.fillStyle = COL.stoneDark;
    ctx.fillRect(x - 8, y + h, w + 16, 10);
  }

  function drawTower(rt) {
    const g = G.geo;
    if (!g) return;
    const top = 594;
    const gapH = 82;
    /* dark opening */
    ctx.fillStyle = "#04060d";
    ctx.fillRect(g.gapL, top, g.gapR - g.gapL, gapH);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    ctx.strokeRect(g.gapL + 1, top + 1, g.gapR - g.gapL - 2, gapH - 2);
    /* bells */
    const bellR = Math.min(24, g.step * 0.24);
    for (let i = 0; i < g.bells; i++) {
      const px = g.xs[i];
      const py = top + 40;
      const age = rt === null ? 99 : G.stageTime - G.pulls[i];
      const amp = 0.42 * Math.exp(-Math.max(0, age) * 2.6);
      const ang = amp * Math.sin(rt * 7 + i * 1.3);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = "#20180c";
      ctx.fillRect(-3, -10, 6, 12);
      const grad = ctx.createLinearGradient(-bellR, 0, bellR, 0);
      grad.addColorStop(0, "#93743f");
      grad.addColorStop(0.5, "#6e5227");
      grad.addColorStop(1, "#4c3819");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-bellR, bellR + 8);
      ctx.bezierCurveTo(-bellR, 2, -bellR * 0.55, -8, 0, -8);
      ctx.bezierCurveTo(bellR * 0.55, -8, bellR, 2, bellR, bellR + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#3c2c12";
      ctx.beginPath();
      ctx.ellipse(0, bellR + 8, bellR + 2, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8d97b8";
      ctx.beginPath();
      ctx.arc(0, bellR + 14, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /* beam with rope holes */
    const by = top + gapH;
    const bg = ctx.createLinearGradient(0, by, 0, by + 24);
    bg.addColorStop(0, COL.woodLight);
    bg.addColorStop(1, COL.beamDark);
    ctx.fillStyle = bg;
    ctx.fillRect(g.gapL - 14, by, g.gapR - g.gapL + 28, 24);
    ctx.fillStyle = "#171008";
    for (let i = 0; i < g.bells; i++) {
      ctx.beginPath();
      ctx.arc(g.xs[i], by + 12, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8a6b3a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawHud(rt) {
    ctx.textAlign = "left";
    ctx.fillStyle = COL.parchment;
    ctx.font = "600 21px Georgia, serif";
    ctx.fillText("SCORE " + G.score, 26, 46);
    ctx.fillStyle = COL.grey;
    ctx.font = "400 14px Georgia, serif";
    ctx.fillText("BEST " + Math.max(G.best, G.score), 26, 68);
    if (G.streak >= 5) {
      ctx.fillStyle = COL.amber;
      ctx.font = "italic 600 17px Georgia, serif";
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(rt * 8);
      ctx.fillText("clean run \u00d7" + G.streak, 26, 92);
      ctx.globalAlpha = 1;
    }
    /* parish candles */
    ctx.textAlign = "right";
    ctx.fillStyle = COL.grey;
    ctx.font = "400 12px Georgia, serif";
    ctx.fillText("THE PARISH SLEEPS", W - 24, 26);
    for (let i = 0; i < START_HEARTS; i++) {
      const c = candlePos(i);
      const lit = i < G.hearts;
      ctx.fillStyle = lit ? "#efe2c3" : "#4a4f66";
      ctx.fillRect(c.x - 4, c.y, 8, 18);
      ctx.fillStyle = "#8a6b3a";
      ctx.fillRect(c.x - 6, c.y + 18, 12, 4);
      if (lit) {
        const fl = 1 + 0.18 * Math.sin(rt * 11 + i * 2.2);
        const fg = ctx.createRadialGradient(c.x, c.y - 6, 1, c.x, c.y - 6, 16);
        fg.addColorStop(0, "rgba(255,191,94,0.5)");
        fg.addColorStop(1, "rgba(255,191,94,0)");
        ctx.fillStyle = fg;
        ctx.fillRect(c.x - 16, c.y - 22, 32, 32);
        ctx.fillStyle = "#ffca6a";
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - 6, 3.4 * fl, 6 * fl, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff3d8";
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - 5, 1.6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(170,180,212,0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - 2);
        ctx.quadraticCurveTo(c.x + 5, c.y - 12, c.x, c.y - 20);
        ctx.stroke();
      }
    }
  }

  function drawStageLabel() {
    if (!G.sch) return;
    const st = STAGES[G.stageIdx];
    ctx.textAlign = "center";
    ctx.fillStyle = COL.amber;
    ctx.font = "600 16px Georgia, serif";
    ctx.fillText("STAGE " + st.num + " \u00b7 " + st.label, W / 2, 152);
  }

  function drawPanel(rt) {
    if (!G.sch) return;
    const sch = G.sch;
    const n = sch.rows[0].length;
    const st = STAGES[G.stageIdx];

    /* parchment card */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    const pg = ctx.createLinearGradient(0, PY, 0, PY + PH);
    pg.addColorStop(0, "#f7ecd2");
    pg.addColorStop(1, "#e9d8ae");
    ctx.fillStyle = pg;
    roundRect(PX, PY, PW, PH, 16);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = COL.parchEdge;
    ctx.lineWidth = 2;
    roundRect(PX, PY, PW, PH, 16);
    ctx.stroke();

    const ringing =
      G.mode === "ringing" && G.phase === "rows" && G.rowIdx < sch.rows.length;
    const counting = G.mode === "ringing" && G.phase === "countin";

    /* caption */
    ctx.fillStyle = COL.inkSoft;
    ctx.textAlign = "left";
    ctx.font = "600 15px Georgia, serif";
    const shownRow = ringing
      ? G.rowIdx + 1
      : Math.min(G.rowIdx + 1, sch.rows.length);
    ctx.fillText(
      "ROW " + shownRow + " OF " + sch.rows.length,
      PX + 28,
      PY + 32,
    );
    ctx.textAlign = "right";
    ctx.fillText("PLAIN HUNT", PX + PW - 28, PY + 32);

    /* big digits */
    const rowNow = sch.rows[Math.min(G.rowIdx, sch.rows.length - 1)];
    const cw = G.geo.cw;
    const cy = PY + 112;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 0; k < n; k++) {
      const cx = cellX(k);
      const res = ringing ? G.resolved[k] : false;
      if (ringing || G.mode === "cleared" || G.mode === "title") {
        ctx.font = "700 64px Georgia, serif";
        ctx.fillStyle = res ? COL.struck : COL.ink;
        ctx.globalAlpha = res ? 0.75 : 1;
        ctx.fillText(String(rowNow[k]), cx, cy);
        ctx.globalAlpha = 1;
        if (res) {
          if (
            G.rowIdx < sch.rows.length &&
            sch.rows[G.rowIdx][k] === rowNow[k]
          ) {
            ctx.strokeStyle = COL.amber;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx - 14, cy + 34);
            ctx.lineTo(cx, cy + 42);
            ctx.lineTo(cx + 14, cy + 26);
            ctx.stroke();
          }
        }
      } else {
        ctx.font = "700 64px Georgia, serif";
        ctx.fillStyle = COL.ink;
        ctx.globalAlpha = 0.3;
        ctx.fillText(String(rowNow[k]), cx, cy);
        ctx.globalAlpha = 1;
      }
    }

    /* sweeping cursor */
    if (ringing) {
      const u = G.stageTime - sch.starts[G.rowIdx];
      if (u >= 0 && u < n * sch.B) {
        const k = Math.min(n - 1, Math.floor(u / sch.B));
        const cx = cellX(k);
        const pulse = 0.55 + 0.35 * Math.sin(rt * 12);
        ctx.save();
        ctx.shadowColor = COL.amber;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = COL.amber;
        ctx.globalAlpha = 0.35 + 0.5 * pulse * 0.5;
        ctx.lineWidth = 3.5;
        roundRect(cx - cw / 2 + 6, PY + 58, cw - 12, 108, 12);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    /* count-in number */
    if (counting) {
      const remain = Math.ceil((sch.starts[0] - G.stageTime) / sch.B);
      ctx.fillStyle = COL.amber;
      ctx.font = "700 96px Georgia, serif";
      ctx.globalAlpha = 0.9;
      ctx.fillText(String(remain), PX + PW / 2, PY + 112);
      ctx.globalAlpha = 1;
    }

    /* next row preview */
    ctx.textBaseline = "alphabetic";
    if (ringing && G.rowIdx + 1 < sch.rows.length) {
      const nxt = sch.rows[G.rowIdx + 1];
      ctx.textAlign = "left";
      ctx.fillStyle = COL.inkSoft;
      ctx.font = "600 13px Georgia, serif";
      ctx.fillText("NEXT", PX + 28, PY + PH - 22);
      ctx.font = "600 24px Georgia, serif";
      ctx.fillStyle = "#8a795c";
      let nx = PX + 86;
      for (let k = 0; k < nxt.length; k++) {
        ctx.fillText(String(nxt[k]), nx, PY + PH - 20);
        nx += 30;
      }
    }

    /* history */
    if (G.history.length) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#9c8a68";
      ctx.font = "400 14px Georgia, serif";
      ctx.fillText(
        "last: " + G.history.join(" \u00b7 "),
        PX + PW - 28,
        PY + PH - 22,
      );
    }

    /* banner-phase flavour */
    if (G.mode === "ringing" && G.phase === "banner") {
      ctx.textAlign = "center";
      ctx.fillStyle = COL.cream;
      ctx.font = "italic 600 24px Georgia, serif";
      ctx.fillText(st.flavor, W / 2, 620);
      ctx.fillStyle = COL.grey;
      ctx.font = "400 15px Georgia, serif";
      ctx.fillText("stand by the ropes\u2026", W / 2, 648);
    }
  }

  function drawRopes(rt) {
    const g = G.geo;
    if (!g) return;
    const topY = 700;
    const numY = 794;
    const sallyY = 872;
    for (let i = 0; i < g.bells; i++) {
      const x = g.xs[i];
      const age = G.stageTime - G.pulls[i];
      const pull =
        age < 0.07 ? (age / 0.07) * 44 : 44 * Math.exp(-4.5 * (age - 0.07));
      const off = age < 0 || age > 6 ? 0 : pull;
      const sway = Math.sin(rt * 1.6 + i * 2) * 2.2;
      /* rope */
      ctx.strokeStyle = "#c9b891";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.quadraticCurveTo(
        x + sway,
        (topY + sallyY + off) / 2,
        x,
        sallyY - 14 + off,
      );
      ctx.stroke();
      /* upper tail */
      ctx.beginPath();
      ctx.moveTo(x, sallyY - 14 + off);
      ctx.lineTo(x, sallyY + 16 + off);
      ctx.stroke();
      /* numeral disc */
      ctx.fillStyle = COL.parchment;
      ctx.beginPath();
      ctx.arc(x, numY, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COL.parchEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = COL.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 19px Georgia, serif";
      ctx.fillText(String(i + 1), x, numY + 1);
      /* sally */
      ctx.save();
      ctx.translate(x, sallyY + off);
      const sw = 62;
      const sh = 26;
      ctx.beginPath();
      roundRectLocal(-sw / 2, -sh / 2, sw, sh, sh / 2);
      ctx.fillStyle = "#b8433a";
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = "#efe4cc";
      ctx.fillRect(-sw / 2 + sw * 0.22, -sh / 2, sw * 0.16, sh);
      ctx.fillRect(-sw / 2 + sw * 0.56, -sh / 2, sw * 0.16, sh);
      ctx.restore();
    }
    ctx.textBaseline = "alphabetic";
  }

  function roundRectLocal(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFloor() {
    const fg = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    fg.addColorStop(0, "#241a10");
    fg.addColorStop(1, "#120c06");
    ctx.fillStyle = fg;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.strokeStyle = "rgba(255,235,200,0.05)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const y = FLOOR_Y + i * 17;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawBanners() {
    for (const b of G.banners) {
      const p = b.t / b.T;
      const a = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.6) / 0.4);
      ctx.globalAlpha = Math.max(0, a);
      ctx.textAlign = "center";
      ctx.fillStyle = b.color;
      ctx.font = "italic 700 30px Georgia, serif";
      ctx.fillText(b.txt, W / 2, 596 - 26 * p);
      ctx.globalAlpha = 1;
    }
  }

  function drawFloats() {
    for (const f of G.floats) {
      const p = f.t / f.T;
      ctx.globalAlpha = 1 - p;
      ctx.textAlign = "center";
      ctx.fillStyle = f.col;
      ctx.font = "700 22px Georgia, serif";
      ctx.fillText(f.txt, f.x, f.y - 34 * p);
      ctx.globalAlpha = 1;
    }
  }

  function drawSparks() {
    for (const s of G.sparks) {
      ctx.globalAlpha = Math.max(0, 1 - s.t / s.T);
      ctx.fillStyle = s.col;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSnow(rt) {
    ctx.fillStyle = "rgba(226,232,250,0.55)";
    for (const f of SNOW) {
      ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(rt + f.ph));
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  function togglePause() {
    if (G.mode !== "ringing") return;
    G.paused = !G.paused;
    syncPauseBtn();
  }

  function syncPauseBtn() {
    btnPause.textContent = G.paused ? "Resume" : "Pause";
    const k = document.createElement("span");
    k.className = "key";
    k.textContent = "P";
    btnPause.appendChild(k);
  }

  function syncMuteBtn() {
    btnMute.textContent = G.muted ? "Sound: off" : "Sound: on";
    const k = document.createElement("span");
    k.className = "key";
    k.textContent = "M";
    btnMute.appendChild(k);
  }

  function toggleMute() {
    G.muted = !G.muted;
    if (master) master.gain.value = G.muted ? 0 : 0.5;
    syncMuteBtn();
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === " " || k === "Enter") {
      if (G.mode === "title" || G.mode === "won" || G.mode === "lost") {
        e.preventDefault();
        ensureAudio();
        if (ovAction) ovAction();
      } else if (k === " ") {
        e.preventDefault();
      }
      return;
    }
    const lk = k.toLowerCase();
    if (lk === "p") {
      togglePause();
      return;
    }
    if (lk === "m") {
      toggleMute();
      return;
    }
    if (lk === "r") {
      ensureAudio();
      restartRun();
      return;
    }
    if (k >= "1" && k <= "6") {
      e.preventDefault();
      ensureAudio();
      judge(parseInt(k, 10));
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (G.mode !== "ringing" || G.paused) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * W) / rect.width;
    const y = ((e.clientY - rect.top) * H) / rect.height;
    const hit = ropeHit(x, y);
    if (hit >= 0) {
      ensureAudio();
      judge(hit + 1);
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  btnPause.addEventListener("click", () => togglePause());
  btnMute.addEventListener("click", () => {
    ensureAudio();
    toggleMute();
  });
  btnRestart.addEventListener("click", () => {
    ensureAudio();
    restartRun();
  });
  ovBtn.addEventListener("click", () => {
    ensureAudio();
    if (ovAction) ovAction();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.mode === "ringing" && !G.paused) {
      G.paused = true;
      syncPauseBtn();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  syncMuteBtn();
  syncPauseBtn();
  G.geo = layoutFor(4);
  G.sch = makeSchedule(STAGES[0]);
  ovAction = restartRun;
  overlayEl.classList.remove("hidden");

  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    G.lastNow = ts / 1000;
    update(dt);
    render(ts / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
