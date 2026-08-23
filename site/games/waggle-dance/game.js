/* Waggle Dance - a scout bee broadcasts flower vectors on the comb.
 * Classic script, wrapped in an IIFE; vanilla canvas + Web Audio, no network. */
(() => {
  "use strict";

  /* ---------- dom ---------- */

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const bannerEl = document.getElementById("banner");
  const overlayEl = document.getElementById("overlay");
  const ovTitle = document.getElementById("ov-title");
  const ovTag = document.getElementById("ov-tag");
  const ovBody = document.getElementById("ov-body");
  const btnStart = document.getElementById("btn-start");
  const btnSound = document.getElementById("btn-sound");
  const btnPause = document.getElementById("btn-pause");
  const btnRestart = document.getElementById("btn-restart");
  const dayEl = document.getElementById("day-n");
  const honeyEl = document.getElementById("honey-n");
  const quotaEl = document.getElementById("quota-n");
  const crewEl = document.getElementById("crew-n");
  const energyBar = document.getElementById("energy-bar");
  const energyTxt = document.getElementById("energy-txt");

  /* ---------- constants ---------- */

  const W = 960;
  const H = 600;
  const FLOOR = { x: 480, y: 442 };
  const QUOTA = 600;
  const START_HONEY = 80;
  const DAY_LEN = 80;
  const DAYS_TOTAL = 6;
  const HOLD_FULL = 2.3; // seconds of hold that advertise distance 1.0
  const DANCE_COST = 13;
  const ENERGY_REGEN = 1.6;
  const COOLDOWN = 1.0;
  const ROT_SPEED = 1.9;
  const DIST_PX = 252;

  const DAYS = [
    {
      ang: -0.36,
      dist: 0.34,
      rich: 1.0,
      wind: 0.5,
      hornet: false,
      note: "Fireweed, close rows - just left of the sunlight.",
    },
    {
      ang: 2.45,
      dist: 0.56,
      rich: 1.15,
      wind: 0.6,
      hornet: false,
      note: "A wide clover shelf, out past the second ring.",
    },
    {
      ang: -2.0,
      dist: 0.72,
      rich: 1.3,
      wind: 0.7,
      hornet: true,
      note: "Far linden bloom. Something with wings hunts there.",
    },
    {
      ang: 1.1,
      dist: 0.46,
      rich: 1.45,
      wind: 0.95,
      hornet: true,
      note: "Borage by the fence line. Gusts funnel down the field.",
    },
    {
      ang: -1.05,
      dist: 0.88,
      rich: 1.6,
      wind: 1.05,
      hornet: true,
      note: "The heather moor, almost at the horizon ring.",
    },
    {
      ang: 2.95,
      dist: 0.64,
      rich: 1.85,
      wind: 1.15,
      hornet: true,
      note: "Last goldenrod run before the cold comes.",
    },
  ];

  /* ---------- state ---------- */

  let state = "intro"; // intro | play | report | won | lost
  let paused = false;
  let day = 1;
  let honey = START_HONEY;
  let energy = 100;
  let dayT = 0;
  let crewToday = 0;

  let patches = []; // {ang,dist,rich,color,stale}
  let foragers = [];
  let followers = [];
  let floaters = [];
  let motes = [];
  let streaks = [];

  let dance = {
    active: false,
    t: 0,
    aim: 0,
    errSum: 0,
    errN: 0,
    cool: 0,
    trail: [],
  };
  let pointerAim = null;
  const keys = {};
  let lastVerdict = null; // {text, sub, t, good}

  let gust = { phase: "idle", t: 0, timer: 5, dir: 1, str: 0 };
  let hornet = { active: false, t: 0, scheduled: -1, fired: false };

  let stats = { dances: 0, accSum: 0, best: 0 };
  let wonAt = -1;
  let quotaFlashed = false;
  let now = 0;

  /* ---------- helpers ---------- */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  // angle measured clockwise from "up" (the sun)
  const dirX = (a) => Math.sin(a);
  const dirY = (a) => -Math.cos(a);
  function angDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function fmtAng(a) {
    let deg = Math.round((a * 180) / Math.PI);
    deg = ((deg % 360) + 360) % 360;
    return deg === 0 ? "sun" : deg + "\u00b0";
  }

  /* ---------- audio (all synthesised) ---------- */

  let actx = null;
  let master = null;
  let muted = false;
  let buzzOsc = null;
  let buzzGain = null;
  let buzzWob = null;

  function initAudio() {
    if (actx || muted === null) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.42;
      master.connect(actx.destination);
      buzzGain = actx.createGain();
      buzzGain.gain.value = 0;
      const lp = actx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      buzzOsc = actx.createOscillator();
      buzzOsc.type = "sawtooth";
      buzzOsc.frequency.value = 155;
      buzzWob = actx.createOscillator();
      buzzWob.frequency.value = 26;
      const wobGain = actx.createGain();
      wobGain.gain.value = 22;
      buzzWob.connect(wobGain);
      wobGain.connect(buzzOsc.frequency);
      buzzOsc.connect(lp);
      lp.connect(buzzGain);
      buzzGain.connect(master);
      buzzOsc.start();
      buzzWob.start();
    } catch (err) {
      actx = null;
    }
  }
  function wakeAudio() {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
  }
  function tone(freq, dur, type, vol, when, slideTo) {
    if (!actx || muted) return;
    const t0 = actx.currentTime + (when || 0);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  function noiseBurst(dur, vol) {
    if (!actx || muted) return;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(500, actx.currentTime);
    bp.frequency.linearRampToValueAtTime(1800, actx.currentTime + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start();
  }
  function sndChime(n) {
    const notes = [660, 784, 988, 1175, 1319, 1568];
    for (let i = 0; i < n; i++)
      tone(
        notes[Math.min(i, notes.length - 1)],
        0.22,
        "triangle",
        0.16,
        i * 0.09,
      );
  }
  function sndPlop() {
    tone(330, 0.12, "sine", 0.14, 0, 130);
  }
  function sndStamp(good) {
    if (good) {
      tone(520, 0.1, "square", 0.09);
      tone(780, 0.14, "square", 0.09, 0.07);
    } else {
      tone(190, 0.22, "square", 0.1, 0, 120);
    }
  }
  function sndFanfare(win) {
    const seq = win ? [392, 494, 587, 784, 988] : [330, 294, 262, 196];
    seq.forEach((f, i) => tone(f, 0.34, "triangle", 0.2, i * 0.17));
    if (!win) tone(98, 0.8, "sine", 0.18, seq.length * 0.17);
  }

  /* ---------- setup / reset ---------- */

  const PATCH_COLORS = ["#f2b234", "#e8875a", "#c77dff", "#8fc255", "#7ec8e3"];

  function configureDay() {
    const cfg = DAYS[clamp(day, 1, DAYS_TOTAL) - 1];

    patches = patches.map((p) => ({ ...p, stale: true }));
    patches.push({
      ang: cfg.ang,
      dist: cfg.dist,
      rich: cfg.rich,
      color: PATCH_COLORS[(day - 1) % PATCH_COLORS.length],
      stale: false,
      name: "today\u2019s bloom",
    });
    dayT = 0;
    crewToday = 0;
    hornet = {
      active: false,
      t: 0,
      scheduled: rnd(22, 58),
      fired: false,
      at: patches[patches.length - 1],
    };
    gust = { phase: "idle", t: 0, timer: rnd(5, 9), dir: 1, str: 0 };
    dance.active = false;
    dance.cool = 0;
    dance.trail.length = 0;
    lastVerdict = null;
    showBanner("Day " + day + " \u00b7 " + cfg.note, 4200);
  }

  function freshRun() {
    day = 1;
    honey = START_HONEY;
    energy = 100;
    patches = [];
    foragers = [];
    followers = [];
    floaters = [];
    streaks = [];
    stats = { dances: 0, accSum: 0, best: 0 };
    wonAt = -1;
    quotaFlashed = false;
    hideOverlay();
    state = "play";
    paused = false;
    syncHud();
    configureDay();
  }

  function syncHud() {
    dayEl.textContent = String(Math.min(day, DAYS_TOTAL));
    honeyEl.textContent = String(Math.floor(honey));
    quotaEl.textContent = String(QUOTA);
    crewEl.textContent = String(crewToday);
    const e = clamp(Math.round(energy), 0, 100);
    energyBar.style.width = e + "%";
    energyBar.className = e < 25 ? "low" : "";
    energyTxt.textContent = String(e);
  }

  /* ---------- overlays & banner ---------- */

  function showOverlay(title, tag, bodyHtml, btnLabel, cb) {
    ovTitle.textContent = title;
    ovTag.textContent = tag;
    ovBody.innerHTML = bodyHtml;
    btnStart.textContent = btnLabel;
    overlayEl.classList.remove("hidden");
    btnStart.onclick = () => {
      wakeAudio();
      cb();
    };
  }
  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }
  let bannerTimer = 0;
  function showBanner(text, ms) {
    bannerEl.textContent = text;
    bannerEl.classList.remove("hidden");
    bannerTimer = (ms || 2600) / 1000;
  }

  /* ---------- dance mechanics ---------- */

  function tryStartDance() {
    if (state !== "play" || paused || dance.active || dance.cool > 0) return;
    if (energy < DANCE_COST) {
      showBanner("Too tired to dance - eat honey (E) or rest a moment.", 1800);
      return;
    }
    energy -= DANCE_COST;
    dance.active = true;
    dance.t = 0;
    dance.errSum = 0;
    dance.errN = 0;
    dance.trail.length = 0;
    lastVerdict = null;
  }

  function releaseDance() {
    if (!dance.active) return;
    dance.active = false;
    dance.cool = COOLDOWN;
    const target = patches[patches.length - 1];

    const meanErr = dance.errN > 0 ? dance.errSum / dance.errN : Math.PI;
    const lenErr = Math.abs(dance.t / HOLD_FULL - target.dist);
    const acc = clamp(1 - (meanErr / 0.55) * 0.68 - lenErr * 1.5, 0, 1);
    let recruits = Math.floor(acc * acc * 5.4);
    if (acc >= 0.92) recruits += 1;
    const lost = acc < 0.45;
    stats.dances++;
    stats.accSum += acc;
    stats.best = Math.max(stats.best, acc);

    let vText;
    if (acc >= 0.92) vText = "PERFECT DANCE!";
    else if (acc >= 0.7) vText = "True dance";
    else if (acc >= 0.45) vText = "Wobbly dance";
    else vText = "Lost them\u2026";
    lastVerdict = {
      text: vText,
      sub:
        recruits > 0
          ? "+" + recruits + " forager" + (recruits > 1 ? "s" : "")
          : "nobody follows",
      t: 1.6,
      good: acc >= 0.7,
    };
    sndStamp(acc >= 0.7);

    for (let i = 0; i < recruits; i++) {
      setTimeoutSpawn(i, target, acc, lost);
    }
    followers = followers.filter((f) => f.until > now);
    for (let i = 0; i < 3 + recruits; i++) {
      followers.push({
        a: rnd(0, TAU),
        r: rnd(30, 56),
        sp: rnd(1.2, 2.6) * (Math.random() < 0.5 ? -1 : 1),
        until: now + rnd(1.4, 3.2),
        x: 0,
        y: 0,
      });
    }
    if (recruits > 0) sndChime(Math.min(recruits, 6));
    crewToday += recruits;
    syncHud();
  }

  // staggered spawn so the swarm streams out rather than pops in
  const pendingSpawns = [];
  function setTimeoutSpawn(delay, patch, acc, lost) {
    pendingSpawns.push({ at: now + 0.5 + delay * 0.28, patch, acc, lost });
  }
  function flushSpawns() {
    for (let i = pendingSpawns.length - 1; i >= 0; i--) {
      if (pendingSpawns[i].at <= now) {
        const s = pendingSpawns[i];
        spawnForager(s.patch, s.acc, s.lost);
        pendingSpawns.splice(i, 1);
      }
    }
  }

  function spawnForager(patch, acc, lost) {
    if (foragers.length > 64) return;
    const trip = (4.5 + patch.dist * 8) * (lost ? 1.7 : 1);
    foragers.push({
      patch,
      acc,
      lost,
      gone: lost && Math.random() < 0.3,
      phase: "out",
      t: 0,
      trip,
      x: FLOOR.x,
      y: FLOOR.y,
    });
  }

  function earn(f) {
    if (f.gone) return;
    const hornetMul =
      hornet.active && hornet.at && f.patch === hornet.at ? 0.45 : 1;
    const accF = 0.55 + 0.45 * f.acc;
    let load = 1.6 * f.patch.rich * accF * hornetMul;
    if (f.lost) load *= 0.25;
    honey += load;
    if (!quotaFlashed && honey >= QUOTA) {
      quotaFlashed = true;
      wonAt = day;
      showBanner("\u2726 Quota met - the hive will winter! \u2726", 2400);
      sndChime(6);
    }
    sndPlop();
    floaters.push({
      x: FLOOR.x + rnd(-60, 60),
      y: FLOOR.y - 60,
      vy: -26,
      t: 1.4,
      text: "+" + (Math.round(load * 10) / 10).toFixed(1),
      col: "#ffd76e",
    });
  }

  /* ---------- update ---------- */

  function update(dt) {
    now += dt;
    flushSpawns();

    if (state !== "play") {
      updateAmbient(dt);
      return;
    }
    dayT += dt;
    energy = clamp(energy + (dance.active ? 0 : ENERGY_REGEN) * dt, 0, 100);

    // sunset approach
    if (dayT > DAY_LEN - 8 && dayT - dt <= DAY_LEN - 8)
      showBanner("The light is going\u2026 sundown soon.", 3000);

    // ---- dance steering ----
    if (dance.cool > 0) dance.cool -= dt;
    if (dance.active) {
      dance.t += dt;
      let vel = 0;
      if (keys.ArrowLeft || keys.a || keys.A) vel -= ROT_SPEED;
      if (keys.ArrowRight || keys.d || keys.D) vel += ROT_SPEED;
      if (keys.ShiftLeft || keys.ShiftRight) vel *= 0.45;
      // pointer steers toward finger
      if (pointerAim !== null) {
        const d = angDiff(pointerAim, dance.aim);
        vel += clamp(d * 9, -ROT_SPEED * 1.6, ROT_SPEED * 1.6);
      }
      // gusts shove the dancer
      updateGust(dt);
      if (gust.phase === "push") vel += gust.dir * gust.str;
      dance.aim = (dance.aim + vel * dt + TAU) % TAU;
      const err = Math.abs(angDiff(dance.aim, patches[patches.length - 1].ang));
      dance.errSum += err * dt;
      dance.errN += dt;
      dance.trail.push({ x: dance.aim, y: dance.t });
      if (dance.trail.length > 40) dance.trail.shift();
      if (buzzGain && actx) {
        buzzGain.gain.setTargetAtTime(muted ? 0 : 0.16, actx.currentTime, 0.05);
        buzzOsc.frequency.setTargetAtTime(
          150 + Math.min(dance.t, 2.4) * 55,
          actx.currentTime,
          0.06,
        );
      }
      if (dance.t > HOLD_FULL + 0.6) releaseDance(); // auto-release at max
    } else if (buzzGain && actx) {
      buzzGain.gain.setTargetAtTime(muted ? 0 : 0.05, actx.currentTime, 0.2);
    }

    if (lastVerdict) {
      lastVerdict.t -= dt;
      if (lastVerdict.t <= 0) lastVerdict = null;
    }

    // ---- hornet ----
    if (hornet.fired && hornet.active) {
      hornet.t -= dt;
      if (hornet.t <= 0) {
        hornet.active = false;
        showBanner("The hunter has gone.", 1800);
      }
    } else if (
      !hornet.fired &&
      dayT >= hornet.scheduled &&
      DAYS[day - 1].hornet
    ) {
      hornet.fired = true;
      hornet.active = true;
      hornet.t = 14;
      showBanner("A hornet patrols today\u2019s bloom - yields fall!", 3400);
      noiseBurst(0.5, 0.12);
    }

    // ---- foragers ----
    for (const f of foragers) {
      f.t += dt;
      if (f.phase === "out") {
        if (f.t >= f.trip) {
          f.phase = "back";
          f.t = 0;
        }
      } else if (f.t >= 1.6) {
        f.t = 0;
        if (f.gone) {
          f.phase = "out";
        } else {
          earn(f);
          f.phase = "out";
          f.trip = (4.5 + f.patch.dist * 8) * (f.lost ? 1.7 : 1);
        }
      }
    }

    updateAmbient(dt);

    // ---- day end ----
    if (dayT >= DAY_LEN) endDay();
    if (quotaFlashed && !stateLockedWon()) {
      // grace so the banner reads, then win
      winTick(dt);
    }
    syncHudLight();
  }

  let winDelay = -1;
  function stateLockedWon() {
    return winDelay >= 0;
  }
  function winTick(dt) {
    if (winDelay < 0) winDelay = 2.1;
    else {
      winDelay -= dt;
      if (winDelay <= 0) showWin();
    }
  }

  function updateAmbient(dt) {
    for (const fl of floaters) {
      fl.y += fl.vy * dt;
      fl.t -= dt;
    }
    floaters = floaters.filter((f) => f.t > 0);
    for (const f of followers) f.until -= dt;
    followers = followers.filter((f) => f.until > 0);
    // dust motes in the sun shaft
    if (motes.length < 26 && Math.random() < 0.3)
      motes.push({ x: rnd(380, 580), y: -8, v: rnd(9, 26), s: rnd(1, 2.6) });
    for (const m of motes) m.y += m.v * dt;
    motes = motes.filter((m) => m.y < H + 10);
    for (const s of streaks) s.t -= dt;
    streaks = streaks.filter((s) => s.t > 0);
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) bannerEl.classList.add("hidden");
    }
  }

  function updateGust(dt) {
    const wind = DAYS[day - 1].wind;
    gust.timer -= dt * wind;
    if (gust.phase === "idle") {
      if (gust.timer <= 0) {
        gust.phase = "warn";
        gust.t = 0.38;
        gust.dir = Math.random() < 0.5 ? -1 : 1;
        gust.str = 0.9 + wind * 0.9;
        noiseBurst(0.35, 0.05);
      }
    } else if (gust.phase === "warn") {
      gust.t -= dt;
      if (gust.t <= 0) {
        gust.phase = "push";
        gust.t = 0.8;
        for (let i = 0; i < 7; i++)
          streaks.push({
            x: rnd(200, 760),
            y: rnd(120, 520),
            dx: gust.dir * rnd(300, 520),
            dy: rnd(-40, 40),
            t: 0.5,
          });
        noiseBurst(0.5, 0.09);
      }
    } else if (gust.phase === "push") {
      gust.t -= dt;
      if (gust.t <= 0) {
        gust.phase = "idle";
        gust.timer = rnd(5, 10) / wind;
      }
    }
  }

  function endDay() {
    dance.active = false;
    if (quotaFlashed) {
      showWin();
      return;
    }
    if (day >= DAYS_TOTAL) {
      showLose();
      return;
    }
    const avg = stats.dances ? stats.accSum / stats.dances : 0;
    state = "report";
    showOverlay(
      "Night falls on day " + day,
      "The comb glows quietly in the dark.",
      [
        "<p class='stat-line'>Honey stores: <b>" +
          Math.floor(honey) +
          "</b> of " +
          QUOTA +
          "</p>",
        "<p class='stat-line'>Foragers recruited today: <b>" +
          crewToday +
          "</b></p>",
        "<p class='stat-line'>Foragers in the colony: <b>" +
          foragers.length +
          "</b></p>",
        "<p class='stat-line'>Dance truth so far: <b>" +
          Math.round(avg * 100) +
          "%</b></p>",
        "<p class='stat-line'>Tomorrow: <i>" + DAYS[day].note + "</i></p>",
      ].join(""),
      "Dawn breaks \u2014 day " + (day + 1),
      () => {
        hideOverlay();
        day++;
        state = "play";
        configureDay();
        syncHud();
      },
    );
  }

  function showWin() {
    if (state === "won") return;
    state = "won";
    sndFanfare(true);
    const avg = stats.dances ? stats.accSum / stats.dances : 0;
    const grade =
      wonAt <= 3
        ? "Golden Comb"
        : wonAt === 4
          ? "Silver Sealing"
          : "Copper Capping";
    showOverlay(
      "The hive will winter",
      "Every cell sealed, thanks to your dancing.",
      [
        "<div class='big-verdict'><b>" +
          grade +
          "</b> \u2014 quota met on day " +
          wonAt +
          " of " +
          DAYS_TOTAL +
          "</div>",
        "<p class='stat-line'>Final stores: <b>" +
          Math.floor(honey) +
          "</b> honey</p>",
        "<p class='stat-line'>Dances performed: <b>" +
          stats.dances +
          "</b> \u00b7 mean truth <b>" +
          Math.round(avg * 100) +
          "%</b> \u00b7 best <b>" +
          Math.round(stats.best * 100) +
          "%</b></p>",
        "<p class='stat-line'>Colony flying: <b>" +
          foragers.length +
          "</b> foragers</p>",
      ].join(""),
      "Dance again",
      freshRun,
    );
  }

  function showLose() {
    state = "lost";
    sndFanfare(false);
    const avg = stats.dances ? stats.accSum / stats.dances : 0;
    showOverlay(
      "Winter came early",
      "The comb stands " +
        Math.max(0, QUOTA - Math.floor(honey)) +
        " honey short of what winter demands.",
      [
        "<div class='big-verdict bad-verdict'>Only <b>" +
          Math.floor(honey) +
          "</b> of " +
          QUOTA +
          " honey laid down</div>",
        "<p class='stat-line'>Dances: <b>" +
          stats.dances +
          "</b> \u00b7 mean truth <b>" +
          Math.round(avg * 100) +
          "%</b></p>",
        "<p class='stat-line'>Tip: steer <i>through</i> the gusts, release exactly on the patch's ring, and eat honey (<kbd>E</kbd>) to keep dancing.</p>",
      ].join(""),
      "Next summer",
      freshRun,
    );
  }

  function syncHudLight() {
    honeyEl.textContent = String(Math.floor(honey));
    crewEl.textContent = String(crewToday);
    const e = clamp(Math.round(energy), 0, 100);
    energyBar.style.width = e + "%";
    energyBar.className = e < 25 ? "low" : "";
    energyTxt.textContent = String(e);
  }

  /* ---------- drawing ---------- */

  let hexPattern = null;
  function makeHexPattern() {
    const pc = document.createElement("canvas");
    pc.width = 42;
    pc.height = 73;
    const p = pc.getContext("2d");
    p.strokeStyle = "rgba(255,214,130,0.07)";
    p.lineWidth = 2;
    const hex = (cx, cy, r) => {
      p.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      p.stroke();
    };
    hex(21, 18, 20);
    hex(0, 55, 20);
    hex(42, 55, 20);
    hex(21, 55, 20);
    hex(0, 18, 20);
    hex(42, 18, 20);
    hex(-21, 55, 20);
    hex(63, 55, 20);
    hexPattern = ctx.createPattern(pc, "repeat");
  }

  function drawBee(x, y, ang, size, wingPhase, wig) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2);
    const wa = 0.35 + 0.3 * Math.abs(Math.sin(wingPhase));
    ctx.fillStyle = "rgba(220,235,255," + wa.toFixed(2) + ")";
    ctx.beginPath();
    ctx.ellipse(
      -size * 0.55,
      -size * 0.15,
      size * 0.62,
      size * 0.3,
      -0.5,
      0,
      TAU,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      size * 0.55,
      -size * 0.15,
      size * 0.62,
      size * 0.3,
      0.5,
      0,
      TAU,
    );
    ctx.fill();
    ctx.fillStyle = "#e8b23a";
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.52, size * 0.95, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#241703";
    ctx.fillRect(-size * 0.42, -size * 0.15, size * 0.84, size * 0.2);
    ctx.fillRect(-size * 0.38, size * 0.28, size * 0.76, size * 0.18);
    ctx.beginPath();
    ctx.arc(0, -size * 0.72, size * 0.3, 0, TAU);
    ctx.fill();
    if (wig) {
      ctx.strokeStyle = "rgba(242,178,52,0.9)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, -size * 0.9);
      ctx.lineTo(-size * 0.55, -size * 1.35);
      ctx.moveTo(size * 0.2, -size * 0.9);
      ctx.lineTo(size * 0.55, -size * 1.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(nowSec) {
    ctx.clearRect(0, 0, W, H);

    // backdrop
    const bg = ctx.createRadialGradient(FLOOR.x, 180, 60, FLOOR.x, H / 2, 720);
    bg.addColorStop(0, "#4a3312");
    bg.addColorStop(0.55, "#2c1d09");
    bg.addColorStop(1, "#150d04");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (hexPattern) {
      ctx.fillStyle = hexPattern;
      ctx.fillRect(0, 0, W, H);
    }

    // sun shaft (up = toward the sun)
    const pulse = 0.16 + 0.05 * Math.sin(nowSec * 0.8);
    const shaft = ctx.createLinearGradient(0, 0, 0, H);
    shaft.addColorStop(0, "rgba(255,222,130," + pulse.toFixed(3) + ")");
    shaft.addColorStop(1, "rgba(255,222,130,0)");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 46, 0);
    ctx.lineTo(W / 2 + 46, 0);
    ctx.lineTo(W / 2 + 210, H);
    ctx.lineTo(W / 2 - 210, H);
    ctx.closePath();
    ctx.fillStyle = shaft;
    ctx.fill();
    ctx.restore();
    for (const m of motes) {
      ctx.fillStyle = "rgba(255,232,160,0.5)";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.s, 0, TAU);
      ctx.fill();
    }
    // sun glyph
    ctx.fillStyle = "#ffd76e";
    ctx.font = "15px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("\u2600 sun this way", W / 2, 22);

    // entrance hole
    ctx.fillStyle = "#0d0702";
    ctx.beginPath();
    ctx.ellipse(74, 84, 40, 26, -0.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(242,178,52,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(232,217,176,0.55)";
    ctx.font = "italic 12px Georgia, serif";
    ctx.fillText("to the fields", 74, 128);

    // compass rings around the dancer (distance = how far)
    ctx.save();
    ctx.strokeStyle = "rgba(232,217,176,0.14)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 9]);
    for (const r of [DIST_PX / 3, (DIST_PX * 2) / 3, DIST_PX]) {
      ctx.beginPath();
      ctx.arc(FLOOR.x, FLOOR.y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(232,217,176,0.4)";
    ctx.font = "11px Georgia, serif";
    ctx.fillText("near", FLOOR.x + DIST_PX / 3 - 24, FLOOR.y + 4);
    ctx.fillText("mid", FLOOR.x + (DIST_PX * 2) / 3 - 16, FLOOR.y + 4);
    ctx.fillText("far", FLOOR.x + DIST_PX - 14, FLOOR.y + 4);
    ctx.restore();

    // patches (stale ones greyed, today's vivid + pulsing)
    for (const p of patches) drawPatch(p, nowSec);

    // hornet at patch
    if (hornet.active && hornet.at) {
      const ha = nowSec * 2.4;
      const hx =
        FLOOR.x +
        dirX(hornet.at.ang + Math.sin(ha) * 0.12) * hornet.at.dist * DIST_PX;
      const hy =
        FLOOR.y +
        dirY(hornet.at.ang + Math.sin(ha) * 0.12) * hornet.at.dist * DIST_PX;
      ctx.fillStyle = "#d8543a";
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#241703";
      ctx.fillRect(hx - 4, hy - 1.5, 8, 3);
    }

    // memory line: where the flowers are (faint, always)
    const tgt = patches[patches.length - 1];
    if (tgt && state === "play") {
      ctx.save();
      ctx.strokeStyle = "rgba(232,217,176,0.35)";
      ctx.setLineDash([3, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(FLOOR.x, FLOOR.y);
      ctx.lineTo(
        FLOOR.x + dirX(tgt.ang) * tgt.dist * DIST_PX,
        FLOOR.y + dirY(tgt.ang) * tgt.dist * DIST_PX,
      );
      ctx.stroke();
      ctx.restore();
    }

    // aim ray + advertised-length bead while dancing
    if (dance.active) {
      const ax = FLOOR.x + dirX(dance.aim) * DIST_PX;
      const ay = FLOOR.y + dirY(dance.aim) * DIST_PX;
      ctx.strokeStyle = "rgba(242,178,52,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(FLOOR.x, FLOOR.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      // trail of the waggle so far
      ctx.lineWidth = 2;
      for (let i = 1; i < dance.trail.length; i++) {
        const q0 = dance.trail[i - 1];
        const q1 = dance.trail[i];
        ctx.strokeStyle =
          "rgba(255,215,110," + (i / dance.trail.length) * 0.5 + ")";
        ctx.beginPath();
        ctx.moveTo(
          FLOOR.x + dirX(q0.x) * q0.y * (DIST_PX / HOLD_FULL),
          FLOOR.y + dirY(q0.x) * q0.y * (DIST_PX / HOLD_FULL),
        );
        ctx.lineTo(
          FLOOR.x + dirX(q1.x) * q1.y * (DIST_PX / HOLD_FULL),
          FLOOR.y + dirY(q1.x) * q1.y * (DIST_PX / HOLD_FULL),
        );
        ctx.stroke();
      }
      const adv = Math.min(dance.t / HOLD_FULL, 1);
      const bx = FLOOR.x + dirX(dance.aim) * adv * DIST_PX;
      const by = FLOOR.y + dirY(dance.aim) * adv * DIST_PX;
      ctx.fillStyle = "#fff3c4";
      ctx.shadowColor = "#ffd76e";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // foragers in flight
    for (const f of foragers) {
      const px = FLOOR.x + dirX(f.patch.ang) * f.patch.dist * DIST_PX;
      const py = FLOOR.y + dirY(f.patch.ang) * f.patch.dist * DIST_PX;
      let tt;
      if (f.phase === "out") tt = f.t / f.trip;
      else tt = 1 - f.t / 1.6;
      const fx = lerp(FLOOR.x, px, clamp(tt, 0, 1));
      const fy = lerp(FLOOR.y, py, clamp(tt, 0, 1));
      const ang = Math.atan2(py - FLOOR.y, px - FLOOR.x);
      ctx.globalAlpha = f.gone ? 0.35 : 0.9;
      drawBee(fx, fy, ang, 5.5, nowSec * 30 + fx);
      ctx.globalAlpha = 1;
    }

    // follower bees orbiting the dancer
    for (const fo of followers) {
      fo.a += fo.sp * 0.016;
      const fx = FLOOR.x + Math.cos(fo.a) * fo.r;
      const fy = FLOOR.y + Math.sin(fo.a) * fo.r * 0.6;
      drawBee(fx, fy, fo.a + Math.PI / 2, 6, nowSec * 34 + fo.r);
    }

    // the scout herself
    const wiggle = dance.active ? Math.sin(nowSec * 42) * 4 : 0;
    const wx = FLOOR.x + dirX(dance.aim + Math.PI / 2) * wiggle;
    const wy = FLOOR.y + dirY(dance.aim + Math.PI / 2) * wiggle;
    drawBee(wx, wy, dance.aim, 15, nowSec * 30, dance.active);

    // dance floor rim
    ctx.strokeStyle = "rgba(242,178,52,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(FLOOR.x, FLOOR.y, 74, 46, 0, 0, TAU);
    ctx.stroke();

    // gust streaks
    for (const s of streaks) {
      ctx.strokeStyle = "rgba(200,220,255," + s.t * 0.5 + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.dx * 0.12, s.y + s.dy * 0.12);
      ctx.stroke();
    }
    if (gust.phase === "warn") {
      ctx.fillStyle = "rgba(200,220,255,0.75)";
      ctx.font = "bold 13px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("\u2934 gust coming \u2935", W / 2, 46);
    }

    // honey cells along the bottom
    const cells = 20;
    const per = QUOTA / cells;
    const cw = 34;
    const startX = W / 2 - (cells * (cw + 4)) / 2;
    for (let i = 0; i < cells; i++) {
      const fill = clamp(honey / per - i, 0, 1);
      const cx = startX + i * (cw + 4) + cw / 2;
      const cy = H - 26;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const vx = (cw / 2) * Math.cos(a);
        const vy = (cw / 2) * Math.sin(a);
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = "#170f04";
      ctx.fill();
      if (fill > 0) {
        ctx.beginPath();
        ctx.rect(-cw / 2, cw / 2 - fill * cw, cw, fill * cw);
        ctx.clip();
        ctx.fillStyle = "#f2b234";
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(242,178,52,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(232,217,176,0.5)";
    ctx.font = "11px Georgia, serif";
    ctx.fillText(
      "winter stores " + Math.floor(honey) + " / " + QUOTA,
      W / 2,
      H - 4,
    );

    // verdict stamp
    if (lastVerdict) {
      const a = clamp(lastVerdict.t / 0.5, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = lastVerdict.good ? "#ffe9a8" : "#f0a08a";
      ctx.font = "bold 34px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(lastVerdict.text, FLOOR.x, FLOOR.y - 96);
      ctx.font = "italic 17px Georgia, serif";
      ctx.fillText(lastVerdict.sub, FLOOR.x, FLOOR.y - 70);
      ctx.globalAlpha = 1;
    }

    // day clock arc, top right
    ctx.save();
    ctx.translate(896, 60);
    ctx.strokeStyle = "rgba(232,217,176,0.25)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + TAU * 0.999, false);
    ctx.stroke();
    ctx.strokeStyle = "#ffd76e";
    ctx.beginPath();
    ctx.arc(
      0,
      0,
      24,
      -Math.PI / 2,
      -Math.PI / 2 + TAU * clamp(dayT / DAY_LEN, 0, 1),
    );
    ctx.stroke();
    ctx.fillStyle = "rgba(232,217,176,0.7)";
    ctx.font = "12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("day " + day, 0, 5);
    ctx.restore();

    // dusk tint
    if (state === "play" && dayT > DAY_LEN - 8) {
      const k = (dayT - (DAY_LEN - 8)) / 8;
      ctx.fillStyle = "rgba(10,6,20," + (k * 0.45).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    if (paused) {
      ctx.fillStyle = "rgba(10,6,2,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffe9a8";
      ctx.font = "bold 30px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2 - 8);
      ctx.font = "italic 15px Georgia, serif";
      ctx.fillText("press P to keep dancing", W / 2, H / 2 + 22);
    }
  }

  function drawPatch(p, nowSec) {
    const px = FLOOR.x + dirX(p.ang) * p.dist * DIST_PX;
    const py = FLOOR.y + dirY(p.ang) * p.dist * DIST_PX;
    const pulse = p.stale ? 0 : 1 + 0.12 * Math.sin(nowSec * 3.4);
    ctx.save();
    ctx.globalAlpha = p.stale ? 0.28 : 1;
    ctx.fillStyle = p.stale ? "#8b7a55" : p.color;
    for (let i = 0; i < 5; i++) {
      const a = (TAU / 5) * i + nowSec * 0.25;
      ctx.beginPath();
      ctx.ellipse(
        px + Math.cos(a) * 8 * pulse,
        py + Math.sin(a) * 8 * pulse,
        5.5 * pulse,
        5.5 * pulse,
        a,
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.fillStyle = p.stale ? "#6b5c3d" : "#7a4d05";
    ctx.beginPath();
    ctx.arc(px, py, 4.5 * pulse, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- input ---------- */

  function logicalPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    wakeAudio();
    if (state !== "play" || paused) return;
    const p = logicalPos(e);
    updatePointerAim(p);
    pointerAim = dance.aim; // first touch doesn't yank the aim
    tryStartDance();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* synthetic or already-released pointer - steering still works */
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (pointerAim === null) return;
    updatePointerAim(logicalPos(e));
  });
  const endPointer = () => {
    if (pointerAim === null) return;
    pointerAim = null;
    if (dance.active) releaseDance();
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function updatePointerAim(p) {
    const dx = p.x - FLOOR.x;
    const dy = p.y - FLOOR.y;
    if (dx * dx + dy * dy < 144) return;
    pointerAim = (Math.atan2(dx, -dy) + TAU) % TAU;
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (
      k === " " ||
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown"
    )
      e.preventDefault();
    if (e.repeat) {
      keys[k] = true;
      return;
    }
    wakeAudio();
    keys[k] = true;
    if (k === "m" || k === "M") toggleMute();
    else if (k === "p" || k === "P") togglePause();
    else if (k === "r" || k === "R") {
      if (state !== "intro") freshRun();
    } else if (k === "e" || k === "E") eatHoney();
    else if (k === " ") {
      if (overlayEl.classList.contains("hidden")) tryStartDance();
      else btnStart.click();
    } else if (k === "Enter" && !overlayEl.classList.contains("hidden"))
      btnStart.click();
  });
  window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
    if (e.key === " " && dance.active && pointerAim === null) releaseDance();
  });

  function eatHoney() {
    if (state !== "play" || paused) return;
    if (honey >= 60 && energy < 97) {
      honey -= 60;
      energy = clamp(energy + 45, 0, 100);
      sndPlop();
      floaters.push({
        x: FLOOR.x,
        y: FLOOR.y - 50,
        vy: -30,
        t: 1.2,
        text: "+45 energy",
        col: "#9fe08a",
      });
      syncHud();
    } else if (honey < 6) {
      showBanner("Not enough honey to spare (need 60).", 1500);
    }
  }

  function togglePause() {
    if (state !== "play") return;
    paused = !paused;
    btnPause.classList.toggle("off", paused);
    if (buzzGain && actx)
      buzzGain.gain.setTargetAtTime(0, actx.currentTime, 0.05);
  }

  function toggleMute() {
    muted = !muted;
    btnSound.classList.toggle("off", muted);
    btnSound.innerHTML = muted ? "&#215;" : "&#9834;";
    if (master && actx) master.gain.value = muted ? 0 : 0.42;
  }

  btnSound.addEventListener("click", () => {
    wakeAudio();
    toggleMute();
  });
  btnPause.addEventListener("click", togglePause);
  btnRestart.addEventListener("click", () => {
    if (state !== "intro") freshRun();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "play" && !paused) togglePause();
  });

  window.addEventListener("resize", fit);

  /* ---------- boot ---------- */

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || W;
    const s = (cw / W) * dpr;
    canvas.width = Math.round(W * s);
    canvas.height = Math.round(H * s);
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  btnStart.onclick = () => {
    wakeAudio();
    freshRun();
  };

  makeHexPattern();
  fit();
  syncHud();
  quotaEl.textContent = String(QUOTA);

  let last = performance.now();
  function frame(ts) {
    const dt = clamp((ts - last) / 1000, 0, 0.05);
    last = ts;
    if (!paused) update(dt);
    draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
