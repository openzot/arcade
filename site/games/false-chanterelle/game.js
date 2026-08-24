/* False Chanterelle - fill the basket before dusk, and know what you pick. */
(() => {
  "use strict";

  /* ---------- tiny helpers ---------- */

  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hexRGB(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixColor(h1, h2, t) {
    const a = hexRGB(h1);
    const b = hexRGB(h2);
    return (
      "rgb(" +
      Math.round(lerp(a[0], b[0], t)) +
      "," +
      Math.round(lerp(a[1], b[1], t)) +
      "," +
      Math.round(lerp(a[2], b[2], t)) +
      ")"
    );
  }

  /* ---------- sound (Web Audio, synthesised) ---------- */

  let AC = null;
  let noiseBuf = null;
  let muted = false;

  function ac() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
    return AC;
  }

  function tone(f, dur, type, vol, delay, slide) {
    const c = ac();
    if (!c || muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime + (delay || 0);
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t0);
    if (slide) {
      o.frequency.exponentialRampToValueAtTime(
        Math.max(30, f + slide),
        t0 + dur,
      );
    }
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, delay, freq) {
    const c = ac();
    if (!c || muted) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq || 900;
    f.Q.value = 0.7;
    const g = c.createGain();
    const t0 = c.currentTime + (delay || 0);
    g.gain.setValueAtTime(vol || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(c.destination);
    s.start(t0);
    s.stop(t0 + dur + 0.03);
  }

  const sfx = {
    select() {
      tone(540, 0.06, "triangle", 0.07);
    },
    cut() {
      noise(0.14, 0.14, 0, 1600);
      tone(210, 0.09, "square", 0.05);
    },
    smell() {
      noise(0.3, 0.06, 0, 350);
    },
    keep() {
      tone(392, 0.09, "triangle", 0.11);
      tone(587, 0.13, "triangle", 0.1, 0.08);
    },
    poison() {
      tone(196, 0.4, "sawtooth", 0.13, 0, -70);
      tone(98, 0.55, "sine", 0.11, 0.05);
      noise(0.3, 0.05, 0.02, 250);
    },
    duskSafe() {
      [523, 659, 784].forEach((f, i) =>
        tone(f, 0.16, "triangle", 0.11, i * 0.1),
      );
    },
    over() {
      [220, 185, 147].forEach((f, i) =>
        tone(f, 0.4, "sawtooth", 0.09, i * 0.22),
      );
    },
    win() {
      [523, 659, 784, 1046].forEach((f, i) =>
        tone(f, 0.22, "triangle", 0.11, i * 0.13),
      );
    },
  };

  /* ---------- species ---------- */

  const SPECIES = [
    {
      key: "chanterelle",
      name: "Chanterelle",
      kind: "edible",
      pts: 10,
      shape: "vase",
      cap: "#dd9c34",
      capHi: "#f3cd76",
      stem: "#e6bc5d",
      under: "ridges",
      flesh: "pale gold, waxy",
      smell: "apricots - warm and fruity",
      ring: false,
      volva: false,
      flecks: 0,
      tell: "Blunt forking RIDGES fold down the stem - never thin blades. Smells of apricots.",
    },
    {
      key: "cep",
      name: "Cep (Penny Bun)",
      kind: "edible",
      pts: 20,
      shape: "bolete",
      cap: "#7a5d39",
      capHi: "#9d7d50",
      stem: "#e6d6ae",
      under: "pores",
      flesh: "firm white, unchanging",
      smell: "of toasted nuts and rain",
      ring: false,
      volva: false,
      flecks: 0,
      tell: "Fat pale stem, brown bun of a cap. Underneath: a sponge of PORES.",
    },
    {
      key: "puffball",
      name: "Common Puffball",
      kind: "edible",
      pts: 15,
      shape: "ball",
      cap: "#ebe4d2",
      capHi: "#fbf7ec",
      stem: "#ddd4bd",
      under: "none",
      flesh: "marshmallow white, all the way through",
      smell: "of fresh bread",
      ring: false,
      volva: false,
      flecks: 4,
      tell: "A plain white ball, no gills anywhere. Cut it open: pure white inside.",
    },
    {
      key: "hedgehog",
      name: "Hedgehog Fungus",
      kind: "edible",
      pts: 30,
      shape: "flat",
      cap: "#c3a878",
      capHi: "#dcc69b",
      stem: "#ccb991",
      under: "spines",
      flesh: "cream, tasting of pears when cooked",
      smell: "faintly sweet",
      ring: false,
      volva: false,
      flecks: 0,
      tell: "Soft SPINES hang like teeth where gills would be. Never bitter.",
    },
    {
      key: "flyagaric",
      name: "Fly Agaric",
      kind: "deadly",
      pts: 0,
      shape: "dome",
      cap: "#b93220",
      capHi: "#d55038",
      stem: "#efe7d4",
      under: "gills",
      flesh: "white; a fever and a bad night",
      smell: "of damp earth and old leaves",
      ring: true,
      volva: true,
      flecks: 9,
      tell: "Scarlet, flecked with white warts, skirted ring. Sickens - rarely kills.",
    },
    {
      key: "deathcap",
      name: "Death Cap",
      kind: "deadly",
      pts: 0,
      shape: "dome",
      cap: "#c6cca9",
      capHi: "#dee3c6",
      stem: "#f1edda",
      under: "gills",
      flesh: "white; three quiet days, then worse",
      smell: "almost nothing - faintly sickly-sweet",
      ring: true,
      volva: true,
      flecks: 0,
      tell: "Pale greenish cap, WHITE gills, a skirt ring AND a cup at the base.",
    },
    {
      key: "falsechan",
      name: "False Chanterelle",
      kind: "deadly",
      pts: 0,
      shape: "flat",
      cap: "#d97a24",
      capHi: "#eda04b",
      stem: "#e29540",
      under: "gills",
      flesh: "thin orange all through",
      smell: "of damp meal - flour paste",
      ring: false,
      volva: false,
      flecks: 0,
      cluster: true,
      tell: "The twin in gold! TRUE thin gills, thin orange flesh, smells of damp meal.",
    },
    {
      key: "jack",
      name: "Jack-o'-Lantern",
      kind: "deadly",
      pts: 0,
      shape: "flat",
      cap: "#e2871f",
      capHi: "#f7ac50",
      stem: "#df9838",
      under: "gills",
      flesh: "orange; cramps that mean it",
      smell: "nothing at all... though the blades gleam green",
      ring: false,
      volva: false,
      flecks: 0,
      cluster: true,
      glow: true,
      tell: "Orange in tight clusters; sharp gills that gleam faintly green at dusk.",
    },
  ];

  const byKey = {};
  SPECIES.forEach((s) => {
    byKey[s.key] = s;
  });

  const UNDER_TEXT = {
    ridges: "blunt forked ridges fold down the stem",
    gills: "true gills - thin paper blades",
    pores: "a sponge of pores, no gills at all",
    spines: "soft spines hang like little teeth",
    none: "no gills, no pores - solid white all through",
  };

  /* five dusks: basket quota, seconds of light, spawn weights per species */
  const DAYS = [
    { quota: 5, light: 80, mix: [42, 22, 18, 6, 4, 8, 0, 0] },
    { quota: 6, light: 73, mix: [32, 20, 14, 10, 6, 12, 6, 0] },
    { quota: 7, light: 67, mix: [26, 17, 11, 12, 8, 13, 9, 4] },
    { quota: 8, light: 62, mix: [21, 15, 8, 13, 10, 14, 12, 7] },
    { quota: 9, light: 58, mix: [17, 13, 6, 13, 12, 15, 14, 10] },
  ];

  const COST = { cut: 2.6, smell: 1.3, keep: 1.0, leave: 0.6 };
  const FLAVOR = [
    "long gold light",
    "the shadows lean east",
    "cold creeping through the moss",
    "amber gone grey",
    "the last of the light",
  ];

  /* ---------- state ---------- */

  const W = 960;
  const H = 600;
  const GROUND_Y = 168;

  const fast = /fast/.test(location.hash);

  let state = "title"; // title | play | paused | over | win
  let day = 1;
  let quota = DAYS[0].quota;
  let dayPool = DAYS[0].light;
  let hearts = 3;
  let score = 0;
  let basket = 0;
  let light = DAYS[0].light;

  const FASTM = fast ? 20 : 1;

  let shrooms = [];
  let selIdx = -1;
  let inspecting = null;
  let insTilt = 0;
  let bannerT = 0;
  let bannerMsg = "";
  let flashT = 0;
  let shakeT = 0;
  let floaters = [];
  let tGlob = 0;

  let best = 0;
  try {
    best =
      parseInt(localStorage.getItem("false-chanterelle-best") || "0", 10) || 0;
  } catch (e) {
    best = 0;
  }

  /* ---------- canvas setup ---------- */

  const cvs = $("game");
  const ctx = cvs.getContext("2d");
  const big = $("big");
  const bctx = big.getContext("2d");

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = W * DPR;
  cvs.height = H * DPR;
  big.width = big.width * DPR; // logical size stays as authored
  big.height = big.height * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  /* ---------- scenery ---------- */

  const TRUNKS = [];
  for (let i = 0; i < 7; i++) {
    TRUNKS.push({
      x: rand(30, W - 30),
      w: rand(14, 30),
      lean: rand(-0.05, 0.05),
      dashes: Array.from({ length: 7 }, () => ({
        y: rand(-10, 150),
        dx: rand(-0.4, 0.4),
        dw: rand(4, 11),
      })),
    });
  }

  const groundCan = document.createElement("canvas");
  groundCan.width = W;
  groundCan.height = H;

  function regenGround() {
    const g = groundCan.getContext("2d");
    const grad = g.createLinearGradient(0, GROUND_Y - 10, 0, H);
    grad.addColorStop(0, "#57431f");
    grad.addColorStop(0.25, "#46341a");
    grad.addColorStop(1, "#20160b");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // mossy patches
    for (let i = 0; i < 16; i++) {
      g.fillStyle = "rgba(84,102,52," + rand(0.08, 0.2).toFixed(3) + ")";
      g.beginPath();
      g.ellipse(
        rand(0, W),
        rand(GROUND_Y + 60, H),
        rand(30, 90),
        rand(12, 30),
        rand(0, TAU),
        0,
        TAU,
      );
      g.fill();
    }
    // leaf litter
    const leafCols = [
      "#6d4f28",
      "#7d5c31",
      "#584126",
      "#8a6a38",
      "#4a371f",
      "#93743f",
    ];
    for (let i = 0; i < 300; i++) {
      const x = rand(0, W);
      const y = rand(GROUND_Y + 6, H);
      const depth = (y - GROUND_Y) / (H - GROUND_Y);
      g.fillStyle = pick(leafCols);
      g.globalAlpha = rand(0.25, 0.75);
      g.save();
      g.translate(x, y);
      g.rotate(rand(0, TAU));
      const s = lerp(3, 7, depth) * rand(0.7, 1.3);
      g.beginPath();
      g.ellipse(0, 0, s, s * rand(0.35, 0.6), 0, 0, TAU);
      g.fill();
      if (Math.random() < 0.3) {
        g.strokeStyle = "#3c2d17";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-s, 0);
        g.lineTo(s * 0.8, 0);
        g.stroke();
      }
      g.restore();
    }
    // stones
    for (let i = 0; i < 14; i++) {
      g.globalAlpha = rand(0.2, 0.45);
      g.fillStyle = "#6f6a5c";
      g.beginPath();
      g.ellipse(
        rand(0, W),
        rand(GROUND_Y + 30, H),
        rand(4, 10),
        rand(2, 5),
        rand(0, TAU),
        0,
        TAU,
      );
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /* ---------- specimens ---------- */

  function weightedSpecies() {
    const mix = DAYS[day - 1].mix;
    let total = 0;
    for (let i = 0; i < mix.length; i++) total += mix[i];
    let r = Math.random() * total;
    for (let i = 0; i < mix.length; i++) {
      r -= mix[i];
      if (r <= 0) return SPECIES[i].key;
    }
    return SPECIES[0].key;
  }

  function makeShroom(key) {
    const sp = byKey[key];
    const R = sp.shape === "bolete" ? rand(36, 48) : rand(31, 45);
    let n = 1;
    if (sp.cluster) n = key === "jack" ? 3 : Math.random() < 0.55 ? 2 : 1;
    const jit = Array.from({ length: 9 }, () => rand(0.9, 1.1));
    const flecks = [];
    for (let i = 0; i < (sp.flecks || 0); i++) {
      flecks.push({
        u: rand(-0.85, 0.85),
        v: rand(-0.15, 0.95),
        r: rand(2, 4.2),
      });
    }
    let x = 0;
    let y = 0;
    let ok = false;
    for (let tries = 0; tries < 80 && !ok; tries++) {
      x = rand(64, W - 64);
      y = rand(330, 560);
      ok = true;
      for (const s of shrooms) {
        if (Math.hypot(s.x - x, s.y - y) < R + s.R + 34) {
          ok = false;
          break;
        }
      }
    }
    return {
      sp,
      x,
      y,
      R,
      n,
      jit,
      flecks,
      rot: rand(-0.07, 0.07),
      phase: rand(0, TAU),
      born: tGlob,
      cut: false,
      smelled: false,
    };
  }

  function fillField() {
    while (shrooms.length < 5 && state !== "over" && state !== "win") {
      shrooms.push(makeShroom(weightedSpecies()));
    }
  }

  /* ---------- drawing fungi ---------- */

  function shade(col, amt) {
    const c = hexRGB(col.startsWith("#") ? col : "#888888");
    return (
      "rgb(" +
      clamp(c[0] + amt, 0, 255) +
      "," +
      clamp(c[1] + amt, 0, 255) +
      "," +
      clamp(c[2] + amt, 0, 255) +
      ")"
    );
  }

  function smoothBlob(g, pts) {
    g.beginPath();
    const n = pts.length;
    g.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    for (let i = 1; i <= n; i++) {
      const p = pts[i % n];
      const q = pts[(i + 1) % n];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    g.closePath();
  }

  function drawStem(g, sp, w, h, bulb) {
    g.fillStyle = sp.stem;
    g.beginPath();
    const bw = bulb ? w * 1.25 : w;
    g.moveTo(-w / 2, 0);
    g.bezierCurveTo(-bw / 2, -h * 0.3, -w / 2 - 1, -h * 0.75, -w / 2, -h);
    g.lineTo(w / 2, -h);
    g.bezierCurveTo(w / 2 + 1, -h * 0.75, bw / 2, -h * 0.3, w / 2, 0);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(w * 0.08, -h + 2, w * 0.14, h - 4);
  }

  function drawRingSkirt(g, sp, sy, rw) {
    g.fillStyle = shade(sp.stem, -18);
    g.beginPath();
    g.ellipse(0, sy, rw, rw * 0.38, 0, 0, Math.PI, false);
    g.lineTo(rw, sy - 4);
    g.ellipse(0, sy - 4, rw, rw * 0.38, 0, 0, Math.PI, true);
    g.closePath();
    g.fill();
  }

  function drawVolva(g, sp, rw) {
    g.fillStyle = shade(sp.stem, -8);
    g.beginPath();
    g.ellipse(0, -rw * 0.28, rw, rw * 0.62, 0, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.15)";
    g.beginPath();
    g.ellipse(0, -rw * 0.28, rw * 0.55, rw * 0.34, 0, 0, TAU);
    g.fill();
  }

  /* one fruiting body, origin at its base */
  function drawBody(g, sp, R, jit, flecks, swayA) {
    const h = R * (sp.shape === "ball" ? 0.28 : 1.02);

    // shadow
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath();
    g.ellipse(0, 3, R * 0.92, R * 0.24, 0, 0, TAU);
    g.fill();

    g.rotate(swayA || 0);

    if (sp.shape === "ball") {
      const r = R * 0.74;
      drawStem(g, sp, R * 0.22, h);
      const gr = g.createRadialGradient(
        -r * 0.3,
        -r * 1.1,
        r * 0.15,
        0,
        -r,
        r * 1.15,
      );
      gr.addColorStop(0, sp.capHi);
      gr.addColorStop(1, shade(sp.cap, -12));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, -r, r, r * 0.96, 0, 0, TAU);
      g.fill();
      g.strokeStyle = "rgba(120,105,80,0.35)";
      g.lineWidth = 1.4;
      for (const f of flecks) {
        g.beginPath();
        g.arc(f.u * r * 0.6, -r + f.v * r * 0.6, f.r * 0.5, 0, TAU);
        g.stroke();
      }
      return;
    }

    if (sp.shape === "vase") {
      // trumpet funnel with wavy margin
      g.fillStyle = shade(sp.cap, -26);
      g.beginPath(); // underside shadow layer
      g.ellipse(0, -h + R * 0.16, R * 0.86, R * 0.2, 0, 0, TAU);
      g.fill();
      const grad = g.createLinearGradient(0, -h - R * 0.2, 0, 0);
      grad.addColorStop(0, sp.capHi);
      grad.addColorStop(0.55, sp.cap);
      grad.addColorStop(1, shade(sp.cap, -18));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(-R * 0.3, 0);
      g.bezierCurveTo(
        -R * 0.42,
        -h * 0.5,
        -R * 0.86,
        -h * 0.72,
        -R * (1.0 * jit[0]),
        -h,
      );
      const waves = 5;
      for (let k = 0; k <= waves; k++) {
        const t0 = -R * (1.0 * jit[0]) + ((2 * R * jit[0]) / waves) * k;
        const dip = k % 2 === 0 ? R * 0.1 : R * 0.02;
        g.quadraticCurveTo(
          t0 + R / waves / 2,
          -h + dip,
          t0 + R / waves,
          -h + (k === waves ? R * 0.06 : 0),
        );
      }
      g.bezierCurveTo(R * 0.86, -h * 0.72, R * 0.42, -h * 0.5, R * 0.3, 0);
      g.closePath();
      g.fill();
      // blunt ridges on the outer funnel
      g.strokeStyle = shade(sp.cap, -34);
      g.lineCap = "round";
      g.lineWidth = Math.max(2, R * 0.06);
      g.globalAlpha = 0.55;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * R * 0.3, -h * 0.94);
        g.quadraticCurveTo(i * R * 0.36, -h * 0.5, i * R * 0.16, -h * 0.06);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }

    if (sp.shape === "bolete") {
      drawStem(g, sp, R * 0.44, h, true);
      const cy = -h - R * 0.3;
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        pts.push([
          Math.cos(a) * R * 0.98 * jit[i],
          cy - Math.sin(a) * R * 0.6 * jit[(i + 3) % 9],
        ]);
      }
      const grad = g.createLinearGradient(0, cy - R * 0.6, 0, cy + R * 0.2);
      grad.addColorStop(0, sp.capHi);
      grad.addColorStop(1, sp.cap);
      g.fillStyle = grad;
      smoothBlob(
        g,
        pts.concat([
          [pts[8][0] + 6, cy + R * 0.16],
          [pts[0][0] - 6, cy + R * 0.16],
        ]),
      );
      g.fill();
      g.fillStyle = "#cfc294";
      g.beginPath();
      g.ellipse(0, cy + R * 0.18, R * 0.8, R * 0.1, 0, 0, Math.PI, false);
      g.fill();
      return;
    }

    // dome (death cap / fly agaric)
    if (sp.shape === "dome") {
      if (sp.volva) drawVolva(g, sp, R * 0.42);
      drawStem(g, sp, R * 0.3, h);
      if (sp.ring) drawRingSkirt(g, sp, -h * 0.56, R * 0.27);
      const cy = -h;
      const pts = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        pts.push([
          Math.cos(a) * R * 0.94 * jit[i],
          cy - Math.sin(a) * R * 0.66 * jit[(i + 2) % 9],
        ]);
      }
      const grad = g.createRadialGradient(
        -R * 0.25,
        cy - R * 0.5,
        R * 0.1,
        0,
        cy,
        R * 1.1,
      );
      grad.addColorStop(0, sp.capHi);
      grad.addColorStop(1, sp.cap);
      g.fillStyle = grad;
      smoothBlob(
        g,
        pts.concat([
          [pts[8][0] + 4, cy + R * 0.1],
          [pts[0][0] - 4, cy + R * 0.1],
        ]),
      );
      g.fill();
      if (flecks.length) {
        g.save();
        g.clip();
        g.fillStyle = "rgba(245,240,225,0.92)";
        for (const f of flecks) {
          g.beginPath();
          g.arc(f.u * R * 0.8, cy - f.v * R * 0.62, f.r, 0, TAU);
          g.fill();
        }
        g.restore();
      }
      return;
    }

    // flat / irregular cap (hedgehog, false chanterelle, jack)
    drawStem(g, sp, R * 0.26, h);
    const cy = -h - R * 0.22;
    const rx = R * 0.96;
    const ry = R * 0.4;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      pts.push([
        Math.cos(a) * rx * jit[i],
        cy + Math.sin(a) * ry * jit[(i + 4) % 10] * (Math.sin(a) < 0 ? 1 : 0.7),
      ]);
    }
    if (sp.glow) {
      const gl = g.createRadialGradient(0, cy, R * 0.2, 0, cy, R * 1.7);
      const pulse = 0.1 + 0.07 * Math.sin(tGlob * 2.2);
      gl.addColorStop(0, "rgba(140,235,150," + pulse.toFixed(3) + ")");
      gl.addColorStop(1, "rgba(140,235,150,0)");
      g.fillStyle = gl;
      g.beginPath();
      g.arc(0, cy, R * 1.7, 0, TAU);
      g.fill();
    }
    const grad = g.createLinearGradient(0, cy - ry, 0, cy + ry * 0.6);
    grad.addColorStop(0, sp.capHi);
    grad.addColorStop(1, sp.cap);
    g.fillStyle = grad;
    smoothBlob(g, pts);
    g.fill();
    // dark rim under the margin
    g.strokeStyle = shade(sp.cap, -30);
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(
      0,
      cy + ry * 0.28,
      rx * 0.88,
      ry * 0.5,
      0,
      0.15 * Math.PI,
      0.85 * Math.PI,
    );
    g.stroke();
  }

  function drawUndersideDisc(g, sp, cx, cy, RU) {
    // skin ring
    g.fillStyle = sp.cap;
    g.beginPath();
    g.arc(cx, cy, RU, 0, TAU);
    g.fill();
    // flesh
    const fleshCol =
      sp.key === "falsechan" || sp.key === "jack"
        ? "#eda03f"
        : sp.key === "chanterelle"
          ? "#f0d489"
          : "#f2ecd9";
    g.fillStyle = fleshCol;
    g.beginPath();
    g.arc(cx, cy, RU * 0.86, 0, TAU);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(cx, cy, RU * 0.82, 0, TAU);
    g.clip();
    if (sp.under === "ridges") {
      g.strokeStyle = shade(sp.cap, -30);
      g.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        const mx = cx + Math.cos(a) * RU * 0.45;
        const my = cy + Math.sin(a) * RU * 0.45;
        g.lineWidth = RU * 0.11;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * RU * 0.12, cy + Math.sin(a) * RU * 0.12);
        g.lineTo(mx, my);
        g.stroke();
        g.lineWidth = RU * 0.06;
        for (const da of [-0.35, 0.35]) {
          g.beginPath();
          g.moveTo(mx, my);
          g.lineTo(
            cx + Math.cos(a + da) * RU * 0.8,
            cy + Math.sin(a + da) * RU * 0.8,
          );
          g.stroke();
        }
      }
    } else if (sp.under === "gills") {
      g.fillStyle = sp.glow
        ? "rgba(170,230,160,0.35)"
        : "rgba(190,175,140,0.35)";
      g.fillRect(cx - RU, cy - RU, RU * 2, RU * 2);
      g.strokeStyle = sp.glow ? "#cdeab2" : "#f5efdb";
      g.lineWidth = 1.7;
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * TAU;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * RU * 0.1, cy + Math.sin(a) * RU * 0.1);
        g.lineTo(cx + Math.cos(a) * RU * 0.82, cy + Math.sin(a) * RU * 0.82);
        g.stroke();
      }
    } else if (sp.under === "pores") {
      g.fillStyle = "#cabf93";
      for (let i = 0; i < 110; i++) {
        const a = Math.random() * TAU;
        const rr = Math.sqrt(Math.random()) * RU * 0.78;
        g.beginPath();
        g.arc(
          cx + Math.cos(a) * rr,
          cy + Math.sin(a) * rr,
          rand(1, 2.4),
          0,
          TAU,
        );
        g.fill();
      }
    } else if (sp.under === "spines") {
      g.strokeStyle = "#d8c597";
      g.lineWidth = 2.4;
      g.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * RU * 0.3, cy + Math.sin(a) * RU * 0.3);
        g.lineTo(cx + Math.cos(a) * RU * 0.8, cy + Math.sin(a) * RU * 0.8);
        g.stroke();
      }
    }
    g.restore();

    g.strokeStyle = "rgba(60,45,25,0.55)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, RU + 1, 0, TAU);
    g.stroke();
  }

  /* whole specimen on the ground (handles clusters) */
  function drawShroom(g, s, opts) {
    opts = opts || {};
    const grow = clamp((tGlob - s.born) / 0.28, 0, 1);
    const scale =
      opts.scale != null
        ? opts.scale
        : 0.6 + 0.4 * (1 - (1 - grow) * (1 - grow));
    g.save();
    g.translate(s.x, s.y);
    const members = [];
    for (let i = 0; i < s.n; i++) {
      const off = i - (s.n - 1) / 2;
      members.push({
        dx: off * s.R * 1.02 + s.jit[i] * 4,
        dy: Math.abs(off) * 7,
        R: s.R * (off === 0 ? 1 : 0.82),
      });
    }
    members.sort((a, b) => a.dy - b.dy);
    for (const m of members) {
      g.save();
      g.translate(m.dx * scale, m.dy * scale);
      g.scale(scale, scale);
      g.rotate(s.rot);
      const sway = opts.still
        ? 0
        : Math.sin(tGlob * 1.4 + s.phase + m.dx) * 0.028;
      drawBody(g, s.sp, m.R, s.jit, s.flecks, sway);
      g.restore();
    }
    g.restore();
  }

  /* inspect view on the side panel canvas */
  const FIT = { vase: 52, bolete: 54, ball: 58, flat: 60, dome: 56 };

  function renderInspect() {
    const gw = 264;
    const gh = 212;
    bctx.clearRect(0, 0, gw, gh);
    if (!inspecting) return;
    const s = inspecting;
    const sp = s.sp;
    const R = FIT[sp.shape] || 54;

    // ghost cluster-mates behind
    if (s.n > 1) {
      bctx.save();
      bctx.globalAlpha = 0.45;
      for (let i = 0; i < s.n; i++) {
        const off = i - (s.n - 1) / 2;
        if (off === 0) continue;
        bctx.save();
        bctx.translate(gw / 2 + off * R * 0.95, gh - 22 + Math.abs(off) * 8);
        bctx.scale(0.72, 0.72);
        drawBody(bctx, sp, R, s.jit, s.flecks, 0);
        bctx.restore();
      }
      bctx.restore();
    }

    bctx.save();
    bctx.translate(gw / 2, gh - 20);
    bctx.rotate(insTilt);
    drawBody(bctx, sp, R, s.jit, s.flecks, 0);
    bctx.restore();

    if (s.cut) {
      // dotted leader to the cross-section
      bctx.strokeStyle = "rgba(90,70,40,0.5)";
      bctx.setLineDash([3, 4]);
      bctx.beginPath();
      bctx.moveTo(gw / 2 + R * 0.6, gh - 110);
      bctx.lineTo(206, 138);
      bctx.stroke();
      bctx.setLineDash([]);
      drawUndersideDisc(bctx, sp, 206, 138, 46);
    }
  }

  /* ---------- scene ---------- */

  function skyColors(f) {
    // f: 1 daylight -> 0 night
    let top, bot;
    if (f > 0.55) {
      const t = (1 - f) / 0.45;
      top = mixColor("#9db8c4", "#5d6a92", t);
      bot = mixColor("#d9bf83", "#b06a45", t);
    } else {
      const t = 1 - f / 0.55;
      top = mixColor("#5d6a92", "#141a2c", t);
      bot = mixColor("#b06a45", "#33323e", t);
    }
    return [top, bot];
  }

  function drawScene() {
    const f = clamp(state === "title" ? 1 : light / dayPool, 0, 1);
    ctx.save();
    if (shakeT > 0) {
      ctx.translate(rand(-3, 3) * shakeT * 2, rand(-2, 2) * shakeT * 2);
    }

    // sky
    const [top, bot] = skyColors(f);
    const sk = ctx.createLinearGradient(0, 0, 0, GROUND_Y + 30);
    sk.addColorStop(0, top);
    sk.addColorStop(1, bot);
    ctx.fillStyle = sk;
    ctx.fillRect(-6, -6, W + 12, GROUND_Y + 40);

    // sun / moon
    const sunY = lerp(84, GROUND_Y + 6, 1 - f);
    const sunX = lerp(W * 0.72, W * 0.5, 1 - f);
    if (f > 0.02) {
      const sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 60);
      sg.addColorStop(0, "rgba(255,214,130,0.9)");
      sg.addColorStop(1, "rgba(255,214,130,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 60, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffd97a";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 14, 0, TAU);
      ctx.fill();
    }
    if (f < 0.45) {
      const ma = clamp((0.45 - f) / 0.45, 0, 1);
      ctx.globalAlpha = ma;
      ctx.fillStyle = "#d8dbe2";
      ctx.beginPath();
      ctx.arc(W * 0.2, 70 - ma * 20, 11, 0, TAU);
      ctx.fill();
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.arc(W * 0.2 + 5, 66 - ma * 20, 9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // far tree line
    ctx.fillStyle = "rgba(24,30,18,0.85)";
    ctx.beginPath();
    ctx.moveTo(-10, GROUND_Y + 8);
    for (let x = -10; x <= W + 10; x += 40) {
      ctx.lineTo(x + 20, GROUND_Y - 14 - ((x * 7919) % 23));
      ctx.lineTo(x + 40, GROUND_Y + 2);
    }
    ctx.lineTo(W + 10, GROUND_Y + 8);
    ctx.closePath();
    ctx.fill();

    // birch trunks
    for (const t of TRUNKS) {
      ctx.save();
      ctx.translate(t.x, GROUND_Y + 12);
      ctx.rotate(t.lean);
      const tg = ctx.createLinearGradient(0, 0, 0, -200);
      tg.addColorStop(0, "rgba(196,188,166,0.9)");
      tg.addColorStop(1, "rgba(150,144,128,0.55)");
      ctx.fillStyle = tg;
      ctx.fillRect(-t.w / 2, -220, t.w, 232);
      ctx.fillStyle = "rgba(40,34,24,0.75)";
      for (const d of t.dashes) {
        ctx.fillRect(-t.w * 0.3 + d.dx * t.w, d.y, d.dw, 3.2);
      }
      ctx.restore();
    }

    // ground
    ctx.drawImage(groundCan, 0, 0);

    // fireflies late in the day
    if (f < 0.5) {
      const fa = clamp((0.5 - f) / 0.5, 0, 1);
      for (let i = 0; i < 7; i++) {
        const px =
          (i * 137 + Math.sin(tGlob * (0.4 + i * 0.07) + i) * 60 + W) % W;
        const py =
          260 +
          ((i * 53) % 240) +
          Math.cos(tGlob * (0.5 + i * 0.05) + i * 2) * 24;
        const blink = 0.4 + 0.6 * Math.abs(Math.sin(tGlob * 1.7 + i * 2.1));
        ctx.fillStyle =
          "rgba(220,240,140," + (fa * blink * 0.8).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, TAU);
        ctx.fill();
      }
    }

    // selection halos
    shrooms.forEach((s, i) => {
      if (i === selIdx && state === "play") {
        ctx.save();
        ctx.strokeStyle = "#ffd76a";
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 6]);
        ctx.lineDashOffset = -tGlob * 26;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + 2, s.R * 1.5, s.R * 0.42, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    });

    // mushrooms, painter order by y
    const sorted = shrooms.slice().sort((a, b) => a.y - b.y);
    for (const s of sorted) drawShroom(ctx, s);

    // floaters
    for (const fl of floaters) {
      ctx.globalAlpha = clamp(fl.t / 0.5, 0, 1);
      ctx.font = "bold 17px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillStyle = fl.col;
      ctx.fillText(fl.txt, fl.x, fl.y - (1.1 - fl.t) * 34);
      ctx.globalAlpha = 1;
    }

    // darkness vignette
    const dark = Math.pow(1 - f, 1.35) * 0.62;
    if (dark > 0.01) {
      const vg = ctx.createRadialGradient(
        W / 2,
        H * 0.55,
        H * 0.25,
        W / 2,
        H * 0.55,
        H * 0.85,
      );
      vg.addColorStop(0, "rgba(6,8,14,0)");
      vg.addColorStop(1, "rgba(6,8,14," + dark.toFixed(3) + ")");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    // poison flash
    if (flashT > 0) {
      ctx.fillStyle = "rgba(180,30,20," + (flashT * 0.45).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    // day banner
    if (bannerT > 0) {
      const a =
        bannerT > 1.9 ? (2.4 - bannerT) / 0.5 : clamp(bannerT / 0.9, 0, 1);
      ctx.globalAlpha = a * 0.9;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(12,9,5,0.72)";
      ctx.fillRect(0, H * 0.3, W, 108);
      ctx.fillStyle = "#ffd97a";
      ctx.font = "bold 40px Georgia, serif";
      ctx.fillText(bannerMsg, W / 2, H * 0.3 + 48);
      ctx.fillStyle = "#e8dcc0";
      ctx.font = "italic 19px Georgia, serif";
      ctx.fillText(
        FLAVOR[day - 1] + "  \u00b7  basket quota " + quota,
        W / 2,
        H * 0.3 + 82,
      );
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /* ---------- HUD / ticker / guide ---------- */

  const chipDay = $("chipDay");
  const chipSun = $("chipSun");
  const chipBasket = $("chipBasket");
  const chipHearts = $("chipHearts");
  const chipScore = $("chipScore");
  const tickerEl = $("ticker");
  const overlayEl = $("overlay");
  const ovTitle = $("ovTitle");
  const ovBody = $("ovBody");
  const ovBtn = $("ovBtn");
  const inspectEl = $("inspect");
  const notesEl = $("notes");

  let tickerTimer = 0;

  function show(msg, cls) {
    tickerEl.textContent = msg;
    tickerEl.className = cls || "";
    void tickerEl.offsetWidth;
    tickerEl.classList.add("show");
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => tickerEl.classList.remove("show"), 2600);
  }

  function updateHUD() {
    chipDay.textContent = "DAY " + day + "/5";
    const f = clamp(light / dayPool, 0, 1);
    const lit = Math.ceil(f * 5);
    chipSun.textContent = "\u25cf".repeat(lit) + "\u25cb".repeat(5 - lit);
    chipBasket.textContent = "basket " + basket + "/" + quota;
    chipHearts.textContent = hearts > 0 ? "\u2665".repeat(hearts) : "\u00d7";
    chipScore.textContent = String(score);
  }

  function buildGuide() {
    const cards = $("cards");
    cards.innerHTML = "";
    for (const sp of SPECIES) {
      const card = document.createElement("div");
      card.className = "card";
      const th = document.createElement("canvas");
      th.width = 280;
      th.height = 190;
      const g = th.getContext("2d");
      g.scale(2, 2); // crisp on retina, CSS sizes it down
      const fake = {
        jit: Array.from({ length: 10 }, () => 1),
        flecks: Array.from({ length: sp.flecks || 0 }, () => ({
          u: rand(-0.8, 0.8),
          v: rand(0, 0.9),
          r: rand(2, 3.6),
        })),
      };
      g.save();
      g.translate(70, 86);
      drawBody(g, sp, 30, fake.jit, fake.flecks, 0);
      g.restore();
      const h3 = document.createElement("h3");
      h3.textContent = sp.name;
      const p = document.createElement("p");
      p.textContent = sp.tell;
      const badge = document.createElement("span");
      badge.className = "badge " + (sp.kind === "edible" ? "edible" : "deadly");
      badge.textContent =
        sp.kind === "edible" ? "edible \u00b7 " + sp.pts : "deadly";
      card.appendChild(th);
      card.appendChild(h3);
      card.appendChild(p);
      card.appendChild(badge);
      cards.appendChild(card);
    }
  }

  /* ---------- inspect panel ---------- */

  function renderNotes() {
    notesEl.innerHTML = "";
    const s = inspecting;
    if (!s) return;
    if (!s.cut && !s.smelled) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "unexamined - what is it?";
      notesEl.appendChild(li);
      return;
    }
    if (s.cut) {
      const li = document.createElement("li");
      li.className = "cut";
      li.textContent =
        "Cut: " + UNDER_TEXT[s.sp.under] + ". Flesh " + s.sp.flesh + ".";
      notesEl.appendChild(li);
    }
    if (s.smelled) {
      const li = document.createElement("li");
      li.className = "smell";
      li.textContent = "Smell: " + s.sp.smell + ".";
      notesEl.appendChild(li);
    }
  }

  function openInspect(s) {
    inspecting = s;
    insTilt = 0;
    selIdx = shrooms.indexOf(s);
    inspectEl.classList.remove("hidden");
    renderNotes();
    sfx.select();
  }

  function closeInspect() {
    inspecting = null;
    inspectEl.classList.add("hidden");
  }

  function spend(sec) {
    light -= sec / FASTM; // #fast: actions cost near-nothing so tests can play out
  }

  function doCut() {
    if (state !== "play" || !inspecting || inspecting.cut) return;
    inspecting.cut = true;
    spend(COST.cut);
    sfx.cut();
    renderNotes();
    updateHUD();
  }

  function doSmell() {
    if (state !== "play" || !inspecting || inspecting.smelled) return;
    inspecting.smelled = true;
    spend(COST.smell);
    sfx.smell();
    renderNotes();
    updateHUD();
  }

  function removeCurrent() {
    const i = shrooms.indexOf(inspecting);
    if (i >= 0) shrooms.splice(i, 1);
    selIdx = -1;
  }

  function addFloater(x, y, txt, col) {
    floaters.push({ x, y: y - 30, txt, col, t: 1.1 });
  }

  function doKeep() {
    if (state !== "play" || !inspecting) return;
    const s = inspecting;
    spend(COST.keep);
    const px = s.x;
    const py = s.y;
    if (s.sp.kind === "edible") {
      score += s.sp.pts;
      basket++;
      addFloater(px, py, "+" + s.sp.pts, "#ffe08a");
      show(
        "Kept the " + s.sp.name.toLowerCase() + " (+" + s.sp.pts + ").",
        "good",
      );
      sfx.keep();
    } else {
      hearts--;
      flashT = 0.8;
      shakeT = 0.5;
      addFloater(px, py, "POISON", "#ff9c86");
      show(s.sp.name.toUpperCase() + "! It burns your mouth.", "bad");
      sfx.poison();
    }
    removeCurrent();
    closeInspect();
    fillField();
    updateHUD();
    if (hearts <= 0) gameOver("poison");
  }

  function doLeave() {
    if (state !== "play" || !inspecting) return;
    const s = inspecting;
    spend(COST.leave);
    show("Left the " + s.sp.name.toLowerCase() + " in the litter.");
    removeCurrent();
    closeInspect();
    fillField();
    updateHUD();
  }

  /* ---------- flow ---------- */

  function setupDay(d) {
    day = d;
    quota = DAYS[d - 1].quota;
    dayPool = DAYS[d - 1].light;
    light = dayPool;
    basket = 0;
    shrooms = [];
    selIdx = -1;
    closeInspect();
    regenGround();
    fillField();
    bannerMsg = "DAY " + d;
    bannerT = fast ? 0.6 : 2.4;
    state = "play";
    hideOverlay();
    updateHUD();
  }

  function endOfDay() {
    closeInspect();
    if (basket >= quota) {
      const bonus = hearts * 15 + day * 10;
      score += bonus;
      show("Dusk falls - basket safe (+" + bonus + " bonus).", "good");
      sfx.duskSafe();
      if (day >= 5) {
        win();
      } else {
        setupDay(day + 1);
      }
    } else {
      gameOver("dark");
    }
  }

  function gameOver(kind) {
    state = "over";
    closeInspect();
    sfx.over();
    try {
      if (score > best) {
        best = score;
        localStorage.setItem("false-chanterelle-best", String(best));
      }
    } catch (e) {
      /* private mode */
    }
    const title =
      kind === "poison" ? "Three bellies burned" : "The woods went dark";
    const why =
      kind === "poison"
        ? "The last fungus was no food. The trees begin to spin, politely, then not politely at all."
        : "You needed " +
          (quota - basket) +
          " more before sundown. The cold comes up through the moss and the path home is gone.";
    showOverlay(
      title,
      "<p>" +
        why +
        "</p><p>You carried <b>" +
        basket +
        "</b> of the <b>" +
        quota +
        "</b> asked for, over <b>" +
        day +
        "</b> dusk" +
        (day > 1 ? "s" : "") +
        ".<br>Final score <b>" +
        score +
        "</b>." +
        (best ? " Best <b>" + best + "</b>." : "") +
        "</p>",
      "Forage again",
      restart,
    );
    updateHUD();
  }

  function win() {
    state = "win";
    sfx.win();
    try {
      if (score > best) {
        best = score;
        localStorage.setItem("false-chanterelle-best", String(best));
      }
    } catch (e) {
      /* private mode */
    }
    showOverlay(
      "Home before dark",
      "<p>Five baskets, full and honest. The stove is lit, the pan is buttered, and every one of them was what you said it was.</p><p>Final score <b>" +
        score +
        "</b>. Best <b>" +
        best +
        "</b>.</p>",
      "Forage again",
      restart,
    );
    updateHUD();
  }

  function restart() {
    hearts = 3;
    score = 0;
    floaters = [];
    flashT = 0;
    shakeT = 0;
    setupDay(1);
  }

  function showOverlay(title, html, btn, cb) {
    ovTitle.textContent = title;
    ovBody.innerHTML = html;
    ovBtn.textContent = btn;
    overlayEl.classList.remove("hidden");
    ovBtn.onclick = () => {
      ovBtn.blur();
      cb();
    };
  }

  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }

  function togglePause() {
    if (state === "play") {
      state = "paused";
      showOverlay(
        "Paused",
        "<p>The woods hold their breath. Nothing wilts while you look away.</p>",
        "Resume",
        () => {
          state = "play";
          hideOverlay();
        },
      );
    } else if (state === "paused") {
      state = "play";
      hideOverlay();
    }
  }

  /* ---------- input ---------- */

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "m" || k === "M") {
      muted = !muted;
      $("btnMute").textContent = muted ? "\u00d8" : "\u266a";
      show(muted ? "Sound off." : "Sound on.");
      return;
    }
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (k === "r" || k === "R") {
      show("Fresh morning. The woods reset.");
      restart();
      return;
    }
    if (state === "title") {
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        startGame();
      }
      return;
    }
    if (state === "paused" || state === "over" || state === "win") return;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "Enter" || k === " ") {
      e.preventDefault();
    }
    if (state !== "play") return;

    if (k === "ArrowLeft" || k === "ArrowRight") {
      if (!shrooms.length) return;
      const dir = k === "ArrowLeft" ? -1 : 1;
      const order = shrooms.slice().sort((a, b) => a.x - b.x);
      let cur = 0;
      if (inspecting) {
        cur = order.indexOf(inspecting);
        if (cur < 0) cur = 0;
      } else {
        cur = order.indexOf(shrooms[clamp(selIdx, 0, shrooms.length - 1)]);
        if (cur < 0) cur = 0;
      }
      const next = order[(cur + dir + order.length) % order.length];
      openInspect(next);
    } else if (k === "Enter" || k === " ") {
      if (inspecting) {
        closeInspect();
      } else if (shrooms.length) {
        openInspect(shrooms[clamp(selIdx, 0, shrooms.length - 1)]);
      }
    } else if (k === "Escape") {
      closeInspect();
    } else if (k === "c" || k === "C") {
      doCut();
    } else if (k === "s" || k === "S") {
      doSmell();
    } else if (k === "k" || k === "K") {
      doKeep();
    } else if (k === "l" || k === "L") {
      doLeave();
    }
  });

  function canvasPos(e) {
    const r = cvs.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * W,
      ((e.clientY - r.top) / r.height) * H,
    ];
  }

  cvs.addEventListener("pointerdown", (e) => {
    if (state !== "play") return;
    const [x, y] = canvasPos(e);
    let hit = null;
    let hd = 1e9;
    for (const s of shrooms) {
      const d = Math.hypot(s.x - x, s.y - y - s.R * 0.5);
      if (d < s.R + 30 && d < hd) {
        hd = d;
        hit = s;
      }
    }
    if (hit) {
      openInspect(hit);
    } else if (inspecting) {
      closeInspect();
    }
  });

  // drag-to-tilt on the inspection view
  let dragging = false;
  big.addEventListener("pointerdown", (e) => {
    dragging = true;
    big.setPointerCapture(e.pointerId);
  });
  big.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    insTilt = clamp(insTilt + e.movementX * 0.006, -0.5, 0.5);
  });
  big.addEventListener("pointerup", () => {
    dragging = false;
  });
  big.addEventListener("lostpointercapture", () => {
    dragging = false;
  });

  $("btnCut").addEventListener("click", (e) => {
    e.currentTarget.blur();
    doCut();
  });
  $("btnSmell").addEventListener("click", (e) => {
    e.currentTarget.blur();
    doSmell();
  });
  $("btnKeep").addEventListener("click", (e) => {
    e.currentTarget.blur();
    doKeep();
  });
  $("btnLeave").addEventListener("click", (e) => {
    e.currentTarget.blur();
    doLeave();
  });
  $("btnMute").addEventListener("click", (e) => {
    muted = !muted;
    e.currentTarget.textContent = muted ? "\u00d8" : "\u266a";
    e.currentTarget.blur();
  });
  $("btnPause").addEventListener("click", (e) => {
    e.currentTarget.blur();
    togglePause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "play") togglePause();
  });

  /* ---------- boot ---------- */

  function startGame() {
    ac(); // unlock audio on the gesture
    restart();
  }

  ovBtn.onclick = () => startGame();
  regenGround();
  buildGuide();
  updateHUD();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tGlob += dt;
    if (state === "play") {
      light -= dt * FASTM * 0.12; // ambient drift of the light
      bannerT -= dt;
      if (light <= 0) {
        light = 0;
        endOfDay();
      }
    }
    if (flashT > 0) flashT -= dt;
    if (shakeT > 0) shakeT -= dt;
    for (const fl of floaters) fl.t -= dt;
    floaters = floaters.filter((fl) => fl.t > 0);
    if (state === "play" || state === "paused" || state === "title") {
      drawScene();
      if (inspecting) renderInspect();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
