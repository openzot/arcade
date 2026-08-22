(() => {
"use strict";

/* ============================== helpers ============================== */
const $ = (id) => document.getElementById(id);
const cv = $("cv"),
  ctx = cv.getContext("2d");
const overlay = $("overlay"),
  panel = $("panel"),
  bannerEl = $("banner");
const lvlEl = $("lvl"),
  pennedEl = $("penned"),
  timeEl = $("time"),
  scoreEl = $("score");
const barkFill = $("barkFill");

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const TAU = Math.PI * 2;
const W = 960,
  H = 600,
  BARK_CD = 1.35;

let view = { s: 1, ox: 0, oy: 0 },
  dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  const s = Math.min(innerWidth / W, innerHeight / H);
  view = {
    s,
    ox: (innerWidth - W * s) / 2,
    oy: (innerHeight - H * s) / 2,
  };
}
addEventListener("resize", resize);
resize();

/* ============================== audio ============================== */
let ac = null,
  master = null,
  noiseBuf = null,
  muted = false;
function initAudio() {
  if (ac) {
    if (ac.state === "suspended") ac.resume();
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
    const len = Math.floor(ac.sampleRate * 0.5);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) {
    ac = null;
  }
}
function tone(freq, dur, type, vol, slideTo, when) {
  if (!ac || muted) return;
  const t = ac.currentTime + (when || 0);
  const o = ac.createOscillator(),
    g = ac.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, t);
  if (slideTo)
    o.frequency.exponentialRampToValueAtTime(
      Math.max(30, slideTo),
      t + dur,
    );
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function noise(dur, vol, f0, f1, type, when) {
  if (!ac || muted || !noiseBuf) return;
  const t = ac.currentTime + (when || 0);
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const flt = ac.createBiquadFilter();
  flt.type = type || "bandpass";
  flt.frequency.setValueAtTime(f0, t);
  if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  flt.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.25, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}
const sfx = {
  bark() {
    noise(0.16, 0.5, 900, 250);
    tone(200, 0.14, "square", 0.22, 95);
  },
  bleat() {
    const f = rnd(420, 560);
    tone(f, 0.06, "sawtooth", 0.1, f * 0.8);
    tone(f * 1.04, 0.16, "sawtooth", 0.09, f * 0.7, 0.06);
  },
  pen() {
    tone(660, 0.09, "sine", 0.18);
    tone(990, 0.16, "sine", 0.18, null, 0.08);
  },
  clear() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, 0.16, "triangle", 0.2, null, i * 0.09),
    );
  },
  fail() {
    tone(220, 0.5, "sawtooth", 0.2, 90);
    noise(0.4, 0.15, 300, 80, "lowpass");
  },
  growl() {
    tone(75, 0.45, "sawtooth", 0.25, 55);
    noise(0.45, 0.18, 200, 90, "lowpass");
  },
  thud() {
    tone(95, 0.16, "sine", 0.35, 40);
    noise(0.1, 0.25, 250, 100, "lowpass");
  },
  tick() {
    tone(1250, 0.04, "square", 0.07);
  },
  charge() {
    tone(160, 0.3, "sawtooth", 0.14, 320);
  },
};

/* ============================== levels ============================== */
const SHEEP_NAMES = [
  "Baaarbara",
  "Wooliam",
  "Shaun",
  "Shearlock",
  "Baahtilda",
  "Lambalina",
  "Fleecy",
  "Baaernard",
  "Woolma",
  "Ewnice",
  "Lamb Chop",
  "Baaab",
  "Meriino",
  "Woolter",
];
const LEVELS = [
  {
    name: "The Home Field",
    sheep: 6,
    time: 60,
    ram: false,
    wolves: 0,
    blurb:
      "Sheep drift away from your dog. Slip behind the flock and steer it, gently, through the gate.",
    pen: { x: 690, y: 110, w: 200, h: 160, gate: "S" },
    flock: { x: 200, y: 430 },
    dogSpawn: { x: 480, y: 300 },
    thistleSpots: [],
  },
  {
    name: "The Thistle Run",
    sheep: 8,
    time: 75,
    ram: false,
    wolves: 0,
    blurb:
      "Thistles slow the dog to a trudge. Plan a route around them.",
    pen: { x: 90, y: 100, w: 190, h: 150, gate: "E" },
    flock: { x: 770, y: 440 },
    dogSpawn: { x: 480, y: 380 },
    thistleSpots: [
      { x: 430, y: 290, r: 40 },
      { x: 610, y: 170, r: 36 },
    ],
  },
  {
    name: "Ram Country",
    sheep: 10,
    time: 85,
    ram: true,
    wolves: 0,
    blurb:
      "Barnaby the ram marches with the flock. He charges at barks and at close dogs — pen him last.",
    pen: { x: 380, y: 420, w: 200, h: 150, gate: "N" },
    flock: { x: 180, y: 160 },
    dogSpawn: { x: 640, y: 180 },
    thistleSpots: [{ x: 470, y: 240, r: 42 }],
  },
  {
    name: "The Wolf Field",
    sheep: 12,
    time: 95,
    ram: true,
    wolves: 1,
    blurb:
      "A wolf slinks in after a while. Bark near it to drive it off, and do not let it catch a sheep.",
    pen: { x: 700, y: 380, w: 190, h: 160, gate: "W" },
    flock: { x: 170, y: 430 },
    dogSpawn: { x: 430, y: 300 },
    thistleSpots: [
      { x: 420, y: 180, r: 38 },
      { x: 560, y: 470, r: 36 },
    ],
  },
  {
    name: "The High Muster",
    sheep: 14,
    time: 110,
    ram: true,
    wolves: 2,
    blurb:
      "Two wolves, one ram, fourteen strong opinions. This is the whole job.",
    pen: { x: 100, y: 240, w: 180, h: 150, gate: "E" },
    flock: { x: 800, y: 300 },
    dogSpawn: { x: 480, y: 300 },
    thistleSpots: [
      { x: 400, y: 120, r: 38 },
      { x: 520, y: 430, r: 40 },
      { x: 660, y: 220, r: 34 },
    ],
  },
];

/* ============================== state ============================== */
let state = "title"; // title | intro | play | clear | over | won | paused
let levelIdx = 0,
  score = 0,
  scoreAtStart = 0,
  timeLeft = 0,
  lastTick = 99;
let dog = null,
  sheep = [],
  ram = null,
  wolves = [],
  pulses = [],
  parts = [],
  texts = [];
let thistles = [],
  pen = null,
  wallList = [],
  penSolid = null,
  clouds = [];
let clock = 0,
  shake = 0,
  redFlash = 0,
  autoTimer = null,
  overlayAction = null;

const aliveCount = () =>
  sheep.reduce((n, s) => n + (s.dead ? 0 : 1), 0);
const pennedCount = () =>
  sheep.reduce((n, s) => n + (s.dead || !s.penned ? 0 : 1), 0);

