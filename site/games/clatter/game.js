(() => {
  "use strict";

  // ------------------------------------------------------------------
  // Clatter — a domino-chain parlour game.
  // Lay runs of dominoes across a village-hall stage, tip the brass
  // tile, huff the stragglers over, and ring the act's gong.
  // ------------------------------------------------------------------

  const W = 900;
  const H = 500;
  const COLS = 26;
  const ROWS = 14;
  const CS = 32;
  const OX = (W - COLS * CS) / 2;
  const OY = (H - ROWS * CS) / 2;

  const WAVE_MS = 75; // the clatter advances one ring per tick
  const FALL_MS = 320; // one tile's tumble to the boards
  const DIRS8 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  // LEVELS-BEGIN (pure data — do not move code inside these markers)
  const ACT_WORDS = ["one", "two", "three", "four", "five", "six"];
  const LEVELS = [
    {
      name: "First Fall",
      brief:
        "An empty stage, a straight floor, and the brass tile waiting. " +
        "Drag across the boards to chalk your first run from the tipper to the gong.",
      start: [2, 7],
      gong: [23, 7],
      budget: 40,
      puffs: 3,
      walls: [],
      cats: [],
    },
    {
      name: "Around the Piano",
      brief:
        "The piano crate arrived early and nobody will budge it. " +
        "Take the line the long way round — down, across, and up again.",
      start: [2, 7],
      gong: [23, 7],
      budget: 46,
      puffs: 3,
      walls: [[10, 5, 15, 8]],
      cats: [],
    },
    {
      name: "Do Not Disturb",
      brief:
        "Two cats have claimed the floor for the afternoon. No tile may lie " +
        "within a tile's width of a sleeping cat, so thread the gaps they have left you.",
      start: [2, 7],
      gong: [23, 6],
      budget: 50,
      puffs: 3,
      walls: [],
      cats: [
        [
          [8, 4],
          [9, 4],
          [10, 4],
          [9, 3],
        ],
        [
          [15, 9],
          [16, 9],
          [17, 9],
          [16, 10],
        ],
      ],
    },
    {
      name: "The Long Way Round",
      brief:
        "Two walls and one guarded gate. The short way is shut, and the long way " +
        "has a pinch at the far end. Mind your corners on the turn.",
      start: [2, 12],
      gong: [24, 2],
      budget: 52,
      puffs: 3,
      walls: [
        [8, 0, 8, 9],
        [17, 4, 17, 13],
      ],
      cats: [
        [
          [15, 1],
          [16, 0],
          [16, 1],
          [17, 0],
        ],
      ],
    },
    {
      name: "The Whole Company",
      brief:
        "Three cats, two crates, and only two puffs in your lungs tonight. " +
        "Every tile must earn its place on this floor.",
      start: [1, 1],
      gong: [23, 7],
      budget: 56,
      puffs: 2,
      walls: [
        [5, 2, 8, 4],
        [11, 8, 14, 10],
      ],
      cats: [
        [
          [20, 4],
          [21, 4],
          [20, 5],
        ],
        [
          [3, 9],
          [3, 10],
          [4, 10],
        ],
        [
          [24, 11],
          [25, 11],
        ],
      ],
    },
    {
      name: "Grand Finale",
      brief:
        "The whole hall in one line: over the top of the scaffold, down the far wing, " +
        "and home to the biggest gong of the evening. Make it sing.",
      start: [1, 7],
      gong: [24, 12],
      budget: 62,
      puffs: 3,
      walls: [
        [8, 6, 17, 8],
        [12, 1, 14, 12],
      ],
      cats: [
        [
          [4, 6],
          [5, 6],
          [4, 7],
        ],
        [
          [20, 7],
          [21, 7],
          [21, 6],
        ],
        [
          [12, 13],
          [13, 13],
          [14, 13],
        ],
      ],
    },
  ];
  // LEVELS-END

  const EMPTY = 0;
  const STANDING = 1;
  const FALLING = 2;
  const FALLEN = 3;

  const idxOf = (c, r) => r * COLS + c;
  const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (p) => p * p * (3 - 2 * p);

  function hash(n) {
    let x = (n | 0) * 2654435761;
    x = ((x >> 13) ^ x) * 1274126177;
    return ((x >> 16) ^ x) >>> 0;
  }
  const frac01 = (n) => (hash(n) % 1000) / 1000;

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const el = (id) => document.getElementById(id);
  const hudLevel = el("hud-level");
  const hudTray = el("hud-tray");
  const hudPuffs = el("hud-puffs");
  const btnLay = el("btn-lay");
  const btnErase = el("btn-erase");
  const btnClear = el("btn-clear");
  const btnTest = el("btn-test");
  const btnPause = el("btn-pause");
  const btnSound = el("btn-sound");
  const btnHuff = el("btn-huff");
  const overlays = {
    menu: el("ov-menu"),
    brief: el("ov-brief"),
    win: el("ov-win"),
    stall: el("ov-stall"),
    finale: el("ov-finale"),
    pause: el("ov-pause"),
  };

  let mode = "menu"; // menu | brief | build | test | stalled | won | finale
  let paused = false;
  let levelIdx = 0;
  let lvl = null;
  let wallSet = new Set();
  let moatSet = new Set();
  let startIdx = 0;
  let gongIdx = 0;

  let grid = []; // per cell: null or {st, fallAt, dx, dy, isStart}
  let placedSet = new Set(); // player-laid tiles (start excluded)
  let tray = 0;
  let puffs = 0;
  let puffsUsed = 0;

  let tool = "lay";
  let painting = false;
  let lastPaintCell = null;
  let hoverCell = null;
  let pointerPx = { x: W / 2, y: H / 2 };
  const denyFlash = new Map();

  // test-run machinery
  let frontier = [];
  let waveAcc = 0;
  let wonRun = false;
  let gongAt = -1;
  let stallAt = -1;
  let fallenCount = 0;
  let snapshot = [];
  let endFired = false;

  let bests = [];
  try {
    const raw = JSON.parse(window.localStorage.getItem("clatter-stars"));
    if (Array.isArray(raw)) bests = raw.slice(0, LEVELS.length);
  } catch (e) {
    bests = [];
  }

  // virtual clock: frozen while paused so every animation agrees
  let vnow = 0;
  const puffFx = [];
  const confetti = [];
  const gongRings = [];

  // ------------------------------------------------------------------
  // Audio — all synthesised, nothing fetched
  // ------------------------------------------------------------------

  let ac = null;
  let master = null;
  let muted = false;
  let lastTickAt = 0;

  function ensureAudio() {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.85;
        master.connect(ac.destination);
      }
      if (ac.state === "suspended") ac.resume();
    } catch (e) {
      ac = null;
    }
  }

  function tone(freq, dur, gain, type, slideTo, when) {
    if (!ac || muted) return;
    try {
      const t0 = ac.currentTime + (when || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (e) {
      /* keep playing silently */
    }
  }

  function noise(dur, f0, f1, gain, when) {
    if (!ac || muted) return;
    try {
      const t0 = ac.currentTime + (when || 0);
      const len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(f0, t0);
      bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      bp.Q.value = 1.1;
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t0);
    } catch (e) {
      /* silent */
    }
  }

  function sndTick() {
    if (vnow - lastTickAt < 26) return;
    lastTickAt = vnow;
    tone(150 + Math.random() * 120, 0.05, 0.05, "square");
    noise(0.03, 2200, 1400, 0.02);
  }
  function sndPlace() {
    tone(330, 0.06, 0.06, "sine", 290);
  }
  function sndErase() {
    tone(240, 0.05, 0.04, "sine", 180);
  }
  function sndDeny() {
    tone(110, 0.1, 0.07, "triangle", 78);
  }
  function sndWhoosh() {
    noise(0.22, 340, 1050, 0.22);
  }
  function sndThud() {
    tone(84, 0.24, 0.14, "sine", 58);
    noise(0.08, 200, 120, 0.05);
  }
  function sndGong() {
    tone(131, 2.4, 0.32, "sine");
    tone(263, 2.1, 0.16, "sine");
    tone(394, 1.7, 0.09, "sine");
    tone(521, 1.3, 0.05, "sine");
    noise(0.06, 900, 400, 0.12);
  }
  function sndJingle() {
    const notes = [392, 494, 587, 784];
    notes.forEach((f, i) => tone(f, 0.2, 0.09, "triangle", null, i * 0.13));
  }
  function sndUi() {
    tone(480, 0.035, 0.03, "square");
  }

  // ------------------------------------------------------------------
  // Level plumbing
  // ------------------------------------------------------------------

  function buildSets(level) {
    wallSet = new Set();
    for (const w of level.walls) {
      for (let r = w[1]; r <= w[3]; r++) {
        for (let c = w[0]; c <= w[2]; c++) wallSet.add(idxOf(c, r));
      }
    }
    moatSet = new Set();
    for (const cat of level.cats) {
      for (const cell of cat) {
        moatSet.add(idxOf(cell[0], cell[1]));
        for (const d of DIRS8) {
          const c = cell[0] + d[0];
          const r = cell[1] + d[1];
          if (inBounds(c, r)) moatSet.add(idxOf(c, r));
        }
      }
    }
    startIdx = idxOf(level.start[0], level.start[1]);
    gongIdx = idxOf(level.gong[0], level.gong[1]);
    moatSet.delete(startIdx);
    moatSet.delete(gongIdx);
  }

  function loadLevel(i) {
    levelIdx = i;
    lvl = LEVELS[i];
    buildSets(lvl);
    grid = new Array(COLS * ROWS).fill(null);
    grid[startIdx] = { st: STANDING, fallAt: 0, dx: 1, dy: 0, isStart: true };
    placedSet = new Set();
    tray = lvl.budget;
    puffs = lvl.puffs;
    puffsUsed = 0;
    denyFlash.clear();
    puffFx.length = 0;
    confetti.length = 0;
    gongRings.length = 0;
    frontier = [];
    waveAcc = 0;
    wonRun = false;
    gongAt = -1;
    stallAt = -1;
    fallenCount = 0;
    endFired = false;
    tool = "lay";
    hudLevel.textContent = String(i + 1);
    refreshHud();
    refreshButtons();
  }

  function refreshHud() {
    hudTray.textContent = String(tray);
    hudPuffs.textContent = String(puffs);
    hudTray.classList.toggle("is-low", tray <= 4 && mode === "build");
    hudPuffs.classList.toggle("is-low", puffs === 1);
  }

  function showOverlay(name) {
    for (const k of Object.keys(overlays)) {
      overlays[k].classList.toggle("is-hidden", k !== name);
    }
  }
  function hideOverlays() {
    for (const k of Object.keys(overlays))
      overlays[k].classList.add("is-hidden");
  }

  function refreshButtons() {
    const building = mode === "build" && !paused;
    btnLay.disabled = !building;
    btnErase.disabled = !building;
    btnClear.disabled = !building;
    btnTest.disabled = !building;
    btnLay.classList.toggle("is-on", tool === "lay");
    btnErase.classList.toggle("is-on", tool === "erase");
    btnTest.textContent = mode === "test" ? "Clattering…" : "Test ▶";
    btnPause.disabled = !(mode === "build" || mode === "test") || paused;
    btnHuff.disabled = !(mode === "test" && !paused && puffs > 0 && !wonRun);
    canvas.style.cursor =
      mode === "test" ? "pointer" : tool === "erase" ? "cell" : "crosshair";
  }

  // ------------------------------------------------------------------
  // Building
  // ------------------------------------------------------------------

  function blockedForLay(idx) {
    return (
      wallSet.has(idx) ||
      moatSet.has(idx) ||
      idx === gongIdx ||
      idx === startIdx
    );
  }

  function paintCell(c, r) {
    if (!inBounds(c, r) || mode !== "build") return;
    const idx = idxOf(c, r);
    if (blockedForLay(idx)) {
      denyFlash.set(idx, vnow);
      sndDeny();
      return;
    }
    const cell = grid[idx];
    if (tool === "lay") {
      if (cell) return;
      if (tray <= 0) {
        denyFlash.set(idx, vnow);
        hudTray.classList.remove("is-low");
        void hudTray.offsetWidth;
        hudTray.classList.add("is-low");
        sndDeny();
        return;
      }
      grid[idx] = { st: STANDING, fallAt: 0, dx: 1, dy: 0 };
      placedSet.add(idx);
      tray--;
      sndPlace();
    } else {
      if (!cell || cell.isStart) {
        if (cell && cell.isStart) denyFlash.set(startIdx, vnow);
        return;
      }
      grid[idx] = null;
      placedSet.delete(idx);
      tray++;
      sndErase();
    }
    refreshHud();
  }

  function clearFloor() {
    if (mode !== "build") return;
    for (const idx of placedSet) grid[idx] = null;
    placedSet.clear();
    tray = lvl.budget;
    sndUi();
    refreshHud();
  }

  function bresenham(c0, r0, c1, r1, fn) {
    let dx = Math.abs(c1 - c0);
    let dy = Math.abs(r1 - r0);
    const sx = c0 < c1 ? 1 : -1;
    const sy = r0 < r1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      fn(c0, r0);
      if (c0 === c1 && r0 === r1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        c0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        r0 += sy;
      }
    }
  }

  // ------------------------------------------------------------------
  // The run itself
  // ------------------------------------------------------------------

  function triggerFall(idx, dx, dy) {
    const cell = grid[idx];
    if (!cell || cell.st !== STANDING) return;
    cell.st = FALLING;
    cell.fallAt = vnow;
    cell.dx = dx;
    cell.dy = dy;
    fallenCount++;
    sndTick();
  }

  function beginTest() {
    if (mode !== "build") return;
    snapshot = Array.from(placedSet);
    fallenCount = 0;
    puffsUsed = 0;
    frontier = [startIdx];
    waveAcc = 0;
    wonRun = false;
    gongAt = -1;
    stallAt = -1;
    endFired = false;
    triggerFall(startIdx, 1, 0);
    mode = "test";
    refreshButtons();
    refreshHud();
    sndUi();
  }

  function restoreBuild(nextMode) {
    grid[startIdx] = { st: STANDING, fallAt: 0, dx: 1, dy: 0, isStart: true };
    for (const idx of snapshot) {
      grid[idx] = { st: STANDING, fallAt: 0, dx: 1, dy: 0 };
    }
    puffs = lvl.puffs;
    frontier = [];
    waveAcc = 0;
    wonRun = false;
    gongAt = -1;
    stallAt = -1;
    endFired = false;
    mode = nextMode;
    hideOverlays();
    refreshButtons();
    refreshHud();
  }

  function waveStep() {
    const next = [];
    for (const idx of frontier) {
      const c = idx % COLS;
      const r = (idx / COLS) | 0;
      for (const d of DIRS8) {
        const nc = c + d[0];
        const nr = r + d[1];
        if (!inBounds(nc, nr)) continue;
        const n = idxOf(nc, nr);
        const cell = grid[n];
        if (cell && cell.st === STANDING) {
          triggerFall(n, d[0], d[1]);
          next.push(n);
          if (n !== gongIdx && isNearGong(nc, nr)) ringGong();
        }
      }
    }
    frontier = next;
  }

  function isNearGong(c, r) {
    const gc = lvl.gong[0];
    const gr = lvl.gong[1];
    return Math.abs(c - gc) <= 1 && Math.abs(r - gr) <= 1;
  }

  function ringGong() {
    if (gongAt >= 0) return;
    wonRun = true;
    gongAt = vnow;
    gongRings.push({ at: vnow }, { at: vnow + 160 }, { at: vnow + 330 });
    spawnConfetti();
    sndGong();
  }

  function huff(px, py) {
    if (mode !== "test" || paused || puffs <= 0 || wonRun) return;
    puffs--;
    puffsUsed++;
    puffFx.push({ x: px, y: py, at: vnow });
    sndWhoosh();
    const pc = (px - OX) / CS - 0.5;
    const pr = (py - OY) / CS - 0.5;
    const rad = 1.75;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dc = c - pc;
        const dr = r - pr;
        if (dc * dc + dr * dr > rad * rad) continue;
        const idx = idxOf(c, r);
        const cell = grid[idx];
        if (cell && cell.st === STANDING) {
          const len = Math.hypot(dc, dr) || 1;
          triggerFall(idx, dc / len, dr / len);
          frontier.push(idx);
          if (isNearGong(c, r)) ringGong();
        }
      }
    }
    refreshHud();
    refreshButtons();
  }

  function finishWin() {
    mode = "won";
    const laidTotal = snapshot.length + 1;
    let stars = 1;
    if (puffsUsed <= 1) stars++;
    if (fallenCount >= laidTotal) stars++;
    if (!bests[levelIdx] || bests[levelIdx] < stars) bests[levelIdx] = stars;
    try {
      window.localStorage.setItem("clatter-stars", JSON.stringify(bests));
    } catch (e) {
      /* session-only then */
    }
    el("win-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
    el("win-note").textContent = winNote(stars, fallenCount, laidTotal);
    const last = levelIdx === LEVELS.length - 1;
    el("btn-next").textContent = last ? "Curtain call" : "Next act";
    showOverlay("win");
    sndJingle();
    refreshButtons();
  }

  function winNote(stars, fallen, laid) {
    const strays = laid - fallen;
    if (stars === 3)
      return "Not one tile left standing and a puff to spare. The committee weeps.";
    if (stars === 2)
      return strays > 0
        ? `It rang with ${strays} stray tile${strays === 1 ? "" : "s"} left standing. Tidy the line for three.`
        : "It rang, but the lungs paid for it. Spare a puff for three stars.";
    return "It rang, barely. A cleaner line earns more stars.";
  }

  function finishStall() {
    mode = "stalled";
    sndThud();
    showOverlay("stall");
    refreshButtons();
  }

  function showFinale() {
    mode = "finale";
    const total = bests.reduce((a, b) => a + (b || 0), 0);
    const max = LEVELS.length * 3;
    el("finale-stars").textContent =
      "★".repeat(Math.min(total, max)) + "☆".repeat(Math.max(max - total, 0));
    el("finale-note").textContent =
      `Six acts, six gongs, ${total} of ${max} stars. The hall empties into the rain, ` +
      "still clattering somewhere behind its ribs.";
    showOverlay("finale");
    sndJingle();
    refreshButtons();
  }

  function spawnConfetti() {
    const gc = OX + lvl.gong[0] * CS + CS / 2;
    const gr = OY + lvl.gong[1] * CS + CS / 2;
    const colors = ["#b8432f", "#d9a441", "#5f7a4e", "#4e6a7a", "#f3e7cf"];
    for (let i = 0; i < 70; i++) {
      confetti.push({
        x: gc,
        y: gr,
        vx: (Math.random() - 0.5) * 260,
        vy: -80 - Math.random() * 210,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 9,
        color: colors[i % colors.length],
        born: vnow + Math.random() * 240,
      });
    }
  }

  function update(dt) {
    // particles live everywhere
    for (let i = puffFx.length - 1; i >= 0; i--) {
      if (vnow - puffFx[i].at > 520) puffFx.splice(i, 1);
    }
    for (let i = gongRings.length - 1; i >= 0; i--) {
      if (vnow - gongRings[i].at > 1100) gongRings.splice(i, 1);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      const age = vnow - p.born;
      if (age > 2400) {
        confetti.splice(i, 1);
        continue;
      }
      if (age > 0) {
        p.vy += 340 * (dt / 1000);
        p.x += p.vx * (dt / 1000);
        p.y += p.vy * (dt / 1000);
        p.rot += p.vr * (dt / 1000);
      }
    }

    if (mode !== "test") return;

    // the clatter keeps rolling even after the gong — let every tile fall
    waveAcc += dt;
    while (waveAcc >= WAVE_MS) {
      waveAcc -= WAVE_MS;
      waveStep();
    }

    let animating = false;
    for (let i = 0; i < grid.length; i++) {
      const cell = grid[i];
      if (cell && cell.st === FALLING && vnow - cell.fallAt < FALL_MS) {
        animating = true;
        break;
      }
    }

    if (!endFired) {
      if (wonRun) {
        if (vnow - gongAt > 1250 && !animating && frontier.length === 0) {
          endFired = true;
          finishWin();
        }
      } else if (
        stallAt < 0 &&
        frontier.length === 0 &&
        !animating &&
        fallenCount > 0
      ) {
        stallAt = vnow + 700;
      }
      if (stallAt > 0 && vnow >= stallAt) {
        if (frontier.length === 0 && !animating && !wonRun) {
          endFired = true;
          finishStall();
        } else {
          stallAt = -1;
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------

  function drawFloor() {
    ctx.fillStyle = "#8a5a33";
    ctx.fillRect(OX - 14, OY - 12, COLS * CS + 28, ROWS * CS + 26);

    for (let r = 0; r < ROWS; r++) {
      const y = OY + r * CS;
      ctx.fillStyle = r % 2 ? "#845430" : "#8d5c35";
      ctx.fillRect(OX - 14, y, COLS * CS + 28, CS);
      ctx.strokeStyle = "rgba(60,35,15,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(OX - 14, y + 0.5);
      ctx.lineTo(OX + COLS * CS + 14, y + 0.5);
      ctx.stroke();
      // grain streaks, stable per row
      for (let s = 0; s < 5; s++) {
        const h1 = hash(r * 131 + s * 17);
        const gx = OX + (h1 % (COLS * CS));
        const gy = y + 6 + ((h1 >> 9) % (CS - 10));
        const gw = 18 + ((h1 >> 5) % 40);
        ctx.strokeStyle = "rgba(60,35,15,0.14)";
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.quadraticCurveTo(gx + gw / 2, gy + 2, gx + gw, gy);
        ctx.stroke();
      }
    }

    // stage lip along the bottom
    ctx.fillStyle = "#5e3a1e";
    ctx.fillRect(OX - 14, OY + ROWS * CS + 8, COLS * CS + 28, 8);

    // warm spotlight
    const grad = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 520);
    grad.addColorStop(0, "rgba(255,214,150,0.16)");
    grad.addColorStop(1, "rgba(20,10,4,0.34)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBunting() {
    const y0 = OY - 16;
    ctx.strokeStyle = "rgba(240,225,190,0.5)";
    ctx.lineWidth = 1.4;
    const spans = [
      [OX - 12, W / 2],
      [W / 2, OX + COLS * CS + 12],
    ];
    const colors = ["#b8432f", "#d9a441", "#5f7a4e", "#4e6a7a"];
    let fi = 0;
    for (const [x0, x1] of spans) {
      const sag = 9;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2, y0 + sag * 2, x1, y0);
      ctx.stroke();
      const n = 9;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const fx =
          (1 - t) * (1 - t) * x0 +
          2 * (1 - t) * t * ((x0 + x1) / 2) +
          t * t * x1;
        const fy =
          (1 - t) * (1 - t) * y0 +
          2 * (1 - t) * t * (y0 + sag * 2) +
          t * t * y0;
        ctx.fillStyle = colors[(fi + i) % colors.length];
        ctx.beginPath();
        ctx.moveTo(fx - 5, fy);
        ctx.lineTo(fx + 5, fy);
        ctx.lineTo(fx, fy + 11);
        ctx.closePath();
        ctx.fill();
      }
      fi += 3;
    }
  }

  function drawGridDots() {
    ctx.fillStyle =
      mode === "test" ? "rgba(30,15,5,0.07)" : "rgba(40,20,6,0.16)";
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        ctx.fillRect(OX + c * CS - 1, OY + r * CS - 1, 2, 2);
      }
    }
  }

  function drawWalls() {
    for (const w of lvl.walls) {
      const x = OX + w[0] * CS;
      const y = OY + w[1] * CS;
      const wd = (w[2] - w[0] + 1) * CS;
      const ht = (w[3] - w[1] + 1) * CS;
      ctx.fillStyle = "#5a3a20";
      ctx.fillRect(x + 1, y + 1, wd - 2, ht - 2);
      ctx.strokeStyle = "#3c2512";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, wd - 4, ht - 4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + wd - 4, y + ht - 4);
      ctx.moveTo(x + wd - 4, y + 4);
      ctx.lineTo(x + 4, y + ht - 4);
      ctx.stroke();
      ctx.fillStyle = "#2b1a0b";
      const nails = [
        [x + 6, y + 6],
        [x + wd - 8, y + 6],
        [x + 6, y + ht - 8],
        [x + wd - 8, y + ht - 8],
      ];
      for (const [nx, ny] of nails) {
        ctx.beginPath();
        ctx.arc(nx, ny, 1.8, 0, 7);
        ctx.fill();
      }
    }
  }

  function drawMoats() {
    if (mode !== "build" && mode !== "brief") return;
    ctx.strokeStyle = "rgba(184,67,47,0.45)";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.4;
    for (const cat of lvl.cats) {
      let c0 = COLS;
      let r0 = ROWS;
      let c1 = 0;
      let r1 = 0;
      for (const [c, r] of cat) {
        c0 = Math.min(c0, c);
        r0 = Math.min(r0, r);
        c1 = Math.max(c1, c);
        r1 = Math.max(r1, r);
      }
      const x = OX + (c0 - 1) * CS + 2;
      const y = OY + (r0 - 1) * CS + 2;
      const wd = (c1 - c0 + 3) * CS - 4;
      const ht = (r1 - r0 + 3) * CS - 4;
      ctx.strokeRect(x, y, wd, ht);
    }
    ctx.setLineDash([]);
  }

  function drawGong() {
    const cx = OX + lvl.gong[0] * CS + CS / 2;
    const cy = OY + lvl.gong[1] * CS + CS / 2;
    const pulse = 0.5 + 0.5 * Math.sin(vnow / 420);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, CS * 0.42, CS * 0.3, 0, 0, 7);
    ctx.fill();

    ctx.fillStyle = "#43331f";
    ctx.fillRect(cx - 2.5, cy - CS * 0.34, 5, CS * 0.68);
    ctx.fillRect(cx - CS * 0.3, cy + CS * 0.3, CS * 0.6, 4);

    const rings = gongRings;
    for (const rg of rings) {
      const age = (vnow - rg.at) / 1000;
      if (age < 0 || age > 1) continue;
      ctx.strokeStyle = `rgba(217,164,65,${0.7 * (1 - age)})`;
      ctx.lineWidth = 3 * (1 - age) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, CS * 0.4 + age * CS * 2.4, 0, 7);
      ctx.stroke();
    }

    ctx.fillStyle = "#b8432f";
    ctx.beginPath();
    ctx.arc(cx, cy, CS * 0.38, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#d9a441";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = `rgba(255,230,170,${0.25 + pulse * 0.3})`;
    ctx.beginPath();
    ctx.arc(cx - CS * 0.1, cy - CS * 0.1, CS * 0.12, 0, 7);
    ctx.fill();

    // mallet leaning nearby
    ctx.strokeStyle = "#6b4a26";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + CS * 0.42, cy + CS * 0.36);
    ctx.lineTo(cx + CS * 0.68, cy + CS * 0.1);
    ctx.stroke();
    ctx.fillStyle = "#d9cfb4";
    ctx.beginPath();
    ctx.arc(cx + CS * 0.7, cy + CS * 0.08, 3.4, 0, 7);
    ctx.fill();
  }

  function drawCat(catCells, ci) {
    let cx = 0;
    let cy = 0;
    for (const [c, r] of catCells) {
      cx += c;
      cy += r;
    }
    const px = OX + (cx / catCells.length) * CS + CS / 2;
    const py = OY + (cy / catCells.length) * CS + CS / 2;

    const breathe = 1 + 0.04 * Math.sin(vnow / 700 + ci * 2);

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(px + 3, py + 8, CS * 0.95, CS * 0.5, 0, 0, 7);
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(breathe, 1);

    // tail
    ctx.strokeStyle = "#57504a";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-CS * 0.7, CS * 0.1);
    ctx.quadraticCurveTo(-CS * 1.15, CS * 0.05, -CS * 1.05, -CS * 0.35);
    ctx.stroke();

    // body
    ctx.fillStyle = "#6e655c";
    ctx.beginPath();
    ctx.ellipse(0, 2, CS * 0.92, CS * 0.52, 0, 0, 7);
    ctx.fill();
    // stripes
    ctx.strokeStyle = "rgba(50,44,39,0.7)";
    ctx.lineWidth = 2.4;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(
        i * CS * 0.34,
        -CS * 0.28,
        CS * 0.2,
        Math.PI * 0.15,
        Math.PI * 0.85,
      );
      ctx.stroke();
    }
    // head
    ctx.fillStyle = "#776d63";
    ctx.beginPath();
    ctx.arc(CS * 0.72, -CS * 0.1, CS * 0.34, 0, 7);
    ctx.fill();
    // ears
    ctx.fillStyle = "#57504a";
    ctx.beginPath();
    ctx.moveTo(CS * 0.52, -CS * 0.34);
    ctx.lineTo(CS * 0.6, -CS * 0.56);
    ctx.lineTo(CS * 0.72, -CS * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(CS * 0.78, -CS * 0.36);
    ctx.lineTo(CS * 0.9, -CS * 0.54);
    ctx.lineTo(CS * 0.96, -CS * 0.3);
    ctx.closePath();
    ctx.fill();
    // closed eyes
    ctx.strokeStyle = "#3c352f";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(CS * 0.62, -CS * 0.08, 2.6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CS * 0.84, -CS * 0.08, 2.6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    ctx.restore();

    // floating z's
    for (let z = 0; z < 2; z++) {
      const phase = (vnow / 1600 + z * 0.5 + ci * 0.27) % 1;
      const zx = px + CS * (0.95 + z * 0.22);
      const zy = py - CS * (0.5 + phase * 0.9);
      ctx.fillStyle = `rgba(243,231,207,${0.75 * (1 - phase)})`;
      ctx.font = `${10 + z * 2}px Georgia, serif`;
      ctx.fillText("z", zx, zy);
    }
  }

  function drawDomino(idx) {
    const cell = grid[idx];
    if (!cell || cell.st === EMPTY) return;
    const c = idx % COLS;
    const r = (idx / COLS) | 0;
    const cx = OX + c * CS + CS / 2;
    const cy = OY + r * CS + CS / 2;
    const h = frac01(idx);

    if (cell.isStart) {
      drawStandingTile(cx, cy, "#d9a441", "#8a5f18", true, idx, 0);
      return;
    }

    if (cell.st === STANDING) {
      const shade = 0.94 + h * 0.08;
      drawShadow(cx, cy, 0.32, 0.24, 0.28);
      drawStandingTile(
        cx,
        cy,
        `rgb(${Math.floor(246 * shade)},${Math.floor(239 * shade)},${Math.floor(221 * shade)})`,
        "#b7a98c",
        false,
        idx,
        h,
      );
      return;
    }

    // falling / fallen: tumble toward the direction that took it
    const p = clamp((vnow - cell.fallAt) / FALL_MS, 0, 1);
    const e = ease(p);
    const ang = Math.atan2(cell.dy, cell.dx);
    const side = h > 0.5 ? 1 : -1;
    const drift = e * CS * 0.42;
    ctx.save();
    ctx.translate(cx + Math.cos(ang) * drift, cy + Math.sin(ang) * drift);
    ctx.rotate(ang + e * 0.95 * side);
    const scaleY = 1 - e * 0.78;
    ctx.globalAlpha = 1;
    drawShadowLocal(0, 4 + e * 5, 0.34 + e * 0.1, 0.2);
    const bw = CS * 0.66;
    const bh = CS * 0.8 * scaleY;
    ctx.fillStyle = "#efe6cf";
    roundRect(-bw / 2, -bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.strokeStyle = "#b7a98c";
    ctx.lineWidth = 1;
    roundRect(-bw / 2, -bh / 2, bw, bh, 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawShadow(x, y, rxK, ryK, alpha) {
    ctx.fillStyle = `rgba(20,10,4,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 5, CS * rxK, CS * ryK, 0, 0, 7);
    ctx.fill();
  }

  function drawShadowLocal(dx, dy, k, alpha) {
    ctx.fillStyle = `rgba(20,10,4,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(dx, dy, CS * k, CS * k * 0.6, 0, 0, 7);
    ctx.fill();
  }

  function drawStandingTile(x, y, fill, stroke, isBrass, idx, h) {
    const bw = CS * (isBrass ? 0.72 : 0.66);
    const bh = CS * (isBrass ? 0.88 : 0.78);
    ctx.fillStyle = fill;
    roundRect(x - bw / 2, y - bh / 2, bw, bh, 3.5);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    roundRect(x - bw / 2, y - bh / 2, bw, bh, 3.5);
    ctx.stroke();
    // spine
    ctx.strokeStyle = isBrass ? "#8a5f18" : "#c9bb9d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - bw / 2 + 2, y);
    ctx.lineTo(x + bw / 2 - 2, y);
    ctx.stroke();
    // pips
    const pipCol = isBrass ? "#7c2f1f" : "#43382a";
    ctx.fillStyle = pipCol;
    const pr = isBrass ? 2.2 : 1.8;
    const pattern = hash(idx * 7 + 3) % 4;
    const spots = [
      [[0, -bh * 0.22]],
      [
        [-bw * 0.16, -bh * 0.22],
        [bw * 0.16, -bh * 0.22],
      ],
      [
        [0, -bh * 0.22],
        [-bw * 0.16, -bh * 0.1],
        [bw * 0.16, -bh * 0.1],
      ],
      [
        [-bw * 0.16, -bh * 0.26],
        [bw * 0.16, -bh * 0.26],
        [-bw * 0.16, -bh * 0.08],
        [bw * 0.16, -bh * 0.08],
      ],
    ][pattern];
    for (const [sx, sy] of spots) {
      ctx.beginPath();
      ctx.arc(x + sx + (h - 0.5) * 1.2, y + sy, pr, 0, 7);
      ctx.fill();
    }
    if (isBrass) {
      ctx.fillStyle = "#7c2f1f";
      ctx.font = "bold 7px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("TIP", x, y + bh * 0.3);
      ctx.textAlign = "left";
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

  function drawHoverGhost() {
    if (mode !== "build" || !hoverCell) return;
    const [c, r] = hoverCell;
    if (!inBounds(c, r)) return;
    const idx = idxOf(c, r);
    const bad =
      blockedForLay(idx) ||
      (tool === "erase" && (!grid[idx] || grid[idx].isStart));
    ctx.strokeStyle = bad ? "rgba(184,67,47,0.85)" : "rgba(217,164,65,0.85)";
    ctx.lineWidth = 1.6;
    roundRect(OX + c * CS + 2.5, OY + r * CS + 2.5, CS - 5, CS - 5, 4);
    ctx.stroke();
  }

  function drawDenyFlashes() {
    for (const [idx, at] of denyFlash) {
      const age = vnow - at;
      if (age > 380) {
        denyFlash.delete(idx);
        continue;
      }
      const a = 0.55 * (1 - age / 380);
      ctx.fillStyle = `rgba(184,67,47,${a})`;
      roundRect(
        OX + (idx % COLS) * CS + 2,
        OY + ((idx / COLS) | 0) * CS + 2,
        CS - 4,
        CS - 4,
        4,
      );
      ctx.fill();
    }
  }

  function drawPuffFx() {
    for (const p of puffFx) {
      const age = clamp((vnow - p.at) / 520, 0, 1);
      const rad = 10 + age * CS * 2.1;
      ctx.strokeStyle = `rgba(243,231,207,${0.7 * (1 - age)})`;
      ctx.lineWidth = 2.5 * (1 - age) + 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = `rgba(243,231,207,${0.35 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad * 0.66, 0, 7);
      ctx.stroke();
    }
  }

  function drawConfetti() {
    for (const p of confetti) {
      const age = vnow - p.born;
      if (age <= 0) continue;
      const fade = clamp(1 - (age - 1700) / 700, 0, 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.fillRect(-3, -2, 6, 4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.42,
      W / 2,
      H / 2,
      H * 0.86,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(8,4,2,0.4)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#17110d";
    ctx.fillRect(0, 0, W, H);
    if (!lvl) {
      drawVignette();
      return;
    }
    drawFloor();
    drawBunting();
    drawGridDots();
    drawMoats();
    drawWalls();
    drawGong();
    for (let i = 0; i < grid.length; i++) drawDomino(i);
    lvl.cats.forEach((cat, i) => drawCat(cat, i));
    drawHoverGhost();
    drawDenyFlashes();
    drawPuffFx();
    drawConfetti();
    drawVignette();
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------

  function eventCell(e) {
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * W) / rect.width;
    const py = ((e.clientY - rect.top) * H) / rect.height;
    pointerPx = { x: px, y: py };
    const c = Math.floor((px - OX) / CS);
    const r = Math.floor((py - OY) / CS);
    return inBounds(c, r) ? [c, r] : null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    const cell = eventCell(e);
    if (mode === "test") {
      huff(pointerPx.x, pointerPx.y);
      return;
    }
    if (mode !== "build") return;
    if (!cell) return;
    painting = true;
    lastPaintCell = cell;
    paintCell(cell[0], cell[1]);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    const cell = eventCell(e);
    hoverCell = cell;
    if (!painting || mode !== "build" || !cell) return;
    const [lc, lr] = lastPaintCell || cell;
    if (lc === cell[0] && lr === cell[1]) return;
    bresenham(lc, lr, cell[0], cell[1], (c, r) => paintCell(c, r));
    lastPaintCell = cell;
  });

  function stopPaint() {
    painting = false;
    lastPaintCell = null;
  }
  canvas.addEventListener("pointerup", stopPaint);
  canvas.addEventListener("pointercancel", stopPaint);

  btnHuff.addEventListener("click", () => {
    ensureAudio();
    huff(pointerPx.x, pointerPx.y);
  });

  btnLay.addEventListener("click", () => {
    tool = "lay";
    sndUi();
    refreshButtons();
  });
  btnErase.addEventListener("click", () => {
    tool = "erase";
    sndUi();
    refreshButtons();
  });
  btnClear.addEventListener("click", clearFloor);
  btnTest.addEventListener("click", beginTest);

  function togglePause(force) {
    const want = force === undefined ? !paused : force;
    if (want === paused) return;
    if (want && !(mode === "build" || mode === "test")) return;
    paused = want;
    if (paused) {
      showOverlay("pause");
    } else {
      hideOverlays();
    }
    refreshButtons();
  }

  btnPause.addEventListener("click", () => togglePause());

  function bindOverlayButton(id, fn) {
    const b = el(id);
    if (b)
      b.addEventListener("click", () => {
        ensureAudio();
        fn();
      });
  }

  bindOverlayButton("btn-play", () => {
    loadLevel(0);
    el("brief-act").textContent = "Act one";
    el("brief-name").textContent = lvl.name;
    el("brief-text").textContent = lvl.brief;
    mode = "brief";
    showOverlay("brief");
    refreshButtons();
  });

  bindOverlayButton("btn-go", () => {
    hideOverlays();
    mode = "build";
    refreshButtons();
  });

  bindOverlayButton("btn-next", () => {
    if (levelIdx >= LEVELS.length - 1) {
      showFinale();
    } else {
      loadLevel(levelIdx + 1);
      el("brief-act").textContent = "Act " + ACT_WORDS[levelIdx];
      el("brief-name").textContent = lvl.name;
      el("brief-text").textContent = lvl.brief;
      mode = "brief";
      showOverlay("brief");
      refreshButtons();
    }
  });

  bindOverlayButton("btn-back", () => restoreBuild("build"));

  bindOverlayButton("btn-again", () => {
    loadLevel(0);
    el("brief-act").textContent = "Act one";
    el("brief-name").textContent = lvl.name;
    el("brief-text").textContent = lvl.brief;
    mode = "brief";
    showOverlay("brief");
    refreshButtons();
  });

  bindOverlayButton("btn-resume", () => togglePause(false));

  bindOverlayButton("btn-restart", () => {
    paused = false;
    if (mode === "test") restoreBuild("build");
    else clearFloor();
    hideOverlays();
    refreshButtons();
  });

  btnSound.addEventListener("click", () => {
    muted = !muted;
    btnSound.classList.toggle("is-off", muted);
    ensureAudio();
    if (!muted) sndUi();
  });

  document.addEventListener("keydown", (e) => {
    if (e.repeat && e.code !== "Space") return;
    switch (e.code) {
      case "Space": {
        if (mode === "test") {
          e.preventDefault();
          huff(pointerPx.x, pointerPx.y);
        }
        break;
      }
      case "KeyP": {
        togglePause();
        break;
      }
      case "KeyM": {
        muted = !muted;
        btnSound.classList.toggle("is-off", muted);
        break;
      }
      case "KeyR": {
        if (paused) break;
        if (mode === "build") clearFloor();
        else if (mode === "test") restoreBuild("build");
        break;
      }
      case "Enter": {
        for (const k of Object.keys(overlays)) {
          const ov = overlays[k];
          if (!ov.classList.contains("is-hidden")) {
            const primary = ov.querySelector(".primary");
            if (primary) {
              primary.click();
              e.preventDefault();
            }
            break;
          }
        }
        break;
      }
      default:
        break;
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "test" && !paused) togglePause(true);
  });

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------

  let lastT = performance.now();
  function frame(t) {
    const dt = Math.min(50, t - lastT);
    lastT = t;
    if (!paused) {
      vnow += dt;
      update(dt);
    }
    draw();
    window.requestAnimationFrame(frame);
  }

  loadLevel(0);
  mode = "menu";
  showOverlay("menu");
  refreshButtons();
  window.requestAnimationFrame(frame);
})();
