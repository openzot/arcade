/* Heliostat — a dawn-beam puzzle for the arcade.
 *
 * Eight chambers of a mountain observatory stand between the player and
 * first light. One beam leaves the sun disc and obeys every surface it
 * meets: bronze mirrors swing between two angles when tapped, fixed
 * silver glass does not, prisms throw the beam sideways, stone swallows
 * it. Light every crystal in a chamber at once and the valley below
 * warms a little more.
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
  const winPanel = document.getElementById("winPanel");
  const winStats = document.getElementById("winStats");
  const winVerdict = document.getElementById("winVerdict");
  const beginBtn = document.getElementById("beginBtn");
  const againBtn = document.getElementById("againBtn");
  const resetBtn = document.getElementById("resetBtn");
  const restartBtn = document.getElementById("restartBtn");
  const soundBtn = document.getElementById("soundBtn");
  const toastEl = document.getElementById("toast");
  const dotsEl = document.getElementById("dots");
  const chamberNameEl = document.getElementById("chamberName");
  const moveCountEl = document.getElementById("moveCount");

  /* ── helpers ─────────────────────────────────────────── */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ── levels ──────────────────────────────────────────── */
  /*
   * Legend:
   *   '#' wall          '.' floor         'O' crystal
   *   'F' fixed mirror '/'   'K' fixed mirror '\'
   *   'm' loose mirror starting '/'   'n' loose mirror starting '\'
   *   'X' prism (throws the beam sideways)
   *   'b' boulder (swallows light)
   *   '>' '<' '^' 'v'  the sun disc, facing east west north south
   */

  const LEVELS = [
    {
      name: "First Light",
      par: 1,
      map: [
        "#########",
        "#......O#",
        "#.......#",
        "#..>...n#",
        "#.......#",
        "#.......#",
        "#.......#",
        "#.......#",
        "#########",
      ],
    },
    {
      name: "Two Sisters",
      par: 1,
      map: [
        "#########",
        "#....O..#",
        "#.......#",
        "#.......#",
        "#....O..#",
        "#.......#",
        "#.......#",
        "#..>.n..#",
        "#########",
      ],
    },
    {
      name: "The Long Way",
      par: 2,
      map: [
        "#########",
        "#..F...m#",
        "#..O....#",
        "#.......#",
        "#>.n....#",
        "#.......#",
        "#..b....#",
        "#......O#",
        "#########",
      ],
    },
    {
      name: "Prism",
      par: 1,
      map: [
        "#########",
        "#...O...#",
        "#......O#",
        "#.......#",
        "#O..X..n#",
        "#.......#",
        "#.......#",
        "#...^...#",
        "#########",
      ],
    },
    {
      name: "Fixed Stars",
      par: 1,
      map: [
        "#########",
        "#..F.O.K#",
        "#..O....#",
        "#.......#",
        "#.......#",
        "#.>F....#",
        "#.O....n#",
        "#.......#",
        "#########",
      ],
    },
    {
      name: "The Ring",
      par: 3,
      map: [
        "#########",
        "#>.....n#",
        "#.#####.#",
        "#.#####.#",
        "#O#####O#",
        "#.#####.#",
        "#.#####.#",
        "#m..O..n#",
        "#########",
      ],
    },
    {
      name: "Crossfire",
      par: 2,
      map: [
        "#########",
        "#...v..O#",
        "#.......#",
        "#...X..n#",
        "#...O...#",
        "#n..X...#",
        "#.......#",
        "#O..^...#",
        "#########",
      ],
    },
    {
      name: "Solstice",
      par: 3,
      map: [
        "#########",
        "#>..m...#",
        "#...O...#",
        "#.......#",
        "#...O...#",
        "#nO.X..m#",
        "#.......#",
        "#O...b.O#",
        "#########",
      ],
    },
  ];

  const TOTAL_PAR = LEVELS.reduce((s, l) => s + l.par, 0);

  /* ── cell codes ──────────────────────────────────────── */

  const T_WALL = 0;
  const T_FLOOR = 1;
  const T_CRYSTAL = 2;
  const T_FIX_SLASH = 3; // fixed '/'
  const T_FIX_BACK = 4; // fixed '\'
  const T_LOOSE = 5; // movable; orientation lives in st.orient
  const T_PRISM = 6;
  const T_ROCK = 7;

  const CODE = {
    "#": T_WALL,
    ".": T_FLOOR,
    O: T_CRYSTAL,
    F: T_FIX_SLASH,
    K: T_FIX_BACK,
    m: T_LOOSE,
    n: T_LOOSE,
    X: T_PRISM,
    b: T_ROCK,
  };

  /* ── chamber state ───────────────────────────────────── */

  const DIRS = { ">": [1, 0], "<": [-1, 0], "^": [0, -1], v: [0, 1] };
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

  let chamberIx = 0;
  let st = null; // parsed chamber
  let chamberMoves = 0;
  let totalMoves = 0;
  let goldCount = 0;
  let celebrating = false; // input locked while the toast plays
  let started = false;

  function parseLevel(def) {
    const rows = def.map;
    const H = rows.length;
    const W = rows[0].length;
    const type = new Uint8Array(W * H);
    const looseStart = [];
    const sources = [];
    const crystals = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = rows[y][x];
        const i = y * W + x;
        if (CODE[ch] !== undefined) {
          type[i] = CODE[ch];
          if (ch === "m" || ch === "n") looseStart.push(ch === "m" ? 0 : 1);
        } else if (DIRS[ch]) {
          type[i] = T_FLOOR;
          sources.push({ x, y, dx: DIRS[ch][0], dy: DIRS[ch][1] });
        }
        if (ch === "O") crystals.push(i);
      }
    }
    return {
      W,
      H,
      type,
      sources,
      crystals,
      loose: looseStart.length,
      orientInit: looseStart.slice(),
      name: def.name,
      par: def.par,
    };
  }

  const looseCellToIdx = new Map();

  function rebuildLooseMap() {
    looseCellToIdx.clear();
    let k = 0;
    for (let i = 0; i < st.type.length; i++) {
      if (st.type[i] === T_LOOSE) looseCellToIdx.set(i, k++);
    }
  }

  function looseIndexOf(cellIndex) {
    return looseCellToIdx.get(cellIndex);
  }

  function loadChamber(ix) {
    chamberIx = ix;
    st = parseLevel(LEVELS[ix]);
    st.orient = st.orientInit.slice();
    st.lit = new Set();
    st.segs = [];
    st.solveGlow = new Map(); // crystal index -> ignite animation start
    rebuildLooseMap();
    hoverCell = -1;
    focusCell = -1;
    chamberMoves = 0;
    celebrating = false;
    simulate();
    buildDots();
    updateReadout();
  }

  /* ── beam tracing ────────────────────────────────────── */

  let rayBudget = 96;

  function mirrorAt(i) {
    const t = st.type[i];
    if (t === T_FIX_SLASH) return "/";
    if (t === T_FIX_BACK) return "\\";
    if (t === T_LOOSE) return st.orient[looseIndexOf(i)] === 0 ? "/" : "\\";
    return null;
  }

  function simulate() {
    st.lit.clear();
    st.segs = [];
    rayBudget = 96; // hard cap so no chamber can recurse forever
    for (const s of st.sources) traceRay(s.x, s.y, s.dx, s.dy);
    if (allLit() && !celebrating && started) celebrate();
  }

  function allLit() {
    return st.crystals.every((i) => st.lit.has(i));
  }

  function traceRay(sx, sy, dx, dy) {
    const { W, H } = st;
    if (rayBudget-- <= 0) return;
    const pts = [[sx, sy]];
    let x = sx;
    let y = sy;
    const seen = new Set();

    for (;;) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
        pts.push([x + dx * 0.62, y + dy * 0.62]); // slip out past the frame
        break;
      }
      const i = ny * W + nx;
      const t = st.type[i];

      if (t === T_WALL || t === T_ROCK) {
        pts.push([nx - dx * 0.32, ny - dy * 0.32]); // kiss the stone
        break;
      }

      x = nx;
      y = ny;
      const key =
        y * W * 8 + x * 2 + (dx > 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3);
      if (seen.has(key)) {
        pts.push([x, y]);
        break; // caught our own tail; the hall is dark here
      }
      seen.add(key);
      pts.push([x, y]);

      if (t === T_CRYSTAL) {
        st.lit.add(i);
        if (!st.solveGlow.has(i)) st.solveGlow.set(i, performance.now());
      } else if (t === T_PRISM) {
        if (rayBudget > 0) {
          traceRay(x, y, -dy, dx);
          traceRay(x, y, dy, -dx);
        }
      } else {
        const m = mirrorAt(i);
        if (m === "/") {
          const nd = [-dy, -dx];
          dx = nd[0];
          dy = nd[1];
        } else if (m === "\\") {
          const nd = [dy, dx];
          dx = nd[0];
          dy = nd[1];
        }
      }
    }
    st.segs.push(pts);
  }

  /* ── sound ───────────────────────────────────────────── */

  let actx = null;
  let soundOn = true;

  function ensureAudio() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        actx = null;
      }
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }

  function blip(freq, dur, delay, vol, kind) {
    if (!soundOn || !actx) return;
    const t0 = actx.currentTime + (delay || 0);
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = kind || "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const sndTick = () => blip(620 + Math.random() * 60, 0.07, 0, 0.08);
  const sndDeny = () => blip(150, 0.09, 0, 0.06, "sine");
  const sndCrystal = () => {
    blip(880, 0.22, 0, 0.09, "sine");
    blip(1318, 0.3, 0.07, 0.07, "sine");
  };
  const sndChamber = () => {
    blip(659, 0.16, 0, 0.1, "sine");
    blip(880, 0.16, 0.1, 0.1, "sine");
    blip(1108, 0.34, 0.2, 0.11, "sine");
  };
  const sndWin = () => {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => blip(f, 0.42, i * 0.13, 0.1, "sine"));
  };

  /* ── geometry ────────────────────────────────────────── */

  const VIEW = 720;
  const PAD = 26;
  let CS = 74; // recomputed per chamber

  function computeGeometry() {
    CS = Math.floor((VIEW - PAD * 2) / Math.max(st.W, st.H));
  }

  const cx = (gx) => PAD + (gx + 0.5) * CS;
  const cy = (gy) => PAD + (gy + 0.5) * CS;

  /* ── ambience ────────────────────────────────────────── */

  const motes = Array.from({ length: 42 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: 0.4 + Math.random() * 1.4,
    v: 0.004 + Math.random() * 0.01,
    p: Math.random() * TAU,
  }));

  /* ── rendering ───────────────────────────────────────── */

  function fitCanvas() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    cvs.width = VIEW * dpr;
    cvs.height = VIEW * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    computeGeometry();
    ctx.clearRect(0, 0, VIEW, VIEW);

    /* night-to-dawn floor */
    const sky = ctx.createLinearGradient(0, 0, VIEW * 0.25, VIEW);
    sky.addColorStop(0, "#191b38");
    sky.addColorStop(0.55, "#232047");
    sky.addColorStop(1, "#372a4e");
    ctx.fillStyle = sky;
    roundRect(0, 0, VIEW, VIEW, 14);
    ctx.fill();

    /* faint halo around the first sun */
    const src = st.sources[0];
    if (src) {
      const halo = ctx.createRadialGradient(
        cx(src.x),
        cy(src.y),
        4,
        cx(src.x),
        cy(src.y),
        CS * 4.4,
      );
      halo.addColorStop(0, "rgba(255,214,140,0.20)");
      halo.addColorStop(1, "rgba(255,214,140,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, VIEW, VIEW);
    }

    /* tiles */
    for (let y = 0; y < st.H; y++) {
      for (let x = 0; x < st.W; x++) {
        if (st.type[y * st.W + x] === T_WALL) continue;
        const px = PAD + x * CS;
        const py = PAD + y * CS;
        ctx.fillStyle =
          (x + y) % 2 === 0
            ? "rgba(245,234,211,0.045)"
            : "rgba(245,234,211,0.02)";
        roundRect(px + 1.5, py + 1.5, CS - 3, CS - 3, 7);
        ctx.fill();
      }
    }

    /* walls */
    for (let i = 0; i < st.type.length; i++) {
      if (st.type[i] !== T_WALL) continue;
      const x = i % st.W;
      const y = (i - x) / st.W;
      drawWall(PAD + x * CS, PAD + y * CS, now, x, y);
    }

    /* boulders */
    for (let i = 0; i < st.type.length; i++) {
      if (st.type[i] !== T_ROCK) continue;
      const x = i % st.W;
      const y = (i - x) / st.W;
      drawRock(cx(x), cy(y));
    }

    /* beams run beneath their furniture */
    drawBeams(now);

    /* prisms, mirrors, crystals, suns */
    for (let i = 0; i < st.type.length; i++) {
      const t = st.type[i];
      if (
        t !== T_PRISM &&
        t !== T_LOOSE &&
        t !== T_FIX_SLASH &&
        t !== T_FIX_BACK
      )
        continue;
      const x = i % st.W;
      const y = (i - x) / st.W;
      if (t === T_PRISM) drawPrism(cx(x), cy(y));
      else if (t === T_LOOSE) drawLoose(x, y, i, now);
      else drawFixed(x, y, t === T_FIX_SLASH ? "/" : "\\");
    }

    for (const ci of st.crystals) {
      const x = ci % st.W;
      const y = (ci - x) / st.W;
      drawCrystal(x, y, ci, now);
    }

    for (const s of st.sources) drawSun(s, now);

    /* dust motes drifting through the dawn */
    drawMotes(now);

    /* keyboard focus ring */
    if (focusCell >= 0) {
      const fx = focusCell % st.W;
      const fy = (focusCell - fx) / st.W;
      ctx.strokeStyle = "rgba(245,234,211,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -(now / 40) % 11;
      roundRect(PAD + fx * CS + 3, PAD + fy * CS + 3, CS - 6, CS - 6, 8);
      ctx.stroke();
      ctx.setLineDash([]);
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

  function drawWall(px, py, now, gx, gy) {
    const inset = 2;
    ctx.fillStyle = "#2c2947";
    roundRect(px + inset, py + inset, CS - inset * 2, CS - inset * 2, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(245,234,211,0.07)";
    roundRect(
      px + inset,
      py + inset,
      CS - inset * 2,
      (CS - inset * 2) * 0.42,
      8,
    );
    ctx.fill();
    /* mortar glint */
    const g = 0.03 + 0.02 * Math.sin(now / 900 + gx * 1.7 + gy * 2.3);
    ctx.strokeStyle = "rgba(185,174,199," + g.toFixed(3) + ")";
    ctx.lineWidth = 1;
    roundRect(
      px + inset + 0.5,
      py + inset + 0.5,
      CS - inset * 2 - 1,
      CS - inset * 2 - 1,
      8,
    );
    ctx.stroke();
  }

  function drawRock(x, y) {
    ctx.fillStyle = "#574f63";
    ctx.beginPath();
    ctx.ellipse(x, y + CS * 0.08, CS * 0.36, CS * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#6d647c";
    ctx.beginPath();
    ctx.ellipse(
      x - CS * 0.05,
      y - CS * 0.05,
      CS * 0.27,
      CS * 0.22,
      0.4,
      0,
      TAU,
    );
    ctx.fill();
    ctx.fillStyle = "rgba(245,234,211,0.14)";
    ctx.beginPath();
    ctx.ellipse(x + CS * 0.1, y - CS * 0.13, CS * 0.1, CS * 0.06, -0.5, 0, TAU);
    ctx.fill();
  }

  function beamPath(pts) {
    ctx.beginPath();
    ctx.moveTo(cx(pts[0][0]), cy(pts[0][1]));
    for (let k = 1; k < pts.length; k++) {
      ctx.lineTo(cx(pts[k][0]), cy(pts[k][1]));
    }
  }

  function drawBeams(now) {
    if (!st.segs.length) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pts of st.segs) {
      if (pts.length < 2) continue;
      beamPath(pts);
      ctx.strokeStyle = "rgba(255,196,90,0.16)";
      ctx.lineWidth = CS * 0.34;
      ctx.stroke();
      beamPath(pts);
      ctx.strokeStyle = "rgba(255,210,122,0.38)";
      ctx.lineWidth = CS * 0.14;
      ctx.stroke();
      beamPath(pts);
      ctx.strokeStyle = "rgba(255,240,200,0.95)";
      ctx.lineWidth = 3.2;
      ctx.stroke();
      /* travelling sparkle */
      ctx.save();
      ctx.setLineDash([10, 18]);
      ctx.lineDashOffset = -(now / 24) % 28;
      beamPath(pts);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPrism(x, y) {
    const r = CS * 0.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(180,220,235,0.28)";
    ctx.strokeStyle = "#bcd9e8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.87, r * 0.5);
    ctx.lineTo(-r * 0.87, r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    ctx.moveTo(0, -r + 4);
    ctx.lineTo(r * 0.62, r * 0.32);
    ctx.stroke();
    ctx.restore();
  }

  function drawMirrorBar(x, y, slashOrBack, frameColor) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(slashOrBack === "/" ? -Math.PI / 4 : Math.PI / 4);
    const L = CS * 0.66;
    const grad = ctx.createLinearGradient(0, -3, 0, 4);
    grad.addColorStop(0, frameColor);
    grad.addColorStop(0.45, "#fdf6e7");
    grad.addColorStop(1, "#8d86a8");
    ctx.fillStyle = grad;
    roundRect(-L / 2, -3.4, L, 6.8, 3.2);
    ctx.fill();
    ctx.restore();
  }

  function drawFixed(x, y, ori) {
    const px = cx(x);
    const py = cy(y);
    ctx.fillStyle = "rgba(20,18,40,0.5)";
    ctx.beginPath();
    ctx.ellipse(px, py + CS * 0.18, CS * 0.26, CS * 0.1, 0, 0, TAU);
    ctx.fill();
    drawMirrorBar(px, py, ori, "#9aa7bd");
    ctx.fillStyle = "#7d88a3";
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, TAU);
    ctx.fill();
  }

  function drawLoose(x, y, i, now) {
    const px = cx(x);
    const py = cy(y);
    const li = looseIndexOf(i);
    const hovered = (hoverCell === i || focusCell === i) && !celebrating;

    /* pedestal shadow */
    ctx.fillStyle = "rgba(20,18,40,0.5)";
    ctx.beginPath();
    ctx.ellipse(px, py + CS * 0.2, CS * 0.3, CS * 0.11, 0, 0, TAU);
    ctx.fill();

    /* bronze collar marks this one as yours to turn */
    ctx.strokeStyle = hovered
      ? "rgba(255,226,150,0.95)"
      : "rgba(217,142,63,0.75)";
    ctx.lineWidth = hovered ? 2.6 : 1.8;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -(now / 130) % 11;
    ctx.beginPath();
    ctx.arc(px, py, CS * 0.4, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    drawMirrorBar(px, py, st.orient[li] === 0 ? "/" : "\\", "#d98e3f");

    ctx.fillStyle = "#f0b264";
    ctx.beginPath();
    ctx.arc(px, py, 3.6, 0, TAU);
    ctx.fill();
  }

  function drawCrystal(x, y, i, now) {
    const lit = st.lit.has(i);
    const px = cx(x);
    const py = cy(y);
    const born = st.solveGlow.get(i) || 0;
    const age = clamp((now - born) / 420, 0, 1);
    const pulse = 0.85 + 0.15 * Math.sin(now / 300 + i);
    const R = CS * 0.24 * (lit ? pulse * (1 + 0.25 * (1 - age)) : 0.9);

    ctx.save();
    ctx.translate(px, py);

    if (lit) {
      const glow = ctx.createRadialGradient(
        0,
        0,
        2,
        0,
        0,
        CS * (0.55 + 0.2 * age),
      );
      glow.addColorStop(0, "rgba(255,236,190,0.75)");
      glow.addColorStop(0.55, "rgba(255,210,122,0.28)");
      glow.addColorStop(1, "rgba(255,210,122,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-CS, -CS, CS * 2, CS * 2);
    }

    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = lit ? "#ffe9b8" : "#4d5a78";
    ctx.strokeStyle = lit ? "#fff4d6" : "#6d7c9e";
    ctx.lineWidth = 2;
    roundRect(-R, -R, R * 2, R * 2, R * 0.32);
    ctx.fill();
    ctx.stroke();
    if (lit) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      roundRect(-R * 0.45, -R * 0.45, R * 0.5, R * 0.5, R * 0.14);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSun(s, now) {
    const x = cx(s.x);
    const y = cy(s.y);
    const ang = Math.atan2(s.dy, s.dx);
    ctx.save();
    ctx.translate(x, y);

    /* corona */
    ctx.save();
    ctx.rotate(now / 2600);
    ctx.strokeStyle = "rgba(255,196,90,0.5)";
    ctx.lineWidth = 2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * CS * 0.3, Math.sin(a) * CS * 0.3);
      ctx.lineTo(Math.cos(a) * CS * 0.4, Math.sin(a) * CS * 0.4);
      ctx.stroke();
    }
    ctx.restore();

    const disc = ctx.createRadialGradient(
      -CS * 0.06,
      -CS * 0.06,
      2,
      0,
      0,
      CS * 0.3,
    );
    disc.addColorStop(0, "#fff3cf");
    disc.addColorStop(0.6, "#ffce73");
    disc.addColorStop(1, "#e89a44");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(0, 0, CS * 0.28, 0, TAU);
    ctx.fill();

    /* muzzle toward its bearing */
    ctx.rotate(ang);
    ctx.fillStyle = "#e89a44";
    ctx.fillRect(CS * 0.2, -CS * 0.075, CS * 0.17, CS * 0.15);
    ctx.restore();
  }

  function drawMotes(now) {
    for (const m of motes) {
      m.y -= m.v / 60;
      if (m.y < -0.02) {
        m.y = 1.02;
        m.x = Math.random();
      }
      const tw = 0.35 + 0.3 * Math.sin(now / 700 + m.p);
      ctx.fillStyle = "rgba(255,228,170," + (tw * 0.5).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(
        PAD + m.x * (VIEW - PAD * 2) + Math.sin(now / 1200 + m.p) * 6,
        PAD + m.y * (VIEW - PAD * 2),
        m.s,
        0,
        TAU,
      );
      ctx.fill();
    }
  }

  /* ── hud ─────────────────────────────────────────────── */

  function buildDots() {
    dotsEl.innerHTML = "";
    for (let i = 0; i < LEVELS.length; i++) {
      const d = document.createElement("span");
      d.className = "dot" + (i === chamberIx ? " here" : "");
      dotsEl.appendChild(d);
    }
    refreshDots();
  }

  function refreshDots() {
    const dots = dotsEl.children;
    for (let i = 0; i < dots.length; i++) {
      const solved = i < chamberIx || (celebrating && i === chamberIx);
      dots[i].classList.toggle("lit", solved);
      dots[i].classList.toggle("here", i === chamberIx);
    }
  }

  function updateReadout() {
    chamberNameEl.textContent = ROMAN[chamberIx] + " · " + st.name;
    moveCountEl.textContent = "turns " + chamberMoves + " · par " + st.par;
  }

  let toastTimer = 0;

  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms || 1600);
  }

  /* ── flow ────────────────────────────────────────────── */

  function celebrate() {
    celebrating = true;
    sndChamber();
    const kept = chamberMoves <= st.par;
    if (kept) goldCount++;
    totalMoves += chamberMoves;
    refreshDots();
    toast(
      "Chamber " + ROMAN[chamberIx] + " lit" + (kept ? " — under par" : ""),
      1500,
    );
    setTimeout(() => {
      if (chamberIx + 1 < LEVELS.length) loadChamber(chamberIx + 1);
      else showWin();
    }, 1500);
  }

  function showWin() {
    winStats.textContent =
      "Eight chambers, " +
      totalMoves +
      " turns — the par was " +
      TOTAL_PAR +
      ". " +
      goldCount +
      " of 8 met their par.";
    let verdict;
    if (totalMoves <= TOTAL_PAR) {
      verdict =
        "Not one turn wasted. The opticians of the valley will speak of this dawn for years.";
    } else if (totalMoves <= TOTAL_PAR + 4) {
      verdict =
        "A steady hand and a good eye. The light came up only a little late.";
    } else {
      verdict =
        "Roundabout routes, but the sun minds no detour. The valley wakes.";
    }
    winVerdict.textContent = verdict;
    introPanel.classList.add("hidden");
    winPanel.classList.remove("hidden");
    overlay.classList.remove("hidden");
    sndWin();
  }

  function flipMirror(cellIndex) {
    const li = looseIndexOf(cellIndex);
    if (li === undefined) return false;
    st.orient[li] = st.orient[li] === 0 ? 1 : 0;
    chamberMoves++;
    sndTick();
    simulate();
    updateReadout();
    return true;
  }

  function resetChamber() {
    if (celebrating || !started) return;
    st.orient = st.orientInit.slice();
    st.solveGlow.clear();
    chamberMoves = 0;
    simulate();
    updateReadout();
    toast("Mirrors squared away", 900);
  }

  function restartAll() {
    totalMoves = 0;
    goldCount = 0;
    loadChamber(0);
    overlay.classList.add("hidden");
    started = true;
  }

  /* ── input ───────────────────────────────────────────── */

  let hoverCell = -1;
  let focusCell = -1;

  function eventCell(e) {
    computeGeometry();
    const rect = cvs.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * VIEW;
    const py = ((e.clientY - rect.top) / rect.height) * VIEW;
    const gx = Math.floor((px - PAD) / CS);
    const gy = Math.floor((py - PAD) / CS);
    if (gx < 0 || gy < 0 || gx >= st.W || gy >= st.H) return -1;
    return gy * st.W + gx;
  }

  cvs.addEventListener("pointermove", (e) => {
    if (!st) return;
    hoverCell = eventCell(e);
  });

  cvs.addEventListener("pointerleave", () => {
    hoverCell = -1;
  });

  cvs.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!started || celebrating || !st) return;
    ensureAudio();
    const cell = eventCell(e);
    if (cell < 0) return;
    focusCell = cell;
    if (st.type[cell] === T_LOOSE) {
      flipMirror(cell);
    } else if (st.type[cell] === T_CRYSTAL && st.lit.has(cell)) {
      sndCrystal();
    } else {
      sndDeny();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (!st) return;
    const key = e.key;

    if (key === "r" || key === "R") {
      resetChamber();
      return;
    }
    if (!started) {
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        ensureAudio();
        restartAll();
      }
      return;
    }
    if (celebrating) return;

    const dirs = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };

    if (dirs[key]) {
      e.preventDefault();
      if (focusCell < 0) {
        focusCell = firstLooseCell();
        return;
      }
      const fx = focusCell % st.W;
      const fy = (focusCell - fx) / st.W;
      const nx = clamp(fx + dirs[key][0], 0, st.W - 1);
      const ny = clamp(fy + dirs[key][1], 0, st.H - 1);
      focusCell = ny * st.W + nx;
    } else if (key === "Enter" || key === " ") {
      e.preventDefault();
      ensureAudio();
      if (focusCell >= 0 && st.type[focusCell] === T_LOOSE)
        flipMirror(focusCell);
    }
  });

  function firstLooseCell() {
    for (let i = 0; i < st.type.length; i++) {
      if (st.type[i] === T_LOOSE) return i;
    }
    return -1;
  }

  beginBtn.addEventListener("click", () => {
    ensureAudio();
    restartAll();
  });

  againBtn.addEventListener("click", () => {
    ensureAudio();
    restartAll();
  });

  resetBtn.addEventListener("click", resetChamber);

  restartBtn.addEventListener("click", () => {
    if (!started) return;
    restartAll();
    toast("Back to the first shutter", 1000);
  });

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off");
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    if (soundOn) {
      ensureAudio();
      sndTick();
    }
  });

  /* ── pause when the tab hides ────────────────────────── */

  let paused = false;
  let rafId = 0;
  let lastT = 0;

  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    if (!paused) {
      lastT = performance.now();
      rafId = requestAnimationFrame(loop);
    } else if (actx) {
      actx.suspend().catch(() => {});
    }
  });

  function loop(now) {
    if (paused) return;
    lastT = now;
    draw(now);
    rafId = requestAnimationFrame(loop);
  }

  /* ── boot ────────────────────────────────────────────── */

  fitCanvas();
  window.addEventListener("resize", fitCanvas);
  loadChamber(0);
  overlay.classList.remove("hidden");
  rafId = requestAnimationFrame(loop);
})();
