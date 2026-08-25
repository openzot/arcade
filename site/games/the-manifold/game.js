/* The Manifold — arcade salvage.
   One brass air line, two hardhat divers, one sinking clipper, one rising gale.
   All behaviour lives in this file, wrapped in an IIFE. */

(() => {
  "use strict";

  /* ── constants ──────────────────────────────────────── */

  const W = 960,
    H = 600,
    WATER = 205,
    SAND = 548;
  const TAU = Math.PI * 2;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const DIVES = [
    {
      name: "Dive I — the foredeck",
      ports: 3,
      stormT: 100,
      wobble: 0.25,
      snagMin: 13.0,
    },
    {
      name: "Dive II — the mouldering hold",
      ports: 4,
      stormT: 110,
      wobble: 0.45,
      snagMin: 11.0,
    },
    {
      name: "Dive III — the broken stern",
      ports: 5,
      stormT: 120,
      wobble: 0.65,
      snagMin: 9.5,
    },
    {
      name: "Dive IV — the captain's cabin",
      ports: 6,
      stormT: 130,
      wobble: 0.85,
      snagMin: 8.0,
    },
  ];

  const PORT_WORK = 80;
  const BOX_WORK = 200;

  /* ── DOM ────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);
  const CV = $("scene"),
    CX = CV.getContext("2d");
  const overlay = $("overlay"),
    card = $("card");
  const ovTitle = $("ovTitle"),
    ovTag = $("ovTagline"),
    ovBody = $("ovBody"),
    goBtn = $("goBtn");
  const soundBtn = $("soundBtn"),
    pauseBtn = $("pauseBtn"),
    restartBtn = $("restartBtn");
  const padPort = $("padPort"),
    padStar = $("padStar"),
    padStoke = $("padStoke"),
    padHaul = $("padHaul"),
    jiggleRow = $("jiggleRow"),
    jigPort = $("jigglePort"),
    jigStar = $("jiggleStar");

  /* ── state ──────────────────────────────────────────── */

  let phase = "title"; // title | diving | end
  let paused = false;
  let cosT = 0; // cosmetic clock, always runs
  let diveIdx = 0;
  let seasonScore = 0;
  let D = null; // current dive runtime

  function newDive(i) {
    const cfg = DIVES[i];
    const spots = [
      [248, 496],
      [330, 510],
      [412, 521],
      [494, 527],
      [576, 522],
      [664, 508],
    ];
    const items = [];
    for (let p = 0; p < cfg.ports; p++)
      items.push({
        kind: "port",
        x: spots[p][0],
        y: spots[p][1],
        work: 0,
        need: PORT_WORK,
        done: false,
      });
    items.push({
      kind: "box",
      x: 738,
      y: 522,
      work: 0,
      need: BOX_WORK,
      done: false,
    });
    return {
      cfg,
      t: 0,
      storm: 0,
      M: 60,
      heat: 22,
      venting: false,
      fed: -1,
      stoking: false,
      hauling: false,
      items,
      quotaDone: false,
      haul: 0,
      bursts: 0,
      nextSnag: 12,
      divers: [
        {
          name: "TAM",
          x: 352,
          y: 428,
          homeX: 352,
          homeY: 428,
          Dp: 42,
          S: 100,
          breathe: 0,
          face: 1,
        },
        {
          name: "ENOCH",
          x: 610,
          y: 448,
          homeX: 610,
          homeY: 448,
          Dp: 42,
          S: 100,
          breathe: 1.1,
          face: -1,
        },
      ],
      lines: [
        { kink: false, burst: false, fixes: 0, strain: 0 },
        { kink: false, burst: false, fixes: 0, strain: 0 },
      ],
      toasts: [],
      sparks: [],
      bubbles: [],
      smoke: [],
    };
  }

  /* ── audio (Web Audio, synthesised) ─────────────────── */

  let AC = null,
    master = null,
    hissG = null,
    seaG = null,
    ventG = null,
    noiseBuf = null;
  let muted = false,
    clickAcc = 0;

  function audioInit() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(AC.destination);
      const len = AC.sampleRate * 2;
      noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      // sea bed ambience
      const sea = AC.createBufferSource();
      sea.buffer = noiseBuf;
      sea.loop = true;
      const seaF = AC.createBiquadFilter();
      seaF.type = "lowpass";
      seaF.frequency.value = 320;
      seaG = AC.createGain();
      seaG.gain.value = 0.0;
      sea.connect(seaF);
      seaF.connect(seaG);
      seaG.connect(master);
      sea.start();
      // feed hiss
      const hs = AC.createBufferSource();
      hs.buffer = noiseBuf;
      hs.loop = true;
      const hsF = AC.createBiquadFilter();
      hsF.type = "bandpass";
      hsF.frequency.value = 950;
      hsF.Q.value = 0.8;
      hissG = AC.createGain();
      hissG.gain.value = 0;
      hs.connect(hsF);
      hsF.connect(hissG);
      hissG.connect(master);
      hs.start();
      // safety-valve scream
      const vs = AC.createBufferSource();
      vs.buffer = noiseBuf;
      vs.loop = true;
      const vsF = AC.createBiquadFilter();
      vsF.type = "highpass";
      vsF.frequency.value = 2400;
      ventG = AC.createGain();
      ventG.gain.value = 0;
      vs.connect(vsF);
      vsF.connect(ventG);
      ventG.connect(master);
      vs.start();
    } catch (e) {
      AC = null;
    }
  }

  function tone(freq, dur, type, vol, slide) {
    if (!AC || muted) return;
    const o = AC.createOscillator(),
      g = AC.createGain();
    o.type = type || "triangle";
    o.frequency.value = freq;
    if (slide)
      o.frequency.exponentialRampToValueAtTime(
        Math.max(30, slide),
        AC.currentTime + dur,
      );
    g.gain.value = vol || 0.15;
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(AC.currentTime + dur + 0.02);
  }

  const sndChime = () => {
    tone(660, 0.28, "triangle", 0.16);
    setTimeout(() => tone(990, 0.34, "triangle", 0.13), 70);
  };
  const sndBad = () => tone(190, 0.5, "square", 0.12, 90);
  const sndKlaxon = () => {
    tone(220, 0.55, "square", 0.1);
    setTimeout(() => tone(174, 0.55, "square", 0.1), 240);
  };
  const sndClick = () => tone(1400, 0.03, "square", 0.05);
  const sndClear = () => tone(520, 0.12, "triangle", 0.12);

  function sndBurst() {
    if (!AC || muted) return;
    const s = AC.createBufferSource();
    s.buffer = noiseBuf;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 260;
    const g = AC.createGain();
    g.gain.value = 0.5;
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.5);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start();
    s.stop(AC.currentTime + 0.55);
    tone(300, 0.4, "sawtooth", 0.14, 60);
  }

  /* ── toasts & particles ─────────────────────────────── */

  function toast(txt, col) {
    if (D) D.toasts.push({ txt, col: col || "#e8dcc0", t: 2.6 });
  }

  function sparksAt(x, y, n, col) {
    for (let i = 0; i < n; i++)
      D.sparks.push({
        x,
        y,
        vx: rnd(-60, 60),
        vy: rnd(-90, -10),
        t: rnd(0.2, 0.55),
        col: col || "#ffd98a",
      });
  }

  function bubbleAt(x, y, r) {
    D.bubbles.push({
      x,
      y,
      r: r || rnd(1.5, 4),
      vx: rnd(-8, 8),
      vy: rnd(-55, -30),
      t: rnd(1.2, 2.6),
    });
  }

  /* ── mechanics ──────────────────────────────────────── */

  function workRate(dp) {
    if (dp < 25) return 0;
    if (dp < 45) return (0.7 * (dp - 25)) / 20;
    if (dp <= 75) return 1;
    if (dp <= 88) return lerp(0.85, 0.5, (dp - 75) / 13);
    return 0.5;
  }

  function currentItem() {
    for (const it of D.items) if (!it.done) return it;
    return null;
  }

  function toggleFeed(i) {
    if (phase !== "diving" || paused) return;
    const ln = D.lines[i];
    if (ln.burst) {
      toast(
        (i ? "STARBOARD" : "PORT") + " LINE IS BURST — PATCH IT FIRST",
        "#ffb9a8",
      );
      sndBad();
      return;
    }
    D.fed = D.fed === i ? -1 : i;
    sndClick();
  }

  function triggerSnag() {
    const live = [0, 1].filter((i) => !D.lines[i].burst && !D.lines[i].kink);
    if (!live.length) {
      D.nextSnag = 6;
      return;
    }
    let i = live[Math.floor(Math.random() * live.length)];
    if (D.fed >= 0 && !D.lines[D.fed].kink && Math.random() < 0.6) i = D.fed;
    const ln = D.lines[i];
    ln.kink = true;
    ln.fixes = 4;
    D.nextSnag = rnd(D.cfg.snagMin, D.cfg.snagMin + 9);
    toast((i ? "STARBOARD" : "PORT") + " HOSE KINKED — JIGGLE IT", "#ffcf87");
    sndBad();
  }

  function doBurst(i) {
    const ln = D.lines[i];
    ln.burst = true;
    ln.kink = false;
    ln.fixes = 5;
    ln.strain = 0;
    if (D.fed === i) D.fed = -1;
    D.M = Math.max(0, D.M - 28);
    D.bursts++;
    const dv = D.divers[i];
    for (let k = 0; k < 26; k++)
      bubbleAt(dv.x + rnd(-14, 14), dv.y - 30 + rnd(-10, 10), rnd(2, 5));
    toast((i ? "STARBOARD" : "PORT") + " HOSE BURST!", "#ff9a8a");
    sndBurst();
    setTimeout(sndKlaxon, 300);
  }

  function jigglePress(i) {
    if (phase !== "diving" || paused) return;
    const ln = D.lines[i];
    if (!ln.kink && !ln.burst) return;
    ln.fixes--;
    sndClick();
    const dv = D.divers[i];
    sparksAt(dv.x, dv.y - 40, 2, "#bcd6e8");
    if (ln.fixes <= 0) {
      if (ln.burst) {
        ln.burst = false;
        toast("HOSE PATCHED WITH TARRED CANVAS", "#bfe6bf");
      } else {
        ln.kink = false;
        toast("HOSE RUNS CLEAR", "#bfe6bf");
      }
      sndClear();
    }
  }

  function checkQuota() {
    if (D.quotaDone || D.items.some((it) => !it.done)) return;
    D.quotaDone = true;
    toast("QUOTA RAISED — HOLD W TO WIND US UP", "#ffe9a8");
    padHaul.hidden = false;
    sndChime();
    setTimeout(sndChime, 260);
  }

  function moneyStr(p) {
    const sh = Math.floor(p / 12),
      pen = p % 12;
    return sh > 0 ? (pen ? sh + "s " + pen + "d" : sh + "s") : pen + "d";
  }

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  /* ── step ───────────────────────────────────────────── */

  function step(dt) {
    D.t += dt;
    D.storm = clamp(D.t / D.cfg.stormT, 0, 1);

    /* boiler & manifold */
    const eff = 1 - 0.35 * D.storm;
    let fill = 15 * eff;
    if (D.stoking && !D.venting) {
      fill += 27 * eff;
      D.heat += 30 * dt;
      if (Math.random() < dt * 22)
        D.smoke.push({
          x: 306 + rnd(-4, 4),
          y: 128,
          vx: rnd(-16, -4) - 14 * D.storm,
          vy: rnd(-34, -22),
          t: rnd(1.2, 2.2),
          r: rnd(3, 6),
        });
      clickAcc += dt;
      if (clickAcc > 0.09) {
        clickAcc = 0;
        sndClick();
      }
    } else {
      D.heat -= (D.venting ? 19 : 13) * dt;
    }
    if (D.venting) fill = -24;
    if (D.heat >= 100) {
      D.heat = 100;
      if (!D.venting) {
        D.venting = true;
        toast("SAFETY VALVE VENTING — EASE OFF", "#ffb9a8");
        sndBad();
      }
    }
    if (D.venting && D.heat <= 62) D.venting = false;
    D.heat = clamp(D.heat, 0, 100);
    D.M = clamp(D.M + fill * dt, 0, 100);
    if (D.fed >= 0) D.M = Math.max(0, D.M - 8.5 * dt);

    /* snags */
    if (!D.quotaDone) {
      D.nextSnag -= dt;
      if (D.nextSnag <= 0) triggerSnag();
    }

    /* divers */
    const it = currentItem();
    for (let i = 0; i < 2; i++) {
      const dv = D.divers[i],
        ln = D.lines[i];
      const fedOk = D.fed === i && !ln.kink && !ln.burst;

      if (fedOk) dv.Dp += clamp((D.M - dv.Dp) * 1.1, -20, 30) * dt;
      else dv.Dp = Math.max(0, dv.Dp - 9 * dt);
      dv.Dp = clamp(dv.Dp, 0, 120);

      if (dv.Dp >= 25) dv.S = clamp(dv.S + (fedOk ? 6 : -2) * dt, 0, 100);
      else dv.S = Math.max(0, dv.S - 4.8 * dt);

      /* strain → burst */
      if (fedOk && dv.Dp > 88) {
        ln.strain += dt * (dv.Dp - 88) * 0.06;
        if (Math.random() < dt * 6) sparksAt(dv.x, dv.y - 34, 1, "#ff9a8a");
        if (ln.strain > 1) {
          doBurst(i);
          continue;
        }
      } else {
        ln.strain = Math.max(0, ln.strain - 0.35 * dt);
      }

      /* work */
      if (fedOk && it && dv.Dp >= 25) {
        const r = workRate(dv.Dp);
        if (r > 0) {
          it.work = Math.min(it.need, it.work + r * 10 * dt);
          if (Math.random() < dt * 14)
            sparksAt(it.x + rnd(-6, 6), it.y + rnd(-4, 4), 1);
          if (it.work >= it.need) {
            it.done = true;
            sndChime();
            if (it.kind === "port")
              toast("PORTHOLE FREE — SILVER SECURED", "#ffe9a8");
            else toast("THE CAPTAIN'S STRONGBOX IS OURS", "#ffe9a8");
            checkQuota();
          }
        }
      }

      /* breathing bubbles */
      dv.breathe -= dt;
      if (dv.breathe <= 0) {
        dv.breathe = rnd(1.6, 2.8);
        bubbleAt(dv.x + 10 * dv.face, dv.y - 22, rnd(1.5, 3.5));
        if (fedOk) bubbleAt(dv.x + 10 * dv.face, dv.y - 24, rnd(1, 2.5));
      }

      /* hauling lift */
      if (D.haul > 0) {
        dv.y = lerp(dv.homeY, 236, Math.min(1, D.haul));
        dv.x = lerp(dv.homeX, i ? 470 : 420, Math.min(1, D.haul));
      }
    }

    /* winch */
    if (D.quotaDone && D.hauling) {
      D.haul += 0.22 * dt;
      clickAcc += dt;
      if (clickAcc > 0.16) {
        clickAcc = 0;
        sndClick();
      }
      if (D.haul >= 1) {
        succeed();
        return;
      }
    }

    /* lose conditions */
    if (D.divers[0].S <= 0) {
      fail("Tam\u2019s air ran out in the dark.", "A MAN FADED");
      return;
    }
    if (D.divers[1].S <= 0) {
      fail("Enoch\u2019s air ran out in the dark.", "A MAN FADED");
      return;
    }
    if (D.t >= D.cfg.stormT) {
      fail(
        "The gale broke before the silver was safe aboard.",
        "THE GALE BROKE",
      );
      return;
    }

    /* particles */
    for (const s of D.sparks) {
      s.t -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 260 * dt;
    }
    D.sparks = D.sparks.filter((s) => s.t > 0);
    for (const b of D.bubbles) {
      b.t -= dt;
      b.x += (b.vx + Math.sin(cosT * 3 + b.y * 0.05) * 10) * dt;
      b.y += b.vy * dt;
    }
    D.bubbles = D.bubbles.filter((b) => b.t > 0 && b.y > WATER + 6);
    for (const sm of D.smoke) {
      sm.t -= dt;
      sm.x += sm.vx * dt;
      sm.y += sm.vy * dt;
      sm.r += 6 * dt;
    }
    D.smoke = D.smoke.filter((sm) => sm.t > 0);
    for (const t of D.toasts) t.t -= dt;
    D.toasts = D.toasts.filter((t) => t.t > 0);

    /* audio levels */
    if (AC && !muted) {
      let h = 0;
      for (let i = 0; i < 2; i++) {
        const ok = D.fed === i && !D.lines[i].kink && !D.lines[i].burst;
        if (ok) h = Math.max(h, clamp((D.divers[i].Dp - 20) / 80, 0, 1));
      }
      hissG.gain.value += (h * 0.09 - hissG.gain.value) * 0.2;
      seaG.gain.value += (0.05 + 0.13 * D.storm - seaG.gain.value) * 0.05;
      ventG.gain.value += ((D.venting ? 0.08 : 0) - ventG.gain.value) * 0.15;
    }
  }

  /* ── phase changes & overlays ───────────────────────── */

  let goAction = null;

  function showCard(opts) {
    card.className = "card" + (opts.cls ? " " + opts.cls : "");
    ovTitle.textContent = opts.title;
    ovTag.textContent = opts.tag || "";
    ovTag.style.display = opts.tag ? "" : "none";
    ovBody.innerHTML = opts.body || "";
    goBtn.textContent = opts.btn;
    goAction = opts.action;
    overlay.classList.add("show");
  }

  function hideCard() {
    overlay.classList.remove("show");
  }

  function startDive() {
    audioInit();
    if (AC && AC.state === "suspended") AC.resume();
    D = newDive(diveIdx);
    phase = "diving";
    paused = false;
    pauseBtn.textContent = "PAUSE";
    padHaul.hidden = true;
    hideCard();
    syncPads();
  }

  function succeed() {
    phase = "end";
    stopHiss();
    const c = D.cfg;
    const coins = c.ports * 40 + 150;
    const bonus = Math.round(Math.max(0, 200 * (1 - D.t / c.stormT)));
    const pen = D.bursts * 120;
    const total = Math.max(0, coins + bonus - pen);
    seasonScore += total;
    const grade =
      total >= 460 ? "A" : total >= 360 ? "B" : total >= 270 ? "C" : "D";
    const last = diveIdx >= DIVES.length - 1;
    const tally =
      '<ul class="tally">' +
      "<li><span>Portholes raised</span><span>" +
      c.ports +
      " \u00d7 40d</span></li>" +
      "<li><span>The strongbox</span><span>150d</span></li>" +
      "<li><span>Swift-work bonus</span><span>+" +
      bonus +
      "d</span></li>" +
      "<li><span>Burst hoses</span><span>\u2212" +
      pen +
      "d</span></li>" +
      "<li><span>Dive value</span><span>" +
      moneyStr(total) +
      "</span></li>" +
      '<li class="grade"><span>GRADE</span><span>' +
      grade +
      "</span></li>" +
      "</ul>";
    if (!last) {
      showCard({
        cls: "verdict-ok",
        title: "Silver Aboard!",
        tag:
          '"' +
          c.name.replace(/^Dive [IV]+ \u2014 /, "") +
          '" cleared with ' +
          fmtTime(c.stormT - D.t) +
          " of glass to spare.",
        body:
          tally +
          "<p>Season takings so far: <strong>" +
          moneyStr(seasonScore) +
          "</strong>. The barge shifts to deeper water.</p>",
        btn: "NEXT DIVE",
        action: () => {
          diveIdx++;
          startDive();
        },
      });
    } else {
      const g =
        seasonScore >= 1500
          ? "The underwriters toast you by name."
          : seasonScore >= 1100
            ? "A season the harbour will talk about."
            : seasonScore >= 750
              ? "Honest work, honest silver."
              : "The crew grumbles, but the rent is paid.";
      showCard({
        cls: "verdict-ok",
        title: "Season's End",
        tag: "Four dives, one gale-ridden autumn, every man brought home.",
        body:
          tally +
          "<p><strong>SEASON TOTAL: " +
          moneyStr(seasonScore) +
          "</strong></p><p>" +
          g +
          "</p>",
        btn: "SAIL AGAIN",
        action: () => {
          diveIdx = 0;
          seasonScore = 0;
          toTitle();
        },
      });
    }
  }

  function fail(reason, headline) {
    phase = "end";
    stopHiss();
    showCard({
      cls: "verdict-bad",
      title: headline,
      tag: '"The sea takes her interest on every loan."',
      body:
        "<p>" +
        reason +
        "</p><p>The barge rides it out at anchor and the divers go down again at slack water.</p>",
      btn: "TRY THE DIVE AGAIN",
      action: () => startDive(),
    });
  }

  function toTitle() {
    phase = "title";
    D = newDive(0);
    showCard({
      title: "The Manifold",
      tag: "\u201cOne hose. Two men. Bring up the silver.\u201d",
      body:
        "<p>Wreck of the clipper <em>Cygnet</em>, forty fathom down, and the glass is falling.<br>" +
        "Two hardhat divers work her decks, but the barge carries a single air line \u2014 the manifold feeds only one man at a time.</p>" +
        "<ul>" +
        "<li><strong>1 / 2</strong> or tap a valve pad \u2014 feed Port or Starboard diver</li>" +
        "<li><strong>SPACE</strong> or STOKE pad \u2014 drive the boiler to fill the manifold (mind the heat!)</li>" +
        "<li><strong>Q / E</strong> \u2014 jiggle a kinked or burst hose clear</li>" +
        "<li>Keep each chest-gauge in the green to work; the red bursts hoses, an empty suit fades a man</li>" +
        "<li>Quota raised? Hold <strong>W</strong> or HAUL to wind both men up before the gale breaks</li>" +
        "</ul>",
      btn: "START DIVE",
      action: () => startDive(),
    });
  }

  function stopHiss() {
    if (AC) {
      if (hissG) hissG.gain.value = 0;
      if (ventG) ventG.gain.value = 0;
    }
  }

  function setPaused(v) {
    if (phase !== "diving") return;
    paused = v;
    pauseBtn.textContent = v ? "RESUME" : "PAUSE";
    if (v) {
      stopHiss();
      showCard({
        title: "Paused",
        tag: '"The sea waits for no man, but the card game does."',
        body: "<p>Dive suspended. The glass keeps falling only in your imagination.</p>",
        btn: "RESUME",
        action: () => setPaused(false),
      });
    } else hideCard();
  }

  /* ── input ──────────────────────────────────────────── */

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ([" ", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k))
      e.preventDefault();
    if (e.repeat) return;
    if (k === "m") {
      toggleSound();
      return;
    }
    if (k === "p") {
      setPaused(!paused);
      return;
    }
    if (k === "r") {
      if (phase === "diving") startDive();
      return;
    }
    if (overlay.classList.contains("show")) {
      if (k === "enter" || k === " ") {
        if (goAction) goAction();
      }
      return;
    }
    if (phase !== "diving" || paused) return;
    if (k === "1" || k === "arrowleft") toggleFeed(0);
    else if (k === "2" || k === "arrowright") toggleFeed(1);
    else if (k === "q") jigglePress(0);
    else if (k === "e") jigglePress(1);
    else if (k === " ") D.stoking = true;
    else if (k === "w" || k === "arrowup") {
      if (D.quotaDone) D.hauling = true;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (!D) return;
    const k = e.key.toLowerCase();
    if (k === " ") D.stoking = false;
    if (k === "w" || k === "arrowup") D.hauling = false;
  });

  function toggleSound() {
    muted = !muted;
    soundBtn.setAttribute("aria-pressed", String(muted));
    soundBtn.textContent = muted ? "SOUND OFF" : "SOUND";
    if (master) master.gain.value = muted ? 0 : 0.85;
  }
  soundBtn.addEventListener("click", toggleSound);
  pauseBtn.addEventListener("click", () => setPaused(!paused));
  restartBtn.addEventListener("click", () => {
    if (phase === "diving") startDive();
  });

  goBtn.addEventListener("click", () => {
    if (goAction) goAction();
  });

  function bindPadHold(el, on, off) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {}
      }
      on();
    });
    const up = () => off && off();
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  bindPadHold(
    padStoke,
    () => {
      if (D) D.stoking = true;
    },
    () => {
      if (D) D.stoking = false;
    },
  );

  bindPadHold(
    padHaul,
    () => {
      if (D && D.quotaDone) D.hauling = true;
    },
    () => {
      if (D) D.hauling = false;
    },
  );
  padPort.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    toggleFeed(0);
  });
  padStar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    toggleFeed(1);
  });
  jigPort.addEventListener("click", () => jigglePress(0));
  jigStar.addEventListener("click", () => jigglePress(1));

  CV.addEventListener("pointerdown", (e) => {
    if (phase !== "diving" || paused || !D) return;
    const r = CV.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * W) / r.width,
      my = ((e.clientY - r.top) * H) / r.height;
    for (let i = 0; i < 2; i++) {
      const dv = D.divers[i];
      if ((mx - dv.x) ** 2 + (my - (dv.y - 20)) ** 2 < 52 * 52) {
        toggleFeed(i);
        return;
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "diving" && !paused) setPaused(true);
  });

  function syncPads() {
    if (!D) return;
    padPort.classList.toggle("fed", D.fed === 0);
    padStar.classList.toggle("fed", D.fed === 1);
    padStoke.classList.toggle("hot", !!D.venting);
  }

  /* test hooks */
  window.__mfInfo = () => ({
    phase,
    paused,
    diveIdx,
    t: D ? D.t : 0,
    storm: D ? D.storm : 0,
    M: D ? D.M : 0,
    heat: D ? D.heat : 0,
    fed: D ? D.fed : -1,
    quotaDone: D ? D.quotaDone : false,
    haul: D ? D.haul : 0,
    bursts: D ? D.bursts : 0,
    divers: D ? D.divers.map((v) => ({ Dp: v.Dp, S: v.S })) : [],
    lines: D ? D.lines.map((l) => ({ kink: l.kink, burst: l.burst })) : [],
  });
  window.__mfAct = (act) => {
    if (!D || phase !== "diving") return;
    if (act === "feed0") toggleFeed(0);
    else if (act === "feed1") toggleFeed(1);
    else if (act === "stokeOn") D.stoking = true;
    else if (act === "stokeOff") D.stoking = false;
    else if (act === "jiggle0") jigglePress(0);
    else if (act === "jiggle1") jigglePress(1);
    else if (act === "haulOn") D.hauling = true;
    else if (act === "haulOff") D.hauling = false;
    else if (act === "forceKink0") {
      D.lines[0].kink = true;
      D.lines[0].fixes = 4;
    } else if (act === "forceStrain0") {
      D.lines[0].strain = 2;
      D.fed = 0;
      D.divers[0].Dp = 95;
    } else if (act === "setLowAir") {
      D.divers[0].S = 3;
      D.divers[1].S = 3;
    } else if (act === "endStorm") {
      D.t = D.cfg.stormT;
    }
  };

  /* ── rendering helpers ──────────────────────────────── */

  function hexRGB(h) {
    return [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
  }
  function mix(c1, c2, k) {
    const a = hexRGB(c1),
      b = hexRGB(c2);
    return (
      "rgb(" +
      Math.round(lerp(a[0], b[0], k)) +
      "," +
      Math.round(lerp(a[1], b[1], k)) +
      "," +
      Math.round(lerp(a[2], b[2], k)) +
      ")"
    );
  }

  let rockA = 0,
    rockY = 0;
  function computeRock() {
    const s = D ? D.storm : 0;
    rockA =
      Math.sin(cosT * 0.9) * 0.02 * (0.3 + s) +
      Math.sin(cosT * 2.3) * 0.006 * s;
    rockY = Math.sin(cosT * 1.3) * (2 + 5 * s);
  }
  function rockPoint(x, y) {
    const cx = 480,
      cy = 200;
    const dx = x - cx,
      dy = y - cy;
    const ca = Math.cos(rockA),
      sa = Math.sin(rockA);
    return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca + rockY];
  }

  function waveY(x) {
    const s = D ? D.storm : 0;
    return (
      WATER +
      Math.sin(x * 0.021 + cosT * 1.7) * (3 + 7 * s) +
      Math.sin(x * 0.043 - cosT * 2.3) * (1.5 + 3.5 * s)
    );
  }

  function roundRect(x, y, w, h, r) {
    CX.beginPath();
    CX.moveTo(x + r, y);
    CX.arcTo(x + w, y, x + w, y + h, r);
    CX.arcTo(x + w, y + h, x, y + h, r);
    CX.arcTo(x, y + h, x, y, r);
    CX.arcTo(x, y, x + w, y, r);
    CX.closePath();
  }

  /* ── render: sky & topside ──────────────────────────── */

  function drawSky() {
    const s = D ? D.storm : 0;
    const g = CX.createLinearGradient(0, 0, 0, WATER);
    g.addColorStop(0, mix("#31506b", "#3a4048", s));
    g.addColorStop(1, mix("#93a4b5", "#5d636b", s));
    CX.fillStyle = g;
    CX.fillRect(0, 0, W, WATER + 12);

    /* clouds */
    CX.fillStyle = "rgba(40,48,58," + (0.22 + 0.5 * s) + ")";
    for (let i = 0; i < 5; i++) {
      const cx0 = ((i * 233 + cosT * (9 + i * 3) * (1 + s)) % (W + 260)) - 130;
      const cy0 = 26 + (i % 3) * 26 + Math.sin(i * 2.1) * 8;
      CX.beginPath();
      CX.ellipse(cx0, cy0, 74 + i * 9, 15 + (i % 2) * 7, 0, 0, TAU);
      CX.fill();
      CX.beginPath();
      CX.ellipse(cx0 + 44, cy0 + 6, 46, 11, 0, 0, TAU);
      CX.fill();
    }

    /* rain squall */
    if (s > 0.82) {
      CX.strokeStyle = "rgba(190,205,215,0.25)";
      CX.lineWidth = 1;
      CX.beginPath();
      for (let i = 0; i < 46; i++) {
        const rx = (i * 137 + cosT * 520) % W,
          ry = (i * 89 + cosT * 640) % (WATER - 20);
        CX.moveTo(rx, ry);
        CX.lineTo(rx - 7, ry + 15);
      }
      CX.stroke();
    }
  }

  function drawBarge() {
    computeRock();
    CX.save();
    CX.translate(480, 200 + rockY);
    CX.rotate(rockA);
    CX.translate(-480, -200);

    /* hull */
    CX.fillStyle = "#20262b";
    CX.beginPath();
    CX.moveTo(206, 186);
    CX.lineTo(754, 186);
    CX.lineTo(738, 232);
    CX.lineTo(222, 232);
    CX.closePath();
    CX.fill();
    CX.strokeStyle = "#39424a";
    CX.lineWidth = 2;
    CX.strokeRect(214, 192, 532, 10);
    /* gunwale */
    CX.fillStyle = "#2c333a";
    CX.fillRect(198, 178, 564, 10);

    /* derrick */
    CX.strokeStyle = "#4a3d28";
    CX.lineWidth = 6;
    CX.beginPath();
    CX.moveTo(480, 182);
    CX.lineTo(452, 66);
    CX.stroke();
    CX.lineWidth = 4;
    CX.beginPath();
    CX.moveTo(452, 66);
    CX.lineTo(560, 108);
    CX.stroke();
    CX.beginPath();
    CX.moveTo(452, 66);
    CX.lineTo(418, 120);
    CX.stroke();
    /* winch drum */
    const wx = 430,
      wy = 176;
    CX.fillStyle = "#5a4a2e";
    CX.beginPath();
    CX.arc(wx, wy, 15, 0, TAU);
    CX.fill();
    CX.strokeStyle = "#8a744a";
    CX.lineWidth = 2;
    const spin = D && D.hauling ? cosT * 9 : 0;
    CX.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * TAU) / 3;
      CX.moveTo(wx, wy);
      CX.lineTo(wx + Math.cos(a) * 12, wy + Math.sin(a) * 12);
    }
    CX.stroke();

    /* boiler */
    CX.fillStyle = "#37312a";
    roundRect(268, 148, 76, 38, 5);
    CX.fill();
    CX.strokeStyle = "#575043";
    CX.lineWidth = 2;
    CX.stroke();
    /* chimney */
    CX.fillStyle = "#2c2721";
    CX.fillRect(298, 112, 16, 38);
    /* firebox glow */
    const heat = D ? D.heat : 0;
    const fg = CX.createRadialGradient(306, 172, 2, 306, 172, 26);
    fg.addColorStop(
      0,
      "rgba(255," + Math.round(120 + heat) + ",60," + (0.25 + heat / 130) + ")",
    );
    fg.addColorStop(1, "rgba(255,120,60,0)");
    CX.fillStyle = fg;
    CX.fillRect(276, 156, 60, 28);
    /* heat bar */
    CX.fillStyle = "#141a1f";
    CX.fillRect(270, 138, 72, 6);
    CX.fillStyle = heat > 84 ? "#d9483f" : "#c9a24b";
    CX.fillRect(270, 138, (72 * heat) / 100, 6);
    if (D && D.venting && Math.floor(cosT * 6) % 2 === 0) {
      CX.fillStyle = "#ff8d7a";
      CX.font = "bold 10px Georgia,serif";
      CX.fillText("VENTING", 350, 146);
    }

    CX.restore();
  }

  /* manifold post + gauge — world space so hoses meet it exactly */
  function drawManifold() {
    const mp = rockPoint(588, 176);
    CX.strokeStyle = "#4a3d28";
    CX.lineWidth = 5;
    CX.beginPath();
    CX.moveTo(mp[0], mp[1] + 8);
    CX.lineTo(mp[0], mp[1]);
    CX.stroke();
    CX.fillStyle = "#8a744a";
    CX.beginPath();
    CX.arc(mp[0], mp[1], 17, 0, TAU);
    CX.fill();
    CX.strokeStyle = "#3c3320";
    CX.lineWidth = 1.5;
    CX.stroke();
    CX.fillStyle = "#10202c";
    CX.beginPath();
    CX.arc(mp[0], mp[1], 13, 0, TAU);
    CX.fill();
    const mv = D ? D.M : 60;
    const ma = Math.PI * 0.75 + 1.5 * Math.PI * (mv / 100);
    CX.strokeStyle = "#e8dcc0";
    CX.lineWidth = 2;
    CX.beginPath();
    CX.moveTo(mp[0], mp[1]);
    CX.lineTo(mp[0] + Math.cos(ma) * 10, mp[1] + Math.sin(ma) * 10);
    CX.stroke();
    CX.fillStyle = "#c9a24b";
    CX.font = "bold 9px Georgia,serif";
    CX.textAlign = "center";
    CX.fillText("AIR", mp[0], mp[1] + 30);
    CX.textAlign = "left";
  }

  /* ── render: sea & depths ───────────────────────────── */

  function drawSea() {
    const s = D ? D.storm : 0;
    CX.beginPath();
    CX.moveTo(0, waveY(0));
    for (let x = 16; x <= W; x += 16) CX.lineTo(x, waveY(x));
    CX.lineTo(W, H);
    CX.lineTo(0, H);
    CX.closePath();
    const g = CX.createLinearGradient(0, WATER - 10, 0, H);
    g.addColorStop(0, mix("#2a6b8f", "#3d5a6b", s));
    g.addColorStop(0.35, mix("#14567a", "#20465c", s));
    g.addColorStop(1, mix("#04121f", "#020a12", s));
    CX.globalAlpha = 0.94;
    CX.fillStyle = g;
    CX.fill();
    CX.globalAlpha = 1;
    /* foam line */
    CX.strokeStyle = "rgba(235,240,240," + (0.35 - 0.15 * s) + ")";
    CX.lineWidth = 2;
    CX.beginPath();
    CX.moveTo(0, waveY(0));
    for (let x = 16; x <= W; x += 16) CX.lineTo(x, waveY(x));
    CX.stroke();

    /* god rays */
    CX.save();
    CX.globalAlpha = 0.05 + 0.03 * (1 - s);
    CX.fillStyle = "#cfe6ef";
    for (let i = 0; i < 3; i++) {
      const bx = 240 + i * 210 + Math.sin(cosT * 0.4 + i) * 30;
      CX.beginPath();
      CX.moveTo(bx - 20, WATER);
      CX.lineTo(bx + 20, WATER);
      CX.lineTo(bx + 90, SAND + 30);
      CX.lineTo(bx - 60, SAND + 30);
      CX.closePath();
      CX.fill();
    }
    CX.restore();
  }

  function drawSandAndWreck() {
    /* seabed */
    CX.fillStyle = "#1c2a26";
    CX.beginPath();
    CX.moveTo(0, SAND + 14);
    for (let x = 0; x <= W; x += 40)
      CX.lineTo(x, SAND + Math.sin(x * 0.02) * 6);
    CX.lineTo(W, H);
    CX.lineTo(0, H);
    CX.closePath();
    CX.fill();

    /* weed tufts */
    CX.strokeStyle = "rgba(52,92,66,0.7)";
    CX.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const bx = 60 + i * 105,
        sw = Math.sin(cosT * 1.4 + i) * 5;
      CX.beginPath();
      CX.moveTo(bx, SAND + 4);
      CX.quadraticCurveTo(bx + sw, SAND - 12, bx + sw * 1.6, SAND - 22);
      CX.stroke();
    }

    /* the Cygnet */
    CX.save();
    CX.translate(480, 512);
    CX.rotate(-0.055);
    CX.fillStyle = "#242e26";
    CX.beginPath();
    CX.moveTo(-370, 30);
    CX.quadraticCurveTo(-300, -34, -140, -40);
    CX.lineTo(240, -34);
    CX.quadraticCurveTo(330, -26, 352, 22);
    CX.quadraticCurveTo(0, 54, -370, 30);
    CX.closePath();
    CX.fill();
    CX.strokeStyle = "#161d17";
    CX.lineWidth = 3;
    CX.stroke();
    /* ribs */
    CX.strokeStyle = "rgba(16,22,16,0.8)";
    CX.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const rx = -310 + i * 82;
      CX.beginPath();
      CX.moveTo(rx, -36 + Math.abs(rx) * 0.02);
      CX.lineTo(rx + 6, 34);
      CX.stroke();
    }
    /* fallen mast */
    CX.strokeStyle = "#1c241d";
    CX.lineWidth = 7;
    CX.beginPath();
    CX.moveTo(120, -30);
    CX.lineTo(330, -86);
    CX.stroke();
    CX.restore();

    /* salvage items */
    if (!D) return;
    for (const it of D.items) {
      if (it.kind === "port") {
        CX.fillStyle = "#10161a";
        CX.beginPath();
        CX.arc(it.x, it.y, 11, 0, TAU);
        CX.fill();
        CX.lineWidth = 3;
        CX.strokeStyle = it.done ? "#c9a24b" : "#6b5636";
        CX.beginPath();
        CX.arc(it.x, it.y, 11, 0, TAU);
        CX.stroke();
        if (!it.done && it.work > 0) {
          CX.strokeStyle = "#e8c56a";
          CX.lineWidth = 3.5;
          CX.beginPath();
          CX.arc(
            it.x,
            it.y,
            15,
            -Math.PI / 2,
            -Math.PI / 2 + TAU * (it.work / it.need),
          );
          CX.stroke();
        }
        if (it.done) {
          const gg = CX.createRadialGradient(it.x, it.y, 2, it.x, it.y, 16);
          gg.addColorStop(0, "rgba(255,225,150,0.5)");
          gg.addColorStop(1, "rgba(255,225,150,0)");
          CX.fillStyle = gg;
          CX.beginPath();
          CX.arc(it.x, it.y, 16, 0, TAU);
          CX.fill();
        }
      } else {
        CX.save();
        CX.translate(it.x, it.y);
        CX.fillStyle = "#2c2620";
        roundRect(-19, -12, 38, 24, 3);
        CX.fill();
        CX.strokeStyle = "#6b5636";
        CX.lineWidth = 2.5;
        CX.stroke();
        CX.beginPath();
        CX.moveTo(-19, -3);
        CX.lineTo(19, -3);
        CX.stroke();
        CX.fillStyle = "#c9a24b";
        CX.fillRect(-3, -7, 6, 8);
        if (!it.done && it.work > 0) {
          CX.strokeStyle = "#e8c56a";
          CX.lineWidth = 3.5;
          CX.beginPath();
          CX.arc(
            0,
            0,
            24,
            -Math.PI / 2,
            -Math.PI / 2 + TAU * (it.work / it.need),
          );
          CX.stroke();
        }
        if (it.done) {
          CX.fillStyle = "rgba(255,225,150,0.75)";
          CX.font = "bold 13px Georgia,serif";
          CX.textAlign = "center";
          CX.fillText("\u00a4", 0, -18);
          CX.textAlign = "left";
        }
        CX.restore();
      }
    }
  }

  /* ── render: hoses & divers ─────────────────────────── */

  function hosePath(i) {
    const dv = D.divers[i];
    const mp = rockPoint(588, 186);
    const sx = dv.x + 2 * dv.face,
      sy = dv.y - 12;
    const sway = Math.sin(cosT * 1.1 + i * 2.4) * 14;
    const cp1x = mp[0] + (i ? 60 : -40) + sway * 0.4,
      cp1y = mp[1] + 130;
    const cp2x = sx + (i ? 46 : -46) + sway,
      cp2y = sy - 120;
    return { mp, sx, sy, cp1x, cp1y, cp2x, cp2y };
  }

  function drawHose(i) {
    const ln = D.lines[i];
    const hp = hosePath(i);
    const flowing = D.fed === i && !ln.kink && !ln.burst && D.M > 2;

    CX.strokeStyle = "#33291d";
    CX.lineWidth = 5;
    CX.lineCap = "round";

    if (ln.burst) {
      /* stub from manifold, torn end whipping */
      CX.beginPath();
      CX.moveTo(hp.mp[0], hp.mp[1]);
      CX.bezierCurveTo(
        hp.cp1x,
        hp.cp1y,
        hp.mp[0] + 20,
        hp.cp1y - 40,
        hp.mp[0] + (i ? 70 : -60),
        hp.cp1y - 60,
      );
      CX.stroke();
      /* stub on diver */
      CX.beginPath();
      CX.moveTo(hp.sx, hp.sy);
      CX.lineTo(hp.sx + (i ? 18 : -18), hp.sy - 26);
      CX.stroke();
      /* escaping air */
      const bx = hp.mp[0] + (i ? 70 : -60),
        by = hp.cp1y - 60;
      if (D.M > 3 && Math.random() < 0.5) bubbleAt(bx, by, rnd(2, 4.5));
    } else if (ln.kink) {
      CX.beginPath();
      CX.moveTo(hp.mp[0], hp.mp[1]);
      const kx = (hp.mp[0] + hp.sx) / 2 + Math.sin(cosT * 2 + i) * 8,
        ky = (hp.mp[1] + hp.sy) / 2;
      CX.bezierCurveTo(hp.cp1x, hp.cp1y, kx - 14, ky - 10, kx, ky);
      CX.stroke();
      CX.beginPath();
      CX.moveTo(hp.sx, hp.sy);
      CX.bezierCurveTo(hp.cp2x, hp.cp2y, kx + 14, ky + 10, kx, ky);
      CX.stroke();
      /* the knot */
      CX.strokeStyle = "#d9483f";
      CX.lineWidth = 2.5;
      CX.beginPath();
      CX.arc(kx, ky, 7, cosT * 4, cosT * 4 + 4.6);
      CX.stroke();
    } else {
      CX.beginPath();
      CX.moveTo(hp.mp[0], hp.mp[1]);
      CX.bezierCurveTo(hp.cp1x, hp.cp1y, hp.cp2x, hp.cp2y, hp.sx, hp.sy);
      CX.stroke();
      if (flowing) {
        CX.strokeStyle = "rgba(212,180,110,0.55)";
        CX.lineWidth = 1.8;
        CX.setLineDash([7, 9]);
        CX.lineDashOffset = -cosT * 60;
        CX.beginPath();
        CX.moveTo(hp.mp[0], hp.mp[1]);
        CX.bezierCurveTo(hp.cp1x, hp.cp1y, hp.cp2x, hp.cp2y, hp.sx, hp.sy);
        CX.stroke();
        CX.setLineDash([]);
      }
    }
    CX.lineCap = "butt";
  }

  function drawDiver(i) {
    const dv = D.divers[i],
      ln = D.lines[i];
    const bob = Math.sin(cosT * 1.6 + i * 2.1) * 3;
    const x = dv.x,
      y = dv.y + bob;
    const f = dv.face;

    /* tether to winch */
    const wp = rockPoint(430, 176);
    CX.strokeStyle = "rgba(220,215,195,0.28)";
    CX.lineWidth = 1;
    CX.beginPath();
    CX.moveTo(wp[0], wp[1]);
    CX.lineTo(x, y - 30);
    CX.stroke();

    /* legs */
    CX.strokeStyle = "#1d2830";
    CX.lineWidth = 5;
    CX.beginPath();
    CX.moveTo(x - 3, y + 16);
    CX.lineTo(x - 6 + Math.sin(cosT * 2 + i) * 4, y + 30);
    CX.moveTo(x + 3, y + 16);
    CX.lineTo(x + 7 - Math.sin(cosT * 2 + i) * 4, y + 30);
    CX.stroke();

    /* tank coloured by reserve */
    const sv = dv.S;
    CX.fillStyle = sv > 50 ? "#3f6b46" : sv > 25 ? "#96803a" : "#8a3b30";
    roundRect(x - f * 16 - 4, y - 6, 8, 20, 3);
    CX.fill();
    CX.strokeStyle = "#131c22";
    CX.lineWidth = 1.5;
    CX.stroke();

    /* torso */
    CX.fillStyle = "#2b3a44";
    roundRect(x - 9, y - 10, 18, 27, 5);
    CX.fill();
    CX.strokeStyle = "#16222b";
    CX.lineWidth = 2;
    CX.stroke();
    /* corselet */
    CX.fillStyle = "#8a744a";
    CX.fillRect(x - 8, y - 13, 16, 6);

    /* arm reaching to work */
    const it = currentItem();
    const working =
      D.fed === i && !ln.kink && !ln.burst && workRate(dv.Dp) > 0 && it;
    CX.strokeStyle = "#243038";
    CX.lineWidth = 4;
    CX.beginPath();
    CX.moveTo(x + f * 6, y - 2);
    if (working) {
      const ax = lerp(x + f * 16, it.x, 0.55),
        ay = lerp(y - 2, it.y, 0.55);
      CX.lineTo(ax, ay);
    } else {
      CX.lineTo(x + f * 15, y + 8 + Math.sin(cosT * 2.2 + i * 3) * 2);
    }
    CX.stroke();

    /* helmet */
    CX.fillStyle = "#77653f";
    CX.beginPath();
    CX.arc(x, y - 24, 12.5, 0, TAU);
    CX.fill();
    CX.strokeStyle = "#3c3320";
    CX.lineWidth = 2;
    CX.stroke();
    /* faceplate */
    CX.fillStyle = "#0d1b26";
    CX.beginPath();
    CX.arc(x + f * 4, y - 24, 6.5, 0, TAU);
    CX.fill();
    CX.strokeStyle = "rgba(210,225,235,0.5)";
    CX.lineWidth = 1.2;
    CX.beginPath();
    CX.arc(x + f * 4, y - 24, 6.5, -2.4, -0.9);
    CX.stroke();
    /* side valve */
    CX.fillStyle = "#c9a24b";
    CX.beginPath();
    CX.arc(x - f * 9, y - 22, 2.4, 0, TAU);
    CX.fill();

    /* low-air warning halo */
    if (sv < 25 && phase === "diving" && Math.floor(cosT * 3) % 2 === 0) {
      CX.strokeStyle = "rgba(217,72,63,0.8)";
      CX.lineWidth = 2;
      CX.beginPath();
      CX.arc(x, y - 12, 26 + Math.sin(cosT * 6) * 3, 0, TAU);
      CX.stroke();
    }
    /* strain sparks */
    if (ln.strain > 0.25 && Math.random() < 0.3)
      sparksAt(x + rnd(-8, 8), y - 34, 1, "#ff9a8a");
  }

  function drawParticles() {
    for (const b of D.bubbles) {
      CX.strokeStyle = "rgba(205,230,240," + Math.min(0.7, b.t) + ")";
      CX.lineWidth = 1;
      CX.beginPath();
      CX.arc(b.x, b.y, b.r, 0, TAU);
      CX.stroke();
    }
    for (const s of D.sparks) {
      CX.fillStyle = s.col;
      CX.globalAlpha = Math.min(1, s.t * 3);
      CX.fillRect(s.x - 1.2, s.y - 1.2, 2.4, 2.4);
    }
    CX.globalAlpha = 1;
    for (const sm of D.smoke) {
      CX.fillStyle = "rgba(120,120,118," + sm.t * 0.16 + ")";
      CX.beginPath();
      CX.arc(sm.x, sm.y, sm.r, 0, TAU);
      CX.fill();
    }
  }

  /* ── render: HUD ────────────────────────────────────── */

  function drawPanel(i) {
    const dv = D.divers[i],
      ln = D.lines[i];
    const sv = dv.S;
    const pw = 196,
      ph = 138;
    const px = i ? W - pw - 14 : 14,
      py = 12;

    CX.fillStyle = "rgba(6,14,22,0.8)";
    roundRect(px, py, pw, ph, 8);
    CX.fill();
    CX.strokeStyle = "rgba(201,162,75,0.4)";
    CX.lineWidth = 1;
    CX.stroke();

    CX.fillStyle = "#c9a24b";
    CX.font = "bold 12px Georgia,serif";
    CX.textAlign = "left";
    CX.fillText(
      (i ? "STARBOARD" : "PORT") + " \u2014 " + dv.name,
      px + 12,
      py + 18,
    );

    /* dial */
    const dcx = px + pw / 2,
      dcy = py + 62,
      dr = 34;
    CX.fillStyle = "#0b141c";
    CX.beginPath();
    CX.arc(dcx, dcy, dr, 0, TAU);
    CX.fill();
    CX.strokeStyle = "#57503e";
    CX.lineWidth = 1.5;
    CX.stroke();

    const band = (v0, v1, col) => {
      CX.strokeStyle = col;
      CX.lineWidth = 6;
      CX.beginPath();
      CX.arc(
        dcx,
        dcy,
        dr - 6,
        Math.PI * 0.75 + 1.5 * Math.PI * (v0 / 120),
        Math.PI * 0.75 + 1.5 * Math.PI * (v1 / 120),
      );
      CX.stroke();
    };
    band(0, 25, "rgba(217,72,63,0.75)");
    band(25, 45, "rgba(201,162,75,0.6)");
    band(45, 75, "rgba(88,165,92,0.8)");
    band(75, 88, "rgba(201,162,75,0.6)");
    band(88, 120, "rgba(217,72,63,0.85)");
    /* strain flash */
    if (ln.strain > 0.1 && Math.floor(cosT * 8) % 2 === 0)
      band(88, 120, "rgba(255,120,100,1)");

    /* ticks */
    CX.strokeStyle = "#8a744a";
    CX.lineWidth = 1;
    for (const tv of [0, 25, 45, 75, 88, 120]) {
      const a = Math.PI * 0.75 + 1.5 * Math.PI * (tv / 120);
      CX.beginPath();
      CX.moveTo(dcx + Math.cos(a) * (dr - 1), dcy + Math.sin(a) * (dr - 1));
      CX.lineTo(dcx + Math.cos(a) * (dr - 8), dcy + Math.sin(a) * (dr - 8));
      CX.stroke();
    }
    /* needle with storm wobble */
    const wob = D.cfg.wobble * Math.sin(cosT * 7.3 + i * 4) * 2.2;
    const na =
      Math.PI * 0.75 + 1.5 * Math.PI * (clamp(dv.Dp + wob, 0, 120) / 120);
    CX.strokeStyle = "#e8dcc0";
    CX.lineWidth = 2.4;
    CX.beginPath();
    CX.moveTo(dcx - Math.cos(na) * 6, dcy - Math.sin(na) * 6);
    CX.lineTo(dcx + Math.cos(na) * (dr - 10), dcy + Math.sin(na) * (dr - 10));
    CX.stroke();
    CX.fillStyle = "#c9a24b";
    CX.beginPath();
    CX.arc(dcx, dcy, 3, 0, TAU);
    CX.fill();

    /* psi readout */
    CX.fillStyle = "#e8dcc0";
    CX.font = "bold 11px monospace";
    CX.fillText(Math.round(dv.Dp) + "psi", dcx + dr + 8, py + 52);

    /* reserve bar */
    CX.fillStyle = "#8a744a";
    CX.font = "bold 9px Georgia,serif";
    CX.fillText("SUIT AIR", px + 12, py + 116);
    CX.fillStyle = "#141a1f";
    CX.fillRect(px + 62, py + 108, 122, 9);
    CX.fillStyle = sv > 50 ? "#58a55c" : sv > 25 ? "#c9a24b" : "#d9483f";
    CX.fillRect(px + 62, py + 108, (122 * sv) / 100, 9);
    CX.strokeStyle = "rgba(232,220,192,0.3)";
    CX.strokeRect(px + 62, py + 108, 122, 9);

    /* status line */
    let st = "STANDBY",
      col = "rgba(232,220,192,0.5)";
    if (ln.burst) {
      st = "BURST \u2014 PATCH IT";
      col = "#ff8d7a";
    } else if (ln.kink) {
      st = "KINKED \u2014 JIGGLE (" + (i ? "E" : "Q") + ")";
      col = "#ffcf87";
    } else if (D.fed === i) {
      st = workRate(dv.Dp) > 0 ? "WORKING" : "FED";
      col = workRate(dv.Dp) > 0 ? "#9fd39f" : "#c9a24b";
    }
    CX.fillStyle = col;
    CX.font = "bold 10px Georgia,serif";
    CX.textAlign = "right";
    CX.fillText(st, px + pw - 10, py + 126);
    CX.textAlign = "left";
  }

  function diveValueSoFar() {
    let v = 0;
    for (const it of D.items) if (it.done) v += it.kind === "port" ? 40 : 150;
    return v;
  }

  function drawHud() {
    /* storm glass */
    const bx = 300,
      bw = 360,
      by = 14,
      bh = 18;
    CX.fillStyle = "rgba(6,14,22,0.8)";
    roundRect(bx - 6, by - 4, bw + 12, bh + 8, 5);
    CX.fill();
    CX.strokeStyle = "rgba(201,162,75,0.4)";
    CX.stroke();
    CX.fillStyle = "#141a1f";
    CX.fillRect(bx, by, bw, bh);
    const sg = CX.createLinearGradient(bx, 0, bx + bw, 0);
    sg.addColorStop(0, "#58a55c");
    sg.addColorStop(0.55, "#c9a24b");
    sg.addColorStop(1, "#d9483f");
    CX.fillStyle = sg;
    CX.fillRect(bx, by, bw * D.storm, bh);
    for (let q = 1; q < 4; q++) {
      CX.strokeStyle = "rgba(10,20,32,0.6)";
      CX.beginPath();
      CX.moveTo(bx + (bw * q) / 4, by);
      CX.lineTo(bx + (bw * q) / 4, by + bh);
      CX.stroke();
    }
    CX.fillStyle = "#e8dcc0";
    CX.font = "bold 9px Georgia,serif";
    CX.fillText("GALE", bx - 4, by + 13);
    CX.textAlign = "right";
    CX.fillText(fmtTime(D.cfg.stormT - D.t), bx + bw + 34, by + 13);
    CX.textAlign = "left";
    CX.fillStyle = "rgba(232,220,192,0.75)";
    CX.font = "italic 11px Georgia,serif";
    CX.textAlign = "center";
    CX.fillText(D.cfg.name, W / 2, by + bh + 18);
    CX.textAlign = "left";

    /* quota chips */
    const chips = D.items;
    const cw = chips.length * 26;
    let qx = W / 2 - cw / 2 + 8;
    CX.fillStyle = "rgba(232,220,192,0.6)";
    CX.font = "bold 9px Georgia,serif";
    CX.fillText("QUOTA", qx - 52, 66);
    for (const it of chips) {
      if (it.kind === "port") {
        CX.strokeStyle = it.done ? "#c9a24b" : "rgba(232,220,192,0.5)";
        CX.lineWidth = 1.6;
        CX.beginPath();
        CX.arc(qx, 62, 7, 0, TAU);
        CX.stroke();
        if (it.done) {
          CX.fillStyle = "#c9a24b";
          CX.beginPath();
          CX.arc(qx, 62, 4, 0, TAU);
          CX.fill();
        }
      } else {
        CX.strokeStyle = it.done ? "#c9a24b" : "rgba(232,220,192,0.5)";
        CX.lineWidth = 1.6;
        CX.strokeRect(qx - 6, 56, 12, 12);
        if (it.done) {
          CX.fillStyle = "#c9a24b";
          CX.fillRect(qx - 3, 59, 6, 6);
        }
      }
      qx += 26;
    }
    /* season score — tucked under the port panel */
    CX.fillStyle = "#c9a24b";
    CX.font = "bold 11px Georgia,serif";
    CX.fillText("SEASON  " + moneyStr(seasonScore + diveValueSoFar()), 14, 166);

    drawPanel(0);
    drawPanel(1);

    /* toasts */
    let ty = 150;
    CX.textAlign = "center";
    for (const t of D.toasts) {
      CX.globalAlpha = Math.min(1, t.t * 1.6);
      CX.font = "bold 13px Georgia,serif";
      const tw = CX.measureText(t.txt).width;
      CX.fillStyle = "rgba(6,14,22,0.72)";
      roundRect(W / 2 - tw / 2 - 12, ty - 15, tw + 24, 22, 5);
      CX.fill();
      CX.fillStyle = t.col;
      CX.fillText(t.txt, W / 2, ty);
      ty += 28;
    }
    CX.globalAlpha = 1;
    CX.textAlign = "left";
  }

  /* ── main render ────────────────────────────────────── */

  function render() {
    CX.clearRect(0, 0, W, H);
    drawSky();
    drawBarge();
    drawManifold();
    drawSea();
    drawSandAndWreck();
    if (D) {
      drawHose(0);
      drawHose(1);
      drawDiver(0);
      drawDiver(1);
      drawParticles();
    }
    if (phase === "diving") {
      drawHud();
      syncPads();
      jigPort.hidden = !(D.lines[0].kink || D.lines[0].burst);
      jigStar.hidden = !(D.lines[1].kink || D.lines[1].burst);
    } else {
      jigPort.hidden = true;
      jigStar.hidden = true;
    }
  }

  /* ── loop ───────────────────────────────────────────── */

  let lastTs = 0;
  function loop(ts) {
    const dt = clamp((ts - lastTs) / 1000, 0.001, 0.05);
    lastTs = ts;
    cosT += dt;
    if (phase === "diving" && !paused) step(dt);
    else if (AC && !muted) {
      if (seaG) seaG.gain.value += (0.03 - seaG.gain.value) * 0.05;
      if (hissG) hissG.gain.value *= 0.9;
      if (ventG) ventG.gain.value *= 0.9;
    }
    render();
    requestAnimationFrame(loop);
  }

  /* ── boot ───────────────────────────────────────────── */

  toTitle();
  requestAnimationFrame(loop);
})();
