/* Perihelion Post — a gravity-slingshot courier arcade.
   Drag to launch the mail pod along its predicted arc; planetary gravity does
   the steering; scarce thruster pips correct the course. Deliver every parcel. */
(function () {
  "use strict";

  /* ---------- world constants ---------- */
  var W = 960;
  var H = 600;
  var STEP = 1 / 240;
  var GRAV = 2400;
  var SOFT = 0.35;
  var POD_R = 5;
  var GOAL_CATCH = 26;
  var OOB = 70;
  var MAXV = 760;
  var DRAG_MAX = 190;
  var SPEED_PER_PX = 2.9;
  var MIN_DRAG = 20;
  var THRUST = 300;

  var PLANET_SKINS = [
    ["#d98a5f", "#57200f"],
    ["#6fa8dc", "#142c4e"],
    ["#d9c05f", "#4e3d10"],
    ["#a678d9", "#2b1450"],
    ["#63cf9f", "#12483a"],
    ["#d96a86", "#4e1226"],
  ];

  var LEVELS = [
    {
      name: "First Light",
      start: { x: 130, y: 300 },
      goal: { x: 820, y: 300 },
      fuel: 4,
      planets: [{ x: 480, y: 520, r: 26 }],
    },
    {
      name: "The Bend",
      start: { x: 130, y: 170 },
      goal: { x: 830, y: 430 },
      fuel: 4,
      planets: [{ x: 480, y: 300, r: 52 }],
    },
    {
      name: "Behind the Giant",
      start: { x: 140, y: 300 },
      goal: { x: 810, y: 250 },
      fuel: 4.5,
      planets: [{ x: 480, y: 300, r: 86 }],
    },
    {
      name: "The Corridor",
      start: { x: 120, y: 300 },
      goal: { x: 850, y: 300 },
      fuel: 5,
      planets: [
        { x: 400, y: 205, r: 44 },
        { x: 560, y: 395, r: 44 },
      ],
    },
    {
      name: "Heavy Heart",
      start: { x: 110, y: 440 },
      goal: { x: 845, y: 150 },
      fuel: 5,
      planets: [
        { x: 480, y: 330, r: 108, m: 1.35 },
        { x: 205, y: 135, r: 20 },
      ],
    },
    {
      name: "The Needle",
      start: { x: 120, y: 298 },
      goal: { x: 858, y: 300 },
      fuel: 3.6,
      planets: [
        { x: 480, y: 135, r: 70 },
        { x: 480, y: 462, r: 70 },
      ],
    },
    {
      name: "Double Moon",
      start: { x: 110, y: 520 },
      goal: { x: 880, y: 110 },
      fuel: 5.5,
      planets: [
        { x: 330, y: 320, r: 46 },
        { x: 640, y: 225, r: 36 },
        { x: 640, y: 430, r: 36 },
      ],
    },
    {
      name: "The Long Way",
      start: { x: 105, y: 300 },
      goal: { x: 838, y: 118 },
      fuel: 6,
      planets: [
        { x: 450, y: 310, r: 92, m: 1.15 },
        { x: 705, y: 505, r: 26 },
        { x: 215, y: 105, r: 24 },
      ],
    },
  ];

  /* ---------- dom ---------- */
  var canvas = document.getElementById("sky");
  var ctx = canvas.getContext("2d");
  var elRouteTop = document.getElementById("hud-route-top");
  var elLaunches = document.getElementById("hud-launches");
  var elLost = document.getElementById("hud-lost");
  var elFuel = document.getElementById("fuel-fill");
  var elBanner = document.getElementById("banner");
  var elOverlay = document.getElementById("overlay");
  var elKicker = document.getElementById("ov-kicker");
  var elTitle = document.getElementById("ov-title");
  var elHow = document.getElementById("ov-how");
  var elNote = document.getElementById("ov-note");
  var elBtn = document.getElementById("ov-btn");
  var elRecall = document.getElementById("btn-recall");

  /* ---------- game state ---------- */
  var levelIx = 0;
  var planets = [];
  var stars = [];
  var levelDef = null;

  var state = "title"; // title | aim | fly | delivered | crashed | complete
  var stateT = 0;
  var clock = 0;
  var playTime = 0;
  var launches = 0;
  var lostCount = 0;

  var pod = { x: 0, y: 0, vx: 0, vy: 0 };
  var fuel = 0;
  var fuelMax = 1;
  var trail = [];
  var sparks = [];

  var aim = { active: false, x: 0, y: 0 };
  var thrustPointer = false;
  var pointerWorld = { x: 0, y: 0 };
  var keys = Object.create(null);

  var paused = false;
  var lastTs = 0;
  var acc = 0;
  var bannerUntil = 0;
  var best = null;

  /* scratch for the integrator */
  var gAX = 0;
  var gAY = 0;

  /* ---------- tiny helpers ---------- */
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      var z = t;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------- persistence (best shift) ---------- */
  function loadBest() {
    try {
      var raw = window.localStorage.getItem("perihelion-post-best");
      if (raw) best = JSON.parse(raw);
    } catch (err) {
      best = null;
    }
  }

  function saveBest() {
    try {
      window.localStorage.setItem(
        "perihelion-post-best",
        JSON.stringify({ launches: launches, lost: lostCount }),
      );
    } catch (err) {
      /* storage unavailable — the run simply won't be remembered */
    }
  }

  /* ---------- audio (all synthesised) ---------- */
  var ac = null;
  var master = null;
  var noiseBuf = null;
  var thrustGain = null;

  function ensureAudio() {
    if (!ac) {
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        ac = new Ctx();
        master = ac.createGain();
        master.gain.value = 0.22;
        master.connect(ac.destination);
        var len = Math.floor(ac.sampleRate * 0.6);
        noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        var data = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        var src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        var bp = ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 650;
        bp.Q.value = 0.8;
        thrustGain = ac.createGain();
        thrustGain.gain.value = 0;
        src.connect(bp);
        bp.connect(thrustGain);
        thrustGain.connect(master);
        src.start();
      } catch (err) {
        ac = null;
      }
    }
    if (ac && ac.state === "suspended") {
      try {
        ac.resume();
      } catch (err) {
        /* stay silent */
      }
    }
  }

  function blip(freq, dur, type, vol, endFreq, delay) {
    if (!ac) return;
    try {
      var t0 = ac.currentTime + (delay || 0);
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (endFreq)
        o.frequency.exponentialRampToValueAtTime(
          Math.max(20, endFreq),
          t0 + dur,
        );
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    } catch (err) {
      /* stay silent */
    }
  }

  function noiseBurst(vol, dur, freqFrom, freqTo, delay) {
    if (!ac) return;
    try {
      var t0 = ac.currentTime + (delay || 0);
      var src = ac.createBufferSource();
      src.buffer = noiseBuf;
      var f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(freqFrom, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, freqTo), t0 + dur);
      var g = ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.03);
    } catch (err) {
      /* stay silent */
    }
  }

  var sfx = {
    launch: function () {
      noiseBurst(0.4, 0.35, 2400, 260);
      blip(300, 0.3, "sawtooth", 0.18, 70);
    },
    deliver: function () {
      blip(523.25, 0.16, "sine", 0.3);
      blip(659.25, 0.16, "sine", 0.3, null, 0.09);
      blip(783.99, 0.26, "sine", 0.32, null, 0.18);
    },
    crash: function () {
      blip(140, 0.35, "square", 0.35, 38);
      noiseBurst(0.3, 0.18, 900, 200);
    },
    recall: function () {
      blip(230, 0.16, "triangle", 0.25, 150);
    },
    click: function () {
      blip(880, 0.06, "triangle", 0.2);
    },
  };

  function setThrustSound(on) {
    if (!ac || !thrustGain) return;
    try {
      thrustGain.gain.setTargetAtTime(on ? 0.13 : 0, ac.currentTime, 0.05);
    } catch (err) {
      /* stay silent */
    }
  }

  /* ---------- level construction ---------- */
  function buildLevel(ix) {
    levelIx = ix;
    levelDef = LEVELS[ix];
    planets = [];
    var rng = mulberry32(9173 + ix * 7919);
    for (var i = 0; i < levelDef.planets.length; i++) {
      var def = levelDef.planets[i];
      var skin = PLANET_SKINS[(ix * 2 + i) % PLANET_SKINS.length];
      var spots = [];
      var nSpots = 3 + Math.floor(rng() * 3);
      for (var s = 0; s < nSpots; s++) {
        var ang = rng() * Math.PI * 2;
        var rad = rng() * def.r * 0.62;
        spots.push({
          dx: Math.cos(ang) * rad,
          dy: Math.sin(ang) * rad,
          rx: def.r * (0.14 + rng() * 0.2),
          ry: def.r * (0.08 + rng() * 0.12),
          rot: rng() * Math.PI,
          lite: rng() > 0.5,
        });
      }
      planets.push({
        x: def.x,
        y: def.y,
        r: def.r,
        m: (def.m || 1) * def.r * def.r,
        skin: skin,
        spots: spots,
      });
    }
    stars = [];
    for (var k = 0; k < 150; k++) {
      stars.push({
        x: rng() * W,
        y: rng() * H,
        r: 0.5 + rng() * 1.3,
        ph: rng() * Math.PI * 2,
        sp: 0.4 + rng() * 1.4,
      });
    }
    fuelMax = levelDef.fuel;
    resetPod();
    trail = [];
    sparks = [];
    showBanner("Route " + (ix + 1) + " — " + levelDef.name, "", 1.6);
    syncHud();
  }

  function resetPod() {
    pod.x = levelDef.start.x;
    pod.y = levelDef.start.y;
    pod.vx = 0;
    pod.vy = 0;
    fuel = fuelMax;
    trail = [];
  }

  /* ---------- physics ---------- */
  function computeAccel(x, y) {
    var ax = 0;
    var ay = 0;
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      var dx = p.x - x;
      var dy = p.y - y;
      var soft = p.r * SOFT;
      var d2 = dx * dx + dy * dy + soft * soft;
      var inv = (GRAV * p.m) / (d2 * Math.sqrt(d2));
      ax += dx * inv;
      ay += dy * inv;
    }
    gAX = ax;
    gAY = ay;
  }

  function thrustDir() {
    var dx = 0;
    var dy = 0;
    if (keys.KeyA || keys.ArrowLeft) dx -= 1;
    if (keys.KeyD || keys.ArrowRight) dx += 1;
    if (keys.KeyW || keys.ArrowUp) dy -= 1;
    if (keys.KeyS || keys.ArrowDown) dy += 1;
    if (dx !== 0 || dy !== 0) {
      var l = Math.hypot(dx, dy);
      return { x: dx / l, y: dy / l };
    }
    if (thrustPointer) {
      dx = pointerWorld.x - pod.x;
      dy = pointerWorld.y - pod.y;
      var d = Math.hypot(dx, dy);
      if (d > 14) return { x: dx / d, y: dy / d };
    }
    return null;
  }

  function step(dt) {
    if (state !== "fly") return;
    var dir = thrustDir();
    var eff = 0;
    if (dir && fuel > 0) {
      eff = Math.min(1, fuel / dt);
      fuel -= dt * eff;
    }
    computeAccel(pod.x, pod.y);
    var ax = gAX;
    var ay = gAY;
    if (dir && eff > 0) {
      ax += dir.x * THRUST * eff;
      ay += dir.y * THRUST * eff;
      if (Math.random() < eff) {
        sparks.push({
          x: pod.x - dir.x * 8,
          y: pod.y - dir.y * 8,
          vx: pod.vx * 0.4 - dir.x * 120 + (Math.random() - 0.5) * 50,
          vy: pod.vy * 0.4 - dir.y * 120 + (Math.random() - 0.5) * 50,
          life: 0.32,
        });
      }
    }
    pod.vx += ax * dt;
    pod.vy += ay * dt;
    var sp = Math.hypot(pod.vx, pod.vy);
    if (sp > MAXV) {
      pod.vx *= MAXV / sp;
      pod.vy *= MAXV / sp;
    }
    pod.x += pod.vx * dt;
    pod.y += pod.vy * dt;

    if (
      Math.hypot(pod.x - levelDef.goal.x, pod.y - levelDef.goal.y) < GOAL_CATCH
    ) {
      enter("delivered");
      return;
    }
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      if (Math.hypot(pod.x - p.x, pod.y - p.y) < p.r + POD_R) {
        enter("crashed");
        return;
      }
    }
    if (pod.x < -OOB || pod.x > W + OOB || pod.y < -OOB || pod.y > H + OOB) {
      enter("crashed", true);
    }
  }

  /* trajectory preview — same integrator as the live flight */
  function simulatePath(x0, y0, vx0, vy0) {
    var dt = 1 / 90;
    var pts = [];
    var x = x0;
    var y = y0;
    var vx = vx0;
    var vy = vy0;
    for (var i = 0; i < 420; i++) {
      computeAccel(x, y);
      vx += gAX * dt;
      vy += gAY * dt;
      x += vx * dt;
      y += vy * dt;
      if (i % 5 === 0) pts.push({ x: x, y: y });
      if (Math.hypot(x - levelDef.goal.x, y - levelDef.goal.y) < GOAL_CATCH)
        return { pts: pts, fate: "goal" };
      for (var j = 0; j < planets.length; j++) {
        var p = planets[j];
        if (Math.hypot(x - p.x, y - p.y) < p.r + POD_R)
          return { pts: pts, fate: "crash" };
      }
      if (x < -OOB || x > W + OOB || y < -OOB || y > H + OOB)
        return { pts: pts, fate: "lost" };
    }
    return { pts: pts, fate: "drift" };
  }

  /* ---------- state machine ---------- */
  function enter(next, lostInVoid) {
    stateT = 0;
    state = next;
    elRecall.hidden = next !== "fly";
    if (next === "delivered") {
      sfx.deliver();
      showBanner("Delivered!", "good", 1.2);
    } else if (next === "crashed") {
      lostCount++;
      sfx.crash();
      showBanner(lostInVoid ? "Lost to the void" : "Crashed", "bad", 1.0);
      syncHud();
    }
  }

  function launch(vx, vy) {
    pod.vx = vx;
    pod.vy = vy;
    launches++;
    sfx.launch();
    syncHud();
    enter("fly");
  }

  function recallPod() {
    if (state !== "fly") return;
    sfx.recall();
    resetPod();
    enter("aim");
    showBanner("Pod recalled", "", 0.9);
  }

  function advanceAfterDelivery() {
    if (levelIx + 1 >= LEVELS.length) {
      finishRun();
    } else {
      buildLevel(levelIx + 1);
      enter("aim");
    }
  }

  function finishRun() {
    state = "complete";
    elRecall.hidden = true;
    var isRecord = !best || launches < best.launches;
    if (isRecord) {
      best = { launches: launches, lost: lostCount };
      saveBest();
    }
    elKicker.textContent = "Shift complete";
    elTitle.textContent = "Every parcel delivered.";
    elHow.hidden = true;
    elNote.hidden = false;
    elNote.innerHTML =
      "Routes flown: <b>" +
      LEVELS.length +
      "</b> &middot; Launches: <b>" +
      launches +
      "</b> &middot; Parcels lost: <b>" +
      lostCount +
      "</b> &middot; Time: <b>" +
      fmtTime(playTime) +
      "</b><br>" +
      (isRecord
        ? "New shift record!"
        : "Best shift: " + best.launches + " launches.");
    elBtn.textContent = "Fly again";
    elOverlay.hidden = false;
    sfx.deliver();
  }

  function showTitle() {
    state = "title";
    elKicker.textContent = "Interstellar mail service";
    elTitle.textContent = "Perihelion Post";
    elHow.hidden = false;
    elNote.hidden = true;
    elBtn.textContent = "Clock in";
    elOverlay.hidden = false;
    elRecall.hidden = true;
  }

  function startRun() {
    launches = 0;
    lostCount = 0;
    playTime = 0;
    elHow.hidden = false;
    elOverlay.hidden = true;
    buildLevel(0);
    enter("aim");
    sfx.click();
  }

  /* ---------- hud & banners ---------- */
  function syncHud() {
    elRouteTop.textContent = String(levelIx + 1);
    elLaunches.textContent = String(launches);
    elLost.textContent = String(lostCount);
    var frac = fuelMax > 0 ? clamp(fuel / fuelMax, 0, 1) : 0;
    elFuel.style.transform = "scaleX(" + frac.toFixed(3) + ")";
  }

  function showBanner(text, cls, secs) {
    elBanner.textContent = text;
    elBanner.className = cls ? "banner " + cls : "banner";
    elBanner.hidden = false;
    bannerUntil = clock + (secs || 1);
  }

  function hideBannerIfDue() {
    if (!elBanner.hidden && clock > bannerUntil) elBanner.hidden = true;
  }

  /* ---------- rendering ---------- */
  var bgCache = null;
  var vigCache = null;

  function makeOffscreen(draw) {
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    draw(c.getContext("2d"));
    return c;
  }

  function ensureCaches() {
    if (!bgCache) {
      bgCache = makeOffscreen(function (g) {
        var grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#0a1124");
        grad.addColorStop(0.55, "#070d1c");
        grad.addColorStop(1, "#04060f");
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        var neb = g.createRadialGradient(
          W * 0.72,
          H * 0.2,
          20,
          W * 0.72,
          H * 0.2,
          420,
        );
        neb.addColorStop(0, "rgba(126,240,255,0.07)");
        neb.addColorStop(1, "rgba(126,240,255,0)");
        g.fillStyle = neb;
        g.fillRect(0, 0, W, H);
        neb = g.createRadialGradient(
          W * 0.18,
          H * 0.85,
          20,
          W * 0.18,
          H * 0.85,
          380,
        );
        neb.addColorStop(0, "rgba(166,120,217,0.06)");
        neb.addColorStop(1, "rgba(166,120,217,0)");
        g.fillStyle = neb;
        g.fillRect(0, 0, W, H);
      });
    }
    if (!vigCache) {
      vigCache = makeOffscreen(function (g) {
        var v = g.createRadialGradient(
          W / 2,
          H / 2,
          H * 0.42,
          W / 2,
          H / 2,
          H * 0.95,
        );
        v.addColorStop(0, "rgba(0,0,0,0)");
        v.addColorStop(1, "rgba(0,0,8,0.55)");
        g.fillStyle = v;
        g.fillRect(0, 0, W, H);
      });
    }
  }

  function drawStars(t) {
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var a = 0.35 + 0.45 * Math.sin(t * st.sp + st.ph);
      ctx.globalAlpha = clamp(a, 0.08, 0.85);
      ctx.fillStyle = "#cfe4ff";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawGoal(t) {
    var gx = levelDef.goal.x;
    var gy = levelDef.goal.y;
    var pulse = 1 + 0.08 * Math.sin(t * 3);
    ctx.save();
    ctx.strokeStyle = "rgba(109,255,168,0.9)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -t * 26;
    ctx.beginPath();
    ctx.arc(gx, gy, GOAL_CATCH * pulse + 6, 0, 6.2832);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(109,255,168,0.28)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(gx, gy, GOAL_CATCH * pulse + 10, 0, 6.2832);
    ctx.stroke();
    ctx.fillStyle = "#6dffa8";
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(t * 0.9);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.restore();
  }

  function drawPlanets() {
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      ctx.save();
      var glow = ctx.createRadialGradient(
        p.x,
        p.y,
        p.r * 0.8,
        p.x,
        p.y,
        p.r * 1.45,
      );
      glow.addColorStop(0, "rgba(126,240,255,0.10)");
      glow.addColorStop(1, "rgba(126,240,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.45, 0, 6.2832);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.clip();
      var body = ctx.createRadialGradient(
        p.x - p.r * 0.45,
        p.y - p.r * 0.45,
        p.r * 0.15,
        p.x,
        p.y,
        p.r * 1.25,
      );
      body.addColorStop(0, p.skin[0]);
      body.addColorStop(1, p.skin[1]);
      ctx.fillStyle = body;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      for (var s = 0; s < p.spots.length; s++) {
        var sp = p.spots[s];
        ctx.save();
        ctx.translate(p.x + sp.dx, p.y + sp.dy);
        ctx.rotate(sp.rot);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = sp.lite ? "#ffffff" : "#000000";
        ctx.beginPath();
        ctx.ellipse(0, 0, sp.rx, sp.ry, 0, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "rgba(126,240,255,0.16)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 2, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPad() {
    var sx = levelDef.start.x;
    var sy = levelDef.start.y;
    ctx.save();
    ctx.strokeStyle = "rgba(255,179,71,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 16, sy + 14);
    ctx.lineTo(sx, sy + 6);
    ctx.lineTo(sx + 16, sy + 14);
    ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "rgba(255,179,71,0.35)";
    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, 6.2832);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (var i = 1; i < trail.length; i++) {
      var a = trail[i];
      ctx.globalAlpha = clamp(a.a, 0, 0.6);
      ctx.strokeStyle = "#7ef0ff";
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSparks() {
    if (!sparks.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      ctx.globalAlpha = clamp(s.life / 0.32, 0, 1) * 0.8;
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.1 * (s.life / 0.32) + 0.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPod(t) {
    var bob = state === "aim" ? Math.sin(t * 2) * 2 : 0;
    var ang =
      state === "aim"
        ? aim.active
          ? Math.atan2(aim.y - pod.y, aim.x - pod.x)
          : -Math.PI / 2
        : Math.atan2(pod.vy, pod.vx);
    ctx.save();
    ctx.translate(pod.x, pod.y + bob);

    if (state === "fly" && (thrustPointer || keysActive())) {
      ctx.save();
      ctx.rotate(ang);
      ctx.globalCompositeOperation = "lighter";
      var fl = 14 + Math.random() * 9;
      var grad = ctx.createLinearGradient(-9, 0, -9 - fl, 0);
      grad.addColorStop(0, "rgba(255,179,71,0.95)");
      grad.addColorStop(1, "rgba(255,84,112,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-9, -4);
      ctx.lineTo(-9 - fl, 0);
      ctx.lineTo(-9, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(ang);
    var hull = ctx.createLinearGradient(-10, -8, 12, 8);
    hull.addColorStop(0, "#ffd9a0");
    hull.addColorStop(1, "#ff9d47");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-9, -8);
    ctx.quadraticCurveTo(-12, 0, -9, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(6,10,22,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#7ef0ff";
    ctx.beginPath();
    ctx.arc(4, 0, 2.6, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.fillStyle = "#ff5470";
    ctx.beginPath();
    ctx.arc(-6, 0, 1.6, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function keysActive() {
    return !!(
      keys.KeyA ||
      keys.KeyW ||
      keys.KeyS ||
      keys.KeyD ||
      keys.ArrowLeft ||
      keys.ArrowRight ||
      keys.ArrowUp ||
      keys.ArrowDown
    );
  }

  function aimVelocity() {
    var dx = aim.x - pod.x;
    var dy = aim.y - pod.y;
    var len = Math.hypot(dx, dy);
    if (len < MIN_DRAG) return null;
    var capped = Math.min(len, DRAG_MAX) * SPEED_PER_PX;
    return {
      vx: (dx / len) * capped,
      vy: (dy / len) * capped,
      frac: Math.min(len, DRAG_MAX) / DRAG_MAX,
    };
  }

  function drawAim() {
    if (state !== "aim" || !aim.active) return;
    var v = aimVelocity();
    ctx.save();
    if (!v) {
      ctx.strokeStyle = "rgba(126,240,255,0.4)";
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(pod.x, pod.y);
      ctx.lineTo(aim.x, aim.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    var sim = simulatePath(pod.x, pod.y, v.vx, v.vy);
    var n = sim.pts.length;
    for (var i = 0; i < n; i++) {
      var pt = sim.pts[i];
      var fade = 1 - i / n;
      ctx.globalAlpha = 0.15 + 0.75 * fade;
      ctx.fillStyle =
        sim.fate === "goal" && i === n - 1 ? "#6dffa8" : "#7ef0ff";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.2 + 1.4 * fade, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(126,240,255,0.35)";
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y);
    ctx.lineTo(aim.x, aim.y);
    ctx.stroke();
    ctx.setLineDash([]);
    var ang = Math.atan2(aim.y - pod.y, aim.x - pod.x);
    ctx.save();
    ctx.translate(aim.x, aim.y);
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(126,240,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-4, -6);
    ctx.lineTo(-4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(126,240,255,0.8)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pod.x, pod.y, 19, -Math.PI / 2, -Math.PI / 2 + v.frac * 6.2832);
    ctx.stroke();
    ctx.restore();
  }

  function render(t) {
    ensureCaches();
    ctx.drawImage(bgCache, 0, 0);
    drawStars(t);
    drawGoal(t);
    drawPlanets();
    if (state === "aim") drawPad();
    drawTrail();
    drawSparks();
    drawPod(t);
    drawAim();
    ctx.drawImage(vigCache, 0, 0);
  }

  /* ---------- main loop ---------- */
  function frame(ts) {
    requestAnimationFrame(frame);
    if (paused) {
      lastTs = ts;
      return;
    }
    var dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;
    clock += dt;
    if (
      state === "aim" ||
      state === "fly" ||
      state === "delivered" ||
      state === "crashed"
    ) {
      playTime += dt;
    }
    acc += dt;
    var guard = 0;
    while (acc >= STEP && guard < 16) {
      step(STEP);
      acc -= STEP;
      guard++;
    }
    stateT += dt;

    if (state === "fly") {
      trail.push({ x: pod.x, y: pod.y, a: 0.6 });
      if (trail.length > 110) trail.shift();
    }
    for (var i = trail.length - 1; i >= 0; i--) {
      trail[i].a -= dt * 0.5;
      if (trail[i].a <= 0) trail.splice(i, 1);
    }
    for (var j = sparks.length - 1; j >= 0; j--) {
      var s = sparks[j];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life <= 0) sparks.splice(j, 1);
    }

    if (state === "delivered" && stateT > 1.25) advanceAfterDelivery();
    if (state === "crashed" && stateT > 1.05) {
      resetPod();
      enter("aim");
    }
    hideBannerIfDue();
    setThrustSound(
      state === "fly" && (thrustPointer || keysActive()) && fuel > 0,
    );
    syncHud();
    canvas.dataset.state = state;
    canvas.dataset.route = String(levelIx + 1);
    render(clock);
  }

  /* ---------- input ---------- */
  function toWorld(e) {
    var rect = canvas.getBoundingClientRect();
    pointerWorld.x = ((e.clientX - rect.left) / rect.width) * W;
    pointerWorld.y = ((e.clientY - rect.top) / rect.height) * H;
  }

  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio();
    toWorld(e);
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture is best-effort */
    }
    if (state === "aim") {
      aim.active = true;
      aim.x = pointerWorld.x;
      aim.y = pointerWorld.y;
    } else if (state === "fly") {
      thrustPointer = true;
    }
  });

  canvas.addEventListener("pointermove", function (e) {
    toWorld(e);
    if (aim.active) {
      aim.x = pointerWorld.x;
      aim.y = pointerWorld.y;
    }
  });

  function endPointer(e) {
    if (aim.active) {
      aim.active = false;
      toWorld(e);
      aim.x = pointerWorld.x;
      aim.y = pointerWorld.y;
      var v = aimVelocity();
      if (v && state === "aim") launch(v.vx, v.vy);
    }
    thrustPointer = false;
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", function () {
    aim.active = false;
    thrustPointer = false;
  });
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  window.addEventListener("keydown", function (e) {
    var code = e.code;
    if (
      code === "Space" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight"
    ) {
      e.preventDefault();
    }
    ensureAudio();
    if (code === "Space") {
      if (!e.repeat) recallPod();
      return;
    }
    if (code === "Escape") {
      if (!e.repeat) recallPod();
      return;
    }
    keys[code] = true;
  });

  window.addEventListener("keyup", function (e) {
    keys[e.code] = false;
  });

  elBtn.addEventListener("click", function () {
    ensureAudio();
    if (state === "complete" || state === "title") startRun();
  });

  elRecall.addEventListener("click", function () {
    ensureAudio();
    recallPod();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      paused = true;
      if (ac && ac.state === "running") {
        try {
          ac.suspend();
        } catch (err) {
          /* stay silent */
        }
      }
    } else {
      paused = false;
      lastTs = performance.now();
      acc = 0;
      ensureAudio();
    }
  });

  /* ---------- sizing ---------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    var dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.width * dpr * (H / W));
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  window.addEventListener("resize", resize);

  /* ---------- boot ---------- */
  function boot() {
    loadBest();
    var q = new URLSearchParams(window.location.search).get("level");
    var ix = q ? parseInt(q, 10) : NaN;
    if (!isNaN(ix)) {
      levelIx = clamp(ix - 1, 0, LEVELS.length - 1);
      buildLevel(levelIx);
    } else {
      buildLevel(0);
    }
    showTitle();
    resize();
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }

  boot();
})();
