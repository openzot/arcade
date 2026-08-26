/* Everywhere at Once — below-stairs bilocation.
   Every pass records your steps; when it ends, that pass repeats forever as a
   translucent yesterday. Chores need two pairs of hands at once, so you must
   choreograph your own past selves. All behaviour lives in this file. */
(function () {
  "use strict";

  /* ---------- constants ---------- */

  var W = 960;
  var H = 600;
  var TICK = 1 / 60;
  var ROUND_TICKS = 40 * 60; // 40 seconds per pass
  var MAX_PASS = 6;
  var SPEED = 150;
  var ACT_R = 13;

  var ROOMS = [
    { n: "Kitchen", x: 36, y: 46, w: 308, h: 268 },
    { n: "Scullery", x: 36, y: 326, w: 308, h: 248 },
    { n: "Great Hall", x: 356, y: 46, w: 248, h: 528 },
    { n: "Drawing Room", x: 616, y: 46, w: 308, h: 268 },
    { n: "Still Room", x: 616, y: 326, w: 308, h: 248 },
  ];

  var WALLS = [
    { x: 30, y: 40, w: 900, h: 12 },
    { x: 30, y: 568, w: 900, h: 12 },
    { x: 30, y: 40, w: 12, h: 540 },
    { x: 918, y: 40, w: 12, h: 540 },
    { x: 344, y: 52, w: 12, h: 94 },
    { x: 344, y: 202, w: 12, h: 218 },
    { x: 344, y: 476, w: 12, h: 92 },
    { x: 42, y: 314, w: 128, h: 12 },
    { x: 226, y: 314, w: 118, h: 12 },
    { x: 604, y: 52, w: 12, h: 98 },
    { x: 604, y: 208, w: 12, h: 222 },
    { x: 604, y: 486, w: 12, h: 82 },
    { x: 616, y: 314, w: 124, h: 12 },
    { x: 796, y: 314, w: 122, h: 12 },
  ];

  /* type: hold = stand to fill (stacking helps, two hands best);
           twin = every pad must be stood on at the SAME moment;
           carry = fetch the thing, stand at its destination to set it down */
  var TASKS = [
    {
      id: "range",
      name: "Light the range",
      type: "hold",
      need: 3,
      pads: [[104, 132]],
      hint: "stand at the range",
    },
    {
      id: "kettle",
      name: "Boil the copper",
      type: "twin",
      need: 3,
      pads: [
        [214, 96],
        [296, 168],
      ],
      hint: "two pairs of hands, same moment",
    },
    {
      id: "garland",
      name: "Hang the garland",
      type: "twin",
      need: 4,
      pads: [
        [398, 120],
        [498, 192],
      ],
      hint: "one cranks, one guides",
    },
    {
      id: "knocker",
      name: "Bright the knocker",
      type: "hold",
      need: 2.5,
      pads: [[468, 536]],
      hint: "stand at the front door",
    },
    {
      id: "sweep",
      name: "Sweep the hall",
      type: "hold",
      need: 4,
      pads: [[452, 398]],
      hint: "stand on the rug",
    },
    {
      id: "clock",
      name: "Wind the long clock",
      type: "hold",
      need: 2,
      pads: [[572, 112]],
      hint: "stand at the case clock",
    },
    {
      id: "shutters",
      name: "Open the shutters",
      type: "twin",
      need: 2.5,
      pads: [
        [656, 86],
        [884, 86],
      ],
      hint: "two latches, same moment",
    },
    {
      id: "coal",
      name: "Lay the drawing-room fire",
      type: "carry",
      need: 2.5,
      src: [142, 506],
      sink: [744, 120],
      quota: 1,
      item: "scuttle",
      hint: "fetch the coal scuttle, lay it well",
    },
    {
      id: "water",
      name: "Fill the bath jug",
      type: "carry",
      need: 1.2,
      src: [236, 228],
      sink: [850, 506],
      quota: 2,
      item: "jug",
      hint: "two jugs from the copper",
    },
    {
      id: "plates",
      name: "Lay the long table",
      type: "carry",
      need: 1,
      src: [322, 272],
      sink: [468, 470],
      quota: 2,
      item: "plates",
      slow: 0.72,
      hint: "two trips, mind the stack",
    },
  ];

  var TIPS = [
    "Stand still at a chore and it works itself.",
    "End a pass early with Enter once your yesterday is parked where she is needed.",
    "Two pads lit at the SAME moment is what twin chores demand.",
    "Yesterdays repeat exactly — plan pass one as if someone will copy it.",
    "Deliveries made by a yesterday still count. Yesterday was thorough.",
  ];

  var START_SPAWN = [480, 520];

  /* ---------- dom ---------- */

  function $(id) {
    return document.getElementById(id);
  }

  var canvas = $("house");
  var ctx = canvas.getContext("2d");
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * DPR;
  canvas.height = H * DPR;

  var elPassLabel = $("passLabel");
  var elClockFill = $("clockFill");
  var elClockText = $("clockText");
  var elTasks = $("tasks");
  var veil = $("veil");
  var veilTitle = $("veilTitle");
  var veilBody = $("veilBody");
  var veilCta = $("veilCta");

  /* ---------- audio ---------- */

  var ac = null;
  var master = null;
  var muted = false;

  function ensureAudio() {
    if (!ac) {
      try {
        ac = new window.AudioContext();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ac.destination);
      } catch (e) {
        ac = null;
      }
    }
    if (ac && ac.state === "suspended") {
      ac.resume();
    }
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ac || muted) {
      return;
    }
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) {
      o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  var CUES = {
    pickup: function () {
      tone(620, 0.08, "triangle", 0.12);
    },
    deliver: function () {
      tone(392, 0.12, "triangle", 0.14);
      tone(523, 0.16, "triangle", 0.12, 0, 0.07);
    },
    done: function () {
      tone(523, 0.1, "triangle", 0.15);
      tone(659, 0.12, "triangle", 0.13, 0, 0.08);
      tone(784, 0.22, "triangle", 0.12, 0, 0.16);
    },
    ring: function () {
      tone(880, 0.5, "sine", 0.14, 220);
      tone(1760, 0.35, "sine", 0.05, 440, 0.05);
    },
    rewind: function () {
      tone(300, 0.55, "sawtooth", 0.05, 90);
    },
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(f, 0.3, "triangle", 0.14, 0, i * 0.12);
      });
    },
    lose: function () {
      tone(330, 0.4, "sine", 0.14, 160);
      tone(220, 0.7, "sine", 0.12, 110, 0.25);
    },
    ticktock: function () {
      tone(1400, 0.03, "square", 0.04);
    },
  };

  function cue(name) {
    if (CUES[name]) {
      CUES[name]();
    }
  }

  /* ---------- state ---------- */

  var mode; // 'menu' | 'play' | 'rewind' | 'won' | 'lost'
  var paused;
  var passIdx; // index of the pass being played now
  var tick; // tick within the pass
  var rec; // rec[pass] = Uint8Array(ROUND_TICKS)
  var actors; // [{x,y,carry,settle,bob}]
  var tasks; // runtime copies of TASKS with prog/done/delivered
  var rewindT;
  var endT;
  var animT;
  var timeScale;
  var motes;
  var sparks;
  var usedTips;
  var lastCueTick;

  function freshTasks() {
    return TASKS.map(function (t) {
      return {
        id: t.id,
        def: t,
        prog: 0,
        done: false,
        delivered: 0,
      };
    });
  }

  function resetRun() {
    paused = false;
    passIdx = 0;
    tick = 0;
    rec = [];
    actors = [];
    tasks = freshTasks();
    rewindT = 0;
    endT = 0;
    animT = 0;
    timeScale = 1;
    sparks = [];
    usedTips = {};
    lastCueTick = -999;
    motes = [];
    for (var i = 0; i < 26; i++) {
      motes.push({
        x: 60 + Math.random() * (W - 120),
        y: 70 + Math.random() * (H - 140),
        s: 0.4 + Math.random() * 1.2,
        p: Math.random() * Math.PI * 2,
      });
    }
    syncLedger(true);
    syncHud();
  }

  function beginPass(idx) {
    passIdx = idx;
    tick = 0;
    rec[idx] = new Uint8Array(ROUND_TICKS);
    actors = [];
    for (var i = 0; i <= idx; i++) {
      actors.push({
        x: START_SPAWN[0],
        y: START_SPAWN[1],
        carry: null,
        settle: 0,
        bob: Math.PI * 2 * (i / 7),
      });
    }
    mode = "play";
    syncHud();
  }

  function startRun() {
    tasks = freshTasks();
    sparks = [];
    syncLedger(true);
    beginPass(0);
    cue("ring");
  }

  function endPass() {
    // pad the rest of this pass's recording with stillness so every
    // recording has identical length and replays align tick-for-tick
    var r = rec[passIdx];
    for (var t = tick; t < ROUND_TICKS; t++) {
      r[t] = 4;
    } // 4 = no movement
    if (allDone()) {
      return;
    } // win already handled
    if (passIdx + 1 >= MAX_PASS) {
      mode = "lost";
      endT = 1.6;
      cue("lose");
      return;
    }
    mode = "rewind";
    rewindT = 1.05;
    cue("rewind");
  }

  function allDone() {
    for (var i = 0; i < tasks.length; i++) {
      if (!tasks[i].done) {
        return false;
      }
    }
    return true;
  }

  function declareWin() {
    mode = "won";
    endT = 1.5;
    burst(480, 300, 60);
    cue("win");
  }

  function starsFor(passesUsed) {
    if (passesUsed <= 4) {
      return 3;
    }
    if (passesUsed <= 5) {
      return 2;
    }
    return 1;
  }

  /* ---------- input ---------- */

  var keys = Object.create(null);
  var joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  var PREVENT = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"];

  document.addEventListener("keydown", function (ev) {
    if (PREVENT.indexOf(ev.code) >= 0 && veil.hidden) {
      ev.preventDefault();
    }
    if (ev.repeat) {
      return;
    }
    keys[ev.code] = true;
    ensureAudio();
    if (ev.code === "Enter") {
      ringEarly();
    } else if (ev.code === "KeyP") {
      togglePause();
    } else if (ev.code === "KeyM") {
      toggleSound();
    } else if (ev.code === "KeyH") {
      showHelp();
    } else if (ev.code === "KeyR") {
      restartAll();
    }
  });

  document.addEventListener("keyup", function (ev) {
    keys[ev.code] = false;
  });

  canvas.addEventListener("pointerdown", function (ev) {
    ensureAudio();
    joy.active = true;
    joy.id = ev.pointerId;
    joy.ox = ev.clientX;
    joy.oy = ev.clientY;
    joy.x = 0;
    joy.y = 0;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* ok */
    }
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (!joy.active || ev.pointerId !== joy.id) {
      return;
    }
    var dx = ev.clientX - joy.ox;
    var dy = ev.clientY - joy.oy;
    var len = Math.hypot(dx, dy);
    var scale = len > 52 ? 52 / len : 1;
    joy.x = dx * scale;
    joy.y = dy * scale;
  });

  function joyEnd(ev) {
    if (joy.active && ev.pointerId === joy.id) {
      joy.active = false;
      joy.x = 0;
      joy.y = 0;
    }
  }
  canvas.addEventListener("pointerup", joyEnd);
  canvas.addEventListener("pointercancel", joyEnd);

  function liveDir() {
    var dx =
      (keys.ArrowRight || keys.KeyD ? 1 : 0) -
      (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    var dy =
      (keys.ArrowDown || keys.KeyS ? 1 : 0) -
      (keys.ArrowUp || keys.KeyW ? 1 : 0);
    if (dx === 0 && dy === 0 && joy.active) {
      dx = Math.abs(joy.x) > 12 ? (joy.x > 0 ? 1 : -1) : 0;
      dy = Math.abs(joy.y) > 12 ? (joy.y > 0 ? 1 : -1) : 0;
    }
    return [dx, dy];
  }

  function packDir(dx, dy) {
    return dx + 1 + 3 * (dy + 1);
  }

  function unpackDir(b) {
    return [(b % 3) - 1, Math.floor(b / 3) - 1];
  }

  /* ---------- physics ---------- */

  function hitsWall(x, y) {
    for (var i = 0; i < WALLS.length; i++) {
      var r = WALLS[i];
      var cx = Math.max(r.x, Math.min(x, r.x + r.w));
      var cy = Math.max(r.y, Math.min(y, r.y + r.h));
      var ddx = x - cx;
      var ddy = y - cy;
      if (ddx * ddx + ddy * ddy < ACT_R * ACT_R) {
        return true;
      }
    }
    return false;
  }

  function moveActor(a, dx, dy) {
    if (dx !== 0) {
      a.x += dx;
      if (hitsWall(a.x, a.y)) {
        a.x -= dx;
      }
    }
    if (dy !== 0) {
      a.y += dy;
      if (hitsWall(a.x, a.y)) {
        a.y -= dy;
      }
    }
  }

  function near(px, py, x, y, r) {
    var dx = px - x;
    var dy = py - y;
    return dx * dx + dy * dy <= r * r;
  }

  /* ---------- simulation ---------- */

  function stepTick() {
    var cur = liveDir();
    rec[passIdx][tick] = packDir(cur[0], cur[1]);

    var i;
    var a;
    var d;

    // settle-first: anyone mid-delivery stands still while they work
    for (i = 0; i < actors.length; i++) {
      a = actors[i];
      var def = a.carry ? taskById(a.carry).def : null;
      var settling = false;
      if (def) {
        var sk = def.sink;
        if (near(a.x, a.y, sk[0], sk[1], 26)) {
          settling = true;
          a.settle += TICK;
          if (a.settle >= def.need) {
            a.settle = 0;
            a.carry = null;
            deliver(def.id, i);
          }
        }
      }
      if (!settling) {
        var b = i < passIdx ? rec[i][tick] : rec[passIdx][tick];
        d = unpackDir(b);
        var ux = d[0];
        var uy = d[1];
        var len = Math.hypot(ux, uy);
        a.moving = false;
        if (len > 0) {
          ux /= len;
          uy /= len;
          var sp = SPEED * (def && def.slow ? def.slow : 1);
          a.bob += TICK * 11;
          a.moving = true;
          moveActor(a, ux * sp * TICK, uy * sp * TICK);
        }
      } else {
        a.moving = false;
      }
    }

    // pickups: each walker may lift her own phantom copy straight from the
    // source — always, even for finished chores, so a yesterday repeating an
    // old delivery round freezes and slows at exactly the same ticks she did
    // when the round was first recorded. Deliveries beyond quota simply count
    // for nothing (deliver() guards that); the motion stays faithful.
    for (i = 0; i < actors.length; i++) {
      a = actors[i];
      if (a.carry) {
        continue;
      }
      for (var k = 0; k < TASKS.length; k++) {
        var td = TASKS[k];
        if (td.type !== "carry") {
          continue;
        }
        if (near(a.x, a.y, td.src[0], td.src[1], 20)) {
          a.carry = td.id;
          if (i === passIdx && !taskById(td.id).done) {
            cue("pickup");
          }
          break;
        }
      }
    }

    // chores: hold and twin progress

    for (i = 0; i < TASKS.length; i++) {
      var t = TASKS[i];
      var st2 = taskById(t.id);
      if (st2.done || t.type === "carry") {
        continue;
      }
      var occupied = [];
      var anyPad = false;
      var allPads = true;
      for (var p = 0; p < t.pads.length; p++) {
        var cnt = 0;
        for (var j = 0; j < actors.length; j++) {
          if (near(actors[j].x, actors[j].y, t.pads[p][0], t.pads[p][1], 24)) {
            cnt++;
          }
        }
        occupied.push(cnt > 0);
        if (cnt > 0) {
          anyPad = true;
        } else {
          allPads = false;
        }
      }
      var rate = 0;
      if (t.type === "hold") {
        var holders = 0;
        for (var q = 0; q < actors.length; q++) {
          if (near(actors[q].x, actors[q].y, t.pads[0][0], t.pads[0][1], 24)) {
            holders++;
          }
        }
        rate = Math.min(holders, 2);
      } else if (allPads) {
        rate = 1;
      }
      if (rate > 0 && !st2.done) {
        st2.prog += rate * TICK;
        if (st2.prog >= t.need) {
          st2.prog = t.need;
          st2.done = true;
          onDone(st2);
        }
      }
    }

    if (tick % 60 === 59 && ROUND_TICKS - tick <= 180 && mode === "play") {
      if (tick - lastCueTick > 60) {
        lastCueTick = tick;
        cue("ticktock");
      }
    }

    tick++;

    if (allDone()) {
      declareWin();
      return;
    }
    if (tick >= ROUND_TICKS) {
      endPass();
    }
  }

  function taskById(id) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) {
        return tasks[i];
      }
    }
    return null;
  }

  function deliver(id, who) {
    var st = taskById(id);
    if (!st || st.done) {
      return;
    }
    if (st.delivered < st.def.quota) {
      st.delivered++;
      if (who === passIdx) {
        cue("deliver");
      }
      if (st.delivered >= st.def.quota) {
        st.done = true;
        onDone(st);
        return;
      }
    }
    syncLedger(false);
  }

  function onDone(st) {
    var anchor =
      st.def.type === "carry"
        ? st.def.sink
        : [st.def.pads[0][0], st.def.pads[0][1]];
    burst(anchor[0], anchor[1], 18);
    cue("done");
    syncLedger(false);
  }

  function burst(x, y, n) {
    for (var i = 0; i < n; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = 30 + Math.random() * 90;
      sparks.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        life: 0.7 + Math.random() * 0.6,
        t: 0,
      });
    }
  }

  /* ---------- hud / ledger ---------- */

  function syncLedger(rebuild) {
    if (rebuild) {
      elTasks.innerHTML = "";
      tasks.forEach(function (st) {
        var li = document.createElement("li");
        li.className = "todo";
        li.dataset.task = st.id;
        var nm = document.createElement("span");
        nm.className = "name";
        nm.textContent = st.def.name;
        var hn = document.createElement("span");
        hn.className = "hint";
        hn.textContent = hintFor(st);
        li.appendChild(nm);
        li.appendChild(hn);
        elTasks.appendChild(li);
      });
      return;
    }
    Array.prototype.forEach.call(elTasks.children, function (li) {
      var st = taskById(li.dataset.task);
      if (!st) {
        return;
      }
      var wasDone = li.classList.contains("done");
      li.classList.toggle("done", st.done);
      li.classList.toggle("todo", !st.done);
      li.querySelector(".hint").textContent = hintFor(st);
      if (!wasDone && st.done) {
        li.classList.add("justnow");
      }
    });
  }

  function hintFor(st) {
    if (st.done) {
      return "done, thank goodness";
    }
    if (st.def.type === "carry") {
      var left = st.def.quota - st.delivered;
      if (left < st.def.quota && left > 0) {
        return st.delivered + " of " + st.def.quota + " set down";
      }
      return st.def.hint;
    }
    if (st.prog > 0) {
      return st.prog.toFixed(1) + " of " + st.def.need.toFixed(1) + " seconds";
    }
    return st.def.hint;
  }

  function syncHud() {
    elPassLabel.textContent = "Pass " + (passIdx + 1) + " of " + MAX_PASS;
  }

  function syncClock() {
    var remain = Math.max(0, (ROUND_TICKS - tick) / 60);
    elClockFill.style.width = (100 * remain * 60) / ROUND_TICKS + "%";
    var m = Math.floor(remain / 60);
    var s = Math.floor(remain % 60);
    elClockText.textContent = m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------- overlay veil ---------- */

  function showVeil(title, bodyHTML, ctaLabel, onCta) {
    veilTitle.textContent = title;
    veilBody.innerHTML = bodyHTML;
    veilCta.textContent = ctaLabel;
    veilCta.onclick = function () {
      ensureAudio();
      onCta();
    };
    veil.hidden = false;
    veilCta.focus();
  }

  function hideVeil() {
    veil.hidden = true;
    veilCta.onclick = null;
  }

  function howHTML(withPremise) {
    var pre = withPremise
      ? "<p><em>Ball day. The family has gone into town, the first carriage is " +
        "expected by evening, and the whole staff of the great house is&hellip; you.</em></p>"
      : "";
    return (
      '<div class="prose">' +
      pre +
      "<p>Each pass lasts forty seconds. When it ends, the morning rewinds and your " +
      "every step repeats as a golden <em>yesterday</em> — while you walk free " +
      "beside her. Chores marked <em>two pairs of hands</em> need people standing " +
      "on their pads at the same moment, so park a yesterday where the next pass needs her.</p>" +
      "<ul>" +
      "<li><kbd>WASD</kbd> / <kbd>&larr;&uarr;&darr;&rarr;</kbd> or touch-drag anywhere to walk</li>" +
      "<li>Standing at a chore works it; finished work stays finished</li>" +
      "<li><kbd>Enter</kbd> rings the bell to end the pass early</li>" +
      "<li><kbd>P</kbd> pause &middot; <kbd>M</kbd> sound &middot; <kbd>H</kbd> this card &middot; <kbd>R</kbd> start over</li>" +
      "</ul>" +
      "<p>Strike every chore off the ledger within six passes, before the carriage " +
      "rolls up. <em>" +
      TIPS[Math.floor(Math.random() * TIPS.length)] +
      "</em></p>" +
      "</div>"
    );
  }

  function showStart() {
    mode = "menu";
    showVeil(
      "Everywhere at Once",
      howHTML(true),
      "Begin the first pass",
      function () {
        hideVeil();
        startRun();
      },
    );
  }

  function showHelp() {
    if (mode === "play" && !paused) {
      paused = true;
    }
    showVeil(
      "How to play",
      howHTML(false),
      paused ? "Back to the house" : "Very well",
      function () {
        hideVeil();
      },
    );
  }

  function showEnd() {
    var won = mode === "won";
    var passesUsed = passIdx + 1;
    var stars = won ? starsFor(passesUsed) : 0;
    var starStr = "";
    for (var i = 0; i < 3; i++) {
      starStr += i < stars ? "★" : "☆";
    }
    var body = '<div class="prose">';
    if (won) {
      body += '<p class="stars">' + starStr + "</p>";
      body +=
        '<p class="scoreline">The house is ready in ' +
        passesUsed +
        " pass" +
        (passesUsed > 1 ? "es" : "") +
        ". The carriage wheels grind the gravel, " +
        "the door swings wide, and everything gleams.</p>";
    } else {
      var leftCount = tasks.filter(function (t) {
        return !t.done;
      }).length;
      body +=
        '<p class="scoreline">The carriage is earlier than the house. ' +
        leftCount +
        " chore" +
        (leftCount === 1 ? "" : "s") +
        " still on the ledger.</p>";
      body +=
        "<p><em>Tomorrow, park yesterday where tomorrow needs her.</em></p>";
    }
    body += "</div>";
    showVeil(
      won ? "The ball begins" : "Dawn comes too soon",
      body,
      won ? "Another morning" : "Try the morning again",
      function () {
        hideVeil();
        resetRunSoft();
        startRun();
      },
    );
  }

  function resetRunSoft() {
    tasks = freshTasks();
    sparks = [];
    passIdx = 0;
    tick = 0;
    rec = [];
    actors = [];
    paused = false;
    $("btnPause").textContent = "Pause";
    syncLedger(true);
    syncHud();
  }

  function restartAll() {
    hideVeil();
    resetRunSoft();
    mode = "menu";
    showStart();
  }

  function togglePause() {
    if (mode !== "play") {
      return;
    }
    paused = !paused;
    if (paused) {
      showVeil(
        "Paused",
        '<div class="prose"><p>The clock holds its breath.</p>' +
          "<p><em>" +
          TIPS[Math.floor(Math.random() * TIPS.length)] +
          "</em></p></div>",
        "Resume",
        function () {
          paused = false;
          hideVeil();
        },
      );
    } else {
      hideVeil();
    }
    $("btnPause").textContent = paused ? "Resume" : "Pause";
  }

  function toggleSound() {
    muted = !muted;
    ensureAudio();
    if (master) {
      master.gain.value = muted ? 0 : 0.5;
    }
    var b = $("btnSound");
    b.setAttribute("aria-pressed", String(!muted));
    b.textContent = muted ? "Muted" : "Sound";
  }

  function ringEarly() {
    if (mode !== "play" || paused || tick < 60) {
      return;
    }
    cue("ring");
    endPass();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && mode === "play" && !paused) {
      togglePause();
    }
  });

  $("btnRing").addEventListener("click", ringEarly);
  $("btnPause").addEventListener("click", togglePause);
  $("btnSound").addEventListener("click", toggleSound);
  $("btnHelp").addEventListener("click", showHelp);
  $("btnRestart").addEventListener("click", restartAll);

  /* ---------- drawing ---------- */

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // floors
    ROOMS.forEach(function (r, idx) {
      ctx.fillStyle = idx === 2 ? "#e9d7ae" : idx % 2 ? "#ddc496" : "#e3cda2";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "rgba(107,82,51,0.12)";
      ctx.lineWidth = 1;
      for (var yy = r.y + 22; yy < r.y + r.h; yy += 22) {
        ctx.beginPath();
        ctx.moveTo(r.x + 3, yy);
        ctx.lineTo(r.x + r.w - 3, yy);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(107,82,51,0.4)";
      ctx.font = "11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(r.n.toUpperCase(), r.x + r.w / 2, r.y + 16);
    });

    drawFurniture();

    // walls
    WALLS.forEach(function (wl) {
      ctx.fillStyle = wl.h > wl.w ? "#46331f" : "#46331f";
      ctx.fillRect(wl.x, wl.y, wl.w, wl.h);
    });

    drawTaskAnchors();
    drawSourcesAndSinks();
    drawActors();
    drawSparks();
    drawMotes();

    // vignette
    var vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.45,
      W / 2,
      H / 2,
      H * 0.85,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(43,30,16,0.28)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (mode === "rewind") {
      drawRewindText();
    }
    if (mode === "won" || mode === "lost") {
      drawEndFlash();
    }
  }

  function drawFurniture() {
    ctx.textAlign = "center";
    // front door (bottom of hall)
    ctx.fillStyle = "#5b3d21";
    ctx.fillRect(430, 548, 80, 32);
    ctx.strokeStyle = "#3a2713";
    ctx.lineWidth = 2;
    ctx.strokeRect(430, 548, 80, 32);
    ctx.beginPath();
    ctx.moveTo(470, 548);
    ctx.lineTo(470, 580);
    ctx.stroke();
    ctx.fillStyle = "#c9972f";
    ctx.beginPath();
    ctx.arc(462, 566, 3, 0, 7);
    ctx.fill();

    // range
    ctx.fillStyle = "#4a4a4a";
    ctx.fillRect(84, 112, 42, 34);
    ctx.fillStyle = taskById("range").done ? "#e07b39" : "#333";
    for (var b = 0; b < 2; b++) {
      ctx.beginPath();
      ctx.arc(95 + b * 20, 129, 6, 0, 7);
      ctx.fill();
    }

    // copper pot (kettle task)
    ctx.strokeStyle = "#7a5a33";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(255, 132, 17, 0, 7);
    ctx.stroke();
    if (taskById("kettle").done) {
      steam(255, 112);
    }

    // chandelier rope + garland
    var garl = taskById("garland").done;
    ctx.strokeStyle = "#6b5233";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(448, 52);
    ctx.lineTo(448, garl ? 74 : 150);
    ctx.stroke();
    if (garl) {
      ctx.strokeStyle = "#4a7a3a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(380, 62);
      ctx.quadraticCurveTo(448, 92, 516, 62);
      ctx.stroke();
      ctx.fillStyle = "#c9972f";
      for (var g = 0; g < 4; g++) {
        ctx.beginPath();
        ctx.arc(398 + g * 33, 68 + (g % 2) * 8, 3, 0, 7);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#c9972f";
      ctx.beginPath();
      ctx.arc(448, 152, 7, 0, 7);
      ctx.fill();
    }

    // rug
    ctx.fillStyle = taskById("sweep").done ? "#a33f2e" : "#8f4436";
    roundRect(400, 372, 104, 54, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,240,210,0.5)";
    ctx.lineWidth = 1.5;
    roundRect(408, 380, 88, 38, 5);
    ctx.stroke();

    // case clock
    ctx.fillStyle = "#5b3d21";
    ctx.fillRect(560, 76, 22, 56);
    ctx.fillStyle = "#efe3cb";
    ctx.beginPath();
    ctx.arc(571, 90, 7, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#33261a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(571, 90);
    ctx.lineTo(571 + 4 * Math.cos(animT), 90 + 4 * Math.sin(animT));
    ctx.stroke();

    // windows + shutters
    var shut = taskById("shutters").done;
    [640, 866].forEach(function (wx) {
      ctx.fillStyle = shut ? "#bcd6e4" : "#5b3d21";
      ctx.fillRect(wx, 54, 60, 26);
      ctx.strokeStyle = "#3a2713";
      ctx.lineWidth = 2;
      ctx.strokeRect(wx, 54, 60, 26);
      if (shut) {
        ctx.strokeStyle = "rgba(58,39,19,0.5)";
        ctx.beginPath();
        ctx.moveTo(wx + 30, 54);
        ctx.lineTo(wx + 30, 80);
        ctx.moveTo(wx, 67);
        ctx.lineTo(wx + 60, 67);
        ctx.stroke();
      }
    });

    // hearth
    var fire = taskById("coal").done;
    ctx.fillStyle = "#5b4a33";
    ctx.fillRect(720, 84, 64, 42);
    ctx.fillStyle = "#33261a";
    ctx.fillRect(728, 100, 48, 26);
    if (fire) {
      var fl = 1 + Math.sin(animT * 9) * 0.2;
      ctx.fillStyle = "#e07b39";
      ctx.beginPath();
      ctx.moveTo(752, 122);
      ctx.quadraticCurveTo(742, 112 * fl, 752, 102);
      ctx.quadraticCurveTo(762, 112 * fl, 752, 122);
      ctx.fill();
      ctx.fillStyle = "#f2b134";
      ctx.beginPath();
      ctx.arc(752, 116, 4 * fl, 0, 7);
      ctx.fill();
    }

    // bath tub
    ctx.strokeStyle = "#7a5a33";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(850, 508, 34, 20, 0, 0, 7);
    ctx.stroke();
    var wat = taskById("water").delivered / 2;
    if (wat > 0) {
      ctx.fillStyle = "rgba(120,170,205,0.55)";
      ctx.beginPath();
      ctx.ellipse(850, 508, 29, 15 * wat + 2, 0, 0, 7);
      ctx.fill();
    }

    // long table
    ctx.fillStyle = "#7a5a33";
    ctx.fillRect(400, 452, 150, 30);
    ctx.fillStyle = "#efe3cb";
    var laid = taskById("plates").delivered;
    for (var pl = 0; pl < laid; pl++) {
      ctx.beginPath();
      ctx.ellipse(420 + pl * 36, 467, 12, 7, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = "#b09b6c";
      ctx.stroke();
    }

    // pantry shelf
    ctx.fillStyle = "#5b3d21";
    ctx.fillRect(304, 256, 46, 30);
    ctx.fillStyle = "#efe3cb";
    for (var ps = 0; ps < 3; ps++) {
      ctx.fillRect(308 + ps * 14, 260, 10, 12);
    }

    // coal bin
    ctx.fillStyle = "#4a3a28";
    ctx.fillRect(118, 490, 50, 34);
    ctx.fillStyle = "#211a12";
    ctx.beginPath();
    ctx.ellipse(143, 492, 22, 8, 0, 0, 7);
    ctx.fill();

    // scullery sink
    ctx.strokeStyle = "#7a5a33";
    ctx.lineWidth = 3;
    ctx.strokeRect(56, 516, 44, 26);
  }

  function steam(x, y) {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    for (var s = 0; s < 2; s++) {
      var ph = animT * 2 + s * 2;
      ctx.beginPath();
      ctx.arc(x - 5 + s * 10, y - 8 - ((ph * 6) % 18), 3.5, 0, 7);
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTaskAnchors() {
    TASKS.forEach(function (t) {
      var st = taskById(t.id);
      if (t.type === "carry") {
        // source glint + sink pip progress
        if (!st.done) {
          ctx.fillStyle = "rgba(201,151,47,0.85)";
          ctx.beginPath();
          ctx.arc(t.src[0], t.src[1], 5 + Math.sin(animT * 3) * 1.5, 0, 7);
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(58,39,19,0.55)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.sink[0], t.sink[1], 26, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
        for (var q = 0; q < t.quota; q++) {
          ctx.fillStyle = q < st.delivered ? "#4a7a3a" : "rgba(58,39,19,0.25)";
          ctx.beginPath();
          ctx.arc(
            t.sink[0] - (t.quota - 1) * 6 + q * 12,
            t.sink[1] + 34,
            4,
            0,
            7,
          );
          ctx.fill();
        }
        return;
      }
      var cx = 0;
      var cy = 0;
      t.pads.forEach(function (p) {
        cx += p[0];
        cy += p[1];
        ctx.strokeStyle = "rgba(169,126,31,0.9)";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 22, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(201,151,47,0.18)";
        ctx.fill();
      });
      cx /= t.pads.length;
      cy /= t.pads.length;
      // progress arc
      var frac = Math.min(1, st.prog / t.need);
      if (frac > 0 && !st.done) {
        ctx.strokeStyle = "#c9972f";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }
      if (st.done) {
        ctx.strokeStyle = "#4a7a3a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 30, 0, Math.PI * 2);
        ctx.stroke();
      }
      // twin coaching: one pad held, other empty
      if (t.type === "twin" && !st.done) {
        var occ = t.pads.map(function (p) {
          return actors.some(function (a) {
            return near(a.x, a.y, p[0], p[1], 24);
          });
        });
        if (occ[0] !== occ[1] && Math.floor(animT * 2) % 2 === 0) {
          var empty = t.pads[occ[0] ? 1 : 0];
          ctx.fillStyle = "rgba(51,38,26,0.85)";
          ctx.font = "italic 12px Georgia, serif";
          ctx.fillText("needs another pair of hands", empty[0], empty[1] - 30);
        }
      }
    });
  }

  function drawSourcesAndSinks() {
    // carried items hover over heads; sources get little icons
    TASKS.filter(function (t) {
      return t.type === "carry";
    }).forEach(function (t) {
      var st = taskById(t.id);
      if (!st.done && st.delivered < t.quota) {
        drawItem(t.item, t.src[0], t.src[1] - 6, 0);
      }
    });
  }

  function drawItem(kind, x, y, bobY) {
    ctx.save();
    ctx.translate(x, y + bobY);
    if (kind === "scuttle") {
      ctx.fillStyle = "#33261a";
      ctx.fillRect(-9, -6, 18, 12);
      ctx.strokeStyle = "#211a12";
      ctx.beginPath();
      ctx.moveTo(-9, -6);
      ctx.quadraticCurveTo(0, -16, 9, -6);
      ctx.stroke();
    } else if (kind === "jug") {
      ctx.fillStyle = "#b0773a";
      ctx.fillRect(-5, -10, 10, 14);
      ctx.fillRect(3, -8, 5, 4);
    } else {
      ctx.fillStyle = "#efe3cb";
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 6, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = "#b09b6c";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawActors() {
    var order = actors
      .map(function (a, i) {
        return i;
      })
      .sort(function (ia, ib) {
        return actors[ia].y - actors[ib].y;
      });
    order.forEach(function (i) {
      var a = actors[i];
      var isCur = i === passIdx;
      var ghostAge = passIdx - i;
      var alpha = isCur ? 1 : Math.max(0.25, 0.55 - ghostAge * 0.07);
      var moving = !!a.moving;
      var bobY = Math.sin(a.bob) * (moving ? 1.6 : 0);

      ctx.save();
      ctx.globalAlpha = alpha;

      // shadow
      ctx.fillStyle = "rgba(43,30,16,0.3)";
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + 12, 10, 4, 0, 0, 7);
      ctx.fill();

      if (isCur) {
        var glow = ctx.createRadialGradient(a.x, a.y, 4, a.x, a.y, 34);
        glow.addColorStop(0, "rgba(255,244,214,0.5)");
        glow.addColorStop(1, "rgba(255,244,214,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 34, 0, 7);
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(190,148,40,0.8)";
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 19, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // skirt
      ctx.fillStyle = isCur ? "#33291f" : "rgba(190,148,40,0.9)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 6 + bobY);
      ctx.lineTo(a.x - 9, a.y + 11 + bobY);
      ctx.lineTo(a.x + 9, a.y + 11 + bobY);
      ctx.closePath();
      ctx.fill();
      // apron
      ctx.fillStyle = isCur ? "#efe3cb" : "rgba(250,238,205,0.85)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 2 + bobY);
      ctx.lineTo(a.x - 4, a.y + 9 + bobY);
      ctx.lineTo(a.x + 4, a.y + 9 + bobY);
      ctx.closePath();
      ctx.fill();
      // head + cap
      ctx.fillStyle = isCur ? "#e8c9a0" : "rgba(245,225,180,0.9)";
      ctx.beginPath();
      ctx.arc(a.x, a.y - 11 + bobY, 5.5, 0, 7);
      ctx.fill();
      ctx.fillStyle = isCur ? "#fdf6e6" : "rgba(253,246,230,0.9)";
      ctx.beginPath();
      ctx.arc(a.x, a.y - 14.5 + bobY, 3.4, Math.PI, 0);
      ctx.fill();

      if (a.carry) {
        drawItem(taskById(a.carry).def.item, a.x, a.y - 26 + bobY, 0);
      }

      // label
      ctx.globalAlpha = Math.min(1, alpha + 0.2);
      ctx.fillStyle = isCur ? "#33261a" : "rgba(140,105,30,0.95)";
      ctx.font = "9px Georgia, serif";
      ctx.textAlign = "center";
      var label = isCur
        ? "you"
        : (["first", "second", "third", "fourth", "fifth"][i - 1] ||
            i + 1 + "th") + " pass";
      ctx.fillText(label, a.x, a.y + 24);
      ctx.restore();
    });
  }

  function drawSparks() {
    sparks.forEach(function (s) {
      var a = 1 - s.t / s.life;
      if (a <= 0) {
        return;
      }
      ctx.fillStyle = "rgba(212,175,55," + (a * 0.9).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2 * a + 0.6, 0, 7);
      ctx.fill();
    });
  }

  function drawMotes() {
    ctx.fillStyle = "rgba(255,240,205,0.35)";
    motes.forEach(function (m) {
      var mx = m.x + Math.sin(animT * 0.5 + m.p) * 14;
      var my = m.y + Math.cos(animT * 0.35 + m.p) * 9;
      ctx.beginPath();
      ctx.arc(mx, my, m.s, 0, 7);
      ctx.fill();
    });
  }

  function drawRewindText() {
    var a = Math.min(1, rewindT / 1.05);
    ctx.fillStyle = "rgba(43,30,16," + (0.45 * a).toFixed(3) + ")";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(250,238,205,0.95)";
    ctx.font = "26px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("The morning rewinds…", W / 2, H / 2 - 14);
    ctx.font = "italic 15px Georgia, serif";
    ctx.fillText(
      "Pass " +
        (passIdx + 2) +
        " — your " +
        ordinalWord(passIdx) +
        " pass repeats it exactly.",
      W / 2,
      H / 2 + 16,
    );
    ctx.font = "italic 12px Georgia, serif";
    ctx.fillText(TIPS[passIdx % TIPS.length], W / 2, H / 2 + 42);
  }

  function ordinalWord(zeroBasedJustEnded) {
    return (
      ["first", "second", "third", "fourth", "fifth"][zeroBasedJustEnded] ||
      "earlier"
    );
  }

  function drawEndFlash() {
    var a = Math.max(0, Math.min(1, endT / 1.6));
    ctx.fillStyle =
      mode === "won"
        ? "rgba(212,175,55," + (0.18 * (1 - a)).toFixed(3) + ")"
        : "rgba(43,30,16," + (0.35 * a).toFixed(3) + ")";
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- main loop ---------- */

  var last = performance.now();
  var acc = 0;

  function frame(now) {
    var dtms = Math.min(50, now - last);
    last = now;
    animT += dtms / 1000;

    if (mode === "play" && !paused) {
      acc += (dtms / 1000) * timeScale;
      var guard = 0;
      while (acc >= TICK && mode === "play" && guard < 30) {
        stepTick();
        acc -= TICK;
        guard++;
      }
    } else if (mode === "rewind") {
      rewindT -= dtms / 1000;
      if (rewindT <= 0) {
        beginPass(passIdx + 1);
      }
    } else if (mode === "won" || mode === "lost") {
      endT -= dtms / 1000;
      if (endT <= 0 && veil.hidden) {
        showEnd();
      }
    }

    sparks.forEach(function (s) {
      s.t += dtms / 1000;
      s.x += (s.vx * dtms) / 1000;
      s.y += (s.vy * dtms) / 1000;
      s.vy += (60 * dtms) / 1000;
    });
    sparks = sparks.filter(function (s) {
      return s.t < s.life;
    });

    syncClock();
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------- debug harness (only with #debug) ---------- */

  if (/#debug/.test(window.location.hash)) {
    window.__EO = {
      pos: function (i) {
        var a = actors[i === undefined ? passIdx : i];
        return a ? [Math.round(a.x), Math.round(a.y)] : null;
      },
      warp: function (x, y) {
        var a = actors[passIdx];
        if (a) {
          a.x = x;
          a.y = y;
        }
      },
      tasks: function () {
        return tasks.map(function (t) {
          return {
            id: t.id,
            done: t.done,
            prog: +t.prog.toFixed(2),
            delivered: t.delivered,
          };
        });
      },
      mode: function () {
        return mode + (paused ? ":paused" : "");
      },
      pass: function () {
        return passIdx;
      },
      endPass: function () {
        if (mode === "play") {
          endPass();
        }
      },
      begin: function () {
        hideVeil();
        startRun();
      },
      setSpeed: function (m) {
        timeScale = m;
      },
      grant: function (id) {
        var st = taskById(id);
        if (st && !st.done) {
          st.done = true;
          st.prog = st.def.need;
          onDone(st);
        }
      },
      key: function (code, down) {
        keys[code] = !!down;
      },
      tickNow: function () {
        return tick;
      },
      carry: function (i) {
        var a = actors[i === undefined ? passIdx : i];
        return a ? a.carry : null;
      },
    };
  }

  /* ---------- go ---------- */

  resetRun();
  showStart();
  requestAnimationFrame(frame);
})();
