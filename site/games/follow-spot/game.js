/* Follow Spot — you run the follow spot at the Palace Theatre of Varieties.
   Keep the beam on whoever the stage manager calls, swing the gels they ask
   for, and never leave the boards dark, or the manager will end the bill. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ dom */

  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const booth = document.getElementById("booth");
  const el = (id) => document.getElementById(id);
  const ui = {
    veil: el("veil"),
    panel: el("panel"),
    cueName: el("cue-name"),
    cueNext: el("cue-next"),
    cueGel: el("cue-gel"),
    cueStreak: el("cue-streak"),
    patBar: el("pat-bar"),
    appBar: el("app-bar"),
    score: el("score"),
    btnPause: el("btn-pause"),
    btnMute: el("btn-mute"),
    btnRestart: el("btn-restart"),
    btnBump: el("btn-bump"),
  };

  const W = 960;
  const H = 620;
  const PROS = { x0: 100, y0: 112, x1: 860, y1: 600 }; /* proscenium opening */
  const FLOOR_Y = 372; /* backdrop meets boards */
  const STAGE = {
    x0: 158,
    y0: 400,
    x1: 802,
    y1: 552,
  }; /* beam / actor bounds */
  const ORIGIN = { x: 480, y: -84 }; /* spot lamp, above frame */
  const BASE_R = 66; /* pool half-width, pre-gel */
  const GRACE = 0.8; /* seconds off-target before the manager minds */
  const RATE = 24; /* max applause per second */
  const INT_LEN = 3.0; /* act-card seconds between acts */
  const GELS = [
    { name: "Open", css: "#fff4d8", rgb: [255, 244, 216] },
    { name: "Red", css: "#ff5a4a", rgb: [255, 90, 74] },
    { name: "Blue", css: "#6aa8ff", rgb: [106, 168, 255] },
    { name: "Amber", css: "#ffc14d", rgb: [255, 193, 77] },
  ];

  /* ------------------------------------------------------------- utilities */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx,
      dy = (ay - by) * 2.1; /* pools are squashed: weight y */
    return Math.sqrt(dx * dx + dy * dy);
  };

  function loadBest() {
    try {
      return Number(localStorage.getItem("followspot-best")) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      localStorage.setItem("followspot-best", String(Math.round(v)));
    } catch (e) {
      /* private mode */
    }
  }

  /* ----------------------------------------------------------------- audio */

  const snd = {
    ac: null,
    master: null,
    appl: null,
    on: true,
    init() {
      if (this.ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = this.on ? 0.85 : 0;
        this.master.connect(this.ac.destination);
        const len = this.ac.sampleRate | 0;
        const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const bp = this.ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1050;
        bp.Q.value = 0.7;
        this.appl = this.ac.createGain();
        this.appl.gain.value = 0;
        src.connect(bp);
        bp.connect(this.appl);
        this.appl.connect(this.master);
        src.start();
        this.noiseBuf = buf;
      } catch (e) {
        this.ac = null;
      }
    },
    ensure() {
      this.init();
      if (this.ac && this.ac.state === "suspended") this.ac.resume();
    },
    tone(freq, dur, type, vol, delay = 0, slideTo = 0) {
      if (!this.ac) return;
      try {
        const t = this.ac.currentTime + delay;
        const o = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.05);
      } catch (e) {
        /* never let sound break the show */
      }
    },
    noiseHit(dur, freq, vol, delay = 0) {
      if (!this.ac || !this.noiseBuf) return;
      try {
        const t = this.ac.currentTime + delay;
        const src = this.ac.createBufferSource();
        src.buffer = this.noiseBuf;
        const bp = this.ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = freq;
        bp.Q.value = 1.1;
        const g = this.ac.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.master);
        src.start(t);
        src.stop(t + dur + 0.05);
      } catch (e) {
        /* quiet */
      }
    },
    chime() {
      this.tone(1046, 0.4, "sine", 0.22);
      this.tone(1568, 0.55, "sine", 0.16, 0.09);
    },
    warn() {
      this.tone(392, 0.22, "triangle", 0.2, 0, 330);
    },
    click() {
      this.tone(2200, 0.05, "square", 0.08);
    },
    bump() {
      this.noiseHit(0.28, 2400, 0.3);
      this.tone(180, 0.3, "sine", 0.18, 0, 90);
    },
    thud() {
      this.tone(140, 0.8, "sawtooth", 0.3, 0, 46);
      this.noiseHit(0.5, 300, 0.25);
    },
    taDa() {
      const n = [523, 659, 784, 1046];
      n.forEach((f, i) => this.tone(f, 0.5, "triangle", 0.2, i * 0.13));
      this.noiseHit(1.4, 1100, 0.4, 0.5);
    },
    setApplause(level) {
      if (!this.ac || !this.appl) return;
      const v = this.on ? clamp(level, 0, 0.5) : 0;
      this.appl.gain.setTargetAtTime(v, this.ac.currentTime, 0.18);
    },
    setOn(v) {
      this.on = v;
      if (this.master) this.master.gain.value = v ? 0.85 : 0;
    },
  };

  /* ------------------------------------------------------------ the bill */

  const ACTS = [
    {
      card: "ACT I",
      play: "Miss Dolly Vane",
      note: "a ballad, sweet and steady",
      segLen: 6.6,
      cast: [
        {
          name: "Dolly Vane",
          role: "singer",
          hue: "#c85a74",
          hair: "#2a1812",
          kind: "sway",
          zone: { cx: 480, cy: 452, rx: 100, ry: 8 },
        },
      ],
    },
    {
      card: "ACT II",
      play: "Marco the Contortionist",
      note: "he folds, therefore he is",
      segLen: 6.4,
      cast: [
        {
          name: "Marco",
          role: "contortion",
          hue: "#3f8f5c",
          hair: "#101010",
          kind: "wander",
          zone: { cx: 480, cy: 470, rx: 250, ry: 60 },
        },
      ],
    },
    {
      card: "ACT III",
      play: "The Great Aldini",
      note: "prestige! watch the empty hand",
      segLen: 6.2,
      cast: [
        {
          name: "The Great Aldini",
          role: "magician",
          hue: "#2c2c38",
          hair: "#151515",
          kind: "pop",
          zone: { cx: 480, cy: 465, rx: 260, ry: 55 },
          marks: [
            [236, 470],
            [480, 442],
            [724, 472],
            [356, 520],
            [610, 522],
          ],
        },
      ],
    },
    {
      card: "ACT IV",
      play: "The Ramsgate Rovers",
      note: "two clever dogs, one smarter hen",
      segLen: 6.0,
      cast: [
        {
          name: "Rover",
          role: "dog",
          hue: "#b5813f",
          hair: "#6d4a22",
          kind: "zig",
          zone: { cx: 340, cy: 470, rx: 165, ry: 42 },
        },
        {
          name: "Patch",
          role: "dog",
          hue: "#8c8c94",
          hair: "#3c3c42",
          kind: "zig",
          zone: { cx: 630, cy: 500, rx: 155, ry: 36 },
        },
      ],
    },
    {
      card: "ACT V",
      play: "Tommy Bright",
      note: "the funny man — mind the dark bits",
      segLen: 5.8,
      blackoutSeg: 1,
      cast: [
        {
          name: "Tommy Bright",
          role: "comic",
          hue: "#b04a2a",
          hair: "#1d1208",
          kind: "burst",
          zone: { cx: 480, cy: 480, rx: 270, ry: 52 },
        },
      ],
    },
    {
      card: "ACT VI",
      play: "Madame Sylva",
      note: "levitation, gently achieved",
      segLen: 6.2,
      cast: [
        {
          name: "Madame Sylva",
          role: "medium",
          hue: "#5a5aa8",
          hair: "#141018",
          kind: "float",
          zone: { cx: 480, cy: 470, rx: 210, ry: 30 },
        },
      ],
    },
    {
      card: "FINALE",
      play: "The Full Company",
      note: "everyone at once — keep up!",
      segLen: 5.0,
      cast: [
        {
          name: "Dolly Vane",
          role: "singer",
          hue: "#c85a74",
          hair: "#2a1812",
          kind: "wander",
          zone: { cx: 300, cy: 450, rx: 120, ry: 46 },
        },
        {
          name: "The Great Aldini",
          role: "magician",
          hue: "#2c2c38",
          hair: "#151515",
          kind: "wander",
          zone: { cx: 480, cy: 500, rx: 120, ry: 40 },
        },
        {
          name: "Tommy Bright",
          role: "comic",
          hue: "#b04a2a",
          hair: "#1d1208",
          kind: "wander",
          zone: { cx: 660, cy: 455, rx: 115, ry: 46 },
        },
        {
          name: "Madame Sylva",
          role: "medium",
          hue: "#5a5aa8",
          hair: "#141018",
          kind: "float",
          zone: { cx: 480, cy: 420, rx: 200, ry: 24 },
        },
      ],
    },
  ];

  function makeActor(def) {
    return {
      def,
      name: def.name,
      role: def.role,
      hue: def.hue,
      hair: def.hair,
      kind: def.kind,
      zone: def.zone,
      marks: def.marks || null,
      x: def.zone.cx,
      y: def.zone.cy,
      vx: 0,
      vy: 0,
      ph: rand(0, Math.PI * 2),
      seed: rand(0, 100),
      walk: 0,
      dirn: Math.random() < 0.5 ? -1 : 1,
      goalX: def.zone.cx,
      goalY: def.zone.cy,
      goalT: 0,
      popT: rand(1.2, 2.4),
      fading: false,
      fade: 1,
    };
  }

  function buildShow() {
    return ACTS.map((act) => {
      const cues = [];
      const nCast = act.cast.length;
      let prev = -1;
      for (let i = 0; i * act.segLen < act.durEff(act); i++) {
        let who = 0;
        if (nCast > 1) {
          do {
            who = (Math.random() * nCast) | 0;
          } while (who === prev && nCast > 1);
        }
        prev = who;
        cues.push({
          who,
          gel:
            i >= 1 && Math.random() < 0.45
              ? 1 + ((Math.random() * 3) | 0)
              : null,
          blackout: false,
          dur: act.segLen,
        });
      }
      if (act.blackoutSeg !== undefined && cues.length > 2) {
        cues[clamp(act.blackoutSeg, 1, cues.length - 2)].blackout = true;
      }
      return { act, cast: act.cast.map(makeActor), cues };
    });
  }

  /* helper hung on each act definition: nominal length */
  for (const a of ACTS) {
    a.durEff = (self) => {
      const n = Math.max(
        2,
        Math.round(22 / self.segLen) + (self.cast.length > 2 ? 1 : 0),
      );
      return n * self.segLen;
    };
  }

  /* ------------------------------------------------------------- state */

  let state = "title"; /* title | interval | act | pause | fired | end */
  let prevState = "title";
  let paused = false;
  let show = null;
  let actIdx = 0,
    segIdx = 0,
    segT = 0,
    intT = 0,
    clock = 0;
  let approval = 78,
    score = 0,
    appSmooth = 0,
    holdT = 0,
    badT = 0,
    cueGrace = 0,
    missT = 99;
  let gel = 0,
    muted = false;
  let bumpT = 0,
    bumpCd = 0;
  let par = 0;
  let best = loadBest();
  let newRecord = false;
  const beam = { x: 480, y: 470, tx: 480, ty: 470 };
  const keys = Object.create(null);

  /* idle troupe amuses the title screen */
  let idleCast = ACTS[6].cast.map(makeActor);

  function poolR() {
    return BASE_R * (bumpT > 0 ? 1.55 : 1);
  }
  function poolRx() {
    return poolR() * 1.45;
  }
  function curShow() {
    return show ? show[actIdx] : null;
  }
  function curCue() {
    const s = curShow();
    return s ? s.cues[segIdx] : null;
  }
  function featActor() {
    const s = curShow(),
      c = curCue();
    return s && c ? s.cast[c.who] : null;
  }

  /* -------------------------------------------------------------- panels */

  function showVeil(html) {
    ui.panel.innerHTML = html;
    ui.veil.classList.remove("hidden");
  }
  function hideVeil() {
    ui.veil.classList.add("hidden");
  }

  function panelTitle() {
    showVeil(
      "<h2>Follow Spot</h2>" +
        '<p class="quote">&ldquo;Big house tonight. The spot is yours &mdash; do not lose them.&rdquo;</p>' +
        "<h3>The job</h3>" +
        "<p>The stage manager calls the turn; you lay the light on them and keep it there. " +
        "Hold them well and the house roars; wander to the wrong turn, or leave the boards bare, " +
        "and the manager&rsquo;s patience burns down. Swing the gel they ask for. In a blackout, " +
        "find them by their eyeshine.</p>" +
        "<h3>House keys</h3>" +
        '<p class="keys">' +
        "<b>Mouse / touch</b> steer the beam &nbsp;<b>WASD</b> steer too<br>" +
        "<b>1&ndash;4</b> swing a gel &nbsp;<b>Space</b> bump the iris wide<br>" +
        "<b>P</b> pause &nbsp;<b>M</b> sound &nbsp;<b>R</b> new show</p>" +
        (best > 0
          ? '<p class="big-score">Best take: ' +
            Math.round(best).toLocaleString("en-GB") +
            "</p>"
          : "") +
        '<button class="go" data-go="start">Open the Bill</button>',
    );
  }

  function panelPause() {
    showVeil(
      "<h2>Held</h2>" +
        '<p class="quote">&ldquo;Take your time. The band loves waiting.&rdquo;</p>' +
        "<p>Press <b>P</b> or the button to bring the show back.</p>" +
        '<button class="go" data-go="resume">Back to the Show</button>',
    );
  }

  function ratingStars(pct) {
    const n =
      pct >= 1.02 ? 5 : pct >= 0.82 ? 4 : pct >= 0.58 ? 3 : pct >= 0.33 ? 2 : 1;
    return { n, str: "\u2605".repeat(n) + "\u2606".repeat(5 - n) };
  }

  function panelEnd() {
    const pct = par > 0 ? score / par : 0;
    const r = ratingStars(pct);
    const quotes = [
      "&ldquo;They came for the dogs and stayed for you. Have a sherry.&rdquo;",
      "&ldquo;Clean work. The front row never knew how close it got.&rdquo;",
      "&ldquo;A shade slow on the pickups, but the house went home happy.&rdquo;",
      "&ldquo;You lit more scenery than stars tonight. Still &mdash; they clapped.&rdquo;",
      "&ldquo;We survived. The manager is looking for a new profession.&rdquo;",
    ];
    const q = [quotes[4], quotes[3], quotes[2], quotes[1], quotes[0]][r.n - 1];
    showVeil(
      "<h2>Curtain Call</h2>" +
        '<div class="stars">' +
        r.str +
        "</div>" +
        '<p class="big-score">Take: ' +
        Math.round(score).toLocaleString("en-GB") +
        (newRecord ? " &mdash; a new house record!" : "") +
        "</p>" +
        '<p class="quote">' +
        q +
        "</p>" +
        '<button class="go" data-go="start">Encore &mdash; Run It Again</button>',
    );
  }

  function panelFired() {
    showVeil(
      "<h2>House Lights Up</h2>" +
        '<p class="quote">&ldquo;Out. My aunt could follow better with her hat over her eyes.&rdquo;</p>' +
        "<p>The manager has ended the bill mid-turn. Take: " +
        Math.round(score).toLocaleString("en-GB") +
        ".</p>" +
        '<button class="go" data-go="start">Beg Another Shift</button>',
    );
  }

  ui.panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    snd.ensure();
    if (b.dataset.go === "start") startShow();
    else if (b.dataset.go === "resume") setPaused(false);
  });

  /* --------------------------------------------------------- flow control */

  function endShow(win) {
    snd.setApplause(0);
    if (win) {
      if (score > best) {
        best = score;
        saveBest(best);
        newRecord = true;
      }
      snd.taDa();
      state = "end";
      panelEnd();
    } else {
      snd.thud();
      state = "fired";
      panelFired();
    }
  }

  function setPaused(v) {
    if (v && (state === "act" || state === "interval")) {
      prevState = state;
      state = "pause";
      paused = true;
      panelPause();
      if (snd.ac && snd.ac.state === "running") snd.ac.suspend();
    } else if (!v && state === "pause") {
      state = prevState;
      paused = false;
      hideVeil();
      if (snd.ac && snd.ac.state === "suspended") snd.ac.resume();
    }
    ui.btnPause.textContent = paused ? "\u25B6" : "\u275A\u275A";
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (state === "act" || state === "interval"))
      setPaused(true);
  });

  function startShow() {
    show = buildShow();
    actIdx = 0;
    segIdx = 0;
    segT = 0;
    intT = 0;
    clock = 0;
    approval = 85;
    score = 0;
    appSmooth = 0;

    holdT = 0;
    badT = 0;
    missT = 99;
    bumpT = 0;
    bumpCd = 0;
    newRecord = false;
    par = 0;
    for (const a of show) for (const c of a.cues) par += c.dur * 14.5;
    beam.x = 480;
    beam.y = 470;
    beam.tx = 480;
    beam.ty = 470;
    gel = 0;
    refreshGelButtons();
    paused = false;
    paused = false;
    lastScoreShown = -1;
    ui.score.textContent = "0";

    ui.btnBump.classList.add("ready");
    if (snd.ac && snd.ac.state === "suspended") snd.ac.resume();
    state = "interval";
    hideVeil();
    snd.chime();
  }

  /* ------------------------------------------------------------- cue logic */

  function applyCue(first) {
    const cue = curCue();
    const s = curShow();
    if (!cue || !s) return;
    const who = s.cast[cue.who];
    ui.cueName.textContent = who.name;
    ui.cueName.style.color = GELS[cue.gel === null ? 0 : cue.gel].css;
    updateGelChip();
    cueGrace = first ? 1.6 : 1.25;
    badT = 0;
    missT = 0;
    snd.chime();
  }

  function updateGelChip() {
    const cue = curCue();
    if (!cue || cue.gel === null) {
      ui.cueGel.textContent = "";
      ui.cueGel.classList.remove("warn");
      return;
    }
    const g = GELS[cue.gel];
    const ok = cue.gel === gel;

    ui.cueGel.textContent =
      (ok ? "\u2713 " : "GEL: ") +
      g.name.toUpperCase() +
      " \u2014 key " +
      cue.gel;
    ui.cueGel.style.color = g.css;
    ui.cueGel.classList.toggle("warn", !ok);
  }

  function setGel(i) {
    if (gel === i) return;
    gel = i;
    refreshGelButtons();
    updateGelChip();
    snd.click();
  }

  function refreshGelButtons() {
    for (const b of document.querySelectorAll(".gel")) {
      b.classList.toggle("on", Number(b.dataset.gel) === gel);
    }
  }

  function tryBump() {
    if (state !== "act" || bumpCd > 0) return;
    bumpT = 0.95;
    bumpCd = 6;
    ui.btnBump.disabled = true;
    ui.btnBump.classList.remove("ready");
    snd.bump();
  }

  /* --------------------------------------------------------------- motion */

  function moveActor(a, dt, tt, sp) {
    const z = a.zone;
    const ox = a.x,
      oy = a.y;
    const s = a.seed;
    switch (a.kind) {
      case "sway":
        a.x = z.cx + Math.sin(tt * 0.8 + s) * z.rx * 0.8;
        a.y = z.cy + Math.sin(tt * 2.1 + s * 2) * 5;
        break;
      case "wander": {
        a.goalT -= dt;
        if (a.goalT <= 0) {
          a.goalX = z.cx + rand(-1, 1) * z.rx;
          a.goalY = z.cy + rand(-1, 1) * z.ry;
          a.goalT = rand(1.5, 3.2);
        }
        const k = 1 - Math.exp((-dt * 1.7) / Math.max(sp, 0.001));
        a.x += (a.goalX - a.x) * k;
        a.y += (a.goalY - a.y) * k;
        break;
      }
      case "zig": {
        a.x += a.dirn * 165 * dt * sp;
        if (a.x > z.cx + z.rx) {
          a.x = z.cx + z.rx;
          a.dirn = -1;
        }
        if (a.x < z.cx - z.rx) {
          a.x = z.cx - z.rx;
          a.dirn = 1;
        }
        a.y = z.cy + Math.abs(Math.sin(tt * 1.05 + s)) * z.ry;
        break;
      }
      case "pop": {
        if (a.fading) {
          a.fade -= dt * 3.6;
          if (a.fade <= 0) {
            a.fade = 0;
            let m;
            do {
              m = pick(a.marks);
            } while (m === a.mark && a.marks.length > 1);
            a.mark = m;
            a.x = m[0];
            a.y = m[1];
            a.fading = false;
          }
        } else {
          a.fade = Math.min(1, a.fade + dt * 2.4);
          a.popT -= dt * sp;
          if (a.popT <= 0 && a.fade >= 1) {
            a.fading = true;
            a.popT = rand(1.5, 2.6);
          }
        }
        break;
      }
      case "eight": {
        const aa = tt * 0.72 + s;
        a.x = z.cx + Math.sin(aa) * z.rx;
        a.y = z.cy + Math.sin(aa * 2) * z.ry * 0.9;
        break;
      }
      case "float": {
        a.x += a.dirn * 11 * dt * sp;
        if (a.x > z.cx + z.rx) a.dirn = -1;
        if (a.x < z.cx - z.rx) a.dirn = 1;
        const cyc = 5.4,
          p = (tt + s) % cyc;
        a.y =
          z.cy -
          (p < 1.2
            ? Math.sin((p / 1.2) * Math.PI) * 64
            : Math.sin(tt * 1.4 + s) * 4);
        break;
      }
      case "burst": {
        const cyc = 2.9,
          p = (tt + s) % cyc;
        if (p < 1.5) {
          a.x += a.dirn * 235 * dt * sp;
          if (a.x > z.cx + z.rx) {
            a.dirn = -1;
          }
          if (a.x < z.cx - z.rx) {
            a.dirn = 1;
          }
          a.y = z.cy + Math.sin(tt * 3 + s) * 6;
        } else {
          a.y = z.cy;
        }
        break;
      }
    }
    a.x = clamp(a.x, STAGE.x0 + 20, STAGE.x1 - 20);
    a.y = clamp(a.y, STAGE.y0, STAGE.y1);
    if (dt > 0) {
      const nvx = (a.x - ox) / dt,
        nvy = (a.y - oy) / dt;
      a.vx = lerp(a.vx, nvx, 0.4);
      a.vy = lerp(a.vy, nvy, 0.4);
    }
    a.walk += Math.hypot(a.vx, a.vy) * dt * 0.055;
    a.ph += dt * (1.6 + Math.hypot(a.vx, a.vy) * 0.006);
  }

  /* -------------------------------------------------------------- update */

  function update(dt) {
    clock += dt;
    if (bumpT > 0) bumpT -= dt;
    if (bumpCd > 0) {
      bumpCd -= dt;
      if (bumpCd <= 0 && state === "act") {
        ui.btnBump.disabled = false;
        ui.btnBump.classList.add("ready");
      }
    }

    if (state === "title" || state === "end" || state === "fired") {
      for (const a of idleCast) moveActor(a, dt, clock, 1);
      snd.setApplause(0);
      return;
    }

    if (state === "pause") return;

    if (state === "interval") {
      intT += dt;
      const s = curShow();
      for (const a of s.cast) moveActor(a, dt, clock, 1);
      if (intT >= INT_LEN) {
        state = "act";
        segT = 0;
        segIdx = 0;
        applyCue(true);
      }
      return;
    }

    /* ---- state === 'act' ---- */
    const s = curShow();
    const cue = curCue();
    segT += dt;
    if (cueGrace > 0) cueGrace -= dt;

    const sp = cue.blackout ? 0.45 : 1;
    for (const a of s.cast) moveActor(a, dt, clock, sp);

    /* keyboard steering */
    const kv = 460 * dt;
    if (keys.ArrowLeft || keys.a) beam.tx -= kv;
    if (keys.ArrowRight || keys.d) beam.tx += kv;
    if (keys.ArrowUp || keys.w) beam.ty -= kv;
    if (keys.ArrowDown || keys.s) beam.ty += kv;
    beam.tx = clamp(beam.tx, STAGE.x0, STAGE.x1);
    beam.ty = clamp(beam.ty, STAGE.y0, STAGE.y1);

    const k = 1 - Math.exp(-dt * 9);
    beam.x += (beam.tx - beam.x) * k;
    beam.y += (beam.ty - beam.y) * k;

    /* scoring */
    const feat = s.cast[cue.who];
    const acqR = poolRx() * 0.88;
    const d = dist2(beam.x, beam.y, feat.x, feat.y - 26);
    const litFeat = d < acqR;
    let wrongLit = false;
    if (!litFeat) {
      for (let i = 0; i < s.cast.length; i++) {
        if (i === cue.who) continue;
        const o = s.cast[i];
        if (dist2(beam.x, beam.y, o.x, o.y - 26) < acqR) {
          wrongLit = true;
          break;
        }
      }
    }
    const centred = clamp(1 - d / (poolRx() * 1.25), 0, 1);
    const gelOk = cue.gel === null || cue.gel === gel;

    if (litFeat) {
      badT = 0;
      missT = 0;
      holdT += dt;
    } else {
      missT += dt;
      holdT = 0;
      badT += dt;
    }

    if (badT > GRACE && cueGrace <= 0) {
      approval -= (wrongLit ? 5.5 : 7.5) * dt;
    } else if (litFeat) {
      approval += 4.2 * centred * (gelOk ? 1 : 0.55) * dt;
    }
    approval = clamp(approval, 0, 100);

    approval = clamp(approval, 0, 100);

    const mult = 1 + Math.min(1, holdT / 12);
    const rate = litFeat
      ? RATE * centred * (gelOk ? 1 : 0.55) * (bumpT > 0 ? 0.5 : 1) * mult
      : 0;
    score += rate * dt;
    appSmooth = lerp(appSmooth, rate, 1 - Math.exp(-dt * 2.4));
    snd.setApplause((appSmooth / RATE) * 0.42);

    /* segment / cue changes */
    if (segT >= cue.dur) {
      segT = 0;
      segIdx++;
      if (segIdx >= s.cues.length) {
        actIdx++;
        if (actIdx >= show.length) {
          endShow(true);
          return;
        }
        state = "interval";
        intT = 0;
        ui.cueNext.textContent = "";
        snd.setApplause(0.18);
        return;
      }
      applyCue(false);
    }

    if (approval <= 0) {
      endShow(false);
      return;
    }

    /* cue card previews */
    const remain = Math.ceil(cue.dur - segT);
    const nxt = s.cues[segIdx + 1];
    if (nxt && remain <= 3) {
      ui.cueNext.textContent =
        "next: " + s.cast[nxt.who].name + " in " + remain + "\u2009s";
    } else {
      ui.cueNext.textContent = s.act.card + " \u00b7 " + s.act.play;
    }
  }

  /* -------------------------------------------------------------- drawing */

  /* static scenery bits, computed once */
  const plankSeams = [];
  for (let row = 0; row < 9; row++) {
    for (let x = PROS.x0 - 20 + (row % 2) * 47; x < PROS.x1 + 20; x += 94) {
      plankSeams.push({ x, y: FLOOR_Y + row * 27 });
    }
  }
  const pitHeads = [];
  for (let i = 0; i < 14; i++)
    pitHeads.push({
      x: 40 + i * 68 + rand(-12, 12),
      r: rand(11, 15),
      ph: rand(0, 6),
    });

  function rr(x, y, w, h) {
    ctx.fillRect(x, y, w, h);
  }

  function drawWallpaper() {
    ctx.fillStyle = "#191019";
    rr(0, 0, W, H);
    ctx.fillStyle = "rgba(255,235,200,0.028)";
    for (let x = 0; x < W; x += 42) rr(x, 0, 14, H);
  }

  function drawOpening() {
    /* black box behind the set */
    ctx.fillStyle = "#0b0710";
    ctx.fillRect(PROS.x0, PROS.y0, PROS.x1 - PROS.x0, PROS.y1 - PROS.y0);

    /* painted backdrop: night sky, moon, hills */
    const sky = ctx.createLinearGradient(0, PROS.y0, 0, FLOOR_Y);
    sky.addColorStop(0, "#131b2e");
    sky.addColorStop(1, "#232033");
    ctx.fillStyle = sky;
    ctx.fillRect(PROS.x0, PROS.y0, PROS.x1 - PROS.x0, FLOOR_Y - PROS.y0);
    ctx.fillStyle = "rgba(245,240,215,0.85)";
    ctx.beginPath();
    ctx.arc(700, 190, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#131b2e";
    ctx.beginPath();
    ctx.arc(710, 182, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(240,235,210,0.35)";
    for (let i = 0; i < 26; i++) {
      const sx = PROS.x0 + ((i * 137) % (PROS.x1 - PROS.x0));
      const sy = PROS.y0 + 18 + ((i * 61) % 90);
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.fillStyle = "#0e1220";
    ctx.beginPath();
    ctx.moveTo(PROS.x0, FLOOR_Y);
    ctx.lineTo(PROS.x0 + 90, FLOOR_Y - 46);
    ctx.lineTo(PROS.x0 + 210, FLOOR_Y - 12);
    ctx.lineTo(PROS.x0 + 330, FLOOR_Y - 58);
    ctx.lineTo(PROS.x0 + 480, FLOOR_Y - 20);
    ctx.lineTo(PROS.x0 + 620, FLOOR_Y - 52);
    ctx.lineTo(PROS.x0 + 760, FLOOR_Y - 16);
    ctx.lineTo(PROS.x1, FLOOR_Y - 38);
    ctx.lineTo(PROS.x1, FLOOR_Y);
    ctx.closePath();
    ctx.fill();

    /* boards */
    const fl = ctx.createLinearGradient(0, FLOOR_Y, 0, PROS.y1);
    fl.addColorStop(0, "#4a3320");
    fl.addColorStop(1, "#6b4b2c");
    ctx.fillStyle = fl;
    ctx.fillRect(PROS.x0, FLOOR_Y, PROS.x1 - PROS.x0, PROS.y1 - FLOOR_Y);
    ctx.strokeStyle = "rgba(20,10,4,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = FLOOR_Y + 27; y < PROS.y1; y += 27) {
      ctx.moveTo(PROS.x0, y);
      ctx.lineTo(PROS.x1, y);
    }
    for (const s of plankSeams) {
      if (s.y > FLOOR_Y && s.y < PROS.y1) {
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x, Math.min(s.y + 27, PROS.y1));
      }
    }
    ctx.stroke();

    /* footlights */
    for (let i = 0; i < 12; i++) {
      const fx = PROS.x0 + 40 + i * ((PROS.x1 - PROS.x0 - 80) / 11);
      const fy = PROS.y1 - 8;
      const gl = ctx.createRadialGradient(fx, fy, 2, fx, fy, 26);
      gl.addColorStop(0, "rgba(255,205,120,0.5)");
      gl.addColorStop(1, "rgba(255,205,120,0)");
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(fx, fy, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd98e";
      ctx.beginPath();
      ctx.arc(fx, fy, 4.5, Math.PI, 0);
      ctx.fill();
    }

    /* proscenium frame */
    ctx.strokeStyle = "#57431f";
    ctx.lineWidth = 16;
    ctx.strokeRect(
      PROS.x0 - 8,
      PROS.y0 - 8,
      PROS.x1 - PROS.x0 + 16,
      PROS.y1 - PROS.y0 + 16,
    );
    ctx.strokeStyle = "rgba(217,164,65,0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      PROS.x0 - 17,
      PROS.y0 - 17,
      PROS.x1 - PROS.x0 + 34,
      PROS.y1 - PROS.y0 + 34,
    );
  }

  function drawCurtains(tt) {
    const sway = Math.sin(tt * 0.6) * 5;
    /* side legs */
    for (const side of [-1, 1]) {
      const x = side < 0 ? PROS.x0 : PROS.x1 - 56 + sway * side;
      ctx.fillStyle = "#6d1522";
      ctx.fillRect(x, PROS.y0, 56, PROS.y1 - PROS.y0);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      for (let i = 0; i < 4; i++)
        ctx.fillRect(x + 6 + i * 13, PROS.y0, 6, PROS.y1 - PROS.y0);
      ctx.fillStyle = "rgba(255,190,160,0.08)";
      ctx.fillRect(x + (side < 0 ? 44 : 0), PROS.y0, 12, PROS.y1 - PROS.y0);
    }
    /* valance swags */
    ctx.fillStyle = "#7d1a28";
    ctx.beginPath();
    ctx.moveTo(PROS.x0 - 4, PROS.y0 - 2);
    const seg = (PROS.x1 - PROS.x0) / 4;
    for (let i = 0; i < 4; i++) {
      const x0 = PROS.x0 + i * seg,
        x1 = x0 + seg;
      ctx.quadraticCurveTo((x0 + x1) / 2, PROS.y0 + 66 + sway, x1, PROS.y0 - 2);
    }
    ctx.lineTo(PROS.x1, PROS.y0 - 30);
    ctx.lineTo(PROS.x0, PROS.y0 - 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < 4; i++) {
      const x0 = PROS.x0 + i * seg;
      ctx.beginPath();
      ctx.moveTo(x0 + 8, PROS.y0 - 2);
      ctx.quadraticCurveTo(
        x0 + seg / 2,
        PROS.y0 + 52 + sway,
        x0 + seg - 8,
        PROS.y0 - 2,
      );
      ctx.quadraticCurveTo(x0 + seg / 2, PROS.y0 + 30, x0 + 8, PROS.y0 - 2);
      ctx.fill();
    }
    ctx.fillStyle = "#d9a441";
    for (let i = 0; i <= 8; i++) {
      const gx = PROS.x0 + (i * (PROS.x1 - PROS.x0)) / 8;
      ctx.beginPath();
      ctx.arc(
        gx,
        PROS.y0 + 60 + Math.sin(tt * 0.6 + i) * 5,
        3.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  function drawPit(tt) {
    ctx.fillStyle = "#070408";
    rr(0, PROS.y1 + 2, W, H - PROS.y1 - 2);
    ctx.fillStyle = "#0e0a10";
    for (const p of pitHeads) {
      const bob = Math.sin(tt * 1.3 + p.ph) * 1.6;
      ctx.beginPath();
      ctx.arc(p.x, H - 4 + bob, p.r, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawDog(a, alpha) {
    const x = a.x,
      y = a.y;
    ctx.globalAlpha = alpha;
    /* shadow */
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 26, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const trot = Math.sin(a.walk * 6);

    ctx.strokeStyle = a.hair;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const lx = x - 14 + i * 10;
      ctx.moveTo(lx, y - 16);
      ctx.lineTo(lx + trot * (i % 2 ? 4 : -4), y);
    }
    ctx.stroke();
    ctx.fillStyle = a.hue;
    ctx.beginPath();
    ctx.ellipse(x, y - 20, 22, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    const hd = a.dirn > 0 ? 1 : -1;
    ctx.beginPath();
    ctx.arc(x + hd * 22, y - 26, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a.hair;
    ctx.beginPath();
    ctx.moveTo(x + hd * 18, y - 33);
    ctx.lineTo(x + hd * 24, y - 44);
    ctx.lineTo(x + hd * 27, y - 31);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = a.hue;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x - hd * 20, y - 24);
    ctx.quadraticCurveTo(
      x - hd * 32,
      y - 30 + Math.sin(clock * 9) * 6,
      x - hd * 34,
      y - 38,
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawPerson(a, alpha, lit) {
    const x = a.x,
      y = a.y;
    const sgn = a.vx < -6 ? -1 : a.vx > 6 ? 1 : a.dirn || 1;
    ctx.globalAlpha = alpha;
    /* shadow */
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 18, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const bob = Math.sin(a.ph * 2) * 1.8;
    const hipY = y - 26 + bob,
      shY = y - 48 + bob,
      headY = y - 60 + bob;
    const swing = Math.sin(a.walk * 5) * 7;

    if (a.role === "medium") {
      /* hovering: no legs, tapered gown */
      const gy = y - 8;
      ctx.fillStyle = a.hue;
      ctx.beginPath();
      ctx.moveTo(x - 15, gy);
      ctx.quadraticCurveTo(x - 6, gy - 34, x - 11, shY + 4);
      ctx.lineTo(x + 11, shY + 4);
      ctx.quadraticCurveTo(x + 6, gy - 34, x + 15, gy);
      ctx.closePath();
      ctx.fill();
      const gl = ctx.createRadialGradient(x, gy - 26, 4, x, gy - 26, 42);
      gl.addColorStop(0, "rgba(190,190,255,0.16)");
      gl.addColorStop(1, "rgba(190,190,255,0)");
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(x, gy - 26, 42, 0, Math.PI * 2);
      ctx.fill();
    } else if (a.role !== "dog") {
      /* legs */
      ctx.strokeStyle = "#241a14";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - 4, hipY);
      ctx.lineTo(x - 4 + swing, y);
      ctx.moveTo(x + 4, hipY);
      ctx.lineTo(x + 4 - swing, y);
      ctx.stroke();
      if (a.role === "comic") {
        /* clown shoes */
        ctx.fillStyle = "#161009";
        ctx.beginPath();
        ctx.ellipse(x - 4 + swing, y, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 4 - swing, y, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      /* torso */
      ctx.strokeStyle = a.hue;
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(x, hipY);
      ctx.lineTo(x, shY);
      ctx.stroke();
      if (a.role === "magician") {
        /* coat tails */
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x - 7, shY + 6);
        ctx.lineTo(x - 12 - sgn * 3, hipY + 14);
        ctx.moveTo(x + 7, shY + 6);
        ctx.lineTo(x + 12 + sgn * 3, hipY + 14);
        ctx.stroke();
      }
      /* arms */
      ctx.strokeStyle = a.hue;
      ctx.lineWidth = 5;
      const armSwing = a.kind === "burst" ? Math.sin(clock * 14) * 12 : swing;
      ctx.beginPath();
      ctx.moveTo(x - 8, shY + 5);
      ctx.lineTo(x - 13 - armSwing * 0.4, shY + 20 + armSwing * 0.5);
      ctx.moveTo(x + 8, shY + 5);
      ctx.lineTo(x + 13 + armSwing * 0.4, shY + 20 - armSwing * 0.5);
      ctx.stroke();
      if (a.role === "contortion") {
        /* arms overhead */
        ctx.beginPath();
        ctx.moveTo(x - 7, shY + 4);
        ctx.lineTo(x - 12, headY - 12 + Math.sin(a.ph) * 4);
        ctx.moveTo(x + 7, shY + 4);
        ctx.lineTo(x + 12, headY - 12 - Math.sin(a.ph) * 4);
        ctx.stroke();
      }
      if (a.role === "juggler") {
        /* three arcing balls */
        ctx.fillStyle = "#d94f3a";
        for (let i = 0; i < 3; i++) {
          const bx = x + Math.sin(a.ph * 1.7 + i * 2.1) * 17;
          const by = shY - 8 - Math.abs(Math.sin(a.ph * 1.35 + i * 2.1)) * 30;
          ctx.beginPath();
          ctx.arc(bx, by, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (a.role === "singer") {
        /* mic stand */
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + sgn * 20, y);
        ctx.lineTo(x + sgn * 20, shY - 2);
        ctx.stroke();
        ctx.fillStyle = "#bbb";
        ctx.beginPath();
        ctx.arc(x + sgn * 20, shY - 6, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* head + hat */
    ctx.fillStyle = lit ? "#e9bd93" : "#b3927a";
    ctx.beginPath();
    ctx.arc(x, headY, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a.hair;
    if (a.role === "magician" || a.role === "comic") {
      ctx.fillRect(x - 8, headY - 15, 16, 3);
      ctx.fillRect(x - 6, headY - 26, 12, 12);
      if (a.role === "comic") {
        ctx.fillStyle = a.hue;
        ctx.fillRect(x - 6, headY - 26, 12, 3);
      }
    } else if (a.role === "singer") {
      ctx.beginPath();
      ctx.arc(x, headY - 3, 9.5, Math.PI, 0);
      ctx.fill();
    } else if (a.role === "medium") {
      ctx.beginPath();
      ctx.moveTo(x - 9, headY - 2);
      ctx.quadraticCurveTo(x, headY - 20, x + 9, headY - 2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, headY - 2, 9, Math.PI, 0);
      ctx.fill();
    }

    /* pop-vanish smoke rings */
    if (a.fade < 1) {
      const puff = 1 - a.fade;
      ctx.strokeStyle = "rgba(200,200,215," + 0.5 * puff + ")";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y - 34, 12 + puff * 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 34, 4 + puff * 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function starPath(cx2, cy2, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      const px = cx2 + Math.cos(ang) * rad;
      const py = cy2 + Math.sin(ang) * rad;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function drawActors(s, cue) {
    const list = [...s.cast].sort((p, q) => p.y - q.y);
    const acqR = poolRx() * 0.88;
    const feat = s.cast[cue.who];
    for (const a of list) {
      const d = dist2(beam.x, beam.y, a.x, a.y - 26);
      const lit = state === "act" && d < acqR * 1.12;
      const alpha = a.fade * (lit ? 1 : 0.3);
      if (a.role === "dog") drawDog(a, alpha);
      else drawPerson(a, alpha, lit);
    }
    /* finder star over the called turn before you acquire them */
    if (state === "act" && missT > 0.15 && feat.fade > 0.5) {
      const sa = clamp(missT * 1.4, 0, 1) * 0.9;
      ctx.globalAlpha = sa;
      ctx.fillStyle = "#ffd76a";
      starPath(feat.x, feat.y - 86 + Math.sin(clock * 6) * 4, 11);

      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawBeam() {
    const r = poolR(),
      rx = poolRx(),
      ry = r * 0.5;
    const px = beam.x,
      py = beam.y;
    const gcol = GELS[gel].rgb;
    const col = (a) =>
      "rgba(" + gcol[0] + "," + gcol[1] + "," + gcol[2] + "," + a + ")";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    /* shaft */
    const lg = ctx.createLinearGradient(ORIGIN.x, ORIGIN.y, px, py);
    lg.addColorStop(0, col(0.02));
    lg.addColorStop(0.75, col(0.1));
    lg.addColorStop(1, col(0.3));
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x, ORIGIN.y);
    ctx.lineTo(px - rx * 0.96, py);
    ctx.ellipse(px, py, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();

    /* pool */
    ctx.translate(px, py);
    ctx.scale(1, ry / rx);
    const rg = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, rx);
    rg.addColorStop(0, col(0.55));
    rg.addColorStop(0.55, col(0.26));
    rg.addColorStop(1, col(0));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* hot core */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(px, py);
    ctx.scale(1, ry / rx);
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 0.42);
    cg.addColorStop(0, "rgba(255,255,245,0.5)");
    cg.addColorStop(1, "rgba(255,255,245,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* dust drifting in the shaft */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,248,225,0.35)";
    for (const m of dust) {
      const mx = lerp(ORIGIN.x, px, m.u) + m.s * rx * 0.8 * m.u;
      const my = lerp(ORIGIN.y, py, m.u);
      ctx.globalAlpha = 0.05 + 0.16 * m.u;
      ctx.beginPath();
      ctx.arc(mx, my, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const dust = [];
  for (let i = 0; i < 26; i++) {
    dust.push({
      u: Math.random(),
      s: rand(-1, 1),
      r: rand(0.8, 2),
      du: rand(0.02, 0.07),
    });
  }
  function updateDust(dt) {
    for (const m of dust) {
      m.u += m.du * dt;
      if (m.u > 1) {
        m.u = 0;
        m.s = rand(-1, 1);
      }
    }
  }

  function drawSpotBox() {
    /* the lamp housing peeking over the frame */
    ctx.fillStyle = "#20242c";
    rr(ORIGIN.x - 34, -8, 68, 26);
    ctx.fillStyle = "#31363f";
    rr(ORIGIN.x - 26, -2, 52, 14);
    ctx.fillStyle = "#ffe9b0";
    ctx.beginPath();
    ctx.arc(ORIGIN.x, 16, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawApplauseSign() {
    const lvl = clamp(appSmooth / RATE, 0, 1);
    const x = PROS.x1 - 96,
      y = PROS.y0 + 34;
    ctx.save();
    ctx.font = "bold 21px Georgia, serif";
    ctx.textAlign = "center";
    const flick = lvl > 0.05 ? 0.55 + lvl * 0.45 + Math.random() * 0.08 : 0.14;
    ctx.shadowColor = "rgba(255,120,90,0.9)";
    ctx.shadowBlur = 6 + lvl * 22;
    ctx.fillStyle = "rgba(255,150,110," + flick.toFixed(3) + ")";
    ctx.fillText("APPLAUSE", x, y);
    ctx.restore();
    ctx.strokeStyle = "rgba(217,164,65,0.4)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 52, y - 19, 104, 27);
  }

  function drawIntervalCard() {
    const s = curShow();
    if (!s) return;
    ctx.fillStyle = "rgba(5,3,7,0.55)";
    rr(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#d9a441";
    ctx.font = "bold 30px Georgia, serif";
    ctx.fillText(s.act.card, 480, 268);
    ctx.fillStyle = "#f4e8cf";
    ctx.font = "italic 40px Georgia, serif";
    ctx.fillText(s.act.play, 480, 318);
    ctx.fillStyle = "#b39b74";
    ctx.font = "16px Georgia, serif";
    ctx.fillText(s.act.note, 480, 350);
    ctx.strokeStyle = "rgba(217,164,65,0.6)";
    ctx.beginPath();
    ctx.moveTo(380, 372);
    ctx.lineTo(580, 372);
    ctx.stroke();
  }

  function drawLowPatience() {
    if (approval >= 25 || state !== "act") return;
    const pulse =
      0.25 + Math.abs(Math.sin(clock * 5)) * 0.3 * (1 - approval / 25);
    const vg = ctx.createRadialGradient(480, 310, 240, 480, 310, 560);
    vg.addColorStop(0, "rgba(160,24,40,0)");
    vg.addColorStop(1, "rgba(160,24,40," + pulse.toFixed(3) + ")");
    ctx.fillStyle = vg;
    rr(0, 0, W, H);
  }

  function drawBlackout() {
    ctx.fillStyle = "rgba(3,2,5,0.88)";
    rr(0, 0, W, H);
    /* faint ghost of your own pool */
    const rx = poolRx() * 0.7,
      ry = poolR() * 0.32;
    ctx.save();
    ctx.translate(beam.x, beam.y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, rx);
    g.addColorStop(0, "rgba(150,150,170,0.16)");
    g.addColorStop(1, "rgba(150,150,170,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    /* eyeshine of anyone moving */
    const s = curShow();
    if (!s) return;
    for (const a of s.cast) {
      if (Math.hypot(a.vx, a.vy) < 12) continue;
      const hy = a.y - 60 + (a.role === "dog" ? 30 : 0);
      ctx.fillStyle = "rgba(240,240,255,0.75)";
      ctx.beginPath();
      ctx.arc(a.x - 3.4, hy, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(a.x + 3.4, hy, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    const cue = curCue();
    drawWallpaper();
    drawOpening();
    drawPit(clock);
    const showCast =
      state === "title" || state === "end" || state === "fired"
        ? { cast: idleCast, cues: [{ who: 0 }] }
        : curShow();
    if (showCast) drawActors(showCast, showCast.cues[0]);
    if (state === "act" || state === "pause") drawBeam();
    drawSpotBox();
    drawCurtains(clock);
    drawApplauseSign();
    if (state === "act" && cue && cue.blackout) drawBlackout();
    if (state === "interval") drawIntervalCard();
    drawLowPatience();
  }

  /* ----------------------------------------------------------------- hud */

  let lastScoreShown = -1;
  function hud() {
    if (state === "act") {
      ui.patBar.style.width = approval.toFixed(1) + "%";
      ui.appBar.style.width =
        clamp((appSmooth / RATE) * 100, 0, 100).toFixed(0) + "%";
      const sc = Math.floor(score);
      if (sc !== lastScoreShown) {
        ui.score.textContent = sc.toLocaleString("en-GB");
        lastScoreShown = sc;
      }
      const mult = 1 + Math.min(1, holdT / 12);
      ui.cueStreak.textContent =
        mult > 1.12 && holdT > 1 ? "hot streak \u00d7" + mult.toFixed(1) : "";
      updateGelChip();
    } else if (state === "interval") {
      ui.patBar.style.width = approval.toFixed(1) + "%";
      ui.appBar.style.width = "0%";
      ui.cueStreak.textContent = "";
      ui.cueNext.textContent = "";
      ui.cueGel.textContent = "";
      ui.cueGel.classList.remove("warn");
    }
  }

  /* --------------------------------------------------------------- input */

  function eventToCanvas(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  }

  function steerPointer(e) {
    const p = eventToCanvas(e);
    beam.tx = clamp(p.x, STAGE.x0, STAGE.x1);
    beam.ty = clamp(p.y, STAGE.y0, STAGE.y1);
  }

  booth.addEventListener("pointermove", (e) => {
    if (state === "act") steerPointer(e);
  });
  booth.addEventListener("pointerdown", (e) => {
    snd.ensure();
    if (state === "act") steerPointer(e);
  });
  booth.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === " "
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    snd.ensure();
    keys[k.length === 1 ? k.toLowerCase() : k] = true;
    switch (k) {
      case " ":
        if (state === "act") tryBump();
        break;
      case "Enter":
        if (state === "title" || state === "end" || state === "fired")
          startShow();
        else if (state === "pause") setPaused(false);
        break;
      case "p":
      case "P":
        setPaused(state !== "pause");
        break;
      case "m":
      case "M":
        muted = !muted;
        snd.setOn(!muted);
        ui.btnMute.textContent = muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
        break;
      case "r":
      case "R":
        if (state !== "title") startShow();
        break;
      case "1":
      case "2":
      case "3":
      case "4":
        if (state === "act" || state === "interval") setGel(Number(k) - 1);
        break;
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key;
    keys[k.length === 1 ? k.toLowerCase() : k] = false;
  });

  ui.btnPause.addEventListener("click", () => {
    snd.ensure();
    setPaused(state !== "pause");
  });
  ui.btnRestart.addEventListener("click", () => {
    snd.ensure();
    startShow();
  });
  ui.btnMute.addEventListener("click", () => {
    snd.ensure();
    muted = !muted;
    snd.setOn(!muted);
    ui.btnMute.textContent = muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
  });
  ui.btnBump.addEventListener("click", () => {
    snd.ensure();
    tryBump();
  });
  for (const b of document.querySelectorAll(".gel")) {
    b.addEventListener("click", () => {
      snd.ensure();
      setGel(Number(b.dataset.gel));
    });
  }

  /* ---------------------------------------------------------------- main */

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    updateDust(dt);
    update(dt);
    render();
    hud();
  }

  /* boot */
  refreshGelButtons();
  ui.btnBump.classList.add("ready");
  panelTitle();
  requestAnimationFrame(frame);
})();
