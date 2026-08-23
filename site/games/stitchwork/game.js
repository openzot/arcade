/* Stitchwork — piece the quilt tops, then sew every seam true, before the
   candlelit lamp burns down. Vanilla JS, no dependencies. */
(() => {
  "use strict";

  /* ---------------- dom ---------------- */

  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const elOrderCount = $("order-count");
  const elNeedles = $("needle-pips");
  const elScrap = $("scrap-count");
  const elScrapBadge = $("scrap-badge");
  const elLampFill = $("lamp-fill");
  const elOrderline = $("orderline");
  const elToast = $("toast");

  /* ---------------- constants ---------------- */

  const W = 720;
  const H = 880;
  const CELL = 80;
  const MX = 40;
  const MY = 40;

  const LX = 100; // linen panel
  const LY = 130;
  const LW = 520;
  const LH = 630;

  const FABRICS = [
    { c: "#b23a48", n: "Madder Red" },
    { c: "#31597a", n: "Indigo Blue" },
    { c: "#d9a441", n: "Marigold" },
    { c: "#5d7a4e", n: "Sage Green" },
    { c: "#e8ddc4", n: "Muslin" },
    { c: "#8a6f56", n: "the scrap bag" },
  ];

  const THREADS = [
    { c: "#cf5340", n: "Scarlet" },
    { c: "#3f6ea5", n: "Steel Blue" },
  ];

  /* ---------------- block patterns ---------------- */

  const P = (x, y, shape, fab) => ({ x, y, shape, fab });

  const R = (x0, y0, x1, y1, shape, fab) => {
    const out = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) out.push(P(x, y, shape, fab));
    return out;
  };

  // a four-blade pinwheel unit: coloured blades around the centre, muslin behind
  const pinwheel = (x, y, a, b) => [
    P(x, y, "tri-br", a),
    P(x, y, "tri-tl", 4),
    P(x + 1, y, "tri-bl", b),
    P(x + 1, y, "tri-tr", 4),
    P(x, y + 1, "tri-tr", b),
    P(x, y + 1, "tri-bl", 4),
    P(x + 1, y + 1, "tri-tl", a),
    P(x + 1, y + 1, "tri-br", 4),
  ];

  const checkerCells = (() => {
    const out = [];
    for (let y = 3; y <= 6; y++)
      for (let x = 2; x <= 5; x++)
        out.push(P(x, y, "square", (x + y) % 2 === 0 ? 0 : 1));
    out.push(P(3, 2, "tri-s", 2), P(4, 2, "tri-s", 2));
    out.push(P(3, 7, "tri-n", 2), P(4, 7, "tri-n", 2));
    return out;
  })();

  const BLOCK_DEFS = [
    {
      name: "Sawtooth Star",
      cells: [
        ...R(3, 4, 4, 5, "square", 0),
        P(3, 3, "tri-s", 1),
        P(4, 3, "tri-s", 1),
        P(3, 6, "tri-n", 1),
        P(4, 6, "tri-n", 1),
        P(2, 4, "tri-e", 1),
        P(2, 5, "tri-e", 1),
        P(5, 4, "tri-w", 1),
        P(5, 5, "tri-w", 1),
        P(2, 2, "square", 2),
        P(5, 2, "square", 2),
        P(2, 7, "square", 2),
        P(5, 7, "square", 2),
      ],
    },
    {
      name: "Ohio Star",
      cells: [
        ...R(3, 4, 4, 5, "square", 0),
        P(2, 4, "tri-tl", 1),
        P(2, 4, "tri-br", 2),
        P(2, 5, "tri-tl", 1),
        P(2, 5, "tri-br", 2),
        P(5, 4, "tri-tr", 1),
        P(5, 4, "tri-bl", 2),
        P(5, 5, "tri-tr", 1),
        P(5, 5, "tri-bl", 2),
        P(3, 3, "tri-tr", 1),
        P(3, 3, "tri-bl", 2),
        P(4, 3, "tri-tr", 1),
        P(4, 3, "tri-bl", 2),
        P(3, 6, "tri-tr", 1),
        P(3, 6, "tri-bl", 2),
        P(4, 6, "tri-tr", 1),
        P(4, 6, "tri-bl", 2),
        P(2, 3, "square", 3),
        P(5, 3, "square", 3),
        P(2, 6, "square", 3),
        P(5, 6, "square", 3),
      ],
    },
    {
      name: "Marigold Path",
      cells: checkerCells,
    },
    {
      name: "Pinwheel Fields",
      cells: [
        ...pinwheel(2, 3, 1, 0),
        ...pinwheel(4, 3, 2, 3),
        ...pinwheel(2, 5, 3, 1),
        ...pinwheel(4, 5, 0, 2),
      ],
    },
    {
      name: "Log Cabin Lamp",
      cells: [
        ...R(3, 4, 4, 5, "square", 0),
        P(3, 3, "square", 1),
        P(4, 3, "square", 1),
        P(3, 6, "square", 1),
        P(4, 6, "square", 1),
        P(2, 4, "square", 2),
        P(2, 5, "square", 2),
        P(5, 4, "square", 2),
        P(5, 5, "square", 2),
        ...R(2, 2, 5, 2, "square", 3),
        ...R(2, 7, 5, 7, "square", 3),
        ...R(1, 3, 1, 6, "square", 2),
        ...R(6, 3, 6, 6, "square", 1),
        P(1, 2, "square", 0),
        P(6, 2, "square", 0),
        P(1, 7, "square", 0),
        P(6, 7, "square", 0),
      ],
    },
  ];

  /* which unit-grid edges a shape puts claims on.
     H:x:y = horizontal grid edge above row y; V:x:y = vertical edge left of col x;
     D0/D1 = main / anti diagonal of cell x,y. Intervals are 0..1 along the edge. */
  function claimsFor(cell) {
    const { x, y, shape } = cell;
    const c = [];
    const T = (k, a, b) => c.push({ k, a, b });
    switch (shape) {
      case "square":
        T(`H:${x}:${y}`, 0, 1);
        T(`H:${x}:${y + 1}`, 0, 1);
        T(`V:${x}:${y}`, 0, 1);
        T(`V:${x + 1}:${y}`, 0, 1);
        break;
      case "tri-tl":
        T(`H:${x}:${y}`, 0, 1);
        T(`V:${x}:${y}`, 0, 1);
        T(`D1:${x}:${y}`, 0, 1);
        break;
      case "tri-tr":
        T(`H:${x}:${y}`, 0, 1);
        T(`V:${x + 1}:${y}`, 0, 1);
        T(`D0:${x}:${y}`, 0, 1);
        break;
      case "tri-bl":
        T(`H:${x}:${y + 1}`, 0, 1);
        T(`V:${x}:${y}`, 0, 1);
        T(`D0:${x}:${y}`, 0, 1);
        break;
      case "tri-br":
        T(`H:${x}:${y + 1}`, 0, 1);
        T(`V:${x + 1}:${y}`, 0, 1);
        T(`D1:${x}:${y}`, 0, 1);
        break;
      case "tri-n":
        T(`H:${x}:${y}`, 0, 1);
        break;
      case "tri-s":
        T(`H:${x}:${y + 1}`, 0, 1);
        break;
      case "tri-e":
        T(`V:${x + 1}:${y}`, 0, 1);
        break;
      case "tri-w":
        T(`V:${x}:${y}`, 0, 1);
        break;
    }
    return c;
  }

  /* ---------------- state ---------------- */

  const S = {
    phase: "boot", // boot | intro | piece | sew | blockdone | over | won
    order: [], // block defs for this commission, in work order
    blockIdx: 0,
    needles: 3,
    lamp: 100,
    scraps: 3,
    snapsTotal: 0,
    snappedIn: [false, false, false, false, false],
    skipped: 0,
    sewnTotal: 0,
    selFab: -1,
    selThr: -1,
    blk: null,
    undo: [],
    paused: false,
    muted: false,
    kb: false,
    hoverHole: -1,
    hoverSeam: -1,
    helpFrom: "intro",
  };

  /* ---------------- audio ---------------- */

  let AC = null;

  function ensureAudio() {
    if (S.muted) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!AC) {
      try {
        AC = new Ctor();
      } catch (_err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume().catch(() => {});
  }

  function tone(freq, dur, type, vol, delay = 0, slideTo = null) {
    if (!AC || S.muted) return;
    const t0 = AC.currentTime + delay;
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo)
      o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(AC.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, delay = 0, hp = 1000) {
    if (!AC || S.muted) return;
    const n = (AC.sampleRate * dur) | 0;
    const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = AC.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(AC.destination);
    src.start(AC.currentTime + delay);
  }

  const sndPlace = () => {
    tone(150, 0.09, "sine", 0.22, 0, 105);
    noise(0.05, 0.05, 0, 2600);
  };
  const sndSew = () => {
    tone(940, 0.03, "square", 0.07);
    tone(700, 0.03, "square", 0.07, 0.07);
  };
  const sndSnap = () => {
    noise(0.14, 0.28, 0, 1400);
    tone(430, 0.17, "sawtooth", 0.2, 0, 70);
  };
  const sndBlock = (perfect) => {
    const seq = perfect ? [523, 659, 784, 1047] : [392, 494, 587];
    seq.forEach((f, i) => tone(f, 0.14, "triangle", 0.13, i * 0.09));
  };
  const sndGutter = () => {
    tone(215, 0.5, "sawtooth", 0.16, 0, 55);
    noise(0.42, 0.1, 0, 380);
  };
  const sndWin = () => {
    [523, 659, 784, 880, 1047].forEach((f, i) =>
      tone(f, 0.16, "triangle", 0.14, i * 0.11),
    );
  };

  /* ---------------- block building ---------------- */

  function seamEnds(s) {
    const parts = s.key.split(":");
    const kind = parts[0];
    const x = +parts[1];
    const y = +parts[2];
    if (kind === "H")
      return [
        [MX + (x + s.t0) * CELL, MY + y * CELL],
        [MX + (x + s.t1) * CELL, MY + y * CELL],
      ];
    if (kind === "V")
      return [
        [MX + x * CELL, MY + (y + s.t0) * CELL],
        [MX + x * CELL, MY + (y + s.t1) * CELL],
      ];
    if (kind === "D0")
      return [
        [MX + (x + s.t0) * CELL, MY + (y + s.t0) * CELL],
        [MX + (x + s.t1) * CELL, MY + (y + s.t1) * CELL],
      ];
    return [
      [MX + (x + 1 - s.t0) * CELL, MY + (y + s.t0) * CELL],
      [MX + (x + 1 - s.t1) * CELL, MY + (y + s.t1) * CELL],
    ];
  }

  function cellPath(c) {
    const p = new Path2D();
    const px = MX + c.x * CELL;
    const py = MY + c.y * CELL;
    const q = CELL / 2;
    switch (c.shape) {
      case "square":
        p.rect(px, py, CELL, CELL);
        break;
      case "tri-tl":
        p.moveTo(px, py);
        p.lineTo(px + CELL, py);
        p.lineTo(px, py + CELL);
        break;
      case "tri-tr":
        p.moveTo(px, py);
        p.lineTo(px + CELL, py);
        p.lineTo(px + CELL, py + CELL);
        break;
      case "tri-bl":
        p.moveTo(px, py);
        p.lineTo(px, py + CELL);
        p.lineTo(px + CELL, py + CELL);
        break;
      case "tri-br":
        p.moveTo(px + CELL, py);
        p.lineTo(px, py + CELL);
        p.lineTo(px + CELL, py + CELL);
        break;
      case "tri-n":
        p.moveTo(px, py);
        p.lineTo(px + CELL, py);
        p.lineTo(px + q, py + CELL);
        break;
      case "tri-s":
        p.moveTo(px, py + CELL);
        p.lineTo(px + q, py);
        p.lineTo(px + CELL, py + CELL);
        break;
      case "tri-e":
        p.moveTo(px + CELL, py);
        p.lineTo(px + CELL, py + CELL);
        p.lineTo(px, py + q);
        break;
      case "tri-w":
        p.moveTo(px, py);
        p.lineTo(px, py + CELL);
        p.lineTo(px + CELL, py + q);
        break;
    }
    p.closePath();
    return p;
  }

  function buildBlockAt(orderPos) {
    const def = S.order[orderPos];
    const cells = def.cells.map((c, i) => ({
      ...c,
      i,
      filled: false,
      usedFab: -1,
      revealed: false,
      path: null,
    }));
    cells.forEach((c) => (c.path = cellPath(c)));

    const byKey = new Map();
    cells.forEach((cell) => {
      for (const cl of claimsFor(cell)) {
        if (!byKey.has(cl.k)) byKey.set(cl.k, []);
        byKey.get(cl.k).push({ i: cell.i, t0: cl.a, t1: cl.b });
      }
    });

    const seams = [];
    for (const [k, list] of byKey) {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const A = list[a];
          const B = list[b];
          const t0 = Math.max(A.t0, B.t0);
          const t1 = Math.min(A.t1, B.t1);
          if (t1 - t0 > 0.06) {
            seams.push({
              idx: seams.length,
              key: k,
              t0,
              t1,
              cells: [A.i, B.i],
              thr: k.charAt(0) === "H" ? 0 : 1,
              sewn: false,
              skipped: false,
              revealed: false,
            });
          }
        }
      }
    }

    seams.forEach((s) => {
      const e = seamEnds(s);
      s.ax = e[0][0];
      s.ay = e[0][1];
      s.bx = e[1][0];
      s.by = e[1][1];
      s.mx = (s.ax + s.bx) / 2;
      s.my = (s.ay + s.by) / 2;
    });
    seams.sort((p, r) => p.my - r.my || p.mx - r.mx);
    seams.forEach((s, i) => (s.idx = i));

    // piece order: breadth-first from the cell nearest the panel centre,
    // so every patch touches one already laid; isolated patches go last
    const adj = cells.map(() => []);
    seams.forEach((s) => {
      adj[s.cells[0]].push(s.cells[1]);
      adj[s.cells[1]].push(s.cells[0]);
    });
    let seed = 0;
    let bestD = Infinity;
    cells.forEach((c) => {
      const d = Math.abs(c.x + 0.5 - 4) + Math.abs(c.y + 0.5 - 5);
      if (d < bestD) {
        bestD = d;
        seed = c.i;
      }
    });
    const seen = new Set([seed]);
    const ord = [seed];
    const queue = [seed];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of adj[cur]) {
        if (!seen.has(nb)) {
          seen.add(nb);
          ord.push(nb);
          queue.push(nb);
        }
      }
    }
    cells.forEach((c) => {
      if (!seen.has(c.i)) ord.push(c.i);
    });

    return {
      def,
      cells,
      seams,
      holeOrder: ord,
      cursor: ord[0],
      seamCursor: -1,
      snaps: 0,
    };
  }

  /* ---------------- geometry queries ---------------- */

  function ptInCell(c, gx, gy) {
    const u = (gx - MX) / CELL - c.x;
    const v = (gy - MY) / CELL - c.y;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    switch (c.shape) {
      case "square":
        return true;
      case "tri-tl":
        return u + v <= 1;
      case "tri-tr":
        return v <= u;
      case "tri-bl":
        return v >= u;
      case "tri-br":
        return u + v >= 1;
      case "tri-n":
        return v <= 2 * u && v <= 2 - 2 * u;
      case "tri-s":
        return v >= Math.abs(1 - 2 * u);
      case "tri-e":
        return u >= Math.abs(1 - 2 * v);
      case "tri-w":
        return u <= 2 * v && u <= 2 - 2 * v;
      default:
        return false;
    }
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - py;
    return Math.hypot(ex, ey);
  }

  function pickHole(x, y) {
    const cells = S.blk.cells;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (!cells[i].filled && ptInCell(cells[i], x, y)) return i;
    }
    return -1;
  }

  function pickSeam(x, y) {
    let best = -1;
    let bestD = 11;
    for (const s of S.blk.seams) {
      if (s.sewn) continue;
      const d = distToSegment(x, y, s.ax, s.ay, s.bx, s.by);
      if (d < bestD) {
        bestD = d;
        best = s.idx;
      }
    }
    return best;
  }

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  }

  /* ---------------- ui helpers ---------------- */

  let toastTimer = 0;
  function toast(msg, ms = 2400) {
    elToast.textContent = msg;
    elToast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove("show"), ms);
  }

  const overlays = () => Array.from(document.querySelectorAll(".overlay"));
  const overlayOpen = () =>
    overlays().some((o) => !o.classList.contains("hidden"));
  const show = (el) => el.classList.remove("hidden");
  const hide = (el) => el.classList.add("hidden");

  function updateHUD() {
    const playing = S.phase === "piece" || S.phase === "sew";
    elOrderCount.textContent = `${Math.min(S.blockIdx + 1, S.order.length)} / ${S.order.length}`;
    elNeedles.textContent =
      "♥".repeat(S.needles) + "♡".repeat(Math.max(0, 3 - S.needles));
    elScrap.textContent = String(S.scraps);
    elScrapBadge.textContent = String(S.scraps);
    elLampFill.style.width = `${Math.max(0, S.lamp)}%`;
    elLampFill.classList.toggle("low", S.lamp < 28);

    if (S.phase === "intro" || S.phase === "boot") {
      elOrderline.textContent = "A commission of five quilt blocks";
    } else if (playing) {
      elOrderline.textContent =
        `Block ${S.blockIdx + 1} — ${S.blk.def.name} · ` +
        (S.phase === "piece" ? "piecing the top" : "sewing the seams");
    } else {
      elOrderline.textContent = "The workshop rests";
    }

    document.querySelectorAll(".swatch").forEach((sw) => {
      sw.classList.toggle("selected-swatch", +sw.dataset.fab === S.selFab);
    });
    document.querySelectorAll(".thread-row").forEach((tr) => {
      tr.classList.toggle("selected-thread", +tr.dataset.thr === S.selThr);
    });
    $("btn-skip").disabled = !playing || S.needles <= 0;
  }

  /* ---------------- game actions ---------------- */

  function newCommission() {
    const idx = [0, 1, 2, 3, 4];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    S.order = idx.map((i) => BLOCK_DEFS[i]);
    S.blockIdx = 0;
    S.needles = 3;
    S.lamp = 100;
    S.scraps = 3;
    S.snapsTotal = 0;
    S.snappedIn = [false, false, false, false, false];
    S.skipped = 0;
    S.sewnTotal = 0;
    S.selFab = -1;
    S.selThr = -1;
    S.undo = [];
    S.paused = false;
    S.hoverHole = -1;
    S.hoverSeam = -1;
    S.blk = buildBlockAt(0);
    S.phase = "piece";
    overlays().forEach(hide);
    updateHUD();
  }

  function unfilledList() {
    return S.blk.holeOrder.filter((i) => !S.blk.cells[i].filled);
  }
  function unsewnList() {
    return S.blk.seams.filter((s) => !s.sewn).map((s) => s.idx);
  }

  function activeHoleIdx() {
    return S.kb ? S.blk.cursor : S.hoverHole >= 0 ? S.hoverHole : S.blk.cursor;
  }
  function activeSeamIdx() {
    return S.kb
      ? S.blk.seamCursor
      : S.hoverSeam >= 0
        ? S.hoverSeam
        : S.blk.seamCursor;
  }

  function focusCell(i) {
    S.blk.cursor = i;
    S.blk.cells[i].revealed = true;
    S.kb = true;
  }

  function cycle(dir) {
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    if (S.phase === "piece") {
      const list = unfilledList();
      if (!list.length) return;
      const pos = list.indexOf(S.blk.cursor);
      const at = pos < 0 ? 0 : (pos + dir + list.length) % list.length;
      focusCell(list[at]);
    } else {
      const list = unsewnList();
      if (!list.length) return;
      const pos = list.indexOf(S.blk.seamCursor);
      const at = pos < 0 ? 0 : (pos + dir + list.length) % list.length;
      S.blk.seamCursor = list[at];
      S.blk.seams[list[at]].revealed = true;
      S.kb = true;
    }
  }

  function advanceCursor() {
    const ord = S.blk.holeOrder;
    const pos = ord.indexOf(S.blk.cursor);
    for (let k = 1; k <= ord.length; k++) {
      const j = ord[(Math.max(pos, 0) + k) % ord.length];
      if (!S.blk.cells[j].filled) {
        focusCell(j);
        return;
      }
    }
  }

  function attemptPlace(c) {
    if (c.filled) return;
    if (S.selFab < 0) {
      toast("Choose a fabric from the tray first — keys 1 to 5.");
      return;
    }
    if (S.selFab === 5) {
      if (S.scraps <= 0) {
        toast("The scrap bag is empty.");
        return;
      }
      fillPatch(c, 5, true);
      return;
    }
    if (S.selFab !== c.fab) {
      toast(`That patch wants ${FABRICS[c.fab].n}.`);
      return;
    }
    fillPatch(c, c.fab, false);
  }

  function fillPatch(c, fab, scrap) {
    c.filled = true;
    c.usedFab = fab;
    if (scrap) S.scraps--;
    S.undo.push({ t: "f", i: c.i, scrap });
    sndPlace();
    if (S.blk.cells.every((x) => x.filled)) beginSewing();
    else advanceCursor();
    updateHUD();
  }

  function beginSewing() {
    S.phase = "sew";
    const first = unsewnList()[0];
    S.blk.seamCursor = first === undefined ? -1 : first;
    if (first !== undefined) S.blk.seams[first].revealed = true;
    sndBlock(false);
    toast(
      "Top pieced! Now load a thread (Q scarlet / E steel) and sew every dashed seam.",
    );
    updateHUD();
  }

  function attemptSew(sm) {
    if (sm.sewn) return;
    if (S.selThr < 0) {
      toast("Load a thread first — Q for scarlet, E for steel blue.");
      return;
    }
    if (sm.thr !== S.selThr) {
      snapThread();
      return;
    }
    sm.sewn = true;
    S.sewnTotal++;
    S.undo.push({ t: "s", i: sm.idx });
    sndSew();
    if (S.blk.seams.every((x) => x.sewn)) blockDone(false);
    else {
      const list = unsewnList();
      const pos = list.indexOf(sm.idx);
      const nxt = list[(pos + 1) % list.length];
      S.blk.seamCursor = nxt;
      S.blk.seams[nxt].revealed = true;
    }
    updateHUD();
  }

  function snapThread() {
    S.needles--;
    S.snapsTotal++;
    S.snappedIn[S.blockIdx] = true;
    S.blk.snaps++;
    S.lamp = Math.max(0, S.lamp - 4);
    sndSnap();
    toast(
      `Snap! Wrong thread — the needle breaks. ${S.needles} needle${S.needles === 1 ? "" : "s"} left.`,
      2600,
    );
    if (S.needles <= 0) gameOver("needles");
    updateHUD();
  }

  function blockDone(skipped) {
    const perfect = !S.snappedIn[S.blockIdx] && !skipped;
    if (skipped) {
      S.skipped++;
      S.lamp = Math.min(100, S.lamp + 6);
    } else {
      S.lamp = Math.min(100, S.lamp + (perfect ? 26 : 16));
      if (perfect && S.needles < 3) S.needles++;
    }
    S.phase = "blockdone";
    $("block-h").textContent = `${S.blk.def.name} — set aside`;
    $("block-report").textContent = skipped
      ? "Skipped. The frame moves on — the lamp gets only a splash of oil."
      : perfect
        ? "Every patch true, every seam unbroken. The lamp drinks deep."
        : `Snapped seams this block: ${S.blk.snaps}. The lamp takes its oil.`;
    $("block-stamp").textContent = skipped
      ? "· skipped ·"
      : perfect
        ? "❁ flawless ❁"
        : "✚ lamp refilled";
    $("btn-next-block").textContent =
      S.blockIdx + 1 >= S.order.length ? "Deliver the order" : "Next block";
    sndBlock(perfect);
    show($("block-overlay"));
    updateHUD();
  }

  function nextBlock() {
    hide($("block-overlay"));
    S.blockIdx++;
    if (S.blockIdx >= S.order.length) {
      winGame();
      return;
    }
    S.undo = [];
    S.blk = buildBlockAt(S.blockIdx);
    S.phase = "piece";
    S.hoverHole = -1;
    S.hoverSeam = -1;
    toast(`Next: ${S.blk.def.name}. Piece the top.`);
    updateHUD();
  }

  function restartBlock() {
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    S.undo = [];
    S.blk = buildBlockAt(S.blockIdx);
    S.phase = "piece";
    S.hoverHole = -1;
    S.hoverSeam = -1;
    toast("The block comes apart — back to the first patch.");
    updateHUD();
  }

  function skipBlock() {
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    if (S.needles <= 0) {
      toast("No needle left to skip with.");
      return;
    }
    S.needles--;
    S.blk.cells.forEach((c) => {
      if (!c.filled) {
        c.filled = true;
        c.usedFab = c.fab;
        c.revealed = true;
      }
    });
    S.blk.seams.forEach((s) => {
      if (!s.sewn) {
        s.sewn = true;
        s.skipped = true;
        s.revealed = true;
      }
    });
    sndSnap();
    blockDone(true);
  }

  function undoAction() {
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    const a = S.undo.pop();
    if (!a) {
      toast("Nothing to unpick.");
      return;
    }
    if (a.t === "f") {
      const c = S.blk.cells[a.i];
      c.filled = false;
      c.usedFab = -1;
      if (a.scrap) S.scraps++;
      if (S.phase === "sew") S.phase = "piece";
      focusCell(c.i);
    } else {
      const sm = S.blk.seams[a.i];
      sm.sewn = false;
      S.sewnTotal = Math.max(0, S.sewnTotal - 1);
      S.blk.seamCursor = sm.idx;
      sm.revealed = true;
    }
    sndPlace();
    updateHUD();
  }

  function gutter() {
    S.lamp = 0;
    sndGutter();
    S.needles--;
    if (S.needles <= 0) {
      S.needles = 0;
      gameOver("lamp");
    } else {
      S.lamp = 58;
      toast(
        "The lamp gutters out! You trim the wick by feel — a needle lost in the dark.",
        3000,
      );
    }
    updateHUD();
  }

  function gameOver(reason) {
    S.phase = "over";
    $("end-h").textContent =
      reason === "lamp" ? "The lamp goes out" : "Three needles snapped";
    $("end-report").innerHTML =
      `Blocks set aside: ${S.blockIdx} of ${S.order.length}.<br>` +
      `Seams sewn true: ${S.sewnTotal}.<br>` +
      "The commission goes back to the basket, half-done. Tomorrow, another lamp.";
    $("end-grade").textContent = "✂ ✂ ✂";
    show($("end-overlay"));
    updateHUD();
  }

  function winGame() {
    S.phase = "won";
    let grade;
    let stars;
    if (S.snapsTotal === 0 && S.skipped === 0) {
      grade = "Master Quilter — not one seam snapped.";
      stars = "★ ★ ★";
    } else if (S.snapsTotal <= 3) {
      grade = "Journeyman of the Frame — honest, even stitches.";
      stars = "★ ★ ☆";
    } else {
      grade = "Steady Apprentice — the quilt holds, mostly.";
      stars = "★ ☆ ☆";
    }
    $("end-h").textContent = "Commission delivered";
    $("end-report").innerHTML =
      `All ${S.order.length} blocks set and sewn.<br>` +
      `Snapped needles: ${3 - S.needles} · Snapped seams: ${S.snapsTotal} · ` +
      `Blocks skipped: ${S.skipped}.<br>` +
      `Oil left in the lamp: ${Math.round(S.lamp)}%.<br>${grade}`;
    $("end-grade").textContent = stars;
    sndWin();
    show($("end-overlay"));
    updateHUD();
  }

  /* ---------------- input: pointer ---------------- */

  function updateHover(x, y) {
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    if (S.phase === "piece") {
      const i = pickHole(x, y);
      S.hoverHole = i;
      if (i >= 0) {
        S.blk.cells[i].revealed = true;
        S.kb = false;
      }
    } else {
      const i = pickSeam(x, y);
      S.hoverSeam = i;
      if (i >= 0) {
        S.blk.seams[i].revealed = true;
        S.kb = false;
      }
    }
  }

  canvas.addEventListener("pointermove", (e) => {
    const p = toCanvas(e);
    updateHover(p.x, p.y);
  });

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    const p = toCanvas(e);
    if (S.phase === "piece") {
      const i = pickHole(p.x, p.y);
      if (i < 0) return;
      const c = S.blk.cells[i];
      S.kb = false;
      if (!c.revealed) {
        c.revealed = true;
        S.blk.cursor = i;
        updateHover(p.x, p.y);
        return;
      }
      attemptPlace(c);
    } else {
      const i = pickSeam(p.x, p.y);
      if (i < 0) return;
      const sm = S.blk.seams[i];
      S.kb = false;
      S.blk.seamCursor = i;
      if (!sm.revealed) {
        sm.revealed = true;
        return;
      }
      attemptSew(sm);
    }
  });

  /* ---------------- input: keyboard ---------------- */

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const low = k.toLowerCase();
    const handled = [
      "arrowleft",
      "arrowright",
      "arrowup",
      "arrowdown",
      " ",
      "enter",
      "z",
      "r",
      "p",
      "m",
      "h",
      "q",
      "e",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "escape",
      "w",
      "a",
      "s",
      "d",
    ];
    if (!handled.includes(low)) return;
    e.preventDefault();
    ensureAudio();

    if (low === "escape") {
      const help = $("help-overlay");
      if (!help.classList.contains("hidden")) {
        hide(help);
        if (S.helpFrom === "intro") show($("intro-overlay"));
      }
      return;
    }
    if (low === "h") {
      const help = $("help-overlay");
      if (help.classList.contains("hidden")) {
        S.helpFrom = overlayOpen() ? "intro" : "game";
        if (S.helpFrom === "intro") overlays().forEach(hide);
        show(help);
      }
      return;
    }
    if (low === "m") {
      toggleMute();
      return;
    }
    if (low === "p") {
      if (S.phase === "piece" || S.phase === "sew") {
        S.paused = !S.paused;
        toast(S.paused ? "Paused — the lamp waits." : "Back to work.");
      }
      return;
    }
    if (!$("help-overlay").classList.contains("hidden")) return; // other keys idle under help

    switch (low) {
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
        selectFab(+low - 1);
        break;
      case "q":
        selectThread(0);
        break;
      case "e":
        selectThread(1);
        break;
      case "z":
        undoAction();
        break;
      case "r":
        restartBlock();
        break;
      case "arrowleft":
      case "arrowup":
      case "w":
      case "a":
        cycle(-1);
        break;
      case "arrowright":
      case "arrowdown":
      case "s":
      case "d":
        cycle(1);
        break;
      case " ":
      case "enter":
        actOnActive();
        break;
    }
  });

  function actOnActive() {
    if (!(S.phase === "piece" || S.phase === "sew")) return;
    if (S.phase === "piece") {
      const i = activeHoleIdx();
      if (i < 0) return;
      const c = S.blk.cells[i];
      if (!c.revealed) {
        c.revealed = true;
        return;
      }
      attemptPlace(c);
    } else {
      const i = activeSeamIdx();
      if (i < 0) return;
      const sm = S.blk.seams[i];
      if (!sm.revealed) {
        sm.revealed = true;
        return;
      }
      attemptSew(sm);
    }
  }

  /* ---------------- tray & palette ---------------- */

  function selectFab(f) {
    S.selFab = f;
    updateHUD();
  }
  function selectThread(t) {
    S.selThr = t;
    updateHUD();
  }

  document.querySelectorAll(".swatch").forEach((sw) => {
    const pick = () => {
      ensureAudio();
      selectFab(+sw.dataset.fab);
    };
    sw.addEventListener("click", pick);
    sw.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        pick();
      }
    });
  });

  document.querySelectorAll(".thread-row").forEach((tr) => {
    const pick = () => {
      ensureAudio();
      selectThread(+tr.dataset.thr);
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        pick();
      }
    });
  });

  document.querySelectorAll(".thread-row").forEach((tr) => {
    tr.textContent =
      tr.dataset.thr === "0"
        ? "Scarlet · level seams"
        : "Steel · standing & slant";
  });

  /* ---------------- buttons ---------------- */

  const wireButton = (id, fn) => {
    $(id).addEventListener("click", (e) => {
      ensureAudio();
      fn();
      e.currentTarget.blur();
    });
  };

  wireButton("btn-start", () => {
    hide($("intro-overlay"));
    S.phase = "piece";
    toast(
      "Pick a fabric, then click the marked patch. Hover to see what each wants.",
    );
    updateHUD();
  });
  wireButton("btn-how", () => {
    S.helpFrom = "intro";
    overlays().forEach(hide);
    show($("help-overlay"));
  });
  wireButton("btn-help", () => {
    S.helpFrom = "game";
    show($("help-overlay"));
  });
  wireButton("btn-help-close", () => {
    hide($("help-overlay"));
    if (S.helpFrom === "intro") show($("intro-overlay"));
  });
  wireButton("btn-next-block", nextBlock);
  wireButton("btn-restart", () => {
    newCommission();
    toast("A fresh commission is pinned to the frame.");
  });
  wireButton("btn-restart2", () => {
    newCommission();
    toast("A fresh commission is pinned to the frame.");
  });
  wireButton("btn-again", () => {
    newCommission();
    toast("A new order arrives with the morning post.");
  });
  wireButton("btn-skip", skipBlock);
  wireButton("btn-mute", toggleMute);

  function toggleMute() {
    S.muted = !S.muted;
    const b = $("btn-mute");
    b.textContent = S.muted ? "Sound: off" : "Sound: on";
    b.setAttribute("aria-pressed", String(S.muted));
    if (!S.muted) ensureAudio();
  }

  document.addEventListener("visibilitychange", () => {
    if (
      document.hidden &&
      (S.phase === "piece" || S.phase === "sew") &&
      !S.paused
    ) {
      S.paused = true;
      toast("Paused — press P to resume.");
    }
  });

  /* ---------------- drawing ---------------- */

  const DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const weave = (() => {
    const c = document.createElement("canvas");
    c.width = 22;
    c.height = 22;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(110, 82, 46, 0.07)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 5.5);
    g.lineTo(22, 5.5);
    g.moveTo(0, 16.5);
    g.lineTo(22, 16.5);
    g.moveTo(5.5, 0);
    g.lineTo(5.5, 22);
    g.moveTo(16.5, 0);
    g.lineTo(16.5, 22);
    g.stroke();
    return ctx.createPattern(c, "repeat");
  })();

  function rr(x, y, w, h, r) {
    const p = new Path2D();
    p.moveTo(x + r, y);
    p.arcTo(x + w, y, x + w, y + h, r);
    p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r);
    p.arcTo(x, y, x + w, y, r);
    p.closePath();
    return p;
  }

  function drawPanel() {
    const panel = rr(LX, LY, LW, LH, 14);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ece0c4";
    ctx.fill(panel);
    ctx.restore();
    ctx.fillStyle = weave;
    ctx.fill(panel);
    ctx.strokeStyle = "#c9b184";
    ctx.lineWidth = 2;
    ctx.stroke(panel);

    if (!S.blk) return;
    ctx.textAlign = "center";
    ctx.fillStyle = "#6b4e2e";
    ctx.font = "700 25px Georgia, serif";
    ctx.fillText(S.blk.def.name, W / 2, LY + 36);

    const cells = S.blk.cells;
    const filled = cells.filter((c) => c.filled).length;
    const sewn = S.blk.seams.filter((s) => s.sewn).length;
    ctx.font = "italic 13px Georgia, serif";
    ctx.fillStyle = "#8a6f4a";
    if (S.phase === "sew") {
      ctx.fillText(
        `Seams ${sewn} / ${S.blk.seams.length} — the wrong thread snaps a needle`,
        W / 2,
        LY + LH - 20,
      );
    } else {
      ctx.fillText(
        `Patches ${filled} / ${cells.length} — hover a pale patch to see its fabric`,
        W / 2,
        LY + LH - 20,
      );
    }
  }

  function paintPrint(c, px, py, fab) {
    switch (fab) {
      case 0: {
        ctx.fillStyle = "rgba(255,235,225,0.32)";
        for (let gy = 8; gy < CELL; gy += 16) {
          for (let gx = 8; gx < CELL; gx += 16) {
            const off = (gy / 16) % 2 === 0 ? 0 : 8;
            ctx.beginPath();
            ctx.arc(px + gx + off - 8 + 4, py + gy, 2.1, 0, 7);
            ctx.fill();
          }
        }
        break;
      }
      case 1: {
        ctx.strokeStyle = "rgba(220,235,255,0.25)";
        ctx.lineWidth = 2;
        for (let d = -CELL; d < CELL * 2; d += 13) {
          ctx.beginPath();
          ctx.moveTo(px + d, py);
          ctx.lineTo(px + d + CELL, py + CELL);
          ctx.stroke();
        }
        break;
      }
      case 2: {
        ctx.strokeStyle = "rgba(255,248,220,0.35)";
        ctx.lineWidth = 1.4;
        for (let gy = 10; gy < CELL; gy += 20) {
          for (let gx = 10; gx < CELL; gx += 20) {
            ctx.beginPath();
            ctx.arc(px + gx, py + gy, 4.6, 0, 7);
            ctx.stroke();
          }
        }
        break;
      }
      case 3: {
        ctx.strokeStyle = "rgba(230,245,215,0.2)";
        ctx.lineWidth = 1.3;
        for (let d = -CELL; d < CELL * 2; d += 11) {
          ctx.beginPath();
          ctx.moveTo(px + d, py);
          ctx.lineTo(px + d + CELL, py + CELL);
          ctx.moveTo(px + d + CELL, py);
          ctx.lineTo(px + d, py + CELL);
          ctx.stroke();
        }
        break;
      }
      case 4: {
        let seed = c.i * 2654435761;
        ctx.fillStyle = "rgba(90,70,40,0.14)";
        for (let k = 0; k < 14; k++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const gx = (seed >>> 8) % CELL;
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const gy = (seed >>> 8) % CELL;
          ctx.beginPath();
          ctx.arc(px + gx, py + gy, 1.2, 0, 7);
          ctx.fill();
        }
        break;
      }
      default: {
        // scrap bag: bands of the four prints
        const bands = ["#b23a48", "#31597a", "#d9a441", "#5d7a4e"];
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = bands[k];
          ctx.globalAlpha = 0.55;
          ctx.fillRect(px, py + (CELL / 4) * k, CELL, CELL / 4);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = "rgba(255,244,214,0.5)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 4]);
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(px, py + (CELL / 4) * k);
          ctx.lineTo(px + CELL, py + (CELL / 4) * k);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        break;
      }
    }
  }

  function drawCell(c, t) {
    const px = MX + c.x * CELL;
    const py = MY + c.y * CELL;
    if (c.filled) {
      ctx.save();
      ctx.clip(c.path);
      ctx.fillStyle = FABRICS[c.usedFab].c;
      ctx.fillRect(px, py, CELL, CELL);
      paintPrint(c, px, py, c.usedFab);
      ctx.restore();
      ctx.strokeStyle = "rgba(30,18,8,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke(c.path);
      return;
    }
    const active = activeHoleIdx() === c.i;
    ctx.fillStyle = "rgba(242,228,201,0.08)";
    ctx.fill(c.path);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = active ? 2.6 : 1.4;
    ctx.strokeStyle =
      active && !S.paused
        ? `rgba(244,217,160,${0.65 + 0.3 * Math.sin(t * 5)})`
        : c.revealed
          ? "rgba(242,228,201,0.5)"
          : "rgba(242,228,201,0.32)";
    ctx.stroke(c.path);
    ctx.setLineDash([]);
    if (c.revealed) {
      // small diamond showing the wanted colour
      ctx.fillStyle = FABRICS[c.fab].c;
      ctx.save();
      ctx.translate(px + CELL / 2, py + CELL / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.restore();
      ctx.strokeStyle = "rgba(30,18,8,0.5)";
      ctx.lineWidth = 1;
      ctx.save();
      ctx.translate(px + CELL / 2, py + CELL / 2);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-4.5, -4.5, 9, 9);
      ctx.restore();
    }
  }

  function drawSeams(t) {
    const sewing = S.phase === "sew";
    const act = activeSeamIdx();
    for (const s of S.blk.seams) {
      const both = s.cells.every((i) => S.blk.cells[i].filled);
      if (!sewing) {
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(60,42,20,${both ? 0.28 : 0.12})`;
        ctx.beginPath();
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (s.sewn) {
        ctx.setLineDash([]);
        ctx.lineWidth = s.skipped ? 3 : 3.5;
        ctx.strokeStyle = s.skipped ? "#9a8b74" : THREADS[s.thr].c;
        ctx.beginPath();
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
        ctx.stroke();
        if (!s.skipped) {
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = "rgba(255,248,232,0.75)";
          ctx.beginPath();
          ctx.moveTo(s.ax, s.ay);
          ctx.lineTo(s.bx, s.by);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        continue;
      }
      const isActive = act === s.idx;
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = isActive ? 4.5 : s.revealed ? 3.4 : 2.4;
      ctx.strokeStyle = THREADS[s.thr].c;
      ctx.globalAlpha = isActive ? 0.95 : s.revealed ? 0.75 : 0.45;
      if (isActive) {
        ctx.save();
        ctx.shadowColor = THREADS[s.thr].c;
        ctx.shadowBlur = 9;
      }
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
      ctx.stroke();
      if (isActive) ctx.restore();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      if (isActive && !S.paused) {
        const wob = Math.sin(t * 5) * 1.6;
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(244,217,160,${0.7 + 0.2 * Math.sin(t * 5)})`;
        ctx.beginPath();
        ctx.moveTo(s.ax - wob, s.ay + wob);
        ctx.lineTo(s.bx - wob, s.by + wob);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawBadge(px, py, color, label) {
    ctx.font = "12px Georgia, serif";
    const w = Math.max(96, ctx.measureText(label).width + 44);
    let bx = px - w / 2;
    bx = Math.max(8, Math.min(W - w - 8, bx));
    let by = py - 52;
    if (by < LY + 6) by = py + 18;
    ctx.fillStyle = "rgba(24,15,6,0.88)";
    const bg = rr(bx, by, w, 26, 13);
    ctx.fill(bg);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke(bg);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx + 15, by + 13, 6, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#f2e4c9";
    ctx.textAlign = "left";
    ctx.fillText(label, bx + 27, by + 17);
    ctx.textAlign = "center";
  }

  function drawActiveBadges() {
    if (S.phase === "piece") {
      const i = activeHoleIdx();
      if (i < 0) return;
      const c = S.blk.cells[i];
      if (c.filled || !c.revealed) return;
      drawBadge(
        MX + (c.x + 0.5) * CELL,
        MY + (c.y + 0.5) * CELL,
        FABRICS[c.fab].c,
        `wants ${FABRICS[c.fab].n}`,
      );
    } else if (S.phase === "sew") {
      const i = activeSeamIdx();
      if (i < 0) return;
      const s = S.blk.seams[i];
      if (s.sewn || !s.revealed) return;
      drawBadge(
        s.mx,
        s.my,
        THREADS[s.thr].c,
        `take ${THREADS[s.thr].n} thread`,
      );
    }
  }

  function drawLampLight(t) {
    const flick =
      0.5 +
      0.3 * Math.sin(t * 6.1) +
      0.14 * Math.sin(t * 17.3) +
      0.06 * Math.sin(t * 31.7);
    const g = ctx.createRadialGradient(W / 2, 40, 40, W / 2, 40, 760);
    g.addColorStop(0, `rgba(255,196,110,${0.1 + 0.045 * flick})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 720);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(8,4,1,0.34)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function draw(now) {
    const t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    drawPanel();
    if (S.blk && S.phase !== "intro" && S.phase !== "boot") {
      drawSeams(t);
      for (const c of S.blk.cells) drawCell(c, t);
      drawActiveBadges();
    }
    drawLampLight(t);
    if (S.paused) {
      ctx.fillStyle = "rgba(10,6,2,0.5)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#f4d9a0";
      ctx.font = "700 30px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2 - 8);
      ctx.font = "italic 15px Georgia, serif";
      ctx.fillText("press P to pick the needle back up", W / 2, H / 2 + 22);
    }
  }

  /* ---------------- main loop ---------------- */

  let lastTs = 0;

  function loop(ts) {
    const dt = Math.min(0.06, (ts - lastTs) / 1000) || 0;
    lastTs = ts;
    const playing = S.phase === "piece" || S.phase === "sew";
    if (playing && !S.paused && !overlayOpen()) {
      S.lamp -= dt * (100 / 240);
      if (S.lamp <= 0) gutter();
    }
    draw(ts);
    requestAnimationFrame(loop);
  }

  /* ---------------- boot ---------------- */

  S.order = BLOCK_DEFS.slice();
  S.blk = buildBlockAt(0);
  S.phase = "intro";
  updateHUD();
  requestAnimationFrame(loop);
})();