/* ============================== pen geometry ============================== */
function penWalls(p) {
  const t = 10,
    g = 78,
    walls = [];
  const seg = (x, y, w, h) => {
    if (w > 0.5 && h > 0.5) walls.push({ x, y, w, h });
  };
  const gx = p.x + p.w / 2 - g / 2,
    gy = p.y + p.h / 2 - g / 2;
  if (p.gate === "N") {
    seg(p.x, p.y, gx - p.x, t);
    seg(gx + g, p.y, p.x + p.w - (gx + g), t);
  } else seg(p.x, p.y, p.w, t);
  if (p.gate === "S") {
    seg(p.x, p.y + p.h - t, gx - p.x, t);
    seg(gx + g, p.y + p.h - t, p.x + p.w - (gx + g), t);
  } else seg(p.x, p.y + p.h - t, p.w, t);
  if (p.gate === "W") {
    seg(p.x, p.y, t, gy - p.y);
    seg(p.x, gy + g, t, p.y + p.h - (gy + g));
  } else seg(p.x, p.y, t, p.h);
  if (p.gate === "E") {
    seg(p.x + p.w - t, p.y, t, gy - p.y);
    seg(p.x + p.w - t, gy + g, t, p.y + p.h - (gy + g));
  } else seg(p.x + p.w - t, p.y, t, p.h);
  return walls;
}
function gateInfo(p) {
  const g = 78;
  if (p.gate === "N")
    return {
      cx: p.x + p.w / 2,
      cy: p.y,
      nx: 0,
      ny: -1,
      gx: p.x + p.w / 2 - g / 2,
      gy: p.y,
    };
  if (p.gate === "S")
    return {
      cx: p.x + p.w / 2,
      cy: p.y + p.h,
      nx: 0,
      ny: 1,
      gx: p.x + p.w / 2 - g / 2,
      gy: p.y + p.h - 10,
    };
  if (p.gate === "W")
    return {
      cx: p.x,
      cy: p.y + p.h / 2,
      nx: -1,
      ny: 0,
      gx: p.x,
      gy: p.y + p.h / 2 - g / 2,
    };
  return {
    cx: p.x + p.w,
    cy: p.y + p.h / 2,
    nx: 1,
    ny: 0,
    gx: p.x + p.w - 10,
    gy: p.y + p.h / 2 - g / 2,
  };
}
function collideRect(e, r, rad) {
  const cx = clamp(e.x, r.x, r.x + r.w),
    cy = clamp(e.y, r.y, r.y + r.h);
  const dx = e.x - cx,
    dy = e.y - cy,
    d2 = dx * dx + dy * dy;
  if (d2 > rad * rad) return;
  if (d2 === 0) {
    const l = e.x - r.x,
      rt = r.x + r.w - e.x,
      tp = e.y - r.y,
      bt = r.y + r.h - e.y;
    const m = Math.min(l, rt, tp, bt);
    if (m === l) e.x = r.x - rad;
    else if (m === rt) e.x = r.x + r.w + rad;
    else if (m === tp) e.y = r.y - rad;
    else e.y = r.y + r.h + rad;
    return;
  }
  const d = Math.sqrt(d2),
    push = (rad - d) / d;
  e.x += dx * push;
  e.y += dy * push;
}

/* ============================== level setup ============================== */
function initLevel(i) {
  const L = LEVELS[i];
  levelIdx = i;
  pen = {
    x: L.pen.x,
    y: L.pen.y,
    w: L.pen.w,
    h: L.pen.h,
    gate: L.pen.gate,
  };
  wallList = penWalls(pen);
  penSolid = {
    x: pen.x + 8,
    y: pen.y + 8,
    w: pen.w - 16,
    h: pen.h - 16,
  };
  thistles = (L.thistleSpots || []).map((t) => ({
    x: t.x,
    y: t.y,
    r: t.r,
  }));
  dog = {
    x: L.dogSpawn.x,
    y: L.dogSpawn.y,
    tx: L.dogSpawn.x,
    ty: L.dogSpawn.y,
    useTarget: false,
    barkCd: 0,
    stun: 0,
    face: 1,
    run: 0,
    vx: 0,
    vy: 0,
    px: L.dogSpawn.x,
    py: L.dogSpawn.y,
  };
  sheep = [];
  for (let k = 0; k < L.sheep; k++) {
    sheep.push({
      x: L.flock.x + rnd(-70, 70),
      y: L.flock.y + rnd(-50, 50),
      vx: rnd(-10, 10),
      vy: rnd(-10, 10),
      panic: 0,
      na: rnd(0, TAU),
      bob: rnd(0, 10),
      dir: Math.random() < 0.5 ? 1 : -1,
      inPen: 0,
      penned: false,
      dead: false,
      name: SHEEP_NAMES[k % SHEEP_NAMES.length],
      hx: 0,
      hy: 0,
      ht: 0,
    });
  }
  ram = L.ram
    ? {
        x: L.flock.x + rnd(-30, 30),
        y: L.flock.y + rnd(-30, 30),
        vx: 0,
        vy: 0,
        mode: "wander",
        cd: 1.5,
        ct: 0,
        na: rnd(0, TAU),
        face: 1,
      }
    : null;
  wolves = [];
  for (let k = 0; k < L.wolves; k++) {
    wolves.push({
      x: k ? W - 26 : 26,
      y: 40 + k * 90,
      vx: 0,
      vy: 0,
      mode: "wait",
      wait: 7 + k * 13,
      flee: 0,
      retarget: 0,
      target: null,
      eat: 0,
      face: 1,
    });
  }
  pulses = [];
  parts = [];
  texts = [];
  timeLeft = L.time;
  lastTick = Math.ceil(timeLeft);
  clouds = [];
  for (let k = 0; k < 3; k++) {
    clouds.push({
      x: rnd(0, W),
      y: rnd(40, 220),
      s: rnd(0.7, 1.3),
      v: rnd(7, 15),
    });
  }
  scoreAtStart = score;
  buildBG();
  updHUD();
}

