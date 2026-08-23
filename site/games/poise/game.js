/* Poise — hang every carving so the mobile sits true before the gallery opens. */
(() => {
  "use strict";

  /* ---------------- tiny utils ---------------- */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------------- audio (synthesised, Web Audio) ---------------- */

  const Sound = (() => {
    let ac = null;
    let master = null;
    let noiseBuf = null;
    let muted = false;
    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.5;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(
          1,
          Math.floor(ac.sampleRate * 0.4),
          ac.sampleRate,
        );
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === "suspended") ac.resume();
    }
    function tone(freq, dur, type, vol, when, glide) {
      if (!ac || muted) return;
      const t0 = ac.currentTime + (when || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
    function noise(dur, freq, q, vol, when) {
      if (!ac || muted) return;
      const t0 = ac.currentTime + (when || 0);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }
    return {
      ensure,
      toggle() {
        muted = !muted;
        return muted;
      },
      get muted() {
        return muted;
      },
      pick() {
        noise(0.09, 900, 1.2, 0.18);
      },
      hangOk() {
        tone(196, 0.09, "triangle", 0.28, 0, 130);
        noise(0.06, 320, 2, 0.2);
      },
      refuse() {
        tone(110, 0.14, "square", 0.1, 0, 82);
      },
      lock(tier) {
        const base = 523.25 * Math.pow(1.122, Math.min(tier, 6));
        tone(base, 0.5, "sine", 0.22);
        tone(base * 1.5, 0.62, "sine", 0.15, 0.07);
        noise(0.25, 2400, 8, 0.05, 0.02);
      },
      tick() {
        tone(1180, 0.04, "square", 0.06);
      },
      fanfare() {
        [392, 523.25, 659.25, 783.99].forEach((f, i) =>
          tone(f, 0.42, "triangle", 0.18, i * 0.11),
        );
        tone(1046.5, 0.7, "sine", 0.14, 0.46);
      },
      sad() {
        tone(311, 0.4, "triangle", 0.18);
        tone(233, 0.6, "triangle", 0.18, 0.22);
      },
      applause() {
        for (let i = 0; i < 26; i++) {
          noise(
            0.05 + Math.random() * 0.06,
            1400 + Math.random() * 1800,
            1.4,
            0.045,
            Math.random() * 0.9,
          );
        }
      },
    };
  })();

  /*GEN-START*/
  /* ---------------- seeded sculpture generator ----------------
     Every piece is grown from a fixed skeleton by a small solver, so a
     perfectly balanced arrangement is guaranteed to exist. Moments are
     integer gram-slots: a carving of mass m hung at signed slot s
     contributes m*s; a sub-arm contributes its whole subtree mass times
     its attach slot. */

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ROD_MASS = 2;
  const MAX_MASS = 9;

  const PIECE_DEFS = [
    {
      name: "Hatchling",
      time: 150,
      seed: 11,
      rods: [{ id: "a", parent: null, len: 5 }],
    },
    {
      name: "Twin Leaves",
      time: 150,
      seed: 23,
      rods: [
        { id: "a", parent: null, len: 5 },
        { id: "b", parent: "a", len: 4 },
      ],
    },
    {
      name: "River Stones",
      time: 145,
      seed: 37,
      rods: [
        { id: "a", parent: null, len: 5 },
        { id: "b", parent: "a", len: 4 },
        { id: "c", parent: "a", len: 3 },
      ],
    },
    {
      name: "Copper Fish",
      time: 140,
      seed: 53,
      rods: [
        { id: "a", parent: null, len: 5 },
        { id: "b", parent: "a", len: 4 },
        { id: "c", parent: "b", len: 3 },
      ],
    },
    {
      name: "Grand Salon",
      time: 135,
      seed: 71,
      rods: [
        { id: "a", parent: null, len: 5 },
        { id: "b", parent: "a", len: 4 },
        { id: "c", parent: "a", len: 4 },
        { id: "d", parent: "b", len: 3 },
        { id: "e", parent: "c", len: 3 },
      ],
    },
  ];

  const NAMES = [
    "Orb",
    "Leaf",
    "Bell",
    "Seed",
    "Fish",
    "Moon",
    "Key",
    "Pearl",
    "Bird",
    "Star",
  ];
  const SHAPES = [
    "orb",
    "leaf",
    "bell",
    "seed",
    "fish",
    "moon",
    "key",
    "pearl",
    "bird",
    "star",
  ];
  const COLORS = [
    "#e2725b",
    "#8aa37b",
    "#5b7fa6",
    "#d9a441",
    "#c98ca7",
    "#4f9e9b",
    "#8d6cab",
    "#a4a13f",
    "#c9b08a",
    "#b05a3c",
  ];

  /* Pick 2 (preferred) or 3 carvings whose signed gram-slots sum to `need`.
     Mirrored pairs are demoted so solutions stay interesting. */
  function pickPlacements(len, need, rng) {
    const cands = [];
    for (let a = 1; a <= MAX_MASS; a++) {
      for (let sa = 1; sa <= len; sa++) {
        for (let b = 1; b <= MAX_MASS; b++) {
          for (let sb = 1; sb <= len; sb++) {
            /* straddling pair: a@sa right of pivot, b@sb left of it */
            if (a * sa - b * sb === need)
              cands.push([{ m: a, s: sa }, { m: b, s: -sb }, 2]);
            /* both carvings left of the pivot */
            if (-(a * sa) - b * sb === need && sa !== sb)
              cands.push([{ m: a, s: -sa }, { m: b, s: -sb }, 2]);
            /* both carvings right of the pivot */
            if (a * sa + b * sb === need && sa !== sb)
              cands.push([{ m: a, s: sa }, { m: b, s: sb }, 2]);
          }
        }
      }
    }
    if (!cands.length) {
      /* three-carving fallback for awkward residues */
      for (let a = 1; a <= MAX_MASS; a++) {
        for (let sa = 1; sa <= len; sa++) {
          for (let b = 1; b <= MAX_MASS; b++) {
            for (let sb = 1; sb <= len; sb++) {
              for (let c = 1; c <= MAX_MASS; c++) {
                for (let sc = 1; sc <= len; sc++) {
                  const v = a * sa + b * sb - c * sc;
                  if (v === need)
                    cands.push([
                      { m: a, s: sa },
                      { m: b, s: sb },
                      { m: c, s: -sc },
                      3,
                    ]);
                  else if (-v === need)
                    cands.push([
                      { m: a, s: -sa },
                      { m: b, s: -sb },
                      { m: c, s: sc },
                      3,
                    ]);
                }
              }
            }
          }
        }
      }
    }
    if (!cands.length) return null;
    const seen = new Set();
    const uniq = cands.filter((c) => {
      const k = c
        .slice(0, -1)
        .map((p) => p.m + "@" + p.s)
        .sort()
        .join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let best = null;
    let bestScore = -Infinity;
    for (const c of uniq) {
      let score = -c[c.length - 1] * 2.2 + rng() * 3;
      if (c[0].m !== c[1].m) score += 1.5;
      if (Math.abs(c[0].s) !== Math.abs(c[1].s)) score += 1.2;
      score += (Math.abs(c[0].s) + Math.abs(c[1].s)) * 0.12;
      if (c[c.length - 1] === 3 && c[0].m === c[1].m && c[0].s === -c[1].s)
        score -= 8;
      if (score > bestScore) {
        bestScore = score;
        best = c.slice(0, -1);
      }
    }
    return best;
  }

  function tryBuild(def, rng) {
    const rods = def.rods.map((r) => ({
      id: r.id,
      parent: r.parent,
      len: r.len,
      off: 0,
      subMass: 0,
      leaves: [],
    }));
    const kids = new Map();
    rods.forEach((r) => {
      if (r.parent) {
        if (!kids.has(r.parent)) kids.set(r.parent, []);
        kids.get(r.parent).push(r.id);
      }
    });
    const byId = new Map(rods.map((r) => [r.id, r]));
    const order = [];
    const visit = (id) => {
      (kids.get(id) || []).forEach(visit);
      order.push(byId.get(id));
    };
    visit(def.rods[0].id);

    let uid = 0;
    for (const rod of order) {
      const children = (kids.get(rod.id) || []).map((cid) => byId.get(cid));
      const compMax = MAX_MASS * rod.len - 4;
      let R = 0;
      if (children.length === 1) {
        const c = children[0];
        let bestO = 0;
        let bestScore = -Infinity;
        for (let o = 1; o <= rod.len; o++) {
          const p = c.subMass * o;
          if (p > compMax) break;
          const score = -Math.abs(p - 14) + rng() * 5;
          if (score > bestScore) {
            bestScore = score;
            bestO = o;
          }
        }
        if (!bestO) return null;
        c.off = bestO;
        R = c.subMass * bestO;
      } else if (children.length === 2) {
        /* first child hangs left (negative slot), second hangs right */
        const c1 = children[0];
        const c2 = children[1];
        let best = null;
        let bestScore = -Infinity;
        for (let o1 = 1; o1 <= rod.len; o1++) {
          for (let o2 = 1; o2 <= rod.len; o2++) {
            const R2 = -c1.subMass * o1 + c2.subMass * o2;
            if (Math.abs(R2) > compMax) continue;
            const score =
              -Math.abs(Math.abs(R2) - 16) + rng() * 8 + (o1 !== o2 ? 1.5 : 0);
            if (score > bestScore) {
              bestScore = score;
              best = { o1: o1, o2: o2, R: R2 };
            }
          }
        }
        if (!best) return null;
        c1.off = -best.o1;
        c2.off = best.o2;
        R = best.R;
      }
      const leaves = pickPlacements(rod.len, -R, rng);
      if (!leaves) return null;
      for (const lf of leaves) {
        rod.leaves.push({ uid: uid, mass: lf.m, slot: lf.s, rod: rod.id });
        uid++;
      }
      if (rng() < 0.3 && uid < 9) {
        rod.leaves.push({
          uid: uid,
          mass: 1 + Math.floor(rng() * 4),
          slot: 0,
          rod: rod.id,
        });
        uid++;
      }
      let mass = ROD_MASS;
      rod.leaves.forEach((lf) => {
        mass += lf.mass;
      });
      children.forEach((c) => {
        mass += c.subMass;
      });
      rod.subMass = mass;
    }

    const flat = [];
    rods.forEach((r) => flat.push(...r.leaves));
    const weights = flat.map((lf) => ({
      uid: "w" + lf.uid,
      num: lf.uid,
      name: NAMES[lf.uid % NAMES.length],
      shape: SHAPES[lf.uid % SHAPES.length],
      color: COLORS[lf.uid % COLORS.length],
      mass: lf.mass,
      slot: lf.slot,
      homeRod: lf.rod,
      loc: "tray",
      rod: null,
      phase: rng() * TAU,
    }));
    for (let i = weights.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = weights[i];
      weights[i] = weights[j];
      weights[j] = t;
    }
    return { rods: rods, weights: weights };
  }

  function buildPiece(def) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const made = tryBuild(def, mulberry32(def.seed + attempt * 7919));
      if (made) return made;
    }
    return tryBuild(def, mulberry32(def.seed));
  }
  /*GEN-END*/

  /* ---------------- DOM ---------------- */

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const chipPiece = document.getElementById("chipPiece");
  const chipArms = document.getElementById("chipArms");
  const chipClock = document.getElementById("chipClock");
  const btnPause = document.getElementById("btnPause");
  const btnSound = document.getElementById("btnSound");
  const btnRestart = document.getElementById("btnRestart");
  const veils = {
    intro: document.getElementById("veilIntro"),
    pause: document.getElementById("veilPause"),
    piece: document.getElementById("veilPiece"),
    win: document.getElementById("veilWin"),
    lose: document.getElementById("veilLose"),
  };
  const pieceTitle = document.getElementById("pieceTitle");
  const pieceStats = document.getElementById("pieceStats");
  const winStats = document.getElementById("winStats");

  function showVeil(name) {
    Object.keys(veils).forEach((k) =>
      veils[k].classList.toggle("show", k === name),
    );
  }

  /* ---------------- game state ---------------- */

  let state = "intro";
  let pieceIdx = 0;
  let rods = [];
  let weights = [];
  let postOrder = [];
  let rodById = new Map();
  let pieceName = "";
  let timeLeft = 0;
  let moves = 0;
  let totalMoves = 0;
  let spareTotal = 0;
  let settleT = 0;
  let carried = null;
  let selTray = 0;
  let targetRodIdx = 0;
  let kbSlot = 0;
  let kbMode = false;
  let hover = null;
  let bannerT = 0;
  let lastTickSec = -1;
  let lockedPrev = 0;

  const view = { w: 0, h: 0, dpr: 1, u: 30, ox: 0, hookY: 52, trayY: 0 };

  const MAX_TILT = 0.34;
  const SPRING_K = 30;
  const SPRING_C = 6.5;

  function allPlaced() {
    return !carried && weights.every((w) => w.loc === "hung");
  }

  function loadPiece(i) {
    const def = PIECE_DEFS[i];
    const gen = buildPiece(def);
    pieceName = def.name;
    pieceIdx = i;
    rodById = new Map();
    rods = gen.rods.map((r) => ({
      id: r.id,
      parent: r.parent,
      len: r.len,
      off: r.off,
      subMass: r.subMass,
      moment: 0,
      theta: (Math.random() - 0.5) * 0.08,
      omega: 0,
      depth: 0,
      spark: Math.random() * 10,
      geo: null,
    }));
    rods.forEach((r) => rodById.set(r.id, r));
    rods.forEach((r) => {
      let d = 0;
      let cur = r;
      while (cur.parent) {
        cur = rodById.get(cur.parent);
        d++;
      }
      r.depth = d;
    });
    postOrder = [];
    const visit = (id) => {
      rods.forEach((r) => {
        if (r.parent === id) visit(r.id);
      });
      postOrder.push(rodById.get(id));
    };
    visit(def.rods[0].id);
    weights = gen.weights.map((w) =>
      Object.assign({}, w, { px: 0, py: 0, ax: 0, ay: 0, swayA: 0.1 }),
    );
    carried = null;
    selTray = 0;
    targetRodIdx = 0;
    kbSlot = 0;
    kbMode = false;
    hover = null;
    moves = 0;
    settleT = 0;
    timeLeft = def.time;
    bannerT = 2.4;
    lastTickSec = -1;
    lockedPrev = 0;
    computeMoments();
    resize();
    updateChips(true);
  }

  function computeMoments() {
    postOrder.forEach((r) => {
      let m = 0;
      let mass = ROD_MASS;
      weights.forEach((w) => {
        if (w.rod === r.id) {
          m += w.mass * w.slot;
          mass += w.mass;
        }
      });
      rods.forEach((c) => {
        if (c.parent === r.id) {
          m += c.subMass * c.off;
          mass += c.subMass;
        }
      });
      r.moment = m;
      r.subMass = mass;
    });
  }

  function isLevel(r) {
    return (
      r.moment === 0 && Math.abs(r.theta) < 0.03 && Math.abs(r.omega) < 0.05
    );
  }

  function lockedCount() {
    let n = 0;
    rods.forEach((r) => {
      if (isLevel(r)) n++;
    });
    return n;
  }

  /* ---------------- actions ---------------- */

  function trayList() {
    return weights.filter((w) => w.loc === "tray");
  }

  function place(w, rodId, slot) {
    w.rod = rodId;
    w.slot = slot;
    w.loc = "hung";
    moves++;
    totalMoves++;
    settleT = 0;
    computeMoments();
    Sound.hangOk();
  }

  function lift(w) {
    if (w.loc === "hand" || carried) return;
    w.loc = "hand";
    w.rod = null;
    carried = w;
    moves++;
    totalMoves++;
    settleT = 0;
    kbMode = false;
    computeMoments();
    Sound.pick();
  }

  function toTray(w) {
    w.loc = "tray";
    w.rod = null;
    if (carried === w) carried = null;
    computeMoments();
  }

  function occupiedSlots(rodId) {
    const set = new Set();
    weights.forEach((w) => {
      if (w.rod === rodId) set.add(w.slot);
    });
    return set;
  }

  function freeSlotNear(rodId, slot) {
    const len = rodById.get(rodId).len;
    const occ = occupiedSlots(rodId);
    for (let d = 0; d <= len; d++) {
      const around = d === 0 ? [slot] : [slot - d, slot + d];
      for (const s of around) {
        if (Math.abs(s) <= len && !occ.has(s)) return s;
      }
    }
    return null;
  }

  /* ---------------- input ---------------- */

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const pointer = { x: -999, y: -999 };

  function rodUnder(px, py) {
    let best = null;
    let bestD = 20;
    rods.forEach((r) => {
      const geo = r.geo;
      if (!geo) return;
      const vx = geo.rx - geo.lx;
      const vy = geo.ry - geo.ly;
      const L2 = vx * vx + vy * vy || 1;
      let t = ((px - geo.lx) * vx + (py - geo.ly) * vy) / L2;
      t = clamp(t, 0, 1);
      const qx = geo.lx + vx * t;
      const qy = geo.ly + vy * t;
      const d = Math.hypot(px - qx, py - qy);
      if (d < bestD) {
        bestD = d;
        const localX = (t * 2 - 1) * r.len * view.u;
        best = {
          rod: r,
          slot: clamp(Math.round(localX / view.u), -r.len, r.len),
        };
      }
    });
    return best;
  }

  function trayHit(px, py) {
    const list = trayList();
    for (let i = 0; i < list.length; i++) {
      const rc = trayRect(list, i);
      if (px >= rc.x && px <= rc.x + rc.w && py >= rc.y && py <= rc.y + rc.h)
        return list[i];
    }
    return null;
  }

  function hungHit(px, py) {
    for (let i = weights.length - 1; i >= 0; i--) {
      const w = weights[i];
      if (w.loc !== "hung") continue;
      const rr = view.u * 0.5 + 10;
      if (Math.hypot(px - w.px, py - w.py) < rr) return w;
    }
    return null;
  }

  function updateHover(px, py) {
    const hit = rodUnder(px, py);
    if (hit) {
      const slot = freeSlotNear(hit.rod.id, hit.slot);
      hover = slot === null ? null : { rod: hit.rod.id, slot: slot };
    } else {
      hover = null;
    }
  }

  function kbHover() {
    if (!carried) return null;
    const r = rods[targetRodIdx % rods.length];
    const slot = freeSlotNear(r.id, clamp(kbSlot, -r.len, r.len));
    return slot === null ? null : { rod: r.id, slot: slot };
  }

  function tryDropHover() {
    if (!carried) return;
    const target = kbMode ? kbHover() : hover;
    if (!target) return;
    place(carried, target.rod, target.slot);
    carried = null;
    hover = null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    Sound.ensure();
    if (state !== "playing") return;
    const p = canvasPos(e);
    pointer.x = p.x;
    pointer.y = p.y;
    kbMode = false;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* pointer already gone */
    }
    if (carried) {
      if (trayHit(p.x, p.y) === carried) {
        toTray(carried);
        return;
      }
      updateHover(p.x, p.y);
      tryDropHover();
      return;
    }
    const tw = trayHit(p.x, p.y);
    if (tw) {
      selTray = trayList().indexOf(tw);
      lift(tw);
      updateHover(p.x, p.y);
      return;
    }
    const hw = hungHit(p.x, p.y);
    if (hw) lift(hw);
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = canvasPos(e);
    pointer.x = p.x;
    pointer.y = p.y;
    if (state === "playing") updateHover(p.x, p.y);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state !== "playing") return;
    const p = canvasPos(e);
    pointer.x = p.x;
    pointer.y = p.y;
    if (carried) {
      if (trayHit(p.x, p.y) === carried) {
        toTray(carried);
        return;
      }
      updateHover(p.x, p.y);
      tryDropHover();
    }
  });

  document.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "p" || k === "P") {
      togglePause();
      e.preventDefault();
      return;
    }
    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if (k === "r" || k === "R") {
      if (state === "playing" || state === "paused" || state === "lost")
        restartPiece();
      e.preventDefault();
      return;
    }
    if (state !== "playing") {
      if ((k === " " || k === "Enter") && state === "intro") {
        beginRun();
        e.preventDefault();
      }
      return;
    }
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      kbMode = true;
      const dir = k === "ArrowLeft" ? -1 : 1;
      if (carried) {
        const r = rods[targetRodIdx % rods.length];
        kbSlot = clamp(kbSlot + dir, -r.len, r.len);
      } else {
        const list = trayList();
        if (list.length) selTray = (selTray + dir + list.length) % list.length;
      }
    } else if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      kbMode = true;
      targetRodIdx =
        (targetRodIdx + (k === "ArrowUp" ? -1 : 1) + rods.length) % rods.length;
      const r = rods[targetRodIdx];
      kbSlot = clamp(kbSlot, -r.len, r.len);
    } else if (k === " " || k === "Enter") {
      e.preventDefault();
      kbMode = true;
      if (!carried) {
        const list = trayList();
        if (list.length) {
          lift(list[selTray % list.length]);
          const r = rods[targetRodIdx % rods.length];
          kbSlot = Math.round(r.len * 0.4);
        }
      } else {
        tryDropHover();
      }
    } else if (k === "Escape") {
      if (carried) toTray(carried);
    }
  });

  /* ---------------- flow ---------------- */

  function beginRun() {
    Sound.ensure();
    totalMoves = 0;
    spareTotal = 0;
    startPiece(0);
  }

  function startPiece(i) {
    loadPiece(i);
    state = "playing";
    showVeil(null);
    updateChips(true);
  }

  function pieceDone() {
    state = "done";
    spareTotal += Math.floor(timeLeft);
    Sound.fanfare();
    if (pieceIdx >= PIECE_DEFS.length - 1) {
      winRun();
      return;
    }
    pieceTitle.textContent = "\u201C" + pieceName + "\u201D hangs true";
    pieceStats.textContent =
      "Hung with " +
      fmtTime(timeLeft) +
      " to spare \u00B7 " +
      moves +
      " placement" +
      (moves === 1 ? "" : "s");
    showVeil("piece");
  }

  function winRun() {
    state = "won";
    Sound.applause();
    winStats.textContent =
      "Five mobiles turn in the morning light, not one dipping. Finished with " +
      fmtTime(spareTotal) +
      " to spare across " +
      totalMoves +
      " placements.";
    showVeil("win");
  }

  function losePiece() {
    state = "lost";
    Sound.sad();
    showVeil("lose");
  }

  function restartPiece() {
    if (state === "playing" || state === "paused" || state === "lost")
      startPiece(pieceIdx);
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showVeil("pause");
    } else if (state === "paused") {
      state = "playing";
      showVeil(null);
    }
  }

  function toggleMute() {
    const m = Sound.toggle();
    btnSound.classList.toggle("muted", m);
    btnSound.setAttribute("aria-pressed", String(m));
  }

  document.getElementById("btnBegin").addEventListener("click", beginRun);
  document.getElementById("btnResume").addEventListener("click", togglePause);
  document
    .getElementById("btnNext")
    .addEventListener("click", () => startPiece(pieceIdx + 1));
  document.getElementById("btnAgain").addEventListener("click", beginRun);
  document
    .getElementById("btnRetry")
    .addEventListener("click", () => startPiece(pieceIdx));
  btnPause.addEventListener("click", togglePause);
  btnSound.addEventListener("click", toggleMute);
  btnRestart.addEventListener("click", restartPiece);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  /* ---------------- update ---------------- */

  function stepPhysics(dt) {
    rods.forEach((r) => {
      const eq = MAX_TILT * Math.tanh(r.moment / 12);
      r.omega += ((eq - r.theta) * SPRING_K - r.omega * SPRING_C) * dt;
      r.theta += r.omega * dt;
    });
  }

  function update(dt) {
    stepPhysics(dt);
    weights.forEach((w) => {
      w.phase += dt * (1.05 + (w.num % 5) * 0.13);
      const host = w.rod ? rodById.get(w.rod) : null;
      const excite = host ? Math.abs(host.omega) * 2.2 : 0.12;
      w.swayA = Math.min(0.5, 0.08 + excite);
    });
    const placed = allPlaced();
    const locked = lockedCount();
    if (locked > lockedPrev) {
      let deepest = 0;
      rods.forEach((r) => {
        if (isLevel(r)) deepest = Math.max(deepest, r.depth);
      });
      Sound.lock(deepest);
    }
    lockedPrev = locked;
    if (placed && locked === rods.length) {
      settleT += dt;
      if (settleT >= 0.55) {
        pieceDone();
        return;
      }
    } else {
      settleT = 0;
    }
    timeLeft -= dt;
    if (timeLeft <= 5 && timeLeft > 0) {
      const s = Math.ceil(timeLeft);
      if (s !== lastTickSec) {
        lastTickSec = s;
        Sound.tick();
      }
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      losePiece();
      return;
    }
    if (bannerT > 0) bannerT -= dt;
    updateChips(false);
  }

  function fmtTime(t) {
    t = Math.max(0, Math.ceil(t));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  const chipCache = { piece: "", arms: "", clock: "" };
  function updateChips(force) {
    const ps = "Piece " + (pieceIdx + 1) + " \u00B7 " + pieceName;
    const as = "Arms " + lockedCount() + "/" + rods.length;
    const cs = fmtTime(timeLeft);
    if (force || chipCache.piece !== ps) {
      chipCache.piece = ps;
      chipPiece.textContent = ps;
    }
    if (force || chipCache.arms !== as) {
      chipCache.arms = as;
      chipArms.textContent = as;
    }
    if (force || chipCache.clock !== cs) {
      chipCache.clock = cs;
      chipClock.textContent = cs;
      chipClock.classList.toggle("warn", timeLeft <= 15 && state === "playing");
    }
  }

  /* ---------------- layout & render ---------------- */

  function subtreeReach(r) {
    let sub = 0;
    rods.forEach((c) => {
      if (c.parent === r.id)
        sub = Math.max(sub, Math.abs(c.off) + subtreeReach(c));
    });
    return r.len + sub;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w;
    view.h = h;
    view.dpr = dpr;
    view.trayY = h - 112;
    let reach = 5;
    rods.forEach((r) => {
      if (!r.parent) reach = subtreeReach(r);
    });
    const spanU = reach * 2 + 3;
    let vU = 3;
    rods.forEach((r) => {
      vU = Math.max(vU, (r.depth + 1) * 3.4 + 2);
    });
    const availW = w - 36;
    const availH = view.trayY - view.hookY - 90;
    view.u = clamp(Math.min(availW / spanU, availH / vU), 15, 46);
    view.ox = w / 2;
  }

  function tierString(depth) {
    return Math.max(16, view.u * 0.72 + 32 - depth * 9);
  }

  function weightString(w) {
    return view.u * 0.66 + 18 + (w.num % 3) * 9;
  }

  function layoutMobile() {
    const hook = { x: view.ox, y: view.hookY };
    const walk = (r, attach) => {
      const sl = tierString(r.depth);
      const px = attach.x;
      const py = attach.y + sl;
      const cs = Math.cos(r.theta);
      const sn = Math.sin(r.theta);
      const local = (x) => ({ x: px + x * cs, y: py + x * sn });
      const l = local(-r.len * view.u);
      const rr = local(r.len * view.u);
      r.geo = {
        ax: attach.x,
        ay: attach.y,
        px: px,
        py: py,
        lx: l.x,
        ly: l.y,
        rx: rr.x,
        ry: rr.y,
      };
      rods.forEach((c) => {
        if (c.parent === r.id) walk(c, local(c.off * view.u));
      });
      weights.forEach((w) => {
        if (w.rod === r.id) {
          const ap = local(w.slot * view.u);
          w.ax = ap.x;
          w.ay = ap.y;
          w.px = ap.x;
          w.py = ap.y + weightString(w);
        }
      });
    };
    rods.forEach((r) => {
      if (!r.parent) walk(r, hook);
    });
  }

  function trayRect(list, i) {
    const cw = 64;
    const gap = 10;
    const total = list.length * cw + (list.length - 1) * gap;
    const x0 = (view.w - total) / 2;
    return { x: x0 + i * (cw + gap), y: view.trayY, w: cw, h: 92 };
  }

  function drawShape(shape, r, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (shape === "orb" || shape === "pearl") {
      const rad = shape === "pearl" ? r * 0.78 : r;
      ctx.arc(0, 0, rad, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(-rad * 0.3, -rad * 0.35, rad * 0.28, 0, TAU);
      ctx.fill();
      return;
    }
    if (shape === "leaf" || shape === "seed") {
      const kk = shape === "seed" ? 0.62 : 0.52;
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * kk, -r * 0.5, r * kk, r * 0.55, 0, r);
      ctx.bezierCurveTo(-r * kk, r * 0.55, -r * kk, -r * 0.5, 0, -r);
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (shape === "bell") {
      ctx.moveTo(-r * 0.8, r * 0.7);
      ctx.lineTo(-r * 0.55, -r * 0.2);
      ctx.quadraticCurveTo(-r * 0.5, -r, 0, -r);
      ctx.quadraticCurveTo(r * 0.5, -r, r * 0.55, -r * 0.2);
      ctx.lineTo(r * 0.8, r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-r * 0.95, r * 0.7, r * 1.9, r * 0.18);
      return;
    }
    if (shape === "fish") {
      ctx.ellipse(0, 0, r, r * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.85, 0);
      ctx.lineTo(r * 1.45, -r * 0.5);
      ctx.lineTo(r * 1.45, r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#20180f";
      ctx.beginPath();
      ctx.arc(-r * 0.45, -r * 0.1, r * 0.1, 0, TAU);
      ctx.fill();
      return;
    }
    if (shape === "moon") {
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.bezierCurveTo(r * 0.35, r * 0.65, r * 0.35, -r * 0.65, -r, 0);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (shape === "key") {
      ctx.arc(0, -r * 0.45, r * 0.5, 0, TAU);
      ctx.fill();
      ctx.fillRect(-r * 0.16, -r * 0.1, r * 0.32, r * 1.15);
      ctx.fillRect(r * 0.02, r * 0.55, r * 0.5, r * 0.18);
      return;
    }
    if (shape === "bird") {
      ctx.ellipse(0, 0, r * 0.75, r * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, -r * 0.2);
      ctx.quadraticCurveTo(-r * 0.9, -r * 1.1, -r * 0.15, -r * 0.75);
      ctx.quadraticCurveTo(r * 0.2, -r * 0.5, -r * 0.1, -r * 0.2);
      ctx.fill();
      ctx.fillStyle = "#20180f";
      ctx.beginPath();
      ctx.arc(r * 0.45, -r * 0.12, r * 0.09, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.moveTo(0, -r);
    for (let i = 1; i < 11; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(Math.cos(a) * rad * 0.9, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawWeightBody(w, x, y, scale, alpha, ghost) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(w.phase) * w.swayA * 0.5);
    ctx.globalAlpha = alpha;
    const r = view.u * 0.42 * scale;
    if (ghost) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,215,122,0.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawShape(w.shape, r, w.color);
    ctx.fillStyle = "rgba(20,14,8,0.85)";
    ctx.font =
      "600 " + Math.max(9, Math.round(view.u * 0.3)) + "px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(w.mass), 0, 1);
    ctx.restore();
  }

  function drawString(x1, y1, x2, y2, alpha) {
    ctx.strokeStyle = "rgba(235,225,205," + (alpha || 0.75) + ")";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawRodBar(r) {
    const g = r.geo;
    const locked = allPlaced() && isLevel(r);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(5, view.u * 0.17);
    const grad = ctx.createLinearGradient(g.lx, g.ly, g.rx, g.ry);
    if (locked) {
      grad.addColorStop(0, "#e8b95a");
      grad.addColorStop(1, "#c98f2e");
    } else {
      grad.addColorStop(0, "#7a5a38");
      grad.addColorStop(0.5, "#96713f");
      grad.addColorStop(1, "#6d4f31");
    }
    ctx.strokeStyle = grad;
    ctx.shadowColor = locked ? "rgba(255,215,122,0.55)" : "rgba(0,0,0,0.35)";
    ctx.shadowBlur = locked ? 14 : 5;
    ctx.beginPath();
    ctx.moveTo(g.lx, g.ly);
    ctx.lineTo(g.rx, g.ry);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = locked ? "#ffd77a" : "#3d2c1c";
    ctx.beginPath();
    ctx.arc(g.px, g.py, Math.max(3, view.u * 0.1), 0, TAU);
    ctx.fill();
    if (locked) {
      const tw = performance.now() / 1000;
      ctx.fillStyle = "rgba(255,232,170,0.9)";
      for (let i = 0; i < 3; i++) {
        const f = (r.spark + i * 2.1 + tw * 0.7) % 2;
        const t = f / 2;
        const sx = g.lx + (g.rx - g.lx) * (0.15 + 0.7 * t);
        const sy =
          g.ly +
          (g.ry - g.ly) * (0.15 + 0.7 * t) -
          7 -
          3 * Math.sin(tw * 3 + i * 2);
        ctx.globalAlpha = Math.max(0, 0.4 + 0.4 * Math.sin(tw * 4 + i * 1.7));
        ctx.fillRect(sx - 1, sy - 3, 2, 6);
        ctx.fillRect(sx - 3, sy - 1, 6, 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawBackdrop() {
    const cx = view.ox;
    const cy = view.hookY + view.u * 1.2;
    const rad = Math.max(view.w, 500) * 0.42;
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad);
    g.addColorStop(0, "rgba(255,240,200,0.10)");
    g.addColorStop(0.55, "rgba(255,240,200,0.035)");
    g.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.strokeStyle = "rgba(240,231,214,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, view.trayY - 18);
    ctx.lineTo(view.w, view.trayY - 18);
    ctx.stroke();
    let rootTheta = 0;
    rods.forEach((r) => {
      if (!r.parent && r.geo) rootTheta = r.theta;
    });
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(
      cx,
      view.trayY - 24,
      reachPx() * 0.85 + rootTheta * 40,
      9,
      0,
      0,
      TAU,
    );
    ctx.fill();
    ctx.fillStyle = "rgba(240,231,214,0.5)";
    ctx.fillRect(cx - 16, view.hookY - 10, 32, 5);
  }

  function reachPx() {
    let reach = 5;
    rods.forEach((r) => {
      if (!r.parent) reach = subtreeReach(r);
    });
    return reach * view.u;
  }

  function drawGhostPreview() {
    if (!carried) return;
    const target = kbMode ? kbHover() : hover;
    if (!target) return;
    const r = rodById.get(target.rod);
    if (!r || !r.geo) return;
    const cs = Math.cos(r.theta);
    const sn = Math.sin(r.theta);
    const ax = r.geo.px + target.slot * view.u * cs;
    const ay = r.geo.py + target.slot * view.u * sn;
    const wy = ay + weightString(carried);
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "rgba(235,225,205,0.5)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, wy);
    ctx.stroke();
    ctx.setLineDash([]);
    drawWeightBody(carried, ax, wy, 1, 0.45, true);
    const newMoment = r.moment + carried.mass * target.slot;
    if (newMoment !== 0) {
      const dir = newMoment > 0 ? 1 : -1;
      const improving = Math.abs(newMoment) < Math.abs(r.moment);
      const mag = Math.tanh(Math.abs(newMoment) / 10);
      const bx = r.geo.px + dir * (r.len * view.u + 14 + 8 * mag) * cs;
      const by = r.geo.py + dir * (r.len * view.u + 14 + 8 * mag) * sn;
      const dx = cs * dir;
      const dy = sn * dir;
      ctx.strokeStyle = improving
        ? "rgba(255,215,122,0.95)"
        : "rgba(255,141,122,0.95)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      for (let i = 0; i < 2; i++) {
        const off = i * 8 * mag + 3;
        ctx.beginPath();
        ctx.moveTo(
          bx + dx * off - dx * 8 - dy * 6,
          by + dy * off - dy * 8 + dx * 6,
        );
        ctx.lineTo(bx + dx * off, by + dy * off);
        ctx.lineTo(
          bx + dx * off - dx * 8 + dy * 6,
          by + dy * off - dy * 8 - dx * 6,
        );
        ctx.stroke();
      }
      ctx.fillStyle = improving
        ? "rgba(255,215,122,0.95)"
        : "rgba(255,141,122,0.95)";
      ctx.font = "italic 11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(improving ? "nearer level" : "tips further", bx, by + 22);
    }
  }

  function drawTray() {
    const list = trayList();
    if (!list.length) return;
    ctx.save();
    ctx.fillStyle = "rgba(12,8,18,0.55)";
    ctx.strokeStyle = "rgba(240,231,214,0.12)";
    ctx.lineWidth = 1;
    const first = trayRect(list, 0);
    const last = trayRect(list, list.length - 1);
    const pad = 10;
    ctx.beginPath();
    ctx.roundRect(
      first.x - pad,
      view.trayY - pad,
      last.x + last.w + pad - (first.x - pad),
      92 + pad * 2,
      12,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    list.forEach((w, i) => {
      const rc = trayRect(list, i);
      const sel = !carried && kbMode && i === selTray % list.length;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      ctx.strokeStyle = sel
        ? "rgba(255,215,122,0.9)"
        : "rgba(240,231,214,0.14)";
      ctx.lineWidth = sel ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(rc.x, rc.y, rc.w, rc.h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const savedPhase = w.phase;
      const savedSway = w.swayA;
      w.phase = 0;
      w.swayA = 0;
      drawWeightBody(w, rc.x + rc.w / 2, rc.y + 34, 0.92, 1, false);
      w.phase = savedPhase;
      w.swayA = savedSway;
      ctx.fillStyle = "rgba(240,231,214,0.75)";
      ctx.font = "11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        w.name + " \u00B7 " + w.mass + "g",
        rc.x + rc.w / 2,
        rc.y + 78,
      );
    });
    ctx.fillStyle = "rgba(157,143,179,0.8)";
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("the carving tray", view.w / 2, view.trayY + 104);
  }

  function drawBanner() {
    if (bannerT <= 0) return;
    const a = Math.min(1, bannerT / 0.6);
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    ctx.fillStyle = "#f0e7d6";
    ctx.font = "600 " + Math.max(20, view.u * 0.72) + "px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      "No." + (pieceIdx + 1) + " \u2014 " + pieceName,
      view.w / 2,
      view.hookY + view.u * 3.1,
    );
    ctx.font = "italic 13px Georgia, serif";
    ctx.globalAlpha = a * 0.7;
    ctx.fillText(
      "hang every carving, then level every arm",
      view.w / 2,
      view.hookY + view.u * 3.1 + 22,
    );
    ctx.restore();
  }

  function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    drawBackdrop();
    layoutMobile();
    rods.forEach((r) => {
      const g = r.geo;
      drawString(g.ax, g.ay, g.px, g.py, 0.8);
    });
    rods.forEach((r) => drawRodBar(r));
    weights.forEach((w) => {
      if (w.loc === "hung") drawString(w.ax, w.ay, w.px, w.py, 0.7);
    });
    weights.forEach((w) => {
      if (w.loc === "hung") drawWeightBody(w, w.px, w.py, 1, 1, false);
    });
    drawGhostPreview();
    if (carried && !kbMode) {
      drawWeightBody(carried, pointer.x, pointer.y + 6, 1.05, 1, false);
    }
    drawTray();
    drawBanner();
  }

  /* ---------------- main loop ---------------- */

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (state === "playing") {
      update(dt);
    } else if (state !== "paused") {
      stepPhysics(dt);
      weights.forEach((w) => {
        w.phase += dt * (1.05 + (w.num % 5) * 0.13);
        w.swayA = 0.1;
      });
      if (bannerT > 0) bannerT -= dt;
    }
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);

  /* ---------------- test hooks (kept deliberately tiny) ---------------- */

  window.__poise = {
    state: () => state,
    pieceIndex: () => pieceIdx,
    rods: () =>
      rods.map((r) => ({
        id: r.id,
        moment: r.moment,
        theta: +r.theta.toFixed(3),
      })),
    weights: () =>
      weights.map((w) => ({ id: w.uid, loc: w.loc, rod: w.rod, slot: w.slot })),
    solution: () =>
      weights.map((w) => ({ id: w.uid, rod: w.homeRod, slot: w.slot })),
    trayCount: () => trayList().length,
    trayRectAt: (i) => trayRect(trayList(), i),
    unit: () => view.u,
    rodMid: (rid) => {
      const r = rodById.get(rid);
      return { x: (r.geo.lx + r.geo.rx) / 2, y: (r.geo.ly + r.geo.ry) / 2 };
    },
    place: (uid, rid, slot) => {
      const w = weights.find((x) => x.uid === uid);
      if (!w) return "no-weight";
      if (carried && carried !== w) toTray(carried);
      if (w.loc === "hand") carried = null;
      const s = freeSlotNear(rid, slot);
      if (s === null) return "full";
      place(w, rid, s);
      return "ok";
    },
    solveAll: () => {
      let n = 0;
      weights.forEach((w) => {
        if (w.loc !== "hung") {
          const s = freeSlotNear(w.homeRod, w.slot);
          if (s !== null) {
            place(w, w.homeRod, s);
            n++;
          }
        }
      });
      return n;
    },
    forceLose: () => {
      timeLeft = 0.01;
    },
    clock: () => timeLeft,
  };

  /* ---------------- boot ---------------- */

  resize();
  loadPiece(0);
  state = "intro";
  showVeil("intro");
  requestAnimationFrame(frame);
})();
