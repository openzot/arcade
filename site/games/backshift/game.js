/*
 * Backshift - a reversing yard at first light.
 * Take the lorry and box trailer through four tight market bays.
 * All behaviour lives in this file; markup in index.html, rules in game.css.
 */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */

  var TAU = Math.PI * 2;
  var W = 960;
  var H = 600;

  function clamp(a, lo, hi) {
    return a < lo ? lo : a > hi ? hi : a;
  }

  function norm(a) {
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  }

  /* distance of an angle from a line (ignores which end faces forward) */
  function angFromLine(a, ref) {
    var d = Math.abs(norm(a - ref));
    return Math.min(d, Math.PI - d);
  }

  function ux(a) {
    return Math.cos(a);
  }
  function uy(a) {
    return Math.sin(a);
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) | 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function fmtTime(t) {
    t = Math.max(0, Math.ceil(t));
    var m = Math.floor(t / 60);
    var s = t % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------------- dom ---------------- */

  var $ = function (id) {
    return document.getElementById(id);
  };
  var cvs = $("yard");
  var ctx = cvs.getContext("2d");
  var chipLevel = $("chipLevel");
  var chipClock = $("chipClock");
  var chipBumps = $("chipBumps");
  var chipStars = $("chipStars");
  var veil = $("veil");
  var cardTitle = $("cardTitle");
  var cardTag = $("cardTag");
  var cardBody = $("cardBody");
  var cardBtn = $("cardBtn");
  var cardBtn2 = $("cardBtn2");

  /* ---------------- audio ---------------- */

  var AC = null;
  var master = null;
  var engOsc = null;
  var engGain = null;
  var noiseBuf = null;
  var muted = false;

  try {
    muted = localStorage.getItem("backshift.muted") === "1";
  } catch (e) {}

  function ensureAudio() {
    if (muted) return;
    if (!AC) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      AC = new Ctor();
      master = AC.createGain();
      master.gain.value = 0.5;
      master.connect(AC.destination);
      engOsc = AC.createOscillator();
      engOsc.type = "sawtooth";
      engOsc.frequency.value = 46;
      var lp = AC.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      engGain = AC.createGain();
      engGain.gain.value = 0;
      engOsc.connect(lp);
      lp.connect(engGain);
      engGain.connect(master);
      engOsc.start();
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.3, AC.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    if (AC.state === "suspended") AC.resume();
  }

  function blip(type, f0, f1, dur, vol) {
    if (!AC || muted) return;
    var t = AC.currentTime;
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function thud(mag) {
    if (!AC || muted) return;
    var vol = clamp(0.15 + mag * 0.04, 0.15, 0.5);
    blip("sine", 92, 38, 0.16, vol);
    if (noiseBuf) {
      var t = AC.currentTime;
      var src = AC.createBufferSource();
      src.buffer = noiseBuf;
      var g = AC.createGain();
      g.gain.setValueAtTime(vol * 0.7, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.connect(g);
      g.connect(master);
      src.start(t);
    }
  }

  function chime() {
    if (!AC || muted) return;
    blip("triangle", 523, 523, 0.16, 0.22);
    setTimeout(function () {
      blip("triangle", 784, 784, 0.3, 0.22);
    }, 130);
  }

  function hornFail() {
    if (!AC || muted) return;
    blip("sawtooth", 196, 98, 0.75, 0.25);
    setTimeout(function () {
      blip("sawtooth", 147, 74, 0.9, 0.22);
    }, 240);
  }

  function tickTock() {
    blip("square", 1250, 1250, 0.05, 0.05);
  }

  function setMuted(m) {
    muted = m;
    try {
      localStorage.setItem("backshift.muted", m ? "1" : "0");
    } catch (e) {}
    btnSound.setAttribute("aria-pressed", m ? "true" : "false");
    if (master) master.gain.value = m ? 0 : 0.5;
    if (engGain && m) engGain.gain.value = 0;
  }

  /* ---------------- levels ---------------- */

  /*
   * Each bay wants the TRAILER parked fully inside its rectangle,
   * square to bay.dir (either end facing in counts), stopped.
   */
  var LEVELS = [
    {
      name: "First Light",
      par: 40,
      start: { x: 175, y: 465, a: -0.38 },
      bay: { x: 560, y: 18, w: 104, h: 118, dir: -Math.PI / 2 },
      props: [
        { t: "van", x: 60, y: 512, w: 152, h: 62 },
        { t: "pallet", x: 292, y: 244, w: 96, h: 50 },
        { t: "barrels", x: 694, y: 316, w: 116, h: 88 },
        { t: "crate", x: 30, y: 30, w: 74, h: 66 },
        { t: "crate", x: 836, y: 470, w: 82, h: 74 },
      ],
    },
    {
      name: "Between the Vans",
      par: 55,
      start: { x: 812, y: 232, a: Math.PI * 0.82 },
      bay: { x: 428, y: 18, w: 104, h: 112, dir: -Math.PI / 2 },
      props: [
        { t: "van", x: 232, y: 18, w: 178, h: 58 },
        { t: "van", x: 550, y: 18, w: 186, h: 58 },
        { t: "crate", x: 806, y: 474, w: 106, h: 84 },
        { t: "barrels", x: 112, y: 414, w: 108, h: 84 },
        { t: "pallet", x: 640, y: 300, w: 54, h: 108 },
      ],
    },
    {
      name: "Around the Corner",
      par: 70,
      start: { x: 846, y: 486, a: Math.PI - 0.42 },
      bay: { x: 18, y: 196, w: 124, h: 114, dir: Math.PI },
      props: [
        { t: "pallet", x: 338, y: 60, w: 54, h: 102 },
        { t: "crate", x: 332, y: 172, w: 66, h: 68 },
        { t: "pallet", x: 338, y: 250, w: 54, h: 106 },
        { t: "van", x: 560, y: 506, w: 176, h: 58 },
        { t: "barrels", x: 776, y: 40, w: 128, h: 88 },
        { t: "crate", x: 60, y: 420, w: 78, h: 70 },
      ],
    },
    {
      name: "Blind Side",
      par: 85,
      start: { x: 122, y: 516, a: -0.14 },
      bay: { x: 792, y: 30, w: 132, h: 118, dir: 0 },
      props: [
        { t: "van", x: 258, y: 148, w: 396, h: 60 },
        { t: "crate", x: 812, y: 428, w: 104, h: 122 },
        { t: "barrels", x: 416, y: 396, w: 112, h: 84 },
        { t: "pallet", x: 58, y: 424, w: 72, h: 122 },
        { t: "crate", x: 690, y: 148, w: 70, h: 62 },
      ],
    },
  ];

  var SHIFT_LEN = 210;

  /* ---------------- rig geometry ---------------- */

  var WB = 34; /* tractor wheelbase */
  var TR_HH = 13; /* tractor half-width */
  var TR_HW = 29; /* tractor half-length */
  var TL_NOSE = 8; /* trailer overhang in front of the pin */
  var TL_TAIL = 58; /* pin to trailer rear doors */
  var LT = 48; /* pin to trailer axle */
  var TL_HH = 14;

  var MAX_STEER = 0.62;
  var MAX_REV = 95;
  var MAX_FWD = 72;

  var rig = { x: 0, y: 0, th: 0, psi: 0, v: 0, steer: 0 };

  function hitchPoint() {
    return {
      x: rig.x - ux(rig.th) * (WB / 2),
      y: rig.y - uy(rig.th) * (WB / 2),
    };
  }

  function partBoxes() {
    var hp = hitchPoint();
    var tcx = rig.x;
    var tcy = rig.y;
    var pc = {
      x: hp.x + (ux(rig.psi) * (TL_TAIL - TL_NOSE)) / 2,
      y: hp.y + (uy(rig.psi) * (TL_TAIL - TL_NOSE)) / 2,
    };
    return [
      { cx: tcx, cy: tcy, hw: TR_HW, hh: TR_HH, a: rig.th },
      {
        cx: pc.x,
        cy: pc.y,
        hw: (TL_TAIL + TL_NOSE) / 2,
        hh: TL_HH,
        a: rig.psi,
      },
    ];
  }

  function obbCorners(b) {
    var c = ux(b.a);
    var s = uy(b.a);
    var hx = c * b.hw;
    var hy = s * b.hw;
    var px = -s * b.hh;
    var py = c * b.hh;
    return [
      { x: b.cx + hx + px, y: b.cy + hy + py },
      { x: b.cx + hx - px, y: b.cy + hy - py },
      { x: b.cx - hx - px, y: b.cy - hy - py },
      { x: b.cx - hx + px, y: b.cy - hy + py },
    ];
  }

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  /* SAT between two oriented boxes; returns minimal push (away for A) or null */
  function satPush(A, B) {
    var ca = obbCorners(A);
    var cb = obbCorners(B);
    var axes = [
      [ux(A.a), uy(A.a)],
      [-uy(A.a), ux(A.a)],
      [ux(B.a), uy(B.a)],
      [-uy(B.a), ux(B.a)],
    ];
    var best = Infinity;
    var bx = 0;
    var by = 0;
    for (var i = 0; i < 4; i++) {
      var axx = axes[i][0];
      var axy = axes[i][1];
      var minA = Infinity;
      var maxA = -Infinity;
      var minB = Infinity;
      var maxB = -Infinity;
      for (var j = 0; j < 4; j++) {
        var pa = ca[j].x * axx + ca[j].y * axy;
        if (pa < minA) minA = pa;
        if (pa > maxA) maxA = pa;
        var pb = cb[j].x * axx + cb[j].y * axy;
        if (pb < minB) minB = pb;
        if (pb > maxB) maxB = pb;
      }
      var overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return null;
      if (overlap < best) {
        best = overlap;
        var dirSign = (B.cx - A.cx) * axx + (B.cy - A.cy) * axy >= 0 ? 1 : -1;
        bx = axx * overlap * dirSign;
        by = axy * overlap * dirSign;
      }
    }
    return { x: bx, y: by, depth: best };
  }

  /* ---------------- world colliders ---------------- */

  var WALL = 18;
  var colliders = [];
  var bay = null;
  var levelIdx = 0;
  var bg = null;

  function buildColliders(def) {
    colliders = [
      { x: 0, y: 0, w: W, h: WALL },
      { x: 0, y: H - WALL, w: W, h: WALL },
      { x: 0, y: 0, w: WALL, h: H },
      { x: W - WALL, y: 0, w: WALL, h: H },
    ];
    for (var i = 0; i < def.props.length; i++) {
      var p = def.props[i];
      colliders.push({ x: p.x, y: p.y, w: p.w, h: p.h });
    }
    bay = def.bay;
  }

  /* ---------------- state ---------------- */

  var state = "title"; /* title | playing | paused | clear | failed | won */
  var prevState = "title";
  var clock = SHIFT_LEN;
  var levelTime = 0;
  var bumps = 0;
  var holdT = 0;
  var inPlace = false;
  var bumpCool = 0;
  var shake = 0;
  var skids = [];
  var prevMarks = null;
  var frameNo = 0;
  var lastTickSec = -1;
  var reducedMotion = false;
  var best = [];

  try {
    reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    best = JSON.parse(localStorage.getItem("backshift.best") || "[]");
  } catch (e) {}
  if (!Array.isArray(best)) best = [];
  while (best.length < LEVELS.length) best.push(null);

  var inp = { left: false, right: false, fwd: false, rev: false, brake: false };

  var KEYS = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "fwd",
    KeyW: "fwd",
    ArrowDown: "rev",
    KeyS: "rev",
    Space: "brake",
  };

  window.addEventListener("keydown", function (ev) {
    var k = KEYS[ev.code];
    if (k) {
      ev.preventDefault();
      inp[k] = true;
      ensureAudio();
      return;
    }
    if (ev.repeat) return;
    if (ev.code === "KeyP") {
      ev.preventDefault();
      togglePause();
    } else if (ev.code === "Escape") {
      ev.preventDefault();
      togglePause();
    } else if (ev.code === "KeyM") {
      ev.preventDefault();
      ensureAudio();
      setMuted(!muted);
    } else if (ev.code === "KeyR") {
      ev.preventDefault();
      retryCurrent();
    } else if (ev.code === "Enter") {
      if (!veil.classList.contains("hidden")) {
        ev.preventDefault();
        ensureAudio();
        cardBtn.click();
      }
    }
  });

  window.addEventListener("keyup", function (ev) {
    var k = KEYS[ev.code];
    if (k) inp[k] = false;
  });

  function bindPad(el, prop) {
    function down(ev) {
      ev.preventDefault();
      inp[prop] = true;
      ensureAudio();
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {}
    }
    function up(ev) {
      ev.preventDefault();
      inp[prop] = false;
    }
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", function () {
      inp[prop] = false;
    });
  }

  bindPad($("padLeft"), "left");
  bindPad($("padRight"), "right");
  bindPad($("padFwd"), "fwd");
  bindPad($("padRev"), "rev");
  bindPad($("padBrake"), "brake");

  window.addEventListener("blur", function () {
    inp.left = inp.right = inp.fwd = inp.rev = inp.brake = false;
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") togglePause(true);
  });

  /* ---------------- simulation ---------------- */

  function resetRig(def) {
    rig.x = def.start.x;
    rig.y = def.start.y;
    rig.th = def.start.a;
    rig.psi = def.start.a;
    rig.v = 0;
    rig.steer = 0;
  }

  function step(dt) {
    frameNo++;

    /* steering */
    var sIn = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    if (sIn !== 0) {
      rig.steer += sIn * 3.4 * dt;
      rig.steer = clamp(rig.steer, -MAX_STEER, MAX_STEER);
    } else {
      /* the wheel holds its lock when parked, so you can pre-set a
       * steering angle before nudging; it only self-centres rolling */
      var dec = (Math.abs(rig.v) > 8 ? 2.6 : 0.3) * dt;
      if (Math.abs(rig.steer) <= dec) rig.steer = 0;
      else rig.steer -= Math.sign(rig.steer) * dec;
    }

    /* throttle */
    var target = 0;
    var rate = 260;
    if (inp.rev) {
      target = -MAX_REV;
      rate = 230;
    } else if (inp.fwd) {
      target = MAX_FWD;
      rate = 200;
    }
    if (inp.brake) {
      target = 0;
      rate = 560;
    }
    if (rig.v < target) rig.v = Math.min(target, rig.v + rate * dt);
    else if (rig.v > target) rig.v = Math.max(target, rig.v - rate * dt);

    /* kinematics */
    rig.th += ((rig.v / WB) * Math.tan(rig.steer) * dt) % TAU;
    rig.x += ux(rig.th) * rig.v * dt;
    rig.y += uy(rig.th) * rig.v * dt;
    rig.psi += ((rig.v / LT) * Math.sin(rig.th - rig.psi) * dt) % TAU;

    /* skid marks */
    var marks = null;
    if (Math.abs(rig.steer) > 0.2 && Math.abs(rig.v) > 18) {
      var hp = hitchPoint();
      marks = {
        rx: rig.x - ux(rig.th) * (WB / 2),
        ry: rig.y - uy(rig.th) * (WB / 2),
        tx: hp.x + ux(rig.psi) * LT,
        ty: hp.y + uy(rig.psi) * LT,
      };
    }
    if (
      marks &&
      prevMarks &&
      frameNo % 2 === 0 &&
      Math.hypot(marks.rx - prevMarks.rx, marks.ry - prevMarks.ry) > 4
    ) {
      skids.push({
        ax: prevMarks.rx,
        ay: prevMarks.ry,
        bx: marks.rx,
        by: marks.ry,
        t: 0,
      });
      skids.push({
        ax: prevMarks.tx,
        ay: prevMarks.ty,
        bx: marks.tx,
        by: marks.ty,
        t: 0,
      });
      if (skids.length > 280) skids.splice(0, skids.length - 280);
    }
    prevMarks = marks;
    for (var i = skids.length - 1; i >= 0; i--) {
      skids[i].t += dt;
      if (skids[i].t > 7) skids.splice(i, 1);
    }

    /* collisions: strongest correction wins, applied twice for stability */
    var bumped = 0;
    for (var pass = 0; pass < 2; pass++) {
      var boxes = partBoxes();
      var worst = null;
      for (var bi = 0; bi < boxes.length; bi++) {
        for (var ci = 0; ci < colliders.length; ci++) {
          var col = colliders[ci];
          var cbox = {
            cx: col.x + col.w / 2,
            cy: col.y + col.h / 2,
            hw: col.w / 2,
            hh: col.h / 2,
            a: 0,
          };
          var push = satPush(boxes[bi], cbox);
          if (push && (!worst || push.depth > worst.depth)) worst = push;
        }
      }
      if (!worst) break;
      rig.x -= worst.x;
      rig.y -= worst.y;
      if (worst.depth > bumped) bumped = worst.depth;
    }

    if (bumped > 0.5) {
      rig.v *= -0.28;
      if (bumpCool <= 0) {
        bumps++;
        bumpCool = 0.38;
        thud(bumped);
        shake = Math.min(11, shake + 2 + bumped * 0.9);
      }
    }
    bumpCool -= dt;

    /* win check */
    var boxes2 = partBoxes();
    var trailer = boxes2[1];
    var corners = obbCorners(trailer);
    var allIn = true;
    for (var k = 0; k < 4; k++) {
      if (!pointInRect(corners[k].x, corners[k].y, bay)) {
        allIn = false;
        break;
      }
    }
    var aligned = angFromLine(rig.psi, bay.dir) < 0.24;
    inPlace = allIn && aligned;
    if (inPlace && Math.abs(rig.v) < 6) holdT += dt;
    else holdT = 0;
    if (holdT >= 0.55) bayClear();

    if (shake > 0) shake *= Math.exp(-6 * dt);
  }

  /* ghost: where the rig drifts if nothing changes */
  function predictPath() {
    var pts = [];
    var x = rig.x;
    var y = rig.y;
    var th = rig.th;
    var psi = rig.psi;
    var v = rig.v;
    var st = rig.steer;
    var sIn = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    var target = 0;
    if (inp.rev) target = -MAX_REV;
    else if (inp.fwd) target = MAX_FWD;
    var dt = 1 / 45;
    for (var i = 0; i < 72; i++) {
      st += sIn * 3.4 * dt;
      if (sIn === 0) {
        var dec = (Math.abs(v) > 8 ? 2.6 : 0.3) * dt;
        if (Math.abs(st) <= dec) st = 0;
        else st -= Math.sign(st) * dec;
      }
      st = clamp(st, -MAX_STEER, MAX_STEER);
      if (v < target) v = Math.min(target, v + 230 * dt);
      else if (v > target) v = Math.max(target, v - 230 * dt);
      th += (v / WB) * Math.tan(st) * dt;
      x += ux(th) * v * dt;
      y += uy(th) * v * dt;
      psi += (v / LT) * Math.sin(th - psi) * dt;
      if (i % 3 === 0) {
        var nhx = x - ux(th) * (WB / 2);
        var nhy = y - uy(th) * (WB / 2);
        pts.push({
          x: nhx + ux(psi) * (TL_TAIL - 6),
          y: nhy + uy(psi) * (TL_TAIL - 6),
        });
      }
    }
    return pts;
  }

  /* ---------------- painting ---------------- */

  var dpr = 1;

  function fitCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
  }

  function paintProp(g, p, rnd) {
    var tones = ["#5c6672", "#6d5f52", "#54604f"];
    var tone = tones[((p.x + p.y) % 3) | 0];
    g.save();
    if (p.t === "van") {
      var horiz = p.w >= p.h;
      g.fillStyle = "rgba(0,0,0,0.30)";
      rr(g, p.x + 5, p.y + 7, p.w, p.h, 9);
      g.fill();
      g.fillStyle = tone;
      rr(g, p.x, p.y, p.w, p.h, 9);
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.4)";
      g.lineWidth = 2;
      g.stroke();
      /* roof panel */
      g.fillStyle = "rgba(255,255,255,0.10)";
      rr(g, p.x + 10, p.y + 9, p.w - 20, p.h - 18, 6);
      g.fill();
      /* cab end */
      g.fillStyle = "rgba(20,24,30,0.5)";
      if (horiz) rr(g, p.x + p.w - 30, p.y + 8, 20, p.h - 16, 4);
      else rr(g, p.x + 8, p.y + p.h - 30, p.w - 16, 20, 4);
      g.fill();
      /* wheels */
      g.fillStyle = "#15181c";
      if (horiz) {
        rr(g, p.x + 16, p.y - 5, 22, 10, 4);
        g.fill();
        rr(g, p.x + p.w - 52, p.y + p.h - 5, 22, 10, 4);
        g.fill();
        rr(g, p.x + 16, p.y + p.h - 5, 22, 10, 4);
        g.fill();
        rr(g, p.x + p.w - 52, p.y - 5, 22, 10, 4);
        g.fill();
      } else {
        rr(g, p.x - 5, p.y + 16, 10, 22, 4);
        g.fill();
        rr(g, p.x + p.w - 5, p.y + 16, 10, 22, 4);
        g.fill();
        rr(g, p.x - 5, p.y + p.h - 52, 10, 22, 4);
        g.fill();
        rr(g, p.x + p.w - 5, p.y + p.h - 52, 10, 22, 4);
        g.fill();
      }
    } else if (p.t === "crate") {
      g.fillStyle = "rgba(0,0,0,0.28)";
      rr(g, p.x + 4, p.y + 6, p.w, p.h, 4);
      g.fill();
      g.fillStyle = "#7c5c36";
      rr(g, p.x, p.y, p.w, p.h, 4);
      g.fill();
      g.strokeStyle = "#57401f";
      g.lineWidth = 2.5;
      g.stroke();
      g.strokeStyle = "rgba(87,64,31,0.55)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(p.x + 5, p.y + 5);
      g.lineTo(p.x + p.w - 5, p.y + p.h - 5);
      g.moveTo(p.x + p.w - 5, p.y + 5);
      g.lineTo(p.x + 5, p.y + p.h - 5);
      g.stroke();
    } else if (p.t === "pallet") {
      g.fillStyle = "rgba(0,0,0,0.25)";
      rr(g, p.x + 3, p.y + 5, p.w, p.h, 3);
      g.fill();
      g.fillStyle = "#6d5637";
      rr(g, p.x, p.y, p.w, p.h, 3);
      g.fill();
      g.strokeStyle = "#4c3b21";
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = "rgba(40,30,15,0.5)";
      g.lineWidth = 1.5;
      var n = 3;
      for (var i = 1; i <= n; i++) {
        g.beginPath();
        if (p.w >= p.h) {
          var yy = p.y + (p.h * i) / (n + 1);
          g.moveTo(p.x + 4, yy);
          g.lineTo(p.x + p.w - 4, yy);
        } else {
          var xx = p.x + (p.w * i) / (n + 1);
          g.moveTo(xx, p.y + 4);
          g.lineTo(xx, p.y + p.h - 4);
        }
        g.stroke();
      }
    } else if (p.t === "barrels") {
      var cols = Math.max(1, Math.round(p.w / 34));
      var rows = Math.max(1, Math.round(p.h / 34));
      var cw = p.w / cols;
      var chh = p.h / rows;
      var rad = Math.min(cw, chh) / 2 - 2;
      for (var rI = 0; rI < rows; rI++) {
        for (var cI = 0; cI < cols; cI++) {
          var cx = p.x + cw * cI + cw / 2 + (rnd() - 0.5) * 3;
          var cy = p.y + chh * rI + chh / 2 + (rnd() - 0.5) * 3;
          g.fillStyle = "rgba(0,0,0,0.3)";
          g.beginPath();
          g.arc(cx + 3, cy + 5, rad, 0, TAU);
          g.fill();
          g.fillStyle = "#46505c";
          g.beginPath();
          g.arc(cx, cy, rad, 0, TAU);
          g.fill();
          g.strokeStyle = "#20262d";
          g.lineWidth = 2;
          g.stroke();
          g.strokeStyle = "rgba(255,255,255,0.14)";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(cx, cy, rad - 5, -2.4, -0.8);
          g.stroke();
        }
      }
    }
    g.restore();
  }

  function paintBay(g, def) {
    var b = def.bay;
    g.save();
    g.fillStyle = "rgba(230,166,60,0.07)";
    g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = "#e6a63c";
    g.lineWidth = 3;
    g.setLineDash([13, 9]);
    g.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
    g.setLineDash([]);
    /* chevrons at the mouth, pointing inward */
    var mx = b.x + b.w / 2 - ux(b.dir) * 0;
    var my = b.y + b.h / 2;
    var ox = b.x + b.w / 2 - ux(b.dir) * (b.h / 2 + 6);
    var oy = b.y + b.h / 2 - uy(b.dir) * (b.h / 2 + 6);
    mx = ox;
    my = oy;
    g.globalAlpha = 0.55;
    g.fillStyle = "#e6a63c";
    for (var i = 0; i < 3; i++) {
      var px = mx + ux(b.dir) * i * 17;
      var py = my + uy(b.dir) * i * 17;
      var lx = -uy(b.dir);
      var ly = ux(b.dir);
      var tip = 9;
      var side = 11;
      g.beginPath();
      g.moveTo(px + ux(b.dir) * tip, py + uy(b.dir) * tip);
      g.lineTo(px - ux(b.dir) * 4 + lx * side, py - uy(b.dir) * 4 + ly * side);
      g.lineTo(px - ux(b.dir) * 4 - lx * side, py - uy(b.dir) * 4 - ly * side);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
    /* label beyond the mouth */
    var lx2 = b.x + b.w / 2 - ux(b.dir) * (b.h / 2 + 26);
    var ly2 = b.y + b.h / 2 - uy(b.dir) * (b.h / 2 + 26);
    g.font = "700 16px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#e6a63c";
    g.fillText("BAY " + (LEVELS.indexOf(def) + 1), lx2, ly2);
    g.font = "500 11px system-ui, sans-serif";
    g.fillStyle = "rgba(230,166,60,0.65)";
    g.fillText("set the trailer square", lx2, ly2 + 17);
    g.restore();
  }

  function paintScene(g) {
    var def = LEVELS[levelIdx];
    var rnd = mulberry32(1234 + levelIdx * 999);
    g.fillStyle = "#262a30";
    g.fillRect(0, 0, W, H);
    /* asphalt mottle */
    for (var i = 0; i < 850; i++) {
      var nx = rnd() * W;
      var ny = rnd() * H;
      var nr = 1.5 + rnd() * 11;
      g.fillStyle =
        rnd() < 0.5 ? "rgba(255,255,255,0.022)" : "rgba(0,0,0,0.05)";
      g.beginPath();
      g.arc(nx, ny, nr, 0, TAU);
      g.fill();
    }
    /* old stains */
    for (var sI = 0; sI < 7; sI++) {
      var sx = 60 + rnd() * (W - 120);
      var sy = 60 + rnd() * (H - 120);
      g.fillStyle = "rgba(10,12,14,0.10)";
      g.beginPath();
      g.ellipse(sx, sy, 18 + rnd() * 40, 10 + rnd() * 22, rnd() * TAU, 0, TAU);
      g.fill();
    }
    /* faded lane arrows */
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 4;
    for (var aI = 0; aI < 5; aI++) {
      var ax = 120 + aI * 170;
      var ay = H - 46;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax + 26, ay);
      g.lineTo(ax + 18, ay - 8);
      g.moveTo(ax + 26, ay);
      g.lineTo(ax + 18, ay + 8);
      g.stroke();
    }
    /* walls */
    var wallFill = "#333a43";
    g.fillStyle = wallFill;
    g.fillRect(0, 0, W, WALL);
    g.fillRect(0, H - WALL, W, WALL);
    g.fillRect(0, 0, WALL, H);
    g.fillRect(W - WALL, 0, WALL, H);
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 2;
    g.strokeRect(WALL - 1, WALL - 1, W - 2 * WALL + 2, H - 2 * WALL + 2);
    g.fillStyle = "rgba(0,0,0,0.45)";
    for (var bX = 26; bX < W - 20; bX += 44) {
      g.beginPath();
      g.arc(bX, WALL / 2, 2, 0, TAU);
      g.arc(bX, H - WALL / 2, 2, 0, TAU);
      g.fill();
    }
    for (var bY = 26; bY < H - 20; bY += 44) {
      g.beginPath();
      g.arc(WALL / 2, bY, 2, 0, TAU);
      g.arc(W - WALL / 2, bY, 2, 0, TAU);
      g.fill();
    }
    /* corner hazard stripes */
    var corners = [
      [0, 0, 1, 1],
      [W, 0, -1, 1],
      [0, H, 1, -1],
      [W, H, -1, -1],
    ];
    g.save();
    g.globalAlpha = 0.85;
    for (var cI = 0; cI < 4; cI++) {
      var cc = corners[cI];
      g.save();
      g.translate(cc[0], cc[1]);
      g.scale(cc[2], cc[3]);
      for (var st = 0; st < 4; st++) {
        g.fillStyle = st % 2 ? "#e6a63c" : "#191d22";
        g.beginPath();
        g.moveTo(0, 18 + st * 13);
        g.lineTo(18 + st * 13, 0);
        g.lineTo(31 + st * 13, 0);
        g.lineTo(0, 31 + st * 13);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    g.restore();
    /* props */
    for (var pI = 0; pI < def.props.length; pI++)
      paintProp(g, def.props[pI], rnd);
    /* bay */
    paintBay(g, def);
    /* vignette */
    var vg = g.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.35,
      W / 2,
      H / 2,
      H * 0.85,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.34)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  function renderBG() {
    if (!bg) {
      bg = document.createElement("canvas");
      bg.width = W * 2;
      bg.height = H * 2;
    }
    var g = bg.getContext("2d");
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, W, H);
    paintScene(g);
  }

  function drawRigBody(g) {
    var hp = hitchPoint();
    /* shadows */
    g.fillStyle = "rgba(0,0,0,0.32)";
    g.save();
    g.translate(rig.x + 5, rig.y + 7);
    g.rotate(rig.th);
    rr(g, -TR_HW, -TR_HH, TR_HW * 2, TR_HH * 2, 7);
    g.fill();
    g.restore();
    g.save();
    g.translate(hp.x + 5, hp.y + 7);
    g.rotate(rig.psi);
    rr(g, -TL_NOSE, -TL_HH, TL_TAIL + TL_NOSE, TL_HH * 2, 6);
    g.fill();
    g.restore();

    /* trailer */
    g.save();
    g.translate(hp.x, hp.y);
    g.rotate(rig.psi);
    g.fillStyle = "#e9dfc6";
    rr(g, -TL_NOSE, -TL_HH, TL_TAIL + TL_NOSE, TL_HH * 2, 6);
    g.fill();
    g.strokeStyle = "#6b6252";
    g.lineWidth = 2.5;
    g.stroke();
    g.strokeStyle = "rgba(107,98,82,0.4)";
    g.lineWidth = 1.5;
    for (var x = 4; x < TL_TAIL - 8; x += 9) {
      g.beginPath();
      g.moveTo(x, -TL_HH + 3);
      g.lineTo(x, TL_HH - 3);
      g.stroke();
    }
    /* axle + wheels */
    g.fillStyle = "#191d22";
    rr(g, LT - 6, -TL_HH - 4, 13, 6, 2);
    g.fill();
    rr(g, LT - 6, TL_HH - 2, 13, 6, 2);
    g.fill();
    /* rear doors */
    g.strokeStyle = "#8a7f68";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(TL_TAIL - 1, -TL_HH + 2);
    g.lineTo(TL_TAIL - 1, TL_HH - 2);
    g.stroke();
    g.fillStyle = "#c2452e";
    g.beginPath();
    g.arc(TL_TAIL - 3, -TL_HH + 4, 1.8, 0, TAU);
    g.arc(TL_TAIL - 3, TL_HH - 4, 1.8, 0, TAU);
    g.fill();
    g.restore();

    /* tractor */
    g.save();
    g.translate(rig.x, rig.y);
    g.rotate(rig.th);
    g.fillStyle = "#3a4046";
    rr(g, -TR_HW, -TR_HH, 26, TR_HH * 2, 5);
    g.fill();
    g.strokeStyle = "#22262b";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#2e6f6b";
    rr(g, 6, -TR_HH, TR_HW - 6, TR_HH * 2, 6);
    g.fill();
    g.strokeStyle = "#1d4a47";
    g.stroke();
    g.fillStyle = "rgba(220,235,235,0.75)";
    rr(g, 15, -TR_HH + 4, 7, TR_HH * 2 - 8, 2);
    g.fill();
    g.fillStyle = "#ffd98a";
    g.beginPath();
    g.arc(TR_HW - 2, -TR_HH + 4, 2, 0, TAU);
    g.arc(TR_HW - 2, TR_HH - 4, 2, 0, TAU);
    g.fill();
    /* wheels */
    g.fillStyle = "#15181c";
    rr(g, -13, -TR_HH - 4, 14, 7, 3);
    g.fill();
    rr(g, -13, TR_HH - 3, 14, 7, 3);
    g.fill();
    g.save();
    g.translate(17, -TR_HH - 1);
    g.rotate(rig.steer);
    rr(g, -7, -3.5, 14, 7, 3);
    g.fill();
    g.restore();
    g.save();
    g.translate(17, TR_HH + 1);
    g.rotate(rig.steer);
    rr(g, -7, -3.5, 14, 7, 3);
    g.fill();
    g.restore();
    /* hitch */
    g.fillStyle = "#101317";
    g.beginPath();
    g.arc(-(WB / 2), 0, 3.4, 0, TAU);
    g.fill();
    g.restore();
  }

  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var shx = 0;
    var shy = 0;
    if (shake > 0.05 && !reducedMotion) {
      shx = (Math.random() - 0.5) * shake;
      shy = (Math.random() - 0.5) * shake;
    }
    ctx.save();
    ctx.translate(shx, shy);
    if (bg) ctx.drawImage(bg, 0, 0, W, H);

    /* skids */
    for (var i = 0; i < skids.length; i++) {
      var sk = skids[i];
      var fade = 1 - sk.t / 7;
      ctx.strokeStyle = "rgba(16,18,21," + (0.5 * fade).toFixed(3) + ")";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(sk.ax, sk.ay);
      ctx.lineTo(sk.bx, sk.by);
      ctx.stroke();
    }

    /* success glow */
    if (inPlace && state === "playing") {
      var pulse = 0.45 + 0.3 * Math.sin(animT * 7);
      ctx.strokeStyle = "rgba(126,201,126," + pulse.toFixed(3) + ")";
      ctx.lineWidth = 5;
      rr(ctx, bay.x + 4, bay.y + 4, bay.w - 8, bay.h - 8, 8);
      ctx.stroke();
      ctx.fillStyle = "rgba(126,201,126," + Math.min(1, pulse + 0.3) + ")";
      ctx.font = "700 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var lx = bay.x + bay.w / 2 + ux(-bay.dir) * (bay.h / 2 + 44);
      var ly = bay.y + bay.h / 2 + uy(-bay.dir) * (bay.h / 2 + 44);
      ctx.fillText("steady\u2026", lx, ly);
    }

    /* ghost trail */
    if (state === "playing" && (Math.abs(rig.v) > 4 || inp.rev || inp.fwd)) {
      var pts = predictPath();
      for (var pi = 0; pi < pts.length; pi++) {
        var al = 0.5 * (1 - pi / pts.length) + 0.06;
        ctx.fillStyle = "rgba(230,166,60," + al.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(pts[pi].x, pts[pi].y, 2.6, 0, TAU);
        ctx.fill();
      }
    }

    if (state !== "title") drawRigBody(ctx);
    ctx.restore();
  }

  /* ---------------- hud & overlays ---------------- */

  function starsFor(t, par, bumpsCount) {
    var s = 3;
    if (t > par) s -= Math.min(2, Math.ceil((t - par) / 18));
    if (bumpsCount >= 3) s -= 1;
    return clamp(s, 1, 3);
  }

  function sessionStars() {
    var tot = 0;
    for (var i = 0; i < results.length; i++) tot += results[i].stars;
    return tot;
  }

  var results = [];

  function updateHud() {
    chipLevel.textContent =
      "BAY " +
      (levelIdx + 1) +
      " \u00B7 " +
      LEVELS[levelIdx].name.toUpperCase();
    var secs = Math.ceil(clock);
    chipClock.textContent = "\u23F1 " + fmtTime(clock);
    if (secs <= 15 && state === "playing") chipClock.classList.add("low");
    else chipClock.classList.remove("low");
    chipBumps.innerHTML =
      "\u2738 " + bumps + " bump" + (bumps === 1 ? "" : "s");
    var st = sessionStars();
    var out = "";
    for (var i = 0; i < 3 * results.length; i++)
      out += i < st ? "\u2605" : "\u2606";
    chipStars.textContent = out || "\u2606\u2606\u2606";

    if (state === "playing") {
      var ws = Math.floor(clock);
      if (ws !== lastTickSec) {
        lastTickSec = ws;
        if (clock <= 10 && clock > 0) tickTock();
      }
    }
  }

  function showCard(cfg) {
    cardTitle.textContent = cfg.title;
    cardTag.textContent = cfg.tag || "";
    cardBody.innerHTML = cfg.body || "";
    cardBtn.textContent = cfg.btn;
    cardBtn.onclick = cfg.onBtn;
    if (cfg.btn2) {
      cardBtn2.classList.remove("hidden");
      cardBtn2.textContent = cfg.btn2;
      cardBtn2.onclick = cfg.onBtn2;
    } else {
      cardBtn2.classList.add("hidden");
      cardBtn2.onclick = null;
    }
    veil.classList.remove("hidden");
  }

  function hideVeil() {
    veil.classList.add("hidden");
  }

  var HOWTO =
    "<p>The market's still asleep and the yard's yours. Set all four bays before the six o'clock gate locks.</p>" +
    "<ul>" +
    '<li>Hold <span class="keys">\u25BC</span> / <span class="keys">S</span> to reverse, <span class="keys">\u25B2</span> / <span class="keys">W</span> to creep forward.</li>' +
    '<li><span class="keys">\u25C0</span> <span class="keys">\u25B6</span> or <span class="keys">A</span> <span class="keys">D</span> steer. <span class="keys">SPACE</span> is the handbrake.</li>' +
    "<li>The amber dots are your future: where the trailer tails off to if you change nothing.</li>" +
    "<li>Park the <strong>trailer</strong> square inside the marked bay and hold it still. Bumps cost stars; the clock runs across all four bays.</li>" +
    "</ul>";

  function titleCard() {
    showCard({
      title: "Backshift",
      tag: "Forwards got you into this mess.",
      body: HOWTO,
      btn: state === "title" ? "Clock on" : "Back to it",
      onBtn: state === "title" ? startShift : resumeGame,
    });
  }

  function clearCard() {
    var def = LEVELS[levelIdx];
    var stars = starsFor(levelTime, def.par, bumps);
    results[levelIdx] = { t: levelTime, stars: stars };
    var starTxt = "";
    for (var i = 0; i < 3; i++) starTxt += i < stars ? "\u2605" : "\u2606";
    var quips = [
      "Textbook. The foreman nods once.",
      "In, with paint to spare.",
      "It's in. Nobody saw the rest.",
    ];
    var last = levelIdx >= LEVELS.length - 1;
    showCard({
      title: "Bay " + (levelIdx + 1) + " set",
      tag: quips[stars - 1],
      body:
        '<span class="stars">' +
        starTxt +
        "</span>" +
        "<p>" +
        fmtTime(levelTime) +
        " against a " +
        fmtTime(def.par) +
        " par \u00B7 " +
        bumps +
        " bump" +
        (bumps === 1 ? "" : "s") +
        "</p>",
      btn: last ? "See the lights" : "Next bay",
      onBtn: nextBay,
      btn2: "Replay bay",
      onBtn2: retryCurrent,
    });
  }

  function failCard() {
    showCard({
      title: "Gate's locked",
      tag: "Six o'clock comes round sharp.",
      body: "<p>The foreman takes a dim view of half-parked rigs blocking his road. Clock on again tomorrow \u2014 well, now.</p>",
      btn: "Clock on again",
      onBtn: startShift,
    });
  }

  function doneCard() {
    var tot = 0;
    var stTot = 0;
    for (var i = 0; i < results.length; i++) {
      tot += results[i].t;
      stTot += results[i].stars;
    }
    var starTxt = "";
    for (var j = 0; j < LEVELS.length * 3; j++)
      starTxt += j < stTot ? "\u2605" : "\u2606";
    showCard({
      title: "Shift done",
      tag: "Four bays, one lorry, no excuses.",
      body:
        '<span class="stars">' +
        starTxt +
        "</span>" +
        "<p>All bays set in " +
        fmtTime(tot) +
        ". The kettle's on in the porter's hut.</p>",
      btn: "Run it again",
      onBtn: startShift,
    });
  }

  function pauseCard() {
    showCard({
      title: "Paused",
      tag: "The yard can wait.",
      body: "",
      btn: "Back to it",
      onBtn: resumeGame,
    });
  }

  /* ---------------- flow ---------------- */

  function startShift() {
    levelIdx = 0;
    clock = SHIFT_LEN;
    results = [];
    loadLevel(0);
    state = "playing";
    hideVeil();
    chime();
  }

  function loadLevel(i) {
    levelIdx = i;
    buildColliders(LEVELS[i]);
    resetRig(LEVELS[i]);
    bumps = 0;
    levelTime = 0;
    holdT = 0;
    inPlace = false;
    skids = [];
    prevMarks = null;
    shake = 0;
    lastTickSec = -1;
    renderBG();
  }

  function retryCurrent() {
    if (state === "failed" || state === "won") {
      startShift();
      return;
    }
    loadLevel(levelIdx);
    if (prevState === "title" && state === "title") {
      /* retry pressed on the title screen: just begin */
      startShift();
      return;
    }
    state = "playing";
    hideVeil();
  }

  function nextBay() {
    if (levelIdx >= LEVELS.length - 1) {
      state = "won";
      doneCard();
      chime();
      return;
    }
    loadLevel(levelIdx + 1);
    state = "playing";
    hideVeil();
  }

  function bayClear() {
    state = "clear";
    chime();
    clearCard();
  }

  function failShift() {
    state = "failed";
    hornFail();
    failCard();
  }

  function togglePause(forceOn) {
    if (state === "playing" && (forceOn === undefined || forceOn === true)) {
      prevState = state;
      state = "paused";
      pauseCard();
    } else if (state === "paused" && !forceOn) {
      resumeGame();
    } else if (state === "clear" && !forceOn) {
      /* pause key on the clear card does nothing */
    } else if (state === "title" && !forceOn) {
      titleCard();
    } else if (state === "paused" && forceOn === false) {
      resumeGame();
    }
  }

  function resumeGame() {
    if (state === "title") {
      startShift();
      return;
    }
    if (state === "clear" || state === "failed" || state === "won") return;
    state = "playing";
    hideVeil();
  }

  /* ---------------- buttons ---------------- */

  var btnSound = $("btnSound");

  $("btnPause").addEventListener("click", function () {
    ensureAudio();
    togglePause();
  });
  btnSound.addEventListener("click", function () {
    ensureAudio();
    setMuted(!muted);
  });
  $("btnHelp").addEventListener("click", function () {
    ensureAudio();
    if (state === "playing") {
      prevState = state;
      state = "paused";
    }
    titleCard();
  });
  $("btnRestart").addEventListener("click", function () {
    ensureAudio();
    retryCurrent();
  });

  window.addEventListener("pointerdown", function () {
    ensureAudio();
  });

  setMuted(muted);

  /* ---------------- loop ---------------- */

  var last = performance.now();
  var animT = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 1 / 20) dt = 1 / 20;
    animT += dt;
    if (state === "playing") {
      step(dt);
      levelTime += dt;
      clock -= dt;
      if (clock <= 0) {
        clock = 0;
        failShift();
      }
    }
    draw(dt);
    updateHud();
    if (AC && engGain) {
      var g = state === "playing" ? 0.03 + Math.abs(rig.v) * 0.00042 : 0;
      engGain.gain.setTargetAtTime(muted ? 0 : g, AC.currentTime, 0.07);
      engOsc.frequency.setTargetAtTime(
        46 + Math.abs(rig.v) * 0.85,
        AC.currentTime,
        0.05,
      );
    }
  }

  fitCanvas();
  window.addEventListener("resize", fitCanvas);
  buildColliders(LEVELS[0]);
  resetRig(LEVELS[0]);
  renderBG();
  updateHud();
  titleCard();
  requestAnimationFrame(frame);

  /* ---------------- debug hook (only with #debug in the address) ------- */

  if (/debug/.test(window.location.hash)) {
    window.__backshift = {
      state: function () {
        return state;
      },
      rig: rig,
      clock: function () {
        return clock;
      },
      bumps: function () {
        return bumps;
      },
      pose: function (x, y, th, psi, v) {
        rig.x = x;
        rig.y = y;
        rig.th = th;
        rig.psi = psi === undefined ? th : psi;
        rig.v = v || 0;
        rig.steer = 0;
      },
      near: function (i) {
        loadLevel(i === undefined ? levelIdx : i);
        var def = LEVELS[levelIdx];
        var b = def.bay;
        var dist = 150;
        /* park south-of-the-bay style: tractor faces out (dir+PI),
         * trailer already square on the bay axis */
        rig.x = b.x + b.w / 2 - ux(b.dir) * (b.h / 2 + dist);
        rig.y = b.y + b.h / 2 - uy(b.dir) * (b.h / 2 + dist);

        rig.th = b.dir + Math.PI;
        rig.psi = b.dir;
        rig.v = 0;
        rig.steer = 0;
        state = "playing";
        hideVeil();
        state = "playing";
        hideVeil();
      },
      bay: function () {
        return bay;
      },
      flags: function () {
        return { inPlace: inPlace, holdT: holdT, levelTime: levelTime };
      },
    };
  }
})();