/* ============================== background art ============================== */
const bgCanvas = document.createElement("canvas");
function buildBG() {
  const s = 2;
  bgCanvas.width = W * s;
  bgCanvas.height = H * s;
  const g = bgCanvas.getContext("2d");
  g.scale(s, s);
  const c = (x, y, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };
  const e = (x, y, rx, ry, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.fill();
  };

  const grad = g.createLinearGradient(0, 0, W * 0.35, H);
  grad.addColorStop(0, "#8ec963");
  grad.addColorStop(1, "#5f9f42");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.05;
  g.fillStyle = "#2f5d23";
  for (let i = -H; i < W + H; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 26, 0);
    g.lineTo(i + 26 + H, H);
    g.lineTo(i + H, H);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;

  g.strokeStyle = "rgba(46,92,35,0.5)";
  g.lineWidth = 1.4;
  g.lineCap = "round";
  for (let i = 0; i < 230; i++) {
    const x = rnd(16, W - 16),
      y = rnd(16, H - 16);
    g.strokeStyle =
      Math.random() < 0.5
        ? "rgba(46,92,35,0.5)"
        : "rgba(198,230,146,0.5)";
    g.beginPath();
    for (let b = 0; b < 3; b++) {
      g.moveTo(x + b * 2.4 - 2.4, y);
      g.lineTo(x + b * 2.4 - 2.4 + rnd(-1.5, 1.5), y - rnd(3, 6));
    }
    g.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd(24, W - 24),
      y = rnd(24, H - 24);
    g.fillStyle = Math.random() < 0.5 ? "#fff7e0" : "#ffd6e7";
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * TAU;
      c(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.4, g.fillStyle);
    }
    c(x, y, 1.3, "#f5b53f");
  }

  // hedge border
  g.fillStyle = "#3a6329";
  g.fillRect(0, 0, W, 15);
  g.fillRect(0, H - 15, W, 15);
  g.fillRect(0, 0, 15, H);
  g.fillRect(W - 15, 0, 15, H);
  for (let i = 0; i < W; i += 17) {
    c(i + rnd(2, 9), 13 + rnd(-3, 3), rnd(4, 7), "#427031");
    c(i + rnd(2, 9), H - 13 + rnd(-3, 3), rnd(4, 7), "#334f24");
  }
  for (let i = 0; i < H; i += 17) {
    c(13 + rnd(-3, 3), i + rnd(2, 9), rnd(4, 7), "#3c682c");
    c(W - 13 + rnd(-3, 3), i + rnd(2, 9), rnd(4, 7), "#35581f");
  }

  // thistles
  for (const t of thistles) {
    g.save();
    g.translate(t.x, t.y);
    g.fillStyle = "#3f6b35";
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      g.lineTo(
        Math.cos(a + 0.17) * t.r * 0.95,
        Math.sin(a + 0.17) * t.r * 0.95,
      );
      g.lineTo(Math.cos(a + 0.34) * 7, Math.sin(a + 0.34) * 7);
      g.closePath();
      g.fill();
    }
    c(0, 0, t.r * 0.42, "#35592d");
    c(0, 0, t.r * 0.19, "#8a63b8");
    g.restore();
  }

  // pen: dirt floor
  g.fillStyle = "#c9b077";
  g.fillRect(pen.x + 6, pen.y + 6, pen.w - 12, pen.h - 12);
  for (let i = 0; i < 26; i++) {
    e(
      pen.x + rnd(14, pen.w - 14),
      pen.y + rnd(14, pen.h - 14),
      rnd(3, 8),
      rnd(2, 5),
      "rgba(120,95,55,0.18)",
    );
  }
  // gate threshold + chevrons
  const gi = gateInfo(pen);
  g.fillStyle = "#dcc790";
  if (pen.gate === "N" || pen.gate === "S")
    g.fillRect(gi.gx, gi.gy, 78, 10);
  else g.fillRect(gi.gx, gi.gy, 10, 78);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 3;
  g.lineCap = "round";
  const ix = -gi.nx,
    iy = -gi.ny,
    px = -iy,
    py = ix;
  for (let k = 0; k < 2; k++) {
    const bx = gi.cx + gi.nx * (18 + k * 17),
      by = gi.cy + gi.ny * (18 + k * 17);
    const tx = bx + ix * 9,
      ty = by + iy * 9;
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(tx - ix * 11 + px * 9, ty - iy * 11 + py * 9);
    g.moveTo(tx, ty);
    g.lineTo(tx - ix * 11 - px * 9, ty - iy * 11 - py * 9);
    g.stroke();
  }
  // fence walls
  for (const r of wallList) {
    g.fillStyle = "#8a5a33";
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = "#a8744a";
    g.fillRect(r.x, r.y, r.w, Math.min(3, r.h));
    g.fillStyle = "rgba(0,0,0,0.15)";
    g.fillRect(r.x, r.y + r.h - 2, r.w, 2);
  }
  // gate posts
  g.fillStyle = "#5f3d20";
  if (pen.gate === "N" || pen.gate === "S") {
    g.fillRect(gi.gx - 10, gi.gy - 4, 10, 18);
    g.fillRect(gi.gx + 78, gi.gy - 4, 10, 18);
  } else {
    g.fillRect(gi.gx - 4, gi.gy - 10, 18, 10);
    g.fillRect(gi.gx - 4, gi.gy + 78, 18, 10);
  }

  // warm sunlight + vignette
  const sun = g.createRadialGradient(
    W * 0.22,
    H * 0.16,
    40,
    W * 0.22,
    H * 0.16,
    W * 0.75,
  );
  sun.addColorStop(0, "rgba(255,242,190,0.22)");
  sun.addColorStop(1, "rgba(255,242,190,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  const vig = g.createRadialGradient(
    W / 2,
    H / 2,
    H * 0.45,
    W / 2,
    H / 2,
    W * 0.72,
  );
  vig.addColorStop(0, "rgba(20,40,10,0)");
  vig.addColorStop(1, "rgba(20,40,10,0.22)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
}

/* ============================== input ============================== */
const keys = new Set();
function keyDir() {
  let x = 0,
    y = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
  return { x, y };
}
addEventListener("keydown", (ev) => {
  const k = ev.code;
  if (
    [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyB",
      "KeyP",
      "KeyR",
      "Enter",
    ].includes(k)
  )
    ev.preventDefault();
  if (ev.repeat) return;
  initAudio();
  keys.add(k);
  if (state === "play") {
    if (k === "Space" || k === "KeyB") bark();
    else if (k === "KeyP") pauseGame();
  } else if (state === "paused") {
    resumeGame();
  } else if (k === "Enter" || k === "Space" || k === "KeyR") {
    overlayAdvance();
  }
});
addEventListener("keyup", (ev) => keys.delete(ev.code));

function toField(ev) {
  return {
    x: clamp((ev.clientX - view.ox) / view.s, 0, W),
    y: clamp((ev.clientY - view.oy) / view.s, 0, H),
  };
}
cv.addEventListener("pointermove", (ev) => {
  if (!dog) return;
  if (ev.pointerType === "mouse" || ev.buttons > 0) {
    const p = toField(ev);
    dog.useTarget = true;
    dog.tx = p.x;
    dog.ty = p.y;
  }
});
cv.addEventListener("pointerdown", (ev) => {
  initAudio();
  if (!dog) return;
  const p = toField(ev);
  dog.useTarget = true;
  dog.tx = p.x;
  dog.ty = p.y;
  if (cv.setPointerCapture) {
    try {
      cv.setPointerCapture(ev.pointerId);
    } catch (e) {}
  }
});
cv.addEventListener("contextmenu", (ev) => ev.preventDefault());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "play") pauseGame();
});
$("barkBtn").addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  initAudio();
  bark();
});
$("muteBtn").addEventListener("click", () => {
  initAudio();
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  $("muteBtn").classList.toggle("off", muted);
});

