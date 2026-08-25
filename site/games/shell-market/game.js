/* Shell Market — a hermit-crab housing ladder on a moonlit tidal flat.
   Claim washed-up shells to climb the size ladder, but every claim means a
   naked dash between homes while rival crabs race you down the vacancy chain
   and a gull hunts whatever is soft. Six surging tides, then dawn scores you. */

(() => {
  "use strict";

  /* ---------- dom ---------- */

  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const elHearts = $("hearts");
  const elCardName = $("card-name");
  const elCardMeta = $("card-meta");
  const elCardFill = $("card-fill");
  const elCycle = $("cyclelabel");
  const elMoons = $("moons");
  const elTideFill = $("tidefill");
  const elToasts = $("toasts");
  const ovIntro = $("intro");
  const ovPaused = $("paused");
  const ovDawn = $("dawn");

  /* ---------- constants ---------- */

  const W = 960;
  const H = 600;
  const HORIZON = 148;
  const REST_EDGE = 182;
  const SURGE_EDGE = 340;
  const CYCLES = 6;
  const CALM_T = 11.5;
  const SURGE_T = 4.6;
  const CYCLE_T = CALM_T + SURGE_T;
  const SWAP_DUR = 0.9;
  const FUMBLE_T = 0.65;
  const EXPOSE_AT = 0.55;
  const STRIKE_AFTER = 0.7;
  const PLAYER_SPEED = 158;
  const SPECIES = [
    { max: 2, key: "peri", name: "Periwinkle" },
    { max: 4, key: "limpet", name: "Limpet" },
    { max: 6, key: "top", name: "Top Shell" },
    { max: 8, key: "whelk", name: "Whelk" },
    { max: 99, key: "great", name: "Great Whelk" },
  ];
  const NPC_DEFS = [
    { name: "Pincer", hue: "#a8523e", size: 2 },
    { name: "Barnaby", hue: "#8f6b3f", size: 3 },
    { name: "Sidle", hue: "#9c4f63", size: 3 },
    { name: "Clawdia", hue: "#5f7d5a", size: 4 },
  ];

  /* ---------- helpers ---------- */

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => Math.floor(rnd(a, b + 1));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const smooth = (u) => u * u * (3 - 2 * u);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const condWord = (integ) =>
    integ < 38
      ? "Cracked"
      : integ < 62
        ? "Worn"
        : integ < 84
          ? "Sound"
          : "Gleaming";
  const speciesOf = (size) => SPECIES.find((s) => size <= s.max);
  const shellName = (sh) => `${condWord(sh.integ)} ${speciesOf(sh.size).name}`;
  const shellValue = (sh) => sh.size * 100 + sh.integ * 2;

  /* ---------- audio ---------- */

  let AC = null;
  let master = null;
  let muted = false;

  function ensureAudio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(AC.destination);
      } catch (e) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
  }

  function tone(f0, f1, dur, type, vol, when) {
    if (!AC || muted) return;
    const t0 = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, freq, vol, slideTo) {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const len = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    f.Q.value = 0.8;
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const sfx = {
    ui: () => tone(520, 480, 0.07, "triangle", 0.12),
    claim: () => {
      tone(620, 620, 0.1, "triangle", 0.16);
      tone(930, 930, 0.14, "triangle", 0.13, 0.07);
    },
    fumble: () => tone(120, 82, 0.12, "square", 0.1),
    pop: () => tone(300, 190, 0.08, "sine", 0.1),
    wave: () => noiseBurst(1.6, 420, 0.16, 900),
    dragOut: () => {
      noiseBurst(0.3, 700, 0.14, 240);
      tone(320, 130, 0.28, "sine", 0.08);
    },
    cry: () => {
      tone(1350, 720, 0.22, "sawtooth", 0.07);
      tone(1250, 640, 0.26, "sawtooth", 0.06, 0.16);
    },
    hit: () => {
      noiseBurst(0.22, 500, 0.22, 160);
      tone(280, 80, 0.3, "sawtooth", 0.14);
    },
    chain: () => {
      [660, 830, 1050].forEach((f, i) =>
        tone(f, f, 0.12, "triangle", 0.11, i * 0.07),
      );
    },
    fanfare: () => {
      [392, 494, 587, 784].forEach((f, i) =>
        tone(f, f, 0.22, "triangle", 0.12, i * 0.12),
      );
    },
    grief: () => {
      tone(220, 208, 0.5, "triangle", 0.13);
      tone(233, 218, 0.5, "triangle", 0.1, 0.02);
    },
  };

  /* ---------- world state ---------- */

  let G = null;
  let uid = 1;

  function makeShell(x, y, size, integ, owner) {
    return {
      id: uid++,
      x,
      y,
      size,
      integ,
      species: speciesOf(size).key,
      seed: Math.random(),
      hue: rnd(14, 48),
      vacant: !owner,
      owner: owner || null,
      reservedBy: null,
      bornAt: G ? G.t : 0,
      freshUntil: G ? G.t + 3 : 3,
      vacatedAt: -1,
      gone: false,
    };
  }

  function makeCrab(isPlayer, name, hue, x, y, body, home) {
    return {
      id: uid++,
      isPlayer,
      name,
      hue,
      x,
      y,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: isPlayer ? PLAYER_SPEED : rnd(58, 96),
      body,
      home: home || null,
      alive: true,
      state: "idle",
      tx: x,
      ty: y,
      pendingShell: null,
      swapFrom: null,
      swapTo: null,
      swapT: 0,
      stunT: 0,
      invulnT: 0,
      exposedT: 0,
      think: rnd(0.4, 1.4),
      eyeT: 0,
      hits: 0,
      hearts: 3,
      bubble: "",
      bubbleT: 0,
      legPhase: Math.random() * 6,
      moving: false,
    };
  }

  function resetWorld() {
    uid = 1;
    G = {
      phase: "intro",
      t: 0,
      cycle: 1,
      cycleT: 0,
      surgedSpawned: false,
      surgePeakDone: false,
      maxReach: REST_EDGE,
      shells: [],
      crabs: [],
      particles: [],
      floaters: [],
      gull: {
        mode: "away",
        x: -90,
        y: 108,
        cd: 6,
        vx: 46,
        tx: 0,
        ty: 0,
        target: null,
        timer: 0,
        wing: 0,
        alt: 150,
      },
      chainLen: 0,
      bestChain: 0,
      shake: 0,
      flash: 0,
      stars: [],
      speckles: [],
      pebbles: [],
      weeds: [],
    };
    for (let i = 0; i < 74; i++)
      G.stars.push({
        x: Math.random() * W,
        y: Math.random() * (HORIZON - 12),
        r: rnd(0.4, 1.5),
        tw: rnd(0, 6),
      });
    for (let i = 0; i < 150; i++)
      G.speckles.push({
        x: Math.random() * W,
        y: rnd(HORIZON + 40, H),
        a: rnd(0.04, 0.16),
      });
    for (let i = 0; i < 12; i++)
      G.pebbles.push({
        x: Math.random() * W,
        y: rnd(HORIZON + 60, H - 8),
        r: rnd(2, 5),
        shade: rnd(0.1, 0.3),
      });
    for (let i = 0; i < 7; i++)
      G.weeds.push({
        x: Math.random() * W,
        y: rnd(HORIZON + 46, H - 14),
        s: rnd(0.7, 1.4),
        sway: rnd(0, 6),
      });

    // starter homes
    const starter = makeShell(480, 476, 2, 72);
    starter.freshUntil = 0;
    G.shells.push(starter);
    const player = makeCrab(true, "You", "#e06a4a", 480, 470, 2, starter);
    G.crabs.push(player);
    starter.owner = player;
    starter.vacant = false;
    const spots = [
      [140, 430],
      [800, 450],
      [250, 540],
      [700, 545],
    ];
    NPC_DEFS.forEach((def, i) => {
      const home = makeShell(spots[i][0], spots[i][1], def.size, irnd(55, 92));
      home.freshUntil = 0;
      G.shells.push(home);
      const npc = makeCrab(
        false,
        def.name,
        def.hue,
        spots[i][0],
        spots[i][1],
        def.size,
        home,
      );
      home.owner = npc;
      home.vacant = false;
      G.crabs.push(npc);
    });

    // loose litter to open the market
    for (let i = 0; i < 8; i++) {
      const size = irnd(1, 4);
      G.shells.push(
        makeShell(
          rnd(50, W - 50),
          rnd(REST_EDGE + 22, 380),
          size,
          irnd(42, 96),
        ),
      );
    }
    const boost = makeShell(620, 330, 4, 88);
    G.shells.push(boost);
  }

  /* ---------- toasts & floaters ---------- */

  function toast(text, kind) {
    const div = document.createElement("div");
    div.className = "toast" + (kind ? " " + kind : "");
    div.textContent = text;
    elToasts.appendChild(div);
    while (elToasts.children.length > 3)
      elToasts.removeChild(elToasts.firstChild);
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 2400);
  }

  function floater(x, y, text, color) {
    G.floaters.push({ x, y, text, color: color || "#ffe9bd", t: 0 });
  }

  function puff(x, y, type, n) {
    for (let i = 0; i < (n || 6); i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(14, 60);
      G.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy:
          Math.sin(a) * sp -
          (type === "splash" ? 60 : type === "spark" ? 40 : 8),
        life: rnd(0.4, type === "foam" ? 1.4 : 0.9),
        t: 0,
        type,
      });
    }
  }

  /* ---------- tide ---------- */

  function surgeProfile(u) {
    if (u < 0.32) return smooth(u / 0.32);
    if (u < 0.56) return 1;
    return 1 - smooth(clamp((u - 0.56) / 0.44, 0, 1));
  }

  function edgeAt() {
    const breathing = Math.sin(G.t * 0.8) * 4;
    if (G.cycleT <= CALM_T) return REST_EDGE + breathing;
    const u = (G.cycleT - CALM_T) / SURGE_T;
    return (
      REST_EDGE + (SURGE_EDGE - REST_EDGE) * surgeProfile(u) + breathing * 0.4
    );
  }

  function spawnWave() {
    const n = Math.min(3 + Math.ceil(G.cycle * 0.8), 7);
    const player = G.crabs[0];
    let boosted = false;
    for (let i = 0; i < n; i++) {
      let size = clamp(1 + Math.floor(G.cycle * 1.05) + irnd(-1, 2), 1, 10);
      if (i === 0 && player.body < 9)
        size = clamp(player.body + irnd(1, 2), 1, 10);
      if (size >= player.body + 1) boosted = true;
      const y = rnd(REST_EDGE + 16, Math.max(REST_EDGE + 40, G.maxReach - 8));
      let x = rnd(46, W - 46);
      for (let tries = 0; tries < 8; tries++) {
        if (!G.shells.some((sh) => !sh.gone && dist(sh.x, sh.y, x, y) < 44))
          break;
        x = rnd(46, W - 46);
      }
      G.shells.push(makeShell(x, y, size, irnd(38, 98)));
    }
    if (!boosted && player.body < 9) {
      G.shells.push(
        makeShell(
          rnd(60, W - 60),
          rnd(REST_EDGE + 16, Math.max(REST_EDGE + 40, G.maxReach - 8)),
          player.body + 1,
          irnd(55, 92),
        ),
      );
    }
    // keep the beach readable
    const live = G.shells.filter((sh) => !sh.gone);
    if (live.length > 17) {
      const junk = live
        .filter((sh) => sh.vacant && !sh.reservedBy)
        .sort((a, b) => shellValue(a) - shellValue(b))[0];
      if (junk) junk.gone = true;
    }
  }

  function updateTide(dt) {
    G.cycleT += dt;
    const edge = edgeAt();
    G.maxReach = Math.max(G.maxReach, edge);

    const u = clamp((G.cycleT - CALM_T) / SURGE_T, 0, 1);

    if (G.cycleT > CALM_T && u > 0.36 && !G.surgedSpawned) {
      G.surgedSpawned = true;
      spawnWave();
      sfx.wave();
      toast("The tide brings…");
    }
    if (G.cycleT > CALM_T && u > 0.94 && !G.surgePeakDone) {
      G.surgePeakDone = true;
      // the retreating water pulls light unclaimed shells home
      G.shells.forEach((sh) => {
        if (sh.gone || !sh.vacant || sh.reservedBy) return;
        if (sh.y < edge + 6 && sh.size <= 3 && Math.random() < 0.3) {
          sh.gone = true;
          puff(sh.x, sh.y, "splash", 8);
          floater(sh.x, sh.y - 8, "taken by the sea", "#9fd6ea");
          sfx.dragOut();
        }
      });
    }

    // shove anything sitting in the water
    G.crabs.forEach((c) => {
      if (!c.alive) return;
      if (c.y < edge + 8) {
        c.y += 96 * dt;
        c.x += Math.sin(G.t * 7 + c.id) * 22 * dt;
        if (c.state === "swap") cancelSwap(c);
        if (c.pendingShell && c.pendingShell.gone) c.pendingShell = null;
        if (c.state === "walk") {
          c.ty += 96 * dt;
          c.state = "idle";
        }
      }
    });

    // foam along the edge
    if (G.cycleT > CALM_T && Math.random() < dt * 30) {
      G.particles.push({
        x: rnd(0, W),
        y: edge + rnd(-3, 3),
        vx: rnd(-8, 8),
        vy: rnd(4, 22),
        life: rnd(0.5, 1.1),
        t: 0,
        type: "foam",
      });
    }

    if (G.cycleT >= CYCLE_T) {
      G.cycle++;
      G.cycleT = 0;
      G.surgedSpawned = false;
      G.surgePeakDone = false;
      G.maxReach = REST_EDGE;
      if (G.cycle > CYCLES) {
        endNight(true);
      } else {
        toast(`Tide ${G.cycle} of ${CYCLES}`);
      }
    }
    return edge;
  }

  /* ---------- claims, swaps, chains ---------- */

  function movers() {
    return G.crabs.filter(
      (c) =>
        c.alive && !c.isPlayer && (c.state === "transit" || c.state === "swap"),
    ).length;
  }

  function fitsBody(crab, size) {
    return size >= crab.body - 1 && size <= crab.body + 2;
  }

  function beginSwap(c, sh) {
    c.state = "swap";
    c.swapFrom = c.home;
    c.swapTo = sh;
    c.swapT = 0;
    sh.reservedBy = c;
    sfx.pop();
  }

  function cancelSwap(c) {
    if (c.state !== "swap") return;
    if (c.swapTo) c.swapTo.reservedBy = null;
    c.swapTo = null;
    c.swapFrom = null;
    c.state = "stun";
    c.stunT = 0.5;
    c.bubble = "!";
    c.bubbleT = 0.8;
  }

  function finishSwap(c) {
    const from = c.swapFrom;
    const to = c.swapTo;
    c.swapFrom = null;
    c.swapTo = null;
    if (from) {
      from.owner = null;
      from.vacant = true;
      from.vacatedAt = G.t;
      puff(from.x, from.y, "sand", 4);
    }
    to.owner = c;
    to.vacant = false;
    to.reservedBy = null;
    to.freshUntil = 0;
    if (to.vacatedAt >= 0 && G.t - to.vacatedAt < 5.5) G.chainLen++;
    else G.chainLen = 1;
    G.bestChain = Math.max(G.bestChain, G.chainLen);
    if (G.chainLen >= 2) {
      toast(`VACANCY CHAIN ×${G.chainLen}`, "chain");
      sfx.chain();
    }
    c.body = c.body + (to.size - c.body) * 0.35;
    c.x = to.x;
    c.y = to.y + 2;
    c.home = to;
    c.state = "idle";
    c.exposedT = 0;
    puff(to.x, to.y, "spark", 7);
    if (c.isPlayer) {
      to.integ = Math.max(15, to.integ - 4);
      sfx.claim();
      floater(
        to.x,
        to.y - 16,
        `${condWord(to.integ)} ${speciesOf(to.size).name}`,
        "#ffd98a",
      );
      updateCard();
    } else if (Math.random() < 0.6) {
      floater(to.x, to.y - 14, `${c.name} trades up`, "#d8cdb4");
    }
  }

  function fumble(c, msg) {
    c.state = "stun";
    c.stunT = FUMBLE_T;
    c.bubble = "?!";
    c.bubbleT = 0.8;
    if (c.isPlayer) {
      floater(c.x, c.y - 20, msg, "#ffb3a6");
      sfx.fumble();
    }
  }

  function attempt(c, sh) {
    if (!sh || sh.gone) {
      if (c.isPlayer) toast("The sea took it", "bad");
      return;
    }
    if (!sh.vacant) {
      if (c.isPlayer) toast(`${shellName(sh)} is taken`, "bad");
      return;
    }
    if (dist(c.x, c.y, sh.x, sh.y) > 54) {
      c.tx = sh.x;
      c.ty = sh.y;
      c.pendingShell = sh;
      c.state = "walk";
      return;
    }
    if (c.home) {
      if (sh.size < c.body - 1) {
        fumble(c, "too small!");
        return;
      }
      if (sh.size > c.body + 2) {
        fumble(c, "too grand to lift");
        return;
      }
    } else if (sh.size > c.body + 3) {
      fumble(c, "any port… but not that one");
      return;
    }
    beginSwap(c, sh);
  }

  /* ---------- npc minds ---------- */

  function updateNpc(c, dt) {
    if (c.bubbleT > 0) c.bubbleT -= dt;
    switch (c.state) {
      case "idle": {
        c.think -= dt;
        if (Math.random() < dt * 0.25) {
          c.dir = Math.random() < 0.5 ? -1 : 1;
          c.x = clamp(c.x + c.dir * 12 * dt * 10, 30, W - 30);
          c.moving = true;
        } else c.moving = false;
        if (c.think <= 0) {
          c.think = rnd(0.8, 1.7);
          if (!c.home) {
            const sh = nearestUrgent(c);
            if (sh) reserveAndGo(c, sh);
          } else if (movers() < 2 && Math.random() < 0.8) {
            const cur = shellValue(c.home);
            let best = null;
            let bd = Infinity;
            for (const sh of G.shells) {
              if (sh.gone || !sh.vacant) continue;
              if (sh.reservedBy && sh.reservedBy !== c) continue;
              if (!fitsBody(c, sh.size)) continue;
              const v = shellValue(sh);
              if (v > cur + 55 && dist(c.x, c.y, sh.x, sh.y) < bd) {
                bd = dist(c.x, c.y, sh.x, sh.y);
                best = sh;
              }
            }
            if (best) {
              c.state = "eying";
              c.eyeT = rnd(0.5, 1.2);
              c.pendingShell = best;
              c.bubble = "?";
              c.bubbleT = c.eyeT;
            }
          }
        }
        break;
      }
      case "eying": {
        c.eyeT -= dt;
        if (c.eyeT <= 0) {
          const sh = c.pendingShell;
          if (
            sh &&
            !sh.gone &&
            sh.vacant &&
            !(sh.reservedBy && sh.reservedBy !== c)
          ) {
            sh.reservedBy = c;
            c.state = "transit";
            c.tx = sh.x;
            c.ty = sh.y;
            c.bubble = "";
          } else {
            c.state = "idle";
            c.pendingShell = null;
            c.bubble = "?!";
            c.bubbleT = 0.7;
          }
        }
        break;
      }
      case "transit": {
        const sh = c.pendingShell;
        if (!sh || sh.gone) {
          c.state = "idle";
          c.pendingShell = null;
          break;
        }
        c.tx = sh.x;
        c.ty = sh.y;
        stepToward(c, dt, c.speed * (c.home ? 1 : 1.4));
        if (dist(c.x, c.y, sh.x, sh.y) < 12) {
          if (sh.vacant && (!sh.reservedBy || sh.reservedBy === c)) {
            beginSwap(c, sh);
          } else {
            if (sh.reservedBy === c) sh.reservedBy = null;
            c.state = "idle";
            c.pendingShell = null;
            c.bubble = "?!";
            c.bubbleT = 0.7;
          }
        }
        break;
      }
      case "swap": {
        c.swapT += dt;
        if (c.swapT >= SWAP_DUR) finishSwap(c);
        break;
      }
      case "stun": {
        c.stunT -= dt;
        if (c.stunT <= 0) c.state = "idle";
        break;
      }
      default:
        c.state = "idle";
    }
  }

  function nearestUrgent(c) {
    let best = null;
    let bd = Infinity;
    for (const sh of G.shells) {
      if (sh.gone || !sh.vacant) continue;
      if (sh.reservedBy && sh.reservedBy !== c) continue;
      if (sh.size > c.body + 3 || sh.size < c.body - 2) continue;
      const d = dist(c.x, c.y, sh.x, sh.y);
      if (d < bd) {
        bd = d;
        best = sh;
      }
    }
    return best;
  }

  function reserveAndGo(c, sh) {
    sh.reservedBy = c;
    c.pendingShell = sh;
    c.state = "transit";
    c.tx = sh.x;
    c.ty = sh.y;
  }

  function stepToward(c, dt, speed) {
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      c.moving = false;
      return;
    }
    const k = Math.min(1, (speed * dt) / d);
    c.x += dx * k;
    c.y += dy * k;
    if (Math.abs(dx) > 2) c.dir = dx > 0 ? 1 : -1;
    c.moving = true;
  }

  /* ---------- gull ---------- */

  function updateGull(dt) {
    const g = G.gull;
    g.wing += dt * (g.mode === "dive" ? 24 : 9);
    switch (g.mode) {
      case "away": {
        g.cd -= dt;
        if (g.cd <= 0) {
          g.mode = "hover";
          const fromLeft = Math.random() < 0.5;
          g.x = fromLeft ? -60 : W + 60;
          g.vx = (fromLeft ? 1 : -1) * rnd(38, 60);
          g.y = rnd(86, 118);
          g.alt = rnd(120, 165);
        }
        break;
      }
      case "hover": {
        g.x += g.vx * dt;
        g.y += Math.sin(g.wing * 0.6) * 12 * dt;
        if (g.x < -90 || g.x > W + 90) {
          g.mode = "away";
          g.cd = rnd(5, 10);
          break;
        }
        const victim = G.crabs.find(
          (c) =>
            c.alive &&
            (c.state === "swap" || !c.home) &&
            c.exposedT > EXPOSE_AT &&
            c.invulnT <= 0,
        );
        if (victim) {
          g.target = victim;
          g.timer = STRIKE_AFTER;
          g.mode = "aim";
          sfx.cry();
        }
        break;
      }
      case "aim": {
        const v = g.target;
        if (!v || !v.alive || v.invulnT > 0 || (v.home && v.state !== "swap")) {
          g.mode = "retreat";
          g.target = null;
          break;
        }
        g.tx = v.x;
        g.ty = v.y;
        g.timer -= dt;
        if (g.timer <= 0) g.mode = "dive";
        break;
      }
      case "dive": {
        const v = g.target;
        if (!v || !v.alive || v.invulnT > 0 || (v.home && v.state !== "swap")) {
          g.mode = "retreat";
          g.target = null;
          break;
        }
        g.tx = lerp(g.tx, v.x, Math.min(1, 4 * dt));
        g.ty = lerp(g.ty, v.y, Math.min(1, 4 * dt));
        g.alt = Math.max(0, g.alt - 340 * dt);
        const dx = g.tx - g.x;
        const dy = g.ty - g.alt - g.y;
        const d = Math.hypot(dx, dy);
        if (d < 16 || g.alt <= 2) {
          strike(v);
          g.mode = "retreat";
          g.target = null;
        } else {
          g.x += (dx / d) * 470 * dt;
          g.y += (dy / d) * 470 * dt;
        }
        break;
      }
      case "retreat":
      default: {
        g.alt = 150;
        g.y -= 210 * dt;
        if (g.y < -80) {
          g.mode = "away";
          g.cd = rnd(5.5, 11);
          g.x = -90;
        }
        break;
      }
    }
  }

  function strike(v) {
    if (v.home && v.state !== "swap") return; // slipped inside in time
    puff(v.x, v.y, "feather", 9);
    G.shake = 0.35;
    G.flash = 0.3;
    sfx.hit();
    if (v.isPlayer) {
      v.hearts--;
      v.stunT = 1.1;
      v.invulnT = 2.6;
      if (v.state === "swap") cancelSwap(v);
      floater(v.x, v.y - 24, "-♥", "#ff8a7a");
      updateHearts();
      if (v.hearts <= 0) {
        endNight(false);
        return;
      }
    } else {
      v.hits++;
      v.stunT = 0.9;
      v.invulnT = 2.4;
      if (v.state === "swap") cancelSwap(v);
      if (v.hits >= 2) {
        v.alive = false;
        if (v.home) {
          v.home.owner = null;
          v.home.vacant = true;
          v.home.vacatedAt = G.t;
        }
        toast(`${v.name} flees the flat`);
        floater(v.x, v.y - 20, "gone!", "#d8cdb4");
      } else {
        toast(`${v.name} felt the beak`);
      }
    }
  }

  /* ---------- player ---------- */

  const keys = Object.create(null);

  function updatePlayer(p, dt) {
    if (p.bubbleT > 0) p.bubbleT -= dt;
    if (p.invulnT > 0) p.invulnT -= dt;
    if (p.state === "stun") {
      p.stunT -= dt;
      p.moving = false;
      if (p.stunT <= 0) p.state = "idle";
      return;
    }
    if (p.state === "swap") {
      p.swapT += dt;
      p.moving = false;
      if (p.swapT >= SWAP_DUR) finishSwap(p);
      return;
    }
    let vx = 0;
    let vy = 0;
    if (keys.ArrowLeft || keys.KeyA) vx -= 1;
    if (keys.ArrowRight || keys.KeyD) vx += 1;
    if (keys.ArrowUp || keys.KeyW) vy -= 1;
    if (keys.ArrowDown || keys.KeyS) vy += 1;
    if (vx || vy) {
      p.tx = 0;
      p.pendingShell = null;
      const m = Math.hypot(vx, vy);
      p.x += (vx / m) * p.speed * dt;
      p.y += (vy / m) * p.speed * dt;
      if (vx) p.dir = vx > 0 ? 1 : -1;
      p.moving = true;
      p.state = "walk";
    } else if (p.state === "walk") {
      stepToward(p, dt, p.speed);
      if (!p.moving) {
        const sh = p.pendingShell;
        p.pendingShell = null;
        p.state = "idle";
        if (sh) attempt(p, sh);
      }
    } else {
      p.moving = false;
    }
    p.x = clamp(p.x, 26, W - 26);
    p.y = clamp(p.y, REST_EDGE + 14, H - 16);
  }

  function tryNearestShell(p) {
    let best = null;
    let bd = Infinity;
    for (const sh of G.shells) {
      if (sh.gone || !sh.vacant) continue;
      const d = dist(p.x, p.y, sh.x, sh.y);
      if (d < 56 && d < bd) {
        bd = d;
        best = sh;
      }
    }
    if (best) attempt(p, best);
    else toast("No shell within reach", "bad");
  }

  /* ---------- night flow ---------- */

  function updateExposure(c, dt) {
    const naked = c.alive && (c.state === "swap" || !c.home);
    if (naked) c.exposedT += dt;
    else c.exposedT = Math.max(0, c.exposedT - 3 * dt);
  }

  function update(dt) {
    G.t += dt;
    G._edge = updateTide(dt);

    G.crabs.forEach((c) => {
      if (!c.alive) return;
      if (c.isPlayer) updatePlayer(c, dt);
      else updateNpc(c, dt);
      if (c.moving) c.legPhase += dt * 14;
      updateExposure(c, dt);
      c.x = clamp(c.x, 26, W - 26);
      c.y = clamp(c.y, REST_EDGE + 12, H - 14);
    });
    if (G.crabs[0].alive) updateCard();

    updateGull(dt);

    G.particles.forEach((p) => {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === "splash") p.vy += 260 * dt;
      if (p.type === "sand") p.vy += 90 * dt;
      if (p.type === "feather") {
        p.vy = Math.min(40, p.vy + 60 * dt);
        p.vx *= 0.98;
      }
    });
    G.particles = G.particles.filter((p) => p.t < p.life);
    G.floaters.forEach((f) => (f.t += dt));
    G.floaters = G.floaters.filter((f) => f.t < 1.2);
    G.shells = G.shells.filter((sh) => !sh.gone);
    G.crabs = G.crabs.filter((c) => c.alive || c.isPlayer);

    if (G.shake > 0) G.shake -= dt;
    if (G.flash > 0) G.flash -= dt;
  }

  function scoreRows() {
    const p = G.crabs[0];
    const home = p.home;
    const rows = [];

    if (home) {
      rows.push([
        `Final shell — ${shellName(home)}, size ${home.size}`,
        home.size * 100 + home.integ * 2,
      ]);
    } else {
      rows.push(["Final shell — none, poor thing", 0]);
    }
    rows.push([`Heart kept × ${p.hearts}`, p.hearts * 150]);
    if (G.bestChain >= 2)
      rows.push([`Longest vacancy chain × ${G.bestChain}`, G.bestChain * 120]);
    if (home) {
      if (home.size >= 9) rows.push(["Beach baron bonus", 400]);
      else if (home.size >= 7) rows.push(["Big landlord bonus", 200]);
      else if (home.size >= 5) rows.push(["Roomy lodgings bonus", 80]);
    }
    return rows;
  }

  function endNight(survived) {
    if (G.phase !== "play") return;
    G.phase = "dawn";
    const p = G.crabs[0];
    const rows = scoreRows();
    const total = rows.reduce((s, r) => s + r[1], 0);
    let title;
    let sub;
    if (!survived) {
      title = "Taken by the Gull";
      sub = "The flat belongs to the wings now.";
      sfx.grief();
    } else {
      if (total >= 1700) {
        title = "King of the Flat";
        sub = "Crabs will speak of this shell for seasons.";
      } else if (total >= 1150) {
        title = "Grand Landlord";
        sub = "A very fine address on the tidal road.";
      } else if (total >= 650) {
        title = "Respectable Lodging";
        sub = "Snug enough. The neighbours nod.";
      } else {
        title = "Small, Soft, Alive";
        sub = "You kept your belly. That is not nothing.";
      }
      sfx.fanfare();
    }

    $("dawn-title").textContent = title;
    $("dawn-sub").textContent = sub;
    const lines = $("score-lines");
    lines.innerHTML = "";
    rows.forEach(([label, val]) => {
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("span");
      lab.textContent = label;
      const b = document.createElement("b");
      b.textContent = String(val);
      row.appendChild(lab);
      row.appendChild(b);
      lines.appendChild(row);
    });
    $("score-total").textContent = `Dawn score · ${total}`;
    ovDawn.classList.remove("hidden");
  }

  /* ---------- hud ---------- */

  let hudCycleKey = "";
  let cardKey = "";

  function updateHearts() {
    const p = G.crabs[0];
    let html = "";
    for (let i = 0; i < 3; i++)
      html += i < p.hearts ? "♥" : "<span style='opacity:.25'>♥</span>";
    elHearts.innerHTML = html;
  }

  function updateCard() {
    const p = G.crabs[0];
    let key;
    if (!p.home) key = "none";
    else
      key = `${shellName(p.home)}|${p.home.size}|${Math.round(p.home.integ)}`;
    if (key === cardKey) return;
    cardKey = key;
    if (!p.home) {
      elCardName.textContent = "Naked and worried";
      elCardMeta.textContent = "find any shell";
      elCardFill.style.width = "8%";
      elCardFill.classList.add("hurt");
      return;
    }
    elCardName.textContent = shellName(p.home);
    elCardMeta.textContent = `size ${p.home.size} · ${Math.round(p.home.integ)}% sound`;
    elCardFill.style.width = `${Math.round(p.home.integ)}%`;
    elCardFill.classList.toggle("hurt", p.home.integ < 45);
  }
  function updateHud() {
    const key = `${G.cycle}|${G.phase}`;
    if (key !== hudCycleKey) {
      hudCycleKey = key;
      elCycle.textContent = `Tide ${Math.min(G.cycle, CYCLES)} / ${CYCLES}`;
      let moons = "";
      for (let i = 0; i < CYCLES; i++)
        moons += `<i class="${i < G.cycle - 1 || G.phase === "dawn" ? "done" : ""}"></i>`;
      elMoons.innerHTML = moons;
    }
    elTideFill.style.width = `${Math.round(clamp(G.cycleT / CYCLE_T, 0, 1) * 100)}%`;
  }

  /* ---------- render ---------- */

  /* ---------- render ---------- */

  function drawSky(t) {
    const grd = ctx.createLinearGradient(0, 0, 0, HORIZON + 30);
    grd.addColorStop(0, "#0a0e22");
    grd.addColorStop(0.7, "#141a36");
    grd.addColorStop(1, "#232a4c");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, HORIZON + 2);
    G.stars.forEach((s) => {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.7 + s.tw));
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = "#dfe6ff";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    });
    ctx.globalAlpha = 1;
    // moon
    const mx = 762;
    const my = 62;
    const glow = ctx.createRadialGradient(mx, my, 8, mx, my, 90);
    glow.addColorStop(0, "rgba(226,233,244,0.5)");
    glow.addColorStop(1, "rgba(226,233,244,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 95, my - 95, 190, 190);
    ctx.fillStyle = "#e9edf4";
    ctx.beginPath();
    ctx.arc(mx, my, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(180,190,206,0.5)";
    ctx.beginPath();
    ctx.arc(mx - 8, my - 6, 5, 0, Math.PI * 2);
    ctx.arc(mx + 9, my + 7, 4, 0, Math.PI * 2);
    ctx.arc(mx + 3, my - 11, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSea(edge, t) {
    const grd = ctx.createLinearGradient(0, HORIZON, 0, SURGE_EDGE + 20);
    grd.addColorStop(0, "#101c38");
    grd.addColorStop(0.5, "#16304c");
    grd.addColorStop(1, "#1d4a63");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON);
    ctx.lineTo(W, HORIZON);
    ctx.lineTo(W, edge);
    for (let x = W; x >= 0; x -= 24) {
      ctx.lineTo(x, edge + Math.sin(x * 0.033 + t * 2.2) * 4);
    }
    ctx.closePath();
    ctx.fill();

    // moon glitter path
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      const yy =
        HORIZON + 6 + ((i * 7 + ((t * 26) % 7)) % (edge - HORIZON - 8));
      const wob = Math.sin(t * 2 + i * 1.7) * 16;
      const a = 0.12 + 0.3 * Math.abs(Math.sin(t * 1.4 + i));
      ctx.strokeStyle = `rgba(230,238,248,${a.toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(762 + wob - 9, yy);
      ctx.lineTo(762 + wob + 9, yy);
      ctx.stroke();
    }
    ctx.restore();

    // foam line at the edge
    ctx.strokeStyle = "rgba(224,240,244,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 16) {
      const yy = edge + Math.sin(x * 0.033 + t * 2.2) * 4;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  function drawSand(edge, t) {
    const top = Math.min(edge + 2, REST_EDGE);
    const grd = ctx.createLinearGradient(0, top, 0, H);
    grd.addColorStop(0, "#6d543a");
    grd.addColorStop(0.35, "#7c5f41");
    grd.addColorStop(1, "#57401f");
    ctx.fillStyle = grd;
    ctx.fillRect(0, top, W, H - top);
    // wet sheen near the waterline
    const wet = ctx.createLinearGradient(0, edge - 6, 0, edge + 42);
    wet.addColorStop(0, "rgba(20,40,54,0.55)");
    wet.addColorStop(1, "rgba(20,40,54,0)");
    ctx.fillStyle = wet;
    ctx.fillRect(0, edge - 6, W, 48);
    G.speckles.forEach((s) => {
      ctx.fillStyle = `rgba(20,14,6,${s.a})`;
      ctx.fillRect(s.x, s.y, 1.6, 1.6);
    });
    G.pebbles.forEach((pb) => {
      ctx.fillStyle = `rgba(30,24,16,${pb.shade})`;
      ctx.beginPath();
      ctx.ellipse(pb.x, pb.y, pb.r, pb.r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    G.weeds.forEach((wd) => {
      ctx.strokeStyle = "rgba(52,72,44,0.8)";
      ctx.lineWidth = 2;
      for (let b = -1; b <= 1; b++) {
        ctx.beginPath();
        ctx.moveTo(wd.x, wd.y);
        ctx.quadraticCurveTo(
          wd.x + b * 6 + Math.sin(t * 1.1 + wd.sway) * 3,
          wd.y - 12 * wd.s,
          wd.x + b * 10 + Math.sin(t * 1.3 + wd.sway) * 5,
          wd.y - 22 * wd.s,
        );
        ctx.stroke();
      }
    });
  }

  function drawShellGraphic(sh, t) {
    const r = 5 + sh.size * 2.5;
    ctx.save();
    ctx.translate(sh.x, sh.y);
    const hue = sh.hue;
    const sat = 26 + sh.seed * 22;
    const lit = 52 + sh.seed * 16;
    const main = `hsl(${hue},${sat}%,${lit}%)`;
    const dark = `hsl(${hue},${sat}%,${lit - 22}%)`;
    ctx.fillStyle = main;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.4;
    const flip = sh.seed > 0.5 ? 1 : -1;
    switch (sh.species) {
      case "peri": {
        ctx.beginPath();
        ctx.arc(0, -r * 0.8, r * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -r * 0.8, r * 0.5, 0.6, 4.6);
        ctx.stroke();
        break;
      }
      case "limpet": {
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.35, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r * 0.4);
        ctx.quadraticCurveTo(0, -r * 1.5, r * 0.7, -r * 0.4);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "top": {
        ctx.beginPath();
        ctx.moveTo(-r * 0.75, 0);
        ctx.lineTo(r * 0.75, 0);
        ctx.lineTo(r * 0.2, -r * 1.9 * flip);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = dark;
        for (let i = 1; i < 4; i++) {
          const yy = (-r * 1.7 * i) / 4;
          ctx.beginPath();
          ctx.moveTo(
            -r * 0.62 + i * r * 0.1,
            yy * flip * -1 * 0 + yy * (flip > 0 ? 1 : 1) * 0 + yy,
          );
          ctx.lineTo(r * 0.62 - i * r * 0.1, yy);
          ctx.stroke();
        }
        break;
      }
      case "whelk":
      case "great": {
        const L = r * (sh.species === "great" ? 2.5 : 2.1);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.8, r * 0.85, r * 1.05, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, -r * 1.6);
        ctx.quadraticCurveTo(-r * 0.2, -L, r * 0.5, -L * 0.92);
        ctx.quadraticCurveTo(r * 0.15, -L * 0.6, r * 0.55, -r * 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = dark;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(0, -r * 0.8, r * 0.85 - i * r * 0.26, 0.4, 2.4);
          ctx.stroke();
        }
        if (sh.species === "great") {
          ctx.fillStyle = "rgba(238,222,178,0.85)";
          ctx.beginPath();
          ctx.ellipse(0, -r * 0.8, r * 0.85, r * 1.05, 0, 0.5, 1.6);
          ctx.fill();
        }
        break;
      }
      default:
        ctx.beginPath();
        ctx.arc(0, -r * 0.8, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
    }
    // cracks by condition
    if (sh.integ < 58) {
      ctx.strokeStyle = "rgba(30,20,12,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 1.2);
      ctx.lineTo(-r * 0.1, -r * 0.7);
      ctx.lineTo(-r * 0.5, -r * 0.3);
      if (sh.integ < 34) {
        ctx.moveTo(r * 0.5, -r * 1.1);
        ctx.lineTo(r * 0.2, -r * 0.6);
        ctx.lineTo(r * 0.55, -r * 0.2);
      }
      ctx.stroke();
    }
    // fresh shimmer
    if (sh.freshUntil > G.t) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin((G.t - sh.bornAt) * 5));
      ctx.strokeStyle = `rgba(255,226,150,${pulse.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -r * 0.8, r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    // npc reservation marker
    if (sh.reservedBy && !sh.reservedBy.isPlayer) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,190,190,0.55)";
      ctx.beginPath();
      ctx.arc(0, -r * 0.8, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawCrabBody(c, t) {
    const bw = 13 + c.body * 2.2;
    const bh = bw * 0.66;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(c.dir, 1);
    // legs
    ctx.strokeStyle = shade(c.hue, -26);
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      const sw = c.moving ? Math.sin(c.legPhase + i * 2) * 4 : 0;
      ctx.beginPath();
      ctx.moveTo(i * bw * 0.32, -bh * 0.3);
      ctx.lineTo(i * bw * 0.32 - 5 - sw, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * bw * 0.32, -bh * 0.3);
      ctx.lineTo(i * bw * 0.32 + 5 + sw, 3);
      ctx.stroke();
    }
    // claws
    ctx.fillStyle = shade(c.hue, -12);
    const clawSw = c.moving ? Math.sin(c.legPhase * 1.3) * 2 : 0;
    ctx.beginPath();
    ctx.arc(bw * 0.62, -bh * 0.5 + clawSw, bw * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bw * 0.5, -bh * 0.05 - clawSw, bw * 0.17, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = c.hue;
    ctx.strokeStyle = shade(c.hue, -34);
    ctx.beginPath();
    ctx.ellipse(0, -bh * 0.5, bw * 0.55, bh * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // eyes on stalks
    ctx.strokeStyle = shade(c.hue, -30);
    ctx.beginPath();
    ctx.moveTo(bw * 0.18, -bh * 0.9);
    ctx.lineTo(bw * 0.26, -bh * 1.35);
    ctx.moveTo(bw * 0.4, -bh * 0.85);
    ctx.lineTo(bw * 0.5, -bh * 1.3);
    ctx.stroke();
    ctx.fillStyle = "#14100c";
    ctx.beginPath();
    ctx.arc(bw * 0.27, -bh * 1.4, 1.8, 0, Math.PI * 2);
    ctx.arc(bw * 0.51, -bh * 1.35, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // sweat drops when dangerously exposed
    if (c.exposedT > 0.35) {
      ctx.fillStyle = "rgba(160,215,235,0.9)";
      const drop = Math.abs(Math.sin(t * 6 + c.id)) * 5;
      ctx.fillRect(c.x + 10, c.y - 26 - drop, 2.4, 4);
      ctx.fillRect(c.x - 12, c.y - 30 - drop * 0.6, 2, 3.4);
    }
    if (c.bubbleT > 0 && c.bubble) {
      ctx.fillStyle = "rgba(244,238,220,0.95)";
      ctx.font = "bold 13px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(c.bubble, c.x, c.y - 34);
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function drawOccupantEyes(sh, t) {
    const o = sh.owner;
    if (!o || !o.alive || o.state === "swap") return;
    const r = 5 + sh.size * 2.5;
    ctx.save();
    ctx.translate(sh.x, sh.y);
    ctx.scale(o.dir, 1);
    // little legs peeking beneath
    ctx.strokeStyle = "rgba(20,14,10,0.55)";
    ctx.lineWidth = 1.6;
    for (let i = -1; i <= 1; i++) {
      const sw = o.moving ? Math.sin(o.legPhase + i * 2) * 3 : 0;
      ctx.beginPath();
      ctx.moveTo(i * r * 0.4, -2);
      ctx.lineTo(i * r * 0.4 - 3 + sw, 3);
      ctx.stroke();
    }
    ctx.strokeStyle = shade(o.hue, -20);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 1.5);
    ctx.lineTo(r * 0.55, -r * 1.95);
    ctx.stroke();
    ctx.fillStyle = "#14100c";
    ctx.beginPath();
    ctx.arc(r * 0.58, -r * 2.0, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGull(t) {
    const g = G.gull;
    if (g.mode === "away") return;
    // shadow on the sand while diving
    if (g.mode === "dive" || g.mode === "aim") {
      ctx.fillStyle = `rgba(8,10,16,${(0.34 * (1 - g.alt / 170)).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(
        g.tx,
        g.ty + 4,
        14 - g.alt * 0.04,
        5 - g.alt * 0.015,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const flap = Math.sin(g.wing) * 9;
    ctx.save();
    ctx.translate(g.x, g.y);
    const face =
      g.mode === "hover" ? (g.vx < 0 ? -1 : 1) : g.tx >= g.x ? 1 : -1;
    ctx.scale(face, 1);

    ctx.strokeStyle = "#e8ecf2";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-16, -flap * 0.4);
    ctx.quadraticCurveTo(-6, -6 - flap, 0, 0);
    ctx.quadraticCurveTo(6, -6 - flap, 16, -flap * 0.4);
    ctx.stroke();
    ctx.fillStyle = "#e8ecf2";
    ctx.beginPath();
    ctx.ellipse(0, 1, 5.5, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e2a23c";
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(11, 1.6);
    ctx.lineTo(5, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function render() {
    const t = G.t;
    const edge = G._edge == null ? REST_EDGE : G._edge;
    ctx.save();
    if (G.shake > 0) {
      ctx.translate(rnd(-4, 4) * G.shake, rnd(-3, 3) * G.shake);
    }
    drawSky(t);
    drawSea(edge, t);
    drawSand(edge, t);

    // depth-sorted actors
    const actors = [];
    G.shells.forEach((sh) => {
      actors.push({ y: sh.y, fn: () => drawShellGraphic(sh, t) });
      if (sh.owner)
        actors.push({ y: sh.y + 0.5, fn: () => drawOccupantEyes(sh, t) });
    });
    G.crabs.forEach((c) => {
      if (!c.alive) return;
      if (!c.home || c.state === "swap")
        actors.push({ y: c.y + 1, fn: () => drawCrabBody(c, t) });
    });
    actors.sort((a, b) => a.y - b.y);
    actors.forEach((a) => a.fn());

    drawGull(t);

    // particles
    G.particles.forEach((p) => {
      const k = 1 - p.t / p.life;
      if (p.type === "sand")
        ctx.fillStyle = `rgba(150,120,80,${(0.7 * k).toFixed(3)})`;
      else if (p.type === "spark")
        ctx.fillStyle = `rgba(255,224,150,${(0.9 * k).toFixed(3)})`;
      else if (p.type === "splash")
        ctx.fillStyle = `rgba(180,220,235,${(0.85 * k).toFixed(3)})`;
      else if (p.type === "foam")
        ctx.fillStyle = `rgba(228,242,246,${(0.5 * k).toFixed(3)})`;
      else ctx.fillStyle = `rgba(238,242,248,${(0.9 * k).toFixed(3)})`;
      const sz = p.type === "feather" ? 3 : 2;
      ctx.fillRect(p.x, p.y, sz, sz);
    });

    // floaters
    ctx.font = "bold 13px Georgia, serif";
    ctx.textAlign = "center";
    G.floaters.forEach((f) => {
      const k = f.t / 1.2;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - 24 * k);
    });
    ctx.globalAlpha = 1;

    // vignette
    const vig = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.42,
      W / 2,
      H / 2,
      H * 0.82,
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(4,6,12,0.42)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (G.flash > 0) {
      ctx.fillStyle = `rgba(255,120,90,${(G.flash * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    updateHud();
  }

  /* ---------- input ---------- */

  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * W,
      y: ((evt.clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("pointerdown", (evt) => {
    evt.preventDefault();
    ensureAudio();
    if (G.phase !== "play") return;
    const pt = canvasPoint(evt);
    const p = G.crabs[0];
    if (!p.alive) return;
    let best = null;
    let bd = Infinity;
    for (const sh of G.shells) {
      if (sh.gone) continue;
      const d = dist(pt.x, pt.y, sh.x, sh.y - 8);
      if (d < 40 && d < bd) {
        bd = d;
        best = sh;
      }
    }
    if (best) {
      attempt(p, best);
    } else {
      p.tx = clamp(pt.x, 26, W - 26);
      p.ty = clamp(pt.y, REST_EDGE + 14, H - 16);
      p.pendingShell = null;
      p.state = "walk";
    }
  });

  canvas.addEventListener("contextmenu", (evt) => evt.preventDefault());

  document.addEventListener("keydown", (evt) => {
    if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
    const code = evt.code;
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(
        code,
      ) ||
      code.startsWith("Key")
    ) {
      if (
        document.activeElement &&
        document.activeElement.tagName === "BUTTON" &&
        code === "Space"
      ) {
        // let buttons keep their space-to-press
      } else {
        evt.preventDefault();
      }
    }
    ensureAudio();
    if (code === "KeyM") {
      toggleMute();
      return;
    }
    if (code === "KeyP") {
      togglePause();
      return;
    }
    if (code === "KeyR") {
      restartNight();
      return;
    }
    if (code === "Enter" || code === "Space") {
      if (G.phase === "intro") {
        startGame();
        return;
      }
      if (G.phase === "dawn") {
        restartNight();
        return;
      }
    }
    if (G.phase === "paused" || G.phase !== "play") return;
    keys[code] = true;
    if (code === "Space" && !evt.repeat) tryNearestShell(G.crabs[0]);
  });

  document.addEventListener("keyup", (evt) => {
    keys[evt.code] = false;
  });

  /* ---------- buttons & overlays ---------- */

  function startGame() {
    ensureAudio();
    sfx.ui();
    ovIntro.classList.add("hidden");
    ovPaused.classList.add("hidden");
    ovDawn.classList.add("hidden");
    G.phase = "play";
    toast("Six tides until dawn. Mind the gull.");
  }

  function restartNight() {
    ensureAudio();
    sfx.ui();
    resetWorld();
    ovIntro.classList.add("hidden");
    ovPaused.classList.add("hidden");
    ovDawn.classList.add("hidden");
    G.phase = "play";
    updateHearts();
    updateCard();
    toast("A new night falls on the flat");
  }

  function togglePause() {
    if (G.phase === "play") {
      G.phase = "paused";
      ovPaused.classList.remove("hidden");
      sfx.ui();
    } else if (G.phase === "paused") {
      G.phase = "play";
      ovPaused.classList.add("hidden");
      sfx.ui();
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    $("btn-mute").textContent = muted ? "✕" : "♪";
    if (!muted) sfx.ui();
  }

  $("btn-start").addEventListener("click", startGame);
  $("btn-resume").addEventListener("click", togglePause);
  $("btn-pause").addEventListener("click", togglePause);
  function onBtn(id, fn) {
    $(id).addEventListener("click", (e) => {
      e.currentTarget.blur();
      fn();
    });
  }

  onBtn("btn-start", startGame);
  onBtn("btn-resume", togglePause);
  onBtn("btn-pause", togglePause);
  onBtn("btn-mute", toggleMute);
  onBtn("btn-restart", restartNight);
  onBtn("btn-paused-restart", restartNight);
  onBtn("btn-again", restartNight);

  /* ---------- boot & loop ---------- */

  function fit() {
    const pad = 14;
    const scale = Math.min(
      (window.innerWidth - pad) / W,
      (window.innerHeight - pad) / H,
    );
    const s = Math.max(0.35, Math.min(scale, 1.6));
    canvas.style.width = `${Math.round(W * s)}px`;
    canvas.style.height = `${Math.round(H * s)}px`;
  }
  /* read-only debug handle for automated playtesting (needs #debug in the URL) */
  if (/debug/.test(location.hash + location.search)) {
    window.__SM = {
      phase: () => G.phase,
      cycle: () => G.cycle,
      cycleT: () => G.cycleT,
      t: () => G.t,
      hearts: () => G.crabs[0].hearts,
      player: () => {
        const p = G.crabs[0];
        return { x: p.x, y: p.y, body: p.body, state: p.state, homeSize: p.home ? p.home.size : 0 };
      },
      shells: () =>
        G.shells.filter((s) => !s.gone).map((s) => ({ x: s.x, y: s.y - 8, size: s.size, vacant: s.vacant })),
      gullMode: () => G.gull.mode,
      npcs: () =>
        G.crabs
          .filter((c) => !c.isPlayer)
          .map((c) => ({ name: c.name, alive: c.alive, state: c.state, size: c.home ? c.home.size : 0 })),
    };
  }

  requestAnimationFrame(frame);
})();

})();
