/* Cloud Shears — a rooftop bonsai pruning game.
   Five seasons, one pair of shears: the bonsai grows wild toward the light,
   and you decide which branches stay. Fill the three cloud pads before the
   judges arrive on Showing Day. All behaviour lives here, wrapped in one IIFE. */

(() => {
  "use strict";

  /* ============================== helpers ============================== */

  const $ = (id) => document.getElementById(id);

  const TAU = Math.PI * 2;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const lerp = (a, b, t) => a + (b - a) * t;

  const rnd = (a, b) => a + Math.random() * (b - a);

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return { d: Math.hypot(px - cx, py - cy), cx, cy };
  };

  const normAng = (a) => {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  };

  /* ============================ dom & board ============================ */

  const stage = $("stage");
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const chipSeason = $("chip-season");
  const chipShears = $("chip-shears");
  const chipScore = $("chip-score");
  const overlay = $("overlay");
  const bannerEl = $("banner");
  const btnSound = $("btn-sound");
  const btnHelp = $("btn-help");
  const btnPause = $("btn-pause");
  const btnRestart = $("btn-restart");
  const btnUndo = $("btn-undo");
  const btnNext = $("btn-next");

  const W = 960;
  const H = 640;
  const GROUND = 592; // roofline; the pot sits here

  /* ============================== seasons ============================== */

  const SEASONS = [
    {
      name: "First Spring",
      cuts: 7,
      sky: ["#a9dff0", "#eaf4e2"],
      leaf: ["#7fc36e", "#4f9748"],
      sun: "#ffe9a8",
      weather: "petals",
    },
    {
      name: "High Summer",
      cuts: 6,
      sky: ["#8fd0ee", "#ddf0f6"],
      leaf: ["#4e9e4a", "#357c38"],
      sun: "#ffd75e",
      weather: "none",
    },
    {
      name: "Late Summer",
      cuts: 5,
      sky: ["#9ccfe4", "#f0ead0"],
      leaf: ["#5b9e46", "#3f7d36"],
      sun: "#ffcf6e",
      weather: "none",
    },
    {
      name: "Autumn",
      cuts: 4,
      sky: ["#efc48b", "#f8e6c4"],
      leaf: ["#e0953f", "#bd6427"],
      sun: "#ffb45e",
      weather: "leaves",
    },
    {
      name: "Showing Day",
      cuts: 3,
      sky: ["#bcd9ea", "#fbe9ee"],
      leaf: ["#8fbf6a", "#5f9a4e"],
      sun: "#ffe6b8",
      weather: "petals",
    },
  ];

  const LEAF_SCALE = [0.72, 1.0, 1.12, 0.95, 1.06];
  const MAXNODES = 240;
  const MAXDEPTH = 8;

  const BARK = [
    "#5d4028",
    "#6b4a2f",
    "#78563a",
    "#866344",
    "#93704e",
    "#9f7d59",
    "#aa8965",
    "#b49471",
    "#bd9f7d",
  ];

  /* ============================== state ============================== */

  let nodes = [];
  let pads = [];
  let seasonIdx = 0;
  let cutsLeft = 0;
  let cutsUsed = 0;
  let state = "intro"; // intro | grow | prune | showing
  let overlayMode = "intro"; // intro | pause | help | verdict | none
  let paused = false;
  let growT = 1;
  let undoStack = [];
  let particles = [];
  let padPct = [0, 0, 0];
  let score = 0;
  let lastPenalty = 0;
  let selected = 0;
  let pointer = null; // {x, y} in board coords
  let time = 0;
  let lastTs = 0;
  let bannerTimer = 0;
  let ambientTimer = 0;
  let skyline = [];
  let clouds = [];

  /* ============================== audio ============================== */

  let actx = null;
  let master = null;
  let muted = false;

  function initAudio() {
    if (actx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.24;
      master.connect(actx.destination);
    } catch (e) {
      actx = null;
    }
  }

  function resumeAudio() {
    if (actx && actx.state === "suspended") actx.resume();
  }

  function beep(freq, dur, type, vol, slideTo, delay) {
    if (!actx) return;
    const t0 = actx.currentTime + (delay || 0);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, freq, vol, delay) {
    if (!actx) return;
    const t0 = actx.currentTime + (delay || 0);
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 1.1;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const sfxSnip = () => {
    noiseBurst(0.05, 3400, 0.5);
    beep(1500, 0.07, "square", 0.1, 420);
  };
  const sfxThud = () => beep(110, 0.12, "sine", 0.28, 70);
  const sfxWhoosh = () => noiseBurst(0.55, 700, 0.16);
  const sfxChime = () => {
    beep(880, 0.16, "sine", 0.12);
    beep(1318, 0.22, "sine", 0.09, null, 0.09);
  };
  const sfxUndo = () => beep(300, 0.09, "triangle", 0.12, 620);
  const sfxFanfare = () => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => beep(f, 0.22, "triangle", 0.13, null, i * 0.13));
  };

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.24;
    btnSound.setAttribute("aria-pressed", String(muted));
    btnSound.textContent = muted ? "✕" : "♪";
  }

  /* =============================== tree =============================== */

  function addNode(parent, ang, len, w, depth) {
    const n = {
      id: nodes.length,
      parent,
      ang,
      len,
      w,
      depth,
      kids: [],
      cut: false,
      born: seasonIdx,
      x: 0,
      y: 0,
      jx: 0,
      jy: 0,
      sway: 0,
      leaf: null,
    };
    if (parent >= 0) nodes[parent].kids.push(n.id);
    nodes.push(n);
    return n;
  }

  function ancestorCut(n) {
    while (n.parent >= 0) {
      n = nodes[n.parent];
      if (n.cut) return true;
    }
    return false;
  }

  function nearestPad(x, y) {
    let best = null;
    let bd = Infinity;
    for (const p of pads) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function kidCountFor(tip) {
    const room = MAXNODES - nodes.length;
    if (room <= 0) return 0;
    let n;
    if (tip.depth === 0) n = 3 + (Math.random() < 0.45 ? 1 : 0);
    else if (tip.depth === 1) n = Math.random() < 0.85 ? 2 : 3;
    else n = Math.random() < 0.62 ? 2 : 1;
    return Math.max(0, Math.min(n, room));
  }

  // One season of growth: tips split, everything thickens, leaves swell.
  // One season of growth: tips split, everything thickens, leaves swell.
  // New shoots lean toward the nearest cloud pad — the tree reaches for
  // the light you have promised it.
  function grow() {
    // A tip is a shoot end — or a point sheared back to the framework,
    // which buds afresh next season, as cloud-pruned pines do.
    const tips = nodes.filter((n) => {
      if (n.cut || n.depth >= MAXDEPTH) return false;
      if (n.kids.length === 0) return true;
      return n.kids.every((k) => nodes[k].cut);
    });
    for (const tip of tips) {
      const nKids = kidCountFor(tip);
      const spread = 0.42 + Math.random() * 0.28;
      for (let i = 0; i < nKids; i++) {
        const frac = nKids === 1 ? 0 : i / (nKids - 1) - 0.5;
        let ang =
          tip.ang +
          frac * 2 * spread +
          (nKids === 1 ? rnd(-0.25, 0.25) : rnd(-0.1, 0.1));
        const pad = nearestPad(tip.x, tip.y);
        if (pad && tip.depth >= 1) {
          const want = Math.atan2(pad.y - tip.y, pad.x - tip.x);
          const pull = Math.min(0.34, 0.05 * tip.depth + 0.07);
          ang += normAng(want - ang) * pull;
        }
        const len = tip.len * rnd(0.72, 0.87);
        addNode(tip.id, ang, len, Math.max(2.1, tip.w * 0.66), tip.depth + 1);
      }
    }
    // First Spring only: the newborn boughs also push their first soft
    // shoots, so there is something to shear from the very first season.
    if (seasonIdx === 0) {
      const boughs = nodes.filter((n) => n.born === 0 && n.depth === 1);
      for (const b of boughs) {
        if (MAXNODES - nodes.length <= 0) break;
        if (Math.random() < 0.85) {
          addNode(
            b.id,
            b.ang + rnd(-0.34, 0.34),
            b.len * rnd(0.55, 0.68),
            Math.max(2.1, b.w * 0.66),
            2,
          );
        }
      }
    }
    for (const n of nodes) n.w = Math.min(n.w * 1.07, 26);
    const scale = LEAF_SCALE[seasonIdx];
    for (const n of nodes) {
      if (n.cut || ancestorCut(n)) continue;
      if (n.depth >= 2) {
        if (!n.leaf) {
          n.leaf = {
            base: 0,
            r: 0,
            hue: Math.random(),
            ph: Math.random() * TAU,
          };
        }
        n.leaf.base = n.leaf.r;
        n.leaf.r = clamp((4.5 + n.depth * 2.7 + rnd(-2, 3)) * scale, 3, 30);
      }
    }
  }

  /* ============================ pads & score ============================ */

  // Pads live inside the band the crown can actually reach, so every target
  // is fair game and the judges' demands can be met with good pruning.
  function makePads() {
    pads = [];
    let guard = 0;
    while (pads.length < 3 && guard++ < 600) {
      const r = rnd(76, 106);
      const x = rnd(292, 668);
      const y = rnd(212, 348);
      if (pads.every((p) => Math.hypot(p.x - x, p.y - y) > (p.r + r) * 0.82)) {
        pads.push({ x, y, r });
      }
    }
    while (pads.length < 3) {
      pads.push({ x: rnd(310, 650), y: rnd(220, 340), r: 88 });
    }
  }

  function updateScore() {
    const areas = [0, 0, 0];
    let outside = 0;
    for (const n of nodes) {
      if (n.cut || !n.leaf || ancestorCut(n)) continue;
      if (n.depth < 2) continue;
      const area = Math.PI * n.leaf.r * n.leaf.r;
      let hit = false;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        if (dx * dx + dy * dy <= p.r * p.r) {
          areas[i] += area;
          hit = true;
          break;
        }
      }
      if (!hit && n.depth >= 3) outside += area;
    }
    let total = 0;
    padPct = pads.map((p, i) => {
      const f = clamp((areas[i] / (p.r * p.r * Math.PI)) * 112, 0, 100);
      total += f;
      return f;
    });
    const allPadArea = pads.reduce((s, p) => s + p.r * p.r * Math.PI, 0);
    const penalty = clamp((outside / allPadArea) * 42, 0, 42);
    lastPenalty = Math.round(penalty);
    score = clamp(Math.round(total / pads.length - penalty), 0, 100);
  }

  /* =========================== cut & undo =========================== */

  // Only young shoots may be sheared; the structural boughs always stay,
  // so every season brings new growth to shape.
  function cuttableList() {
    return nodes.filter((n) => n.depth >= 2 && !n.cut && !ancestorCut(n));
  }

  function pickSeg(px, py) {
    let best = null;
    for (const n of cuttableList()) {
      const hit = distToSeg(px, py, n.jx, n.jy, n.x, n.y);
      if (hit.d <= 16 && (!best || hit.d < best.d)) {
        best = { n, d: hit.d, cx: hit.cx, cy: hit.cy };
      }
    }
    return best;
  }

  function captureSubtree(root) {
    const segs = [];
    const walk = (n) => {
      segs.push({
        x1: n.jx - root.jx,
        y1: n.jy - root.jy,
        x2: n.x - root.jx,
        y2: n.y - root.jy,
        w: n.w,
        c: BARK[Math.min(n.depth, BARK.length - 1)],
      });
      for (const k of n.kids) if (!nodes[k].cut) walk(nodes[k]);
    };
    walk(root);
    return segs;
  }

  function doCut(n) {
    undoStack.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      cutsLeft,
      cutsUsed,
      padPct: padPct.slice(),
      score,
      selected,
    });
    if (undoStack.length > 40) undoStack.shift();
    spawnLeafPuff(n, 4);
    spawnBranchFall(captureSubtree(n), n.jx, n.jy);
    n.cut = true;
    cutsLeft--;
    cutsUsed++;
    updateScore();
    syncHud();
    sfxSnip();
    const list = cuttableList();
    selected = list.length ? clamp(selected, 0, list.length - 1) : 0;
    if (cutsLeft === 0) {
      showBanner(
        seasonIdx === SEASONS.length - 1
          ? "Out of shears — press Enter for Showing Day"
          : "Out of shears — press Enter for next season",
      );
    }
  }

  function undo() {
    if (state !== "prune" || !undoStack.length) return;
    const snap = undoStack.pop();
    nodes = snap.nodes;
    cutsLeft = snap.cutsLeft;
    cutsUsed = snap.cutsUsed;
    padPct = snap.padPct;
    score = snap.score;
    selected = snap.selected;
    updateScore();
    syncHud();
    sfxUndo();
  }

  function cutSelected() {
    const list = cuttableList();
    if (!list.length || cutsLeft <= 0) {
      sfxThud();
      if (cutsLeft <= 0) {
        showBanner("No shears left — press Enter for the next season");
      }
      return;
    }
    selected = ((selected % list.length) + list.length) % list.length;
    doCut(list[selected]);
  }

  /* ============================= particles ============================= */

  function spawnBranchFall(segs, x, y) {
    particles.push({
      kind: "branch",
      segs,
      x,
      y,
      vx: rnd(-26, 26),
      vy: -50,
      rot: 0,
      vr: rnd(-1.8, 1.8),
      life: 1.35,
      age: 0,
    });
  }

  function spawnLeafPuff(n, count) {
    const S = SEASONS[seasonIdx];
    for (let i = 0; i < count; i++) {
      particles.push({
        kind: "leaf",
        x: n.x + rnd(-8, 8),
        y: n.y + rnd(-8, 8),
        vx: rnd(-46, 46),
        vy: rnd(-70, -10),
        rot: rnd(0, TAU),
        vr: rnd(-5, 5),
        r: rnd(3.4, 6),
        color: S.leaf[i % 2],
        life: rnd(1.2, 2),
        age: 0,
      });
    }
  }

  function spawnAmbient(dt) {
    const S = SEASONS[seasonIdx];
    if (S.weather === "none") return;
    ambientTimer -= dt;
    if (ambientTimer > 0) return;
    ambientTimer = S.weather === "leaves" ? 0.4 : 0.28;
    const leafy = nodes.filter((n) => n.leaf && !n.cut && !ancestorCut(n));
    if (!leafy.length || particles.length > 130) return;
    const n = leafy[(Math.random() * leafy.length) | 0];
    if (S.weather === "leaves") {
      particles.push({
        kind: "leaf",
        x: n.x + rnd(-10, 10),
        y: n.y + rnd(-10, 10),
        vx: rnd(-30, 10),
        vy: rnd(18, 44),
        rot: rnd(0, TAU),
        vr: rnd(-4, 4),
        r: rnd(3.4, 6),
        color: Math.random() < 0.5 ? S.leaf[0] : S.leaf[1],
        life: rnd(3, 4.5),
        age: 0,
      });
    } else {
      particles.push({
        kind: "petal",
        x: n.x + rnd(-12, 12),
        y: n.y + rnd(-12, 12),
        vx: rnd(-34, -8),
        vy: rnd(10, 34),
        rot: rnd(0, TAU),
        vr: rnd(-3, 3),
        r: rnd(2.2, 3.6),
        color: "#f6b8c8",
        life: rnd(3, 5),
        age: 0,
      });
    }
  }

  function petalBurst() {
    for (let i = 0; i < 60; i++) {
      particles.push({
        kind: "petal",
        x: rnd(0, W),
        y: rnd(-40, 160),
        vx: rnd(-36, -6),
        vy: rnd(26, 62),
        rot: rnd(0, TAU),
        vr: rnd(-3, 3),
        r: rnd(2.4, 4),
        color: i % 3 ? "#f6b8c8" : "#fdfbf4",
        life: rnd(3.4, 6),
        age: 0,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      if (p.kind === "branch") p.vy += 920 * dt;
      else p.vy += 60 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind !== "branch" && p.y > GROUND + 30) {
        particles.splice(i, 1);
      }
    }
  }

  /* ============================== scenery ============================== */

  function makeScenery() {
    skyline = [];
    let x = -20;
    while (x < W + 40) {
      const bw = rnd(46, 110);
      const bh = rnd(46, 158);
      const wins = [];
      for (let wy = 12; wy < bh - 10; wy += 22) {
        for (let wx = 8; wx < bw - 10; wx += 18) {
          if (Math.random() < 0.42) {
            wins.push({ x: wx, y: wy, lit: Math.random() < 0.55 });
          }
        }
      }
      skyline.push({ x, w: bw, h: bh, wins });
      x += bw + rnd(4, 16);
    }
    clouds = [];
    for (let i = 0; i < 3; i++) {
      clouds.push({
        y: rnd(50, 190),
        s: rnd(0.7, 1.3),
        speed: rnd(5, 11),
        off: rnd(0, W + 240),
      });
    }
  }

  /* ========================= flow & overlays ========================= */

  function setState(s) {
    state = s;
    stage.dataset.state = s;
  }

  function showBanner(text, ms) {
    bannerEl.textContent = text;
    bannerEl.classList.remove("hidden");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(
      () => bannerEl.classList.add("hidden"),
      ms || 2100,
    );
  }

  function hideOverlay() {
    overlayMode = "none";
    overlay.classList.add("hidden");
    paused = false;
    syncHud();
  }

  function setOverlay(html, mode) {
    overlayMode = mode;
    overlay.innerHTML = html;
    overlay.classList.remove("hidden");
    const primary = overlay.querySelector("[data-primary]");
    if (primary) {
      primary.focus();
      primary.addEventListener("click", () => {
        const act = primary.getAttribute("data-primary");
        if (act === "begin") begin();
        else if (act === "again") newGame();
        else hideOverlay();
      });
    }
    syncHud();
  }

  function showIntro() {
    setOverlay(
      `
      <div class="panel">
        <h2>Cloud Shears</h2>
        <p class="ov-lede">Five seasons on a rooftop terrace. One pair of shears.</p>
        <ul class="ov-list">
          <li>Each season the bonsai grows wild — young shoots reach for the
            three dashed <strong>cloud pads</strong> the judges want filled.</li>
          <li><strong>Cut shoots</strong> that grow astray: click them, or cycle
            with ←/→ and press Space. The thick boughs are the tree's skeleton
            and cannot be cut; every season brings fresh shoots.</li>
          <li>Foliage left outside the pads costs you; foliage inside fills them.
            Cuts are limited each season, and Z takes one back.</li>
          <li>When the canopy reads well, press <strong>Enter</strong> to bring
            on the next season.</li>
          <li>On Showing Day the judges score your canopy. Silver or better wins.</li>
        </ul>
        <div class="btn-row">
          <button class="btn primary" type="button" data-primary="begin">
            Begin First Spring
          </button>
        </div>
      </div>
    `,
      "intro",
    );
  }

  function showPausePanel(withHelp) {
    setOverlay(
      withHelp
        ? `
      <div class="panel">
        <h2>How to prune</h2>
        <ul class="ov-list">
          <li><strong>Goal:</strong> fill the dashed cloud pads with foliage —
            canopy % is the average of the three pads, minus strays.</li>
          <li><strong>Cut:</strong> tap or click a young shoot; ←/→ picks,
            Space cuts, Z takes the last cut back. Boughs are protected.</li>
          <li><strong>Seasons:</strong> Enter ends a season early; the tree then
            grows anew from every shoot you spared.</li>
          <li>P pause · M sound · R restart · Esc back to the tree.</li>
        </ul>
        <div class="btn-row">
          <button class="btn primary" type="button" data-primary="resume">
            Back to the tree
          </button>
        </div>
      </div>
    `
        : `
      <div class="panel">
        <h2>Paused</h2>
        <p class="ov-lede">The wind holds its breath.</p>
        <div class="btn-row">
          <button class="btn primary" type="button" data-primary="resume">
            Resume (P)
          </button>
        </div>
      </div>
    `,
      withHelp ? "help" : "pause",
    );
    paused = true;
  }

  function showVerdict() {
    setState("showing");
    updateScore();
    const medal =
      score >= 80
        ? ["★★★", "Gold", "A masterpiece of cloud pruning. The judges bow."]
        : score >= 60
          ? ["★★", "Silver", "A fine, balanced tree. One judge wept quietly."]
          : score >= 40
            ? ["★", "Bronze", "Promising — though the clouds drift a little."]
            : [
                "—",
                "No medal",
                "The judges wince. The tree, at least, forgives you.",
              ];
    setOverlay(
      `
      <div class="panel">
        <h2>Showing Day</h2>
        <p class="ov-big">${score}%</p>
        <p class="ov-medal">${medal[0]} ${medal[1]} — ${medal[2]}</p>
        <p class="ov-note">pads ${padPct.map((f) => Math.round(f)).join("% · ")}%
          — strays −${lastPenalty} — cuts used ${cutsUsed}</p>
        <div class="btn-row">
          <button class="btn primary" type="button" data-primary="again">
            Grow again
          </button>
        </div>
      </div>
    `,
      "verdict",
    );
    if (score >= 60) {
      sfxFanfare();
      petalBurst();
    } else {
      sfxChime();
    }
  }

  function beginGrowth() {
    setState("grow");
    growT = 0;
    grow();
    layout();
    sfxWhoosh();
    showBanner(`${SEASONS[seasonIdx].name} — the tree puts out new growth…`);
    syncHud();
  }

  function startSeason(idx) {
    seasonIdx = idx;
    cutsLeft = SEASONS[idx].cuts;
    undoStack = [];
    selected = 0;
    beginGrowth();
  }

  function nextSeason() {
    if (state !== "prune") return;
    if (seasonIdx >= SEASONS.length - 1) showVerdict();
    else startSeason(seasonIdx + 1);
  }

  function newGame() {
    nodes = [];
    particles = [];
    undoStack = [];
    cutsUsed = 0;
    seasonIdx = 0;
    cutsLeft = SEASONS[0].cuts;
    score = 0;
    lastPenalty = 0;
    padPct = [0, 0, 0];
    selected = 0;
    paused = false;
    makePads();
    addNode(-1, -Math.PI / 2, 124, 17, 0);
    layout();
    makeScenery();
    setState("intro");
    showIntro();
    clearTimeout(bannerTimer);
    bannerEl.classList.add("hidden");
    syncHud();
  }

  function begin() {
    hideOverlay();
    startSeason(0);
  }

  function togglePause() {
    if (overlayMode === "pause") {
      hideOverlay();
      return;
    }
    if (overlayMode !== "none") return;
    if (state !== "grow" && state !== "prune") return;
    showPausePanel(false);
  }

  function requestHelp() {
    if (overlayMode === "help") {
      hideOverlay();
      return;
    }
    if (overlayMode !== "none") return;
    if (state !== "grow" && state !== "prune") return;
    showPausePanel(true);
  }

  /* ================================ hud ================================ */

  function syncHud() {
    chipSeason.textContent = SEASONS[seasonIdx].name;
    chipShears.textContent = `✂ ${cutsLeft}`;
    chipShears.classList.toggle("low", cutsLeft <= 1);
    chipScore.textContent = `Canopy ${score}%`;
    btnUndo.disabled = !(
      overlayMode === "none" &&
      state === "prune" &&
      undoStack.length
    );
    btnNext.disabled = !(overlayMode === "none" && state === "prune");
    btnNext.classList.toggle(
      "pulse",
      overlayMode === "none" && state === "prune" && cutsLeft === 0,
    );
    btnNext.textContent =
      seasonIdx === SEASONS.length - 1 ? "Showing Day ⏎" : "Next season ⏎";
    btnPause.disabled = !(
      overlayMode === "none" &&
      (state === "grow" || state === "prune")
    );
  }

  /* =============================== layout =============================== */

  function layout() {
    const tGrow = easeOut(clamp(growT, 0, 1));
    const rec = (n, px, py) => {
      const t = n.born === seasonIdx ? tGrow : 1;
      n.sway = Math.sin(time * 1.25 + n.id * 0.83) * 0.0045 * n.depth;
      const ang = n.ang + n.sway;
      const L = n.len * t;
      n.jx = px;
      n.jy = py;
      n.x = px + Math.cos(ang) * L;
      n.y = py + Math.sin(ang) * L;
      for (const k of n.kids) {
        const c = nodes[k];
        if (!c.cut) rec(c, n.x, n.y);
      }
    };
    const root = nodes[0];
    if (!root) return;
    root.x = W / 2;
    root.y = GROUND + 10;
    rec(root, root.x, root.y);
  }

  /* =============================== render =============================== */

  function drawSun(S) {
    const g = ctx.createRadialGradient(122, 104, 6, 122, 104, 86);
    g.addColorStop(0, S.sun);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(20, 4, 210, 210);
    ctx.fillStyle = S.sun;
    ctx.beginPath();
    ctx.arc(122, 104, 30, 0, TAU);
    ctx.fill();
  }

  function drawClouds() {
    ctx.fillStyle = "rgba(252,253,255,0.85)";
    for (const c of clouds) {
      const x = ((time * c.speed + c.off) % (W + 260)) - 130;
      ctx.beginPath();
      ctx.arc(x, c.y, 17 * c.s, 0, TAU);
      ctx.arc(x + 20 * c.s, c.y - 8 * c.s, 13 * c.s, 0, TAU);
      ctx.arc(x - 20 * c.s, c.y - 4 * c.s, 12 * c.s, 0, TAU);
      ctx.fill();
    }
  }

  function drawSkyline() {
    for (const b of skyline) {
      ctx.fillStyle = "#5d6b74";
      ctx.fillRect(b.x, GROUND - 40 - b.h, b.w, b.h);
      ctx.fillStyle = "#4d5a63";
      ctx.fillRect(b.x, GROUND - 40 - b.h, b.w, 5);
      for (const wn of b.wins) {
        ctx.fillStyle = wn.lit
          ? "rgba(255,214,130,0.75)"
          : "rgba(38,46,52,0.6)";
        ctx.fillRect(b.x + wn.x, GROUND - 40 - b.h + wn.y, 8, 11);
      }
    }
    ctx.fillStyle = "rgba(93,107,116,0.5)";
    ctx.fillRect(0, GROUND - 42, W, 42);
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawPadsBack() {
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const f = padPct[i] / 100;
      if (f > 0.01) {
        const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.15, p.x, p.y, p.r);
        g.addColorStop(0, "rgba(94,168,110,0.34)");
        g.addColorStop(1, "rgba(94,168,110,0.05)");
        ctx.globalAlpha = 0.25 + f * 0.75;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawPadsFront() {
    ctx.setLineDash([7, 8]);
    ctx.lineWidth = 2;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      ctx.strokeStyle = "rgba(44,58,48,0.5)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
      const label = `${Math.round(padPct[i])}%`;
      ctx.font = "bold 13px Verdana, sans-serif";
      const tw = ctx.measureText(label).width + 16;
      const lx = p.x - tw / 2;
      const ly = p.y + p.r - 4;
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(244,234,210,0.92)";
      rr(lx, ly, tw, 20, 9);
      ctx.fill();
      ctx.strokeStyle = "rgba(44,36,24,0.8)";
      ctx.lineWidth = 1;
      rr(lx, ly, tw, 20, 9);
      ctx.stroke();
      ctx.fillStyle = "#2c2418";
      ctx.textAlign = "center";
      ctx.fillText(label, p.x, ly + 14);
      ctx.setLineDash([7, 8]);
      ctx.lineWidth = 2;
    }
    ctx.textAlign = "left";
    ctx.setLineDash([]);
  }

  function leafBlob(x, y, r, hue, S) {
    const c0 = S.leaf[hue < 0.5 ? 0 : 1];
    const c1 = S.leaf[hue < 0.5 ? 1 : 0];
    const g = ctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.35,
      r * 0.15,
      x,
      y,
      r,
    );
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.arc(x + r * 0.62, y + r * 0.18, r * 0.62, 0, TAU);
    ctx.arc(x - r * 0.55, y + r * 0.3, r * 0.55, 0, TAU);
    ctx.fill();
  }

  function drawTree(S) {
    const tGrow = easeOut(clamp(growT, 0, 1));
    ctx.lineCap = "round";
    for (const n of nodes) {
      if (n.cut || ancestorCut(n)) continue;
      const t = n.born === seasonIdx ? tGrow : 1;
      if (t <= 0.02) continue;
      ctx.strokeStyle = BARK[Math.min(n.depth, BARK.length - 1)];
      ctx.lineWidth = Math.max(1.3, n.w * (0.55 + 0.45 * t));
      ctx.beginPath();
      ctx.moveTo(n.jx, n.jy);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }
    const blossoms = seasonIdx === 0 || seasonIdx === SEASONS.length - 1;
    for (const n of nodes) {
      if (n.cut || ancestorCut(n) || !n.leaf) continue;
      const t = n.born === seasonIdx ? tGrow : 1;
      const r = lerp(n.leaf.base, n.leaf.r, t);
      if (r < 1.2) continue;
      const wob = Math.sin(time * 0.9 + n.leaf.ph * 7) * 1.6;
      leafBlob(n.x + wob, n.y + wob * 0.6, r, n.leaf.hue, S);
      if (blossoms && r > 5) {
        ctx.fillStyle = "rgba(246,184,200,0.85)";
        for (let i = 0; i < 3; i++) {
          const a = n.leaf.ph + i * 2.1;
          ctx.beginPath();
          ctx.arc(
            n.x + wob + Math.cos(a) * r * 0.5,
            n.y + wob * 0.6 + Math.sin(a) * r * 0.5,
            1.7,
            0,
            TAU,
          );
          ctx.fill();
        }
      }
    }
  }

  function drawRoof() {
    const g = ctx.createLinearGradient(0, GROUND, 0, H);
    g.addColorStop(0, "#39444a");
    g.addColorStop(1, "#22282b");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = "rgba(20,26,29,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 1.5);
    ctx.lineTo(W, GROUND + 1.5);
    ctx.stroke();
    ctx.fillStyle = "#2e3639";
    for (let row = 0; row < 2; row++) {
      const y = GROUND + 10 + row * 19;
      for (let x = (row % 2) * 24; x < W; x += 48) {
        ctx.beginPath();
        ctx.arc(x + 24, y, 21, 0, Math.PI, false);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#333d43";
    ctx.fillRect(794, GROUND - 34, 30, 36);
    ctx.fillRect(788, GROUND - 40, 42, 8);
    ctx.fillStyle = "#22282b";
    ctx.fillRect(800, GROUND - 30, 18, 8);
    const potY = GROUND - 26;
    ctx.fillStyle = "#8a4f33";
    ctx.beginPath();
    ctx.moveTo(W / 2 - 56, potY);
    ctx.lineTo(W / 2 + 56, potY);
    ctx.lineTo(W / 2 + 40, potY + 30);
    ctx.lineTo(W / 2 - 40, potY + 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#6e3c26";
    ctx.fillRect(W / 2 - 60, potY - 8, 120, 10);
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.age / p.life;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      if (p.kind === "branch") {
        ctx.lineCap = "round";
        for (const s of p.segs) {
          ctx.strokeStyle = s.c;
          ctx.lineWidth = Math.max(1.2, s.w);
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        }
      } else if (p.kind === "leaf") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.6, 0.6, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawHover() {
    if (overlayMode !== "none" || state !== "prune") return;
    let mark = null;
    if (pointer) mark = pickSeg(pointer.x, pointer.y);
    if (!mark && cuttableList().length) {
      const list = cuttableList();
      const idx = ((selected % list.length) + list.length) % list.length;
      const n = list[idx];
      mark = { n, cx: (n.jx + n.x) / 2, cy: (n.jy + n.y) / 2 };
    }
    if (!mark) return;
    const n = mark.n;
    const pulse = 0.55 + 0.35 * Math.sin(time * 6);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = "#b5432f";
    ctx.lineWidth = Math.max(4, n.w + 3);
    ctx.setLineDash([6, 5]);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(n.jx, n.jy);
    ctx.lineTo(n.x, n.y);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(mark.cx, mark.cy - 14);
    ctx.rotate(-0.5);
    ctx.font = "20px serif";
    ctx.fillText("✂", -8, 6);
    ctx.restore();
  }

  function render() {
    const S = SEASONS[seasonIdx];
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, S.sky[0]);
    g.addColorStop(1, S.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND);
    drawSun(S);
    drawClouds();
    drawSkyline();
    drawPadsBack();
    layout();
    drawTree(S);
    drawParticles();
    drawRoof();
    drawPadsFront();
    drawHover();
  }

  /* ================================ input ================================ */

  function toBoard(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("pointermove", (e) => {
    pointer = toBoard(e);
  });

  canvas.addEventListener("pointerleave", () => {
    pointer = null;
  });

  canvas.addEventListener("pointerdown", (e) => {
    initAudio();
    resumeAudio();
    if (overlayMode !== "none" || paused) return;
    if (state !== "prune") return;
    const pt = toBoard(e);
    const hit = pickSeg(pt.x, pt.y);
    if (!hit) return;
    if (cutsLeft <= 0) {
      sfxThud();
      showBanner("No shears left — press Enter for the next season");
      return;
    }
    doCut(hit.n);
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    initAudio();
    resumeAudio();
    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if (k === "r" || k === "R") {
      newGame();
      return;
    }
    if (overlayMode === "intro") {
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        begin();
      }
      return;
    }
    if (overlayMode === "verdict") {
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        newGame();
      }
      return;
    }
    if (overlayMode === "pause" || overlayMode === "help") {
      if (k === "Escape" || k === "Enter" || k === "p" || k === "P") {
        e.preventDefault();
        hideOverlay();
      }
      return;
    }
    if (paused) return;
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (k === "h" || k === "H" || k === "?") {
      requestHelp();
      return;
    }
    if (state !== "prune") return;
    switch (k) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        selected += 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        selected -= 1;
        break;
      case " ":
      case "x":
      case "X":
        e.preventDefault();
        cutSelected();
        break;
      case "z":
      case "Z":
        undo();
        break;
      case "Enter":
        e.preventDefault();
        nextSeason();
        break;
      default:
        break;
    }
  });

  btnSound.addEventListener("click", () => {
    initAudio();
    toggleMute();
  });
  btnHelp.addEventListener("click", requestHelp);
  btnPause.addEventListener("click", togglePause);
  btnRestart.addEventListener("click", newGame);
  btnUndo.addEventListener("click", () => {
    initAudio();
    undo();
  });
  btnNext.addEventListener("click", () => {
    initAudio();
    nextSeason();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && overlayMode === "none" && !paused) {
      if (state === "grow" || state === "prune") showPausePanel(false);
    }
  });

  /* ================================ loop ================================ */

  function update(dt) {
    time += dt;
    if (state === "grow") {
      growT += dt / 1.7;
      if (growT >= 1) {
        growT = 1;
        setState("prune");
        updateScore();
        syncHud();
        showBanner(
          `Shear! ${cutsLeft} cut${cutsLeft === 1 ? "" : "s"} this season`,
        );
      }
    }
    if (state === "grow" || state === "prune") spawnAmbient(dt);
    updateParticles(dt);
  }

  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ================================ boot ================================ */

  newGame();
  // TEMPORARY calibration hook — will be removed
  window.__csDebug = () => ({
    segs: nodes
      .filter((n) => n.depth >= 2 && !n.cut && !ancestorCut(n))
      .map((n) => ({ id: n.id, x: (n.jx + n.x) / 2, y: (n.jy + n.y) / 2 })),
    pads,
    state,
    cutsLeft,
  });
  requestAnimationFrame(frame);
})();