/* ============================== actions ============================== */
function bark() {
  if (state !== "play" || !dog || dog.barkCd > 0 || dog.stun > 0)
    return;
  dog.barkCd = BARK_CD;
  pulses.push({
    x: dog.x,
    y: dog.y,
    r: 12,
    sp: 430,
    max: 180,
    hit: new Set(),
  });
  sfx.bark();
  texts.push({
    x: dog.x,
    y: dog.y - 24,
    txt: "WOOF!",
    t: 0.9,
    T: 0.9,
    col: "#fff1c4",
    small: false,
  });
  for (const w of wolves) {
    if (w.mode === "stalk" && dist(w.x, w.y, dog.x, dog.y) < 260)
      scareWolf(w);
  }
  if (ram && ram.cd <= 0 && dist(ram.x, ram.y, dog.x, dog.y) < 200)
    startCharge(dog.x, dog.y);
}
function startCharge(tx, ty) {
  if (!ram) return;
  const d = dist(ram.x, ram.y, tx, ty) || 1;
  ram.vx = ((tx - ram.x) / d) * 340;
  ram.vy = ((ty - ram.y) / d) * 340;
  ram.mode = "charge";
  ram.ct = 0.62;
  sfx.charge();
  texts.push({
    x: ram.x,
    y: ram.y - 30,
    txt: "!",
    t: 0.7,
    T: 0.7,
    col: "#ff6b6b",
    small: false,
  });
}
function scareWolf(w) {
  if (w.flee > 0) return;
  w.flee = rnd(3.5, 5);
  const dx = w.x - dog.x,
    dy = w.y - dog.y,
    d = Math.hypot(dx, dy) || 1;
  w.vx = (dx / d) * 240;
  w.vy = (dy / d) * 240;
  sfx.growl();
  texts.push({
    x: w.x,
    y: w.y - 22,
    txt: "yipe!",
    t: 0.8,
    T: 0.8,
    col: "#c9cdd6",
    small: true,
  });
}
function puff(x, y) {
  return {
    kind: "puff",
    x,
    y,
    vx: rnd(-12, 12),
    vy: rnd(-16, -4),
    t: rnd(0.4, 0.8),
    T: 0.8,
    r: rnd(3, 6),
  };
}
function heart(x, y) {
  return {
    kind: "heart",
    x,
    y,
    vx: rnd(-10, 10),
    vy: rnd(-42, -26),
    t: 0.9,
    T: 0.9,
    r: rnd(3.5, 5.5),
  };
}
function woolPuff(x, y) {
  return {
    kind: "wool",
    x,
    y,
    vx: rnd(-60, 60),
    vy: rnd(-70, 10),
    t: 0.7,
    T: 0.7,
    r: rnd(2, 4.5),
  };
}

/* ============================== update ============================== */
function update(dt) {
  timeLeft -= dt;
  const c = Math.ceil(timeLeft);
  if (c <= 10 && c > 0 && c !== lastTick) sfx.tick();
  lastTick = c;
  if (timeLeft <= 0) {
    failLevel("Time ran out with the flock still on the hill.");
    return;
  }
  updDog(dt);
  updPulses(dt);
  for (const s of sheep) if (!s.dead) updSheep(s, dt, false);
  if (ram) updRam(dt);
  for (const w of wolves) updWolf(w, dt);
  updParticles(dt);
  for (const cl of clouds) {
    cl.x += cl.v * dt;
    if (cl.x > W + 150) cl.x = -150;
  }
  shake = Math.max(0, shake - dt * 30);
  redFlash = Math.max(0, redFlash - dt * 1.6);

  const alive = aliveCount();
  if (alive === 0) {
    failLevel(
      "The wolf cleared the field. There is nothing left to pen.",
    );
    return;
  }
  if (pennedCount() === alive) clearLevel();
  updHUD();
}

function updDog(dt) {
  dog.barkCd = Math.max(0, dog.barkCd - dt);
  dog.px = dog.x;
  dog.py = dog.y;
  if (dog.stun > 0) {
    dog.stun -= dt;
  } else {
    const kd = keyDir();
    let sp = 268;
    for (const t of thistles) {
      if (dist(dog.x, dog.y, t.x, t.y) < t.r) {
        sp *= 0.45;
        break;
      }
    }
    let mx = 0,
      my = 0;
    if (kd.x || kd.y) {
      const l = Math.hypot(kd.x, kd.y);
      mx = kd.x / l;
      my = kd.y / l;
      dog.useTarget = false;
    } else if (dog.useTarget) {
      const dx = dog.tx - dog.x,
        dy = dog.ty - dog.y,
        d = Math.hypot(dx, dy);
      if (d > 8) {
        mx = dx / d;
        my = dy / d;
      }
    }
    dog.x += mx * sp * dt;
    dog.y += my * sp * dt;
    if (mx) dog.face = mx > 0 ? 1 : -1;
    if (mx || my) {
      dog.run += dt * 15;
      if (Math.random() < dt * 16)
        parts.push(puff(dog.x - dog.face * 10, dog.y + 6));
    }
  }
  dog.vx = (dog.x - dog.px) / Math.max(dt, 1e-4);
  dog.vy = (dog.y - dog.py) / Math.max(dt, 1e-4);
  dog.x = clamp(dog.x, 22, W - 22);
  dog.y = clamp(dog.y, 22, H - 22);
  for (const r of wallList) collideRect(dog, r, 11);
}

