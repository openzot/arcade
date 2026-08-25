/* Keen Ice — a village curling bonspiel.
   All behaviour lives in this one classic script, wrapped in an IIFE. */

(function () {
  "use strict";

  /* ============================== helpers ============================== */

  var TAU = Math.PI * 2;
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function gauss() {
    var u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  function $(id) {
    return document.getElementById(id);
  }

  /* ============================ world model =========================== */

  // Metres. The sheet runs from y = HACK_Y (near end, camera bottom)
  // up to the far back line around y = 36.
  var SHEET_W = 4.75;
  var STONE_R = 0.145;
  var HOUSE_CENTRE_Y = 34.0; // the tee
  var RINGS = [0.152, 0.61, 1.22, 1.83]; // button, 4ft, 8ft, 12ft
  var BACK_LINE = HOUSE_CENTRE_Y + 1.83;
  var HOG_FAR = HOUSE_CENTRE_Y - 6.4;
  var HACK_Y = 0.9;
  var LEN = 40;

  var FRICTION_A = 0.62; // m/s² deceleration, unswept
  var SWEEP_FRICTION_A = 0.42; // sweeping eases friction → longer shots
  var CURL_PUSH = 0.3; // lateral acceleration as the stone slows
  var SWEEP_STRAIGHTEN = 0.45; // sweeping reduces the bend too
  var RESTITUTION = 0.96;
  var MIN_SPEED = 2.2;
  var MAX_SPEED = 7.4;

  function Stone(team) {
    this.team = team; // 0 = you (red), 1 = Bessie (gold)
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.spin = -1; // −1 in-turn, +1 out-turn
    this.moving = false;
    this.alive = false;
    this.trail = [];
  }

  var world = {
    stones: [],
    current: null,
    phase: "title", // title | aim | charge | running | aiwait | scored | over | paused
    prevPhase: "aim",
    end: 1,
    ENDS: 4,
    PER_END: 8,
    thrownThisEnd: 0,
    scores: [0, 0],
    hammerTeam: 1, // who throws last in the current end
    stamina: 1,
    aimAngle: 0, // radians off the centreline
    curlDir: -1,
    chargeT: 0,
    chargePower: 0,
    sweetLo: 0.64,
    sweetHi: 0.8,
    shake: 0,
    lastResult: null,
  };

  function resetStones() {
    world.stones = [];
    for (var i = 0; i < world.PER_END; i++) world.stones.push(new Stone(i % 2));
  }

  /* --------------------------- shot resolution ------------------------ */

  function launch(power, angle, curlDir) {
    var s = world.stones[world.thrownThisEnd];
    s.team = whoseTurn();
    s.passedHog = false;
    s.trail.length = 0;
    s.x = 0;
    s.y = HACK_Y + 0.35;
    var speed = lerp(MIN_SPEED, MAX_SPEED, power);
    s.vx = Math.sin(angle) * speed;
    s.vy = Math.cos(angle) * speed;
    s.spin = curlDir;
    s.moving = true;
    s.alive = true;
    world.current = s;
    world.phase = "running";
    world.stamina = 1;
    UI.setSweepEnabled(true);
  }

  function whoseTurn() {
    return world.thrownThisEnd % 2 === 0 ? 0 : 1;
  }

  function stepStone(s, dt, swept) {
    if (!s.moving || !s.alive) return;
    var sp = Math.hypot(s.vx, s.vy);
    if (sp <= 0.08) {
      s.moving = false;
      s.vx = s.vy = 0;
      return;
    }
    var dec = swept ? SWEEP_FRICTION_A : FRICTION_A;
    var slowFactor = clamp(1 - sp / MAX_SPEED, 0, 1);
    var curlAcc =
      CURL_PUSH *
      slowFactor *
      slowFactor *
      s.spin *
      (swept ? 1 - SWEEP_STRAIGHTEN : 1);
    var nx = s.vx / sp,
      ny = s.vy / sp;
    s.vx += ny * curlAcc * dt;
    s.vy += -nx * curlAcc * dt;
    sp = Math.hypot(s.vx, s.vy);
    var ns = Math.max(0, sp - dec * dt);
    var k = ns / sp;
    s.vx *= k;
    s.vy *= k;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (Math.random() < dt * 22) {
      s.trail.push({ x: s.x, y: s.y });
      if (s.trail.length > 90) s.trail.shift();
    }
  }

  // once a stone is past the far hog line it may be knocked back short legally
  function trackHog(list) {
    for (var i = 0; i < list.length; i++) {
      var st = list[i];
      if (st.alive && !st.passedHog && st.y > HOG_FAR + STONE_R) {
        st.passedHog = true;
      }
    }
  }

  function collideAll(list) {
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var a = list[i],
          b = list[j];
        if (!a.alive || !b.alive || (!a.moving && !b.moving)) continue;
        var dx = b.x - a.x,
          dy = b.y - a.y;
        var d = Math.hypot(dx, dy),
          min = STONE_R * 2;
        if (d >= min || d === 0) continue;
        var nx = dx / d,
          ny = dy / d;
        var ov = min - d;
        a.x -= (nx * ov) / 2;
        a.y -= (ny * ov) / 2;
        b.x += (nx * ov) / 2;
        b.y += (ny * ov) / 2;
        var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) continue;
        var imp = (-(1 + RESTITUTION) * rel) / 2;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
        var hit = clamp(Math.abs(rel) / 4, 0.12, 1);
        Sfx.clack(hit);
        world.shake = Math.min(1, world.shake + hit * 0.7);
        if (!a.moving && Math.hypot(a.vx, a.vy) > 0.03) a.moving = true;
        if (!b.moving && Math.hypot(b.vx, b.vy) > 0.03) b.moving = true;
      }
    }
  }

  function activeStones() {
    var out = [];
    if (world.current && world.current.alive) out.push(world.current);
    for (var i = 0; i < world.stones.length; i++) {
      var s = world.stones[i];
      if (s !== world.current && s.alive) out.push(s);
    }
    return out;
  }

  function anyMoving() {
    var act = activeStones();
    for (var i = 0; i < act.length; i++) if (act[i].moving) return true;
    return false;
  }

  function housekeepingAfterMotion() {
    var notes = [];
    var act = activeStones();
    for (var i = 0; i < act.length; i++) {
      var s = act[i];
      if (!s.alive) continue;
      if (Math.hypot(s.vx, s.vy) <= 0.1) {
        s.moving = false;
        s.vx = 0;
        s.vy = 0;
      }
      if (s.moving) continue;
      if (s.y > BACK_LINE + STONE_R) {
        s.alive = false;
        notes.push("Off the back!");
      } else if (Math.abs(s.x) > SHEET_W / 2 + STONE_R) {
        s.alive = false;
        notes.push("Off the sheet!");
      } else if (s.y < HOG_FAR && !s.passedHog) {
        s.alive = false;
        notes.push(
          s === world.current ? "Hogged — lifted!" : "Knocked back short!",
        );
      }
    }
    world.current = null;
    for (i = 0; i < notes.length; i++) UI.toast(notes[i]);
    if (notes.length) Sfx.uiBad();
  }

  /* ------------------------------ scoring ----------------------------- */

  function measure() {
    var best = [Infinity, Infinity];
    var inHouse = [false, false];
    var i, s;
    for (i = 0; i < world.stones.length; i++) {
      s = world.stones[i];
      if (!s.alive) continue;
      var d = Math.hypot(s.x, s.y - HOUSE_CENTRE_Y);
      if (d > RINGS[3]) continue;
      inHouse[s.team] = true;
      if (d < best[s.team]) best[s.team] = d;
    }
    if (!inHouse[0] && !inHouse[1]) return null;
    var winner = -1;
    if (best[0] < best[1]) winner = 0;
    else if (best[1] < best[0]) winner = 1;
    if (winner === -1) return null; // dead heat — blank end
    var count = 0;
    for (i = 0; i < world.stones.length; i++) {
      s = world.stones[i];
      if (
        s.alive &&
        s.team === winner &&
        Math.hypot(s.x, s.y - HOUSE_CENTRE_Y) < best[1 - winner]
      )
        count++;
    }
    return { team: winner, count: count };
  }

  /* -------------------------------- AI -------------------------------- */

  // Deterministic forward simulation used by Bessie to pick her shot.
  function simulateThrow(speed, angle, curl, snapshot, myTeam) {
    var sim = [];
    var i;
    for (i = 0; i < snapshot.length; i++) {
      sim.push({
        x: snapshot[i].x,
        y: snapshot[i].y,
        vx: 0,
        vy: 0,
        moving: false,
        alive: true,
        spin: 0,
        team: snapshot[i].team,
      });
    }
    var cur = {
      x: 0,
      y: HACK_Y + 0.35,
      vx: Math.sin(angle) * speed,
      vy: Math.cos(angle) * speed,
      moving: true,
      alive: true,
      spin: curl,
      team: myTeam,
      passedHog: false,
    };
    for (i = 0; i < sim.length; i++) sim[i].passedHog = true;
    var all = sim.concat([cur]);
    var dt = 1 / 60;
    for (var steps = 0; steps < 60 * 26; steps++) {
      var moving = false;
      for (i = 0; i < all.length; i++) {
        stepSim(all[i], dt);
        if (all[i].alive &&
            !all[i].passedHog &&
            all[i].y > HOG_FAR + STONE_R) {
          all[i].passedHog = true;
        }
        if (all[i].alive && all[i].moving) moving = true;
      }
      collideSim(all);
      pruneSim(cur);
      for (i = 0; i < sim.length; i++) pruneSim(sim[i]);
      if (!cur.alive) break;
      if (!moving) break;
    }
    var bestD = [Infinity, Infinity];
    for (i = 0; i < all.length; i++) {
      var st = all[i];
      if (!st.alive) continue;
      var d = Math.hypot(st.x, st.y - HOUSE_CENTRE_Y);
      if (d < RINGS[3] && d < bestD[st.team]) bestD[st.team] = d;
    }
    var mine = bestD[myTeam] === Infinity ? 99 : bestD[myTeam];
    var theirs = bestD[1 - myTeam] === Infinity ? 99 : bestD[1 - myTeam];
    // count stones closer than the opponent's best — that is the end's score
    function closerCount(team, limit) {
      var n = 0;
      for (var k = 0; k < all.length; k++) {
        var q = all[k];
        if (!q.alive || q.team !== team) continue;
        var dq = Math.hypot(q.x, q.y - HOUSE_CENTRE_Y);
        if (dq < limit) n++;
      }
      return n;
    }
    if (mine === 99 && theirs === 99) return -0.5;          // blank: dull
    if (mine === 99) return -theirs * 0.3 - 1;              // opponent scores: bad
    if (theirs === 99) return 4 + closerCount(myTeam, RINGS[3]);  // we score alone: lovely
    if (mine < theirs) return 2 + closerCount(myTeam, theirs);
    return -(closerCount(1 - myTeam, mine));                // they score: worst
  }

  function stepSim(s, dt) {
    if (!s.moving || !s.alive) return;
    var sp = Math.hypot(s.vx, s.vy);
    if (sp <= 0.08) {
      s.moving = false;
      s.vx = s.vy = 0;
      return;
    }
    var slowFactor = clamp(1 - sp / MAX_SPEED, 0, 1);
    var curlAcc = CURL_PUSH * slowFactor * slowFactor * s.spin;
    var nx = s.vx / sp,
      ny = s.vy / sp;
    s.vx += ny * curlAcc * dt;
    s.vy += -nx * curlAcc * dt;
    sp = Math.hypot(s.vx, s.vy);
    var ns = Math.max(0, sp - FRICTION_A * dt);
    var k = ns / sp;
    s.vx *= k;
    s.vy *= k;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }

  function collideSim(all) {
    for (var i = 0; i < all.length; i++) {
      for (var j = i + 1; j < all.length; j++) {
        var a = all[i],
          b = all[j];
        if (!a.alive || !b.alive) continue;
        var dx = b.x - a.x,
          dy = b.y - a.y;
        var d = Math.hypot(dx, dy),
          min = STONE_R * 2;
        if (d >= min || d === 0) continue;
        var nx = dx / d,
          ny = dy / d;
        var ov = min - d;
        a.x -= (nx * ov) / 2;
        a.y -= (ny * ov) / 2;
        b.x += (nx * ov) / 2;
        b.y += (ny * ov) / 2;
        var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) continue;
        var imp = (-(1 + RESTITUTION) * rel) / 2;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
      }
    }
  }

  function pruneSim(s) {
    if (!s.alive) return;
    if (
      s.y > BACK_LINE + STONE_R ||
      Math.abs(s.x) > SHEET_W / 2 + STONE_R ||
      (s.y < HOG_FAR && !s.passedHog)
    ) {
      s.alive = false;
      s.moving = false;
    }
  }

  function baseAim(offsetX, depthY) {
    return Math.atan(offsetX / (HOUSE_CENTRE_Y + depthY - HACK_Y));
  }

  var AI = {
    planShotFor: function (team) {
      var snapshot = [];
      for (var i = 0; i < world.stones.length; i++) {
        var s = world.stones[i];
        if (s !== world.current && s.alive)
          snapshot.push({ x: s.x, y: s.y, team: s.team });
      }
      var speeds = [],
        angles = [],
        curls = [-1, 1];
      var offsets = [0, 0.45, 0.9];
      var depths = [-0.5, 0, 0.6];
      for (var p = 0.3; p <= 0.96; p += 0.065)
        speeds.push(lerp(MIN_SPEED, MAX_SPEED, p));
      for (var a = -0.075; a <= 0.0751; a += 0.0125) angles.push(a);
      var bestScore = -Infinity,
        best = null;
      for (var si = 0; si < speeds.length; si++) {
        for (var aj = 0; aj < angles.length; aj++) {
          for (var c = 0; c < curls.length; c++) {
            for (var oi = 0; oi < offsets.length; oi++) {
              for (var di = 0; di < depths.length; di++) {
                var sc = simulateThrow(
                  speeds[si],
                  angles[aj] + baseAim(offsets[oi], depths[di]),
                  curls[c],
                  snapshot,
                  team,
                );
                if (sc > bestScore) {
                  bestScore = sc;
                  best = {
                    speed: speeds[si],
                    angle: angles[aj],
                    curl: curls[c],
                    offset: offsets[oi],
                    depth: depths[di],
                  };
                }
              }
            }
          }
        }
      }
      // Bessie's hands are not perfectly steady, and she warms up as the night goes on
      var skill = 0.028 + 0.007 * (world.end - 1);
      best.angle += gauss() * skill * 0.35;
      var pw = clamp(
        (best.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED) +
          gauss() * skill * 1.15,
        0.05,
        1,
      );
      best.speed = lerp(MIN_SPEED, MAX_SPEED, pw);
      return best;
    },
    planShot: function () {
      return AI.planShotFor(1);
    },
    play: function (shot) {
      var side = Math.random() < 0.5 ? -1 : 1;
      var s = world.stones[world.thrownThisEnd];
      s.team = 1;
      s.passedHog = false;
      s.trail.length = 0;
      var launchY = HACK_Y + 0.35;
      var tx = side * shot.offset;
      var ty = HOUSE_CENTRE_Y + shot.depth;
      var aim = Math.atan2(tx - 0, ty - launchY);
      s.x = 0;
      s.y = launchY;
      s.vx = Math.sin(aim + shot.angle) * shot.speed;
      s.vy = Math.cos(aim + shot.angle) * shot.speed;
      s.spin = shot.curl;
      s.moving = true;
      s.alive = true;
      world.current = s;
      world.thrownThisEnd++;
      world.phase = "running";
      world.stamina = 1;
      UI.toast("Bessie throws…");
      UI.setSweepEnabled(false);
      UI.updateHUD();
    },
  };

  /* ------------------------------- audio ------------------------------ */

  var AudioBox = (function () {
    var ctx = null;
    var master = null;
    var on = true;
    var sweepLoop = null;
    var slideLoop = null;

    function ensure() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          ctx = new AC();
        } catch (e) {
          return null;
        }
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function noiseBuf(dur) {
      var c = ensure();
      if (!c) return null;
      var n = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, n, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function clack(strength) {
      var c = ensure();
      if (!c || !on) return;
      strength = clamp(strength, 0.12, 1);
      var t = c.currentTime;
      var src = c.createBufferSource();
      src.buffer = noiseBuf(0.09);
      var bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900 + rand(-150, 250) * strength;
      bp.Q.value = 1.6;
      var g = c.createGain();
      g.gain.setValueAtTime(0.55 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t);
      var o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(rand(1400, 1900), t);
      var og = c.createGain();
      og.gain.setValueAtTime(0.12 * strength, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
      o.connect(og);
      og.connect(master);
      o.start(t);
      o.stop(t + 0.16);
    }

    function loopNode(freq, q) {
      var c = ensure();
      if (!c) return null;
      var src = c.createBufferSource();
      src.buffer = noiseBuf(1.4);
      src.loop = true;
      var f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      var g = c.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start();
      return g;
    }

    function sweep(level) {
      var c = on ? ensure() : null;
      if (!c) return;
      if (!sweepLoop) sweepLoop = loopNode(2400, 0.7);
      sweepLoop.gain.setTargetAtTime(0.16 * level, c.currentTime, 0.05);
    }

    function slide(level) {
      var c = on ? ensure() : null;
      if (!c) return;
      if (!slideLoop) slideLoop = loopNode(500, 0.9);
      slideLoop.gain.setTargetAtTime(0.05 * level, c.currentTime, 0.06);
    }

    function blip(freq, dur, vol, type) {
      var c = ensure();
      if (!c || !on) return;
      var t = c.currentTime;
      var o = c.createOscillator();
      o.type = type || "triangle";
      o.frequency.value = freq;
      var g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    function toggle() {
      on = !on;
      if (!on) {
        if (sweepLoop) sweepLoop.gain.value = 0;
        if (slideLoop) slideLoop.gain.value = 0;
      }
      return on;
    }

    return {
      clack: clack,
      sweep: sweep,
      slide: slide,
      toggle: toggle,
      unlock: function () {
        ensure();
      },
      uiOk: function () {
        blip(720, 0.09, 0.1);
      },
      uiBad: function () {
        blip(180, 0.16, 0.11, "square");
      },
      scoreUp: function () {
        blip(523, 0.12, 0.09);
        setTimeout(function () {
          blip(784, 0.18, 0.09);
        }, 110);
      },
      quiet: function () {
        sweep(0);
        slide(0);
      },
    };
  })();

  var Sfx = {
    clack: function (hit) {
      AudioBox.clack(hit);
    },
    uiOk: function () {
      AudioBox.uiOk();
    },
    uiBad: function () {
      AudioBox.uiBad();
    },
    scoreUp: function () {
      AudioBox.scoreUp();
    },
  };

  /* ------------------------------- input ------------------------------ */

  var Input = (function () {
    var charging = false;
    var chargingViaKey = false;
    var sweeping = false;
    var sweepingViaKey = false;
    var shiftHeld = false;
    var aimDragId = null;

    function startCharge(viaKey) {
      if (world.phase !== "aim") return;
      AudioBox.unlock();
      world.phase = "charge";
      world.chargeT = 0;
      world.chargePower = 0;
      charging = true;
      chargingViaKey = !!viaKey;
      UI.setCharging(true);
    }

    function releaseCharge() {
      if (world.phase !== "charge" || !charging) return;
      charging = false;
      UI.setCharging(false);
      UI.markPower(world.chargePower);
      var p = world.chargePower;
      launch(p, world.aimAngle, world.curlDir);
      world.thrownThisEnd++;
      if (p >= world.sweetLo && p <= world.sweetHi) UI.toast("True weight!");
      else if (p > world.sweetHi) UI.toast("Heavy!");
      else UI.toast("Light…");
      UI.updateHUD();
    }

    function cancelCharge() {
      if (world.phase !== "charge") return;
      charging = false;
      UI.setCharging(false);
      world.phase = "aim";
      UI.toast("Let down easy.");
    }

    function setSweep(onoff, viaKey) {
      if (world.phase !== "running" || world.stamina <= 0) onoff = false;
      if (sweeping === onoff) return;
      sweeping = onoff;
      sweepingViaKey = !!viaKey && onoff;
      UI.setSweepVisual(onoff);
      AudioBox.sweep(onoff ? 1 : 0);
    }

    function forceSweepOff() {
      sweeping = false;
      sweepingViaKey = false;
      UI.setSweepVisual(false);
      AudioBox.sweep(0);
    }

    function onKey(e) {
      switch (e.key) {
        case "ArrowLeft":
          if (world.phase === "aim" || world.phase === "charge") {
            world.aimAngle = clamp(world.aimAngle - 0.008, -AIM_MAX, AIM_MAX);
            UI.syncAim();
            e.preventDefault();
          }
          break;
        case "ArrowRight":
          if (world.phase === "aim" || world.phase === "charge") {
            world.aimAngle = clamp(world.aimAngle + 0.008, -AIM_MAX, AIM_MAX);
            UI.syncAim();
            e.preventDefault();
          }
          break;
        case "a":
        case "A":
          world.curlDir = -1;
          UI.syncCurl();
          break;
        case "d":
        case "D":
          world.curlDir = 1;
          UI.syncCurl();
          break;
        case " ":
          e.preventDefault();
          if (world.phase === "title") {
            Game.begin();
          } else if (world.phase === "over") {
            Game.restart();
          } else if (world.phase === "aim") startCharge(true);
          break;
        case "Shift":
          shiftHeld = true;
          if (world.phase === "running") setSweep(true, true);
          break;
        case "p":
        case "P":
          Game.togglePause();
          break;
        case "m":
        case "M":
          Game.toggleSound();
          break;
        case "r":
        case "R":
          Game.restart();
          break;
        case "h":
        case "H":
          Game.toggleHelp();
          break;
        case "?":
          Game.toggleHelp();
          break;
        case "Escape":
          if (world.phase === "paused") Game.togglePause();
          break;
        case "Enter":
          if (world.phase === "title") Game.begin();
          break;
      }
    }

    function onKeyUp(e) {
      switch (e.key) {
        case " ":
          if (charging && chargingViaKey) releaseCharge();
          break;
        case "Shift":
          shiftHeld = false;
          if (sweeping && sweepingViaKey) setSweep(false, true);
          break;
      }
    }

    function bindAimPad() {
      var pad = $("aimpad");
      function setFromX(clientX) {
        var r = pad.getBoundingClientRect();
        var t = clamp((clientX - r.left) / r.width, 0, 1);
        world.aimAngle = lerp(-AIM_MAX, AIM_MAX, t);
        UI.syncAim();
      }
      pad.addEventListener("pointerdown", function (e) {
        aimDragId = e.pointerId;
        if (pad.setPointerCapture) pad.setPointerCapture(e.pointerId);
        setFromX(e.clientX);
        e.preventDefault();
      });
      pad.addEventListener("pointermove", function (e) {
        if (aimDragId === null || e.pointerId !== aimDragId) return;
        setFromX(e.clientX);
        e.preventDefault();
      });
      function up(e) {
        if (e.pointerId === aimDragId) aimDragId = null;
      }
      pad.addEventListener("pointerup", up);
      pad.addEventListener("pointercancel", up);
    }

    function bindButtons() {
      var btnThrow = $("btn-throw");
      var btnSweep = $("btn-sweep");

      btnThrow.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        startCharge(false);
      });
      btnThrow.addEventListener("pointerup", function (e) {
        e.preventDefault();
        if (charging && !chargingViaKey) releaseCharge();
      });
      btnThrow.addEventListener("pointerleave", function () {
        if (charging && !chargingViaKey) releaseCharge();
      });

      btnSweep.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        if (!btnSweep.disabled) setSweep(true, false);
      });
      btnSweep.addEventListener("pointerup", function (e) {
        e.preventDefault();
        setSweep(false, false);
      });
      btnSweep.addEventListener("pointerleave", function () {
        if (sweeping && !sweepingViaKey) setSweep(false, false);
      });

      Array.prototype.forEach.call(
        document.querySelectorAll('input[name="curl"]'),
        function (r) {
          r.addEventListener("change", function () {
            if (r.checked) {
              world.curlDir = parseInt(r.value, 10);
              Sfx.uiOk();
            }
          });
        },
      );

      $("btn-begin").addEventListener("click", function () {
        Game.begin();
      });
      $("btn-resume").addEventListener("click", function () {
        Game.togglePause();
      });
      $("btn-again").addEventListener("click", function () {
        Game.restart();
      });
      $("btn-restart").addEventListener("click", function () {
        Game.restart();
      });
      $("btn-restart-2").addEventListener("click", function () {
        Game.restart();
      });
      $("btn-pause").addEventListener("click", function () {
        Game.togglePause();
      });
      $("btn-sound").addEventListener("click", function () {
        Game.toggleSound();
      });
      $("btn-help").addEventListener("click", function () {
        Game.toggleHelp();
      });
    }

    function tickSweepInput() {
      if (world.phase !== "running") return;
      if (shiftHeld && world.stamina > 0 && !sweeping) setSweep(true, true);
      if (sweeping && world.stamina <= 0) forceSweepOff();
    }

    return {
      init: function () {
        bindAimPad();
        bindButtons();
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", function () {
          shiftHeld = false;
          if (charging) releaseCharge();
          if (sweeping) forceSweepOff();
        });
      },
      isSweeping: function () {
        return sweeping;
      },
      stopSweep: forceSweepOff,
      tickSweepInput: tickSweepInput,
    };
  })();

  /* -------------------------------- view ------------------------------ */

  var View = (function () {
    var cv, cx;
    var W = 300,
      H = 400;
    var scale = 100,
      ox = 150,
      oy = 380;
    var snow = [];

    function init() {
      cv = $("rink");
      cx = cv.getContext("2d");
      computeTransform();
      window.addEventListener("resize", computeTransform);
      for (var i = 0; i < 70; i++) {
        snow.push({
          x: Math.random(),
          y: Math.random(),
          v: rand(0.004, 0.014),
          drift: rand(-0.0016, 0.0016),
          r: rand(0.8, 2.4),
          ph: rand(0, TAU),
        });
      }
    }

    function computeTransform() {
      var rect = cv.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(280, Math.round(rect.width * dpr));
      var h = Math.max(360, Math.round(rect.height * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      W = cv.width;
      H = cv.height;
      scale = W / (SHEET_W + 1.35);
      ox = W / 2;
      oy = H - HACK_Y * scale - H * 0.045;
    }

    function wx(x) {
      return ox + x * scale;
    }
    function wy(y) {
      return oy - y * scale;
    }

    function draw(t, dtReal) {
      cx.clearRect(0, 0, W, H);

      var bg = cx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0a1220");
      bg.addColorStop(1, "#111d31");
      cx.fillStyle = bg;
      cx.fillRect(0, 0, W, H);

      var shx = 0,
        shy = 0;
      if (world.shake > 0.01) {
        shx = rand(-1, 1) * world.shake * 7;
        shy = rand(-1, 1) * world.shake * 7;
        world.shake *= Math.pow(0.002, dtReal);
      }

      cx.save();
      cx.translate(shx, shy);

      drawLanternGlow(t);

      var left = wx(-SHEET_W / 2),
        right = wx(SHEET_W / 2);
      var topIce = wy(LEN),
        botIce = wy(-0.55);
      var iceGrad = cx.createLinearGradient(left, 0, right, 0);
      iceGrad.addColorStop(0, "#bfd2db");
      iceGrad.addColorStop(0.5, "#e7f0f4");
      iceGrad.addColorStop(1, "#bfd2db");
      cx.fillStyle = iceGrad;
      roundRect(left, topIce, right - left, botIce - topIce, 12 * (scale / 90));
      cx.fill();

      var sheen = cx.createLinearGradient(wx(-0.85), 0, wx(0.85), 0);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0.20)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      cx.fillStyle = sheen;
      cx.fillRect(wx(-0.85), topIce, wx(0.85) - wx(-0.85), botIce - topIce);

      cx.fillStyle = "rgba(120,150,165,0.10)";
      for (var pi = 0; pi < 140; pi++) {
        var fx = frac(Math.sin(pi * 127.1) * 43758.5453);
        var fy = frac(Math.sin(pi * 311.7) * 12345.6789);
        cx.fillRect(wx((fx - 0.5) * SHEET_W * 0.98), wy(fy * LEN), 2, 2);
      }

      cx.save();
      clipSheet(left, topIce, right, botIce);
      drawHouse();
      drawLines();
      drawTrails();
      drawAllStones(t);
      cx.restore();

      drawHack();
      if (world.phase === "aim" || world.phase === "charge") drawAimGuide(t);
      drawVignette();

      cx.restore();
      drawSnow(t, dtReal);
    }

    function frac(x) {
      return x - Math.floor(x);
    }

    function clipSheet(l, t, r, b) {
      cx.beginPath();
      cx.rect(l, t, r - l, b - t);
      cx.clip();
    }

    function roundRect(x, y, w, h, r) {
      cx.beginPath();
      cx.moveTo(x + r, y);
      cx.arcTo(x + w, y, x + w, y + h, r);
      cx.arcTo(x + w, y + h, x, y + h, r);
      cx.arcTo(x, y + h, x, y, r);
      cx.arcTo(x, y, x + w, y, r);
      cx.closePath();
    }

    function drawLanternGlow(t) {
      var flick =
        0.82 + 0.18 * Math.sin(t * 0.0016) * Math.sin(t * 0.0043 + 1.7);
      glowAt(wx(-SHEET_W / 2 - 0.35), wy(7), flick);
      glowAt(wx(SHEET_W / 2 + 0.35), wy(HOUSE_CENTRE_Y + 5), flick);
    }

    function glowAt(px, py, flick) {
      var g = cx.createRadialGradient(px, py, 8, px, py, scale * 4.6);
      g.addColorStop(0, "rgba(255,196,110," + (0.22 * flick).toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,196,110,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, W, H);
    }

    function drawHouse() {
      var tx = wx(0),
        ty = wy(HOUSE_CENTRE_Y);
      var cols = [
        "rgba(148,178,192,0.85)",
        "rgba(233,241,245,0.9)",
        "rgba(148,178,192,0.85)",
        "rgba(233,241,245,0.92)",
      ];
      for (var i = RINGS.length - 1; i >= 0; i--) {
        cx.beginPath();
        cx.arc(tx, ty, RINGS[i] * scale, 0, TAU);
        cx.fillStyle = cols[i];
        cx.fill();
        cx.strokeStyle = "rgba(70,100,118,0.65)";
        cx.lineWidth = Math.max(1, scale * 0.012);
        cx.stroke();
      }
      cx.beginPath();
      cx.arc(tx, ty, Math.max(2.5, 0.03 * scale), 0, TAU);
      cx.fillStyle = "rgba(70,100,118,0.9)";
      cx.fill();
    }

    function line(y) {
      cx.beginPath();
      cx.moveTo(wx(-SHEET_W / 2), wy(y));
      cx.lineTo(wx(SHEET_W / 2), wy(y));
      cx.stroke();
    }

    function drawLines() {
      cx.strokeStyle = "rgba(60,92,110,0.8)";
      cx.lineWidth = Math.max(1.4, scale * 0.028);
      line(HACK_Y + 0.15);
      line(HOG_FAR);
      line(BACK_LINE);
      line(HOUSE_CENTRE_Y);
    }

    function drawTrails() {
      cx.lineCap = "round";
      for (var i = 0; i < world.stones.length; i++) {
        var s = world.stones[i];
        if (!s.alive || s.trail.length < 2) continue;
        cx.beginPath();
        cx.moveTo(wx(s.trail[0].x), wy(s.trail[0].y));
        for (var j = 1; j < s.trail.length; j++)
          cx.lineTo(wx(s.trail[j].x), wy(s.trail[j].y));
        cx.strokeStyle =
          s.team === 0 ? "rgba(192,57,43,0.13)" : "rgba(217,165,32,0.13)";
        cx.lineWidth = STONE_R * 2 * scale;
        cx.stroke();
      }
    }

    function drawAllStones(t) {
      var order = world.stones.slice();
      if (world.current) order.push(world.current);
      order.sort(function (a, b) {
        return (a.moving ? 1 : 0) - (b.moving ? 1 : 0);
      });
      for (var i = 0; i < order.length; i++) {
        if (order[i].alive) drawStone(order[i], t);
      }
    }

    function drawStone(s, t) {
      var x = wx(s.x),
        y = wy(s.y);
      var r = STONE_R * scale;
      cx.beginPath();
      cx.arc(x + r * 0.13, y + r * 0.2, r * 0.95, 0, TAU);
      cx.fillStyle = "rgba(30,50,64,0.35)";
      cx.fill();
      var g = cx.createRadialGradient(
        x - r * 0.35,
        y - r * 0.4,
        r * 0.2,
        x,
        y,
        r,
      );
      g.addColorStop(0, "#f2f4f2");
      g.addColorStop(0.55, "#c9cdc9");
      g.addColorStop(1, "#8f9794");
      cx.beginPath();
      cx.arc(x, y, r, 0, TAU);
      cx.fillStyle = g;
      cx.fill();
      cx.strokeStyle = "rgba(52,66,72,0.7)";
      cx.lineWidth = Math.max(1, r * 0.06);
      cx.stroke();
      cx.beginPath();
      cx.arc(x, y, r * 0.68, 0, TAU);
      cx.strokeStyle =
        s.team === 0 ? "rgba(192,57,43,0.95)" : "rgba(217,165,32,0.95)";
      cx.lineWidth = Math.max(2, r * 0.16);
      cx.stroke();
      var ang =
        s.handleAng === undefined ? (s.team === 0 ? -0.6 : 0.9) : s.handleAng;
      if (s.moving) {
        ang = ang + (s.spin > 0 ? 1 : -1) * 0.16;
        s.handleAng = ang % TAU;
      }
      var hx = Math.cos(ang) * r * 0.6,
        hy = Math.sin(ang) * r * 0.6;
      cx.beginPath();
      cx.moveTo(x - hx, y - hy);
      cx.lineTo(x + hx, y + hy);
      cx.strokeStyle = s.team === 0 ? "#7e2018" : "#a87c12";
      cx.lineWidth = Math.max(2.5, r * 0.17);
      cx.lineCap = "round";
      cx.stroke();
      cx.beginPath();
      cx.arc(x, y, r * 0.14, 0, TAU);
      cx.fillStyle = s.team === 0 ? "#7e2018" : "#a87c12";
      cx.fill();
    }

    function drawAimGuide(t) {
      var pulse = 0.55 + 0.25 * Math.sin(t * 0.005);
      var lenM = 14;
      var x0 = wx(0),
        y0 = wy(HACK_Y + 0.5);
      var x1 = wx(Math.sin(world.aimAngle) * lenM),
        y1 = wy(HACK_Y + Math.cos(world.aimAngle) * lenM);
      var grad = cx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(
        0,
        "rgba(255,207,125," + (0.75 * pulse).toFixed(3) + ")",
      );
      grad.addColorStop(1, "rgba(255,207,125,0)");
      cx.save();
      cx.setLineDash([10, 9]);
      cx.strokeStyle = grad;
      cx.lineWidth = Math.max(2, scale * 0.03);
      cx.beginPath();
      cx.moveTo(x0, y0);
      cx.lineTo(x1, y1);
      cx.stroke();
      cx.restore();
    }

    function drawHack() {
      cx.fillStyle = "#3a2c22";
      cx.fillRect(wx(-0.33), wy(HACK_Y - 0.22), 0.66 * scale, 12);
      cx.fillStyle = "#241b14";
      cx.fillRect(wx(-0.33), wy(HACK_Y - 0.22) + 9, 0.66 * scale, 4);
    }

    function drawVignette() {
      var v = cx.createRadialGradient(
        W / 2,
        H * 0.55,
        H * 0.3,
        W / 2,
        H * 0.55,
        H * 0.85,
      );
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(6,10,18,0.55)");
      cx.fillStyle = v;
      cx.fillRect(0, 0, W, H);
    }

    function drawSnow(t, dtReal) {
      cx.fillStyle = "rgba(235,244,250,0.75)";
      for (var i = 0; i < snow.length; i++) {
        var f = snow[i];
        f.y += f.v * dtReal;
        f.x += (f.drift + Math.sin(t * 0.001 + f.ph) * 0.0035) * dtReal * 8;
        if (f.y > 1.02) {
          f.y = -0.02;
          f.x = Math.random();
        }
        if (f.x > 1.02) f.x = -0.02;
        if (f.x < -0.02) f.x = 1.02;
        cx.globalAlpha = 0.25 + 0.5 * (f.r / 2.4);
        cx.beginPath();
        cx.arc(f.x * W, f.y * H, f.r, 0, TAU);
        cx.fill();
      }
      cx.globalAlpha = 1;
    }

    return { init: init, draw: draw };
  })();

  /* --------------------------------- UI ------------------------------- */

  var UI = (function () {
    function updateHUD() {
      $("score-you").textContent = String(world.scores[0]);
      $("score-foe").textContent = String(world.scores[1]);
      $("end-num").innerHTML = world.end + "<small>/" + world.ENDS + "</small>";
      var hc = $("hammer-chip");
      if (world.hammerTeam === 0) {
        hc.textContent = "⚒ yours";
        hc.style.color = "#ff9d8c";
      } else {
        hc.textContent = "⚒ hers";
        hc.style.color = "#ffd76e";
      }
      $("stamina-fill").style.width = (world.stamina * 100).toFixed(1) + "%";
    }

    function toast(msg, cls) {
      var box = $("toasts");
      var el = document.createElement("div");
      el.className = "toast" + (cls ? " " + cls : "");
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(function () {
        el.classList.add("fade");
      }, 1600);
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 2200);
      while (box.children.length > 3) box.removeChild(box.firstChild);
    }

    function syncAim() {
      var t = (world.aimAngle + AIM_MAX) / (AIM_MAX * 2);
      $("aimtick").style.left = (t * 100).toFixed(2) + "%";
    }

    function syncCurl() {
      $("curl-in").querySelector("input").checked = world.curlDir === -1;
      $("curl-out").querySelector("input").checked = world.curlDir === 1;
    }

    function setCharging(onoff) {
      $("btn-throw").classList.toggle("charging", onoff);
      $("powerlab").textContent = onoff
        ? "release inside the amber band"
        : "hold to draw";
      if (!onoff) $("powerfill").style.width = "0%";
    }

    function markPower(p) {
      var g = $("powerghost");
      g.style.opacity = "1";
      g.style.left = (p * 100).toFixed(1) + "%";
      setTimeout(function () {
        g.style.opacity = "0";
      }, 700);
    }

    function setSweepEnabled(onoff) {
      $("btn-sweep").disabled = !onoff;
    }
    function setSweepVisual(onoff) {
      $("btn-sweep").classList.toggle("sweeping", onoff);
    }

    function showOverlay(id) {
      $(id).classList.remove("hidden");
    }
    function hideOverlay(id) {
      $(id).classList.add("hidden");
    }

    function showEnd(winner) {
      var title, flavors;
      if (winner === 0) {
        title = "You take the bonspiel!";
        flavors = [
          "The pond falls quiet but for the kettle calling from the hut.",
          "Bessie shakes your hand hard enough to crack a handle.",
          "Someone starts a song about the third end. It will not be forgotten.",
        ];
      } else if (winner === 1) {
        title = "Bessie takes it";
        flavors = [
          "She smiles like a cat at a mousehole and hands you the flask anyway.",
          "There is always the return match, when the moon is full and the ice is keen.",
          "She has named the game stone after herself. Outrageous.",
        ];
      } else {
        title = "A tie on the pond";
        flavors = [
          "Honours even. The lanterns burn low and nobody will say who won.",
          "A tie at Keen Ice counts double in the songs, they say.",
        ];
      }
      $("end-title").textContent = title;
      $("end-line").textContent =
        "Final score — You " +
        world.scores[0] +
        " · " +
        world.scores[1] +
        " Bessie, over " +
        world.ENDS +
        " ends.";
      $("end-flavor").textContent =
        flavors[Math.floor(Math.random() * flavors.length)];
      showOverlay("ovl-end");
    }

    return {
      updateHUD: updateHUD,
      toast: toast,
      syncAim: syncAim,
      syncCurl: syncCurl,
      setCharging: setCharging,
      markPower: markPower,
      setSweepEnabled: setSweepEnabled,
      setSweepVisual: setSweepVisual,
      showOverlay: showOverlay,
      hideOverlay: hideOverlay,
      showEnd: showEnd,
    };
  })();

  /* -------------------------------- game ------------------------------ */

  var AIM_MAX = 0.09;

  var Game = (function () {
    var lastT = 0;
    var running = false;

    function begin() {
      AudioBox.unlock();
      hideOverlays();
      startMatch(true);
    }

    function hideOverlays() {
      UI.hideOverlay("ovl-start");
      UI.hideOverlay("ovl-end");
      UI.hideOverlay("ovl-pause");
    }

    function startMatch(fromTitle) {
      world.end = 1;
      world.scores = [0, 0];
      world.hammerTeam = 1;
      startEnd();
      if (fromTitle) UI.toast("You throw first — Bessie has the hammer.");
    }

    function startEnd() {
      resetStones();
      world.thrownThisEnd = 0;
      world.current = null;
      world.aimAngle = 0;
      world.stamina = 1;
      world.chargeT = 0;
      world.chargePower = 0;
      world.phase = "aim";
      UI.setSweepEnabled(false);
      UI.setSweepVisual(false);
      UI.updateHUD();
      UI.syncAim();
      UI.syncCurl();
      UI.toast(
        "End " +
          world.end +
          " of " +
          world.ENDS +
          (world.hammerTeam === 0
            ? " — you have the hammer."
            : " — Bessie has the hammer."),
      );
    }

    function afterSettle() {
      housekeepingAfterMotion();
      AudioBox.slide(0);
      Input.stopSweep();
      UI.setSweepEnabled(false);
      UI.setSweepVisual(false);

      if (world.thrownThisEnd >= world.PER_END) {
        finishEnd();
        return;
      }
      if (whoseTurn() === 0) {
        world.phase = "aim";
        world.aimAngle = 0;
        world.stamina = 1;
        UI.updateHUD();
        UI.toast("Your stone.");
      } else {
        world.phase = "aiwait";
        aiGo();
      }
    }

    function aiGo() {
      setTimeout(function () {
        if (world.phase !== "aiwait") return;
        AI.play(AI.planShot());
      }, 500);
    }

    function finishEnd() {
      var m = measure();
      world.lastResult = m;
      world.phase = "scored";
      if (m && m.count > 0) {
        world.scores[m.team] += m.count;
        Sfx.scoreUp();
        UI.toast(
          (m.team === 0 ? "You take" : "Bessie takes") +
            " the end: +" +
            m.count,
          "score",
        );
      } else {
        UI.toast("Blank end — the hammer stays where it was.");
      }
      UI.updateHUD();

      setTimeout(function () {
        if (m && m.count > 0) world.hammerTeam = 1 - m.team;
        if (world.end >= world.ENDS) {
          world.phase = "over";
          UI.showEnd(
            world.scores[0] > world.scores[1]
              ? 0
              : world.scores[1] > world.scores[0]
                ? 1
                : -1,
          );
        } else {
          world.end++;
          startEnd();
        }
      }, 1700);
    }

    function togglePause() {
      if (world.phase === "paused") {
        world.phase = world.prevPhase || "aim";
        UI.hideOverlay("ovl-pause");
      } else if (
        world.phase !== "title" &&
        world.phase !== "over" &&
        world.phase !== "scored"
      ) {
        world.prevPhase = world.phase;
        world.phase = "paused";
        UI.showOverlay("ovl-pause");
        AudioBox.quiet();
      }
    }

    function toggleSound() {
      var onNow = AudioBox.toggle();
      $("btn-sound").textContent = onNow ? "♪" : "✕";
      UI.toast(onNow ? "Sound on." : "Sound off.");
    }

    function toggleHelp() {
      var el = $("ovl-start");
      if (el.classList.contains("hidden")) {
        world.prevPhase =
          world.phase === "paused" ? world.prevPhase : world.phase;
        world.phase = "paused";
        UI.showOverlay("ovl-start");
        $("btn-begin").textContent = "Back to the ice";
      } else {
        UI.hideOverlay("ovl-start");
        $("btn-begin").textContent = "Take the hack";
        world.phase = world.prevPhase || "aim";
      }
    }

    function restart() {
      AudioBox.quiet();
      hideOverlays();
      $("btn-begin").textContent = "Take the hack";
      startMatch(false);
      UI.toast("Fresh game. The ice is keen.");
    }

    function tick(ts) {
      if (!running) return;
      var dtReal = clamp((ts - lastT) / 1000 || 0.016, 0.001, 0.05);
      lastT = ts;

      if (world.phase === "charge") {
        world.chargeT += dtReal;
        var cyc = (world.chargeT % PERIOD) / PERIOD;
        world.chargePower = cyc < 0.5 ? cyc * 2 : 2 - cyc * 2;
        $("powerfill").style.width = (world.chargePower * 100).toFixed(1) + "%";
      }

      if (world.phase === "running") {
        var sub = 4;
        var dt = dtReal / sub;
        for (var k = 0; k < sub; k++) {
          var swept = Input.isSweeping() && world.stamina > 0;
          var act = activeStones();
          for (var i = 0; i < act.length; i++) stepStone(act[i], dt, swept);
          collideAll(act);
          trackHog(act);
        }
        if (Input.isSweeping()) {
          if (world.stamina > 0) {
            world.stamina = Math.max(0, world.stamina - dtReal * 0.55);
            if (world.stamina <= 0) {
              UI.toast("Sweeper spent!");
              Input.stopSweep();
            }
          }
        } else {
          world.stamina = Math.min(1, world.stamina + dtReal * 0.1);
        }
        var cur = world.current;
        AudioBox.slide(
          cur && cur.moving ? clamp(Math.hypot(cur.vx, cur.vy) / 6, 0, 1) : 0,
        );
        if (!anyMoving()) afterSettle();
      }

      Input.tickSweepInput();
      UI.updateHUD();
      View.draw(ts, dtReal);
      requestAnimationFrame(tick);
    }

    document.addEventListener("visibilitychange", function () {
      if (
        document.hidden &&
        (world.phase === "running" || world.phase === "charge")
      ) {
        togglePause();
      }
      lastT = performance.now();
    });

    function start() {
      View.init();
      Input.init();
      resetStones();
      world.phase = "title";
      UI.updateHUD();
      UI.syncAim();
      UI.syncCurl();
      running = true;
      lastT = performance.now();
      requestAnimationFrame(tick);
    }

    return {
      start: start,
      begin: begin,
      restart: restart,
      togglePause: togglePause,
      toggleSound: toggleSound,
      toggleHelp: toggleHelp,
    };
  })();

  var PERIOD = 1.15;

  /* test hooks (harmless in play; used by the automated smoke test) */
  window.__KEEN_ICE__ = {
    world: world,
    measure: measure,
    aiThrow: function () {
      // test hook: let the current AI take the shot for whichever team is up
      if (world.phase !== "aim") return false;
      var shot = AI.planShotFor(whoseTurn());
      var s = world.stones[world.thrownThisEnd];
      s.team = whoseTurn();
      s.passedHog = false;
      s.trail.length = 0;
      var launchY = HACK_Y + 0.35;
      var tx = (Math.random() < 0.5 ? -1 : 1) * shot.offset;
      var ty = HOUSE_CENTRE_Y + shot.depth;
      var aim = Math.atan2(tx, ty - launchY);
      s.x = 0;
      s.y = launchY;
      s.vx = Math.sin(aim + shot.angle) * shot.speed;
      s.vy = Math.cos(aim + shot.angle) * shot.speed;
      s.spin = shot.curl;
      s.moving = true;
      s.alive = true;
      world.current = s;
      world.thrownThisEnd++;
      world.phase = "running";
      return true;
    },
    throwStone: function (power, angleDeg) {
      if (world.phase !== "running") {
        world.phase = "aim";
        launch(clamp(power, 0, 1), ((angleDeg || 0) * Math.PI) / 180, -1);
        world.thrownThisEnd++;
      }
      return world.current ? { x: world.current.x, y: world.current.y } : null;
    },
  };

  Game.start();
})();
