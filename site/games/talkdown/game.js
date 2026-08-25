/* Talkdown — ground-controlled approach, 1963.
   Vector night flights onto the ILS and talk them down before the tanks run dry. */
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => Math.floor(rnd(a, b + 1));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const R2D = 180 / Math.PI;
  const D2R = Math.PI / 180;
  const brgTo = (ax, ay, bx, by) =>
    (Math.atan2(bx - ax, -(by - ay)) * R2D + 360) % 360;
  const dir = (h) => ({ x: Math.sin(h * D2R), y: -Math.cos(h * D2R) });
  const pad3 = (h) =>
    String(((Math.round(h) % 360) + 360) % 360).padStart(3, "0");
  const fmtT = (s) => {
    s = Math.max(0, s);
    return (
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(Math.floor(s % 60)).padStart(2, "0")
    );
  };
  const fmtAlt = (a) =>
    (Math.round(a / 100) * 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " FT";

  // ---------- dom ----------
  const cv = $("scope");
  const ctx = cv.getContext("2d");
  const intro = $("intro");
  const endOv = $("endOv");
  const endTitle = $("endTitle");
  const endStats = $("endStats");
  const readout = $("readout");
  const logEl = $("radiolog");
  const pausedTag = $("pausedTag");
  const landedEl = $("landedEl");
  const strikesEl = $("strikesEl");
  const scoreEl = $("scoreEl");
  const timeEl = $("timeEl");
  const upBtn = $("upBtn");
  const dnBtn = $("dnBtn");
  const pauseBtn = $("pauseBtn");
  const muteBtn = $("muteBtn");
  const restartBtn = $("restartBtn");

  // ---------- world constants ----------
  const R = 18; // scope radius, nautical miles
  const FX = 12.4; // field centre x
  const TX = FX - 1.2; // runway threshold x
  const GATE_WEST = -7;
  const GATE_EAST = TX - 5;
  const GOAL = 8;
  const MAXAIR = 6;
  const TURN = 34; // deg per second
  const VS = 430; // ft per second
  const GS = 340; // ft per nm on the glidepath
  const SEP_NM = 3;
  const SEP_FT = 900;
  const BOOM_NM = 0.85;
  const BOOM_FT = 280;
  const CRUISE = { VISCOUNT: 0.58, HERON: 0.52, AMBASSADOR: 0.66 };
  const TYPES = Object.keys(CRUISE);
  const PREFIX = [
    "SKUA",
    "HALCYON",
    "KESTREL",
    "TRIDENT",
    "MERLIN",
    "BRANT",
    "CORVO",
    "PETREL",
  ];
  const STATUS = {
    air: "VECTORING",
    ils: "ESTABLISHED ILS",
    go: "GO-AROUND",
    divert: "DIVERTING",
  };

  // ---------- game state ----------
  const G = {
    mode: "intro", // 'intro' | 'play'
    paused: false,
    muted: false,
    ended: false,
    planes: [],
    sel: null,
    nextId: 1,
    score: 0,
    landed: 0,
    diverted: 0,
    incidents: 0,
    time: 0,
    tNext: 0,
    wind: { x: 0, y: 0 },
    sweep: 0,
    marks: [], // tap pings
    wrecks: [],
    hudT: 0,
  };
  const pairCd = new Map();

  // ---------- canvas sizing ----------
  let W = 760;
  let scale = 1;
  let dpr = 1;
  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth || 760;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(W * dpr);
    scale = W / (2 * (R + 1));
  }
  window.addEventListener("resize", fit);

  // ---------- audio (all synthesised) ----------
  let AC = null;
  let master = null;
  function audio() {
    if (!AC) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      AC = new C();
      master = AC.createGain();
      master.gain.value = 0.4;
      master.connect(AC.destination);
    }
    if (AC.state === "suspended") AC.resume();
    return AC;
  }
  function tone(f0, f1, dur, type, vol, when) {
    if (!AC || G.muted) return;
    const t = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0)
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol || 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sndAck = () => {
    tone(760, 760, 0.06, "square", 0.09);
    tone(1140, 1140, 0.07, "square", 0.09, 0.07);
  };
  const sndSel = () => tone(1250, 1250, 0.05, "sine", 0.11);
  const sndWarn = () => {
    tone(230, 160, 0.28, "sawtooth", 0.15);
    tone(230, 160, 0.28, "sawtooth", 0.11, 0.3);
  };
  const sndLand = () => {
    tone(660, 660, 0.09, "sine", 0.13);
    tone(880, 880, 0.09, "sine", 0.13, 0.09);
    tone(1318, 1318, 0.18, "sine", 0.13, 0.18);
  };
  const sndSad = () => tone(420, 150, 0.5, "triangle", 0.15);
  const sndBoom = () => {
    tone(110, 40, 0.7, "sawtooth", 0.22);
    tone(70, 30, 0.9, "square", 0.18, 0.05);
  };

  // ---------- radio log ----------
  function log(msg, cls) {
    const li = document.createElement("li");
    li.textContent = msg;
    if (cls) li.className = cls;
    logEl.prepend(li);
    while (logEl.children.length > 4) logEl.lastChild.remove();
  }

  // ---------- aircraft ----------
  function spawn() {
    const type = TYPES[irnd(0, TYPES.length - 1)];
    let x = -14;
    let y = 12;
    for (let i = 0; i < 60; i++) {
      const a = rnd(0, Math.PI * 2);
      const rr = rnd(R - 3.5, R - 1);
      x = Math.cos(a) * rr;
      y = Math.sin(a) * rr;
      const nearCorridor = Math.abs(y) < 2.6 && x > GATE_WEST - 2;
      if (!nearCorridor && dist(x, y, FX, 0) > 6.5) break;
    }
    const tx = rnd(-6, 6);
    const ty = rnd(-8, 8);
    const hdg = brgTo(x, y, tx, ty);
    const p = {
      id: G.nextId++,
      cs: PREFIX[irnd(0, PREFIX.length - 1)] + " " + irnd(2, 39),
      type: type,
      spd: CRUISE[type],
      x: x,
      y: y,
      hdg: hdg,
      cmd: hdg,
      alt: [4000, 5000, 6000, 7000][irnd(0, 3)],
      alta: 0,
      fuel: Math.max(75, rnd(118, 168) - G.landed * 2.5),
      state: "air",
      trail: [],
      tt: 0,
      glow: 0,
      flash: 0,
      fade: 1,
      msgCd: 0,
      lowWarned: false,
      gone: false,
    };
    p.alta = p.alt;
    G.planes.push(p);
    log(
      p.cs + " checking in, " + fmtAlt(p.alt) + ", " + fmtT(p.fuel) + " fuel.",
    );
    return p;
  }

  function turn(p, dt) {
    let d = ((p.cmd - p.hdg + 540) % 360) - 180;
    const mx = TURN * dt;
    p.hdg = (((p.hdg + clamp(d, -mx, mx)) % 360) + 360) % 360;
  }

  function step(p, dt) {
    if (p.state === "divert") {
      turn(p, dt);
      const v = dir(p.hdg);
      p.x += v.x * p.spd * dt;
      p.y += v.y * p.spd * dt;
      p.alt = Math.min(9000, p.alt + VS * dt);
      p.fade -= dt * 0.35;
      return;
    }
    if (p.state === "ils") {
      p.cmd = clamp(90 - p.y * 16, 42, 138);
      turn(p, dt);
      p.spd += (0.5 - p.spd) * Math.min(1, dt * 0.8);
      const v = dir(p.hdg);
      p.x += v.x * p.spd * dt;
      p.y += v.y * p.spd * dt;
      const tgt = clamp((TX - p.x) * GS, 260, 9000);
      p.alt += clamp(tgt - p.alt, -VS * dt, VS * dt);
      p.fuel -= dt;
      if (p.x >= TX - 0.05) {
        if (Math.abs(p.y) <= 0.8 && p.alt <= 560) touchdown(p);
        else goAround(p);
      }
      return;
    }
    if (p.state === "go") {
      p.cmd = 270;
      turn(p, dt);
      p.alt = Math.min(4000, p.alt + VS * dt);
      const v = dir(p.hdg);
      p.x += v.x * p.spd * dt;
      p.y += v.y * p.spd * dt;
      if (p.x < 5) {
        p.state = "air";
        log(p.cs + " going around — back on your frequency.", "warn");
      }
      return;
    }
    // state 'air'
    turn(p, dt);
    const v = dir(p.hdg);
    p.x += v.x * p.spd * dt;
    p.y += v.y * p.spd * dt;
    p.alt += clamp(p.alta - p.alt, -VS * dt, VS * dt);
    p.fuel -= dt;
    if (p.fuel <= 30 && !p.lowWarned) {
      p.lowWarned = true;
      log(p.cs + " is getting low — requesting priority.", "warn");
    }
    if (p.fuel <= 0) {
      divert(p);
      return;
    }
    const rr = dist(p.x, p.y, 0, 0);
    if (rr > R - 0.6 && p.x * v.x + p.y * v.y > 0)
      p.cmd = brgTo(p.x, p.y, 0, 0);
    if (
      p.x > GATE_WEST &&
      p.x < GATE_EAST &&
      Math.abs(p.y) <= 1.1 &&
      p.alt <= 3600
    ) {
      let d = ((90 - p.hdg + 540) % 360) - 180;
      if (Math.abs(d) < 45) {
        p.state = "ils";
        log(p.cs + " established — cleared to land runway 09.", "good");
        sndAck();
      }
    }
  }

  function touchdown(p) {
    p.gone = true;
    G.landed++;
    G.score += 100 + Math.round(Math.max(0, p.fuel));
    log(p.cs + " down. Cabin lights on the wet concrete.", "good");
    sndLand();
    G.marks.push({ x: TX, y: p.y, t: 1.2 });
    hud();
    if (G.landed >= GOAL && !G.ended) finish(true, "SHIFT COMPLETE");
  }

  function goAround(p) {
    p.state = "go";
    p.alt = Math.max(p.alt, 600);
    p.spd = CRUISE[p.type];
    log(p.cs + " going around — not set up.", "warn");
  }

  function divert(p) {
    p.state = "divert";
    p.cmd = p.hdg;
    G.diverted++;
    log(p.cs + " is diverting — dry tanks.", "bad");
    sndSad();
    strike("");
  }

  function strike(msg) {
    if (G.ended) return;
    G.incidents++;
    if (msg) log("Alarm — " + msg + ".", "bad");
    sndWarn();
    hud();
    if (G.incidents >= 3) finish(false, "THREE STRIKES — RELIEVED");
  }

  function boom(a, b) {
    a.gone = true;
    b.gone = true;
    G.wrecks.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 999 });
    sndBoom();
    finish(false, "MIDAIR COLLISION");
  }

  function finish(win, title) {
    if (G.ended) return;
    G.ended = true;
    if (win && G.incidents === 0) G.score += 250;
    endTitle.textContent = title;
    endOv.classList.toggle("bad", !win);
    endStats.innerHTML =
      "<dt>flights down</dt><dd>" +
      G.landed +
      " of " +
      GOAL +
      "</dd><dt>diverted dry</dt><dd>" +
      G.diverted +
      "</dd><dt>separation strikes</dt><dd>" +
      G.incidents +
      " of 3</dd><dt>final score</dt><dd>" +
      G.score +
      "</dd>";
    endOv.classList.remove("hidden");
    hud();
  }

  // ---------- commands ----------
  function select(p) {
    G.sel = p;
    if (p) sndSel();
    hud();
  }
  function cmdHdg(p, h, phrase) {
    if (!p) return;
    if (p.state !== "air") {
      log("Unable — " + p.cs + " is engaged.", "warn");
      return;
    }
    p.cmd = ((Math.round(h) % 360) + 360) % 360;
    log(p.cs + ", " + (phrase || "turn heading " + pad3(p.cmd) + "."));
    sndAck();
  }
  function cmdAlt(p, steps) {
    if (!p) return;
    if (p.state !== "air") {
      log("Unable — " + p.cs + " is engaged.", "warn");
      return;
    }
    const na = clamp(p.alta + steps * 1000, 1000, 9000);
    if (na === p.alta) return;
    p.alta = na;
    log(
      p.cs +
        ", " +
        (na < p.alt ? "descend" : "climb") +
        " and maintain " +
        ((na / 1000) | 0) +
        ",000 feet.",
    );
    sndAck();
  }
  function cycle() {
    const list = G.planes.filter((p) => p.state !== "divert");
    if (!list.length) return;
    const i = list.indexOf(G.sel);
    select(list[(i + 1) % list.length]);
  }

  // ---------- update ----------
  function update(dt) {
    G.time += dt;
    G.sweep = (G.sweep + 120 * dt) % 360;
    for (const p of G.planes) {
      p.msgCd = Math.max(0, p.msgCd - dt);
      p.flash = Math.max(0, p.flash - dt);
      p.glow *= Math.exp(-1.6 * dt);
      const b = brgTo(0, 0, p.x, p.y);
      let d = b - G.sweep;
      d = ((d % 360) + 360) % 360;
      if (d < 6) p.glow = 1;
      const wMul = p.state === "ils" ? 0.35 : 1;
      p.x += G.wind.x * wMul * dt;
      p.y += G.wind.y * wMul * dt;
      p.tt += dt;
      if (p.tt > 0.22 && p.state !== "divert") {
        p.tt = 0;
        p.trail.push([p.x, p.y]);
        if (p.trail.length > 9) p.trail.shift();
      }
      step(p, dt);
    }
    for (let i = G.planes.length - 1; i >= 0; i--) {
      const p = G.planes[i];
      if (p.gone || (p.state === "divert" && p.fade <= 0)) {
        if (G.sel === p) select(null);
        G.planes.splice(i, 1);
      }
    }
    outer: for (let i = 0; i < G.planes.length; i++) {
      for (let j = i + 1; j < G.planes.length; j++) {
        const a = G.planes[i];
        const b2 = G.planes[j];
        if (a.state === "divert" || b2.state === "divert") continue;
        const dd = dist(a.x, a.y, b2.x, b2.y);
        const da = Math.abs(a.alt - b2.alt);
        if (dd < BOOM_NM && da < BOOM_FT) {
          boom(a, b2);
          break outer;
        }
        const key = a.id < b2.id ? a.id + "-" + b2.id : b2.id + "-" + a.id;
        const cd = pairCd.get(key) || 0;
        if (dd < SEP_NM && da < SEP_FT) {
          a.flash = Math.max(a.flash, 0.6);
          b2.flash = Math.max(b2.flash, 0.6);
          if (cd <= 0) {
            pairCd.set(key, 14);
            strike(a.cs + " and " + b2.cs + " have lost separation");
          }
        }
      }
    }
    for (const [k, v] of [...pairCd]) {
      const nv = v - dt;
      if (nv <= 0) pairCd.delete(k);
      else pairCd.set(k, nv);
    }
    if (
      !G.ended &&
      G.time >= G.tNext &&
      G.planes.filter((p) => p.state !== "divert").length < MAXAIR
    ) {
      spawn();
      G.tNext = G.time + clamp(33 - G.landed * 2, 17, 33) * rnd(0.85, 1.2);
    }
    G.hudT -= dt;
    if (G.hudT <= 0) {
      G.hudT = 0.15;
      hud();
    }
  }

  // ---------- rain (cosmetic) ----------
  const rain = [];
  for (let i = 0; i < 70; i++) {
    rain.push({
      u: Math.random(),
      v: Math.random(),
      l: 8 + Math.random() * 14,
      s: 0.25 + Math.random() * 0.35,
    });
  }

  // ---------- drawing ----------
  const sx = (x) => W / 2 + x * scale;
  const sy = (y) => W / 2 + y * scale;

  function drawBlock(p) {
    const px = sx(p.x);
    const py = sy(p.y);
    const flip = p.id % 2 === 0 ? 1 : -1;
    const ox = 11 * flip;
    const oy = -20;
    const l1 = p.cs;
    const l2 =
      fmtAlt(p.alt).replace(" FT", "") + "  " + fmtT(Math.max(0, p.fuel));
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    const w =
      Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 10;
    const h = 26;
    const bx = px + ox + (flip < 0 ? -w : 0);
    const by = py + oy;
    ctx.strokeStyle = "rgba(140,255,177,.35)";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + ox, by + h / 2);
    ctx.stroke();
    ctx.fillStyle =
      G.sel === p
        ? "rgba(140,255,177,.22)"
        : p.flash > 0
          ? "rgba(255,90,90,.25)"
          : "rgba(3,20,12,.62)";
    ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle =
      p.flash > 0
        ? "#ff6b6b"
        : G.sel === p
          ? "#eafff0"
          : "rgba(140,255,177,.3)";
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    ctx.fillStyle = p.flash > 0 ? "#ffb3b3" : "#bdf5cf";
    ctx.fillText(l1, bx + 5, by + 10);
    ctx.fillStyle = p.fuel < 30 && p.state === "air" ? "#ffc76a" : "#8fd6a6";
    ctx.fillText(l2, bx + 5, by + 21);
  }

  function draw(dtReal) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#03110a";
    ctx.fillRect(0, 0, W, W);
    const cx = W / 2;

    // range rings + crosshair
    ctx.strokeStyle = "rgba(120,255,170,.10)";
    ctx.lineWidth = 1;
    for (const rr of [4.5, 9, 13.5]) {
      ctx.beginPath();
      ctx.arc(cx, cx, rr * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(sx(-R), sy(0));
    ctx.lineTo(sx(R), sy(0));
    ctx.moveTo(sx(0), sy(-R));
    ctx.lineTo(sx(0), sy(R));
    ctx.stroke();

    // compass ticks
    ctx.fillStyle = "rgba(140,255,177,.45)";
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    for (let a = 0; a < 360; a += 30) {
      const v = dir(a);
      ctx.beginPath();
      ctx.moveTo(sx(v.x * R), sy(v.y * R));
      ctx.lineTo(sx(v.x * (R + 0.45)), sy(v.y * (R + 0.45)));
      ctx.stroke();
      if (a % 90 === 0) {
        const card = ["N", "E", "S", "W"][a / 90];
        ctx.fillText(card, sx(v.x * (R + 0.95)), sy(v.y * (R + 0.95)) + 3);
      }
    }
    ctx.textAlign = "left";

    // sweep
    for (let i = 0; i < 26; i++) {
      const a = (G.sweep - i * 1.5) * D2R;
      ctx.strokeStyle =
        "rgba(140,255,177," + (0.09 * (1 - i / 26)).toFixed(3) + ")";
      ctx.beginPath();
      ctx.moveTo(cx, cx);
      ctx.lineTo(cx + Math.sin(a) * R * scale, cx - Math.cos(a) * R * scale);
      ctx.stroke();
    }

    // approach corridor
    ctx.strokeStyle = "rgba(140,255,177,.4)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(sx(-16.2), sy(0));
    ctx.lineTo(sx(TX), sy(0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(sx(GATE_EAST), sy(-1.4));
    ctx.lineTo(sx(GATE_EAST), sy(1.4));
    ctx.stroke();
    ctx.fillStyle = "rgba(140,255,177,.55)";
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText("ILS FINAL RWY 09", sx(-14.5), sy(-1.8));

    // runway + field
    ctx.fillStyle = "#0b3f26";
    ctx.strokeStyle = "#8cffb1";
    ctx.fillRect(sx(FX), sy(0) - 0.13 * scale, 1.5 * scale, 0.26 * scale);
    ctx.strokeRect(sx(FX), sy(0) - 0.13 * scale, 1.5 * scale, 0.26 * scale);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = "rgba(140,255,177,.7)";
      ctx.fillRect(
        sx(TX + 0.08 + k * 0.16),
        sy(0) - 0.09 * scale,
        0.06 * scale,
        0.18 * scale,
      );
    }
    ctx.fillStyle = "rgba(140,255,177,.5)";
    ctx.fillText("FIELD", sx(FX), sy(0) + 0.75 * scale);

    // drift arrow
    const wl = Math.hypot(G.wind.x, G.wind.y);
    if (wl > 0) {
      const ux = G.wind.x / wl;
      const uy = G.wind.y / wl;
      const ax0 = 34;
      const ay0 = 34;
      ctx.strokeStyle = "rgba(160,220,190,.5)";
      ctx.beginPath();
      ctx.moveTo(ax0, ay0);
      ctx.lineTo(ax0 + ux * 22, ay0 + uy * 22);
      ctx.stroke();
      ctx.fillStyle = "rgba(160,220,190,.6)";
      ctx.fillText("DRIFT", ax0 - 6, ay0 + 34);
    }

    // trails
    for (const p of G.planes) {
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i];
        ctx.fillStyle =
          "rgba(140,255,177," +
          ((0.32 * (i + 1)) / p.trail.length).toFixed(3) +
          ")";
        ctx.fillRect(sx(t[0]) - 1.5, sy(t[1]) - 1.5, 3, 3);
      }
    }

    // tap marks
    for (let i = G.marks.length - 1; i >= 0; i--) {
      const m = G.marks[i];
      m.t -= dtReal;
      if (m.t <= 0) {
        G.marks.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = "rgba(234,255,240," + (m.t / 1.2).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(sx(m.x), sy(m.y), (1.2 - m.t) * 14 + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // wrecks
    for (const wk of G.wrecks) {
      ctx.strokeStyle = "#ff6b6b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx(wk.x) - 7, sy(wk.y) - 7);
      ctx.lineTo(sx(wk.x) + 7, sy(wk.y) + 7);
      ctx.moveTo(sx(wk.x) + 7, sy(wk.y) - 7);
      ctx.lineTo(sx(wk.x) - 7, sy(wk.y) + 7);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = "#ff6b6b";
      ctx.fillText("MIDAIR", sx(wk.x) + 10, sy(wk.y) - 8);
    }

    // aircraft
    for (const p of G.planes) {
      const px = sx(p.x);
      const py = sy(p.y);
      const alpha = 0.4 + 0.6 * p.glow;
      ctx.globalAlpha = p.state === "divert" ? Math.max(0.15, p.fade) : 1;
      if (G.sel === p) {
        ctx.strokeStyle = "#eafff0";
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const c = dir(p.cmd);
        ctx.beginPath();
        ctx.moveTo(px + c.x * 12, py + c.y * 12);
        ctx.lineTo(px + c.x * 24, py + c.y * 24);
        ctx.stroke();
      }
      ctx.fillStyle =
        p.flash > 0 ? "#ff8080" : "rgba(140,255,177," + alpha.toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(px, py, 3.4, 0, Math.PI * 2);
      ctx.fill();
      drawBlock(p);
      ctx.globalAlpha = 1;
    }

    // rain on the glass
    if (G.mode === "play" && !G.paused && !G.ended) {
      for (const d of rain) {
        d.v += d.s * dtReal;
        if (d.v > 1.05) {
          d.v = -0.05;
          d.u = Math.random();
        }
      }
    }
    ctx.strokeStyle = "rgba(170,215,235,.07)";
    ctx.beginPath();
    for (const d of rain) {
      ctx.moveTo(d.u * W, d.v * W);
      ctx.lineTo(d.u * W - 3, d.v * W + d.l);
    }
    ctx.stroke();
  }

  // ---------- hud ----------
  function hud() {
    landedEl.textContent = G.landed + "/" + GOAL;
    strikesEl.textContent =
      "●".repeat(G.incidents) + "○".repeat(Math.max(0, 3 - G.incidents));
    scoreEl.textContent = String(G.score);
    timeEl.textContent = fmtT(G.time);
    const p = G.sel;
    const free = !!p && p.state === "air";
    upBtn.disabled = !free;
    dnBtn.disabled = !free;
    if (!p) {
      readout.innerHTML =
        '<span class="dim">no flight selected — tap a blip</span>';
      return;
    }
    readout.innerHTML =
      '<span class="big">' +
      p.cs +
      "</span><span>" +
      p.type +
      "</span><span>HDG <strong>" +
      pad3(p.hdg) +
      "°</strong></span><span>ALT <strong>" +
      fmtAlt(p.alt) +
      '</strong></span><span class="' +
      (p.fuel < 30 ? "low" : "") +
      '">FUEL ' +
      fmtT(p.fuel) +
      "</span><span>" +
      STATUS[p.state] +
      "</span>";
  }

  // ---------- flow ----------
  function reset() {
    G.planes.length = 0;
    G.marks.length = 0;
    G.wrecks.length = 0;
    pairCd.clear();
    G.sel = null;
    G.score = 0;
    G.landed = 0;
    G.diverted = 0;
    G.incidents = 0;
    G.time = 0;
    G.tNext = 2.2;
    G.sweep = rnd(0, 360);
    G.ended = false;
    G.nextId = 1;
    const wa = rnd(0, Math.PI * 2);
    const wm = rnd(0.015, 0.05);
    G.wind = { x: Math.sin(wa) * wm, y: -Math.cos(wa) * wm };
    logEl.innerHTML = "";
    hud();
  }

  function startShift() {
    audio();
    reset();
    G.mode = "play";
    G.paused = false;
    syncPause();
    intro.classList.add("hidden");
    endOv.classList.add("hidden");
    log("Radar hot. Expect first traffic shortly. Mind the drift.", "good");
  }

  function togglePause() {
    if (G.mode !== "play" || G.ended) return;
    G.paused = !G.paused;
    syncPause();
  }
  function syncPause() {
    pauseBtn.textContent = G.paused ? "RESUME" : "PAUSE";
    pausedTag.classList.toggle(
      "hidden",
      !(G.paused && G.mode === "play" && !G.ended),
    );
  }
  function toggleMute() {
    audio();
    G.muted = !G.muted;
    muteBtn.textContent = G.muted ? "SOUND OFF" : "SOUND ON";
  }

  // ---------- input ----------
  function pick(wx, wy) {
    const th = Math.max(1.9, 22 / scale);
    let best = null;
    let bd = Infinity;
    for (const p of G.planes) {
      if (p.state === "divert") continue;
      const d = dist(wx, wy, p.x, p.y);
      if (d < th && d < bd) {
        best = p;
        bd = d;
      }
    }
    return best;
  }

  cv.addEventListener("pointerdown", (e) => {
    audio();
    if (G.mode !== "play" || G.paused || G.ended) return;
    const r = cv.getBoundingClientRect();
    const wx = (((e.clientX - r.left) / r.width) * 2 - 1) * (R + 1);
    const wy = (((e.clientY - r.top) / r.height) * 2 - 1) * (R + 1);
    const p = pick(wx, wy);
    if (p) {
      select(p);
      return;
    }
    if (G.sel) {
      if (G.sel.state !== "air") {
        log("Unable — " + G.sel.cs + " is engaged.", "warn");
        return;
      }
      G.marks.push({ x: wx, y: wy, t: 1.2 });
      cmdHdg(G.sel, brgTo(G.sel.x, G.sel.y, wx, wy));
    }
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if (k === "r" || k === "R") {
      startShift();
      return;
    }
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (G.mode !== "play" || G.paused || G.ended) return;
    let used = true;
    if (k === "Tab") cycle();
    else if ((k === "ArrowLeft" || k === "a" || k === "A") && G.sel)
      cmdHdg(G.sel, G.sel.cmd - 15);
    else if ((k === "ArrowRight" || k === "d" || k === "D") && G.sel)
      cmdHdg(G.sel, G.sel.cmd + 15);
    else if ((k === "ArrowUp" || k === "w" || k === "W") && G.sel)
      cmdAlt(G.sel, 1);
    else if ((k === "ArrowDown" || k === "s" || k === "S") && G.sel)
      cmdAlt(G.sel, -1);
    else used = false;
    if (used) e.preventDefault();
  });

  upBtn.addEventListener("click", () => {
    audio();
    cmdAlt(G.sel, 1);
  });
  dnBtn.addEventListener("click", () => {
    audio();
    cmdAlt(G.sel, -1);
  });
  pauseBtn.addEventListener("click", () => {
    audio();
    togglePause();
  });
  muteBtn.addEventListener("click", toggleMute);
  restartBtn.addEventListener("click", startShift);
  document.getElementById("startBtn").addEventListener("click", startShift);
  document.getElementById("againBtn").addEventListener("click", startShift);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.mode === "play" && !G.ended && !G.paused) {
      G.paused = true;
      syncPause();
    }
  });

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.mode === "play" && !G.paused && !G.ended) update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  fit();
  reset();
  requestAnimationFrame(frame);
})();
