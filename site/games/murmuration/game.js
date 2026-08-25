/*
 * Murmuration — an evening's work over the bay.
 * Steer the lead starling; the flock follows. Hold it tight, thread the lit
 * arches, and bring half of them under the pier before full dark. The
 * peregrine only takes stragglers, so the flock's own cohesion is its armour.
 */
(() => {
  "use strict";

  /* ---------------------------------------------------------- helpers */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const $ = (id) => document.getElementById(id);

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* -------------------------------------------------------------- DOM */

  const cv = $("sky");
  const g = cv.getContext("2d");
  const hud = $("hud");
  const legLabelEl = $("legLabel");
  const duskFill = $("duskFill");
  const progFill = $("progFill");
  const flockWrap = $("flockWrap");
  const flockCountEl = $("flockCount");
  const btnPulse = $("btnPulse");
  const btnPause = $("btnPause");
  const btnMute = $("btnMute");
  const btnRestart = $("btnRestart");
  const toastEl = $("toast");
  const hintsEl = $("hints");
  const bestLine = $("bestLine");
  const CARDS = {
    cardTitle: $("cardTitle"),
    cardBrief: $("cardBrief"),
    cardTally: $("cardTally"),
    cardOver: $("cardOver"),
    cardWin: $("cardWin"),
    cardPaused: $("cardPaused"),
  };

  /* ------------------------------------------------------------ audio */

  const AU = {
    ctx: null,
    master: null,
    windGain: null,
    noiseBuf: null,
    muted: false,
    init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const filt = this.ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = 420;
        filt.Q.value = 0.5;
        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0;
        src.connect(filt);
        filt.connect(this.windGain);
        this.windGain.connect(this.master);
        src.start();
      } catch (e) {
        this.ctx = null;
      }
    },
    resume() {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    },
    tone(f0, f1, dur, type, vol, delay) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0)
        o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      const gn = this.ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn);
      gn.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    burst(dur, vol, freq) {
      if (!this.ctx || !this.noiseBuf) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = 0.9;
      const gn = this.ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.03);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(gn);
      gn.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.05);
    },
    chime() {
      this.tone(660, 660, 0.16, "sine", 0.22);
      this.tone(880, 880, 0.22, "sine", 0.2, 0.09);
    },
    miss() {
      this.tone(190, 120, 0.28, "triangle", 0.28);
    },
    screech(short) {
      this.tone(1750, short ? 900 : 520, short ? 0.18 : 0.34, "sawtooth", 0.12);
      this.burst(0.25, 0.07, 2600);
    },
    thud() {
      this.tone(140, 58, 0.18, "triangle", 0.36);
      this.burst(0.12, 0.16, 320);
    },
    whoosh() {
      this.burst(0.38, 0.2, 750);
    },
    tick() {
      this.tone(320, 240, 0.06, "square", 0.05);
    },
    settleChord() {
      [440, 392, 330, 262].forEach((f, i) =>
        this.tone(f, f, 0.32, "sine", 0.17, i * 0.12),
      );
      this.burst(0.5, 0.08, 500);
    },
    drone() {
      this.tone(196, 92, 1.5, "sine", 0.22);
      this.tone(98, 48, 1.7, "triangle", 0.16);
    },
    startChord() {
      [220, 277.2, 329.6].forEach((f, i) =>
        this.tone(f, f, 0.65, "sine", 0.13, i * 0.06),
      );
    },
    setWind(v) {
      if (this.windGain && this.ctx)
        this.windGain.gain.setTargetAtTime(
          clamp(v, 0, 0.3),
          this.ctx.currentTime,
          0.5,
        );
    },
  };

  /* --------------------------------------------------------- constants */

  const LH = 720;
  const WATER_Y = 604;
  const DECK_Y = 430;
  const MAXB = 340;
  const PASS_FRAC = 0.45;
  const LSPEED = 258;

  /* ------------------------------------------------------------- legs */

  function makeLegs() {
    return [
      {
        name: "Out of the Reeds",
        kick: "leg one",
        note: "No falcon yet. Learn the pull of the flock and thread the lit arches — miss one and the dusk leaps closer.",
        len: 3600,
        birds: 240,
        dusk: 75,
        windBase: 0,
        windGust: 0,
        falcon: null,
        obs: [
          ["reed", 700],
          ["gate", 1500, 150, 470],
          ["reed", 1950],
          ["reed", 2250],
          ["gate", 2700, 210, 560],
          ["reed", 3150],
        ],
      },
      {
        name: "The First Peregrine",
        kick: "leg two",
        note: "A peregrine is working the flock. It can only strike birds with no neighbours — keep the ball tight and it goes hungry.",
        len: 4200,
        birds: 250,
        dusk: 82,
        windBase: 0,
        windGust: 30,
        falcon: { delay: 6, interval: 17 },
        obs: [
          ["reed", 650],
          ["gate", 1250, 160, 440],
          ["reed", 1650],
          ["beam", 2050, 300],
          ["gate", 2450, 290, 560],
          ["reed", 2900],
          ["gate", 3450, 130, 390],
          ["reed", 3800],
        ],
      },
      {
        name: "Crosswind",
        kick: "leg three",
        note: "The evening breeze turns and shoves. Watch the streaks — the whole flock drifts with them.",
        len: 4600,
        birds: 255,
        dusk: 84,
        windBase: -42,
        windGust: 150,
        falcon: { delay: 5, interval: 15 },
        obs: [
          ["reed", 600],
          ["beam", 1050, 260],
          ["gate", 1500, 140, 400],
          ["reed", 1900],
          ["beam", 2300, 340],
          ["gate", 2700, 300, 560],
          ["reed", 3100],
          ["gate", 3600, 170, 420],
          ["reed", 3950],
        ],
      },
      {
        name: "The Old Pier Works",
        kick: "leg four",
        note: "Spare timbers from an old wreck hang over the shallows. A slalom, with the falcon still counting your loners.",
        len: 5000,
        birds: 255,
        dusk: 86,
        windBase: 22,
        windGust: 95,
        falcon: { delay: 4, interval: 13 },
        obs: [
          ["beam", 800, 240],
          ["reed", 1150],
          ["gate", 1500, 130, 370],
          ["beam", 1850, 330],
          ["gate", 2150, 280, 540],
          ["reed", 2500],
          ["beam", 2850, 220],
          ["gate", 3200, 140, 400],
          ["reed", 3550],
          ["beam", 3900, 340],
          ["gate", 4250, 260, 520],
        ],
      },
      {
        name: "Storm Roost",
        kick: "leg five · the last leg",
        note: "A squall runs in off the sea and the falcon grows bold. Everything you have learned, all at once — the pier is ahead.",
        len: 5600,
        birds: 260,
        dusk: 96,
        windBase: -68,
        windGust: 210,
        falcon: { delay: 3, interval: 11, rage: true },
        obs: [
          ["reed", 550],
          ["gate", 950, 150, 410],
          ["beam", 1350, 250],
          ["reed", 1700],
          ["gate", 2100, 300, 560],
          ["beam", 2500, 210],
          ["reed", 2850],
          ["gate", 3250, 130, 380],
          ["beam", 3650, 340],
          ["gate", 4050, 270, 530],
          ["reed", 4400],
          ["gate", 4800, 160, 430],
        ],
      },
    ];
  }

  /* Probe modes let a headless test walk the win and lose paths quickly.
     They shrink numbers only; nothing else about the game changes. */
  const QS = new URLSearchParams(location.search);
  const PROBE = QS.get("probe");
  function effectiveLegs() {
    const legs = makeLegs();
    if (PROBE === "win")
      return [
        {
          name: "Test Flight",
          kick: "leg one",
          note: "A short hop to the pier.",
          len: 1500,
          birds: 40,
          dusk: 80,
          windBase: 0,
          windGust: 0,
          falcon: null,
          obs: [["gate", 700, 60, 600]],
        },
      ];
    if (PROBE === "lose") {
      legs[0].dusk = 6;
      legs[0].falcon = null;
      legs[0].obs = [["reed", 900]];
    }
    return legs;
  }

  /* ------------------------------------------------------- bird state */

  const bx = new Float32Array(MAXB);
  const by = new Float32Array(MAXB);
  const bvx = new Float32Array(MAXB);
  const bvy = new Float32Array(MAXB);
  const bph = new Float32Array(MAXB);
  const balpha = new Float32Array(MAXB);
  const bscat = new Float32Array(MAXB);
  const bglide = new Float32Array(MAXB);
  const bdead = new Uint8Array(MAXB);
  const bmode = new Uint8Array(MAXB); // 0 free, 1 to slot, 2 fleeing, 3 arrived
  const bslot = new Int16Array(MAXB);
  const ccx = new Float32Array(MAXB);
  const ccy = new Float32Array(MAXB);
  const aax = new Float32Array(MAXB);
  const aay = new Float32Array(MAXB);
  const ssx = new Float32Array(MAXB);
  const ssy = new Float32Array(MAXB);
  const bnc = new Int32Array(MAXB);

  let sxRes = 0;
  let syRes = 0;

  const leader = { x: 220, y: 340, vx: 170, vy: 0, settled: false };
  const falcon = {
    state: "off",
    cd: 8,
    x: -200,
    y: 100,
    vx: 0,
    vy: 0,
    circA: 0,
    pickT: 0,
    stT: 0,
    isoT: 0,
    leaveT: 0,
    target: -1,
  };

  const world = { len: 3600, solids: [], gates: [], roostX: 3150 };
  let LEGS = effectiveLegs();
  let legIdx = 0;
  let leg = LEGS[0];
  let bn = 0;
  let aliveCount = 0;
  let flockAtStart = 0;
  let needCount = 0;

  let state = "title"; // title | brief | fly | tally | over | win
  let paused = false;
  let muted = false;
  let dusk = 0;
  let windCur = 0;
  let ballT = 0;
  let pulseCd = 0;
  let shake = 0;
  let camX = 0;
  let settle = null;
  let T = 0;

  const cent = { x: 0, y: 0 };
  const run = { roosted: 0, possible: 0, takes: 0, carry: 0 };
  const legStat = { takes: 0, joined: 0, darkLost: 0 };
  const feathers = [];
  const rings = [];
  const splashes = [];
  const streaks = [];

  let best = null;
  try {
    best = JSON.parse(localStorage.getItem("murmuration-best") || "null");
  } catch (e) {
    best = null;
  }

  /* ----------------------------------------------------------- sizing */

  let cw = 0;
  let chh = 0;
  let DPR = 1;
  let S = 1;
  let VIEWW = 1280;

  function resize() {
    cw = window.innerWidth;
    chh = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cw * DPR);
    cv.height = Math.round(chh * DPR);
    S = chh / LH;
    VIEWW = cw / S;
  }
  window.addEventListener("resize", resize);

  const STARS = [];
  for (let i = 0; i < 80; i++)
    STARS.push({
      ux: Math.random(),
      uy: Math.random() * 0.62,
      tw: rand(1.5, 4),
      r: rand(0.6, 1.6),
    });
  const CLOUDS = [];
  for (let i = 0; i < 8; i++)
    CLOUDS.push({
      u: rand(0, 2400),
      y: rand(50, 300),
      s: rand(0.6, 1.7),
      sp: rand(0.25, 0.42),
    });

  /* -------------------------------------------------------- building */

  function buildLeg(i) {
    leg = LEGS[i];
    world.len = leg.len;
    world.roostX = leg.len - 450;
    world.solids = [];
    world.gates = [];
    const rng = mulberry32(9127 + i * 771);
    for (const o of leg.obs) {
      if (o[0] === "gate") {
        world.gates.push({ x: o[1], top: o[2], bot: o[3], st: 0 });
      } else if (o[0] === "reed") {
        const n = 3 + ((rng() * 4) | 0);
        for (let k = 0; k < n; k++) {
          const ph = 90 + rng() * 165;
          const pw = 8 + rng() * 9;
          world.solids.push({
            x: o[1] + (rng() * 190 - 95),
            y: WATER_Y - ph,
            w: pw,
            h: ph,
            kind: "post",
            lamp: false,
          });
        }
      } else if (o[0] === "beam") {
        const bw = 26 + rng() * 24;
        const yb = clamp(o[2] + (rng() * 36 - 18), 140, 480);
        world.solids.push({
          x: o[1] - bw / 2,
          y: -30,
          w: bw,
          h: yb + 30,
          kind: "beam",
          lamp: rng() < 0.55,
        });
      }
    }
    // strung pilings short of the pier, for company on the final approach
    for (
      let px = world.roostX - 500;
      px < world.roostX - 60;
      px += 130 + rng() * 90
    ) {
      const ph = 60 + rng() * 110;
      world.solids.push({
        x: px,
        y: WATER_Y - ph,
        w: 11,
        h: ph,
        kind: "post",
        lamp: false,
      });
    }
  }

  function spawnBird(n, x0) {
    bn = 0;
    aliveCount = 0;
    bdead.fill(0);
    bmode.fill(0);
    balpha.fill(1);
    bscat.fill(0);
    bglide.fill(0);
    for (let i = 0; i < n && i < MAXB; i++) {
      bx[i] = x0 + rand(-140, 160);
      by[i] = rand(180, 500);
      bvx[i] = rand(140, 200);
      bvy[i] = rand(-30, 30);
      bph[i] = rand(0, TAU);
      aliveCount++;
      bn++;
    }
    leader.x = x0 + 60;
    leader.y = 340;
    leader.vx = 180;
    leader.vy = 0;
    leader.settled = false;
  }

  /* ------------------------------------------------------ flow control */

  function showCard(name) {
    for (const k in CARDS) CARDS[k].hidden = k !== name;
    const inGame = state !== "title";
    hud.hidden = !inGame;
    hintsEl.style.opacity = inGame ? "" : "0";
  }

  function refreshBestLine() {
    if (best && best.possible > 0) {
      bestLine.hidden = false;
      bestLine.textContent =
        "Best roosting: " +
        best.roosted +
        " of " +
        best.possible +
        " brought home (" +
        Math.round((best.roosted / best.possible) * 100) +
        "%)";
    } else {
      bestLine.hidden = true;
    }
  }

  function toTitle() {
    state = "title";
    paused = false;
    settle = null;
    LEGS = effectiveLegs();
    legIdx = 0;
    buildLeg(0);
    spawnBird(210, 260);
    falcon.state = "off";
    falcon.cd = 1e9;
    dusk = 0.3;
    camX = 0;
    feathers.length = 0;
    rings.length = 0;
    splashes.length = 0;
    streaks.length = 0;
    refreshBestLine();
    showCard("cardTitle");
    AU.setWind(0.04);
  }

  function startRun() {
    run.roosted = 0;
    run.possible = 0;
    run.takes = 0;
    run.carry = 0;
    startLeg(0, 0);
  }

  function startLeg(i, carrySurvivors) {
    legIdx = i;
    buildLeg(i);
    let n = carrySurvivors > 0 ? carrySurvivors : leg.birds;
    legStat.joined = 0;
    legStat.takes = 0;
    legStat.darkLost = 0;
    if (carrySurvivors > 0 && n < leg.birds) {
      legStat.joined = Math.min(leg.birds, MAXB) - n;
      n = Math.min(leg.birds, MAXB);
    }
    n = Math.min(n, MAXB);
    spawnBird(n, 200);
    flockAtStart = aliveCount;
    needCount = Math.ceil(PASS_FRAC * flockAtStart);
    dusk = 0;
    windCur = leg.windBase;
    ballT = 0;
    pulseCd = 0;
    settle = null;
    camX = 0;
    falcon.state = "off";
    falcon.cd = leg.falcon ? leg.falcon.delay : 1e9;
    falcon.target = -1;
    feathers.length = 0;
    rings.length = 0;
    splashes.length = 0;
    streaks.length = 0;
    state = "brief";
    $("legKick").textContent = leg.kick;
    $("legName").textContent = leg.name;
    $("legNote").textContent = leg.note;
    const bits = [aliveCount + " wings come up from the marsh"];
    if (leg.falcon) bits.push("a peregrine hunts tonight");
    if (Math.abs(leg.windBase) + leg.windGust > 60) bits.push("the wind is up");
    $("legSurvivors").textContent = bits.join(" · ") + ".";
    legLabelEl.textContent = "Leg " + (i + 1) + " · " + leg.name;
    showCard("cardBrief");
    AU.setWind(Math.abs(leg.windBase) / 500 + leg.windGust / 900 + 0.03);
  }

  function beginFly() {
    state = "fly";
    paused = false;
    showCard(null);
    AU.init();
    AU.resume();
    AU.startChord();
  }

  function pulse() {
    if (state !== "fly" || paused || settle || ballT > 0 || pulseCd > 0) return;
    ballT = 1.35;
    pulseCd = 7;
    rings.push({ x: leader.x, y: leader.y, r: 12, a: 0.7 });
    AU.whoosh();
  }

  function togglePause(force) {
    if (state !== "fly" || settle) return;
    paused = force === undefined ? !paused : !!force;
    showCard(paused ? "cardPaused" : null);
    if (!paused && document.activeElement && document.activeElement.blur)
      document.activeElement.blur();
  }

  function toggleMute() {
    AU.init();
    muted = !muted;
    AU.setMuted(muted);
    btnMute.textContent = muted ? "×" : "♪";
  }

  function restartRun() {
    if (state === "title") return;
    paused = false;
    settle = null;
    startRun();
  }

  /* ------------------------------------------------------- leg endings */

  function countUnder() {
    let n = 0;
    for (let i = 0; i < bn; i++)
      if (!bdead[i] && bx[i] > world.roostX - 24) n++;
    return n;
  }

  function startSettle(ok) {
    const under = countUnder();
    legStat.darkLost = ok ? 0 : aliveCount - under;
    settle = {
      ok,
      t: 0,
      roosted: ok ? aliveCount : under,
      survivors: aliveCount,
    };
    let slotN = 1; // slot 0 belongs to the leader
    for (let i = 0; i < bn; i++) {
      if (bdead[i]) continue;
      if (ok || bx[i] > world.roostX - 24) {
        bmode[i] = 1;
        bslot[i] = slotN++;
      } else {
        bmode[i] = 2;
      }
    }
    falcon.state = "off";
    falcon.cd = 1e9;
    if (ok) AU.settleChord();
    else AU.drone();
  }

  function rank(pct) {
    if (pct >= 0.9) return "Roost Warden";
    if (pct >= 0.78) return "Keeper of the Murmur";
    if (pct >= 0.62) return "Flockhand";
    if (pct >= PASS_FRAC) return "Evening Scout";
    return "Scatterling";
  }

  function row(label, val, sum) {
    return (
      '<div class="row' +
      (sum ? " sum" : "") +
      '"><span>' +
      label +
      "</span><b>" +
      val +
      "</b></div>"
    );
  }

  function finalizeSettle() {
    const roosted = settle.roosted;
    run.carry = settle.ok ? settle.survivors : 0;
    run.roosted += roosted;
    run.possible += flockAtStart;
    run.takes += legStat.takes;
    if (!settle.ok) {
      state = "over";
      $("overBody").innerHTML =
        row("Brought home before dark", roosted) +
        row("With the flock at duskfall", flockAtStart) +
        row("Taken by the falcon tonight", run.takes) +
        row("Scattered into the dark", legStat.darkLost, true);
      showCard("cardOver");
    } else if (legIdx >= LEGS.length - 1) {
      const pct = run.possible ? run.roosted / run.possible : 0;
      $("winBody").innerHTML =
        row("Brought home across five legs", run.roosted, true) +
        row("Left the marsh with", run.possible) +
        row("Taken by the falcon", run.takes);
      $("rankLine").textContent = rank(pct);
      try {
        if (!best || pct > best.roosted / (best.possible || 1))
          localStorage.setItem(
            "murmuration-best",
            JSON.stringify({ roosted: run.roosted, possible: run.possible }),
          );
      } catch (e) {
        /* storage unavailable — the evening is its own reward */
      }
      state = "win";
      showCard("cardWin");
      AU.chime();
    } else {
      state = "tally";
      $("tallyBody").innerHTML =
        row("Safe under the boards", roosted, true) +
        row("With the flock at duskfall", flockAtStart) +
        (legStat.takes ? row("Taken by the falcon", legStat.takes) : "") +
        (legStat.joined
          ? row("Joined from the reeds", "+" + legStat.joined)
          : "");
      showCard("cardTally");
    }
    settle = null;
  }

  /* ---------------------------------------------------------- effects */

  function spawnFeathers(x, y) {
    for (let k = 0; k < 9; k++)
      feathers.push({
        x,
        y,
        vx: rand(-70, 70),
        vy: rand(-90, 20),
        rot: rand(0, TAU),
        vr: rand(-4, 4),
        life: rand(0.7, 1.5),
      });
    if (feathers.length > 120) feathers.splice(0, feathers.length - 120);
  }

  function splash(x, y) {
    splashes.push({ x, y, vy: rand(-120, -60), life: 0.5 });
    if (splashes.length > 40) splashes.shift();
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toastEl.hidden = true;
    }, 2100);
  }

  /* ---------------------------------------------------------- updating */

  function takeBird(i) {
    bdead[i] = 1;
    aliveCount--;
    legStat.takes++;
    spawnFeathers(bx[i], by[i]);
    for (let j = 0; j < bn; j++) {
      if (bdead[j]) continue;
      const dx = bx[j] - bx[i];
      const dy = by[j] - by[i];
      const d2 = dx * dx + dy * dy;
      if (d2 < 16900) {
        const d = Math.sqrt(d2) || 1;
        bvx[j] += (dx / d) * 120;
        bvy[j] += (dy / d) * 120;
      }
    }
    shake = 6;
    flockWrap.classList.add("hurt");
    setTimeout(() => flockWrap.classList.remove("hurt"), 450);
    AU.thud();
  }

  function pickLoneliest() {
    let bi = -1;
    let bnMin = 4; // only worth a stoop if truly isolated
    for (let i = 0; i < bn; i++) {
      if (bdead[i]) continue;
      const relx = bx[i] - camX;
      if (relx < -80 || relx > VIEWW + 80) continue;
      if (bnc[i] < bnMin) {
        bnMin = bnc[i];
        bi = i;
      }
    }
    return bi;
  }

  function nextFalconDelay() {
    let iv = leg.falcon.interval;
    if (leg.falcon.rage && dusk > 0.45) iv *= 0.62;
    return iv * rand(0.85, 1.2);
  }

  function cap(F, m) {
    const s = Math.hypot(F.vx, F.vy);
    if (s > m) {
      F.vx = (F.vx / s) * m;
      F.vy = (F.vy / s) * m;
    }
  }

  function updateFalcon(dt) {
    const F = falcon;
    if (!leg.falcon) {
      F.state = "off";
      return;
    }
    if (F.state === "off") {
      F.cd -= dt;
      if (F.cd <= 0) {
        F.state = "enter";
        F.x = camX + VIEWW + 140;
        F.y = rand(70, 230);
        F.vx = -220;
        F.vy = 0;
        F.pickT = 1.2;
      }
    } else if (F.state === "enter") {
      const tx = cent.x + VIEWW * 0.3;
      const ty = cent.y - 110;
      F.vx += ((tx - F.x) * 1.6 - F.vx * 0.8) * dt * 2;
      F.vy += ((ty - F.y) * 1.6 - F.vy * 0.8) * dt * 2;
      cap(F, 320);
      F.x += F.vx * dt;
      F.y += F.vy * dt;
      if (Math.hypot(tx - F.x, ty - F.y) < 70) {
        F.state = "circle";
        F.circA = Math.atan2(F.y - ty, F.x - tx);
      }
    } else if (F.state === "circle") {
      F.circA += dt * 1.3;
      const ox = cent.x + VIEWW * 0.27;
      const oy = cent.y - 100;
      const tx = ox + Math.cos(F.circA) * 155;
      const ty = oy + Math.sin(F.circA) * 66 - 40;
      F.vx += ((tx - F.x) * 3.2 - F.vx * 1.1) * dt * 2.4;
      F.vy += ((ty - F.y) * 3.2 - F.vy * 1.1) * dt * 2.4;
      cap(F, 310);
      F.x += F.vx * dt;
      F.y += F.vy * dt;
      F.pickT -= dt;
      if (F.pickT <= 0) {
        F.target = pickLoneliest();
        if (F.target >= 0) {
          F.state = "stoop";
          F.stT = 0;
          F.isoT = 0;
          AU.screech();
        } else {
          F.pickT = 0.7; // flock too tight — circle and sulk
        }
      }
    } else if (F.state === "stoop") {
      F.stT += dt;
      const b = F.target;
      if (b < 0 || b >= bn || bdead[b]) {
        F.state = "climb";
        F.leaveT = 1.4;
      } else {
        const px2 = bx[b] + bvx[b] * 0.22;
        const py2 = by[b] + bvy[b] * 0.22;
        const dx = px2 - F.x;
        const dy = py2 - F.y;
        const dd = Math.hypot(dx, dy) || 1;
        F.vx += ((dx / dd) * 470 - F.vx) * Math.min(1, dt * 2.1);
        F.vy += ((dy / dd) * 470 - F.vy) * Math.min(1, dt * 2.1);
        F.x += F.vx * dt;
        F.y += F.vy * dt;
        if (bnc[b] >= 5) F.isoT += dt;
        else F.isoT = 0;
        if (dd < 16 && bnc[b] < 5) {
          takeBird(b);
          F.state = "carry";
          F.leaveT = 1.6;
        } else if (F.isoT > 0.5 || F.stT > 2.5) {
          F.state = "climb";
          F.leaveT = 1.3;
          AU.screech(true);
        }
      }
    } else {
      // carry | climb: leave the sky, come back later
      F.leaveT -= dt;
      const dx = -260 - F.x;
      const dy = -140 - F.y;
      const dd = Math.hypot(dx, dy) || 1;
      F.vx += ((dx / dd) * 380 - F.vx) * Math.min(1, dt * 2);
      F.vy += ((dy / dd) * 380 - F.vy) * Math.min(1, dt * 2);
      F.x += F.vx * dt;
      F.y += F.vy * dt;
      if (F.leaveT <= 0 || F.x < camX - 260 || F.y < -120) {
        F.state = "off";
        F.cd = nextFalconDelay();
      }
    }
  }

  function updateLeader(dt) {
    if (settle) {
      if (!leader.settled) {
        const tx = world.roostX + 16;
        const ty = DECK_Y - 8;
        const dx = tx - leader.x;
        const dy = ty - leader.y;
        const dd = Math.hypot(dx, dy);
        if (dd < 10) {
          leader.settled = true;
          leader.vx = 0;
          leader.vy = 0;
        } else {
          leader.vx = (dx / dd) * 240;
          leader.vy = (dy / dd) * 240;
          leader.x += leader.vx * dt;
          leader.y += leader.vy * dt;
        }
      }
      return;
    }
    let dx = 0;
    let dy = 0;
    if (ptr.active) {
      dx = ptr.wx - leader.x;
      dy = ptr.wy - leader.y;
      const d = Math.hypot(dx, dy);
      if (d < 16) {
        dx = 0;
        dy = 0;
      }
    } else {
      dx =
        (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) -
        (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
      dy =
        (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) -
        (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
      const dl = Math.hypot(dx, dy);
      if (dl > 0) {
        dx /= dl;
        dy /= dl;
      }
    }
    const k = Math.min(1, dt * 5.2);
    leader.vx += (dx * LSPEED - leader.vx) * k;
    leader.vy += (dy * LSPEED - leader.vy) * k;
    leader.x += leader.vx * dt;
    leader.y += leader.vy * dt;
    leader.y = clamp(leader.y, 46, WATER_Y - 14);
    leader.x = clamp(leader.x, camX + 30, camX + VIEWW * 0.92);
  }

  function updateSettleBird(i, dt) {
    const mode = bmode[i];
    if (mode === 1) {
      const col = bslot[i] % 12;
      const rw = (bslot[i] / 12) | 0;
      const tx = world.roostX + 22 + col * 14;
      const ty = DECK_Y - 6 - rw * 3 - (col % 2) * 2;
      const dx = tx - bx[i];
      const dy = ty - by[i];
      const dd = Math.hypot(dx, dy) || 1;
      if (dd < 8) {
        bmode[i] = 3;
      } else {
        bvx[i] = (dx / dd) * Math.min(300, dd * 5);
        bvy[i] = (dy / dd) * Math.min(300, dd * 5);
        bx[i] += bvx[i] * dt;
        by[i] += bvy[i] * dt;
      }
      bph[i] += 9 * dt;
    } else if (mode === 2) {
      bvx[i] -= 40 * dt;
      bvy[i] -= 190 * dt;
      bx[i] += bvx[i] * dt;
      by[i] += bvy[i] * dt;
      balpha[i] -= dt * 0.9;
      bph[i] += 11 * dt;
    } else if (mode === 3) {
      balpha[i] -= dt * 2.4;
      bx[i] += Math.sin(T * 3 + i) * 6 * dt;
    }
    if (balpha[i] <= 0) {
      balpha[i] = 0;
      bdead[i] = 1;
      aliveCount--;
    }
  }

  function collideSolids(i) {
    for (const s of world.solids) {
      const rx = s.x - 4;
      const ry = s.y - 4;
      const rw = s.w + 8;
      const rh = s.h + 8;
      if (bx[i] < rx || bx[i] > rx + rw || by[i] < ry || by[i] > ry + rh)
        continue;
      const dl = bx[i] - rx;
      const dr = rx + rw - bx[i];
      const du = by[i] - ry;
      const dbot = ry + rh - by[i];
      const m = Math.min(dl, dr, du, dbot);
      if (m === dl) {
        bx[i] = rx;
        bvx[i] = -Math.abs(bvx[i]) * 0.4;
      } else if (m === dr) {
        bx[i] = rx + rw;
        bvx[i] = Math.abs(bvx[i]) * 0.4;
      } else if (m === du) {
        by[i] = ry;
        bvy[i] = -Math.abs(bvy[i]) * 0.4;
      } else {
        by[i] = ry + rh;
        bvy[i] = Math.abs(bvy[i]) * 0.4;
      }
      if (bscat[i] <= 0) {
        bscat[i] = 1.25;
        if (Math.random() < 0.4) AU.tick();
      }
    }
  }

  function updateBirds(dt) {
    const ball = ballT > 0;
    const R = ball ? 94 : 68;
    const R2 = R * R;
    const SR = ball ? 21 : 27;
    const SR2 = SR * SR;
    const maxSp = (232 + legIdx * 7) * (ball ? 0.82 : 1);
    const minSp = 92;
    const maxF = 560 * (ball ? 1.25 : 1);
    const wCoh = ball ? 1.5 : 0.62;
    const wSep = ball ? 2.1 : 1.35;

    for (let i = 0; i < bn; i++) {
      ccx[i] = 0;
      ccy[i] = 0;
      aax[i] = 0;
      aay[i] = 0;
      ssx[i] = 0;
      ssy[i] = 0;
      bnc[i] = 0;
    }
    for (let i = 0; i < bn; i++) {
      if (bdead[i]) continue;
      const xi = bx[i];
      const yi = by[i];
      for (let j = i + 1; j < bn; j++) {
        if (bdead[j]) continue;
        const dx = bx[j] - xi;
        if (dx > R || dx < -R) continue;
        const dy = by[j] - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        bnc[i]++;
        bnc[j]++;
        ccx[i] += bx[j];
        ccx[j] += xi;
        ccy[i] += by[j];
        ccy[j] += yi;
        aax[i] += bvx[j];
        aax[j] += bvx[i];
        aay[i] += bvy[j];
        aay[j] += bvy[i];
        if (d2 < SR2) {
          const inv = 1 / (d2 + 60);
          ssx[i] -= dx * inv;
          ssx[j] += dx * inv;
          ssy[i] -= dy * inv;
          ssy[j] += dy * inv;
        }
      }
    }

    const ltx = leader.x + leader.vx * 0.3;
    const lty = leader.y + leader.vy * 0.3;
    const wnd = windCur * 0.85;

    for (let i = 0; i < bn; i++) {
      if (bdead[i]) continue;

      if (settle) {
        updateSettleBird(i, dt);
        continue;
      }

      let ax = 0;
      let ay = 0;
      const n = bnc[i];

      if (bscat[i] > 0) {
        // just knocked off a post: stunned, drifting, easy prey
        bscat[i] -= dt;
        ax += ssx[i] * 9000;
        ay += ssy[i] * 9000 + 30;
        ax += wnd;
        bvx[i] *= 1 - Math.min(1, dt * 0.9);
        bvy[i] *= 1 - Math.min(1, dt * 0.9);
      } else {
        if (n > 0) {
          // cohesion: seek the local centre
          steer(i, ccx[i] / n - bx[i], ccy[i] / n - by[i], maxSp * 0.85, maxF);
          ax += sxRes * wCoh;
          ay += syRes * wCoh;
          // alignment: match the neighbours' heading
          steerV(i, aax[i] / n, aay[i] / n, maxSp, maxF);
          ax += sxRes * 0.62;
          ay += syRes * 0.62;
        } else {
          ax += bvx[i] * 0.15;
          ay += bvy[i] * 0.15;
        }
        if (ssx[i] !== 0 || ssy[i] !== 0) {
          steerV(i, ssx[i], ssy[i], maxSp, maxF);
          ax += sxRes * wSep;
          ay += syRes * wSep;
        }
        // pull toward the leader, harder when far behind
        const ldx = ltx - bx[i];
        const ldy = lty - by[i];
        const far = ldx * ldx + ldy * ldy > 22500 ? 1.9 : 1;
        steer(i, ldx, ldy, maxSp, maxF, (ball ? 0.32 : 0.88) * far);
        ax += sxRes;
        ay += syRes;
        ax += wnd;
        ay += Math.sin(T * 1.7 + i * 1.31) * 14;
      }

      const am = Math.hypot(ax, ay);
      if (am > maxF) {
        ax = (ax / am) * maxF;
        ay = (ay / am) * maxF;
      }
      bvx[i] += ax * dt;
      bvy[i] += ay * dt;
      const sp2 = bvx[i] * bvx[i] + bvy[i] * bvy[i];
      if (sp2 > maxSp * maxSp) {
        const kk = maxSp / Math.sqrt(sp2);
        bvx[i] *= kk;
        bvy[i] *= kk;
      } else if (sp2 < minSp * minSp) {
        const kk = minSp / Math.sqrt(sp2 || 1);
        bvx[i] *= kk;
        bvy[i] *= kk;
      }
      bx[i] += bvx[i] * dt;
      by[i] += bvy[i] * dt;

      if (by[i] < 44) {
        by[i] = 44;
        bvy[i] = Math.abs(bvy[i]) * 0.5;
      } else if (by[i] > WATER_Y - 10) {
        by[i] = WATER_Y - 10;
        bvy[i] = -Math.abs(bvy[i]) * 0.55;
        if (Math.random() < 0.25) splash(bx[i], WATER_Y);
      }

      collideSolids(i);

      if (bglide[i] > 0) bglide[i] -= dt;
      else if (Math.random() < dt * 0.12) bglide[i] = rand(0.5, 1.2);
      bph[i] += (bglide[i] > 0 ? 1.2 : 8.5) * dt * (0.8 + Math.sqrt(sp2) / 260);

      const relx = bx[i] - camX;
      if (relx < -40) bvx[i] += 260 * dt;
      else if (relx > VIEWW + 90) bvx[i] -= 200 * dt;
    }
  }

  function steer(i, dx, dy, speed, maxF, weight) {
    const wgt = weight === undefined ? 1 : weight;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) {
      sxRes = 0;
      syRes = 0;
      return;
    }
    sxRes = ((dx / d) * speed - bvx[i]) * wgt;
    syRes = ((dy / d) * speed - bvy[i]) * wgt;
    const m = Math.hypot(sxRes, syRes);
    if (m > maxF) {
      sxRes = (sxRes / m) * maxF;
      syRes = (syRes / m) * maxF;
    }
  }

  function steerV(i, tx, ty, speed, maxF) {
    const m = Math.hypot(tx, ty);
    if (m < 0.001) {
      sxRes = 0;
      syRes = 0;
      return;
    }
    sxRes = (tx / m) * speed - bvx[i];
    syRes = (ty / m) * speed - bvy[i];
    const mm = Math.hypot(sxRes, syRes);
    if (mm > maxF) {
      sxRes = (sxRes / mm) * maxF;
      syRes = (syRes / mm) * maxF;
    }
  }

  function computeCentroid() {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < bn; i++) {
      if (bdead[i]) continue;
      sx += bx[i];
      sy += by[i];
      n++;
    }
    if (n === 0) {
      cent.x = leader.x;
      cent.y = leader.y;
    } else {
      cent.x = sx / n;
      cent.y = sy / n;
    }
  }

  function updateGates() {
    for (const gt of world.gates) {
      if (gt.st !== 0) continue;
      if (cent.x > gt.x + 12) {
        let inside = 0;
        for (let i = 0; i < bn; i++) {
          if (bdead[i]) continue;
          if (by[i] > gt.top - 26 && by[i] < gt.bot + 26) inside++;
        }
        if (inside >= aliveCount * 0.5) {
          gt.st = 1;
          dusk = Math.max(0, dusk - 6 / leg.dusk);
          toast("Arch held — the light lingers");
          AU.chime();
        } else {
          gt.st = 2;
          dusk = Math.min(1, dusk + 9 / leg.dusk);
          toast("Arch missed — the dusk leaps closer");
          AU.miss();
        }
      }
    }
  }

  function updateFx(dt) {
    for (let i = feathers.length - 1; i >= 0; i--) {
      const f = feathers[i];
      f.life -= dt;
      f.vy += 60 * dt;
      f.vx *= 1 - dt * 0.6;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.life <= 0) feathers.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += 260 * dt;
      r.a -= dt * 1.1;
      if (r.a <= 0) rings.splice(i, 1);
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i];
      sp.life -= dt;
      sp.vy += 420 * dt;
      sp.y += sp.vy * dt;
      if (sp.life <= 0) splashes.splice(i, 1);
    }
    if (Math.abs(windCur) > 70 && Math.random() < dt * 26) {
      streaks.push({
        x: camX + rand(0, VIEWW),
        y: rand(40, WATER_Y - 30),
        len: rand(30, 90) * Math.sign(windCur),
        life: rand(0.3, 0.7),
      });
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const st = streaks[i];
      st.life -= dt;
      st.x += windCur * 2.4 * dt;
      if (st.life <= 0) streaks.splice(i, 1);
    }
    shake = Math.max(0, shake - dt * 14);
  }

  function update(dt) {
    T += dt;
    const gustPhase = 0.5 + 0.5 * Math.sin(T * 0.37 + Math.sin(T * 0.11) * 2);
    windCur = leg.windBase + leg.windGust * gustPhase;
    AU.setWind(Math.abs(windCur) / 420 + 0.04);

    if (ballT > 0) ballT -= dt;
    if (pulseCd > 0) pulseCd -= dt;
    btnPulse.classList.toggle("cooling", pulseCd > 0);

    updateLeader(dt);
    updateBirds(dt);
    computeCentroid();

    if (!settle) {
      dusk += dt / leg.dusk;
      updateGates();
      updateFalcon(dt);
      if (dusk >= 1) {
        dusk = 1;
        startSettle(countUnder() >= needCount);
      } else if (countUnder() >= needCount) {
        startSettle(true);
      }
    } else {
      settle.t += dt;
      updateFalcon(dt); // lets any lingering falcon fly home
      if (settle.t > 2.1) finalizeSettle();
    }

    updateFx(dt);

    const targetCam = clamp(
      cent.x - VIEWW * 0.42,
      0,
      Math.max(0, world.len - VIEWW),
    );
    const ck = settle ? 2.2 : 3.4;
    camX += (targetCam - camX) * Math.min(1, dt * ck);

    duskFill.style.width = (dusk * 100).toFixed(1) + "%";
    progFill.style.width =
      (clamp(cent.x / world.roostX, 0, 1) * 100).toFixed(1) + "%";
    flockCountEl.textContent = String(aliveCount);
  }

  /* ambient flight behind the title and briefing cards */
  function ambient(dt) {
    T += dt;
    windCur = leg.windGust
      ? leg.windGust * 0.2 * (0.5 + 0.5 * Math.sin(T * 0.4))
      : 0;
    if ((state === "title" || state === "brief") && !leader.settled) {
      const tx = state === "title" ? 470 + Math.sin(T * 0.21) * 250 : 430;
      const ty =
        state === "title" ? 310 + Math.sin(T * 0.317 + 1.7) * 140 : 330;
      const dx = tx - leader.x;
      const dy = ty - leader.y;
      const dd = Math.hypot(dx, dy) || 1;
      leader.vx += ((dx / dd) * 170 - leader.vx) * Math.min(1, dt * 1.6);
      leader.vy += ((dy / dd) * 170 - leader.vy) * Math.min(1, dt * 1.6);
      leader.x += leader.vx * dt;
      leader.y += leader.vy * dt;
      leader.y = clamp(leader.y, 60, WATER_Y - 40);
    }
    updateBirds(dt);
    computeCentroid();
    updateFx(dt);
    if (state === "title") camX += (0 - camX) * Math.min(1, dt * 1.5);
  }

  /* ---------------------------------------------------------- palette */

  const PAL = [
    {
      t: 0,
      top: [44, 56, 104],
      mid: [182, 112, 94],
      hor: [255, 176, 102],
      seaA: [40, 54, 88],
      seaB: [16, 22, 42],
      hillA: [26, 32, 56],
      hillB: [16, 20, 38],
      sun: [255, 214, 150],
    },
    {
      t: 0.55,
      top: [24, 30, 64],
      mid: [118, 60, 74],
      hor: [235, 112, 66],
      seaA: [26, 34, 64],
      seaB: [10, 14, 30],
      hillA: [17, 21, 42],
      hillB: [10, 13, 27],
      sun: [255, 148, 80],
    },
    {
      t: 0.85,
      top: [12, 16, 40],
      mid: [46, 34, 58],
      hor: [132, 58, 52],
      seaA: [15, 19, 40],
      seaB: [6, 8, 19],
      hillA: [11, 14, 29],
      hillB: [6, 8, 19],
      sun: [228, 98, 68],
    },
    {
      t: 1,
      top: [6, 8, 22],
      mid: [17, 17, 38],
      hor: [54, 30, 44],
      seaA: [9, 11, 26],
      seaB: [3, 4, 12],
      hillA: [6, 8, 17],
      hillB: [3, 4, 11],
      sun: [160, 70, 60],
    },
  ];

  function mixc(a, b, t) {
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
    ];
  }
  const css = (c, a) =>
    "rgba(" +
    c[0] +
    "," +
    c[1] +
    "," +
    c[2] +
    "," +
    (a === undefined ? 1 : a) +
    ")";

  function palette(d) {
    let i = 0;
    while (i < PAL.length - 2 && d > PAL[i + 1].t) i++;
    const A = PAL[i];
    const B = PAL[i + 1];
    const t = clamp((d - A.t) / (B.t - A.t), 0, 1);
    return {
      top: mixc(A.top, B.top, t),
      mid: mixc(A.mid, B.mid, t),
      hor: mixc(A.hor, B.hor, t),
      seaA: mixc(A.seaA, B.seaA, t),
      seaB: mixc(A.seaB, B.seaB, t),
      hillA: mixc(A.hillA, B.hillA, t),
      hillB: mixc(A.hillB, B.hillB, t),
      sun: mixc(A.sun, B.sun, t),
    };
  }

  /* ---------------------------------------------------------- drawing */

  function ridgeVal(u) {
    return (
      Math.sin(u * 0.0016 + 1.3) * 0.55 +
      Math.sin(u * 0.0043 + 4.1) * 0.3 +
      Math.sin(u * 0.011 + 2.2) * 0.15
    );
  }

  function drawHills(par, baseY, amp, col) {
    g.beginPath();
    g.moveTo(-4, chh);
    const step = 22 * S;
    for (let px = -step; px <= cw + step; px += step) {
      const u = px / S + camX * par;
      const y = (baseY - ((ridgeVal(u) + 1) / 2) * amp) * S;
      g.lineTo(px, y);
    }
    g.lineTo(cw + 4, chh);
    g.closePath();
    g.fillStyle = css(col);
    g.fill();
  }

  function drawSky(p) {
    const wy = WATER_Y * S;
    const grad = g.createLinearGradient(0, 0, 0, wy);
    grad.addColorStop(0, css(p.top));
    grad.addColorStop(0.62, css(p.mid));
    grad.addColorStop(1, css(p.hor));
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, wy);

    const sa = clamp((dusk - 0.5) / 0.45, 0, 1);
    if (sa > 0) {
      for (const st of STARS) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(T * st.tw));
        g.fillStyle = "rgba(240,236,225," + (sa * tw * 0.8).toFixed(3) + ")";
        g.fillRect(st.ux * cw, st.uy * chh, st.r, st.r);
      }
    }

    const sunX = cw * 0.72 - camX * 0.025 * S;
    const sunY = wy - 40 * S + dusk * 130 * S;
    const glow = g.createRadialGradient(sunX, sunY, 4, sunX, sunY, 190 * S);
    glow.addColorStop(0, css(p.sun, 0.5));
    glow.addColorStop(1, css(p.sun, 0));
    g.fillStyle = glow;
    g.fillRect(sunX - 200 * S, sunY - 200 * S, 400 * S, 400 * S);
    g.fillStyle = css(p.sun, 0.9);
    g.beginPath();
    g.arc(sunX, sunY, 40 * S, 0, TAU);
    g.fill();

    for (const cl of CLOUDS) {
      const span = cw + 420;
      let px = (((cl.u - camX * cl.sp) % span) + span) % span;
      px -= 210;
      const py = cl.y * S;
      g.fillStyle = css(p.hor, 0.09);
      const w = 130 * cl.s * S;
      const h = 16 * cl.s * S;
      g.beginPath();
      g.ellipse(px, py, w, h, 0, 0, TAU);
      g.ellipse(px + w * 0.5, py + 4 * S, w * 0.7, h * 0.8, 0, 0, TAU);
      g.ellipse(px - w * 0.55, py + 5 * S, w * 0.6, h * 0.7, 0, 0, TAU);
      g.fill();
    }

    drawHills(0.14, WATER_Y - 58, 66, p.hillA);
    drawHills(0.3, WATER_Y - 20, 44, p.hillB);

    const sg = g.createLinearGradient(0, wy, 0, chh);
    sg.addColorStop(0, css(p.seaA));
    sg.addColorStop(1, css(p.seaB));
    g.fillStyle = sg;
    g.fillRect(0, wy, cw, chh - wy);

    const rowH = (LH - WATER_Y) / 11;
    const gx = cw * 0.72 - camX * 0.025 * S;
    for (let r = 0; r < 11; r++) {
      const yy = (WATER_Y + 5 + r * rowH) * S;
      const gap = (86 + r * 16) * S;
      const len = (24 + r * 6) * S;
      const off =
        ((((0 - camX * 0.5 * S) % gap) + gap) % gap) +
        Math.sin(T * 0.8 + r * 1.7) * (6 + r * 2) * S;
      g.fillStyle = css(p.hor, 0.13 - r * 0.009);
      for (let px = off; px < cw; px += gap) g.fillRect(px, yy, len, 1.4 * S);
      g.fillStyle = css(p.sun, 0.1 - r * 0.007);
      for (
        let px = gx + Math.sin(T * 1.3 + r) * 26 * S;
        px < gx + 90 * S;
        px += 26 * S
      )
        g.fillRect(px, yy, 12 * S, 1.4 * S);
    }
  }

  function drawWorld() {
    const shx = (Math.random() * 2 - 1) * shake;
    const shy = (Math.random() * 2 - 1) * shake;
    g.setTransform(
      DPR * S,
      0,
      0,
      DPR * S,
      (-camX + shx) * DPR * S,
      shy * DPR * S,
    );

    const left = camX - 60;
    const right = camX + VIEWW + 60;
    const warm = css(paletteCache.sun, 0.5);

    for (const s of world.solids) {
      if (s.kind !== "post") continue;
      if (s.x + s.w < left || s.x > right) continue;
      g.fillStyle = "#0b0e17";
      g.fillRect(s.x, s.y, s.w, s.h + 26);
      g.fillStyle = warm;
      g.fillRect(s.x + s.w - 2.4, s.y, 2.4, s.h);
      g.fillStyle = "rgba(210,200,185,0.14)";
      g.fillRect(s.x - 1, WATER_Y - 12, s.w + 2, 5);
      g.fillStyle = "rgba(6,8,14,0.35)";
      g.fillRect(s.x, WATER_Y + 4, s.w, 30);
    }
    for (const s of world.solids) {
      if (s.kind !== "beam") continue;
      if (s.x + s.w < left || s.x > right) continue;
      g.fillStyle = "#0b0e17";
      g.fillRect(s.x, -20, s.w, s.h + 20);
      g.fillStyle = warm;
      g.fillRect(s.x, s.h - 3, s.w, 2.6);
      if (s.lamp) {
        const lx = s.x + s.w / 2;
        const ly = s.h + 10;
        const fl = 0.75 + 0.25 * Math.sin(T * 7 + s.x);
        const gl = g.createRadialGradient(lx, ly, 1, lx, ly, 30);
        gl.addColorStop(0, "rgba(255,196,110," + 0.5 * fl + ")");
        gl.addColorStop(1, "rgba(255,196,110,0)");
        g.fillStyle = gl;
        g.fillRect(lx - 32, ly - 32, 64, 64);
        g.fillStyle = "#ffd9a0";
        g.beginPath();
        g.arc(lx, ly, 3.4, 0, TAU);
        g.fill();
      }
    }

    for (const gt of world.gates) {
      if (gt.x < left - 40 || gt.x > right + 40) continue;
      const col =
        gt.st === 1
          ? "rgba(127,216,160,"
          : gt.st === 2
            ? "rgba(150,80,72,"
            : "rgba(255,184,107,";
      const pulse = gt.st === 0 ? 0.55 + 0.45 * Math.sin(T * 3 + gt.x) : 0.5;
      g.strokeStyle = col + "0.16)";
      g.setLineDash([5, 9]);
      g.beginPath();
      g.moveTo(gt.x, gt.top);
      g.lineTo(gt.x, gt.bot);
      g.stroke();
      g.setLineDash([]);
      for (const ly of [gt.top, gt.bot]) {
        const gl = g.createRadialGradient(gt.x, ly, 1, gt.x, ly, 26);
        gl.addColorStop(0, col + 0.55 * pulse + ")");
        gl.addColorStop(1, col + "0)");
        g.fillStyle = gl;
        g.fillRect(gt.x - 28, ly - 28, 56, 56);
        g.fillStyle = col + "0.95)";
        g.beginPath();
        g.arc(gt.x, ly, 4.4, 0, TAU);
        g.fill();
      }
    }

    const rx = world.roostX;
    if (rx < right + 200) {
      g.fillStyle = "#0a0d15";
      g.fillRect(rx, DECK_Y, world.len - rx + 320, 16);
      g.strokeStyle = "#0a0d15";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(rx, DECK_Y - 24);
      g.lineTo(world.len + 260, DECK_Y - 24);
      g.stroke();
      g.lineWidth = 1;
      for (let px = rx + 10; px < world.len + 240; px += 42) {
        g.beginPath();
        g.moveTo(px, DECK_Y - 24);
        g.lineTo(px, DECK_Y);
        g.stroke();
      }
      for (let px = rx + 30; px < world.len + 240; px += 84) {
        g.fillStyle = "#0a0d15";
        g.fillRect(px, DECK_Y + 14, 10, WATER_Y - DECK_Y + 20);
      }
      const cav = g.createLinearGradient(0, DECK_Y + 14, 0, DECK_Y + 52);
      cav.addColorStop(0, "rgba(255,170,90,0.22)");
      cav.addColorStop(1, "rgba(255,170,90,0)");
      g.fillStyle = cav;
      g.fillRect(rx, DECK_Y + 14, world.len - rx + 260, 40);
      for (const lx of [rx + 46, rx + 190]) {
        g.fillStyle = "#0a0d15";
        g.fillRect(lx - 2, DECK_Y - 40, 4, 42);
        const fl = 0.7 + 0.3 * Math.sin(T * 6 + lx);
        const gl = g.createRadialGradient(
          lx,
          DECK_Y - 44,
          1,
          lx,
          DECK_Y - 44,
          64,
        );
        gl.addColorStop(0, "rgba(255,200,120," + 0.55 * fl + ")");
        gl.addColorStop(1, "rgba(255,200,120,0)");
        g.fillStyle = gl;
        g.fillRect(lx - 66, DECK_Y - 110, 132, 132);
        g.fillStyle = "#ffe2ae";
        g.beginPath();
        g.arc(lx, DECK_Y - 44, 4.6, 0, TAU);
        g.fill();
      }
    }

    g.strokeStyle = "rgba(235,225,205,0.09)";
    g.lineWidth = 1.6;
    for (const st of streaks) {
      g.globalAlpha = Math.min(1, st.life * 2.4);
      g.beginPath();
      g.moveTo(st.x, st.y);
      g.lineTo(st.x + st.len, st.y);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 1;
  }

  function drawBirds() {
    g.lineCap = "round";
    g.strokeStyle = "#0d1019";
    g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i < bn; i++) {
      if (bdead[i] || balpha[i] <= 0.02) continue;
      const sp = Math.hypot(bvx[i], bvy[i]) || 1;
      const ca = bvx[i] / sp;
      const sa = bvy[i] / sp;
      const flap = bglide[i] > 0 ? 0.6 : Math.sin(bph[i]) * 4.4;
      const hx = bx[i] + ca * 3.4;
      const hy = by[i] + sa * 3.4;
      const wx = -sa * flap;
      const wy = ca * flap;
      g.moveTo(hx - ca * 8, hy - sa * 8);
      g.lineTo(hx + wx * 0.4, hy + wy * 0.4);
      g.lineTo(hx - ca * 4.2 + wx, hy - sa * 4.2 + wy);
      g.moveTo(hx + wx * 0.4, hy + wy * 0.4);
      g.lineTo(hx + ca * 4.2 + wx, hy + sa * 4.2 + wy);
    }
    g.stroke();

    if (!leader.settled) {
      const sp = Math.hypot(leader.vx, leader.vy) || 1;
      const ca = leader.vx / sp;
      const sa = leader.vy / sp;
      const flap = Math.sin(T * 9) * 5;
      const lx = leader.x;
      const ly = leader.y;
      g.strokeStyle = "#ffe9c4";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(lx - ca * 6, ly - sa * 6);
      g.lineTo(lx + ca * 4 - sa * flap * 0.4, ly + sa * 4 + ca * flap * 0.4);
      g.lineTo(lx - ca * 4.6 - sa * flap, ly - sa * 4.6 + ca * flap);
      g.moveTo(lx + ca * 4 - sa * flap * 0.4, ly + sa * 4 + ca * flap * 0.4);
      g.lineTo(lx - ca * 4.6 + sa * flap, ly - sa * 4.6 - ca * flap);
      g.stroke();
      g.fillStyle = "rgba(255,233,196,0.24)";
      g.beginPath();
      g.arc(lx, ly, 9, 0, TAU);
      g.fill();
      g.lineWidth = 1;
    }
  }

  function drawFalcon() {
    const F = falcon;
    if (F.state === "off") return;
    const ang = Math.atan2(F.vy, F.vx);
    g.save();
    g.translate(F.x, F.y);
    g.rotate(ang);
    const stooping = F.state === "stoop";
    const flap = stooping ? 0.15 : Math.sin(T * 13) * 0.8;
    g.fillStyle = "#120d09";
    g.beginPath();
    g.moveTo(-14, -1.6);
    g.quadraticCurveTo(-4, -5.4, 9, 0);
    g.quadraticCurveTo(-4, 5.4, -14, 1.6);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(1, 0);
    g.lineTo(-9, -15 * (0.4 + flap * 0.6) - 6);
    g.lineTo(-15, -3);
    g.lineTo(-9, 15 * (0.4 + flap * 0.6) + 6);
    g.lineTo(-15, 3);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,157,92,0.4)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-13, -1.4);
    g.quadraticCurveTo(-4, -4.6, 8, -0.4);
    g.stroke();
    g.restore();
    g.lineWidth = 1;

    if (F.state === "circle" || F.state === "stoop") {
      const sxp = (F.x - camX) * S;
      const syp = F.y * S;
      if (sxp < 0 || sxp > cw || syp < 0) {
        const ex = clamp(sxp, 26, cw - 26);
        const ey = clamp(syp, 26, chh - 26);
        const a = 0.4 + 0.4 * Math.sin(T * 6);
        g.save();
        g.setTransform(DPR, 0, 0, DPR, 0, 0);
        g.translate(ex, ey);
        g.rotate(Math.atan2(chh / 2 - ey, cw / 2 - ex));
        g.fillStyle = "rgba(255,110,80," + a.toFixed(3) + ")";
        g.beginPath();
        g.moveTo(10, 0);
        g.lineTo(-7, -7);
        g.lineTo(-7, 7);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
  }

  function drawFx() {
    g.strokeStyle = "rgba(235,225,210,0.75)";
    g.lineWidth = 1.4;
    for (const f of feathers) {
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.rot);
      g.globalAlpha = clamp(f.life, 0, 1);
      g.beginPath();
      g.arc(0, 0, 2.6, 0.4, 2.6);
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
    for (const r of rings) {
      g.strokeStyle = "rgba(255,220,160," + Math.max(0, r.a).toFixed(3) + ")";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, TAU);
      g.stroke();
    }
    g.lineWidth = 1;
    g.fillStyle = "rgba(220,230,240,0.7)";
    for (const sp of splashes) g.fillRect(sp.x, sp.y, 2, 2);
  }

  let paletteCache = null;
  function render() {
    paletteCache = palette(state === "title" ? 0.3 : dusk);
    const p = paletteCache;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky(p);
    drawWorld();
    drawFx();
    drawBirds();
    drawFalcon();
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = "rgba(3,5,14," + (dusk * 0.3).toFixed(3) + ")";
    g.fillRect(0, 0, cw, chh);
    const vg = g.createRadialGradient(
      cw / 2,
      chh / 2,
      Math.min(cw, chh) * 0.36,
      cw / 2,
      chh / 2,
      Math.max(cw, chh) * 0.75,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0," + (0.26 + dusk * 0.22).toFixed(3) + ")");
    g.fillStyle = vg;
    g.fillRect(0, 0, cw, chh);
  }

  /* ----------------------------------------------------------- input */

  const keys = new Set();
  const ptr = { active: false, wx: 0, wy: 0 };

  function setPtr(e) {
    ptr.wx = camX + e.clientX / S;
    ptr.wy = e.clientY / S;
  }

  cv.addEventListener("pointerdown", (e) => {
    AU.init();
    AU.resume();
    if (state === "fly" && !paused && !settle) {
      ptr.active = true;
      setPtr(e);
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (err) {
        /* some browsers grumble; steering still works */
      }
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (ptr.active) setPtr(e);
  });
  window.addEventListener("pointerup", () => {
    ptr.active = false;
  });
  window.addEventListener("pointercancel", () => {
    ptr.active = false;
  });

  function primaryAction() {
    for (const k in CARDS) {
      if (!CARDS[k].hidden) {
        const b = CARDS[k].querySelector("button.primary");
        if (b) b.click();
        return;
      }
    }
  }

  window.addEventListener("keydown", (e) => {
    const code = e.code;
    if (
      state === "fly" &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(
        code,
      )
    )
      e.preventDefault();
    AU.init();
    AU.resume();
    if (code === "KeyM") {
      toggleMute();
      return;
    }
    if (code === "KeyR") {
      restartRun();
      return;
    }
    if (code === "KeyP" || code === "Escape") {
      togglePause();
      return;
    }
    if (e.repeat) return;
    keys.add(code);
    if (code === "Space" || code === "Enter") {
      if (state === "fly" && !paused) pulse();
      else primaryAction();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => {
    keys.clear();
    ptr.active = false;
  });

  function wire(btn, fn) {
    btn.addEventListener("click", () => {
      AU.init();
      AU.resume();
      fn();
      btn.blur();
    });
  }
  wire($("btnStart"), startRun);
  wire($("btnBegin"), beginFly);
  wire($("btnNext"), () => startLeg(legIdx + 1, run.carry));
  wire($("btnAgain"), startRun);
  wire($("btnFly"), startRun);
  wire($("btnResume"), () => togglePause(false));
  wire($("btnQuit"), toTitle);
  wire(btnPause, () => togglePause());
  wire(btnMute, toggleMute);
  wire(btnRestart, restartRun);
  wire(btnPulse, pulse);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "fly" && !paused && !settle)
      togglePause(true);
  });

  /* ------------------------------------------------------------ boot */

  resize();
  toTitle();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (!paused) {
      if (state === "fly") update(dt);
      else ambient(dt);
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
