/* The Water Witcher — walk the rows, read the hazel rod, sink your bores. */
(() => {
  "use strict";

  // ---------------------------------------------------------------- constants
  const W = 960;
  const H = 600;
  const F = { x: 128, y: 96, w: 704, h: 484 }; // playfield rectangle
  const DRILL_COST = 3;
  const START_STAKE = 30;
  const CLEAR_BONUS = 6;
  const SPEED = 178;

  const FIELDS = [
    { quota: 40, name: "I · The Hop Garden" },
    { quota: 60, name: "II · The Long Row" },
    { quota: 80, name: "III · Orchard Close" },
    { quota: 100, name: "IV · The Brickfield" },
    { quota: 115, name: "V · The Home Meadow" },
  ];

  const PAD = { x: 899, y: 430, r: 38 }; // on-canvas drill pad

  // ---------------------------------------------------------------- dom
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const panel = document.getElementById("panel");

  // ---------------------------------------------------------------- state
  let mode = "title"; // title | play | paused | cleared | won | lost
  let fieldIdx = 0;
  let stake = START_STAKE;
  let totalLitres = 0;
  let drillsUsed = 0;
  let fieldGot = 0;

  let pools = [];
  let holes = [];
  let decor = [];
  let particles = [];
  let player = { x: 0, y: 0 };
  let facing = -Math.PI / 2;
  let walkPhase = 0;

  let sig = 0;
  let sigSmooth = 0;
  let tickAcc = 0;
  let nearest = null;

  let toastText = "";
  let toastT = 0;
  let padFlash = 0;
  let dampHint = 0;

  let muted = false;

  const keys = Object.create(null);
  let pointerId = -1;
  let pointerActive = false;
  let pointerX = 0;
  let pointerY = 0;

  // ---------------------------------------------------------------- helpers
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerpAngle(a, b, t) {
    const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + d * t;
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- audio
  let actx = null;
  let master = null;

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.5;
      master.connect(actx.destination);
    }
    if (actx.state === "suspended") actx.resume();
  }

  function tone(freq, dur, type, vol, slide, when) {
    if (muted || !actx) return;
    const t0 = actx.currentTime + (when || 0);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide)
      o.frequency.exponentialRampToValueAtTime(
        Math.max(40, freq + slide),
        t0 + dur,
      );
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  const sndTick = () =>
    tone(720 + 760 * sig, 0.03, "square", 0.035 + 0.075 * sig);
  const sndClick = () => tone(660, 0.05, "square", 0.07);
  const sndHit = () => {
    tone(520, 0.5, "sine", 0.28, -330);
    tone(1480, 0.4, "triangle", 0.12, -1050, 0.06);
  };
  const sndMiss = () => tone(130, 0.2, "sawtooth", 0.22, -70);
  const sndGate = () => {
    tone(523, 0.16, "triangle", 0.16);
    tone(659, 0.16, "triangle", 0.16, 0, 0.13);
    tone(784, 0.16, "triangle", 0.16, 0, 0.26);
    tone(1046, 0.34, "triangle", 0.18, 0, 0.39);
  };
  const sndLose = () => {
    tone(220, 0.5, "sine", 0.2, -80);
    tone(164, 0.7, "sine", 0.2, -60, 0.3);
  };

  function toggleMute() {
    muted = !muted;
    toast(muted ? "Sound off." : "Sound on.");
    if (mode === "paused") openPause();
  }

  // ---------------------------------------------------------------- fields
  function loadField(i) {
    fieldIdx = i;
    fieldGot = 0;
    pools = [];
    holes = [];
    particles = [];
    player = { x: F.x + F.w / 2, y: F.y + F.h - 52 };
    facing = -Math.PI / 2;
    walkPhase = 0;
    sig = 0;
    sigSmooth = 0;
    tickAcc = 0;
    dampHint = 0;

    const rnd = mulberry32(1013 + i * 7717);
    const count = 3 + Math.min(2, Math.floor(i / 2));
    let guard = 0;
    while (pools.length < count && guard++ < 500) {
      const depth = 1 + Math.floor(rnd() * 3);
      const r = 30 + i * 3 + rnd() * 26;
      const x = F.x + 64 + rnd() * (F.w - 128);
      const y = F.y + 64 + rnd() * (F.h - 128);
      let ok = true;
      for (const p of pools) {
        if (Math.hypot(x - p.x, y - p.y) < r + p.r + 72) ok = false;
      }
      if (!ok) continue;
      const litres = Math.round((r * r) / 230) + 5;
      pools.push({
        x,
        y,
        r,
        depth,
        litres,
        pay: litres + depth * 5,
        found: false,
        blob: Array.from({ length: 12 }, () => 0.82 + rnd() * 0.36),
      });
    }

    // make sure the field holds comfortably more water than its quota asks
    let guard2 = 0;
    let supply = pools.reduce((n, p) => n + p.litres, 0);
    while (supply < FIELDS[i].quota * 1.35 && guard2++ < 60) {
      const p = pools[Math.floor(rnd() * pools.length)];
      p.r += 5;
      p.litres = Math.round((p.r * p.r) / 230) + 5;
      p.pay = p.litres + p.depth * 5;
      supply = pools.reduce((n, q) => n + q.litres, 0);
    }

    // dry-season dressing: tufts, stones, cracks
    decor = [];
    for (let k = 0; k < 110; k++) {
      const x = F.x + 10 + rnd() * (F.w - 20);
      const y = F.y + 16 + rnd() * (F.h - 32);
      const v = rnd();
      decor.push({
        x,
        y,
        k: v < 0.42 ? "tuft" : v < 0.68 ? "stone" : "speck",
        s: 0.6 + rnd() * 1,
        a: rnd() * Math.PI,
      });
    }
    for (let c = 0; c < 8; c++) {
      const pts = [];
      let cx = F.x + 30 + rnd() * (F.w - 60);
      let cy = F.y + 30 + rnd() * (F.h - 60);
      let ang = rnd() * Math.PI * 2;
      const segs = 3 + Math.floor(rnd() * 4);
      for (let sgi = 0; sgi < segs; sgi++) {
        pts.push({ x: cx, y: cy });
        ang += (rnd() - 0.5) * 1.4;
        cx += Math.cos(ang) * (16 + rnd() * 22);
        cy += Math.sin(ang) * (10 + rnd() * 14);
      }
      decor.push({ k: "crack", pts });
    }
  }

  // ---------------------------------------------------------------- signal
  function computeSignal() {
    let s = 0;
    let best = null;
    let bestD = Infinity;
    for (const p of pools) {
      if (p.found) continue;
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      const dist = Math.hypot(dx, dy);
      const d = dist - p.r * 0.7;
      const gain = p.depth === 3 ? 0.5 : p.depth === 2 ? 0.72 : 1;
      const base = Math.pow(Math.max(0, 1 - Math.max(0, d) / 240), 1.4);
      let sp = gain * base;
      if (d < 0) sp += (1 - gain) * Math.min(1, -d / (p.r * 0.6));
      s += sp;
      if (dist < bestD) {
        bestD = dist;
        best = p;
      }
    }
    return { s: Math.min(1, s), best };
  }

  // ---------------------------------------------------------------- drilling
  function drill() {
    if (mode !== "play" || stake < DRILL_COST) return;
    padFlash = 0.18;
    stake -= DRILL_COST;
    drillsUsed++;
    let hit = null;
    for (const p of pools) {
      if (
        !p.found &&
        Math.hypot(player.x - p.x, player.y - p.y) <= p.r * 0.85
      ) {
        hit = p;
        break;
      }
    }
    holes.push({ x: player.x, y: player.y, hit: !!hit });
    if (hit) {
      hit.found = true;
      stake += hit.pay;
      totalLitres += hit.litres;
      fieldGot += hit.litres;
      for (let n = 0; n < 26; n++) {
        particles.push({
          x: player.x,
          y: player.y - 4,
          vx: (Math.random() - 0.5) * 90,
          vy: -170 - Math.random() * 110,
          t: 0,
          life: 1 + Math.random() * 0.6,
          c: "#6fc4dd",
          sz: 1.6 + Math.random() * 2,
        });
      }
      toast(`Wet! ${hit.litres} L raised — £${hit.pay} earned.`);
      sndHit();
      if (fieldGot >= FIELDS[fieldIdx].quota) fieldCleared();
      else if (stake < DRILL_COST) loseGame("spent");
    } else {
      for (let n = 0; n < 10; n++) {
        particles.push({
          x: player.x,
          y: player.y,
          vx: (Math.random() - 0.5) * 50,
          vy: -60 - Math.random() * 50,
          t: 0,
          life: 0.8 + Math.random() * 0.4,
          c: "#b39463",
          sz: 1.4 + Math.random() * 1.6,
        });
      }
      toast("Dry at forty feet. £3 gone with the dust.");
      sndMiss();
      if (stake < DRILL_COST) loseGame("broke");
    }
  }

  function fieldCleared() {
    stake += CLEAR_BONUS;
    sndGate();
    if (fieldIdx >= FIELDS.length - 1) {
      mode = "won";
      setPanel(winHtml());
      openOverlay();
    } else {
      mode = "cleared";
      setPanel(clearedHtml());
      openOverlay();
    }
  }

  function loseGame(why) {
    mode = "lost";
    sndLose();
    setPanel(lostHtml(why));
    openOverlay();
  }

  // ---------------------------------------------------------------- flow
  function startRun() {
    stake = START_STAKE;
    totalLitres = 0;
    drillsUsed = 0;
    loadField(0);
    mode = "play";
    closeOverlay();
    toast("Field I — bring up 40 litres.");
  }

  function togglePause() {
    if (mode === "play") openPause();
    else if (mode === "paused") resumePlay();
  }

  function resumePlay() {
    mode = "play";
    closeOverlay();
  }

  function openPause() {
    mode = "paused";
    setPanel(pauseHtml());
    openOverlay();
  }

  function openOverlay() {
    overlay.classList.remove("hidden");
  }

  function closeOverlay() {
    overlay.classList.add("hidden");
  }

  function setPanel(html) {
    panel.innerHTML = html;
  }

  function primaryAction() {
    if (mode === "title") startRun();
    else if (mode === "play") drill();
    else if (mode === "paused") resumePlay();
    else if (mode === "cleared") act("next");
    else if (mode === "won") act("again");
    else if (mode === "lost") act("retry");
  }

  function act(a) {
    if (a === "start" || a === "retry" || a === "again" || a === "restart-run")
      startRun();
    else if (a === "resume") resumePlay();
    else if (a === "next") {
      loadField(fieldIdx + 1);
      mode = "play";
      closeOverlay();
      toast(
        `${FIELDS[fieldIdx].name} — bring up ${FIELDS[fieldIdx].quota} litres.`,
      );
    } else if (a === "mute") toggleMute();
  }

  overlay.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    ensureAudio();
    sndClick();
    act(b.getAttribute("data-action"));
  });

  // ---------------------------------------------------------------- input
  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === " "
    ) {
      e.preventDefault();
    }
    ensureAudio();
    keys[k.length === 1 ? k.toLowerCase() : k] = true;
    if (k === " " || k === "Enter") primaryAction();
    else if (k === "p" || k === "P") togglePause();
    else if (k === "m" || k === "M") toggleMute();
    else if (k === "r" || k === "R") {
      if (mode !== "title") startRun();
    }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key;
    keys[k.length === 1 ? k.toLowerCase() : k] = false;
  });

  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * W) / rect.width,
      y: ((e.clientY - rect.top) * H) / rect.height,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (mode !== "play") return;
    const pt = toCanvas(e);
    if (Math.hypot(pt.x - PAD.x, pt.y - PAD.y) <= PAD.r + 8) {
      padFlash = 0.18;
      drill();
      return;
    }
    pointerId = e.pointerId;
    pointerActive = true;
    pointerX = pt.x;
    pointerY = pt.y;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerActive || e.pointerId !== pointerId) return;
    const pt = toCanvas(e);
    pointerX = pt.x;
    pointerY = pt.y;
  });

  function releasePointer(e) {
    if (e.pointerId === pointerId) {
      pointerActive = false;
      pointerId = -1;
    }
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "play") openPause();
  });

  // ---------------------------------------------------------------- update
  function update(dt) {
    let vx = 0;
    let vy = 0;
    if (keys["w"] || keys["ArrowUp"]) vy -= 1;
    if (keys["s"] || keys["ArrowDown"]) vy += 1;
    if (keys["a"] || keys["ArrowLeft"]) vx -= 1;
    if (keys["d"] || keys["ArrowRight"]) vx += 1;
    let len = Math.hypot(vx, vy);
    if (len > 0) {
      vx /= len;
      vy /= len;
    } else if (pointerActive) {
      const dx = pointerX - player.x;
      const dy = pointerY - player.y;
      const d = Math.hypot(dx, dy);
      if (d > 10) {
        vx = dx / d;
        vy = dy / d;
      }
    }
    if (vx !== 0 || vy !== 0) {
      player.x = clamp(player.x + vx * SPEED * dt, F.x + 16, F.x + F.w - 16);
      player.y = clamp(player.y + vy * SPEED * dt, F.y + 16, F.y + F.h - 16);
      facing = Math.atan2(vy, vx);
      walkPhase += dt * 10;
    }

    const info = computeSignal();
    sig = info.s;
    nearest = info.best;
    sigSmooth += (sig - sigSmooth) * Math.min(1, dt * 9);
    dampHint += ((sig > 0.86 ? 1 : 0) - dampHint) * Math.min(1, dt * 4);

    tickAcc += dt * (1.2 + sig * 13);
    while (tickAcc >= 1) {
      tickAcc -= 1;
      if (sig > 0.05) sndTick();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += 430 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    if (toastT > 0) toastT -= dt;
    if (padFlash > 0) padFlash -= dt;
  }

  function toast(text) {
    toastText = text;
    toastT = 2.6;
  }

  // ---------------------------------------------------------------- render
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#191310";
    ctx.fillRect(0, 0, W, H);

    drawSoil();
    drawCracks();
    drawDecor();
    drawPools();
    drawHoles();
    drawParticles();
    drawPlayer();

    // damp patch when the rod is nearly screaming
    if (dampHint > 0.02 && mode === "play") {
      ctx.fillStyle = `rgba(38,84,102,${0.22 * dampHint})`;
      ctx.beginPath();
      ctx.ellipse(
        player.x,
        player.y + 8,
        15 + 8 * dampHint,
        8 + 4 * dampHint,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    drawFrame();
    drawRail();
    drawHud();
    drawToast();
  }

  function drawSoil() {
    ctx.fillStyle = "#96754a";
    ctx.fillRect(F.x, F.y, F.w, F.h);
    for (let y = F.y + 10; y < F.y + F.h; y += 22) {
      ctx.fillStyle = "rgba(56,38,18,0.09)";
      ctx.fillRect(F.x, y, F.w, 9);
    }
    // scorch toward the fence line
    const g = ctx.createLinearGradient(0, F.y, 0, F.y + F.h);
    g.addColorStop(0, "rgba(214,180,120,0.12)");
    g.addColorStop(0.5, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(40,24,8,0.16)");
    ctx.fillStyle = g;
    ctx.fillRect(F.x, F.y, F.w, F.h);
  }

  function drawCracks() {
    ctx.strokeStyle = "rgba(59,40,19,0.5)";
    ctx.lineWidth = 1.4;
    for (const d of decor) {
      if (d.k !== "crack") continue;
      ctx.beginPath();
      ctx.moveTo(d.pts[0].x, d.pts[0].y);
      for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i].x, d.pts[i].y);
      ctx.stroke();
    }
  }

  function drawDecor() {
    for (const d of decor) {
      if (d.k === "tuft") {
        ctx.strokeStyle = "rgba(146,132,66,0.85)";
        ctx.lineWidth = 1.4 * d.s;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(
            d.x + i * 4 * d.s + Math.cos(d.a) * 2,
            d.y - 7 * d.s - (i === 0 ? 3 : 0),
          );
          ctx.stroke();
        }
      } else if (d.k === "stone") {
        ctx.fillStyle = "rgba(126,112,92,0.9)";
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 4 * d.s, 2.6 * d.s, d.a, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(210,196,168,0.5)";
        ctx.beginPath();
        ctx.ellipse(d.x - 1, d.y - 1, 1.8 * d.s, 1 * d.s, d.a, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(70,50,26,0.35)";
        ctx.fillRect(d.x, d.y, 2.4 * d.s, 1.6 * d.s);
      }
    }
  }

  function drawPools() {
    for (const p of pools) {
      if (!p.found) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = (i % 12) * ((Math.PI * 2) / 12);
        const rr2 = p.r * p.blob[i % 12];
        const px = Math.cos(a) * rr2;
        const py = Math.sin(a) * rr2 * 0.82;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#2e6e84";
      ctx.fill();
      ctx.strokeStyle = "#1d4a5a";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "rgba(190,232,244,0.35)";
      ctx.beginPath();
      ctx.ellipse(
        -p.r * 0.25,
        -p.r * 0.28,
        p.r * 0.42,
        p.r * 0.2,
        -0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 500);
      ctx.strokeStyle = `rgba(140,214,236,${0.25 + 0.25 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        p.r + 6 + pulse * 4,
        (p.r + 6 + pulse * 4) * 0.82,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawHoles() {
    for (const h of holes) {
      ctx.fillStyle = "#2a1c0e";
      ctx.beginPath();
      ctx.ellipse(h.x, h.y, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // derrick tripod
      ctx.strokeStyle = "#4c381f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(h.x - 8, h.y + 6);
      ctx.lineTo(h.x, h.y - 16);
      ctx.moveTo(h.x + 8, h.y + 6);
      ctx.lineTo(h.x, h.y - 16);
      ctx.moveTo(h.x, h.y + 7);
      ctx.lineTo(h.x, h.y - 16);
      ctx.stroke();
      ctx.fillStyle = h.hit ? "#3f8ea6" : "#6b5636";
      ctx.beginPath();
      ctx.arc(h.x, h.y - 17, 3, 0, Math.PI * 2);
      ctx.fill();
      if (h.hit) {
        ctx.fillStyle = "rgba(46,110,132,0.4)";
        ctx.beginPath();
        ctx.ellipse(h.x, h.y + 3, 15, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(46,30,14,0.7)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(h.x - 12, h.y + 10);
        ctx.lineTo(h.x + 12, h.y + 16);
        ctx.moveTo(h.x + 12, h.y + 10);
        ctx.lineTo(h.x - 12, h.y + 16);
        ctx.stroke();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const bob = Math.sin(walkPhase) * 1.6;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(player.x, player.y + 13, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    const step = Math.sin(walkPhase) * 3.4;
    ctx.strokeStyle = "#33291c";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(player.x - 3, player.y + 4);
    ctx.lineTo(player.x - 3 + step, player.y + 12);
    ctx.moveTo(player.x + 3, player.y + 4);
    ctx.lineTo(player.x + 3 - step, player.y + 12);
    ctx.stroke();

    // coat
    ctx.fillStyle = "#46586a";
    rr(player.x - 7, player.y - 8 + bob * 0.3, 14, 15, 4);
    ctx.fill();

    // head + hat
    ctx.fillStyle = "#c9a07c";
    ctx.beginPath();
    ctx.arc(player.x, player.y - 13 + bob * 0.4, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5d452a";
    ctx.beginPath();
    ctx.ellipse(
      player.x,
      player.y - 16 + bob * 0.4,
      10,
      3.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(player.x, player.y - 18.5 + bob * 0.4, 5, 3.4, 0, Math.PI, 0);
    ctx.fill();

    // arms + hazel rod
    let rodAng = facing;
    if (nearest && sig > 0.45) {
      const target = Math.atan2(nearest.y - player.y, nearest.x - player.x);
      const blend = clamp((sig - 0.45) * 1.6, 0, 1);
      rodAng = lerpAngle(rodAng, target, blend * 0.65);
    }
    const hx = player.x + Math.cos(rodAng) * 11;
    const hy = player.y - 3 + bob * 0.3 + Math.sin(rodAng) * 11;
    const dip =
      (3 + 34 * sig) * (0.72 + 0.28 * Math.sin(performance.now() / 90));
    const fx = hx + Math.cos(rodAng) * 20;
    const fy = hy + Math.sin(rodAng) * 20 + dip * 0.45;
    const tx = hx + Math.cos(rodAng) * 34;
    const ty = hy + Math.sin(rodAng) * 34 + dip;
    ctx.strokeStyle = "#8a6a3c";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(fx, fy);
    const px = -Math.sin(rodAng);
    const py = Math.cos(rodAng);
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx + px * 5, ty + py * 5 + 2);
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx - px * 5, ty - py * 5 + 2);
    ctx.stroke();
    // brass tip bead
    ctx.fillStyle = sig > 0.75 ? "#e9c86a" : "#b99a5e";
    ctx.beginPath();
    ctx.arc(tx, ty + 2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (sig > 0.8) {
      ctx.strokeStyle = `rgba(233,200,106,${0.4 + 0.3 * Math.sin(performance.now() / 70)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(
        tx,
        ty + 2,
        6 + 3 * Math.sin(performance.now() / 120),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  function drawFrame() {
    ctx.strokeStyle = "#2b2016";
    ctx.lineWidth = 6;
    ctx.strokeRect(F.x - 3, F.y - 3, F.w + 6, F.h + 6);
    ctx.strokeStyle = "rgba(201,162,75,0.5)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(F.x + 2, F.y + 2, F.w - 4, F.h - 4);
  }

  function drawRail() {
    // leather side board
    ctx.fillStyle = "#211912";
    rr(846, F.y, 106, F.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,75,0.25)";
    ctx.lineWidth = 1;
    rr(846, F.y, 106, F.h, 8);
    ctx.stroke();

    // ROD meter
    const mx = 866;
    const my = F.y + 26;
    const mw = 30;
    const mh = 200;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    rr(mx, my, mw, mh, 6);
    ctx.fill();
    const fh = mh * sigSmooth;
    if (fh > 2) {
      const grad = ctx.createLinearGradient(0, my + mh - fh, 0, my + mh);
      grad.addColorStop(0, sigSmooth > 0.8 ? "#e9c86a" : "#6fc4dd");
      grad.addColorStop(1, "#2e6e84");
      ctx.fillStyle = grad;
      rr(mx + 3, my + mh - fh, mw - 6, fh, 4);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(239,227,196,0.4)";
    ctx.lineWidth = 1;
    rr(mx, my, mw, mh, 6);
    ctx.stroke();
    ctx.fillStyle = "rgba(239,227,196,0.5)";
    ctx.font = "11px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("ROD", mx + mw / 2, my + mh + 16);

    // drill pad
    const afford = stake >= DRILL_COST && mode === "play";
    const flash = padFlash > 0;
    ctx.beginPath();
    ctx.arc(PAD.x, PAD.y, PAD.r, 0, Math.PI * 2);
    ctx.fillStyle = afford ? (flash ? "#6fc4dd" : "#3f8ea6") : "#3a332a";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = afford ? "#e9c86a" : "rgba(239,227,196,0.25)";
    ctx.stroke();
    ctx.fillStyle = afford ? "#12232b" : "rgba(239,227,196,0.35)";
    ctx.font = "bold 14px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("DRILL", PAD.x, PAD.y - 4);
    ctx.font = "12px Georgia, serif";
    ctx.fillText("£3", PAD.x, PAD.y + 14);
    ctx.fillStyle = "rgba(239,227,196,0.55)";
    ctx.fillText(`bores sunk: ${drillsUsed}`, PAD.x, PAD.y + PAD.r + 20);

    // mute hint
    ctx.fillStyle = "rgba(239,227,196,0.4)";
    ctx.font = "italic 11px Georgia, serif";
    ctx.fillText(
      muted ? "sound off — M" : "sound on — M",
      PAD.x,
      F.y + F.h - 14,
    );
  }

  function drawHud() {
    ctx.textAlign = "left";
    ctx.fillStyle = "#e9c86a";
    ctx.font = "bold 17px Georgia, serif";
    ctx.fillText("THE WATER WITCHER", F.x, 34);
    ctx.fillStyle = "rgba(239,227,196,0.65)";
    ctx.font = "12px Georgia, serif";
    ctx.fillText(
      `${FIELDS[fieldIdx].name} — field ${fieldIdx + 1} of ${FIELDS.length}`,
      F.x,
      54,
    );

    ctx.textAlign = "center";
    ctx.fillStyle = "#efe3c4";
    ctx.font = "bold 21px Georgia, serif";
    ctx.fillText(`STAKE  £${stake}`, 480, 36);
    ctx.font = "12px Georgia, serif";
    ctx.fillStyle = "rgba(239,227,196,0.7)";
    ctx.fillText(
      `this field  ${fieldGot} / ${FIELDS[fieldIdx].quota} L`,
      480,
      56,
    );
    // quota bar
    const bx = 480 - 70;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    rr(bx, 62, 140, 7, 3);
    ctx.fill();
    const frac = clamp(fieldGot / FIELDS[fieldIdx].quota, 0, 1);
    if (frac > 0) {
      ctx.fillStyle = frac >= 1 ? "#e9c86a" : "#6fc4dd";
      rr(bx, 62, Math.max(6, 140 * frac), 7, 3);
      ctx.fill();
    }

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(239,227,196,0.75)";
    ctx.font = "12px Georgia, serif";
    ctx.fillText(`raised this season  ${totalLitres} L`, 832, 34);
    ctx.fillText(`gate opens at  ${FIELDS[fieldIdx].quota} L`, 832, 54);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(239,227,196,0.45)";
    ctx.font = "11px Georgia, serif";
    ctx.fillText(
      "SPACE drill · WASD / arrows walk · drag the field · P pause · M sound · R restart",
      F.x + 4,
      H - 10,
    );
  }

  function drawToast() {
    if (toastT <= 0) return;
    const a = clamp(toastT / 0.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.font = "italic 17px Georgia, serif";
    ctx.fillStyle = "rgba(12,9,6,0.65)";
    const tw = ctx.measureText(toastText).width + 28;
    rr(W / 2 - tw / 2, F.y + 14, tw, 30, 8);
    ctx.fill();
    ctx.fillStyle = "#efe3c4";
    ctx.fillText(toastText, W / 2, F.y + 34);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- panels
  function pauseHtml() {
    return `
      <h2>Held for breath</h2>
      <p class="stat">Field ${fieldIdx + 1} of ${FIELDS.length} — ${
        FIELDS[fieldIdx].name
      }</p>
      <p class="stat">Stake £${stake} · this field ${fieldGot}/${
        FIELDS[fieldIdx].quota
      } L · season ${totalLitres} L</p>
      <button type="button" data-action="resume">Back to the rows</button>
      <button type="button" data-action="mute">${muted ? "Sound off" : "Sound on"}</button>
      <button type="button" data-action="restart-run">Abandon season</button>
      <p class="keys">P resumes · M sound · R restart</p>`;
  }

  function clearedHtml() {
    return `
      <p class="kicker">The gate to the next field creaks open</p>
      <h2>${FIELDS[fieldIdx].name} — wet</h2>
      <p class="big">${fieldGot} L</p>
      <p class="stat">Miss Hedley advances you £${CLEAR_BONUS} against findings.</p>
      <p class="stat">Stake carried on: £${stake}</p>
      <button type="button" class="primary" data-action="next">Through the gate</button>
      <p class="keys">next: ${FIELDS[fieldIdx + 1].name} — ${
        FIELDS[fieldIdx + 1].quota
      } L wanted</p>`;
  }

  function winHtml() {
    const rank =
      totalLitres >= 500
        ? "Grand Witch of the Vale"
        : totalLitres >= 350
          ? "A Name in the Almanac"
          : "The Rod Remembered You";
    return `
      <p class="kicker">Five fields walked, five tanks ringing</p>
      <h2>The Farm Lives</h2>
      <p class="big">${totalLitres} L</p>
      <p class="stat">${drillsUsed} boreholes sunk · £${stake} left of the stake</p>
      <p class="stat"><b>Verdict: ${rank}</b></p>
      <button type="button" class="primary" data-action="again">Walk another season</button>
      <p class="keys">R restarts anytime</p>`;
  }

  function lostHtml(why) {
    const reason =
      why === "spent"
        ? "A dry hole took your last £3, and the tanks are still short."
        : "The stake cannot cover another borehole.";
    return `
      <p class="kicker">Field ${fieldIdx + 1}, quota unmet</p>
      <h2>The Stake Runs Dry</h2>
      <p class="lede">${reason} Miss Hedley pays the well-sinker instead and says
      nothing further, which is worse.</p>
      <p class="stat">Raised before the dust: ${totalLitres} L over ${
        fieldIdx + 1
      } field${fieldIdx ? "s" : ""}</p>
      <button type="button" class="primary" data-action="retry">Take up the rod again</button>
      <p class="keys">Space or Enter restarts</p>`;
  }

  // headless self-test hook — inert unless the page is opened with #autotest
  if (/autotest/.test(window.location.hash)) {
    window.__ww = {
      mode: () => mode,
      stats: () => ({ fieldIdx, stake, fieldGot, totalLitres, drillsUsed }),
      clearField: () => {
        fieldGot = FIELDS[fieldIdx].quota;
        fieldCleared();
      },
      broke: () => {
        stake = 0;
        loseGame("broke");
      },
      player: () => ({ x: player.x, y: player.y }),
      pools: () => pools.map((p) => ({ x: p.x, y: p.y, r: p.r })),
    };
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (mode === "play") update(dt);
    render();
    requestAnimationFrame(frame);
  }

  loadField(0);
  mode = "title";
  openOverlay();
  requestAnimationFrame(frame);
})();
