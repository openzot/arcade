/* First Light — a hilltop almanac game for the arcade.
   The sky wheels toward dawn. Find each named figure among the stars, tap its
   stars in linked order to spin the almanac's thread, and seal three plates
   before first light wipes the dark off the hills. False links spill scarce
   ink; rare glimpses make the true stars breathe.

   Everything lives in this one classic script, wrapped in one IIFE. */

(function () {
  "use strict";

  /* ── dom ──────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);
  const canvas = $("sky");
  const ghost = $("ghost");
  const ctx = canvas.getContext("2d");
  const gctx = ghost.getContext("2d");

  const el = {
    nightLabel: $("night-label"),
    targetName: $("target-name"),
    progress: $("progress"),
    inkRow: $("ink-row"),
    glanceRow: $("glance-row"),
    dawnFill: $("dawn-fill"),
    eye: $("btn-eye"),
    undo: $("btn-undo"),
    clear: $("btn-clear"),
    pause: $("btn-pause"),
    mute: $("btn-mute"),
    restart: $("btn-restart"),
    start: $("btn-start"),
    next: $("btn-next"),
    again: $("btn-again"),
    newrun: $("btn-newrun"),
    resume: $("btn-resume"),
    interTitle: $("inter-title"),
    interKicker: $("inter-kicker"),
    interLines: $("inter-lines"),
    failLines: $("fail-lines"),
    winLines: $("win-lines"),
    overlays: {
      intro: $("ov-intro"),
      inter: $("ov-inter"),
      fail: $("ov-fail"),
      win: $("ov-win"),
      pauseOv: $("ov-pause"),
    },
  };

  /* ── helpers ──────────────────────────────────────────── */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ROMAN = ["I", "II", "III", "IV", "V"];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const mix = (c1, c2, t) => [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
  const css = (c, a) =>
    "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";

  const GOLD = [255, 217, 138];
  const GOLD_BRIGHT = [255, 230, 174];
  const VIOLET = [179, 157, 255];
  const DANGER = [255, 93, 93];

  /* ── audio (all synthesised, nothing fetched) ─────────── */

  let AC = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  function audio() {
    if (!AC) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(AC.destination);
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
    return AC;
  }

  function makeNoise() {
    const len = AC.sampleRate * 1.2;
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  function tone(freq, dur, type, vol, delay, glideTo) {
    if (!AC || muted) return;
    const t0 = AC.currentTime + (delay || 0);
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function breath(dur, vol, freq, delay) {
    if (!AC || muted) return;
    if (!noiseBuf) makeNoise();
    const t0 = AC.currentTime + (delay || 0);
    const src = AC.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = AC.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = 1.4;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const PENTA = [0, 2, 4, 7, 9];
  const sfx = {
    pluck(n) {
      const semi = PENTA[n % 5] + 12 * Math.floor(n / 5);
      const f = 392 * Math.pow(2, semi / 12);
      tone(f, 0.3, "triangle", 0.17);
      tone(f * 2, 0.18, "sine", 0.05);
    },
    wrong() {
      tone(150, 0.14, "square", 0.09, 0, 72);
      breath(0.12, 0.06, 300);
    },
    wobble() {
      tone(240, 0.07, "sine", 0.05, 0, 210);
    },
    seal() {
      tone(523, 0.5, "sine", 0.14);
      tone(659, 0.5, "sine", 0.12, 0.1);
      tone(784, 0.7, "sine", 0.12, 0.2);
      breath(0.5, 0.04, 2600, 0.15);
    },
    glance() {
      breath(0.9, 0.09, 850);
      tone(1174, 0.4, "sine", 0.04, 0.1);
    },
    nightfall() {
      tone(220, 1.4, "sine", 0.06);
      tone(277, 1.4, "sine", 0.05, 0.05);
      tone(330, 1.6, "sine", 0.05, 0.1);
    },
    dawnFail() {
      tone(330, 0.8, "sine", 0.1, 0, 262);
      tone(196, 1.3, "sine", 0.1, 0.35, 147);
      breath(1.2, 0.05, 500, 0.2);
    },
    fanfare() {
      [523, 659, 784, 1046].forEach((f, i) =>
        tone(f, 0.7, "sine", 0.12, i * 0.13),
      );
      breath(1.2, 0.05, 3200, 0.3);
    },
  };

  /* ── constellation templates ──────────────────────────── */
  /* pts are unit-space coordinates; seq lists pt indices in stroke order
     (indices may repeat — a star may be passed through twice). Edges are the
     consecutive pairs of seq; a closed figure wraps back to its first point. */

  const RAW = {
    ladle: {
      name: "The Ladle",
      pts: [
        [-0.72, -0.3],
        [-0.4, -0.48],
        [-0.08, -0.36],
        [-0.14, -0.06],
        [0.24, -0.16],
        [0.6, -0.3],
      ],
      seq: [5, 4, 3, 0, 1, 2, 3],
    },
    circlet: {
      name: "The Circlet",
      pts: [
        [-0.62, -0.02],
        [-0.4, -0.4],
        [0.02, -0.56],
        [0.46, -0.38],
        [0.58, 0.04],
        [0.02, 0.16],
      ],
      closed: true,
    },
    key: {
      name: "The Key",
      pts: [
        [-0.02, -0.54],
        [0.24, -0.3],
        [-0.02, -0.06],
        [-0.28, -0.3],
        [-0.02, 0.18],
        [-0.02, 0.58],
      ],
      seq: [5, 4, 2, 1, 0, 3, 2],
    },
    swan: {
      name: "The Swan",
      pts: [
        [-0.66, -0.3],
        [-0.46, -0.46],
        [-0.34, -0.2],
        [-0.18, -0.42],
        [-0.04, -0.16],
        [0.34, -0.04],
        [0.58, 0.22],
        [0.12, 0.36],
        [-0.3, 0.24],
      ],
      closed: true,
    },
    lantern: {
      name: "The Lantern",
      pts: [
        [0, -0.62],
        [-0.34, -0.3],
        [-0.26, 0.34],
        [0, 0.55],
        [0.26, 0.34],
        [0.34, -0.3],
      ],
      closed: true,
    },
    serpent: {
      name: "The Serpent",
      pts: [
        [-0.85, -0.1],
        [-0.6, -0.38],
        [-0.35, -0.12],
        [-0.1, 0.14],
        [0.15, -0.12],
        [0.4, -0.38],
        [0.68, -0.18],
      ],
      open: true,
    },
    harp: {
      name: "The Harp",
      pts: [
        [-0.55, -0.05],
        [-0.35, -0.35],
        [0, -0.62],
        [0.38, -0.38],
        [0.58, -0.02],
        [0.3, 0.3],
        [-0.25, 0.28],
      ],
      closed: true,
    },
    kettle: {
      name: "The Kettle",
      pts: [
        [0.78, -0.34],
        [0.52, -0.16],
        [0.36, 0.02],
        [0.2, 0.4],
        [-0.24, 0.38],
        [-0.4, 0],
        [-0.16, -0.34],
        [-0.16, -0.6],
      ],
      open: true,
    },
    comet: {
      name: "The Comet",
      pts: [
        [-0.86, 0.28],
        [-0.52, 0.16],
        [-0.22, 0.04],
        [0.1, -0.1],
        [0.34, -0.28],
        [0.52, -0.02],
        [0.22, 0.18],
      ],
      seq: [0, 1, 2, 3, 4, 5, 6, 3],
    },
  };

  const TEMPLATES = {};
  Object.keys(RAW).forEach((k) => {
    const raw = RAW[k];
    let seq;
    if (raw.seq) seq = raw.seq.slice();
    else {
      seq = raw.pts.map((_, i) => i);
      if (!raw.open) seq.push(0);
    }
    const pairs = [];
    for (let i = 0; i < seq.length - 1; i++) pairs.push([seq[i], seq[i + 1]]);
    const edgeSet = new Set();
    pairs.forEach((p) =>
      edgeSet.add(p[0] < p[1] ? p[0] + "-" + p[1] : p[1] + "-" + p[0]),
    );
    TEMPLATES[k] = { name: raw.name, pts: raw.pts, seq, pairs, edgeSet };
  });

  const NIGHTS = [
    {
      dur: 105,
      rev: 260,
      ink: 12,
      glances: 3,
      fieldStars: 46,
      plates: ["ladle", "circlet", "key"],
    },
    {
      dur: 122,
      rev: 215,
      ink: 13,
      glances: 3,
      fieldStars: 64,
      plates: ["swan", "lantern", "serpent"],
    },
    {
      dur: 138,
      rev: 180,
      ink: 14,
      glances: 4,
      fieldStars: 84,
      plates: ["harp", "kettle", "comet"],
    },
  ];

  /* ── state ────────────────────────────────────────────── */

  const S = {
    mode: "intro",
    night: 0,
    score: 0,
    best: 0,
    elapsed: 0,
    dur: 105,
    rot: 0,
    rev: 260,
    ink: 12,
    cap: 12,
    glances: 3,
    glanceCap: 3,
    glanceLeft: 0,
    activePlate: 0,
    shake: 0,
  };

  let stars = [];
  let micro = [];
  let nebulae = [];
  let plates = [];
  let effects = [];
  let sparks = [];
  let scheduleEnd = 0;
  let gt = 0;

  let rng = Math.random;

  /* thread: path of star ids; used = template-edge keys already spun */
  const thread = { path: [], used: new Set() };

  try {
    S.best = parseInt(localStorage.getItem("firstlight.best") || "0", 10) || 0;
  } catch (err) {
    S.best = 0;
  }

  /* ── view ─────────────────────────────────────────────── */

  const V = { w: 0, h: 0, dpr: 1, cx: 0, cy: 0, R: 100, hz: 0, ui: 1 };
  let horizonLayer = null;
  let vignette = null;

  function resize() {
    V.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    V.w = Math.max(320, r.width);
    V.h = Math.max(320, r.height);
    canvas.width = Math.round(V.w * V.dpr);
    canvas.height = Math.round(V.h * V.dpr);
    /* keep the whole wheel on screen: pole centred in the band between the
       HUD and the horizon, so no star ever rotates out of view */
    const clearTop = 100;
    V.hz = V.h * 0.86;
    const avail = Math.max(240, V.hz - 14 - clearTop);
    V.R = Math.min(V.w * 0.46, avail / 2);
    V.cx = V.w * 0.5;
    V.cy = clearTop + avail / 2;
    V.ui = clamp(V.R / 420, 0.72, 1.6);

    const gr = Math.min(V.w, V.h);
    vignette = ctx.createRadialGradient(
      V.cx,
      V.cy - V.h * 0.05,
      gr * 0.3,
      V.cx,
      V.cy,
      gr * 0.95,
    );
    vignette.addColorStop(0, "rgba(2,3,8,0)");
    vignette.addColorStop(1, "rgba(2,3,8,0.6)");

    prerenderGhostCanvasSize();
    prerenderHorizon();
  }

  /* ── star sprites ─────────────────────────────────────── */

  function starSprite(rgb) {
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(24, 24, 1, 24, 24, 23);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.22, css(rgb, 0.9));
    grad.addColorStop(0.5, css(rgb, 0.22));
    grad.addColorStop(1, css(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 48, 48);
    return c;
  }
  const SPRITE_WARM = starSprite([255, 233, 201]);
  const SPRITE_COOL = starSprite([214, 226, 255]);

  /* ── sky generation ───────────────────────────────────── */

  function farEnough(r, th, minDist) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const dr = s.r - r;
      if (dr > minDist || dr < -minDist) continue;
      const dt = Math.abs(s.th0 - th);
      const arc = Math.min(dt, TAU - dt) * Math.max(r, s.r);
      if (arc * arc + dr * dr < minDist * minDist) return false;
    }
    return true;
  }

  function addStar(r, th, mag, warm, extra) {
    stars.push({
      r,
      th0: th % TAU,
      mag,
      warm,
      ph: rng() * TAU,
      twS: 1.2 + rng() * 2.4,
      plate: extra && extra.plate !== undefined ? extra.plate : -1,
    });
    return stars.length - 1;
  }

  function buildNight(idx) {
    const cfg = NIGHTS[idx];
    rng = mulberry32(90210 + idx * 7717);

    stars = [];
    micro = [];
    nebulae = [];
    plates = [];
    effects = [];
    sparks = [];
    thread.path = [];
    thread.used = new Set();
    scheduleEnd = 0;

    S.night = idx;
    S.elapsed = 0;
    S.dur = cfg.dur;
    S.rev = cfg.rev;
    S.rot = rng() * TAU;
    S.cap = cfg.ink;
    S.ink = cfg.ink;
    S.glanceCap = cfg.glances;
    S.glances = cfg.glances;
    S.glanceLeft = 0;
    S.activePlate = 0;
    S.shake = 0;

    const P = cfg.plates.length;
    for (let p = 0; p < P; p++) {
      const tpl = TEMPLATES[cfg.plates[p]];
      let placed = false;
      let ids = [];
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const phi = rng() * TAU;
        const alpha = (p * TAU) / P + (rng() - 0.5) * 0.55;
        const d = V.R * (0.42 + rng() * 0.42);
        const sc = V.R * (0.15 + rng() * 0.032);
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);
        ids = [];
        let ok = true;
        for (let j = 0; j < tpl.pts.length; j++) {
          const px = tpl.pts[j][0] * sc;
          const py = tpl.pts[j][1] * sc;
          const vx = d * Math.cos(alpha) + px * cosP - py * sinP;
          const vy = d * Math.sin(alpha) + px * sinP + py * cosP;
          const rr = Math.sqrt(vx * vx + vy * vy);
          if (rr > V.R * 0.92 || rr < V.R * 0.16) {
            ok = false;
            break;
          }
          const tt = Math.atan2(vy, vx);
          if (!farEnough(rr, tt, V.R * 0.05)) {
            ok = false;
            break;
          }
          ids.push(addStar(rr, tt, 0.72 + rng() * 0.28, true, { plate: p }));
        }
        if (ok) placed = true;
      }
      if (!placed) {
        /* relaxed fallback: same recipe without the spacing constraint */
        const phi = rng() * TAU;
        const alpha = (p * TAU) / P + (rng() - 0.5) * 0.55;
        const d = V.R * 0.55;
        const sc = V.R * 0.16;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);
        ids = [];
        for (let j = 0; j < tpl.pts.length; j++) {
          const fx = tpl.pts[j][0] * sc;
          const fy = tpl.pts[j][1] * sc;
          const vx = d * Math.cos(alpha) + fx * cosP - fy * sinP;
          const vy = d * Math.sin(alpha) + fx * sinP + fy * cosP;
          const rr = clamp(Math.sqrt(vx * vx + vy * vy), V.R * 0.18, V.R * 0.9);
          ids.push(
            addStar(rr, Math.atan2(vy, vx), 0.72 + rng() * 0.28, true, {
              plate: p,
            }),
          );
        }
      }
      const ptOf = new Map();
      ids.forEach((id, j) => ptOf.set(id, j));
      plates.push({ tpl, starIds: ids, ptOf, done: false, engravedAt: 0 });
    }

    while (stars.length < cfg.fieldStars) {
      const rr = Math.sqrt(rng()) * V.R * 0.92;
      const tt = rng() * TAU;
      if (!farEnough(rr, tt, V.R * 0.042)) continue;
      const mag = rng() < 0.6 ? 0.1 + rng() * 0.32 : 0.42 + rng() * 0.3;
      addStar(rr, tt, mag, rng() < 0.35, null);
    }

    /* faint dust: the milky river and scattered specks */
    const bandAngle = rng() * TAU;
    for (let i = 0; i < 80; i++) {
      const along = (rng() * 2 - 1) * 1.25;
      const side = (rng() + rng() + rng() - 1.5) * 0.34;
      const dx = Math.cos(bandAngle) * along - Math.sin(bandAngle) * side;
      const dy = Math.sin(bandAngle) * along + Math.cos(bandAngle) * side;
      const rr = Math.sqrt(dx * dx + dy * dy) * V.R;
      if (rr > V.R * 0.98) continue;
      micro.push({
        r: rr,
        th0: Math.atan2(dy, dx) % TAU,
        mag: 0.04 + rng() * 0.1,
        ph: rng() * TAU,
        twS: 0.6 + rng() * 1.4,
      });
    }
    for (let i = 0; i < 110; i++) {
      micro.push({
        r: Math.sqrt(rng()) * V.R * 0.97,
        th0: rng() * TAU,
        mag: 0.04 + rng() * 0.09,
        ph: rng() * TAU,
        twS: 0.6 + rng() * 1.6,
      });
    }

    for (let i = 0; i < 3; i++) {
      nebulae.push({
        r: (0.25 + rng() * 0.6) * V.R,
        th0: rng() * TAU,
        rad: V.R * (0.18 + rng() * 0.14),
        hue: rng() < 0.5 ? [96, 88, 160] : [70, 108, 150],
      });
    }

    syncHud();
    drawGhost();
  }

  /* ── geometry ─────────────────────────────────────────── */

  function starXY(st) {
    const th = st.th0 - S.rot;
    return [V.cx + st.r * Math.cos(th), V.cy + st.r * Math.sin(th)];
  }

  function findStar(x, y) {
    const hit = Math.max(16, V.R * 0.045);
    let best = -1;
    let bestD = hit * hit;
    for (let i = 0; i < stars.length; i++) {
      const p = starXY(stars[i]);
      const dx = p[0] - x;
      const dy = p[1] - y;
      const d2 = dx * dx + dy * dy;
      const bias = d2 - stars[i].mag * 30;
      if (d2 <= hit * hit && bias < bestD) {
        bestD = bias;
        best = i;
      }
    }
    return best;
  }

  const ekey = (a, b) => (a < b ? a + "-" + b : b + "-" + a);

  /* ── mechanics ────────────────────────────────────────── */

  function tapStar(id) {
    if (S.mode !== "play") return;
    const pl = plates[S.activePlate];
    if (!pl || pl.done) return;

    if (thread.path.length === 0) {
      thread.path.push(id);
      sfx.pluck(0);
      effects.push({ star: id, born: gt, color: GOLD, kind: "ring" });
      return;
    }

    const head = thread.path[thread.path.length - 1];
    if (id === head) return;

    const headPt = head !== undefined ? pl.ptOf.get(head) : undefined;
    const tapPt = pl.ptOf.get(id);

    if (headPt === undefined) {
      /* the anchor is a stray star: move it for free instead of punishing */
      thread.path = [id];
      sfx.pluck(0);
      effects.push({ star: id, born: gt, color: GOLD, kind: "ring" });
      return;
    }

    const key = tapPt !== undefined ? ekey(headPt, tapPt) : null;

    if (key && pl.tpl.edgeSet.has(key)) {
      if (thread.used.has(key)) {
        /* retracing an already-spun link: gentle refusal, no ink spilled */
        sfx.wobble();
        effects.push({ star: id, born: gt, color: GOLD, kind: "wobble" });
        return;
      }
      thread.used.add(key);
      thread.path.push(id);
      sfx.pluck(thread.used.size);
      if (thread.used.size === pl.tpl.pairs.length) completePlate();
      else {
        drawGhost();
        syncHud();
      }
      return;
    }

    spillInk(id);
  }

  function spillInk(id) {
    effects.push({ star: id, born: gt, color: DANGER, kind: "ring" });
    if (S.ink > 0) {
      S.ink -= 1;
      S.shake = 1;
      sfx.wrong();
      syncHud();
    } else {
      sfx.wobble();
    }
  }

  function undoLink() {
    if (thread.path.length < 2) return;
    const pl = plates[S.activePlate];
    const id = thread.path.pop();
    const prev = thread.path[thread.path.length - 1];
    if (pl) thread.used.delete(ekey(pl.ptOf.get(prev), pl.ptOf.get(id)));
    drawGhost();
    syncHud();
  }

  function clearThread() {
    if (thread.path.length === 0) return;
    thread.path = [];
    thread.used.clear();
    drawGhost();
    syncHud();
  }

  function plateCentroid(pl) {
    let x = 0;
    let y = 0;
    pl.starIds.forEach((id) => {
      const p = starXY(stars[id]);
      x += p[0];
      y += p[1];
    });
    return [x / pl.starIds.length, y / pl.starIds.length];
  }

  function completePlate() {
    const pl = plates[S.activePlate];
    pl.done = true;
    pl.engravedAt = gt;
    thread.path = [];
    thread.used.clear();
    S.score += 150;
    sfx.seal();
    const c = plateCentroid(pl);
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU;
      const sp = 40 + rng() * 120;
      sparks.push({
        x: c[0],
        y: c[1],
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.6 + rng() * 0.4,
        t: 0,
        col: rng() < 0.7 ? GOLD_BRIGHT : VIOLET,
      });
    }
    const nxt = plates.findIndex((q) => !q.done);
    if (nxt >= 0) S.activePlate = nxt;
    drawGhost();
    syncHud();
    if (nxt < 0) scheduleEnd = gt + 1.1;
  }

  function glanceStart() {
    if (S.mode !== "play" || S.glanceLeft > 0 || S.glances <= 0) return;
    S.glances -= 1;
    S.glanceLeft = 1.7;
    el.eye.classList.add("pressed");
    sfx.glance();
    syncHud();
  }

  /* ── flow ─────────────────────────────────────────────── */

  function showOverlay(name) {
    Object.keys(el.overlays).forEach((k) => {
      el.overlays[k].classList.toggle("show", k === name);
    });
    if (name) {
      const btn = {
        intro: el.start,
        inter: el.next,
        fail: el.again,
        win: el.newrun,
        pauseOv: el.resume,
      }[name];
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function scoreRows(rows) {
    return rows
      .map(
        (r) =>
          '<div class="score-line"><span>' +
          r[0] +
          "</span><span>" +
          r[1] +
          "</span></div>",
      )
      .join("");
  }

  function saveBest() {
    if (S.score > S.best) S.best = S.score;
    try {
      localStorage.setItem("firstlight.best", String(S.best));
    } catch (err) {
      /* private browsing; the record lives only in memory tonight */
    }
  }

  function startRun() {
    S.score = 0;
    buildNight(0);
    S.mode = "play";
    showOverlay(null);
    el.pause.textContent = "Pause";
    sfx.nightfall();
  }

  function endNight(success) {
    if (S.mode !== "play") return;
    const sealed = plates.filter((p) => p.done).length;
    const cfg = NIGHTS[S.night];

    if (!success) {
      S.mode = "fail";
      saveBest();
      el.failLines.innerHTML =
        "<p>The ink dried before the figures did &mdash; " +
        sealed +
        " of " +
        plates.length +
        " plates sealed.</p>" +
        scoreRows([
          ["figures charted", sealed + " &times; 150"],
          ["almanac score", String(S.score)],
          ["house record", String(S.best)],
        ]);
      showOverlay("fail");
      sfx.dawnFail();
      return;
    }

    S.mode = "inter";
    const secsLeft = Math.max(0, Math.round(cfg.dur - S.elapsed));
    const darkBonus = secsLeft * 2;
    const inkBonus = S.ink * 6;
    const glanceBonus = S.glances * 20;
    S.score += darkBonus + inkBonus + glanceBonus;
    saveBest();

    el.interKicker.textContent = "dawn breaks over the moors";
    el.interTitle.textContent = "Night " + ROMAN[S.night] + " sealed";
    el.interLines.innerHTML =
      scoreRows([
        ["plates sealed", sealed + " of " + plates.length],
        ["figure points", "+" + sealed * 150],
        ["ink preserved", "+" + inkBonus],
        ["glimpses saved", "+" + glanceBonus],
        ["darkness spared", "+" + darkBonus + " (" + secsLeft + "s)"],
      ]) +
      '<div class="score-line total"><span>almanac score</span><span>' +
      S.score +
      "</span></div>";
    el.next.textContent =
      S.night >= NIGHTS.length - 1 ? "Print the almanac" : "Next night";
    showOverlay("inter");
    sfx.fanfare();
  }

  function nextNight() {
    if (S.night >= NIGHTS.length - 1) {
      winRun();
    } else {
      buildNight(S.night + 1);
      S.mode = "play";
      showOverlay(null);
      sfx.nightfall();
    }
  }

  function winRun() {
    S.mode = "win";
    saveBest();
    const record = S.score >= S.best && S.score > 0;
    el.winLines.innerHTML =
      "<p>Three nights, nine figures, one small book of sky.</p>" +
      scoreRows([
        ["almanac score", String(S.score)],
        ["house record", String(S.best)],
      ]) +
      (record ? "<p><b>A new house record.</b></p>" : "");
    showOverlay("win");
    sfx.fanfare();
  }

  function togglePause(force) {
    if (S.mode === "play" && force !== false) {
      S.mode = "paused";
      el.pause.textContent = "Resume";
      showOverlay("pauseOv");
    } else if (S.mode === "paused") {
      S.mode = "play";
      el.pause.textContent = "Pause";
      showOverlay(null);
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    el.mute.setAttribute("aria-pressed", String(muted));
  }

  /* ── hud ──────────────────────────────────────────────── */

  function syncHud() {
    el.nightLabel.textContent = "Night " + ROMAN[S.night];
    const pl = plates[S.activePlate];
    if (pl && !pl.done) el.targetName.textContent = pl.tpl.name;
    else el.targetName.textContent = "All sealed ✶";

    el.inkRow.textContent =
      "●".repeat(Math.max(0, S.ink)) + "○".repeat(Math.max(0, S.cap - S.ink));
    el.glanceRow.textContent =
      "◆".repeat(Math.max(0, S.glances)) +
      "◇".repeat(Math.max(0, S.glanceCap - S.glances));

    if (pl) {
      const total = pl.tpl.pairs.length;
      let html = "";
      for (let i = 0; i < total; i++) {
        html +=
          '<span class="' +
          (i < thread.used.size ? "on" : "off") +
          '">●</span>';
      }
      el.progress.innerHTML = html;
    }
    if (pl) {
      const total = pl.tpl.pairs.length;
      let html = "";
      for (let i = 0; i < total; i++) {
        html +=
          '<span class="' +
          (i < thread.used.size ? "on" : "off") +
          '">●</span>';
      }
      el.progress.innerHTML = html;
    }
  }

  function prerenderGhostCanvasSize() {
    const rect = ghost.getBoundingClientRect();
    const w = Math.round(rect.width * V.dpr);
    const h = Math.round(rect.height * V.dpr);
    if (w > 0 && h > 0) {
      ghost.width = w;
      ghost.height = h;
    }
  }

  function drawGhost() {
    const w = ghost.width / V.dpr;
    const h = ghost.height / V.dpr;

    gctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    gctx.clearRect(0, 0, w, h);
    const pl = plates[S.activePlate];
    if (!pl) return;

    /* fit the template's bounding box into the little card */
    let minX = 9;
    let maxX = -9;
    let minY = 9;
    let maxY = -9;
    pl.tpl.pts.forEach((p) => {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    });
    const pad = 8;
    const sc = Math.min(
      (w - pad * 2) / (maxX - minX || 1),
      (h - pad * 2) / (maxY - minY || 1),
    );
    const ox = (w - (maxX + minX) * sc) / 2;
    const oy = (h - (maxY + minY) * sc) / 2;
    const ptPx = (i) => [
      ox + pl.tpl.pts[i][0] * sc,
      oy + pl.tpl.pts[i][1] * sc,
    ];

    pl.tpl.pairs.forEach((pair) => {
      const a = ptPx(pair[0]);
      const b = ptPx(pair[1]);
      gctx.beginPath();
      gctx.moveTo(a[0], a[1]);
      gctx.lineTo(b[0], b[1]);
      const spun = thread.used.has(ekey(pair[0], pair[1]));
      gctx.strokeStyle = spun
        ? "rgba(255,230,174,0.95)"
        : "rgba(255,217,138,0.38)";
      gctx.lineWidth = spun ? 2 : 1.2;
      gctx.setLineDash(spun ? [] : [4, 4]);
      gctx.stroke();
    });
    gctx.setLineDash([]);
    pl.tpl.pts.forEach((_, i) => {
      const p = ptPx(i);
      gctx.beginPath();
      gctx.arc(p[0], p[1], 2, 0, TAU);
      gctx.fillStyle = "rgba(255,236,200,0.9)";
      gctx.fill();
    });
  }

  /* ── backdrop prerender ───────────────────────────────── */

  function prerenderHorizon() {
    horizonLayer = document.createElement("canvas");
    horizonLayer.width = Math.round(V.w * V.dpr);
    horizonLayer.height = Math.round((V.h - V.hz + 60) * V.dpr);
    const lc = horizonLayer.getContext("2d");
    lc.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    const W = V.w;
    const H = V.h - V.hz + 60;
    const baseY = 40;
    const sc = V.ui;

    const ridge = (x) =>
      baseY -
      (16 + 22 * Math.sin(x * 0.004 + 1.7) + 11 * Math.sin(x * 0.011 + 0.4)) *
        sc;
    const hill = (x) =>
      baseY +
      14 * sc -
      (8 + 9 * Math.sin(x * 0.006 + 3.1) + 5 * Math.sin(x * 0.017 + 1.2)) * sc;

    /* far ridge */
    lc.fillStyle = "#0a1024";
    lc.beginPath();
    lc.moveTo(-4, H + 4);
    for (let x = -4; x <= W + 4; x += 8) lc.lineTo(x, ridge(x));
    lc.lineTo(W + 4, H + 4);
    lc.closePath();
    lc.fill();

    /* near moor */
    lc.fillStyle = "#05070d";
    lc.beginPath();
    lc.moveTo(-4, H + 4);
    for (let x = -4; x <= W + 4; x += 8) lc.lineTo(x, hill(x));
    lc.lineTo(W + 4, H + 4);
    lc.closePath();
    lc.fill();

    /* the observatory */
    const ox = clamp(V.cx + V.R * 0.5, W * 0.12, W * 0.86);
    const oy = hill(ox) + 2;
    lc.fillStyle = "#04060c";
    lc.beginPath();
    lc.moveTo(ox - 26 * sc, oy);
    lc.lineTo(ox - 20 * sc, oy - 20 * sc);
    lc.lineTo(ox + 20 * sc, oy - 20 * sc);
    lc.lineTo(ox + 26 * sc, oy);
    lc.closePath();
    lc.fill();
    lc.beginPath();
    lc.arc(ox, oy - 20 * sc, 15 * sc, Math.PI, 0);
    lc.closePath();
    lc.fill();
    lc.save();
    lc.translate(ox, oy - 20 * sc);
    lc.rotate(-0.5);
    lc.fillRect(-2.4 * sc, -17 * sc, 4.8 * sc, 18 * sc);
    lc.restore();
    lc.fillRect(ox + 12 * sc, oy - 30 * sc, 3 * sc, 8 * sc);

    /* a stand of pines to the west */
    for (let i = 0; i < 6; i++) {
      const tx = W * (0.06 + i * 0.055) + ((i * 37) % 13);
      const ty = hill(tx) + 2;
      const thh = (16 + ((i * 29) % 12)) * sc;
      lc.beginPath();
      lc.moveTo(tx - 6 * sc, ty);
      lc.lineTo(tx, ty - thh);
      lc.lineTo(tx + 6 * sc, ty);
      lc.closePath();
      lc.fill();
      lc.beginPath();
      lc.moveTo(tx - 4.5 * sc, ty - thh * 0.45);
      lc.lineTo(tx, ty - thh);
      lc.lineTo(tx + 4.5 * sc, ty - thh * 0.45);
      lc.closePath();
      lc.fill();
    }
  }

  /* ── render ───────────────────────────────────────────── */

  let shakeSeed = 1;
  function rngShake() {
    shakeSeed = (shakeSeed * 16807) % 2147483647;
    return shakeSeed / 2147483647;
  }

  function draw() {
    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    const dawnT = clamp(S.elapsed / S.dur, 0, 1);

    let shx = 0;
    let shy = 0;
    if (S.shake > 0.01) {
      shx = (rngShake() - 0.5) * 7 * S.shake;
      shy = (rngShake() - 0.5) * 7 * S.shake;
    }
    ctx.clearRect(0, 0, V.w, V.h);
    ctx.save();
    ctx.translate(shx, shy);

    /* sky */
    const top = mix([6, 10, 30], [30, 34, 66], dawnT * 0.75);
    const bot = mix([13, 19, 44], [86, 52, 60], dawnT);
    const sky = ctx.createLinearGradient(0, 0, 0, V.hz + 30);
    sky.addColorStop(0, css(top, 1));
    sky.addColorStop(1, css(bot, 1));
    ctx.fillStyle = sky;
    ctx.fillRect(-8, -8, V.w + 16, V.h + 16);

    /* stars, clipped to the dome */
    ctx.save();
    ctx.beginPath();
    ctx.arc(V.cx, V.cy, V.R + 26 * V.ui, 0, TAU);
    ctx.clip();

    nebulae.forEach((nb) => {
      const th = nb.th0 - S.rot * 0.9;
      const x = V.cx + nb.r * Math.cos(th);
      const y = V.cy + nb.r * Math.sin(th);
      const g = ctx.createRadialGradient(x, y, 1, x, y, nb.rad);
      g.addColorStop(0, css(nb.hue, 0.1));
      g.addColorStop(1, css(nb.hue, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - nb.rad, y - nb.rad, nb.rad * 2, nb.rad * 2);
    });

    const glanceOn = S.glanceLeft > 0;
    const pulse = glanceOn ? 1.55 + 0.35 * Math.sin(gt * 7) : 1;
    const actPl = plates[S.activePlate];
    const actSet =
      glanceOn && actPl && !actPl.done ? new Set(actPl.starIds) : null;

    micro.forEach((st) => {
      const p = starXY(st);
      if (p[1] > V.hz + 6) return;
      const tw = 0.8 + 0.2 * Math.sin(gt * st.twS + st.ph);
      const sz = (1 + st.mag * 2.4) * V.ui * 2.1;
      ctx.globalAlpha = (0.16 + st.mag * 0.5) * tw;
      ctx.drawImage(
        st.mag > 0.5 ? SPRITE_WARM : SPRITE_COOL,
        p[0] - sz / 2,
        p[1] - sz / 2,
        sz,
        sz,
      );
    });

    stars.forEach((st, i) => {
      const p = starXY(st);
      if (p[1] > V.hz + 6) return;
      const isTarget = actPl && !actPl.done && st.plate === S.activePlate;
      const tw = 0.84 + 0.16 * Math.sin(gt * st.twS + st.ph);
      let alpha = (0.3 + st.mag * 0.68) * tw;
      let sz = (1.3 + st.mag * 3.1) * V.ui * 2.2;
      if (actSet) {
        if (actSet.has(i)) {
          sz *= pulse;
          alpha = Math.min(1, alpha * 1.5);
          ctx.strokeStyle = css(VIOLET, 0.55);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p[0], p[1], sz * 0.42 + 5 * V.ui * pulse, 0, TAU);
          ctx.stroke();
        } else {
          alpha *= 0.45;
        }
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        st.warm || isTarget ? SPRITE_WARM : SPRITE_COOL,
        p[0] - sz / 2,
        p[1] - sz / 2,
        sz,
        sz,
      );
    });

    ctx.globalAlpha = 1;

    /* engraved figures */
    const labels = [];
    plates.forEach((pl) => {
      if (!pl.done) return;
      const age = gt - pl.engravedAt;
      const a = lerp(0.95, 0.6, clamp(age / 2, 0, 1));
      ctx.strokeStyle = css(GOLD_BRIGHT, a);
      ctx.lineWidth = 2 * V.ui;
      ctx.shadowColor = css(GOLD, 0.7);
      ctx.shadowBlur = 9;
      ctx.beginPath();
      pl.tpl.pairs.forEach((pair, i) => {
        const pa = starXY(stars[pl.starIds[pair[0]]]);
        const pb = starXY(stars[pl.starIds[pair[1]]]);
        if (i === 0) ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      const c = plateCentroid(pl);
      labels.push({
        text: pl.tpl.name + "  ✶",
        x: c[0],
        y: c[1] - (V.R * 0.16 + 14),
        a,
      });
    });

    /* the working thread */
    if (thread.path.length > 0 && actPl && !actPl.done) {
      ctx.strokeStyle = css(GOLD, 0.9);
      ctx.lineWidth = 2.2 * V.ui;
      ctx.shadowColor = css(GOLD, 0.8);
      ctx.shadowBlur = 8;
      ctx.beginPath();
      thread.path.forEach((id, i) => {
        const p = starXY(stars[id]);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;

      const hp = starXY(stars[thread.path[thread.path.length - 1]]);
      const rr = (9 + 2.2 * Math.sin(gt * 6)) * V.ui;
      ctx.strokeStyle = css(GOLD_BRIGHT, 0.95);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], rr, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = css(GOLD, 0.35);
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], rr + 5 * V.ui, 0, TAU);
      ctx.stroke();
    }

    /* transient verdict rings */
    effects.forEach((ef) => {
      const age = gt - ef.born;
      if (age > 0.55) return;
      const p = starXY(stars[ef.star]);
      const k = age / 0.55;
      ctx.strokeStyle = css(ef.color, 1 - k);
      ctx.lineWidth = ef.kind === "ring" ? 2.4 : 1.6;
      const wob = ef.kind === "wobble" ? Math.sin(age * 40) * 3 : 0;
      ctx.beginPath();
      ctx.arc(p[0] + wob, p[1], 6 + k * 34, 0, TAU);
      ctx.stroke();
    });
    effects = effects.filter((ef) => gt - ef.born <= 0.55);

    ctx.restore(); /* dome clip */

    /* first-light glow and the sun's first sliver */
    if (dawnT > 0.02) {
      const glow = ctx.createLinearGradient(0, V.hz - V.h * 0.3, 0, V.hz + 20);
      glow.addColorStop(0, "rgba(255,145,84,0)");
      glow.addColorStop(
        1,
        "rgba(255,145,84," + 0.4 * Math.pow(dawnT, 1.6) + ")",
      );
      ctx.fillStyle = glow;
      ctx.fillRect(0, V.hz - V.h * 0.3, V.w, V.h * 0.3 + 20);
      if (dawnT > 0.8) {
        const rise = (dawnT - 0.8) / 0.2;
        const sx = V.cx + V.w * 0.16;
        const sy = V.hz + 6 - rise * 12;
        const sg = ctx.createRadialGradient(sx, sy, 1, sx, sy, 60 * V.ui);
        sg.addColorStop(0, "rgba(255,190,120," + 0.9 * rise + ")");
        sg.addColorStop(0.25, "rgba(255,150,80," + 0.5 * rise + ")");
        sg.addColorStop(1, "rgba(255,150,80,0)");
        ctx.fillStyle = sg;
        ctx.fillRect(sx - 70 * V.ui, sy - 70 * V.ui, 140 * V.ui, 140 * V.ui);
        ctx.fillStyle = "rgba(255,205,140," + 0.85 * rise + ")";
        ctx.beginPath();
        ctx.arc(sx, sy, 9 * V.ui, Math.PI, 0);
        ctx.fill();
      }
    }

    /* horizon silhouettes */
    if (horizonLayer)
      ctx.drawImage(horizonLayer, 0, V.hz - 40, V.w, V.h - V.hz + 60);

    /* engraved labels float above everything */
    ctx.textAlign = "center";
    labels.forEach((lb) => {
      if (lb.y > V.hz - 8) lb.y = V.hz - 8;
      ctx.font = "600 " + Math.max(11, 12 * V.ui) + "px system-ui, sans-serif";
      ctx.fillStyle = css(GOLD_BRIGHT, lb.a);
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.fillText(lb.text, lb.x, lb.y);
      ctx.shadowBlur = 0;
    });

    /* completion sparks */
    sparks.forEach((sp) => {
      ctx.globalAlpha = clamp(1 - sp.t / sp.life, 0, 1);
      ctx.fillStyle = css(sp.col, 1);
      ctx.fillRect(sp.x - 1.2, sp.y - 1.2, 2.6, 2.6);
    });
    ctx.globalAlpha = 1;

    /* vignette */
    if (vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(-8, -8, V.w + 16, V.h + 16);
    }

    ctx.restore(); /* shake translate */
  }

  /* ── update ───────────────────────────────────────────── */

  function update(dt) {
    gt += dt;
    if (S.mode === "play") {
      S.elapsed += dt;
      S.rot += (dt * TAU) / S.rev;
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 3.2);
      if (S.glanceLeft > 0) {
        S.glanceLeft -= dt;
        if (S.glanceLeft <= 0) {
          S.glanceLeft = 0;
          el.eye.classList.remove("pressed");
        }
      }
      sparks.forEach((sp) => {
        sp.t += dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 60 * dt;
      });
      sparks = sparks.filter((sp) => sp.t < sp.life);

      el.dawnFill.style.width =
        (clamp(S.elapsed / S.dur, 0, 1) * 100).toFixed(1) + "%";

      if (scheduleEnd && gt >= scheduleEnd) {
        scheduleEnd = 0;
        endNight(true);
      } else if (!scheduleEnd && S.elapsed >= S.dur) {
        endNight(false);
      }
    } else if (S.mode === "intro") {
      S.rot += (dt * TAU) / (S.rev * 4);
    }
  }

  let lastFrame = 0;
  function frame(ts) {
    const dt = clamp((ts - lastFrame) / 1000, 0, 0.05);
    lastFrame = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  /* ── input ────────────────────────────────────────────── */

  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener("pointerdown", (e) => {
    audio();
    if (S.mode !== "play") return;
    e.preventDefault();
    const p = localXY(e);
    const id = findStar(p[0], p[1]);
    S.lastInput = { x: p[0], y: p[1], id, t: Date.now() };

  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function press(btn, fn) {
    btn.addEventListener("click", (e) => {
      audio();
      fn(e);
      btn.blur();
    });
  }

  press(el.start, () => startRun());
  press(el.next, () => nextNight());
  press(el.again, () => startRun());
  press(el.newrun, () => startRun());
  press(el.resume, () => togglePause());
  press(el.pause, () => togglePause());
  press(el.mute, () => toggleMute());
  press(el.restart, () => startRun());
  press(el.undo, () => undoLink());
  press(el.clear, () => clearThread());

  el.eye.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audio();
    glanceStart();
  });
  el.eye.addEventListener("click", () => el.eye.blur());

  window.addEventListener("keydown", (e) => {
    audio();
    const k = e.key.toLowerCase();
    if (k === " ") {
      e.preventDefault();
      if (S.mode === "play") glanceStart();
      return;
    }
    if (k === "z") undoLink();
    else if (k === "x") clearThread();
    else if (k === "p") togglePause();
    else if (k === "m") toggleMute();
    else if (k === "r") startRun();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && S.mode === "play") togglePause(true);
  });

  let resizePending = false;
  window.addEventListener("resize", () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      resize();
    });
  });

  /* ── optional test hook (only with #debug) ────────────── */

  if (/debug/.test(location.hash)) {
    window.__FL_DEBUG = {
      mode: () => S.mode,
      night: () => S.night,
      plateIdx: () => S.activePlate,
      ink: () => S.ink,
      glances: () => S.glances,
      score: () => S.score,
      sealedCount: () => plates.filter((p) => p.done).length,
      tap: (id) => tapStar(id),
      head: () =>
        thread.path.length ? thread.path[thread.path.length - 1] : -1,
      usedCount: () => thread.used.size,
      starAt: (x, y) => findStar(x, y),
      allPos: () => stars.map((s) => starXY(s)),
      lastInput: () => S.lastInput || null,
      view: () => ({ cx: V.cx, cy: V.cy, R: V.R, w: V.w, h: V.h }),


      seqIds: () => {
        const pl = plates[S.activePlate];
        return pl && !pl.done ? pl.tpl.seq.map((i) => pl.starIds[i]) : [];
      },

      decoyId: () => {
        const pl = plates[S.activePlate];
        const mine = new Set(pl ? pl.starIds : []);
        for (let i = 0; i < stars.length; i++) if (!mine.has(i)) return i;
        return -1;
      },
      pos: (id) => {
        const st = stars[id];
        if (!st) return null;
        const r = canvas.getBoundingClientRect();
        const p = starXY(st);
        return { x: r.left + p[0], y: r.top + p[1] };
      },
      finishNight: (ok) => {
        if (ok) {
          plates.forEach((p) => {
            p.done = true;
            p.engravedAt = gt;
          });
        }
        endNight(ok);
      },
    };
  }

  /* ── boot ─────────────────────────────────────────────── */

  resize();
  buildNight(0);
  S.mode = "intro";
  syncHud();
  showOverlay("intro");
  requestAnimationFrame((ts) => {
    lastFrame = ts;
    requestAnimationFrame(frame);
  });
})();
