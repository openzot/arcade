/* High Panes - a window cleaner's last six panes before quitting time.
   Vanilla canvas game. All art drawn in code, all sound synthesised. */
(() => {
  "use strict";

  /* ---------- constants ---------- */

  const PANES_TOTAL = 6;
  const SHIFT_TIME = 175; // seconds on the shift clock
  const SHINE_TARGET = 0.93; // shine needed before you may ring
  const BUCKETS_MAX = 7; // bucket dips for the whole shift
  const SUDS_MAX = 100;
  const SUDS_COST_PER_PX = 0.008;
  const SUDS_IDLE_REGEN = 3.5; // the rubber slowly re-wets from the tray
  const SUDS_REGEN_CAP = 25;
  const DRY_EFF = 0.34; // how weak a dry wipe is
  const BLADE_R = 24; // wipe radius, css px
  const CELL = 13; // grime-grid cell size, css px

  const HINTS_IDLE = [
    "Long even strokes. Top corner to bottom.",
    "The blade sings when the rubber is wet.",
    "Mind the transom rail. Pigeons love it.",
    "The gaffer pays extra for a bone-dry finish.",
    "Six panes, then the pub.",
  ];

  /* ---------- dom ---------- */

  const $ = (id) => document.getElementById(id);
  const canvas = $("pane");
  const ctx = canvas.getContext("2d");
  const hud = {
    pay: $("pay"),
    panes: $("panes"),
    clock: $("clock"),
    suds: $("suds"),
    buckets: $("buckets"),
    hint: $("hintText"),
  };
  const bellBtn = $("bellBtn");
  const pauseBtn = $("pauseBtn");
  const muteBtn = $("muteBtn");
  const restartBtn = $("restartBtn");
  const overlay = $("overlay");
  const ovTitle = $("ovTitle");
  const ovTag = $("ovTag");
  const ovBody = $("ovBody");
  const ovBtn = $("ovBtn");

  /* ---------- audio ---------- */

  let ac = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensureAudio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
      const len = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      startWind();
    }
    if (ac.state === "suspended") ac.resume();
  }

  function startWind() {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const g = ac.createGain();
    g.gain.value = 0.028;
    src.connect(lp).connect(g).connect(master);
    src.start();
  }

  function env(g, t0, peak, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function burst(freq, q, peak, dur, type) {
    if (!ac) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type || "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    const g = ac.createGain();
    env(g, t, peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
    return f;
  }

  function tone(freq, peak, dur, type, slideTo) {
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ac.createGain();
    env(g, t, peak, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  let lastSqueak = 0;
  function squeak(intensity) {
    const now = performance.now();
    if (now - lastSqueak < 110) return;
    lastSqueak = now;
    const f = burst(900 + 900 * intensity, 9, 0.05 + 0.08 * intensity, 0.1);
    if (f && ac)
      f.frequency.linearRampToValueAtTime(
        1700 + 1300 * intensity,
        ac.currentTime + 0.09,
      );
  }

  const sndDing = () => {
    tone(1320, 0.22, 0.7);
    tone(1980, 0.08, 0.5);
  };
  const sndSplash = () => burst(700, 1.4, 0.16, 0.28, "lowpass");
  const sndCoo = () => tone(400, 0.06, 0.32, "sine", 290);
  const sndSplat = () => {
    tone(150, 0.12, 0.13, "triangle", 90);
    burst(2400, 1, 0.05, 0.08, "highpass");
  };
  const sndTick = () => tone(880, 0.045, 0.04, "square");
  const sndWhoosh = () => {
    const f = burst(2200, 2, 0.1, 0.5);
    if (f && ac)
      f.frequency.exponentialRampToValueAtTime(300, ac.currentTime + 0.45);
  };
  const sndFanfare = () => {
    [880, 1108, 1318, 1760].forEach((fq, i) =>
      setTimeout(() => tone(fq, 0.16, 0.45), i * 130),
    );
  };
  const sndSad = () => {
    tone(330, 0.14, 0.4, "triangle");
    setTimeout(() => tone(233, 0.14, 0.7, "triangle"), 200);
  };

  /* ---------- state ---------- */

  let phase = "menu"; // menu | playing | paused | descend | won | lost
  let cw = 0,
    ch = 0,
    dpr = 1;

  let paneIndex = 0;
  let pay = 0;
  let grades = [];
  let buckets = BUCKETS_MAX;
  let suds = SUDS_MAX;
  let shiftLeft = SHIFT_TIME;

  let grid = null; // Float32Array dirt amounts
  let gc = 0,
    gr = 0; // grid cols/rows
  let dirtSum = 1;
  let scoreIdx = [];
  let shine = 0;
  let initDirt = 1; // total removable dirt when the pane was raised

  let gCan = null,
    gCtx = null; // grime layer

  let sCan = null,
    sCtx = null; // smear layer
  let bgCan = null,
    fgCan = null; // prerendered scenery & frame

  let wiping = false;
  let lastW = null; // last wipe point
  let cursor = { x: -99, y: -99, seen: false, bank: 0 };
  const keys = {};

  let descT = 0; // descend animation 0..1
  let fadeT = 0; // new-pane grime fade-in
  let lastTickSec = -1;

  let pigeon = null; // {x,y,vx,state,target,timer}
  let drops = []; // falling droppings
  let nextPigeonAt = 0;

  const sparkles = [];

  /* ---------- helpers ---------- */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeInOut = (t) =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* ---------- layers & scenery ---------- */

  function makeLayer(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const x = c.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [c, x];
  }

  function paintScenery() {
    let b, f;
    [bgCan, b] = makeLayer(cw, ch);
    [fgCan, f] = makeLayer(cw, ch);

    const sky = b.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, "#33456b");
    sky.addColorStop(0.55, "#7a4f6d");
    sky.addColorStop(0.82, "#c97b52");
    sky.addColorStop(1, "#e8a05c");
    b.fillStyle = sky;
    b.fillRect(0, 0, cw, ch);

    // low sun
    const sunY = ch * 0.86;
    const sun = b.createRadialGradient(
      cw * 0.72,
      sunY,
      4,
      cw * 0.72,
      sunY,
      ch * 0.35,
    );
    sun.addColorStop(0, "rgba(255,214,140,0.85)");
    sun.addColorStop(0.25, "rgba(255,190,120,0.25)");
    sun.addColorStop(1, "rgba(255,190,120,0)");
    b.fillStyle = sun;
    b.fillRect(0, 0, cw, ch);

    // clouds
    b.fillStyle = "rgba(255,235,215,0.13)";
    for (let i = 0; i < 7; i++) {
      const cx = rand(0, cw),
        cy = rand(ch * 0.08, ch * 0.5),
        s = rand(30, 90);
      b.beginPath();
      b.ellipse(cx, cy, s, s * 0.32, 0, 0, Math.PI * 2);
      b.ellipse(
        cx + s * 0.6,
        cy + s * 0.08,
        s * 0.6,
        s * 0.22,
        0,
        0,
        Math.PI * 2,
      );
      b.fill();
    }

    // distant skyline
    b.fillStyle = "#232c44";
    let bx = -10;
    while (bx < cw + 20) {
      const bw = rand(34, 90);
      const bh = rand(ch * 0.16, ch * 0.42);
      b.fillRect(bx, ch - bh, bw, bh);
      if (Math.random() < 0.7) {
        b.fillRect(bx + bw * 0.3, ch - bh - rand(8, 26), 3, 12); // aerial
      }
      bx += bw + rand(4, 14);
    }
    // lit windows
    b.fillStyle = "rgba(255,196,110,0.5)";
    for (let i = 0; i < 90; i++) {
      b.fillRect(rand(0, cw), rand(ch * 0.62, ch * 0.985), 2.4, 3.4);
    }
    // far birds
    b.strokeStyle = "rgba(20,24,36,0.65)";
    b.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const vx = rand(cw * 0.1, cw * 0.9),
        vy = rand(ch * 0.12, ch * 0.3),
        s = rand(4, 7);
      b.beginPath();
      b.moveTo(vx - s, vy);
      b.quadraticCurveTo(vx - s * 0.4, vy - s * 0.55, vx, vy);
      b.quadraticCurveTo(vx + s * 0.4, vy - s * 0.55, vx + s, vy);
      b.stroke();
    }

    // glass sheen bands
    b.save();
    b.globalAlpha = 0.05;
    b.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i++) {
      const off = cw * (0.12 + i * 0.3);
      b.beginPath();
      b.moveTo(off, ch);
      b.lineTo(off + cw * 0.16, 0);
      b.lineTo(off + cw * 0.16 + 60, 0);
      b.lineTo(off + 60, ch);
      b.closePath();
      b.fill();
    }
    b.restore();

    // frame: border + transom rail (pigeon perch)
    const FR = 16;
    f.fillStyle = "#3a2f26";
    f.strokeStyle = "#181310";
    f.lineWidth = 2;
    f.beginPath();
    f.rect(1, 1, cw - 2, ch - 2);
    f.lineWidth = FR * 2;
    f.stroke();
    f.fillStyle = "#4a3c30";
    f.fillRect(FR, ch - FR - 26, cw - FR * 2, 12); // transom
    f.fillStyle = "rgba(255,255,255,0.08)";
    f.fillRect(FR, ch - FR - 26, cw - FR * 2, 2.5);
    // corner bolts
    f.fillStyle = "#8a7458";
    [
      [FR * 0.6, FR * 0.6],
      [cw - FR * 0.6, FR * 0.6],
      [FR * 0.6, ch - FR * 0.6],
      [cw - FR * 0.6, ch - FR * 0.6],
    ].forEach(([px, py]) => {
      f.beginPath();
      f.arc(px, py, 3.2, 0, Math.PI * 2);
      f.fill();
    });
  }

  /* ---------- pane construction ---------- */

  function buildPane(k) {
    gc = Math.ceil(cw / CELL);
    gr = Math.ceil(ch / CELL);
    grid = new Float32Array(gc * gr);
    let g;
    [gCan, gCtx] = makeLayer(cw, ch);
    [sCan, sCtx] = makeLayer(cw, ch);

    // general film of dried-on city grime
    gCtx.fillStyle = "rgba(208,201,183,0.44)";
    gCtx.fillRect(0, 0, cw, ch);

    // old rain streaks
    gCtx.strokeStyle = "rgba(160,152,132,0.10)";
    gCtx.lineWidth = rand(2, 5);
    for (let i = 0; i < 14; i++) {
      const sx = rand(0, cw);
      gCtx.beginPath();
      gCtx.moveTo(sx, 0);
      gCtx.bezierCurveTo(
        sx + rand(-30, 30),
        ch * 0.4,
        sx + rand(-40, 40),
        ch * 0.7,
        sx + rand(-50, 50),
        ch,
      );
      gCtx.stroke();
    }

    // blotches: baked mud, ice-cream, rain spots...
    const n = 22 + k * 7;
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const r =
        rand(14, 52) * (1 + k * 0.06) * Math.min(1.4, Math.max(0.7, cw / 760));
      const x = rand(r, cw - r),
        y = rand(r, ch - r);
      blobs.push({ x, y, r });
      const grd = gCtx.createRadialGradient(x, y, r * 0.15, x, y, r);
      const hue = Math.random() < 0.5 ? "176,164,138" : "150,142,124";
      grd.addColorStop(0, `rgba(${hue},${rand(0.34, 0.55)})`);
      grd.addColorStop(1, `rgba(${hue},0)`);
      gCtx.fillStyle = grd;
      gCtx.beginPath();
      gCtx.arc(x, y, r, 0, Math.PI * 2);
      gCtx.fill();
    }
    // speckle
    for (let i = 0; i < 130; i++) {
      gCtx.fillStyle = `rgba(120,112,96,${rand(0.08, 0.2)})`;
      gCtx.beginPath();
      gCtx.arc(rand(0, cw), rand(0, ch), rand(0.7, 2.4), 0, Math.PI * 2);
      gCtx.fill();
    }

    // grid dirt values to match
    for (let gy = 0; gy < gr; gy++) {
      for (let gx = 0; gx < gc; gx++) {
        let v = 0.56;
        const cxp = (gx + 0.5) * CELL,
          cyp = (gy + 0.5) * CELL;
        for (const bl of blobs) {
          const d = Math.hypot(cxp - bl.x, cyp - bl.y);
          if (d < bl.r * 0.95) v += 0.4 * (1 - d / bl.r);
        }
        grid[gy * gc + gx] = clamp(v, 0, 1);
      }
    }
    computeScoreIdx();
    recomputeShine();

    drops.length = 0;
    pigeon = null;
    nextPigeonAt = performance.now() + rand(5000, 9000) - k * 500;
    sparkles.length = 0;
    suds = Math.min(SUDS_MAX, suds + 30); // a fresh pane deserves a rinse
  }
  function recomputeShine() {
    if (!scoreIdx.length || initDirt <= 0) {
      shine = 0;
      return;
    }
    dirtSum = 0;
    for (let i = 0; i < scoreIdx.length; i++) dirtSum += grid[scoreIdx[i]];
    shine = clamp(1 - dirtSum / initDirt, 0, 1);
  }

  // cells whose centres sit inside the visible glass (frame and rail hide
  // their grime, so they must not count against the shine)
  function computeScoreIdx() {
    const x0 = 20,
      y0 = 20,
      x1 = cw - 20,
      y1 = ch - 48;
    const list = [];
    for (let gy = 0; gy < gr; gy++) {
      for (let gx = 0; gx < gc; gx++) {
        const cxp = (gx + 0.5) * CELL,
          cyp = (gy + 0.5) * CELL;
        if (cxp >= x0 && cxp <= x1 && cyp >= y0 && cyp <= y1)
          list.push(gy * gc + gx);
      }
    }
    scoreIdx = list;
    initDirt = 0;
    for (let i = 0; i < list.length; i++) initDirt += grid[list[i]];
  }

  /* ---------- wiping ---------- */

  function carveStep(x, y, eff) {
    gCtx.save();
    gCtx.globalCompositeOperation = "destination-out";
    gCtx.globalAlpha = 0.55 + 0.45 * eff;
    gCtx.beginPath();
    gCtx.arc(x, y, BLADE_R, 0, Math.PI * 2);
    gCtx.fill();
    gCtx.restore();
    sCtx.save();
    sCtx.globalCompositeOperation = "destination-out";
    sCtx.beginPath();
    sCtx.arc(x, y, BLADE_R + 2, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.restore();

    const gx0 = Math.max(0, Math.floor((x - BLADE_R) / CELL));
    const gx1 = Math.min(gc - 1, Math.floor((x + BLADE_R) / CELL));
    const gy0 = Math.max(0, Math.floor((y - BLADE_R) / CELL));
    const gy1 = Math.min(gr - 1, Math.floor((y + BLADE_R) / CELL));
    let removed = 0;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cxp = (gx + 0.5) * CELL,
          cyp = (gy + 0.5) * CELL;
        if (Math.hypot(cxp - x, cyp - y) > BLADE_R + CELL * 0.4) continue;
        const idx = gy * gc + gx;
        const before = grid[idx];
        grid[idx] = Math.max(0, before * (1 - 1.2 * eff));
        removed += before - grid[idx];
      }
    }
    return removed;
  }

  function addSmear(x, y) {
    sCtx.save();
    sCtx.strokeStyle = "rgba(228,222,205,0.16)";
    sCtx.lineCap = "round";
    sCtx.lineWidth = BLADE_R * 1.25;
    sCtx.beginPath();
    sCtx.moveTo(x, y);
    sCtx.lineTo(x + rand(-3, 3), y + rand(-3, 3));
    sCtx.stroke();
    sCtx.restore();
  }

  function spawnSparkles(x, y, amount) {
    const n = clamp(Math.round(amount * 26), 0, 5);
    for (let i = 0; i < n && sparkles.length < 90; i++) {
      sparkles.push({
        x: x + rand(-BLADE_R, BLADE_R),
        y: y + rand(-BLADE_R, BLADE_R),
        life: rand(0.35, 0.8),
        age: 0,
        s: rand(2.5, 5.5),
        rot: rand(0, Math.PI),
      });
    }
  }

  function wipeSegment(ax, ay, bx, by) {
    const dx = bx - ax,
      dy = by - ay;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return;
    const steps = Math.max(1, Math.ceil(dist / 7));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + dx * t,
        y = ay + dy * t;
      suds = Math.max(0, suds - (dist / steps) * SUDS_COST_PER_PX);
      const eff = suds > 1 ? 1 : DRY_EFF;
      const removed = carveStep(x, y, eff);
      if (eff < 1 && Math.random() < 0.5) addSmear(x, y);
      if (removed > 0.02) spawnSparkles(x, y, removed);
      if (removed > 0.01) squeak(Math.min(1, dist / 40));
    }
    recomputeShine();
  }

  /* ---------- pigeon ---------- */

  function updatePigeon(now, dt) {
    if (paneIndex < 1 || phase !== "playing") return;
    if (!pigeon && now > nextPigeonAt) {
      pigeon = {
        x: Math.random() < 0.5 ? -24 : cw + 24,
        y: ch - 34,
        vx: 0,
        state: "walk",
        dir: Math.random() < 0.5 ? 1 : -1,
        target: rand(0.25, 0.75) * cw,
        dropIn: rand(1.6, 3.4),
        bob: 0,
      };
      sndCoo();
      setHint("A pigeon lands on your rail. Shoo it with a swipe!");
    }
    if (!pigeon) return;
    pigeon.bob += dt;
    if (pigeon.state === "walk") {
      pigeon.x += pigeon.dir * 34 * dt;
      if (
        (pigeon.dir === 1 && pigeon.x > pigeon.target) ||
        (pigeon.dir === -1 && pigeon.x < pigeon.target)
      ) {
        pigeon.dir *= -1;
        pigeon.target = clamp(
          pigeon.x + pigeon.dir * rand(60, 180),
          30,
          cw - 30,
        );
      }
      pigeon.dropIn -= dt;
      if (pigeon.dropIn <= 0) {
        drops.push({
          x: pigeon.x,
          y: pigeon.y - 6,
          vy: 30,
          ty: rand(ch * 0.15, ch * 0.62),
        });
        pigeon.dropIn = rand(2.2, 4.2);
      }
      if (
        wiping &&
        Math.abs(cursor.x - pigeon.x) < 70 &&
        Math.abs(cursor.y - pigeon.y) < 60
      ) {
        pigeon.state = "flee";
        pigeon.vx = pigeon.dir * 160;
        sndCoo();
      }
    } else {
      pigeon.x += pigeon.vx * dt;
      pigeon.y -= 130 * dt;
      if (pigeon.x < -40 || pigeon.x > cw + 40) {
        pigeon = null;
        nextPigeonAt = performance.now() + rand(9000, 15000) - paneIndex * 700;
        setHint("Off you go. Where were we?");
      }
    }
  }

  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.vy += 420 * dt;
      d.y += d.vy * dt;
      if (d.y >= d.ty) {
        drops.splice(i, 1);
        splatGrime(d.x, d.y);
        sndSplat();
      }
    }
  }

  function splatGrime(x, y) {
    const r = rand(9, 17);
    const grd = gCtx.createRadialGradient(x, y, 1, x, y, r);
    grd.addColorStop(0, "rgba(240,238,225,0.85)");
    grd.addColorStop(0.7, "rgba(225,220,200,0.5)");
    grd.addColorStop(1, "rgba(225,220,200,0)");
    gCtx.fillStyle = grd;
    gCtx.beginPath();
    gCtx.arc(x, y, r, 0, Math.PI * 2);
    gCtx.fill();
    const gx0 = Math.max(0, Math.floor((x - r) / CELL));
    const gx1 = Math.min(gc - 1, Math.floor((x + r) / CELL));
    const gy0 = Math.max(0, Math.floor((y - r) / CELL));
    const gy1 = Math.min(gr - 1, Math.floor((y + r) / CELL));
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const d = Math.hypot((gx + 0.5) * CELL - x, (gy + 0.5) * CELL - y);
        if (d < r) {
          const i = gy * gc + gx;
          grid[i] = clamp(grid[i] + 0.75 * (1 - d / r), 0, 1);
        }
      }
    recomputeShine();
    for (let i = 0; i < 5; i++)
      sparkles.push({
        x: x + rand(-r, r),
        y: y + rand(-r, r),
        life: rand(0.2, 0.4),
        age: 0,
        s: rand(1.5, 3),
        rot: rand(0, Math.PI),
        bad: true,
      });
  }

  /* ---------- drawing ---------- */

  function drawScene() {
    ctx.drawImage(bgCan, 0, 0, cw, ch);
  }

  function drawGrimeLayers(alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(sCan, 0, 0, cw, ch);
    ctx.drawImage(gCan, 0, 0, cw, ch);
    ctx.restore();
  }

  function drawSparkles(dt) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const sp = sparkles[i];
      sp.age += dt;
      if (sp.age >= sp.life) {
        sparkles.splice(i, 1);
        continue;
      }
      const k = 1 - sp.age / sp.life;
      ctx.globalAlpha = (sp.bad ? 0.9 : 0.75) * k;
      ctx.lineWidth = sp.bad ? 2.4 : 1.6;
      if (!sp.bad) ctx.strokeStyle = "#ffffff";
      else ctx.strokeStyle = "#f4efdd";
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.rot + sp.age * 2);
      const s = sp.s * (sp.bad ? 1 : 0.7 + 0.6 * k);
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.lineTo(s, 0);
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawPigeon() {
    if (!pigeon) return;
    const p = pigeon;
    const bobY = p.state === "walk" ? Math.sin(p.bob * 9) * 1.6 : 0;
    ctx.save();
    ctx.translate(p.x, p.y + bobY);
    ctx.scale(p.state === "flee" ? (p.vx > 0 ? 1 : -1) : p.dir, 1);
    ctx.fillStyle = "#5a6472";
    ctx.strokeStyle = "#39404c";
    ctx.lineWidth = 1.4;
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.arc(9, -7, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // beak + eye
    ctx.fillStyle = "#d99a3c";
    ctx.beginPath();
    ctx.moveTo(13, -7.5);
    ctx.lineTo(17.5, -6.2);
    ctx.lineTo(13, -5.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1a1e26";
    ctx.beginPath();
    ctx.arc(10, -7.8, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // wing
    ctx.fillStyle = "#49525f";
    const flap = p.state === "flee" ? Math.sin(p.bob * 30) * 6 : 0;
    ctx.beginPath();
    ctx.ellipse(
      -2,
      -2 + flap * 0.3,
      7,
      4 - Math.abs(flap) * 0.2,
      flap * 0.06,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // legs
    ctx.strokeStyle = "#b06a3a";
    ctx.beginPath();
    ctx.moveTo(-3, 7);
    ctx.lineTo(-3, 11);
    ctx.moveTo(3, 7);
    ctx.lineTo(3, 11);
    ctx.stroke();
    ctx.restore();
  }

  function drawDrops() {
    ctx.fillStyle = "#f2eee0";
    for (const d of drops) {
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 2.2, 4.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCursor() {
    if (phase !== "playing" || !cursor.seen) return;
    const x = cursor.x,
      y = cursor.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(clamp(cursor.bank, -0.5, 0.5));
    // handle
    ctx.strokeStyle = "#8a6a3c";
    ctx.lineCap = "round";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(26, -26);
    ctx.stroke();
    ctx.strokeStyle = "#5c4526";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(26, -26);
    ctx.lineTo(34, -34);
    ctx.stroke();
    // blade
    ctx.fillStyle = "#2b3038";
    ctx.fillRect(-30, -3, 60, 6);
    ctx.fillStyle = suds > 1 ? "#57b8c9" : "#8f8776"; // wet rubber glows blue
    ctx.fillRect(-30, 1, 60, 2.6);
    ctx.restore();
  }

  function drawCradleRig(descProgress) {
    // during descent the cradle with the washer slides into view
    const y = -ch * 0.2 + easeInOut(descProgress) * ch * 0.62;
    ctx.save();
    ctx.translate(cw / 2, y);
    ctx.strokeStyle = "#20242e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-46, -260);
    ctx.lineTo(-40, 0);
    ctx.moveTo(46, -260);
    ctx.lineTo(40, 0);
    ctx.stroke();
    // platform
    ctx.fillStyle = "#6b543a";
    ctx.fillRect(-52, 0, 104, 10);
    ctx.fillStyle = "#57432e";
    ctx.fillRect(-52, 10, 104, 4);
    // worker
    ctx.fillStyle = "#d94f30";
    ctx.beginPath();
    ctx.roundRect(-14, -34, 28, 34, 6);
    ctx.fill();
    ctx.fillStyle = "#e8b68f";
    ctx.beginPath();
    ctx.arc(0, -42, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d94f30";
    ctx.fillRect(-10, -52, 20, 7); // hard hat
    ctx.restore();
  }

  /* ---------- HUD & hints ---------- */

  let hintUntil = 0;

  function setHint(text, stickyMs) {
    hud.hint.textContent = text;
    hintUntil = stickyMs ? performance.now() + stickyMs : 0;
  }

  function fmtMoney(n) {
    return "£" + String(Math.round(n));
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function updateHud() {
    hud.pay.textContent = fmtMoney(pay);
    hud.panes.textContent = `${paneIndex + 1} / ${PANES_TOTAL}`;
    hud.clock.textContent = fmtClock(shiftLeft);
    hud.clock.classList.toggle("low", shiftLeft <= 20 && phase === "playing");
    hud.suds.style.transform = `scaleX(${suds / SUDS_MAX})`;
    hud.suds.style.background =
      suds > 1 ? "" : "linear-gradient(90deg,#8f8776,#b3ab97)";
    hud.buckets.textContent =
      "◆".repeat(buckets) + "◇".repeat(BUCKETS_MAX - buckets);
    bellBtn.hidden = !(phase === "playing" && shine >= SHINE_TARGET);
  }

  /* ---------- game flow ---------- */

  function newShift() {
    paneIndex = 0;
    pay = 0;
    grades = [];
    buckets = BUCKETS_MAX;
    suds = SUDS_MAX;
    shiftLeft = SHIFT_TIME;
    buildPane(0);
    phase = "playing";
    hideOverlay();
    setHint("Drag to wipe. Clear 93% shine, then Space rings the bell.", 5000);
    updateHud();
  }

  function ringBell() {
    if (phase !== "playing" || shine < SHINE_TARGET) return;
    const bonusShine = shine > 0.985 ? 3 : shine > 0.96 ? 2 : 0;
    const bonusSuds = suds > 55 ? 2 : suds > 25 ? 1 : 0;
    const earned = 4 + bonusShine + bonusSuds;
    pay += earned;
    grades.push(earned);
    sndDing();
    setTimeout(sndWhoosh, 350);
    setHint(`Pane signed off — ${fmtMoney(earned)} earned.`, 4000);
    phase = "descend";
    descT = 0;
    bellBtn.hidden = true;
    updateHud();
  }

  function finishShift() {
    phase = "won";
    sndFanfare();
    const rows = grades.map((g, i) => {
      const div = document.createElement("div");
      div.className = "grade-row";
      const l = document.createElement("span");
      l.textContent = `Pane ${i + 1}`;
      const r = document.createElement("span");
      r.textContent = fmtMoney(g);
      div.append(l, r);
      return div;
    });
    const total = document.createElement("div");
    total.className = "grade-row";
    const tl = document.createElement("strong");
    tl.textContent = "Envelope total";
    const tr = document.createElement("strong");
    tr.textContent = fmtMoney(pay);
    total.append(tl, tr);
    showOverlay(
      "SHIFT DONE",
      "The last pane gleams. The gaffer nods once.",
      [document.createTextNode("Six panes, signed off before the bell:")],
      [fragment(rows), total],
      "Another shift",
    );
  }

  function fragment(nodes) {
    const fr = document.createDocumentFragment();
    nodes.forEach((n) => n && fr.append(n));
    return fr;
  }

  function loseShift(reason) {
    phase = "lost";
    sndSad();
    showOverlay(
      "QUITTING TIME",
      reason,
      [
        document.createTextNode(
          `You cleared ${paneIndex} of ${PANES_TOTAL} panes and earned ${fmtMoney(pay)}. The bus won't wait.`,
        ),
      ],
      [],
      "Try another shift",
    );
  }

  function showOverlay(title, tag, bodyNodes, extraNodes, btnLabel) {
    ovTitle.textContent = title;
    ovTag.textContent = tag || "";
    ovBody.innerHTML = "";
    (bodyNodes || []).forEach((n) => n && ovBody.append(n));
    if (extraNodes && extraNodes.length) ovBody.append(...extraNodes);
    ovBtn.textContent = btnLabel;
    overlay.classList.remove("hidden");
  }

  function showMenu() {
    phase = "menu";
    ovTitle.textContent = "HIGH PANES";
    ovTag.textContent = "The city looks better from up here.";
    ovBody.innerHTML = `
      <p>You hang off a tower block in a swinging cradle with six filthy
      panes between you and quitting time.</p>
      <p><strong>Drag</strong> (or WASD / arrows) to work the squeegee and
      clear the grime. Wiping dry glass smears — dip the
      <strong>bucket</strong> (B) for fresh suds. Mind the pigeons.
      Reach <strong>93% shine</strong>, then press <strong>Space</strong> to
      ring the bell and drop to the next pane.</p>
      <p id="ovKeys">Space ring · B bucket · P pause · M sound · R restart</p>`;
    ovBtn.textContent = "Start the shift";
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function togglePause(force) {
    if (phase === "playing" || force === true) {
      if (phase !== "playing") return;
      phase = "paused";
      showOverlay(
        "TEA BREAK",
        "The cradle sways. Nothing dries while you're gone.",
        [
          document.createTextNode(
            "Press P or the button to climb back on the tools.",
          ),
        ],
        [],
        "Back to work",
      );
    } else if (phase === "paused") {
      phase = "playing";
      hideOverlay();
    }
  }

  function dipBucket() {
    if (phase !== "playing") return;
    if (buckets <= 0) {
      setHint("Bucket's empty. Make the suds last.", 2500);
      tone(200, 0.08, 0.15, "square");
      return;
    }
    buckets--;
    suds = SUDS_MAX;
    sndSplash();
    setHint("Fresh suds. That rubber will sing.", 2500);
    updateHud();
  }

  /* ---------- input ---------- */

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * cw, 0, cw),
      y: clamp(((e.clientY - r.top) / r.height) * ch, 0, ch),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (phase !== "playing") return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointer already gone - wiping still works without capture */
    }
    wiping = true;
    lastW = canvasPos(e);
    cursor.x = lastW.x;
    cursor.y = lastW.y;

    cursor.seen = true;
    wipeSegment(lastW.x, lastW.y, lastW.x + 0.01, lastW.y + 0.01);
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = canvasPos(e);
    cursor.bank = clamp((p.x - cursor.x) * 0.04, -0.5, 0.5);
    cursor.x = p.x;
    cursor.y = p.y;
    cursor.seen = true;
    if (wiping && phase === "playing") {
      wipeSegment(lastW.x, lastW.y, p.x, p.y);
      lastW = p;
    }
  });

  const stopWipe = () => {
    wiping = false;
  };
  canvas.addEventListener("pointerup", stopWipe);
  canvas.addEventListener("pointercancel", stopWipe);
  canvas.addEventListener("pointerleave", stopWipe);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const ARROW_ALIAS = {
    ArrowUp: "w",
    ArrowDown: "s",
    ArrowLeft: "a",
    ArrowRight: "d",
  };

  document.addEventListener("keydown", (e) => {
    const k = e.key;
    switch (k) {
      case " ":
      case "Enter":
        e.preventDefault();
        ensureAudio();
        if (phase === "menu" || phase === "won" || phase === "lost") newShift();
        else if (phase === "paused") togglePause();
        else if (phase === "playing") ringBell();
        break;
      case "b":
      case "B":
        ensureAudio();
        dipBucket();
        break;
      case "p":
      case "P":
      case "Escape":
        if (phase === "playing" || phase === "paused") togglePause();
        break;
      case "m":
      case "M":
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.5;
        muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
        break;
      case "r":
      case "R":
        ensureAudio();
        newShift();
        break;
      default:
        if (k.startsWith("Arrow")) {
          e.preventDefault();
          keys[ARROW_ALIAS[k]] = true;
        }
        keys[k] = true;
    }
  });

  document.addEventListener("keyup", (e) => {
    keys[e.key] = false;
    const alt = ARROW_ALIAS[e.key];
    if (alt) keys[alt] = false;
  });

  bellBtn.addEventListener("click", () => {
    ensureAudio();
    ringBell();
  });
  ovBtn.addEventListener("click", () => {
    ensureAudio();
    if (phase === "paused") togglePause();
    else newShift();
  });
  pauseBtn.addEventListener("click", () => togglePause());
  restartBtn.addEventListener("click", () => {
    ensureAudio();
    newShift();
  });
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "playing") togglePause(true);
  });

  /* ---------- resize ---------- */

  function resize() {
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(200, Math.round(r.width));
    const nh = Math.max(200, Math.round(r.height));
    if (nw === cw && nh === ch) return;
    cw = nw;
    ch = nh;
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintScenery();

    if (grid) {
      // stretch grime & smear layers onto the new size
      const [ng, ngx] = makeLayer(cw, ch);
      ngx.drawImage(gCan, 0, 0, cw, ch);
      gCan = ng;
      gCtx = ngx;
      const [ns, nsx] = makeLayer(cw, ch);
      nsx.drawImage(sCan, 0, 0, cw, ch);
      sCan = ns;
      sCtx = nsx;
      // remap the dirt grid
      const ncg = Math.ceil(cw / CELL),
        ncr = Math.ceil(ch / CELL);
      const ngd = new Float32Array(ncg * ncr);
      for (let y = 0; y < ncr; y++)
        for (let x = 0; x < ncg; x++) {
          const ox = Math.min(gc - 1, Math.floor((x * gc) / ncg));
          const oy = Math.min(gr - 1, Math.floor((y * gr) / ncr));
          ngd[y * ncg + x] = grid[oy * gc + ox];
        }
      grid = ngd;
      gc = ncg;
      gr = ncr;
      computeScoreIdx();
      recomputeShine();
    } else {
      const [g, gx] = makeLayer(cw, ch);
      gCan = g;
      gCtx = gx;
      const [s, sx] = makeLayer(cw, ch);
      sCan = s;
      sCtx = sx;
    }
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  /* ---------- main loop ---------- */

  let prevT = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - prevT) / 1000;
    prevT = now;
    if (dt > 0.06) dt = 0.06;

    if (phase === "playing") {
      // keyboard-driven squeegee
      let mx = 0,
        my = 0;
      if (keys.w || keys.ArrowUp) my -= 1;
      if (keys.s || keys.ArrowDown) my += 1;
      if (keys.a || keys.ArrowLeft) mx -= 1;
      if (keys.d || keys.ArrowRight) mx += 1;
      if (mx || my) {
        const l = Math.hypot(mx, my) || 1;
        const nx = clamp(cursor.x + (mx / l) * 520 * dt, 0, cw);
        const ny = clamp(cursor.y + (my / l) * 520 * dt, 0, ch);
        if (!cursor.seen) {
          cursor.x = cw / 2;
          cursor.y = ch / 2;
          cursor.seen = true;
          lastW = { x: cursor.x, y: cursor.y };
        }
        wipeSegment(cursor.x, cursor.y, nx, ny);
        cursor.bank = mx * 0.3;
        cursor.x = nx;
        cursor.y = ny;
        lastW = { x: nx, y: ny };
      }

      // shift clock
      const before = Math.ceil(shiftLeft);
      shiftLeft -= dt;
      const after = Math.ceil(shiftLeft);
      if (after !== before && after <= 10 && after > 0) sndTick();
      if (shiftLeft <= 0) {
        loseShift("The whistle went while you were still up here.");
      }

      // the rubber slowly re-wets from the tray, but never above a trickle
      if (!wiping && suds < SUDS_REGEN_CAP)
        suds = Math.min(SUDS_REGEN_CAP, suds + SUDS_IDLE_REGEN * dt);

      updatePigeon(now, dt);
      updateDrops(dt);

      // contextual hints
      if (now > hintUntil) {
        if (shine >= SHINE_TARGET)
          setHint(`${Math.round(shine * 100)}% shine — Space rings the bell.`);
        else if (suds < 8) setHint("Glass is drying out — B dips the bucket.");
        else
          setHint(
            HINTS_IDLE[Math.floor(now / 6000) % HINTS_IDLE.length] +
              ` (${Math.round(shine * 100)}%)`,
          );
      }
      updateHud();
    } else if (phase === "descend") {
      descT += dt / 1.15;
      if (descT >= 1) {
        paneIndex++;
        if (paneIndex >= PANES_TOTAL) {
          finishShift();
        } else {
          buildPane(paneIndex);
          phase = "playing";
          updateHud();
        }
      }
    }

    // ---- render ----
    ctx.clearRect(0, 0, cw, ch);
    const slide = phase === "descend" ? easeInOut(Math.min(1, descT)) : 0;
    ctx.save();
    ctx.translate(0, -slide * ch * 1.05);
    drawScene();
    drawGrimeLayers(1);
    drawDrops();
    drawPigeon();
    drawSparkles(dt);
    ctx.restore();

    if (fadeT > 0 && phase === "playing") {
      // settle-in veil for freshly raised panes: brief bright haze
      ctx.fillStyle = `rgba(240,236,224,${fadeT * 0.5})`;
      ctx.fillRect(0, 0, cw, ch);
      fadeT = Math.max(0, fadeT - dt * 2.2);
    }

    if (phase === "descend") {
      drawCradleRig(Math.min(1, descT));
    } else {
      drawCursor();
    }
  }

  /* ---------- boot ---------- */

  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