function updSheep(s, dt, amb) {
  s.bob += dt * (2 + Math.hypot(s.vx, s.vy) * 0.05);
  if (s.penned) {
    s.ht -= dt;
    if (s.ht <= 0) {
      s.ht = rnd(1.2, 3.2);
      s.hx = rnd(pen.x + 24, pen.x + pen.w - 24);
      s.hy = rnd(pen.y + 24, pen.y + pen.h - 24);
    }
    const dx = s.hx - s.x,
      dy = s.hy - s.y,
      d = Math.hypot(dx, dy);
    if (d > 4) {
      s.x += (dx / d) * 20 * dt;
      s.y += (dy / d) * 20 * dt;
    }
    s.vx = 0;
    s.vy = 0;
    s.dir = Math.cos(s.bob * 0.7) > 0 ? 1 : -1;
    return;
  }
  let fx = 0,
    fy = 0,
    n = 0,
    cx = 0,
    cy = 0,
    ax = 0,
    ay = 0;
  for (const o of sheep) {
    if (o === s || o.dead || o.penned) continue;
    const d = dist(s.x, s.y, o.x, o.y);
    if (d < 70 && d > 0.01) {
      n++;
      cx += o.x;
      cy += o.y;
      ax += o.vx;
      ay += o.vy;
      if (d < 26) {
        const k = (1 - d / 26) * 190;
        fx += ((s.x - o.x) / d) * k;
        fy += ((s.y - o.y) / d) * k;
      }
    }
  }
  if (n) {
    cx /= n;
    cy /= n;
    ax /= n;
    ay /= n;
    fx += (cx - s.x) * 0.3;
    fy += (cy - s.y) * 0.3;
    fx += ax * 0.25;
    fy += ay * 0.25;
  }
  let feared = false;
  if (!amb) {
    const scare = (sx, sy, R, F) => {
      const d = dist(s.x, s.y, sx, sy);
      if (d < R && d > 0.01) {
        const k = (1 - d / R) * F;
        fx += ((s.x - sx) / d) * k;
        fy += ((s.y - sy) / d) * k;
        feared = true;
      }
    };
    scare(
      dog.x + dog.vx * 0.3,
      dog.y + dog.vy * 0.3,
      130,
      1500
    );
    const dd = dist(s.x, s.y, dog.x, dog.y);
    if (dd < 230 && dd > 0.01) {
      const uk = (1 - dd / 230) * 420;
      fx += ((s.x - dog.x) / dd) * uk;
      fy += ((s.y - dog.y) / dd) * uk;
    }
    if (ram && ram.mode === "charge") scare(ram.x, ram.y, 110, 1400);
    for (const w of wolves)
      if (w.mode === "stalk") scare(w.x, w.y, 80, 1200);
  }
  s.na += rnd(-1, 1) * dt * 5;
  fx += Math.cos(s.na) * 30;
  fy += Math.sin(s.na) * 30;
  s.vx += fx * dt;
  s.vy += fy * dt;
  const f = Math.max(0, 1 - (s.panic > 0 ? 0.9 : 2.0) * dt);
  s.vx *= f;
  s.vy *= f;
  const max = feared ? 200 : s.panic > 0 ? 150 : 80;
  const spd = Math.hypot(s.vx, s.vy);
  if (spd > max) {
    s.vx = (s.vx / spd) * max;
    s.vy = (s.vy / spd) * max;
  }
  if (Math.abs(s.vx) > 2) s.dir = s.vx > 0 ? 1 : -1;
  if (feared) s.panic = 1.1;
  else s.panic = Math.max(0, s.panic - dt);
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  if (s.x < 20) {
    s.x = 20;
    s.vx = Math.abs(s.vx) * 0.5;
  }
  if (s.x > W - 20) {
    s.x = W - 20;
    s.vx = -Math.abs(s.vx) * 0.5;
  }
  if (s.y < 20) {
    s.y = 20;
    s.vy = Math.abs(s.vy) * 0.5;
  }
  if (s.y > H - 20) {
    s.y = H - 20;
    s.vy = -Math.abs(s.vy) * 0.5;
  }
  for (const r of wallList) collideRect(s, r, 9);
  if (!amb) {
    const inX = s.x > pen.x + 16 && s.x < pen.x + pen.w - 16;
    const inY = s.y > pen.y + 16 && s.y < pen.y + pen.h - 16;
    if (inX && inY) {
      s.inPen += dt;
      if (s.inPen > 0.35) penSheep(s);
    } else s.inPen = 0;
    if (s.panic > 0.5 && Math.random() < dt * 0.4) {
      texts.push({
        x: s.x,
        y: s.y - 18,
        txt: "baa!",
        t: 0.8,
        T: 0.8,
        col: "#fffdf7",
        small: true,
      });
      if (Math.random() < 0.35) sfx.bleat();
    }
  }
}

function updRam(dt) {
  ram.cd = Math.max(0, ram.cd - dt);
  if (ram.mode === "charge") {
    ram.ct -= dt;
    ram.x += ram.vx * dt;
    ram.y += ram.vy * dt;
    if (Math.random() < dt * 26) parts.push(puff(ram.x, ram.y + 8));
    if (dist(ram.x, ram.y, dog.x, dog.y) < 30 && dog.stun <= 0) {
      dog.stun = 1.1;
      shake = 8;
      sfx.thud();
      texts.push({
        x: dog.x,
        y: dog.y - 28,
        txt: "bonk!",
        t: 1,
        T: 1,
        col: "#ffd166",
        small: false,
      });
      ram.mode = "wander";
      ram.cd = 2.6;
    }
    if (ram.ct <= 0) {
      ram.mode = "wander";
      ram.cd = 2.2;
    }
  } else {
    ram.na += rnd(-1, 1) * dt * 2;
    ram.vx = Math.cos(ram.na) * 18;
    ram.vy = Math.sin(ram.na) * 18;
    ram.x += ram.vx * dt;
    ram.y += ram.vy * dt;
    if (ram.cd <= 0 && dist(ram.x, ram.y, dog.x, dog.y) < 120)
      startCharge(dog.x, dog.y);
  }
  ram.x = clamp(ram.x, 24, W - 24);
  ram.y = clamp(ram.y, 24, H - 24);
  for (const r of wallList) collideRect(ram, r, 13);
  collideRect(ram, penSolid, 14);
  if (Math.abs(ram.vx) > 1) ram.face = ram.vx > 0 ? 1 : -1;
}

function updWolf(w, dt) {
  if (w.mode === "wait") {
    w.wait -= dt;
    if (w.wait <= 0) {
      w.mode = "stalk";
      banner("A wolf slinks in!", "#ff8a8d");
      sfx.growl();
    }
    return;
  }
  if (w.flee > 0) {
    w.flee -= dt;
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    w.x = clamp(w.x, 18, W - 18);
    w.y = clamp(w.y, 18, H - 18);
    if (w.flee <= 0) {
      w.mode = "stalk";
      w.retarget = 0;
    }
    if (Math.abs(w.vx) > 1) w.face = w.vx > 0 ? 1 : -1;
    return;
  }
  w.retarget -= dt;
  if (w.retarget <= 0) {
    w.retarget = 0.4;
    let best = null,
      bd = 1e9;
    for (const s of sheep) {
      if (s.dead || s.penned) continue;
      const d = dist(w.x, w.y, s.x, s.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    w.target = best;
  }
  const t = w.target;
  if (t && !t.dead && !t.penned) {
    const d = dist(w.x, w.y, t.x, t.y) || 1;
    w.vx = ((t.x - w.x) / d) * 132;
    w.vy = ((t.y - w.y) / d) * 132;
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    if (d < 15) {
      w.eat += dt;
      if (w.eat > 0.7) wolfCatches(w, t);
    } else w.eat = Math.max(0, w.eat - dt * 2);
  } else {
    w.vx = 0;
    w.vy = 0;
  }
  if (dist(w.x, w.y, dog.x, dog.y) < 85) scareWolf(w);
  w.x = clamp(w.x, 18, W - 18);
  w.y = clamp(w.y, 18, H - 18);
  if (Math.abs(w.vx) > 1) w.face = w.vx > 0 ? 1 : -1;
}

function wolfCatches(w, t) {
  t.dead = true;
  w.eat = 0;
  score = Math.max(0, score - 200);
  sfx.growl();
  sfx.bleat();
  shake = 10;
  redFlash = 0.6;
  banner("The wolf got " + t.name + "!", "#ff8a8d");
  for (let i = 0; i < 9; i++) parts.push(woolPuff(t.x, t.y));
  w.flee = 4.5;
  const dx = w.x - dog.x,
    dy = w.y - dog.y,
    dd = Math.hypot(dx, dy) || 1;
  w.vx = (dx / dd) * 230;
  w.vy = (dy / dd) * 230;
  updHUD();
}

function updPulses(dt) {
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.r += p.sp * dt;
    for (const s of sheep) {
      if (s.dead || s.penned || p.hit.has(s)) continue;
      if (dist(p.x, p.y, s.x, s.y) <= p.r) {
        p.hit.add(s);
        const d = dist(p.x, p.y, s.x, s.y) || 1;
        s.vx += ((s.x - p.x) / d) * 520;
        s.vy += ((s.y - p.y) / d) * 430;
        s.panic = 1.5;
      }
    }
    if (p.r >= p.max) pulses.splice(i, 1);
  }
}

function updParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "wool") p.vy += 160 * dt;
    if (p.t <= 0) parts.splice(i, 1);
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.t -= dt;
    t.y -= 18 * dt;
    if (t.t <= 0) texts.splice(i, 1);
  }
}

