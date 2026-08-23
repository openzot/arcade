/* Quiet Hours — a museum stealth heist for the arcade.
 *
 * The Grand Ellery closes at nine; at nine-oh-one you are already inside.
 * Slip between the watch's lantern cones, melt into the shadow pools,
 * lift three treasures and vanish down the service stair. Caught twice
 * and the night is over.
 *
 * Everything is vanilla: one canvas, DOM overlays, Web Audio bleeps.
 */

(function () {
  "use strict";

  /* ---------------- constants ---------------- */

  var W = 1000,
    H = 625;
  var PLAYER_R = 11;
  var PLAYER_SPEED = 168; // px/s
  var GUARD_R = 11;
  var GUARD_PATROL = 82; // px/s
  var GUARD_CHASE = 182; // px/s
  var FOV = (66 * Math.PI) / 180;
  var VIEW_RANGE = 245;
  var CATCH_DIST = 21;
  var LIFT_RANGE = 46;
  var LIFT_TIME = 0.95;

  /* ---------------- level data ---------------- */

  // Solid blocks: boundary + interior walls + plinths + cases.
  // Doors are the gaps deliberately left between segments.
  var WALLS = [
    // boundary
    { x: 0, y: 0, w: W, h: 16 },
    { x: 0, y: 16, w: 16, h: 593 },
    { x: 984, y: 16, w: 16, h: 593 },
    { x: 16, y: 609, w: 968, h: 16 },
    // y=240 wall (top rooms / great hall), doors at x380..460 and x800..880
    { x: 16, y: 240, w: 364, h: 14 },
    { x: 460, y: 240, w: 340, h: 14 },
    { x: 880, y: 240, w: 104, h: 14 },
    // y=420 wall (great hall / bottom rooms), doors at x120..200 and x640..720
    { x: 16, y: 420, w: 104, h: 14 },
    { x: 200, y: 420, w: 440, h: 14 },
    { x: 720, y: 420, w: 264, h: 14 },
    // entrance <-> egyptian divider, door at y500..564
    { x: 392, y: 420, w: 14, h: 80 },
    { x: 392, y: 564, w: 14, h: 45 },
    // service stair divider, door at y150..214
    { x: 212, y: 16, w: 14, h: 134 },
    { x: 212, y: 214, w: 14, h: 26 },
    // vault divider, door at y160..224
    { x: 692, y: 16, w: 14, h: 144 },
    { x: 692, y: 224, w: 14, h: 16 },
    // plinths and cases (block feet and lantern light alike)
    { x: 472, y: 304, w: 56, h: 52 }, // sapphire plinth (great hall)
    { x: 872, y: 72, w: 48, h: 48 }, // egg pedestal (vault)
    { x: 832, y: 512, w: 52, h: 52 }, // scarab case (egyptian)
    { x: 200, y: 318, w: 62, h: 34 }, // display case west
    { x: 700, y: 318, w: 62, h: 34 }, // display case east
  ];

  var SHADOWS = [
    { x: 300, y: 530, r: 58 },
    { x: 350, y: 330, r: 54 },
    { x: 650, y: 330, r: 54 },
    { x: 300, y: 92, r: 56 },
    { x: 545, y: 78, r: 52 },
    { x: 762, y: 545, r: 56 },
    { x: 815, y: 178, r: 50 },
    { x: 96, y: 330, r: 50 },
  ];

  var TREASURES = [
    { name: "the Gilded Scarab", x: 858, y: 538, hue: "#ffd76a" },
    { name: "the Sapphire Navette", x: 500, y: 330, hue: "#7fd4ff" },
    { name: "the Sunburst Egg", x: 896, y: 96, hue: "#ffb36a" },
  ];

  var EXIT = { x: 44, y: 16, w: 116, h: 40 }; // service stair, top-left

  var GUARD_DEFS = [
    {
      // great hall sweep
      path: [
        [120, 292],
        [880, 292],
        [880, 382],
        [120, 382],
      ],
    },
    {
      // ground-floor round: entrance, egyptian, back along the hall
      path: [
        [92, 556],
        [350, 556],
        [455, 536],
        [884, 536],
        [884, 464],
        [520, 464],
        [92, 464],
      ],
    },
    {
      // upstairs corridor and vault
      path: [
        [120, 186],
        [600, 186],
        [772, 186],
        [930, 122],
        [930, 50],
        [756, 50],
        [756, 186],
      ],
    },
  ];

  var START = { x: 100, y: 548 };

  /* ---------------- dom ---------------- */

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");

  var elLoot = document.getElementById("loot");
  var elClock = document.getElementById("clock");
  var elLives = document.getElementById("lives");
  var elSeen = document.getElementById("seen");
  var elSeenFill = document.getElementById("seenFill");
  var elStickZone = document.getElementById("stickZone");
  var elStickBase = document.getElementById("stickBase");
  var elStickTip = document.getElementById("stickTip");
  var elBtnAct = document.getElementById("btnAct");

  var overlays = {
    intro: document.getElementById("ovIntro"),
    pause: document.getElementById("ovPause"),
    win: document.getElementById("ovWin"),
    lose: document.getElementById("ovLose"),
  };

  /* ---------------- audio ---------------- */

  var AC = null,
    master = null,
    muted = false;

  function initAudio() {
    if (AC) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(AC.destination);
    } catch (e) {
      AC = null;
    }
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!AC || muted) return;
    var t0 = AC.currentTime + (delay || 0);
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function sfxPickup() {
    tone(659, 0.12, "triangle", 0.22);
    tone(831, 0.12, "triangle", 0.2, 0, 0.09);
    tone(988, 0.22, "triangle", 0.22, 0, 0.18);
  }
  function sfxAlarm() {
    tone(560, 0.16, "square", 0.11, 840);
    tone(560, 0.16, "square", 0.11, 840, 0.22);
  }
  function sfxCaught() {
    tone(300, 0.5, "sawtooth", 0.22, 82);
  }
  function sfxWin() {
    var n = [523, 659, 784, 1047];
    for (var i = 0; i < n.length; i++)
      tone(n[i], 0.26, "triangle", 0.2, 0, i * 0.13);
  }
  function sfxThump() {
    tone(88, 0.14, "sine", 0.3, 55);
  }
  function sfxClick() {
    tone(520, 0.06, "sine", 0.14);
  }

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax,
      dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function circleHitsWall(px, py, rad) {
    for (var i = 0; i < WALLS.length; i++) {
      var w = WALLS[i];
      var cx = clamp(px, w.x, w.x + w.w);
      var cy = clamp(py, w.y, w.y + w.h);
      var dx = px - cx,
        dy = py - cy;
      if (dx * dx + dy * dy < rad * rad) return true;
    }
    return false;
  }

  function losBlocked(ax, ay, bx, by) {
    var d = dist(ax, ay, bx, by);
    var steps = Math.ceil(d / 14);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var px = ax + (bx - ax) * t;
      var py = ay + (by - ay) * t;
      for (var j = 0; j < WALLS.length; j++) {
        if (pointInRect(px, py, WALLS[j])) return true;
      }
    }
    return false;
  }

  function rayHit(ax, ay, dir, maxLen) {
    var step = 10;
    var c = Math.cos(dir),
      s = Math.sin(dir);
    for (var d = step; d <= maxLen; d += step) {
      var px = ax + c * d,
        py = ay + s * d;
      for (var j = 0; j < WALLS.length; j++) {
        if (pointInRect(px, py, WALLS[j])) return d - step * 0.4;
      }
    }
    return maxLen;
  }

  function inShadow(x, y) {
    for (var i = 0; i < SHADOWS.length; i++) {
      var s = SHADOWS[i];
      if (dist(x, y, s.x, s.y) < s.r * 0.92) return true;
    }
    return false;
  }

  /* ---------------- game state ---------------- */

  var state = "intro"; // intro | play | pause | win | lose
  var player, guards, loot, lives, timeSec, alarms, ripples, sparks, shake;
  var channelT = 0,
    channelIdx = -1,
    graceT = 0,
    thumpT = 0;
  var last = 0;

  function resetGame() {
    player = {
      x: START.x,
      y: START.y,
      vx: 0,
      vy: 0,
      face: -Math.PI / 2,
      speed: 0,
    };
    guards = [];
    for (var i = 0; i < GUARD_DEFS.length; i++) {
      var def = GUARD_DEFS[i];
      guards.push({
        x: def.path[0][0],
        y: def.path[0][1],
        wp: 1,
        face: 0,
        mode: "patrol",
        target: null,
        linger: 0,
        memory: 0,
        seen: 0,
      });
    }
    loot = [false, false, false];
    lives = 2;
    timeSec = 0;
    alarms = 0;
    ripples = [];
    sparks = [];
    shake = 0;
    channelT = 0;
    channelIdx = -1;
    graceT = 0;
    shownSec = -1;
    updateHud();
  }

  function updateHud() {
    var s = "";
    for (var i = 0; i < TREASURES.length; i++)
      s += loot[i] ? "\u25C6" : "\u25C7";
    elLoot.textContent = s;
    elLoot.className = loot[0] && loot[1] && loot[2] ? "got" : "";
    var m = Math.floor(timeSec / 60),
      ss = Math.floor(timeSec % 60);
    elClock.textContent = m + ":" + (ss < 10 ? "0" : "") + ss;
    var hats = "";
    for (i = 0; i < lives; i++) hats += "\uD83C\uDFA9";
    elLives.textContent = hats || "\u2014";
  }

  function showOverlay(name) {
    for (var k in overlays) overlays[k].classList.toggle("show", k === name);
  }

  function startGame() {
    initAudio();
    if (AC && AC.state === "suspended") AC.resume();
    resetGame();
    state = "play";
    showOverlay(null);
    sfxClick();
  }

  function pauseGame() {
    if (state !== "play") return;
    state = "pause";
    showOverlay("pause");
  }

  function resumeGame() {
    if (state !== "pause") return;
    state = "play";
    showOverlay(null);
    sfxClick();
  }

  function rankFor(t, al) {
    if (al === 0 && t < 110) return "GHOST \u2014 unseen, unheard.";
    if (al <= 1 && t < 150) return "PHANTOM \u2014 they barely remember you.";
    if (t < 200) return "PICKPOCKET \u2014 quick fingers, loud feet.";
    return "BURGLAR \u2014 the loot is yours, the legend is not.";
  }

  function finishWin() {
    state = "win";
    showOverlay("win");
    document.getElementById("winStats").innerHTML =
      "Three pieces, lighter than whispers.<br>" +
      "Night worked: " +
      fmt(timeSec) +
      " &nbsp;&middot;&nbsp; Alarms: " +
      alarms +
      "<br><b>" +
      rankFor(timeSec, alarms) +
      "</b>";
    sfxWin();
  }

  function finishLose() {
    state = "lose";
    showOverlay("lose");
    var got = loot.filter(Boolean).length;
    document.getElementById("loseStats").innerHTML =
      "The watch knows your face now.<br>" +
      "Kept: " +
      got +
      " of 3 pieces &nbsp;&middot;&nbsp; " +
      fmt(timeSec) +
      " in the gallery";
    sfxCaught();
  }

  function fmt(t) {
    var m = Math.floor(t / 60),
      s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------------- input ---------------- */

  var keys = {};
  var stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
  var actQueued = false;

  window.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === " "
    )
      ev.preventDefault();
    if (k === "p" || k === "P") {
      if (state === "play") pauseGame();
      else if (state === "pause") resumeGame();
      return;
    }
    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if ((k === "r" || k === "R") && state !== "intro") {
      startGame();
      return;
    }
    if (
      (k === "Enter" || k === " ") &&
      (state === "intro" || state === "win" || state === "lose")
    ) {
      startGame();
      return;
    }
    if (k === "Enter" && state === "pause") {
      resumeGame();
      return;
    }
    keys[k.length === 1 ? k.toLowerCase() : k] = true;
    if (k === "e" || k === "E" || k === " ") actQueued = true;
  });

  window.addEventListener("keyup", function (ev) {
    var k = ev.key;
    keys[k.length === 1 ? k.toLowerCase() : k] = false;
  });

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    document.getElementById("btnMute").textContent = muted
      ? "\uD83D\uDD07"
      : "\uD83D\uDD0A";
  }

  function stagePoint(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (W / r.width),
      y: (ev.clientY - r.top) * (H / r.height),
    };
  }

  elStickZone.addEventListener("pointerdown", function (ev) {
    if (state !== "play") return;
    ev.preventDefault();
    var p = stagePoint(ev);
    stick.active = true;
    stick.id = ev.pointerId;
    stick.ox = p.x;
    stick.oy = p.y;
    stick.dx = 0;
    stick.dy = 0;
    elStickBase.style.left = p.x + "px";
    elStickBase.style.top = p.y + "px";
    elStickTip.style.transform = "translate(0,0)";
    document.body.classList.add("touching");
    elStickZone.setPointerCapture(ev.pointerId);
  });

  elStickZone.addEventListener("pointermove", function (ev) {
    if (!stick.active || ev.pointerId !== stick.id) return;
    ev.preventDefault();
    var p = stagePoint(ev);
    var dx = p.x - stick.ox,
      dy = p.y - stick.oy;
    var len = Math.sqrt(dx * dx + dy * dy);
    var max = 44;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    stick.dx = dx / max;
    stick.dy = dy / max;
    elStickTip.style.transform = "translate(" + dx + "px," + dy + "px)";
  });

  function stickEnd(ev) {
    if (ev.pointerId !== stick.id) return;
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    document.body.classList.remove("touching");
  }
  elStickZone.addEventListener("pointerup", stickEnd);
  elStickZone.addEventListener("pointercancel", stickEnd);

  elBtnAct.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (state === "play") actQueued = true;
  });
  elBtnAct.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });

  document.getElementById("btnStart").addEventListener("click", startGame);
  document.getElementById("btnResume").addEventListener("click", resumeGame);
  document.getElementById("btnRestart1").addEventListener("click", startGame);
  document.getElementById("btnAgain1").addEventListener("click", startGame);
  document.getElementById("btnAgain2").addEventListener("click", startGame);
  document.getElementById("btnPause").addEventListener("click", function () {
    if (state === "play") pauseGame();
    else if (state === "pause") resumeGame();
  });
  document.getElementById("btnMute").addEventListener("click", function () {
    initAudio();
    toggleMute();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "play") pauseGame();
  });

  /* ---------------- simulation ---------------- */

  function moveEntity(e, dx, dy, rad) {
    if (dx !== 0) {
      var nx = e.x + dx;
      if (!circleHitsWall(nx, e.y, rad)) e.x = nx;
    }
    if (dy !== 0) {
      var ny = e.y + dy;
      if (!circleHitsWall(e.x, ny, rad)) e.y = ny;
    }
    e.x = clamp(e.x, 16 + rad, 984 - rad);
    e.y = clamp(e.y, 16 + rad, 609 - rad);
  }

  function emitNoise(x, y, radius) {
    ripples.push({ x: x, y: y, r: 6, max: radius, life: 1 });
    for (var i = 0; i < guards.length; i++) {
      var g = guards[i];
      if (g.mode === "patrol" && dist(g.x, g.y, x, y) < radius) {
        g.mode = "investigate";
        g.target = { x: x, y: y };
        g.linger = 2.2;
      }
    }
  }

  function burst(x, y, hue) {
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 40 + Math.random() * 130;
      sparks.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        hue: hue,
      });
    }
  }

  function guardSeesPlayer(g) {
    var d = dist(g.x, g.y, player.x, player.y);
    if (d > VIEW_RANGE) return 0;
    var ang = Math.atan2(player.y - g.y, player.x - g.x);
    if (Math.abs(angDiff(ang, g.face)) > FOV / 2) return 0;
    if (losBlocked(g.x, g.y, player.x, player.y)) return 0;
    var hidden = inShadow(player.x, player.y) && player.speed < 12;
    if (hidden) return 0;
    // closer = faster discovery; shadow halves their eyes
    var prox = 1 - d / VIEW_RANGE;
    var rate = 0.55 + prox * 2.6;
    if (inShadow(player.x, player.y)) rate *= 0.3;
    return rate;
  }

  function updateGuard(g, dt, idx) {
    var seeRate = guardSeesPlayer(g);

    if (g.mode !== "chase") {
      if (seeRate > 0) {
        g.seen += seeRate * dt;
        if (g.seen >= 1) {
          g.mode = "chase";
          g.memory = 1.5;
          alarms++;
          sfxAlarm();
          shake = 0.5;
          // the shout carries
          for (var j = 0; j < guards.length; j++) {
            if (
              j !== idx &&
              guards[j].mode === "patrol" &&
              dist(guards[j].x, guards[j].y, g.x, g.y) < 300
            ) {
              guards[j].mode = "investigate";
              guards[j].target = { x: player.x, y: player.y };
              guards[j].linger = 2.6;
            }
          }
        }
      } else {
        g.seen = Math.max(0, g.seen - dt * 0.7);
      }
    }

    var speed = GUARD_PATROL;
    var tx, ty;

    if (g.mode === "chase") {
      speed = GUARD_CHASE;
      tx = player.x;
      ty = player.y;
      var d2p = dist(g.x, g.y, player.x, player.y);
      var vanished =
        inShadow(player.x, player.y) && player.speed < 12 && d2p > 52;
      if (
        losBlocked(g.x, g.y, player.x, player.y) ||
        !guardFacingPlayer(g) ||
        vanished
      ) {
        g.memory -= dt;
        if (g.memory <= 0) {
          g.mode = "investigate";
          g.target = { x: tx, y: ty };
          g.linger = 2.4;
          g.seen = 0;
        }
      } else {
        g.memory = 1.5;
      }
      if (d2p < CATCH_DIST && graceT <= 0) {
        catchPlayer();
        return;
      }
    } else if (g.mode === "investigate") {
      speed = GUARD_PATROL * 1.45;
      tx = g.target.x;
      ty = g.target.y;
      if (dist(g.x, g.y, tx, ty) < 10) {
        g.linger -= dt;
        g.face += Math.sin(timeSec * 3 + idx) * dt * 2.4; // sweeping gaze
        if (g.linger <= 0) g.mode = "return";
        tx = null;
      }
    } else if (g.mode === "return") {
      speed = GUARD_PATROL * 1.2;
      var path = GUARD_DEFS[idx].path;
      var wp = path[g.wp];
      tx = wp[0];
      ty = wp[1];
      if (dist(g.x, g.y, tx, ty) < 8) g.mode = "patrol";
    } else {
      // patrol
      var pth = GUARD_DEFS[idx].path;
      var pt = pth[g.wp];
      tx = pt[0];
      ty = pt[1];
      if (dist(g.x, g.y, tx, ty) < 8) {
        g.wp = (g.wp + 1) % pth.length;
        pt = pth[g.wp];
        tx = pt[0];
        ty = pt[1];
      }
    }

    if (tx !== null && tx !== undefined) {
      var dd = dist(g.x, g.y, tx, ty);
      if (dd > 0.5) {
        var mv = Math.min(speed * dt, dd);
        moveEntity(g, ((tx - g.x) / dd) * mv, ((ty - g.y) / dd) * mv, GUARD_R);
        var want = Math.atan2(ty - g.y, tx - g.x);
        turnToward(g, want, 0.22);
      }
    }
  }

  function guardFacingPlayer(g) {
    var ang = Math.atan2(player.y - g.y, player.x - g.x);

    return Math.abs(angDiff(ang, g.face)) < FOV / 2 + 0.25;
  }

  function turnToward(e, want, maxDelta) {
    e.face += clamp(angDiff(want, e.face), -maxDelta, maxDelta);
  }

  function catchPlayer() {
    lives--;
    sfxCaught();
    shake = 0.9;
    if (lives <= 0) {
      updateHud();
      finishLose();
      return;
    }
    // tossed out the tradesman's entrance with a warning
    player.x = START.x;
    player.y = START.y;
    player.face = -Math.PI / 2;
    graceT = 1.6;
    channelT = 0;
    channelIdx = -1;
    for (var i = 0; i < guards.length; i++) {
      guards[i].seen = 0;
      guards[i].mode = "return";
      guards[i].memory = 0;
    }
    updateHud();
  }

  function nearestTreasure() {
    var best = -1,
      bd = 1e9;
    for (var i = 0; i < TREASURES.length; i++) {
      if (loot[i]) continue;
      var d = dist(player.x, player.y, TREASURES[i].x, TREASURES[i].y);
      if (d < LIFT_RANGE && d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function update(dt) {
    timeSec += dt;
    graceT = Math.max(0, graceT - dt);
    shake = Math.max(0, shake - dt * 2.2);

    // --- player ---
    var mx = 0,
      my = 0;
    if (keys["w"] || keys["ArrowUp"]) my -= 1;
    if (keys["s"] || keys["ArrowDown"]) my += 1;
    if (keys["a"] || keys["ArrowLeft"]) mx -= 1;
    if (keys["d"] || keys["ArrowRight"]) mx += 1;
    if (stick.active) {
      mx += stick.dx;
      my += stick.dy;
    }
    var ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }

    var moving = ml > 0.12;
    if (moving) {
      player.speed = PLAYER_SPEED;
      moveEntity(
        player,
        mx * PLAYER_SPEED * dt,
        my * PLAYER_SPEED * dt,
        PLAYER_R,
      );
      player.face = Math.atan2(my, mx);
      if (channelT > 0) {
        channelT = 0;
        channelIdx = -1;
      } // moved off: fumble
    } else {
      player.speed = 0;
    }

    // --- lifting ---
    var near = nearestTreasure();
    elBtnAct.classList.toggle("pulse", near >= 0);
    if (actQueued) {
      actQueued = false;
      if (channelT <= 0 && near >= 0) {
        channelIdx = near;
        channelT = 0.0001;
        sfxClick();
      }
    }
    if (channelT > 0) {
      if (near !== channelIdx) {
        channelT = 0;
        channelIdx = -1;
      } else {
        channelT += dt;
        if (channelT >= LIFT_TIME) {
          loot[channelIdx] = true;
          emitNoise(TREASURES[channelIdx].x, TREASURES[channelIdx].y, 215);
          burst(
            TREASURES[channelIdx].x,
            TREASURES[channelIdx].y,
            TREASURES[channelIdx].hue,
          );
          sfxPickup();
          channelT = 0;
          channelIdx = -1;
          updateHud();
        }
      }
    }

    // --- exit ---
    if (
      loot[0] &&
      loot[1] &&
      loot[2] &&
      pointInRect(player.x, player.y, {
        x: EXIT.x - 6,
        y: EXIT.y,
        w: EXIT.w + 12,
        h: EXIT.h + 26,
      })
    ) {
      finishWin();
      return;
    }

    // --- guards ---
    var maxSeen = 0;
    for (var i = 0; i < guards.length; i++) {
      updateGuard(guards[i], dt, i);
      maxSeen = Math.max(
        maxSeen,
        guards[i].seen,
        guards[i].mode === "chase" ? 1 : 0,
      );
      if (state !== "play") return; // caught may have ended the night
    }

    // detection meter
    if (maxSeen > 0.03) {
      elSeen.classList.add("on");
      elSeenFill.style.width = Math.round(clamp(maxSeen, 0, 1) * 100) + "%";
    } else {
      elSeen.classList.remove("on");
    }

    // heartbeat when nearly spotted
    if (maxSeen > 0.55) {
      thumpT -= dt;
      if (thumpT <= 0) {
        sfxThump();
        thumpT = 0.55;
      }
    } else {
      thumpT = 0;
    }

    // --- fx ---
    for (i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      rp.r += (rp.max - rp.r) * dt * 3.2;
      rp.life -= dt * 1.1;
      if (rp.life <= 0) ripples.splice(i, 1);
    }
    for (i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vx *= 0.94;
      sp.vy *= 0.94;
      sp.life -= dt;
      if (sp.life <= 0) sparks.splice(i, 1);
    }
  }

  /* ---------------- rendering ---------------- */

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * shake * 9,
        (Math.random() - 0.5) * shake * 9,
      );
    }

    // floor
    ctx.fillStyle = "#171a26";
    ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (var gx = 16; gx < W; gx += 52) {
      ctx.beginPath();
      ctx.moveTo(gx, 16);
      ctx.lineTo(gx, H - 16);
      ctx.stroke();
    }
    for (var gy = 16; gy < H; gy += 52) {
      ctx.beginPath();
      ctx.moveTo(16, gy);
      ctx.lineTo(W - 16, gy);
      ctx.stroke();
    }

    // great-hall rug
    ctx.fillStyle = "#221c33";
    ctx.fillRect(300, 272, 400, 128);
    ctx.strokeStyle = "rgba(150,110,190,0.35)";
    ctx.strokeRect(308, 280, 384, 112);
    ctx.strokeRect(316, 288, 368, 96);

    // shadow pools
    for (var si = 0; si < SHADOWS.length; si++) {
      var sh = SHADOWS[si];
      var grd = ctx.createRadialGradient(sh.x, sh.y, 4, sh.x, sh.y, sh.r);
      grd.addColorStop(0, "rgba(0,0,0,0.66)");
      grd.addColorStop(0.7, "rgba(0,0,0,0.45)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // exit door
    var unlocked = loot[0] && loot[1] && loot[2];
    ctx.fillStyle = unlocked ? "rgba(63,174,116,0.85)" : "rgba(120,90,70,0.7)";
    ctx.fillRect(EXIT.x, EXIT.y, EXIT.w, EXIT.h);
    ctx.strokeStyle = unlocked ? "#7fe0ae" : "#8a6a52";
    ctx.lineWidth = 2;
    ctx.strokeRect(EXIT.x, EXIT.y, EXIT.w, EXIT.h);
    ctx.fillStyle = unlocked ? "#d8ffe9" : "#c9b8a5";
    ctx.font = 'bold 13px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(
      unlocked ? "SERVICE STAIR \u25B2" : "SERVICE STAIR",
      EXIT.x + EXIT.w / 2,
      EXIT.y + 26,
    );

    // walls
    for (var wi = 0; wi < WALLS.length; wi++) {
      var wl = WALLS[wi];
      ctx.fillStyle = "#2d3350";
      ctx.fillRect(wl.x, wl.y, wl.w, wl.h);
      ctx.fillStyle = "rgba(255,255,255,0.09)";
      ctx.fillRect(wl.x, wl.y, wl.w, 3);
    }

    // treasures (under guards' light)
    for (var ti = 0; ti < TREASURES.length; ti++) {
      drawTreasure(ti);
    }

    // lift channel ring
    if (channelT > 0 && channelIdx >= 0) {
      var t = TREASURES[channelIdx];
      var frac = clamp(channelT / LIFT_TIME, 0, 1);
      ctx.strokeStyle = "rgba(255,225,140,0.9)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 26, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    // ripples
    for (var ri = 0; ri < ripples.length; ri++) {
      var rr = ripples[ri];
      ctx.strokeStyle = "rgba(255,235,180," + (rr.life * 0.35).toFixed(3) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rr.x, rr.y, rr.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // guards (cones first, then bodies)
    for (var gi = 0; gi < guards.length; gi++) {
      drawGuardCone(guards[gi]);
    }
    for (gi = 0; gi < guards.length; gi++) {
      drawGuardBody(guards[gi]);
    }

    // player
    drawPlayer();

    // sparks
    for (var pi = 0; pi < sparks.length; pi++) {
      var pk = sparks[pi];
      ctx.globalAlpha = clamp(pk.life * 1.6, 0, 1);
      ctx.fillStyle = pk.hue;
      ctx.fillRect(pk.x - 2, pk.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // vignette
    var vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.35,
      W / 2,
      H / 2,
      H * 0.78,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  function drawTreasure(i) {
    var t = TREASURES[i];
    if (loot[i]) return;
    var pulse = 0.6 + 0.4 * Math.sin(timeSec * 3 + i * 2);
    var g = ctx.createRadialGradient(t.x, t.y, 2, t.x, t.y, 30);
    g.addColorStop(0, t.hue);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.35 + pulse * 0.4;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.hue;
    if (i === 0) {
      // scarab
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.hue;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x - 10, t.y - 4);
      ctx.lineTo(t.x - 3, t.y);
      ctx.moveTo(t.x + 10, t.y - 4);
      ctx.lineTo(t.x + 3, t.y);
      ctx.stroke();
    } else if (i === 1) {
      // navette
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - 9);
      ctx.lineTo(t.x + 7, t.y);
      ctx.lineTo(t.x, t.y + 9);
      ctx.lineTo(t.x - 7, t.y);
      ctx.closePath();
      ctx.fill();
    } else {
      // egg
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(120,60,20,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t.x - 6, t.y - 2);
      ctx.lineTo(t.x + 6, t.y - 2);
      ctx.moveTo(t.x - 6, t.y + 3);
      ctx.lineTo(t.x + 6, t.y + 3);
      ctx.stroke();
    }
  }

  function drawGuardCone(g) {
    var alertness = g.mode === "chase" ? 1 : g.seen;
    var rays = 24,
      half = FOV / 2;
    var pts = [];
    for (var i = 0; i <= rays; i++) {
      var ang = g.face - half + (FOV * i) / rays;
      pts.push(rayHit(g.x, g.y, ang, VIEW_RANGE));
    }
    var grad = ctx.createRadialGradient(g.x, g.y, 10, g.x, g.y, VIEW_RANGE);
    if (alertness > 0.6) {
      grad.addColorStop(0, "rgba(255,110,80,0.34)");
      grad.addColorStop(1, "rgba(255,110,80,0)");
    } else if (alertness > 0.05) {
      grad.addColorStop(0, "rgba(255,190,90,0.3)");
      grad.addColorStop(1, "rgba(255,190,90,0)");
    } else {
      grad.addColorStop(0, "rgba(255,232,160,0.26)");
      grad.addColorStop(1, "rgba(255,232,160,0)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    for (var j = 0; j < pts.length; j++) {
      var ang2 = g.face - half + (FOV * j) / rays;
      ctx.lineTo(g.x + Math.cos(ang2) * pts[j], g.y + Math.sin(ang2) * pts[j]);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawGuardBody(g) {
    var alert = g.mode === "chase";
    ctx.fillStyle = alert ? "#8c3b30" : "#37436f";
    ctx.beginPath();
    ctx.arc(g.x, g.y, GUARD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#12141f";
    ctx.lineWidth = 2;
    ctx.stroke();
    // cap
    ctx.fillStyle = alert ? "#c2564a" : "#4d5c92";
    ctx.beginPath();
    ctx.arc(g.x, g.y, GUARD_R - 2, g.face - 1.2, g.face + 1.2);
    ctx.lineTo(g.x, g.y);
    ctx.closePath();
    ctx.fill();
    // lantern
    var lx = g.x + Math.cos(g.face) * (GUARD_R + 2);
    var ly = g.y + Math.sin(g.face) * (GUARD_R + 2);
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayer() {
    if (graceT > 0 && Math.floor(graceT * 10) % 2 === 0) return; // blink
    var x = player.x,
      y = player.y;
    var shadowed = inShadow(x, y);
    ctx.globalAlpha = shadowed ? 0.55 : 1;
    ctx.fillStyle = "#1d222e";
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shadowed ? "#3a4358" : "#59657f";
    ctx.lineWidth = 2;
    ctx.stroke();
    // beanie stripe
    ctx.fillStyle = "#4a5468";
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_R - 2, player.face - 2.2, player.face + 2.2);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    // mask band + eyes
    var ex = Math.cos(player.face) * 3.4,
      ey = Math.sin(player.face) * 3.4;
    ctx.fillStyle = "#e8dcc2";
    ctx.fillRect(x - 5 + ex * 0.4, y - 2.5, 10, 3);
    ctx.fillStyle = "#14161f";
    ctx.fillRect(x - 3 + ex, y - 2, 2, 2);
    ctx.fillRect(x + 1.5 + ex, y - 2, 2, 2);
    ctx.globalAlpha = 1;
  }

  /* ---------------- main loop ---------------- */

  var shownSec = -1;

  function tickClock() {
    var s = Math.floor(timeSec);
    if (s !== shownSec) {
      shownSec = s;
      var m = Math.floor(s / 60),
        ss = s % 60;
      elClock.textContent = m + ":" + (ss < 10 ? "0" : "") + ss;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    if (state === "play") {
      update(dt);
      if (state === "play") tickClock();
    }
    if (state !== "intro") draw();
    else drawIntroBackdrop();
  }

  function drawIntroBackdrop() {
    ctx.fillStyle = "#10121c";
    ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, "rgba(217,180,92,0.10)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  resetGame();
  showOverlay("intro");
  requestAnimationFrame(frame);
})();
