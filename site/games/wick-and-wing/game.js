/*
 * Wick & Wing - you cannot steer the moth; it flies at whatever wick burns
 * brightest. You hold the matches: snuff lanterns for free, relight them for
 * a match, and lure the moth across every sleeping bud before dawn - past
 * humming zapper bulbs, brambles, crosswinds and one patient bat.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const ease = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

  const W = 960;
  const H = 600;
  const GROUND = 512;
  const NEST = { x: 84, y: 488 };

  // ------------------------------------------------------------------ audio
  const Sound = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: false,
    ensure() {
      if (this.ctx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.85;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1.2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return true;
      } catch (err) {
        return false;
      }
    },
    resume() {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    setMuted(m) {
      this.muted = m;
      try {
        localStorage.setItem("wick-wing-muted", m ? "1" : "0");
      } catch (err) {
        /* private mode */
      }
      if (this.master) this.master.gain.value = m ? 0 : 0.85;
    },
    tone(type, f0, f1, dur, gain, when) {
      if (!this.ensure()) return;
      const t0 = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    },
    noise(dur, gain, fType, f0, f1, when) {
      if (!this.ensure()) return;
      const t0 = this.ctx.currentTime + (when || 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = fType;
      f.frequency.setValueAtTime(f0, t0);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },
    match() {
      this.noise(0.14, 0.28, "highpass", 2200);
      this.tone("triangle", 1750, 900, 0.09, 0.07, 0.02);
    },
    snuff() {
      this.noise(0.3, 0.14, "lowpass", 1400, 220);
    },
    bloom(step) {
      const notes = [659, 784, 880, 1047];
      this.tone(
        "triangle",
        notes[step % 4],
        notes[step % 4] * 1.01,
        0.22,
        0.12,
      );
      this.tone(
        "sine",
        notes[step % 4] * 2,
        notes[step % 4] * 2,
        0.3,
        0.04,
        0.04,
      );
    },
    zap() {
      this.tone("sawtooth", 130, 40, 0.32, 0.3);
      this.noise(0.25, 0.22, "bandpass", 2600, 300);
    },
    buzzNear() {
      this.tone("square", 95, 92, 0.18, 0.045);
    },
    gust() {
      this.noise(0.9, 0.09, "lowpass", 300, 900);
    },
    screech() {
      this.tone("sine", 1900, 620, 0.22, 0.06);
      this.tone("sine", 2300, 700, 0.18, 0.04, 0.06);
    },
    jingle() {
      [523, 659, 784, 1047].forEach((f, i) =>
        this.tone("triangle", f, f, 0.3, 0.12, i * 0.11),
      );
    },
    toll() {
      [392, 311, 262].forEach((f, i) =>
        this.tone("sine", f, f * 0.985, 0.55, 0.14, i * 0.28),
      );
    },
  };

  // ----------------------------------------------------------------- levels
  // lantern: [x, y, brightness, startsLit]; zapper: [x, y]; bud: [x, y];
  // bramble: [x, y, r]. Buds sit on the straight lines between lanterns so
  // each "snuff here, light there" release has a fair corridor to fly.
  const LEVELS = [
    {
      name: "First Flight",
      matches: 3,
      moths: 2,
      dawn: 75,
      lanterns: [
        [250, 442, 1, true],
        [480, 330, 1, false],
        [706, 430, 1, true],
      ],
      zappers: [],
      buds: [
        [172, 462],
        [366, 392],
        [594, 382],
      ],
      brambles: [],
      bat: null,
      wind: null,
    },
    {
      name: "The Violet Hum",
      matches: 4,
      moths: 2,
      dawn: 82,
      lanterns: [
        [238, 452, 1, true],
        [724, 452, 1, false],
        [482, 208, 1, false],
      ],
      zappers: [[482, 344]],
      buds: [
        [330, 364],
        [606, 352],
        [444, 264],
      ],
      brambles: [],
      bat: null,
      wind: null,
    },
    {
      name: "Crosswind",
      matches: 5,
      moths: 2,
      dawn: 88,
      lanterns: [
        [296, 466, 1, true],
        [560, 300, 1, false],
        [836, 430, 1, false],
      ],
      zappers: [],
      buds: [
        [178, 424],
        [428, 372],
        [700, 368],
        [886, 300],
      ],
      brambles: [
        [452, 476, 42],
        [510, 500, 34],
      ],
      bat: null,
      wind: { period: 7, force: 120 },
    },
    {
      name: "The Hunter",
      matches: 5,
      moths: 2,
      dawn: 92,
      lanterns: [
        [222, 442, 1, true],
        [520, 246, 1, false],
        [806, 478, 1, false],
      ],
      zappers: [],
      buds: [
        [352, 352],
        [642, 178],
        [864, 330],
        [500, 470],
      ],
      brambles: [[676, 430, 38]],
      bat: { chase: 132, wander: 62 },
      wind: null,
    },
    {
      name: "Two Flames",
      matches: 6,
      moths: 2,
      dawn: 96,
      lanterns: [
        [204, 480, 1, true],
        [204, 296, 1, false],
        [700, 218, 1, false],
        [764, 466, 1, false],
        [482, 108, 1, false],
      ],
      zappers: [
        [432, 254],
        [532, 428],
      ],
      buds: [
        [330, 208],
        [618, 332],
        [878, 148],
        [482, 496],
      ],
      brambles: [[348, 420, 40]],
      bat: null,
      wind: null,
    },
    {
      name: "The Last Wick",
      matches: 6,
      moths: 3,
      dawn: 105,
      lanterns: [
        [152, 300, 1, false],
        [322, 468, 1, true],
        [522, 178, 1, false],
        [562, 462, 1, false],
        [782, 296, 1, false],
        [902, 478, 1, false],
      ],
      zappers: [
        [424, 330],
        [682, 470],
      ],
      buds: [
        [152, 152],
        [430, 480],
        [642, 122],
        [862, 198],
        [760, 500],
      ],
      brambles: [
        [252, 202, 40],
        [606, 306, 36],
      ],
      bat: { chase: 138, wander: 66 },
      wind: { period: 6.5, force: 105 },
    },
  ];

  // ------------------------------------------------------------------- state
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  let dpr = 1;

  function fitCanvas() {
    dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: rand(0, W),
      y: rand(10, GROUND - 140),
      r: rand(0.5, 1.6),
      tw: rand(1.5, 4),
      ph: rand(0, TAU),
    });
  }
  const grassBlades = [];
  for (let i = 0; i < 70; i++) {
    grassBlades.push({
      x: rand(0, W),
      h: rand(7, 20),
      lean: rand(-0.25, 0.25),
      sway: rand(0.6, 1.6),
      ph: rand(0, TAU),
    });
  }
  const hedgeBumps = [];
  for (let x = -20; x < W + 40; x += rand(26, 54)) {
    hedgeBumps.push({ x, r: rand(18, 42) });
  }

  const S = {
    mode: "intro", // intro | playing | paused | cleared | failed | won
    night: 0,
    time: 0,
    dawnLeft: 75,
    matches: 0,
    mothsLeft: 0,
    pollenNight: 0,
    pollenRun: 0,
    bloomedCount: 0,
    lanterns: [],
    zappers: [],
    buds: [],
    brambles: [],
    bat: null,
    wind: null,
    moth: null,
    sel: 0,
    particles: [],
    streaks: [],
    gustPhase: 0,
    gustOn: false,
    dieTimer: 0,
    shake: 0,
    introMode: "begin",
  };

  function makeMoth(x, y) {
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      heading: -0.35,
      flap: rand(0, TAU),
      beacon: null,
    };
  }

  function buildEntities(L) {
    S.lanterns = L.lanterns.map(([x, y, b, lit]) => ({
      x,
      y,
      b,
      lit,
      seed: rand(0, TAU),
      smoke: 0,
    }));
    S.zappers = L.zappers.map(([x, y]) => ({ x, y, flash: 0 }));
    S.buds = L.buds.map(([x, y]) => ({ x, y, done: false, bloomT: 0 }));
    S.brambles = L.brambles.map(([x, y, r]) => ({ x, y, r }));
    S.bat = L.bat
      ? { ...L.bat, x: W - 120, y: 110, tx: 0, ty: 0, hunt: 0 }
      : null;
    S.wind = L.wind ? { ...L.wind } : null;
  }

  function loadNight(idx) {
    const L = LEVELS[idx];
    S.night = idx;
    S.time = 0;
    S.dawnLeft = L.dawn;
    S.matches = L.matches;
    S.mothsLeft = L.moths;
    S.pollenNight = 0;
    S.bloomedCount = 0;
    buildEntities(L);
    S.moth = makeMoth(NEST.x, NEST.y);
    S.sel = Math.max(
      0,
      S.lanterns.findIndex((l) => l.lit),
    );
    S.particles.length = 0;
    S.streaks.length = 0;
    S.dieTimer = 0;
    S.shake = 0;
    S.mode = "playing";
    hidePanels();
    toast("Night " + (idx + 1) + " \u2014 " + L.name);
    syncHud();
  }

  function startRun() {
    S.pollenRun = 0;
    loadNight(0);
  }

  // ------------------------------------------------------------- UI plumbing
  const panels = {
    intro: $("panel-intro"),
    paused: $("panel-pause"),
    cleared: $("panel-clear"),
    failed: $("panel-fail"),
    won: $("panel-won"),
  };

  function hidePanels() {
    Object.values(panels).forEach((p) => p.classList.add("hidden"));
  }
  function showPanel(name) {
    hidePanels();
    panels[name].classList.remove("hidden");
  }

  let toastTimer = null;
  function toast(msg, warn) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.toggle("warn", !!warn);
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function syncHud() {
    $("hud-night").textContent =
      "Night " + (S.night + 1) + " \u00b7 " + LEVELS[S.night].name;
    const done = S.buds.filter((b) => b.done).length;
    $("hud-buds").textContent = done + "/" + S.buds.length;
    $("hud-matches").textContent = String(S.matches);
    $("hud-moths").textContent = String(S.mothsLeft);
    $("hud-pollen").textContent = String(S.pollenRun + S.pollenNight);
    $("dawn-fill").style.width =
      clamp(S.dawnLeft / LEVELS[S.night].dawn, 0, 1) * 100 + "%";
    $("btn-sound").setAttribute("aria-pressed", Sound.muted ? "false" : "true");
    $("btn-sound").textContent = Sound.muted ? "Muted" : "Sound";
  }

  function nightCleared() {
    const bonus = S.matches * 5 + S.mothsLeft * 25;
    S.pollenRun += S.pollenNight + bonus;
    S.mode = "cleared";
    Sound.jingle();
    if (S.night === LEVELS.length - 1) {
      const total = S.pollenRun;
      let bestNote = " \u00b7 A new best!";
      try {
        const prev = Number(localStorage.getItem("wing-best")) || 0;
        if (total <= prev) bestNote = " \u00b7 Best: " + prev;
        localStorage.setItem("wing-best", String(Math.max(total, prev)));
      } catch (err) {
        /* private mode */
      }
      $("won-stats").textContent =
        "All six nights survived.\nFinal pollen: " + total + bestNote;
      showPanel("won");
    } else {
      $("clear-title").textContent = "Night " + (S.night + 1) + " pollinated";
      $("clear-stats").textContent =
        "Buds woken: " +
        S.buds.length +
        "/" +
        S.buds.length +
        "\nPollen banked: " +
        (S.pollenNight + bonus) +
        "  (" +
        S.pollenNight +
        " + matches " +
        S.matches * 5 +
        " + moths " +
        S.mothsLeft * 25 +
        ")" +
        "\nTotal so far: " +
        S.pollenRun;
      $("btn-next").textContent = "Next: Night " + (S.night + 2);
      showPanel("cleared");
    }
    syncHud();
  }

  function nightFailed(reason) {
    S.mode = "failed";
    Sound.toll();
    if (reason === "dawn") {
      $("fail-title").textContent = "Dawn caught you";
      $("fail-stats").textContent =
        "The sky went grey with " +
        S.buds.filter((b) => !b.done).length +
        " bud(s) still asleep.";
    } else {
      $("fail-title").textContent = "The garden went quiet";
      $("fail-stats").textContent =
        "Every wing is spent. Dust settles on the path.";
    }
    showPanel("failed");
  }

  // ---------------------------------------------------------------- gameplay
  function beaconFor(moth) {
    let best = null;
    let bestW = 0;
    for (const z of S.zappers) {
      const d2 = (z.x - moth.x) ** 2 + (z.y - moth.y) ** 2;
      const w = 1.9 / (d2 + 2500);
      if (w > bestW) {
        bestW = w;
        best = { x: z.x, y: z.y, kind: "zap" };
      }
    }
    for (const l of S.lanterns) {
      if (!l.lit) continue;
      const d2 = (l.x - moth.x) ** 2 + (l.y - moth.y) ** 2;
      const w = l.b / (d2 + 2500);
      if (w > bestW) {
        bestW = w;
        best = { x: l.x, y: l.y, kind: "lamp" };
      }
    }
    return best;
  }

  function spawnPuff(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      S.particles.push({
        x: x + rand(-4, 4),
        y: y + rand(-6, 6),
        vx: rand(-34, 34),
        vy: rand(-52, -8),
        life: rand(0.3, 0.9),
        max: 0.9,
        size: rand(1, 2.6),
        col,
      });
    }
  }

  function toggleLantern(l) {
    if (!l) return;
    if (l.lit) {
      l.lit = false;
      l.smoke = 1;
      Sound.snuff();
      spawnPuff(l.x, l.y - 12, "150,150,160", 8);
    } else {
      if (S.matches <= 0) {
        toast("No matches left \u2014 fly dark.", true);
        return;
      }
      S.matches--;
      l.lit = true;
      Sound.match();
      spawnPuff(l.x, l.y - 12, "255,190,90", 10);
    }
    syncHud();
  }

  function killMoth(cause) {
    const m = S.moth;
    if (!m || S.dieTimer > 0) return;
    S.dieTimer = 1;
    S.shake = 10;
    Sound.zap();
    for (let i = 0; i < 26; i++) {
      S.particles.push({
        x: m.x,
        y: m.y,
        vx: rand(-120, 120),
        vy: rand(-120, 120),
        life: rand(0.3, 0.7),
        max: 0.7,
        size: rand(1.4, 3),
        col: cause === "zap" ? "190,140,255" : "230,230,230",
      });
    }
    m.vx = 0;
    m.vy = 0;
  }

  function respawnOrFail() {
    S.mothsLeft--;
    if (S.mothsLeft <= 0) {
      nightFailed("moths");
    } else {
      S.moth = makeMoth(NEST.x, NEST.y);
      toast("Another moth rises from the nest.");
      syncHud();
    }
  }

  function updateWind() {
    if (!S.wind) return;
    const ph = (S.time % S.wind.period) / S.wind.period;
    const wasOn = S.gustOn;
    S.gustOn = ph < 0.3;
    if (S.gustOn && !wasOn) Sound.gust();
    S.gustPhase = S.gustOn ? Math.sin((ph / 0.3) * Math.PI) : 0;
    if (S.gustOn) {
      for (let i = 0; i < 2; i++) {
        S.streaks.push({
          x: rand(-40, W * 0.4),
          y: rand(40, GROUND - 20),
          v: rand(260, 420),
          len: rand(30, 90),
          life: rand(0.5, 0.9),
        });
      }
    }
  }

  function updateBat(dt) {
    const b = S.bat;
    if (!b) return;
    const m = S.moth;
    let sees = false;
    if (S.dieTimer <= 0) {
      for (const l of S.lanterns) {
        if (l.lit && dist(l.x, l.y, m.x, m.y) < 190) sees = true;
      }
      for (const z of S.zappers) {
        if (dist(z.x, z.y, m.x, m.y) < 170) sees = true;
      }
    }
    if (sees && b.hunt < 0.1) {
      Sound.screech();
      toast("The bat has seen your light!", true);
    }
    b.hunt = sees
      ? Math.min(1, b.hunt + dt * 3)
      : Math.max(0, b.hunt - dt * 0.7);
    if (!b.tx || dist(b.x, b.y, b.tx, b.ty) < 24) {
      b.tx = b.hunt > 0.5 ? m.x + rand(-30, 30) : rand(80, W - 80);
      b.ty = b.hunt > 0.5 ? m.y + rand(-30, 30) : rand(60, GROUND - 120);
    }
    const sp = lerp(b.wander, b.chase, b.hunt);
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    b.x += (dx / d) * sp * dt;
    b.y += (dy / d) * sp * dt + Math.sin(S.time * 5) * 12 * dt;
    if (b.hunt > 0.4 && S.dieTimer <= 0 && dist(b.x, b.y, m.x, m.y) < 21) {
      killMoth("bat");
    }
  }

  function updateMoth(dt) {
    const m = S.moth;
    const beacon = beaconFor(m);
    if (beacon) {
      const dx = beacon.x - m.x;
      const dy = beacon.y - m.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      m.vx += (dx / d) * 330 * dt;
      m.vy += (dy / d) * 330 * dt;
      m.heading = Math.atan2(dy, dx);
      m.beacon = beacon;
    } else {
      m.heading += Math.sin(S.time * 1.7 + m.flap) * 0.25 * dt;
      m.vx += Math.cos(m.heading) * 40 * dt;
      m.vy += Math.sin(m.heading) * 40 * dt;
      m.beacon = null;
    }
    if (S.wind && S.gustOn) m.vx += S.wind.force * S.gustPhase * dt;

    const sp = Math.hypot(m.vx, m.vy);
    if (sp > 152) {
      m.vx = (m.vx / sp) * 152;
      m.vy = (m.vy / sp) * 152;
    }
    m.vx *= 0.995;
    m.vy *= 0.995;
    m.x += m.vx * dt;
    m.y += m.vy * dt;

    // soft walls
    if (m.x < 26) {
      m.x = 26;
      m.vx = Math.abs(m.vx) * 0.5;
    }
    if (m.x > W - 26) {
      m.x = W - 26;
      m.vx = -Math.abs(m.vx) * 0.5;
    }
    if (m.y < 34) {
      m.y = 34;
      m.vy = Math.abs(m.vy) * 0.5;
    }
    if (m.y > GROUND - 6) {
      m.y = GROUND - 6;
      m.vy = -Math.abs(m.vy) * 0.55;
    }
    // brambles push out and damp
    for (const br of S.brambles) {
      const d = dist(br.x, br.y, m.x, m.y);
      if (d < br.r + 8) {
        const nx = (m.x - br.x) / (d || 1);
        const ny = (m.y - br.y) / (d || 1);
        m.x = br.x + nx * (br.r + 8);
        m.y = br.y + ny * (br.r + 8);
        m.vx *= 0.4;
        m.vy *= 0.4;
      }
    }
    // buds
    for (const bd of S.buds) {
      if (!bd.done && dist(bd.x, bd.y, m.x, m.y) < 26) {
        bd.done = true;
        bd.bloomT = 0;
        S.bloomedCount++;
        S.pollenNight += 10;
        Sound.bloom(S.bloomedCount);
        spawnPuff(bd.x, bd.y, "255,214,235", 12);
        syncHud();
        if (S.bloomedCount === S.buds.length) {
          nightCleared();
          return;
        }
      }
    }
    // zappers
    for (const z of S.zappers) {
      const d = dist(z.x, z.y, m.x, m.y);
      if (d < 30) {
        killMoth("zap");
        return;
      }
      if (d < 110 && Math.random() < dt * 2) Sound.buzzNear();
    }
    // wing trail
    m.flap += dt * TAU * 10;
    if (Math.random() < dt * 22) {
      S.particles.push({
        x: m.x + rand(-2, 2),
        y: m.y + rand(-2, 2),
        vx: rand(-4, 4),
        vy: rand(-2, 8),
        life: rand(0.3, 0.7),
        max: 0.7,
        size: rand(0.8, 1.8),
        col: "235,225,205",
      });
    }
  }

  function update(dt) {
    S.time += dt;
    S.shake = Math.max(0, S.shake - dt * 30);
    updateWind();
    for (const z of S.zappers) {
      z.flash = Math.random() < 0.06 ? 1 : Math.max(0, z.flash - dt * 4);
    }

    if (S.mode === "intro") {
      const m = S.moth;
      m.x = NEST.x + Math.sin(S.time * 2) * 6;
      m.y = NEST.y + Math.cos(S.time * 2.6) * 5;
      m.flap += dt * TAU * 8;
      return;
    }
    if (S.mode !== "playing") return;

    S.dawnLeft -= dt;
    if (S.dawnLeft <= 0) {
      S.dawnLeft = 0;
      syncHud();
      nightFailed("dawn");
      return;
    }
    if (S.dieTimer > 0) {
      S.dieTimer -= dt;
      if (S.dieTimer <= 0) {
        respawnOrFail();
        if (S.mode !== "playing") return;
      }
    } else {
      updateMoth(dt);
      if (S.mode !== "playing") return;
      updateBat(dt);
      if (S.mode !== "playing") return;
    }
    for (const bd of S.buds) {
      if (bd.done && bd.bloomT < 1) bd.bloomT += dt * 2;
    }
    for (const l of S.lanterns) l.smoke = Math.max(0, l.smoke - dt);
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 14 * dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    for (let i = S.streaks.length - 1; i >= 0; i--) {
      const st = S.streaks[i];
      st.life -= dt;
      st.x += st.v * dt;
      if (st.life <= 0 || st.x > W + 120) S.streaks.splice(i, 1);
    }
    syncHud();
  }

  // ----------------------------------------------------------------- drawing
  function mixCol(c1, c2, k) {
    const c = c1.map((v, i) => Math.round(lerp(v, c2[i], k)));
    return "rgb(" + c.join(",") + ")";
  }

  function drawSky(p) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixCol([13, 16, 46], [72, 88, 148], p * 0.75));
    g.addColorStop(0.7, mixCol([22, 24, 60], [150, 118, 118], p));
    g.addColorStop(1, mixCol([30, 26, 58], [206, 146, 108], p));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const sa = clamp(1 - p * 1.6, 0, 1);
    if (sa > 0.01) {
      for (const s of stars) {
        ctx.globalAlpha =
          sa * (0.35 + 0.65 * Math.abs(Math.sin(S.time * s.tw + s.ph)));
        ctx.fillStyle = "#e8ecff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const mx = 806;
    const my = lerp(86, GROUND + 40, p);
    ctx.save();
    ctx.globalAlpha = clamp(1 - p * 1.15, 0, 1);
    const mg = ctx.createRadialGradient(mx, my, 6, mx, my, 74);
    mg.addColorStop(0, "rgba(232,236,255,0.5)");
    mg.addColorStop(1, "rgba(232,236,255,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(mx - 80, my - 80, 160, 160);
    ctx.fillStyle = "#eef0fa";
    ctx.beginPath();
    ctx.arc(mx, my, 26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(190,195,220,0.5)";
    ctx.beginPath();
    ctx.arc(mx - 8, my - 6, 5, 0, TAU);
    ctx.arc(mx + 7, my + 8, 7, 0, TAU);
    ctx.arc(mx + 10, my - 10, 3.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawGround() {
    ctx.fillStyle = "#0c1420";
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    for (const b of hedgeBumps) {
      ctx.lineTo(b.x, GROUND - b.r);
      ctx.quadraticCurveTo(
        b.x + b.r * 0.5,
        GROUND - b.r - 8,
        b.x + b.r,
        GROUND - b.r * 0.4,
      );
    }
    ctx.lineTo(W, GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#101a26";
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = "rgba(46,74,60,0.9)";
    ctx.lineWidth = 1.4;
    for (const gb of grassBlades) {
      const sw = Math.sin(S.time * gb.sway + gb.ph) * 3;
      ctx.beginPath();
      ctx.moveTo(gb.x, H);
      ctx.quadraticCurveTo(
        gb.x + sw,
        H - gb.h * 0.6,
        gb.x + sw + gb.lean * 14,
        H - gb.h,
      );
      ctx.stroke();
    }
  }

  function drawHalo(x, y, r, rgba) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, rgba.replace("$A", "0.34"));
    g.addColorStop(0.55, rgba.replace("$A", "0.12"));
    g.addColorStop(1, rgba.replace("$A", "0"));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawLantern(l, selected) {
    const flick = l.lit ? 0.86 + 0.14 * Math.sin(S.time * 13 + l.seed) : 0;
    ctx.strokeStyle = "#241b12";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y + 34);
    ctx.lineTo(l.x, l.y - 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(l.x - 9, l.y - 2);
    ctx.lineTo(l.x + 9, l.y - 2);
    ctx.stroke();
    ctx.fillStyle = "#1a1410";
    ctx.fillRect(l.x - 8, l.y - 22, 16, 22);
    if (l.lit) {
      ctx.globalCompositeOperation = "lighter";
      drawHalo(
        l.x,
        l.y - 12,
        96 * l.b * (0.94 + 0.06 * flick),
        "rgba(255,178,71,$A)",
      );
      ctx.globalCompositeOperation = "source-over";
      const fg = ctx.createRadialGradient(l.x, l.y - 12, 1, l.x, l.y - 12, 9);
      fg.addColorStop(0, "#fff3cf");
      fg.addColorStop(0.5, "#ffc76e");
      fg.addColorStop(1, "rgba(255,150,40,0.25)");
      ctx.fillStyle = fg;
      ctx.fillRect(l.x - 7, l.y - 21, 14, 20);
    } else {
      ctx.fillStyle = "rgba(140,150,175,0.16)";
      ctx.fillRect(l.x - 7, l.y - 21, 14, 20);
      if (l.smoke > 0) {
        ctx.strokeStyle = "rgba(180,180,190," + 0.35 * l.smoke + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y - 22);
        ctx.quadraticCurveTo(
          l.x + 6 * Math.sin(S.time * 3),
          l.y - 34,
          l.x + 12 * Math.sin(S.time * 2),
          l.y - 46,
        );
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#2a2016";
    ctx.fillRect(l.x - 10, l.y - 26, 20, 5);
    if (selected) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,213,140,0.9)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -S.time * 26;
      ctx.beginPath();
      ctx.arc(l.x, l.y - 8, 34, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,213,140,0.95)";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(S.lanterns.indexOf(l) + 1), l.x, l.y - 50);
      ctx.restore();
    }
  }

  function drawZapper(z) {
    ctx.save();
    ctx.strokeStyle = "#1d1830";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(z.x, z.y + 30);
    ctx.lineTo(z.x, z.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    drawHalo(z.x, z.y, 116, "rgba(158,102,255,$A)");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(40,20,70,0.9)";
    ctx.beginPath();
    ctx.arc(z.x, z.y, 17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(196,150,255," + (z.flash > 0 ? 1 : 0.75) + ")";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    for (let a = 0; a < 3; a++) {
      ctx.strokeStyle = "rgba(216,186,255," + rand(0.25, 0.8).toFixed(2) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      let ax = z.x - 12;
      ctx.moveTo(ax, z.y + rand(-10, 10));
      for (let s = 0; s < 4; s++) {
        ax += 6;
        ctx.lineTo(ax, z.y + rand(-11, 11));
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(196,140,255,0.35)";
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(z.x, z.y, 30, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBud(bd) {
    ctx.strokeStyle = "#2f4a3a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bd.x, bd.y + 16);
    ctx.quadraticCurveTo(bd.x - 3, bd.y + 6, bd.x, bd.y);
    ctx.stroke();
    if (bd.done) {
      const k = ease(bd.bloomT);
      const pulse = 1 + 0.05 * Math.sin(S.time * 3 + bd.x);
      for (let pt = 0; pt < 5; pt++) {
        const a = (pt / 5) * TAU + S.time * 0.15;
        ctx.save();
        ctx.translate(bd.x, bd.y);
        ctx.rotate(a);
        ctx.fillStyle = "rgba(244,196,224," + 0.92 * k + ")";
        ctx.beginPath();
        ctx.ellipse(
          6 * k * pulse,
          0,
          7 * k * pulse,
          3.6 * k * pulse,
          0,
          0,
          TAU,
        );
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "rgba(255,214,120," + k + ")";
      ctx.beginPath();
      ctx.arc(bd.x, bd.y, 3 * k + 1, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = "#b9c8a2";
      ctx.beginPath();
      ctx.ellipse(bd.x, bd.y, 4.4, 6.2, 0.3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(60,80,58,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bd.x - 2, bd.y - 5);
      ctx.quadraticCurveTo(bd.x + 3, bd.y, bd.x - 1, bd.y + 6);
      ctx.stroke();
    }
  }

  function drawBramble(br) {
    ctx.save();
    ctx.translate(br.x, br.y);
    ctx.strokeStyle = "#1a2418";
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + br.r;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * br.r * 0.2, Math.sin(a) * br.r * 0.2);
      ctx.quadraticCurveTo(
        Math.cos(a + 0.3) * br.r * 0.7,
        Math.sin(a + 0.3) * br.r * 0.7,
        Math.cos(a) * br.r,
        Math.sin(a) * br.r,
      );
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(22,32,22,0.9)";
    ctx.beginPath();
    ctx.arc(0, 0, br.r * 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBat(b) {
    const flap = Math.sin(S.time * 9) * 0.9;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = "#14101e";
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 6.5, 0, 0, TAU);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(2 * s, -2);
      ctx.quadraticCurveTo(
        14 * s,
        -14 * (0.4 + flap * 0.6),
        26 * s,
        -6 * (0.3 + flap * 0.7),
      );
      ctx.quadraticCurveTo(16 * s, 2, 3 * s, 3);
      ctx.closePath();
      ctx.fill();
    }
    if (b.hunt > 0.35) {
      ctx.fillStyle = "rgba(255,80,80," + (0.4 + b.hunt * 0.6).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(-3.4, -1.6, 1.5, 0, TAU);
      ctx.arc(3.4, -1.6, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMoth(m) {
    const dying = S.dieTimer > 0;
    ctx.save();
    ctx.translate(m.x, m.y);
    if (dying) {
      ctx.globalAlpha = clamp(S.dieTimer, 0, 1);
      ctx.rotate(S.time * 6);
      ctx.scale(1 + (1 - S.dieTimer) * 0.6, 1 + (1 - S.dieTimer) * 0.6);
    } else {
      ctx.rotate(Math.atan2(m.vy, m.vx) * 0.4);
    }
    const flap = Math.abs(Math.sin(m.flap));
    ctx.fillStyle = dying ? "rgba(200,180,200,0.9)" : "rgba(236,228,209,0.92)";
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(1, s * (0.35 + 0.65 * flap));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-10, -13, 3, -12);
      ctx.quadraticCurveTo(9, -9, 4, -1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.quadraticCurveTo(12, -8, 13, -1);
      ctx.quadraticCurveTo(9, 3, 3, 1.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#5a5348";
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.4, 2.6, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#5a5348";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, -1);
    ctx.quadraticCurveTo(-11, -5, -13, -3);
    ctx.moveTo(-5, 1);
    ctx.quadraticCurveTo(-11, 5, -13, 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawBeaconThread(m) {
    if (!m.beacon || S.dieTimer > 0) return;
    const zap = m.beacon.kind === "zap";
    ctx.save();
    ctx.strokeStyle = zap ? "rgba(190,140,255,0.4)" : "rgba(255,196,110,0.4)";
    ctx.setLineDash([3, 9]);
    ctx.lineDashOffset = -S.time * 40;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.beacon.x, m.beacon.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of S.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = "rgba(" + p.col + ",1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(200,215,255,0.16)";
    ctx.lineWidth = 1;
    for (const st of S.streaks) {
      ctx.globalAlpha = clamp(st.life, 0, 0.5);
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - st.len, st.y + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    const p = 1 - clamp(S.dawnLeft / LEVELS[S.night].dawn, 0, 1);
    ctx.save();
    if (S.shake > 0) {
      ctx.translate(
        rand(-S.shake, S.shake) * 0.5,
        rand(-S.shake, S.shake) * 0.5,
      );
    }
    drawSky(p);
    drawGround();
    for (const br of S.brambles) drawBramble(br);
    for (const bd of S.buds) drawBud(bd);
    for (const l of S.lanterns) {
      drawLantern(l, S.mode === "playing" && S.lanterns[S.sel] === l);
    }
    for (const z of S.zappers) drawZapper(z);
    if (S.bat) drawBat(S.bat);
    if (S.moth) {
      drawBeaconThread(S.moth);
      drawMoth(S.moth);
    }
    drawParticles();
    ctx.restore();
    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.42,
      W / 2,
      H / 2,
      H * 0.95,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,10,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------------- input
  function canvasPoint(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * W,
      y: ((ev.clientY - r.top) / r.height) * H,
    };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (S.mode !== "playing") return;
    Sound.resume();
    const pt = canvasPoint(ev);
    let hit = null;
    let hitD = 1e9;
    for (const l of S.lanterns) {
      const d = dist(pt.x, pt.y, l.x, l.y - 10);
      if (d < 44 && d < hitD) {
        hit = l;
        hitD = d;
      }
    }
    if (hit) {
      S.sel = S.lanterns.indexOf(hit);
      toggleLantern(hit);
      return;
    }
    for (const z of S.zappers) {
      if (dist(pt.x, pt.y, z.x, z.y) < 40) {
        toast("The violet wire bites. Leave it be.", true);
        return;
      }
    }
    let near = null;
    let nd = 1e9;
    for (const l of S.lanterns) {
      const d = dist(pt.x, pt.y, l.x, l.y - 10);
      if (d < nd) {
        nd = d;
        near = l;
      }
    }
    if (near) S.sel = S.lanterns.indexOf(near);
  });

  function openHelp() {
    if (S.mode === "playing") {
      S.mode = "paused";
      S.introMode = "back";
      $("btn-begin").textContent = "Back to the garden";
      showPanel("intro");
    }
  }

  function beginFromIntro() {
    Sound.ensure();
    Sound.resume();
    if (S.introMode === "back") {
      S.introMode = "begin";
      $("btn-begin").textContent = "Begin Night 1";
      S.mode = "playing";
      hidePanels();
    } else {
      startRun();
    }
  }

  function togglePause() {
    if (S.mode === "playing") {
      S.mode = "paused";
      showPanel("paused");
    } else if (
      S.mode === "paused" &&
      panels.paused.classList.contains("hidden")
    ) {
      // the help panel is up instead; resume from it
      beginFromIntro();
    } else if (S.mode === "paused") {
      S.mode = "playing";
      hidePanels();
    }
  }

  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    syncHud();
  }

  window.addEventListener("keydown", (ev) => {
    const k = ev.key;
    if (k === "p" || k === "P") {
      togglePause();
      ev.preventDefault();
      return;
    }
    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if (k === "r" || k === "R") {
      if (["playing", "paused", "failed"].includes(S.mode)) {
        loadNight(S.night);
        toast("The night begins again.");
      }
      ev.preventDefault();
      return;
    }
    if (k === "h" || k === "H") {
      openHelp();
      return;
    }
    if (S.mode !== "playing") {
      if (
        (k === " " || k === "Enter") &&
        !panels.intro.classList.contains("hidden")
      ) {
        beginFromIntro();
        ev.preventDefault();
      }
      return;
    }
    Sound.resume();
    if (k === "ArrowLeft" || k === "a" || k === "A") {
      S.sel = (S.sel + S.lanterns.length - 1) % S.lanterns.length;
      ev.preventDefault();
    } else if (k === "ArrowRight" || k === "d" || k === "D") {
      S.sel = (S.sel + 1) % S.lanterns.length;
      ev.preventDefault();
    } else if (k === " " || k === "Enter") {
      toggleLantern(S.lanterns[S.sel]);
      ev.preventDefault();
    } else if (/^[1-9]$/.test(k)) {
      const i = Number(k) - 1;
      if (i < S.lanterns.length) {
        S.sel = i;
        toggleLantern(S.lanterns[i]);
      }
      ev.preventDefault();
    }
  });

  $("btn-begin").addEventListener("click", beginFromIntro);
  $("btn-resume").addEventListener("click", () => {
    if (S.mode === "paused") {
      S.mode = "playing";
      hidePanels();
    }
  });
  $("btn-pause").addEventListener("click", () => {
    if (S.mode === "playing" || S.mode === "paused") togglePause();
  });
  $("btn-restart").addEventListener("click", () => {
    if (["playing", "paused", "failed"].includes(S.mode)) {
      loadNight(S.night);
      toast("The night begins again.");
    }
  });
  $("btn-sound").addEventListener("click", toggleMute);
  $("btn-help").addEventListener("click", openHelp);
  $("btn-retry").addEventListener("click", () => loadNight(S.night));
  $("btn-next").addEventListener("click", () => loadNight(S.night + 1));
  $("btn-again").addEventListener("click", () => {
    S.introMode = "begin";
    $("btn-begin").textContent = "Begin Night 1";
    startRun();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && S.mode === "playing") {
      S.mode = "paused";
      showPanel("paused");
    }
  });

  // ------------------------------------------------------------------- boot
  try {
    Sound.muted = localStorage.getItem("wick-wing-muted") === "1";
  } catch (err) {
    /* private mode */
  }

  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  // lay out night 1 as a living backdrop behind the intro screen
  (function stageIntroScene() {
    buildEntities(LEVELS[0]);
    S.moth = makeMoth(NEST.x, NEST.y);
    S.dawnLeft = LEVELS[0].dawn;
  })();

  let last = performance.now();
  function frame(ts) {
    const dt = clamp((ts - last) / 1000, 0, 0.033);
    last = ts;
    if (!document.hidden && (S.mode === "playing" || S.mode === "intro")) {
      update(dt);
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Optional headless-test hook; inert unless opened with #selftest.
  if (window.location.hash === "#selftest") {
    window.__WICK_TEST__ = {
      mode: () => S.mode,
      night: () => S.night,
      budsLeft: () => S.buds.filter((b) => !b.done).length,
      matches: () => S.matches,
      mothsLeft: () => S.mothsLeft,
      moth: () => ({ x: S.moth.x, y: S.moth.y }),
      place: (x, y, vx, vy) => {
        S.moth.x = x;
        S.moth.y = y;
        S.moth.vx = vx;
        S.moth.vy = vy;
        S.dieTimer = 0;
      },
      toggle: (i) => toggleLantern(S.lanterns[i]),
      clearNight: () => nightCleared(),
      failDawn: () => nightFailed("dawn"),
      gotoNight: (i) => loadNight(clamp(i, 0, LEVELS.length - 1)),
      levels: () => LEVELS.length,
      pollen: () => S.pollenRun + S.pollenNight,
    };
  }
})();