function penSheep(s) {
  s.penned = true;
  s.inPen = 0;
  s.panic = 0;
  s.x = clamp(s.x, pen.x + 22, pen.x + pen.w - 22);
  s.y = clamp(s.y, pen.y + 22, pen.y + pen.h - 22);
  score += 100;
  sfx.pen();
  sfx.bleat();
  for (let i = 0; i < 6; i++)
    parts.push(heart(s.x + rnd(-8, 8), s.y - 12));
  updHUD();
}

/* ============================== flow ============================== */
function failLevel(reason) {
  state = "over";
  sfx.fail();
  showPanel(
    '<h1>The muster failed</h1><p class="tag">' +
      reason +
      "</p>" +
      '<p class="bigstat">Sheep penned <b>' +
      pennedCount() +
      "/" +
      aliveCount() +
      "</b> &middot; Score <b>" +
      score +
      "</b></p>" +
      '<button class="btn">Retry the field &nbsp;R</button><p class="fine">or press R / Enter</p>',
  );
  overlayAction = retryLevel;
}
function retryLevel() {
  score = scoreAtStart;
  initLevel(levelIdx);
  startPlay();
}
function clearLevel() {
  const bonus = Math.max(0, Math.ceil(timeLeft)) * 10;
  score += bonus;
  sfx.clear();
  banner("FIELD CLEAR", "#8dffbe");
  updHUD();
  if (levelIdx === LEVELS.length - 1) {
    winGame();
    return;
  }
  state = "clear";
  showPanel(
    '<h1>Field clear</h1><p class="tag">' +
      LEVELS[levelIdx].name +
      " &mdash; every sheep accounted for.</p>" +
      '<p class="bigstat">Time bonus <b>+' +
      bonus +
      "</b> &middot; Score <b>" +
      score +
      "</b></p>" +
      '<button class="btn">Next field &nbsp;Enter</button>',
  );
  overlayAction = nextLevel;
  autoTimer = setTimeout(() => {
    if (state === "clear") nextLevel();
  }, 3200);
}
function nextLevel() {
  clearTimeout(autoTimer);
  initLevel(levelIdx + 1);
  showIntro();
}
function winGame() {
  state = "won";
  let best = 0;
  try {
    best = Number(localStorage.getItem("muster-best")) || 0;
    if (score > best) {
      best = score;
      localStorage.setItem("muster-best", String(best));
    }
  } catch (e) {
    best = score;
  }
  const rank =
    score >= 6400
      ? "Champion Collie"
      : score >= 5400
        ? "Very Good Dog"
        : score >= 4200
          ? "Capable Farmhand"
          : "Enthusiastic Pup";
  showPanel(
    '<h1>Muster complete!</h1><p class="tag">Five fields. One very tired dog.</p>' +
      '<div class="rank">' +
      rank +
      "</div>" +
      '<p class="bigstat">Final score <b>' +
      score +
      "</b><br>Best <b>" +
      best +
      "</b></p>" +
      '<button class="btn">Play again &nbsp;R</button>',
  );
  overlayAction = playAgain;
}
function playAgain() {
  score = 0;
  initLevel(0);
  showIntro();
}
function showIntro() {
  state = "intro";
  const L = LEVELS[levelIdx];
  const hazards =
    (L.ram ? "a ram. " : "") +
    (L.wolves
      ? L.wolves + " wolf" + (L.wolves > 1 ? "es" : "") + "."
      : "no wolves.");
  showPanel(
    "<h1>Field " +
      (levelIdx + 1) +
      ": " +
      L.name +
      "</h1>" +
      '<p class="tag">' +
      L.blurb +
      "</p>" +
      '<p class="bigstat">' +
      L.sheep +
      " sheep &middot; " +
      L.time +
      "s &middot; " +
      hazards +
      "</p>" +
      '<button class="btn">Sound the whistle &nbsp;Enter</button>',
  );
  overlayAction = startPlay;
}
function startPlay() {
  hideOverlay();
  state = "play";
  banner(LEVELS[levelIdx].name, "#ffe9c9");
}
function showTitle() {
  state = "title";
  showPanel(
    '<h1>Muster!</h1><p class="tag">The flock has opinions. You have a whistle.</p>' +
      '<div class="howto">' +
      "<p><b>You are the dog.</b> Sheep drift away from you &mdash; slip behind the flock and steer it " +
      "into the pen before the timer runs out.</p>" +
      '<p><span class="k">mouse / touch</span> or <span class="k">WASD</span> <span class="k">arrows</span> to run' +
      ' &nbsp;&middot;&nbsp; <span class="k">space</span> / <span class="k">B</span> / the round button to ' +
      "<b>bark</b>. A bark scatters sheep, scares wolves&hellip; and enrages rams.</p>" +
      "<p>Mind the thistles. Pen <b>every</b> sheep. Five fields to a full muster.</p>" +
      '</div><button class="btn">Start the muster &nbsp;Enter</button>',
  );
  overlayAction = () => {
    score = 0;
    initLevel(0);
    showIntro();
  };
}
function pauseGame() {
  if (state !== "play") return;
  state = "paused";
  showPanel(
    '<h1>Paused</h1><p class="tag">The flock waits. Suspiciously.</p>' +
      '<button class="btn">Keep herding</button><p class="fine">any key resumes</p>',
  );
  overlayAction = resumeGame;
}
function resumeGame() {
  if (state !== "paused") return;
  hideOverlay();
  state = "play";
}
function overlayAdvance() {
  if (overlay.classList.contains("hide") || !overlayAction) return;
  const f = overlayAction;
  overlayAction = null;
  f();
}
function showPanel(html) {
  panel.innerHTML = html;
  overlay.classList.remove("hide");
  const b = panel.querySelector("button");
  if (b)
    b.addEventListener("click", () => {
      initAudio();
      overlayAdvance();
    });
}
function hideOverlay() {
  overlay.classList.add("hide");
  overlayAction = null;
}
let bannerTimer = null;
function banner(txt, col) {
  bannerEl.textContent = txt;
  bannerEl.style.color = col || "#ffd166";
  bannerEl.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(
    () => bannerEl.classList.remove("show"),
    1900,
  );
}
function updHUD() {
  lvlEl.textContent = levelIdx + 1 + "/" + LEVELS.length;
  pennedEl.textContent = pennedCount() + "/" + aliveCount();
  timeEl.textContent = String(Math.max(0, Math.ceil(timeLeft)));
  timeEl.classList.toggle("low", timeLeft <= 10 && state === "play");
  scoreEl.textContent = String(score);
}

