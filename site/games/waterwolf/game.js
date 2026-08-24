/* Waterwolf - hold a North Sea polder dry through a three-night gale.
   Toggle sluice gates to shepherd storm rain down through three stepped
   canals; the sea only takes water back while the tide ebbs. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  constants                                                          *
   * ------------------------------------------------------------------ */

  const W = 960;
  const H = 600;
  const NIGHT_LEN = 45;
  const NIGHTS = 3;
  const RUN_LEN = NIGHT_LEN * NIGHTS;
  const CAP = 118; // canal depth in px
  const CREST_Y = 238; // dike crest
  const MEAN_SEA = 330;
  const TIDE_PERIOD = 48;
  const TIDE_OFF = 22; // puts the first low tide ~14 s in
  let MILL_RATE = 0.008;
  const DT = 1 / 60;

  const BASINS = [
    { name: "HIGH CANAL", x: 48, brim: 182, floor: 300 },
    { name: "MID CANAL", x: 258, brim: 206, floor: 324 },
    { name: "LOW CANAL", x: 470, brim: 230, floor: 348 },
  ];
  BASINS.forEach((b) => {
    b.w = 160;
    b.cx = b.x + b.w / 2;
  });
  const AREA = [0.9, 1.0, 1.15]; // surface area factor per canal

  let GATE_K = [0.08, 0.08, 0.1];
  let Q_MAX = 0.05;
  const GATES = [
    { a: 0, b: 1, x: 206, y: 252, w: 52, h: 38 },
    { a: 1, b: 2, x: 414, y: 276, w: 52, h: 38 },
    { a: 2, b: -1, x: 628, y: 374, w: 176, h: 38 },
  ];

  let BASE_RAIN = [0.0065, 0.008, 0.0098];

  const SKY_TOP = ["#0c1230", "#111026", "#0c1522"];
  const SKY_HOR = ["#26335f", "#343054", "#2b4a4a"];
  const DAWN_TOP = "#54415c";
  const DAWN_HOR = "#ef9a5f";

  /* ------------------------------------------------------------------ *
   *  dom                                                                *
   * ------------------------------------------------------------------ */

  const cvs = document.getElementById("game");
  const ctx = cvs.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = W * dpr;
  cvs.height = H * dpr;
  ctx.scale(dpr, dpr);

  if (!ctx.roundRect) {
    ctx.roundRect = function (x, y, w, h) {
      this.rect(x, y, w, h);
    };
  }

  const el = {
    night: document.getElementById("chipNight"),
    seals: document.getElementById("chipSeals"),
    score: document.getElementById("chipScore"),
    ticker: document.getElementById("ticker"),
    overlay: document.getElementById("overlay"),
    ovTitle: document.getElementById("ovTitle"),
    ovBody: document.getElementById("ovBody"),
    ovBtn: document.getElementById("ovBtn"),
    mute: document.getElementById("btnMute"),
    pause: document.getElementById("btnPause"),
  };
  const gateBtns = Array.prototype.slice.call(
    document.querySelectorAll("[data-gate]"),
  );

  /* ------------------------------------------------------------------ *
   *  audio                                                              *
   * ------------------------------------------------------------------ */

  const AU = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: false,
    rainGain: null,
    surfGain: null,
  };

  function ensureAudio() {
    if (AU.ctx) {
      if (AU.ctx.state === "suspended") AU.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    AU.ctx = ac;
    AU.master = ac.createGain();
    AU.master.gain.value = AU.muted ? 0 : 0.9;
    AU.master.connect(ac.destination);

    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    AU.noiseBuf = buf;

    const rSrc = ac.createBufferSource();
    rSrc.buffer = buf;
    rSrc.loop = true;
    const rFil = ac.createBiquadFilter();
    rFil.type = "bandpass";
    rFil.frequency.value = 850;
    rFil.Q.value = 0.5;
    AU.rainGain = ac.createGain();
    AU.rainGain.gain.value = 0;
    rSrc.connect(rFil);
    rFil.connect(AU.rainGain);
    AU.rainGain.connect(AU.master);
    rSrc.start();

    const sSrc = ac.createBufferSource();
    sSrc.buffer = buf;
    sSrc.loop = true;
    const sFil = ac.createBiquadFilter();
    sFil.type = "lowpass";
    sFil.frequency.value = 260;
    AU.surfGain = ac.createGain();
    AU.surfGain.gain.value = 0;
    sSrc.connect(sFil);
    sFil.connect(AU.surfGain);
    AU.surfGain.connect(AU.master);
    sSrc.start();
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (!AU.ctx || AU.muted) return;
    const ac = AU.ctx;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo) {
      o.frequency.exponentialRampToValueAtTime(
        Math.max(slideTo, 1),
        ac.currentTime + dur,
      );
    }
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g);
    g.connect(AU.master);
    o.start();
    o.stop(ac.currentTime + dur + 0.02);
  }

  function whoosh(dur, freq, gain) {
    if (!AU.ctx || AU.muted) return;
    const ac = AU.ctx;
    const src = ac.createBufferSource();
    src.buffer = AU.noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(f);
    f.connect(g);
    g.connect(AU.master);
    src.start();
    src.stop(ac.currentTime + dur + 0.05);
  }

  const SFX = {
    clank() {
      tone(170, 0.1, "square", 0.09, 88);
      whoosh(0.06, 3200, 0.04);
    },
    creak() {
      tone(72, 0.55, "sawtooth", 0.045, 50);
    },
    breach() {
      whoosh(0.8, 420, 0.38);
      tone(110, 0.7, "sine", 0.26, 38);
      setTimeout(() => whoosh(1.7, 160, 0.2), 140);
    },
    thunder() {
      whoosh(1.9, 130, 0.22);
    },
    chime() {
      [523, 659, 784].forEach((f, i) =>
        setTimeout(() => tone(f, 0.5, "triangle", 0.06), i * 130),
      );
    },
    dirge() {
      [392, 311, 233].forEach((f, i) =>
        setTimeout(() => tone(f, 0.8, "sawtooth", 0.05), i * 260),
      );
    },
  };

  /* ------------------------------------------------------------------ *
   *  state                                                              *
   * ------------------------------------------------------------------ */

  let st;

  function freshState() {
    return {
      phase: "title", // title | playing | paused | over | won
      t: 0,
      score: 0,
      seals: 3,
      breaches: 0,
      takenBack: 0,
      seaY: MEAN_SEA,
      basins: [
        { lvl: 0.34, warned: -99 },
        { lvl: 0.28, warned: -99 },
        { lvl: 0.22, warned: -99 },
      ],
      gates: [
        { p: 0, target: false },
        { p: 0, target: false },
        { p: 0, target: false },
      ],
      squalls: [
        { on: false, until: 0, next: 9 + Math.random() * 6 },
        { on: false, until: 0, next: 14 + Math.random() * 6 },
        { on: false, until: 0, next: 19 + Math.random() * 6 },
      ],
      lullUntil: 0,
      surgeWarned: false,
      floodTurnTaught: false,
      overtopTaught: false,
      particles: [],
      raindrops: [],
      shake: 0,
      flash: 0,
      bolt: null,
      banners: [],
      millA: 0,
      wind: 0.5,
      clouds: [
        { x: 130, y: 62, s: 1.2, v: 7 },
        { x: 430, y: 44, s: 0.9, v: 10 },
        { x: 700, y: 70, s: 1.4, v: 6 },
        { x: 880, y: 40, s: 0.8, v: 12 },
        { x: 290, y: 92, s: 0.7, v: 9 },
      ],
      ripple: 0,
    };
  }
  st = freshState();

  /* deterministic star field */
  const STARS = [];
  for (let i = 0; i < 64; i++) {
    const a = (i * i * 7919) % 1000;
    STARS.push({
      x: (a % 940) + 8,
      y: ((a * 13) % 200) + 8,
      r: 0.5 + ((i * 37) % 10) / 9,
      tw: (i % 9) * 0.7,
    });
  }

  /* ------------------------------------------------------------------ *
   *  helpers                                                            *
   * ------------------------------------------------------------------ */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function mixHex(a, b, u) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, u));
    const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, u));
    const bl = Math.round(lerp(pa & 255, pb & 255, u));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }

  function tideSurfY(time) {
    const u = clamp(time / RUN_LEN, 0, 1);
    const amp = 62 + 30 * Math.pow(u, 1.2);
    let y =
      MEAN_SEA -
      amp * Math.sin(((time + TIDE_OFF) / TIDE_PERIOD) * Math.PI * 2);
    if (time >= NIGHT_LEN * 2) {
      const lt = time - NIGHT_LEN * 2;
      y -= 32 * Math.exp(-((lt - 30) * (lt - 30)) / 162);
    }
    return y;
  }

  function surfY(i) {
    return BASINS[i].floor - st.basins[i].lvl * CAP;
  }

  function banner(main, sub, ttl) {
    st.banners.push({ main, sub: sub || "", ttl: ttl || 2.6, t: 0 });
  }

  let tickerQ = [];
  let tickerBusyUntil = 0;
  const tickerCd = {};
  function say(text, key, cd) {
    const now = performance.now();
    if (key) {
      if (tickerCd[key] && now < tickerCd[key]) return;
      tickerCd[key] = now + (cd || 12000);
    }
    tickerQ.push(text);
  }
  function pumpTicker() {
    const now = performance.now();
    if (tickerBusyUntil > now || !tickerQ.length) return;
    el.ticker.textContent = tickerQ.shift();
    el.ticker.classList.add("show");
    tickerBusyUntil = now + 2700;
    setTimeout(() => {
      if (!tickerQ.length) el.ticker.classList.remove("show");
    }, 2350);
  }

  function spawn(n, fn) {
    for (let i = 0; i < n; i++) {
      if (st.particles.length > 260) return;
      st.particles.push(fn());
    }
  }

  function splashAt(x, y, n, col, spd) {
    spawn(n, () => ({
      x: x + rand(-8, 8),
      y: y + rand(-3, 3),
      vx: rand(-spd, spd),
      vy: rand(-spd * 1.6, -spd * 0.3),
      life: rand(0.35, 0.8),
      t: 0,
      r: rand(1, 2.6),
      col: col || "#bfe3ff",
      grav: 340,
    }));
  }

  /* ------------------------------------------------------------------ *
   *  game actions                                                       *
   * ------------------------------------------------------------------ */

  function toggleGate(i, silent) {
    if (st.phase !== "playing") return;
    const g = GATES[i];
    const gs = st.gates[i];
    gs.target = !gs.target;
    if (!silent) {
      SFX.clank();
      splashAt(g.x + g.w / 2, g.y + g.h / 2, 4, "#cfd8ff", 60);
    }
    refreshGateButtons();
  }

  function refreshGateButtons() {
    gateBtns.forEach((b) => {
      const i = +b.getAttribute("data-gate");
      b.classList.toggle("open", !!st.gates[i].target);
    });
  }

  function refreshHud() {
    let s = "";
    for (let i = 0; i < 3; i++) s += i < st.seals ? "\u25C6" : "\u25C7";
    el.seals.textContent = s;
    el.seals.classList.toggle("hurt", st.seals < 3);
    el.night.textContent =
      "NIGHT " + (Math.min(Math.floor(st.t / NIGHT_LEN), 2) + 1) + "/" + NIGHTS;
    el.score.textContent = String(Math.floor(st.score));
  }

  function startGame() {
    ensureAudio();
    st = freshState();
    st.phase = "playing";
    hideOverlay();
    refreshGateButtons();
    refreshHud();
    el.pause.textContent = "II";
    banner("NIGHT 1 OF 3", "hold the water out", 3);
    say("The gale makes landfall. Rain finds the HIGH CANAL first.");
    setTimeout(() => {
      if (st.phase === "playing") say("Tap a gate, or press 1 - 2 - 3.");
    }, 5600);
  }

  function pauseGame() {
    if (st.phase !== "playing") return;
    st.phase = "paused";
    showOverlay(
      "PAUSED",
      "<p>The wind waits. The sea does not, but it will humour you.</p>",
      "Resume",
      resumeGame,
    );
    el.pause.textContent = "\u25B6";
  }

  function resumeGame() {
    if (st.phase !== "paused") return;
    st.phase = "playing";
    hideOverlay();
    el.pause.textContent = "II";
  }

  function togglePause() {
    if (st.phase === "playing") pauseGame();
    else if (st.phase === "paused") resumeGame();
  }

  function gameOver() {
    st.phase = "over";
    SFX.dirge();
    showOverlay(
      "THE POLDER DROWNS",
      "<p>The third seal breaks, and the sea walks in.</p>" +
        "<p>You held for <b>" +
        Math.floor(st.t) +
        " s</b> of the three-night gale &middot; score <b>" +
        Math.floor(st.score) +
        "</b>.</p>",
      "Man the sluices again",
      startGame,
    );
  }

  function winGame() {
    st.phase = "won";
    st.score += st.seals * 250;
    SFX.chime();
    showOverlay(
      "DAWN ON THE DIKE",
      "<p>Three nights weathered. The wolf pads back out to sea.</p>" +
        "<p>Score <b>" +
        Math.floor(st.score) +
        "</b> &middot; seals kept <b>" +
        st.seals +
        "/3</b> &middot; breaches <b>" +
        st.breaches +
        "</b><br>The sea took back <b>" +
        Math.floor(st.takenBack) +
        "</b> tuns of storm water.</p>",
      "Hold them once more",
      startGame,
    );
  }

  /* ------------------------------------------------------------------ *
   *  overlay                                                            *
   * ------------------------------------------------------------------ */

  function showOverlay(title, bodyHTML, btnText, onClick) {
    el.ovTitle.textContent = title;
    el.ovBody.innerHTML = bodyHTML;
    el.ovBtn.textContent = btnText;
    el.ovBtn.onclick = () => {
      ensureAudio();
      onClick();
    };
    el.overlay.hidden = false;
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  showOverlay(
    "Waterwolf",
    "<p>Three nights of storm. One pair of hands. Rain fills the terraced canals, and the sea will only take water back while the tide ebbs.</p>" +
      "<ul><li><b>Tap a gate</b> (or press <b>1 2 3</b>) to raise or drop its plank.</li>" +
      "<li><b>Gate III</b> is the sea sluice - open it on an ebb, shut it before the flood turns, or the sea pours <i>in</i>.</li>" +
      "<li>Gates pour both ways: water seeks its level.</li>" +
      "<li>The <b>tide table</b>, top left, shows what the sea does next.</li>" +
      "<li>A canal that tops its brim breaches a seal <b>&#9670;</b>. Lose all three and the polder drowns.</li></ul>",
    "Man the sluices",
    startGame,
  );

  /* ------------------------------------------------------------------ *
   *  update                                                             *
   * ------------------------------------------------------------------ */

  let lastQ3 = 0;

  function update(dt) {
    st.ripple += dt;
    st.clouds.forEach((c) => {
      c.x += c.v * (0.4 + st.wind) * dt;
      if (c.x > W + 130) c.x = -130;
    });

    if (st.phase !== "playing") return;

    const prevT = st.t;
    st.t += dt;
    const t = st.t;

    /* night transitions -------------------------------------------- */
    if (
      Math.floor(prevT / NIGHT_LEN) < Math.floor(t / NIGHT_LEN) &&
      t < RUN_LEN
    ) {
      const night = Math.floor(t / NIGHT_LEN);
      st.score += 400;
      banner("NIGHT " + (night + 1) + " OF 3", "the gale returns", 3);
      SFX.chime();
      st.lullUntil = t + 2.2;
      st.squalls.forEach((s) => {
        s.on = false;
        s.next = t + rand(6, 12);
      });
      say("+400 - night survived. It lulls... then it comes again.");
    }
    const night = Math.min(Math.floor(t / NIGHT_LEN), 2);

    /* wind, squalls, rain ------------------------------------------ */
    st.wind = 0.45 + 0.25 * Math.sin(t * 0.21) + 0.3 * Math.sin(t * 0.53 + 2);
    const lull = t < st.lullUntil ? 0.15 : 1;
    const baseRain = BASE_RAIN[night] * lull;

    st.squalls.forEach((sq, i) => {
      if (sq.on) {
        if (t > sq.until) sq.on = false;
      } else if (t > sq.next && t > st.lullUntil) {
        sq.on = true;
        sq.until = t + rand(5, 9);
        sq.next = sq.until + rand(6, 12);
        say("Squall! Rain hammers the " + BASINS[i].name + ".", "sq" + i, 9000);
      }
    });

    /* tide ----------------------------------------------------------- */
    st.seaY = tideSurfY(t);
    const lt3 = t - NIGHT_LEN * 2;
    if (night === 2 && !st.surgeWarned && lt3 > 20 && lt3 < 30) {
      st.surgeWarned = true;
      banner("STORM SURGE", "watch the table - the sea swells", 2.4);
      say(
        "Storm surge pushing up the coast - mind the ebb windows!",
        "surge",
        99999,
      );
    }

    /* gate animation ------------------------------------------------- */
    st.gates.forEach((g) => {
      const tgt = g.target ? 1 : 0;
      const before = g.p;
      g.p += clamp(tgt - g.p, -dt * 2.4, dt * 2.4);
      if (before !== g.p && (g.p === 0 || g.p === 1)) SFX.clank();
    });

    /* rain ------------------------------------------------------------ */
    let rainTotal = 0;
    st.basins.forEach((bs, i) => {
      let r = baseRain;
      if (st.squalls[i].on) r += baseRain * 2.8 + 0.002;
      rainTotal += r;
      bs.lvl += r * dt;
    });

    /* the mill bails a trickle ----------------------------------------- */
    const lowBs = st.basins[2];
    if (lowBs.lvl > 0.03) {
      lowBs.lvl -= MILL_RATE * dt;
      if (Math.random() < dt * 6)
        splashAt(rand(796, 826), 212, 1, "#bfe3ff", 50);
    }

    /* gates --------------------------------------------------------------- */
    lastQ3 = 0;
    GATES.forEach((g, i) => {
      const p = st.gates[i].p;
      if (p < 0.05) return;
      const ya = g.b === -1 ? st.seaY : surfY(g.b);
      const yb = surfY(g.a);
      const headFrac = (ya - yb) / CAP; // >0: a drains outward/downhill
      let q =
        GATE_K[i] * Math.sign(headFrac) * Math.sqrt(Math.abs(headFrac)) * p;
      q = clamp(q, -Q_MAX, Q_MAX);
      st.basins[g.a].lvl -= (q * dt) / AREA[g.a];
      if (g.b >= 0) {
        st.basins[g.b].lvl += (q * dt) / AREA[g.b];
      } else {
        lastQ3 = q;
        if (q > 0) st.takenBack += q * dt * 95;
        if (q > 0.01 && Math.random() < dt * 22) {
          splashAt(g.x + g.w - 4, st.seaY + rand(0, 6), 1, "#cfeaff", 55);
        }
        if (q < -0.004 && !st.floodTurnTaught) {
          st.floodTurnTaught = true;
          say("The flood turns - the sea pushes IN. Drop gate III!");
        }
      }
      if (Math.abs(q) > 0.008 && Math.random() < dt * 10) {
        splashAt(
          g.x + g.w / 2 + rand(-g.w / 3, g.w / 3),
          g.y + g.h / 2,
          1,
          "#a9c8e8",
          40,
        );
      }
    });
    /* water cannot run a canal dry */
    st.basins.forEach((bs) => {
      bs.lvl = clamp(bs.lvl, 0, 1.04);
    });

    /* overtopping ----------------------------------------------------- */
    if (st.seaY < CREST_Y - 1) {
      const depth = clamp((CREST_Y - st.seaY) / 20, 0, 1);
      lowBs.lvl += 0.07 * depth * dt;
      if (Math.random() < dt * 40)
        splashAt(rand(690, 782), CREST_Y, 1, "#dff2ff", 70);
      if (!st.overtopTaught) {
        st.overtopTaught = true;
        banner(
          "THE SEA COMES OVER!",
          "you were warned - keep the LOW empty",
          2.6,
        );
        SFX.thunder();
      }
    }

    /* breaches -------------------------------------------------------- */
    for (let i = 0; i < 3; i++) {
      const bs = st.basins[i];
      if (bs.lvl >= 1) {
        bs.lvl = 0.55;
        st.seals--;
        st.breaches++;
        st.score = Math.max(0, st.score - 300);
        st.shake = 14;
        st.flash = Math.max(st.flash, 0.35);
        SFX.breach();
        splashAt(BASINS[i].cx, BASINS[i].brim + 20, 40, "#cfeaff", 180);
        banner("BREACH!", BASINS[i].name + " tops its dike  (-300)", 2.6);
        refreshHud();
        if (st.seals <= 0) {
          gameOver();
          return;
        }
        say("A seal breaks! " + st.seals + " remain.", "breach", 99999);
      } else if (bs.lvl > 0.85 && st.t - bs.warned > 10) {
        bs.warned = st.t;
        SFX.creak();
        say(BASINS[i].name + " nears its brim!", "warn" + i, 9000);
      }
    }

    /* scoring & win ---------------------------------------------------- */
    st.score += dt * 10;
    if (t >= RUN_LEN) {
      winGame();
      return;
    }

    /* ambience ----------------------------------------------------------*/
    st.shake *= Math.pow(0.001, dt);
    st.flash = Math.max(0, st.flash - dt * 1.4);
    if (
      night >= 1 &&
      st.squalls.some((s) => s.on) &&
      Math.random() < dt * 0.12
    ) {
      st.flash = 0.5;
      st.bolt = makeBolt();
      setTimeout(() => SFX.thunder(), rand(200, 900));
    }

    /* raindrops ----------------------------------------------------------*/
    const wantDrops = Math.floor(rainTotal * 5200);
    while (st.raindrops.length < wantDrops) st.raindrops.push(newDrop());
    if (st.raindrops.length > wantDrops + 40) st.raindrops.length = wantDrops;
    st.raindrops.forEach((d) => {
      d.y += d.vy * dt;
      d.x += d.vx * dt;
      if (d.y > d.floor) {
        if (Math.random() < 0.25) splashAt(d.x, d.floor, 1, "#8fb0dd", 30);
        Object.assign(d, newDrop());
      }
    });

    /* particles -----------------------------------------------------------*/
    st.particles = st.particles.filter((pt) => {
      pt.t += dt;
      pt.vy += pt.grav * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      return pt.t < pt.life;
    });

    /* banners ---------------------------------------------------------------*/
    st.banners = st.banners.filter((bn) => {
      bn.t += dt;
      return bn.t < bn.ttl;
    });

    /* audio levels ------------------------------------------------------------ */
    if (AU.rainGain) {
      AU.rainGain.gain.value = lerp(
        AU.rainGain.gain.value,
        AU.muted ? 0 : 0.015 + rainTotal * 3.2,
        0.06,
      );
      AU.surfGain.gain.value = lerp(
        AU.surfGain.gain.value,
        AU.muted ? 0 : clamp(Math.abs(lastQ3) * st.gates[2].p * 2.4, 0, 0.13),
        0.08,
      );
    }

    /* hud -----------------------------------------------------------------------*/
    refreshHud();
  }

  function newDrop() {
    let x = rand(0, W - 10);
    const si = st.squalls.findIndex((s) => s.on);
    if (si >= 0 && Math.random() < 0.55) {
      x = rand(BASINS[si].x - 30, BASINS[si].x + BASINS[si].w + 30);
    }
    const floors = [174, 198, 222, CREST_Y];

    let floor = floors[Math.floor(Math.random() * floors.length)];
    if (Math.random() < 0.35) floor = st.seaY;
    return {
      x,
      y: rand(-40, 0),
      vx: 26 + st.wind * 40,
      vy: rand(430, 560),
      floor,
    };
  }

  function makeBolt() {
    const pts = [];
    let x = rand(200, 760);
    let y = 0;
    while (y < 240) {
      pts.push({ x, y });
      x += rand(-26, 26);
      y += rand(18, 40);
    }
    return { pts, life: 0.28 };
  }

  /* ------------------------------------------------------------------ *
   *  render                                                             *
   * ------------------------------------------------------------------ */

  function render() {
    const t = st.t;
    const prog = clamp(t / RUN_LEN, 0, 1);
    const seg = clamp(prog * (NIGHTS - 1), 0, 2);
    const i0 = Math.floor(seg);
    const i1 = Math.min(i0 + 1, 2);
    const fu = seg - i0;
    const dawn = clamp((t - (RUN_LEN - 12)) / 12, 0, 1);
    let top = mixHex(mixHex(SKY_TOP[i0], SKY_TOP[i1], fu), DAWN_TOP, dawn);
    let hor = mixHex(mixHex(SKY_HOR[i0], SKY_HOR[i1], fu), DAWN_HOR, dawn);

    ctx.save();
    if (st.shake > 0.3) {
      ctx.translate(
        (Math.random() - 0.5) * st.shake,
        (Math.random() - 0.5) * st.shake,
      );
    }

    /* sky --------------------------------------------------------------*/
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    sky.addColorStop(0, top);
    sky.addColorStop(1, hor);
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    /* stars -------------------------------------------------------------*/
    const starA = (1 - dawn) * (i0 === 2 ? 0.5 : 0.85);
    STARS.forEach((s) => {
      ctx.globalAlpha = starA * (0.5 + 0.5 * Math.sin(st.ripple * 2 + s.tw));
      ctx.fillStyle = "#dfe8ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 7);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    /* moon ---------------------------------------------------------------*/
    const mx = 500;
    const my = 74;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#e8ecff";
    ctx.beginPath();
    ctx.arc(mx, my, 40, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e8ecff";
    ctx.beginPath();
    ctx.arc(mx, my, 21, 0, 7);
    ctx.fill();
    ctx.fillStyle = mixHex(top, "#e8ecff", 0.25);
    [
      [-7, -4, 4],
      [6, 3, 3],
      [2, -9, 2.4],
    ].forEach((cr) => {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(mx + cr[0], my + cr[1], cr[2], 0, 7);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    /* clouds -------------------------------------------------------------*/
    const stormy = st.phase === "playing" && st.squalls.some((s) => s.on);
    st.clouds.forEach((c) => {
      ctx.fillStyle = stormy ? "rgba(12,16,32,0.85)" : "rgba(24,32,60,0.72)";
      [
        [0, 0],
        [38, 6],
        [-36, 8],
        [12, -10],
      ].forEach((o) => {
        ctx.beginPath();
        ctx.ellipse(
          c.x + o[0] * c.s,
          c.y + o[1] * c.s,
          37 * c.s,
          20 * c.s,
          0,
          0,
          7,
        );
        ctx.fill();
      });
    });

    /* lightning ------------------------------------------------------------*/
    if (st.bolt) {
      st.bolt.life -= 1 / 60;
      if (st.bolt.life > 0) {
        ctx.strokeStyle =
          "rgba(230,240,255," + (st.bolt.life * 3).toFixed(3) + ")";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        st.bolt.pts.forEach((p, j) =>
          j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.stroke();
      } else {
        st.bolt = null;
      }
    }

    drawLand();
    drawBasins();
    drawGates();
    drawDike();
    drawMill();
    drawSea();
    drawRain();
    drawParticles();
    drawForecast();
    drawVignette();
    drawBanners();

    if (st.flash > 0.01) {
      ctx.fillStyle = "rgba(220,232,255," + (st.flash * 0.55).toFixed(3) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    ctx.restore();
  }

  function drawHouse(x, yGround, s, drowned) {
    ctx.save();
    ctx.translate(x, yGround);
    ctx.scale(s, s);
    if (drowned) {
      ctx.rotate(0.12);
      ctx.translate(0, 6);
    }
    ctx.fillStyle = drowned ? "#3a3040" : "#8a7a63";
    ctx.fillRect(-16, -18, 32, 18);
    ctx.fillStyle = drowned ? "#2c2434" : "#5a3f3a";
    ctx.beginPath();
    ctx.moveTo(-20, -18);
    ctx.lineTo(0, -34);
    ctx.lineTo(20, -18);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = drowned ? 0.4 : 0.95;
    ctx.fillStyle = drowned ? "#241d2c" : "#ffca6b";
    ctx.fillRect(-6, -13, 8, 7);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawFence(x, yGround, n) {
    ctx.strokeStyle = "#57486b";
    ctx.lineWidth = 1.6;
    for (let k = 0; k < n; k++) {
      const px = x + k * 9;
      ctx.beginPath();
      ctx.moveTo(px, yGround);
      ctx.lineTo(px, yGround - 9);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 1, yGround - 7);
    ctx.lineTo(x + (n - 1) * 9 + 1, yGround - 7);
    ctx.stroke();
  }

  function drawLand() {
    /* terraced soil */
    ctx.fillStyle = "#241c31";
    ctx.beginPath();
    ctx.moveTo(0, 174);
    ctx.lineTo(246, 174);
    ctx.lineTo(246, 198);
    ctx.lineTo(446, 198);
    ctx.lineTo(446, 222);
    ctx.lineTo(650, 222);
    ctx.lineTo(650, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    /* step shading */
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 174, 246, 5);
    ctx.fillRect(246, 198, 200, 5);
    ctx.fillRect(446, 222, 204, 5);

    /* grass lips */
    const lips = [
      [0, 168, 246],
      [250, 192, 196],
      [452, 216, 194],
    ];
    ctx.fillStyle = "#3f6b4a";
    lips.forEach((g) => ctx.fillRect(g[0], g[1], g[2], 6));
    ctx.strokeStyle = "#4a7d55";
    ctx.lineWidth = 1.6;
    lips.forEach((g) => {
      for (let x = g[0] + 6; x < g[0] + g[2]; x += 17) {
        ctx.beginPath();
        ctx.moveTo(x, g[1] + 1);
        ctx.quadraticCurveTo(x + 2, g[1] - 6, x + 4, g[1] + 1);
        ctx.stroke();
      }
    });

    /* homesteads */
    drawHouse(28, 174, 0.75, st.breaches >= 1);
    drawHouse(230, 174, 0.78, false);
    drawHouse(432, 198, 0.55, st.breaches >= 2);
    drawHouse(694, 238, 0.6, false);
    drawFence(420, 198, 3);
    drawFence(632, 222, 2);
  }

  function drawCanalWater(i) {
    const b = BASINS[i];
    const bs = st.basins[i];
    const innerX = b.x + 8;
    const innerW = b.w - 16;
    const sy = surfY(i);

    /* stone channel */
    ctx.fillStyle = "#3f4657";
    ctx.fillRect(b.x, b.brim - 8, b.w, CAP + 16);
    ctx.fillStyle = "#151020";
    ctx.fillRect(innerX, b.brim, innerW, CAP);
    ctx.fillStyle = bs.lvl > 0.82 ? "#a04040" : "#5a4a4a";
    ctx.fillRect(innerX, b.brim, innerW, 4);

    if (bs.lvl <= 0.005) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, b.brim + 4, innerW, CAP - 4);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, sy, 0, b.floor);
    grad.addColorStop(0, "#1d5560");
    grad.addColorStop(1, "#0b2831");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(innerX, sy);
    for (let u = 0; u <= innerW; u += 8) {
      ctx.lineTo(
        innerX + u,
        sy +
          2.2 * Math.sin(u * 0.11 + st.ripple * 2.4 + i) +
          1.4 * Math.sin(u * 0.23 - st.ripple * 3.1),
      );
    }
    ctx.lineTo(innerX + innerW, b.floor);
    ctx.lineTo(innerX, b.floor);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(127,216,208,0.5)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let u = 0; u <= innerW; u += 8) {
      const wy =
        sy +
        2.2 * Math.sin(u * 0.11 + st.ripple * 2.4 + i) +
        1.4 * Math.sin(u * 0.23 - st.ripple * 3.1);
      if (u) ctx.lineTo(innerX + u, wy);
      else ctx.moveTo(innerX, wy);
    }
    ctx.stroke();
    ctx.restore();

    /* level ticks */
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (let f = 0.25; f < 1; f += 0.25) {
      ctx.fillRect(innerX + innerW - 12, b.floor - f * CAP, 10, 1);
    }
  }

  function drawBasins() {
    for (let i = 0; i < 3; i++) drawCanalWater(i);
    ctx.font = "700 10px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "rgba(223,232,255,0.55)";
    ctx.textAlign = "center";
    for (let i = 0; i < 3; i++) {
      ctx.fillText(
        BASINS[i].name.split(" ")[0],
        BASINS[i].cx,
        BASINS[i].brim - 16,
      );
    }
    ctx.textAlign = "left";
  }

  function drawGates() {
    GATES.forEach((g, i) => {
      const gs = st.gates[i];

      /* culvert mouth */
      ctx.fillStyle = "#2b3140";
      ctx.fillRect(g.x - 5, g.y - 5, g.w + 10, g.h + 10);
      ctx.fillStyle = "#0c101c";
      ctx.fillRect(g.x, g.y, g.w, g.h);

      /* flowing water glimpse */
      let flowing = 0;
      if (gs.p > 0.1) {
        const ya = g.b === -1 ? st.seaY : surfY(g.b);
        flowing = (surfY(g.a) - ya) / CAP;
      }
      if (Math.abs(flowing) > 0.02) {
        const dir = Math.sign(flowing);
        ctx.fillStyle = "rgba(60,130,150,0.55)";
        ctx.fillRect(g.x, g.y + g.h * 0.35, g.w, g.h * 0.65);
        ctx.strokeStyle = "rgba(180,225,235,0.5)";
        ctx.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
          const yy = g.y + g.h * (0.5 + k * 0.18);
          const span = g.w + 20;
          let off = (st.ripple * 90 + k * 30) % span;
          if (dir < 0) off = span - off;
          const sx = dir > 0 ? off - 10 : off - 10;
          ctx.beginPath();
          ctx.moveTo(g.x + sx, yy);
          ctx.lineTo(g.x + sx + 12, yy);
          ctx.stroke();
        }
      }

      /* sliding plank */
      const lift = gs.p * (g.h + 6);
      ctx.fillStyle = "#7a5230";
      ctx.fillRect(g.x + 6, g.y - lift + 2, g.w - 12, g.h - 4);
      ctx.strokeStyle = "#caa06a";
      ctx.lineWidth = 1;
      for (let k = 1; k < 3; k++) {
        const yy = g.y - lift + 2 + ((g.h - 4) / 3) * k;
        ctx.beginPath();
        ctx.moveTo(g.x + 6, yy);
        ctx.lineTo(g.x + g.w - 6, yy);
        ctx.stroke();
      }
      /* guides */
      ctx.fillStyle = "#454e61";
      ctx.fillRect(g.x - 3, g.y - g.h - 8, 5, g.h * 2 + 16);
      ctx.fillRect(g.x + g.w - 2, g.y - g.h - 8, 5, g.h * 2 + 16);

      /* handwheel */
      const wx = g.x + g.w / 2;
      const wy = g.y - lift - 10;
      ctx.strokeStyle = "#b9c2cf";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(wx, wy, 6.5, 0, 7);
      ctx.stroke();
      const wa = (gs.target ? 1 : -1) * st.ripple * 4;
      ctx.beginPath();
      ctx.moveTo(wx - Math.cos(wa) * 6.5, wy - Math.sin(wa) * 6.5);
      ctx.lineTo(wx + Math.cos(wa) * 6.5, wy + Math.sin(wa) * 6.5);
      ctx.stroke();

      /* numeral plaque */
      const px = g.x + g.w / 2 - 11;
      const py = g.b === -1 ? g.y - 32 : g.y + g.h + 8;
      ctx.fillStyle = "#1a2130";
      ctx.fillRect(px, py, 22, 18);
      ctx.strokeStyle = "#caa06a";
      ctx.strokeRect(px + 0.5, py + 0.5, 21, 17);
      ctx.fillStyle = "#ffd27f";
      ctx.font = "700 12px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(["I", "II", "III"][i], px + 11, py + 13.5);
      ctx.textAlign = "left";
    });
  }

  function drawDike() {
    ctx.fillStyle = "#4a3a2c";
    ctx.beginPath();
    ctx.moveTo(650, H);
    ctx.lineTo(650, 322);
    ctx.lineTo(668, 262);
    ctx.lineTo(688, CREST_Y);
    ctx.lineTo(786, CREST_Y);
    ctx.lineTo(812, 264);
    ctx.lineTo(830, 330);
    ctx.lineTo(842, H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3f6b4a";
    ctx.fillRect(686, CREST_Y - 5, 102, 6);
    ctx.fillStyle = "#5a5f6e";
    for (let k = 0; k < 9; k++) {
      const u = k / 8;
      const xx = lerp(792, 838, u);
      const yy = lerp(CREST_Y + 10, 420, u);
      ctx.beginPath();
      ctx.arc(xx + (k % 3) * 4, yy, 3.4, 0, 7);
      ctx.fill();
    }
  }

  function drawMill() {
    ctx.fillStyle = "#3a2f44";
    ctx.beginPath();
    ctx.moveTo(720, CREST_Y);
    ctx.lineTo(724, 158);
    ctx.lineTo(748, 158);
    ctx.lineTo(752, CREST_Y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2c2438";
    ctx.fillRect(730, CREST_Y - 24, 12, 24);
    ctx.fillStyle = "#57486b";
    ctx.beginPath();
    ctx.moveTo(718, 160);
    ctx.lineTo(736, 142);
    ctx.lineTo(754, 160);
    ctx.closePath();
    ctx.fill();

    const hx = 736;
    const hy = 148;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(st.millA);
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.strokeStyle = "#d8cdb8";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(54, 0);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let s = 8; s <= 50; s += 7) {
        ctx.moveTo(s, 0);
        ctx.lineTo(s - 5, 9);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "#b9c2cf";
    ctx.beginPath();
    ctx.arc(hx, hy, 3.6, 0, 7);
    ctx.fill();

    /* bail spout trickling seaward */
    ctx.strokeStyle = "#57486b";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(750, 176);
    ctx.lineTo(778, 188);
    ctx.lineTo(792, 212);
    ctx.stroke();
  }

  function drawSea() {
    const sy = st.seaY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(796, 0, W - 796, H);
    ctx.clip();

    const grad = ctx.createLinearGradient(0, sy - 10, 0, H);
    grad.addColorStop(0, "#20527a");
    grad.addColorStop(1, "#071c2c");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(796, sy);
    for (let u = 0; u <= W - 796; u += 6) {
      ctx.lineTo(
        796 + u,
        sy +
          3.4 * Math.sin(u * 0.055 + st.ripple * 1.8) +
          2.2 * Math.sin(u * 0.13 - st.ripple * 2.7),
      );
    }
    ctx.lineTo(W, H);
    ctx.lineTo(796, H);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(160,205,235,0.14)";
    ctx.beginPath();
    ctx.moveTo(796, sy + 8);
    for (let u = 0; u <= W - 796; u += 6) {
      ctx.lineTo(796 + u, sy + 8 + 3 * Math.sin(u * 0.08 - st.ripple * 2.2));
    }
    ctx.lineTo(W, H);
    ctx.lineTo(796, H);
    ctx.closePath();
    ctx.fill();

    /* moon glitter */
    ctx.globalAlpha = 0.2 * (1 - clamp((sy - 300) / 100, 0, 1));
    ctx.fillStyle = "#e8ecff";
    for (let k = 0; k < 14; k++) {
      const gx = 830 + ((k * 53) % 110);
      const gy = sy + 12 + ((k * 97) % Math.max(H - sy - 30, 10));
      ctx.fillRect(gx, gy, 10 + (k % 3) * 5, 1.6);
    }
    ctx.globalAlpha = 1;

    /* foam at the dike */
    ctx.strokeStyle = "rgba(207,234,255,0.6)";
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) {
      const fy = sy + 4 + k * 11 + 2 * Math.sin(st.ripple * 2 + k);
      const fw = 26 + ((k * 31) % 30);
      const fx = 800 + ((k * 47) % 40) + Math.sin(st.ripple + k) * 6;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + fw, fy);
      ctx.stroke();
    }
    ctx.restore();

    /* tide pole */
    ctx.fillStyle = "#454e61";
    ctx.fillRect(936, 214, 6, 234);
    ctx.font = "700 9px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(223,232,255,0.6)";
    ctx.fillText("HT", 918, 265);
    ctx.fillText("LT", 918, 403);
    ctx.fillStyle = "#caa06a";
    ctx.fillRect(930, 262, 18, 2);
    ctx.fillRect(930, 400, 18, 2);
    const by = clamp(sy, 222, 442);
    ctx.fillStyle = "#ff5d5d";
    ctx.beginPath();
    ctx.moveTo(939, by - 7);
    ctx.lineTo(945, by);
    ctx.lineTo(933, by);
    ctx.closePath();
    ctx.fill();
  }

  function drawRain() {
    if (st.phase !== "playing" || !st.raindrops.length) return;
    ctx.strokeStyle = "rgba(159,182,255,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    st.raindrops.forEach((d) => {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.vx * 0.03, d.y - d.vy * 0.03);
    });
    ctx.stroke();
  }

  function drawParticles() {
    st.particles.forEach((pt) => {
      ctx.globalAlpha = clamp(1 - pt.t / pt.life, 0, 1) * 0.9;
      ctx.fillStyle = pt.col;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, 7);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawForecast() {
    if (st.phase === "title") return;
    const px = 18;
    const py = 16;
    const pw = 300;
    const ph = 76;
    ctx.fillStyle = "rgba(6,10,20,0.72)";
    ctx.strokeStyle = "rgba(223,232,255,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 9);
    ctx.fill();
    ctx.stroke();

    ctx.font = "700 9px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(143,160,200,0.9)";
    ctx.fillText("TIDE TABLE", px + 10, py + 14);
    ctx.fillText("ebb & flood ahead", px + pw - 96, py + 14);

    const cy = py + 44;
    const ampPx = 22;
    ctx.strokeStyle = "rgba(223,232,255,0.14)";
    ctx.beginPath();
    ctx.moveTo(px + 8, cy);
    ctx.lineTo(px + pw - 8, cy);
    ctx.stroke();

    const span = 55;
    ctx.strokeStyle = "#7fd8d0";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let u = 0; u <= span; u += 0.5) {
      const rel = (MEAN_SEA - tideSurfY(st.t + u)) / 124;
      const gx = px + 10 + (u / span) * (pw - 20);
      const gy = cy - rel * ampPx;
      if (u) ctx.lineTo(gx, gy);
      else ctx.moveTo(gx, gy);
    }
    ctx.stroke();

    /* surge tint */
    const surgeStart = NIGHT_LEN * 2 + 12;
    if (st.t + span > surgeStart) {
      const s0 = Math.max(surgeStart, st.t);
      const s1 = Math.min(NIGHT_LEN * 2 + 48, st.t + span);
      if (s0 < s1) {
        ctx.fillStyle = "rgba(255,93,93,0.16)";
        ctx.fillRect(
          px + 10 + ((s0 - st.t) / span) * (pw - 20),
          py + 20,
          ((s1 - s0) / span) * (pw - 20),
          ph - 30,
        );
      }
    }

    const rel0 = (MEAN_SEA - tideSurfY(st.t)) / 124;
    ctx.fillStyle = "#ffc46b";
    ctx.beginPath();
    ctx.arc(px + 10, cy - rel0 * ampPx, 3.4, 0, 7);
    ctx.fill();
  }

  function drawVignette() {
    if (st.phase !== "playing") return;
    let worst = 0;
    st.basins.forEach((bs) => {
      worst = Math.max(worst, (bs.lvl - 0.8) / 0.2);
    });
    if (worst <= 0) return;
    const a = clamp(worst, 0, 1) * (0.22 + 0.12 * Math.sin(st.ripple * 6));
    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.36,
      W / 2,
      H / 2,
      H * 0.78,
    );
    vg.addColorStop(0, "rgba(255,60,60,0)");
    vg.addColorStop(1, "rgba(255,60,60," + a.toFixed(3) + ")");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBanners() {
    st.banners.forEach((bn) => {
      const u = bn.t / bn.ttl;
      const a = u < 0.15 ? u / 0.15 : u > 0.75 ? (1 - u) / 0.25 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = "center";
      ctx.font = "800 44px Georgia, serif";
      ctx.fillStyle = bn.main.indexOf("BREACH") === 0 ? "#ff6b6b" : "#ffd27f";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 14;
      ctx.fillText(bn.main, W / 2, 132);
      if (bn.sub) {
        ctx.font = "italic 17px Georgia, serif";
        ctx.fillStyle = "#dfe8ff";
        ctx.fillText(bn.sub, W / 2, 158);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    });
  }

  /* ------------------------------------------------------------------ *
   *  input                                                              *
   * ------------------------------------------------------------------ */

  document.addEventListener("keydown", (ev) => {
    const k = ev.key;
    if (k === "m" || k === "M") {
      ensureAudio();
      toggleMute();
      return;
    }
    if (st.phase === "title" || st.phase === "over" || st.phase === "won") {
      if (k === "Enter" || k === " ") {
        ev.preventDefault();
        startGame();
      }
      return;
    }
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (k === "r" || k === "R") {
      startGame();
      return;
    }
    if (st.phase === "paused" && (k === "Enter" || k === " ")) {
      resumeGame();
      return;
    }
    if (st.phase === "playing") {
      const gi = ["1", "2", "3"].indexOf(k);
      if (gi >= 0) {
        ev.preventDefault();
        toggleGate(gi);
      }
    }
  });

  function canvasPos(ev) {
    const r = cvs.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * W,
      y: ((ev.clientY - r.top) / r.height) * H,
    };
  }

  cvs.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ensureAudio();
    if (st.phase !== "playing") return;
    const p = canvasPos(ev);
    for (let i = 0; i < GATES.length; i++) {
      const g = GATES[i];
      if (
        p.x > g.x - 16 &&
        p.x < g.x + g.w + 16 &&
        p.y > g.y - 36 &&
        p.y < g.y + g.h + 30
      ) {
        toggleGate(i);
        return;
      }
    }
  });

  gateBtns.forEach((b) => {
    b.addEventListener("click", () => {
      ensureAudio();
      toggleGate(+b.getAttribute("data-gate"));
    });
  });

  el.pause.addEventListener("click", () => {
    if (st.phase === "playing" || st.phase === "paused") {
      ensureAudio();
      togglePause();
    }
  });

  function toggleMute() {
    AU.muted = !AU.muted;
    if (AU.master) AU.master.gain.value = AU.muted ? 0 : 0.9;
    el.mute.textContent = AU.muted ? "\u2715" : "\u266A";
    el.mute.setAttribute("aria-pressed", String(AU.muted));
  }
  el.mute.addEventListener("click", () => {
    ensureAudio();
    toggleMute();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && st.phase === "playing") pauseGame();
  });

  /* ------------------------------------------------------------------ *
   *  debug hook (active only with #debug)                               *
   * ------------------------------------------------------------------ */

  if (/debug/.test(location.hash)) {
    window.__ww = {
      get snap() {
        return {
          phase: st.phase,
          t: +st.t.toFixed(2),
          seals: st.seals,
          score: Math.floor(st.score),
          night: Math.min(Math.floor(st.t / NIGHT_LEN), 2),
          lvls: st.basins.map((b) => +b.lvl.toFixed(3)),
          seaY: +st.seaY.toFixed(1),
          gates: st.gates.map((g) => !!g.target),
        };
      },
      toggle: (i) => toggleGate(i, true),
      start: startGame,
      step(sec) {
        let left = sec;
        while (left > 0) {
          const d = Math.min(left, DT);
          update(d);
          left -= d;
        }
      },
      tune(o) {
        if (o.BASE_RAIN) BASE_RAIN = o.BASE_RAIN;
        if (o.GATE_K) GATE_K = o.GATE_K;
        if (o.Q_MAX !== undefined) Q_MAX = o.Q_MAX;
        if (o.MILL_RATE !== undefined) MILL_RATE = o.MILL_RATE;
      },
    };
  }

  /* ------------------------------------------------------------------ *
   *  main loop                                                          *
   * ------------------------------------------------------------------ */

  let prev = performance.now();
  let acc = 0;

  function frame(now) {
    let d = (now - prev) / 1000;
    prev = now;
    if (d > 0.25) d = 0.25;
    acc += d;
    let steps = 0;
    while (acc >= DT && steps < 5) {
      update(DT);
      acc -= DT;
      steps++;
    }
    if (steps === 5) acc = 0;
    st.millA += (0.7 + st.wind * 2.0) * d * (st.phase === "playing" ? 1 : 0.4);
    render();
    pumpTicker();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