/* ============================== drawing ============================== */
function ell(x, y, rx, ry, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}
function circ(x, y, r, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
function shadow(x, y, rx, ry) {
  ctx.fillStyle = "rgba(30,55,20,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}
function blob(x, y, s) {
  ctx.beginPath();
  ctx.ellipse(x, y, 46 * s, 16 * s, 0, 0, TAU);
  ctx.ellipse(x + 30 * s, y + 4 * s, 30 * s, 12 * s, 0, 0, TAU);
  ctx.ellipse(x - 30 * s, y + 5 * s, 26 * s, 11 * s, 0, 0, TAU);
  ctx.fill();
}
function drawClouds() {
  for (const cl of clouds) {
    ctx.fillStyle = "rgba(25,45,15,0.10)";
    blob(cl.x + 16, cl.y + 20, cl.s);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    blob(cl.x, cl.y, cl.s);
  }
}
function drawFlag() {
  const fx = pen.x + pen.w - 8,
    fy = pen.y + 8;
  ctx.strokeStyle = "#5f3d20";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx, fy - 34);
  ctx.stroke();
  const wv = Math.sin(clock * 4) * 3;
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.moveTo(fx, fy - 34);
  ctx.lineTo(fx + 22, fy - 28 + wv);
  ctx.lineTo(fx, fy - 21);
  ctx.closePath();
  ctx.fill();
}
function drawSheep(s) {
  const sp = Math.hypot(s.vx, s.vy);
  const trot = Math.min(1, sp / 60);
  const bob = s.penned
    ? Math.sin(s.bob * 2) * 0.5
    : -Math.abs(Math.sin(s.bob * 8)) * 2 * trot;
  ctx.save();
  ctx.translate(s.x, s.y + bob);
  if (s.penned) ctx.scale(1.04, 0.86);
  if (!s.penned) {
    const lo = Math.sin(s.bob * 10) * 3.2 * trot;
    ctx.fillStyle = "#423c4b";
    ctx.fillRect(-9 + lo, -2, 3, 7);
    ctx.fillRect(-4 - lo, -2, 3, 7);
    ctx.fillRect(3 - lo, -2, 3, 7);
    ctx.fillRect(8 + lo, -2, 3, 7);
  }
  ell(0, -7, 13, 9, "#f7f3ea");
  circ(-7, -12, 4.5, "#fffdf7");
  circ(0, -14, 5, "#fffdf7");
  circ(7, -12, 4.5, "#fffdf7");
  ell(-3, -3, 8, 3.6, "#efe9db");
  const hx = s.dir * 13;
  ell(hx, -9, 5.4, 4.7, "#2e2a33");
  ell(hx - s.dir * 2, -13.5, 3.4, 2, "#241f2b");
  if (s.penned) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(hx + s.dir * 1.5, -9.5, 2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else {
    circ(hx + s.dir * 2.4, -10, 1.3, s.panic > 0 ? "#ffd166" : "#fff");
  }
  ctx.restore();
}
function drawDog() {
  const sp = Math.hypot(dog.x - dog.px, dog.y - dog.py);
  const trot = Math.min(1, sp / 4);
  ctx.save();
  ctx.translate(dog.x, dog.y);
  ctx.scale(dog.face, 1);
  if (dog.stun > 0) ctx.rotate(Math.sin(clock * 18) * 0.14);
  ctx.strokeStyle = "#26242c";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-12, -8);
  ctx.quadraticCurveTo(
    -18,
    -12 + Math.sin(clock * 10) * 3,
    -19,
    -6 + Math.sin(clock * 10) * 4,
  );
  ctx.stroke();
  const lo = Math.sin(dog.run) * 3.5 * trot;
  ctx.fillStyle = "#26242c";
  ctx.fillRect(-9 + lo, -1, 3, 7);
  ctx.fillRect(-4 - lo, -1, 3, 7);
  ctx.fillRect(3 - lo, -1, 3, 7);
  ctx.fillRect(8 + lo, -1, 3, 7);
  ell(-1, -6, 13, 7.2, "#f4f2ee");
  ell(-3, -8, 8, 4.4, "#26242c");
  ell(4, -3, 7, 3.4, "#f4f2ee");
  circ(12, -11, 5.6, "#f4f2ee");
  ctx.fillStyle = "#26242c";
  ctx.beginPath();
  ctx.moveTo(9, -15);
  ctx.lineTo(12, -21);
  ctx.lineTo(14, -14);
  ctx.closePath();
  ctx.fill();
  ell(16.5, -10, 3.4, 2.6, "#26242c");
  circ(12.8, -11.8, 1.2, "#1a1820");
  ctx.strokeStyle = "#d64545";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(7, -14.5);
  ctx.lineTo(8, -8);
  ctx.stroke();
  ctx.restore();
  if (dog.stun > 0) {
    for (let i = 0; i < 3; i++) {
      const a = clock * 6 + (i / 3) * TAU;
      circ(
        dog.x + Math.cos(a) * 14,
        dog.y - 24 + Math.sin(a) * 5,
        2,
        "#ffd166",
      );
    }
  }
  if (dog.useTarget) {
    const d = dist(dog.x, dog.y, dog.tx, dog.ty);
    if (d > 14) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(dog.tx, dog.ty, 6 + Math.sin(clock * 6) * 1.5, 0, TAU);
      ctx.stroke();
    }
  }
}
function drawWolf(w) {
  ctx.save();
  ctx.translate(w.x, w.y);
  if (w.mode === "wait") ctx.globalAlpha = 0.45;
  ctx.scale(w.face || 1, 1);
  ctx.strokeStyle = "#565b66";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.quadraticCurveTo(-20, -10, -22, -4);
  ctx.stroke();
  const lo = Math.sin(clock * 14) * 3;
  ctx.fillStyle = "#4a4f59";
  ctx.fillRect(-10 + lo, -1, 3, 7);
  ctx.fillRect(-4 - lo, -1, 3, 7);
  ctx.fillRect(4 - lo, -1, 3, 7);
  ctx.fillRect(9 + lo, -1, 3, 7);
  ell(0, -7, 15, 7, "#6b7078");
  ell(0, -4, 13, 3.4, "#575c66");
  circ(14, -10, 5, "#6b7078");
  ctx.fillStyle = "#4a4f59";
  ctx.beginPath();
  ctx.moveTo(11, -14);
  ctx.lineTo(13, -19);
  ctx.lineTo(16, -13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#575c66";
  ctx.beginPath();
  ctx.moveTo(17, -11);
  ctx.lineTo(24, -8.5);
  ctx.lineTo(17, -6.5);
  ctx.closePath();
  ctx.fill();
  circ(15.4, -11.4, 1.3, w.flee > 0 ? "#ffe9b0" : "#ff5a5a");
  ctx.restore();
}
function drawRam() {
  ctx.save();
  ctx.translate(ram.x, ram.y);
  ctx.scale(ram.face || 1, 1);
  if (ram.mode === "charge") ctx.rotate(-0.08);
  const lo = Math.sin(clock * (ram.mode === "charge" ? 20 : 4)) * 2.5;
  ctx.fillStyle = "#5d5148";
  ctx.fillRect(-10 + lo, -1, 3.4, 8);
  ctx.fillRect(-4 - lo, -1, 3.4, 8);
  ctx.fillRect(4 - lo, -1, 3.4, 8);
  ctx.fillRect(9 + lo, -1, 3.4, 8);
  ell(0, -8, 16, 10.5, "#8d7b6b");
  ell(-2, -12, 9, 4.6, "#796753");
  circ(15, -9, 6, "#6b5a4c");
  ctx.strokeStyle = "#d9c9a8";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(12, -14, 5.5, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(13, -4, 5, Math.PI * 1.2, Math.PI * 2.4);
  ctx.stroke();
  circ(17.5, -10, 1.3, "#241f1a");
  ctx.restore();
  if (ram.mode === "charge") {
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ram.x - ram.face * (18 + i * 9), ram.y - 12 + i * 2);
      ctx.lineTo(ram.x - ram.face * (26 + i * 9), ram.y - 12 + i * 2);
      ctx.stroke();
    }
  }
}
function drawPulses() {
  for (const p of pulses) {
    const a = 1 - p.r / p.max;
    ctx.strokeStyle = "rgba(255,241,196," + (0.75 * a).toFixed(3) + ")";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,241,196," + (0.3 * a).toFixed(3) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.72, 0, TAU);
    ctx.stroke();
  }
}
function drawHeart(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 6, s / 6);
  ctx.fillStyle = "#ff7d92";
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.bezierCurveTo(-5, -2, -2.2, -6, 0, -3);
  ctx.bezierCurveTo(2.2, -6, 5, -2, 0, 3);
  ctx.fill();
  ctx.restore();
}
function drawParticles() {
  for (const p of parts) {
    const a = clamp(p.t / p.T, 0, 1);
    if (p.kind === "puff")
      circ(
        p.x,
        p.y,
        p.r * (0.6 + a * 0.6),
        "rgba(210,225,170," + (0.5 * a).toFixed(3) + ")",
      );
    else if (p.kind === "wool")
      circ(p.x, p.y, p.r, "rgba(250,248,240," + a.toFixed(3) + ")");
    else {
      ctx.globalAlpha = a;
      drawHeart(p.x, p.y, p.r);
      ctx.globalAlpha = 1;
    }
  }
}
function drawTexts() {
  ctx.textAlign = "center";
  for (const t of texts) {
    const a = clamp((t.t / t.T) * 1.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.font =
      (t.small ? "700 11px" : "800 15px") +
      ' ui-rounded,"Segoe UI",sans-serif';
    ctx.fillStyle = t.col;
    ctx.fillText(t.txt, t.x, t.y);
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#243d1c";
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.setTransform(
    view.s * dpr,
    0,
    0,
    view.s * dpr,
    view.ox * dpr,
    view.oy * dpr,
  );
  if (shake > 0)
    ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  drawClouds();
  drawFlag();
  for (const s of sheep) if (!s.dead) shadow(s.x, s.y + 7, 12, 4.5);
  if (ram) shadow(ram.x, ram.y + 8, 16, 5.5);
  for (const w of wolves)
    if (w.mode !== "wait") shadow(w.x, w.y + 7, 15, 5);
  if (dog) shadow(dog.x, dog.y + 7, 13, 4.5);
  for (const s of sheep) if (!s.dead) drawSheep(s);
  if (ram) drawRam();
  for (const w of wolves) drawWolf(w);
  if (dog) drawDog();
  drawPulses();
  drawParticles();
  drawTexts();
  if (redFlash > 0) {
    ctx.fillStyle =
      "rgba(255,60,60," + (redFlash * 0.25).toFixed(3) + ")";
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }
  barkFill.style.width =
    (dog ? (1 - dog.barkCd / BARK_CD) * 100 : 100) + "%";
}

/* ============================== ambient + loop ============================== */
function ambient(dt) {
  for (const cl of clouds) {
    cl.x += cl.v * dt;
    if (cl.x > W + 150) cl.x = -150;
  }
  for (const s of sheep) if (!s.dead) updSheep(s, dt, true);
  if (ram) {
    ram.na += rnd(-1, 1) * dt * 2;
    ram.vx = Math.cos(ram.na) * 14;
    ram.vy = Math.sin(ram.na) * 14;
    ram.x = clamp(ram.x + ram.vx * dt, 24, W - 24);
    ram.y = clamp(ram.y + ram.vy * dt, 24, H - 24);
    if (Math.abs(ram.vx) > 1) ram.face = ram.vx > 0 ? 1 : -1;
  }
  updParticles(dt);
}
let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  let dt = (ts - last) / 1000;
  last = ts;
  if (!(dt > 0)) dt = 0.016;
  if (dt > 0.05) dt = 0.05;
  clock += dt;
  shake = Math.max(0, shake - dt * 30);
  redFlash = Math.max(0, redFlash - dt * 1.6);
  if (state === "play") update(dt);
  else if (state !== "paused") ambient(dt);
  render();
}

/* ============================== debug handle (for tests) ============================== */
window.__muster = {
  state: () => state,
  level: () => levelIdx + 1,
  score: () => score,
  time: () => timeLeft,
  penned: pennedCount,
  alive: aliveCount,
  dog: () => ({ x: dog.x, y: dog.y }),
  sheepAt: (i) =>
    sheep[i]
      ? { x: sheep[i].x, y: sheep[i].y, penned: sheep[i].penned }
      : null,
  pulses: () => pulses.length,
  dev: {
    start: () => {
      score = 0;
      initLevel(0);
      startPlay();
    },
    jump: (n) => {
      initLevel(n);
      startPlay();
    },
    penAll: () => {
      for (const s of sheep) if (!s.dead && !s.penned) penSheep(s);
    },
    setTime: (t) => {
      timeLeft = t;
    },
    placeSheep: (i, x, y) => {
      const s = sheep[i];
      if (s && !s.dead && !s.penned) {
        s.x = x;
        s.y = y;
        s.vx = 0;
        s.vy = 0;
      }
    },
    wolfEat: () => {
      const w = wolves.find((x) => x.mode !== "wait");
      const t = sheep.find((s) => !s.dead && !s.penned);
      if (w && t) wolfCatches(w, t);
    },
  },
};

/* ============================== boot ============================== */
initLevel(0);
showTitle();
requestAnimationFrame(frame);
})();
