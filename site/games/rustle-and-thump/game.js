// Rustle & Thump - you are the foley artist.
// Hit the right prop as its cue crosses the projector gate; hold the thunder
// sheet through weather beds; keep the director's sync meter off the floor.
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const TAU = Math.PI * 2;

  // ---------- dom ----------
  const canvas = $("scene");
  const ctx = canvas.getContext("2d");
  const reelLabel = $("reelLabel");
  const syncFill = $("syncFill");
  const syncMark = $("syncMark");
  const scoreLabel = $("scoreLabel");
  const comboLabel = $("comboLabel");
  const overlay = $("overlay");
  const cardTitle = $("cardTitle");
  const cardBody = $("cardBody");
  const cardBtn = $("cardBtn");
  const soundBtn = $("soundBtn");
  const pauseBtn = $("pauseBtn");
  const restartBtn = $("restartBtn");

  // ---------- canvas sizing ----------
  let W = 800;
  let H = 450;
  let dpr = 1;
  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, box.width);
    H = Math.max(240, box.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------- audio (all synthesised, lazy init) ----------
  const AudioBox = {
    ctx: null,
    master: null,
    comp: null,
    noiseBuf: null,
    muted: false,
    stormNodes: null,
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.comp.connect(this.master);
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    },
    setMuted(m) {
      this.muted = m;
      if (this.master)
        this.master.gain.setTargetAtTime(
          m ? 0 : 0.85,
          this.ctx.currentTime,
          0.02,
        );
    },
    noise(dur, opts) {
      // filtered noise burst
      if (!this.ensure()) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filt = this.ctx.createBiquadFilter();
      filt.type = opts.type || "lowpass";
      filt.frequency.setValueAtTime(opts.f0 || 400, t);
      if (opts.f1)
        filt.frequency.exponentialRampToValueAtTime(opts.f1, t + dur);
      filt.Q.value = opts.q || 0.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(
        opts.gain || 0.5,
        t + (opts.attack || 0.005),
      );
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = opts.pan || 0;
      src.connect(filt);
      filt.connect(g);
      g.connect(pan);
      pan.connect(this.comp);
      src.start(t);
      src.stop(t + dur + 0.05);
    },
    tone(freq0, freq1, dur, opts) {
      if (!this.ensure()) return;
      opts = opts || {};
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = opts.type || "sine";
      o.frequency.setValueAtTime(freq0, t);
      if (freq1 && freq1 !== freq0)
        o.frequency.exponentialRampToValueAtTime(freq1, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(
        opts.gain || 0.25,
        t + (opts.attack || 0.008),
      );
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = g;
      if (opts.pan !== undefined) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = opts.pan;
        o.connect(g);
        g.connect(p);
        p.connect(this.comp);
      } else {
        o.connect(g);
        g.connect(this.comp);
      }
      o.start(t);
      o.stop(t + dur + 0.05);
      void node;
    },
    boots(side) {
      const pan = side ? 0.45 : -0.45;
      this.noise(0.09, {
        type: "lowpass",
        f0: 380,
        f1: 140,
        gain: 0.5,
        pan,
      });
      this.tone(130, 55, 0.11, { type: "sine", gain: 0.3, pan });
    },
    door() {
      // creak then slam
      if (!this.ensure()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(160, t);
      o.frequency.linearRampToValueAtTime(330, t + 0.3);
      const wob = this.ctx.createOscillator();
      wob.type = "sine";
      wob.frequency.value = 11;
      const wg = this.ctx.createGain();
      wg.gain.value = 26;
      wob.connect(wg);
      wg.connect(o.frequency);
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 850;
      f.Q.value = 2.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.05);
      g.gain.setValueAtTime(0.16, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(f);
      f.connect(g);
      g.connect(this.comp);
      o.start(t);
      o.stop(t + 0.42);
      wob.start(t);
      wob.stop(t + 0.42);
      // slam
      setTimeoutSafe(() => {
        this.noise(0.16, { type: "lowpass", f0: 900, f1: 120, gain: 0.5 });
        this.tone(95, 40, 0.2, { type: "sine", gain: 0.34 });
      }, 300);
    },
    stormStart() {
      if (!this.ensure()) return;
      if (this.stormNodes) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 0.45;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.25);
      const rumble = this.ctx.createOscillator();
      rumble.type = "sine";
      rumble.frequency.value = 46;
      const rg = this.ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.linearRampToValueAtTime(0.07, t + 0.4);
      src.connect(lp);
      lp.connect(bp);
      bp.connect(g);
      g.connect(this.comp);
      rumble.connect(rg);
      rg.connect(this.comp);
      src.start(t);
      rumble.start(t);
      this.stormNodes = { src, rumble, g, rg };
    },
    stormStop(good) {
      if (!this.stormNodes) return;
      const n = this.stormNodes;
      this.stormNodes = null;
      const t = this.ctx.currentTime;
      n.g.gain.setTargetAtTime(0.0001, t, 0.08);
      n.rg.gain.setTargetAtTime(0.0001, t, 0.08);
      n.src.stop(t + 0.6);
      n.rumble.stop(t + 0.6);
      // thunder tail
      const dur = good ? 1.5 : 0.7;
      this.noise(dur, {
        type: "lowpass",
        f0: 260,
        f1: 60,
        gain: good ? 0.55 : 0.25,
        attack: 0.04,
      });
      this.tone(82, 36, dur * 0.8, { type: "triangle", gain: 0.22 });
    },
    crash() {
      this.noise(0.2, {
        type: "highpass",
        f0: 2400,
        gain: 0.4,
      });
      this.tone(2150, 1900, 0.16, { type: "sine", gain: 0.1 });
      this.tone(2730, 2500, 0.13, { type: "sine", gain: 0.08 });
      this.tone(3400, 3100, 0.1, { type: "sine", gain: 0.06 });
      this.noise(0.1, { type: "lowpass", f0: 600, f1: 200, gain: 0.3 });
    },
    dud() {
      this.tone(120, 80, 0.12, { type: "sawtooth", gain: 0.08 });
    },
    tick(hi) {
      this.tone(hi ? 1180 : 780, 0, 0.05, { type: "square", gain: 0.07 });
    },
    judge(kind) {
      if (kind === "perfect") {
        this.tone(1320, 0, 0.09, { type: "sine", gain: 0.1 });
        this.tone(1980, 0, 0.12, { type: "sine", gain: 0.07 });
      } else if (kind === "miss") {
        this.tone(110, 70, 0.18, { type: "sawtooth", gain: 0.09 });
      }
    },
    win() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => {
        setTimeoutSafe(() => {
          this.tone(f, 0, 0.22, { type: "triangle", gain: 0.14 });
        }, i * 110);
      });
    },
    fail() {
      [330, 277, 220].forEach((f, i) => {
        setTimeoutSafe(() => {
          this.tone(f, f * 0.94, 0.28, { type: "sawtooth", gain: 0.1 });
        }, i * 200);
      });
    },
  };
  function setTimeoutSafe(fn, ms) {
    window.setTimeout(fn, ms);
  }

  // ---------- props ----------
  const PROPS = {
    boots: { keys: ["1", "a"], name: "Boots" },
    door: { keys: ["2", "s"], name: "Door" },
    storm: { keys: ["3", "d"], name: "Thunder sheet" },
    crash: { keys: ["4", "f"], name: "Breakage" },
  };
  const PROP_LIST = ["boots", "door", "storm", "crash"];

  function paintPadArts() {
    document.querySelectorAll("#pads .pad").forEach((pad) => {
      const c = pad.querySelector(".padArt");
      if (!c || !c.getContext) return;
      const g = c.getContext("2d");
      const w = c.width;
      const h = c.height;
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "#e8b464";
      g.fillStyle = "#e8b464";
      g.lineWidth = 2.4;
      g.lineJoin = "round";
      g.lineCap = "round";
      const prop = pad.dataset.prop;
      g.beginPath();
      if (prop === "boots") {
        // two boots
        [
          [14, 30],
          [40, 30],
        ].forEach(([x, y]) => {
          g.moveTo(x, y - 16);
          g.lineTo(x, y);
          g.lineTo(x + 16, y);
          g.quadraticCurveTo(x + 20, y + 2, x + 16, y + 6);
          g.lineTo(x, y + 6);
          g.moveTo(x, y - 6);
          g.lineTo(x + 9, y - 6);
        });
        g.stroke();
      } else if (prop === "door") {
        g.rect(20, 8, 30, 38);
        g.stroke();
        g.beginPath();
        g.arc(44, 28, 2.4, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(35, 27, 13, -Math.PI * 0.85, -Math.PI * 0.15);
        g.stroke();
        g.beginPath();
        g.moveTo(52, 20);
        g.lineTo(56, 14);
        g.stroke();
      } else if (prop === "storm") {
        // wavy sheet + bolt
        g.beginPath();
        g.moveTo(10, 16);
        g.quadraticCurveTo(22, 10, 36, 16);
        g.quadraticCurveTo(50, 22, 62, 16);
        g.stroke();
        g.beginPath();
        g.moveTo(38, 18);
        g.lineTo(30, 32);
        g.lineTo(37, 32);
        g.lineTo(29, 46);
        g.lineTo(41, 31);
        g.lineTo(34, 31);
        g.closePath();
        g.fill();
      } else if (prop === "crash") {
        // cracked urn
        g.moveTo(30, 14);
        g.quadraticCurveTo(18, 22, 24, 36);
        g.quadraticCurveTo(28, 44, 36, 44);
        g.quadraticCurveTo(44, 44, 48, 36);
        g.quadraticCurveTo(54, 22, 42, 14);
        g.closePath();
        g.stroke();
        g.beginPath();
        g.moveTo(34, 16);
        g.lineTo(38, 26);
        g.lineTo(33, 32);
        g.lineTo(39, 42);
        g.stroke();
      }
    });
  }

  // ---------- reel scores (authored pattern grids) ----------
  // bar chars, one per beat: b boots, d door, c crash, s storm hold 2 beats,
  // S storm hold 3 beats, Z storm 4 beats, . rest. Second string (optional)
  // gives off-beat eighth hits.
  const REEL_DEFS = [
    {
      name: 'Reel 1 \u00b7 "The Alley"',
      scene: "alley",
      bpm: 100,
      bars: [
        "b...",
        "b.b.",
        "b...",
        ".b..",
        "d...",
        "b.b.",
        "..b.",
        "b...",
        "b.b.",
        ".b.b",
        "d...",
        "b...",
        "b.d.",
        "bb..",
      ],
    },
    {
      name: 'Reel 2 \u00b7 "The Harbour Inn"',
      scene: "inn",
      bpm: 108,
      bars: [
        "b...",
        "b.b.",
        "d...",
        "s...",
        "...b",
        "b.b.",
        "d...",
        "b...",
        "s...",
        "b.b.",
        "..bd",
        "b...",
        "b.b.",
        "s...",
        "d.b.",
        "b...",
        "bdb.",
        "bb..",
      ],
    },
    {
      name: 'Reel 3 \u00b7 "The Vault Job"',
      scene: "vault",
      bpm: 122,
      bars: [
        ["b.b.", "...."],
        ["b...", ".b.."],
        ["d...", "...."],
        ["b.c.", "...."],
        ["s...", "...."],
        ["b.b.", "..b."],
        ["d...", "...."],
        ["b...", ".bc."],
        ["s...", "...."],
        ["b.b.", ".b.."],
        ["d.c.", "...."],
        ["b...", "b..."],
        ["Z...", "...."],
        ["b.b.", ".b.b"],
        ["d...", "...."],
        ["b.c.", "..b."],
        ["s...", "...."],
        ["b.bd", "...."],
        ["c...", ".b.."],
        ["bdb.", "...."],
        ["b.c.", "b..."],
        ["bbcb", "...."],
      ],
    },
  ];

  const LEAD_IN = 2.4; // leader countdown seconds
  const TAIL = 1.6;

  function buildCues(defIndex) {
    const def = REEL_DEFS[defIndex];
    const spb = 60 / def.bpm;
    const cues = [];
    let beat = 0;
    def.bars.forEach((bar) => {
      const rows = Array.isArray(bar) ? bar : [bar, "...."];
      for (let i = 0; i < 4; i++) {
        const on = rows[0][i] || ".";
        const off = (rows[1] && rows[1][i]) || ".";
        const place = (ch, extra) => {
          if (ch === "." || ch === undefined) return;
          const t = LEAD_IN + (beat + i + (extra || 0)) * spb;
          if (ch === "s" || ch === "S" || ch === "Z") {
            const dur = (ch === "s" ? 2 : ch === "S" ? 3 : 4) * spb;
            cues.push({ t, prop: "storm", dur });
          } else {
            const prop =
              ch === "b"
                ? "boots"
                : ch === "d"
                  ? "door"
                  : ch === "c"
                    ? "crash"
                    : null;
            if (prop) cues.push({ t, prop });
          }
        };
        place(on, 0);
        place(off, 0.5);
      }
      beat += 4;
    });
    cues.sort((x, y) => x.t - y.t);
    return { cues, length: LEAD_IN + beat * spb + TAIL, spb };
  }

  // ---------- state ----------
  const G = {
    mode: "title", // title | intro | play | cut | reelEnd | final | pause
    reel: 0,
    cues: [],
    reelLen: 0,
    spb: 0.6,
    t: 0, // reel time (seconds into leader+reel)
    sync: 80,
    score: 0,
    combo: 0,
    bestStreak: 0,
    perfects: 0,
    hits: 0,
    totalCues: 0,
    results: [], // per-reel {score, syncAvg}
    pausedFrom: null,
  };

  // effects
  const fx = {
    floaters: [],
    rings: [],
    shards: [],
    rain: 0, // 0..1 storm intensity
    flash: 0,
    shake: 0,
    doorSwing: 0,
    doorVel: 0,
    stepPhase: 0,
    stepImpulse: 0,
    walkerX: 0.3,
    directorMood: 0, // -1 slump .. +1 nod
    grainSeed: 1,
    lastLeaderNum: -1,
  };

  // ---------- layout regions ----------
  function regions() {
    return {
      screen: { x: W * 0.05, y: H * 0.035, w: W * 0.9, h: H * 0.52 },
      strip: { x: 0, y: H * 0.63, w: W, h: H * 0.315 },
      gateX: W * 0.24,
    };
  }

  const STRIP_SPEED_BASE = 0.34; // fraction of (W-gateX) per second

  // ---------- overlay / cards ----------
  function showCard(title, bodyHTML, btnLabel, cls) {
    cardTitle.textContent = title;
    cardBody.innerHTML = bodyHTML;
    cardBtn.textContent = btnLabel;
    cardBody.classList.toggle("grade", !!cls);
    cardBody.classList.toggle("bad", cls === "bad");
    overlay.classList.add("show");
  }
  function hideCard() {
    overlay.classList.remove("show");
  }

  // ---------- flow ----------
  function startRun() {
    G.results = [];
    startReel(0);
  }

  function startReel(idx) {
    G.reel = idx;
    const built = buildCues(idx);
    G.cues = built.cues.map((c) => ({
      ...c,
      judged: false,
      holding: false,
      holdFrac: 0,
      result: null,
    }));
    G.totalCues = built.cues.length;
    G.reelLen = built.length;
    G.spb = built.spb;
    G.t = 0;
    G.sync = 85;
    G.score = 0;
    G.combo = 0;
    G.bestStreak = 0;
    G.perfects = 0;
    G.hits = 0;
    fx.floaters.length = 0;
    fx.rings.length = 0;
    fx.shards.length = 0;
    fx.rain = 0;
    fx.flash = 0;
    fx.shake = 0;
    fx.doorSwing = 0;
    fx.doorVel = 0;
    fx.lastLeaderNum = -1;
    fx.walkerX = 0.3;
    reelLabel.textContent = REEL_DEFS[idx].name;
    updateHud();
    G.mode = "intro";
    hideCard();
  }

  function endReel(passed) {
    AudioBox.stormStop(false);
    if (!passed) {
      G.mode = "cut";
      AudioBox.fail();
      showCard(
        "Cut!",
        "The sync fell apart and the director stormed out to phone the<br>booking agency. Take the reel from the top.",
        "Take it again",
      );
      return;
    }
    const syncAvg = Math.round(
      (G.hits ? clamp(G.sync, 0, 100) : 0) +
        (G.perfects / Math.max(1, G.totalCues)) * 6,
    );
    const rec = {
      score: G.score,
      sync: clamp(syncAvg, 0, 100),
      perfects: G.perfects,
      streak: G.bestStreak,
    };
    G.results.push(rec);
    if (G.reel < REEL_DEFS.length - 1) {
      G.mode = "reelEnd";
      AudioBox.win();
      showCard(
        "Reel in the can",
        "<b>" +
          REEL_DEFS[G.reel].name.replace(/^Reel \d+ \u00b7 /, "") +
          "</b><br>Score <b>" +
          G.score +
          "</b> &middot; sync <b>" +
          rec.sync +
          "%</b><br>Perfect hits " +
          G.perfects +
          " &middot; best streak " +
          G.bestStreak +
          "<br><br>The director almost smiled. One reel left after this&hellip;",
        "Load the next reel",
      );
    } else {
      G.mode = "final";
      AudioBox.win();
      const avg = Math.round(
        G.results.reduce((s, r) => s + r.sync, 0) / G.results.length,
      );
      const total = G.results.reduce((s, r) => s + r.score, 0);
      const grade =
        avg >= 92
          ? "A+"
          : avg >= 84
            ? "A"
            : avg >= 74
              ? "B"
              : avg >= 62
                ? "C"
                : "D";
      showCard(
        "Premiere saved",
        '<div class="grade' +
          (avg < 62 ? " bad" : "") +
          '">' +
          grade +
          "</div>Total score <b>" +
          total +
          "</b> &middot; average sync <b>" +
          avg +
          "%</b><br>The audience heard footsteps on gravel, a door that stuck,<br>a storm rolling in and one very unlucky vase.<br>Nobody guessed it was coconuts and celery.",
        "Back to the pit",
      );
    }
  }

  function togglePause(force) {
    if (G.mode === "play" || G.mode === "intro") {
      if (force === false) return;
      G.pausedFrom = G.mode;
      G.mode = "pause";
      if (AudioBox.ctx && AudioBox.ctx.state === "running")
        AudioBox.ctx.suspend();
      showCard(
        "Intermission",
        "The projector idles. The props wait on their shelf.<br><b>P</b> or the button carries on.",
        "Carry on",
      );
    } else if (G.mode === "pause") {
      if (force === true) return;
      G.mode = G.pausedFrom || "play";
      hideCard();
      if (AudioBox.ctx && AudioBox.ctx.state === "suspended")
        AudioBox.ctx.resume();
    }
  }

  // ---------- judging ----------
  const WIN_PERFECT = 0.09;
  const WIN_GREAT = 0.18;
  const WIN_GOOD = 0.3;

  function nearestCue(prop, window) {
    let best = null;
    let bd = Infinity;
    for (const c of G.cues) {
      if (c.judged || c.prop !== prop) continue;
      const d = Math.abs(c.t - G.t);
      if (d < bd && d <= window) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  function addFloater(text, color, x, y) {
    fx.floaters.push({ text, color, x, y, age: 0 });
    if (fx.floaters.length > 14) fx.floaters.shift();
  }

  function pulsePad(prop, cls) {
    const pad = document.querySelector('.pad[data-prop="' + prop + '"]');
    if (!pad) return;
    pad.classList.remove("hit", "miss");
    void pad.offsetWidth;
    pad.classList.add(cls);
    window.setTimeout(() => pad.classList.remove(cls), 240);
  }

  function applyHit(cue, quality) {
    cue.judged = true;
    cue.result = quality;
    const deltas = { perfect: 3, great: 2, good: 1 };
    const bases = { perfect: 150, great: 100, good: 55 };
    if (quality === "good") {
      // good: keep combo alive but no growth
    } else {
      G.combo++;
      G.bestStreak = Math.max(G.bestStreak, G.combo);
    }
    G.sync = clamp(G.sync + deltas[quality], 0, 100);
    const mult = 1 + Math.min(G.combo, 20) * 0.05;
    G.score += Math.round(bases[quality] * mult);
    if (quality === "perfect") G.perfects++;
    G.hits++;
    const r = regions();
    const colr =
      quality === "perfect"
        ? "#ffd98a"
        : quality === "great"
          ? "#7fb069"
          : "#b9a888";
    addFloater(
      quality.toUpperCase(),
      colr,
      r.gateX,
      r.strip.y - 10 - (fx.floaters.length % 3) * 16,
    );
    fx.rings.push({
      x: r.gateX,
      y: r.strip.y + r.strip.h * 0.5,
      age: 0,
      color: colr,
    });
    pulsePad(cue.prop, "hit");
    AudioBox.judge(quality);
    fx.directorMood = clamp(
      fx.directorMood + (quality === "perfect" ? 0.5 : 0.25),
      -1,
      1,
    );
    updateHud();
  }

  function applyMiss(cue) {
    if (G.mode !== "play") return;
    cue.judged = true;
    cue.result = "miss";
    G.combo = 0;
    G.sync = clamp(G.sync - 7, 0, 100);
    const r = regions();
    addFloater("MISS", "#d95d39", r.gateX, r.strip.y - 10);
    pulsePad(cue.prop, "miss");
    AudioBox.judge("miss");
    fx.directorMood = clamp(fx.directorMood - 0.55, -1, 1);
    updateHud();
    if (G.sync <= 0) endReel(false);
  }

  function press(prop) {
    AudioBox.ensure();
    if (G.mode !== "play") return;
    if (prop === "storm") {
      const cue = nearestCue("storm", WIN_GOOD);
      if (cue) {
        const dt = Math.abs(cue.t - G.t);
        const q =
          dt <= WIN_PERFECT ? "perfect" : dt <= WIN_GREAT ? "great" : "good";
        cue.holding = true;
        applyHit(cue, q);
        AudioBox.stormStart();
        return;
      }
      // early grab of a far storm cue: forgive silently
      if (nearestCue("storm", 0.65)) {
        AudioBox.stormStart();
        return;
      }
      whiff("storm");
      return;
    }
    const cue = nearestCue(prop, WIN_GOOD);
    if (cue) {
      const dt = Math.abs(cue.t - G.t);
      const q =
        dt <= WIN_PERFECT ? "perfect" : dt <= WIN_GREAT ? "great" : "good";
      reactScene(prop);
      applyHit(cue, q);
      return;
    }
    if (nearestCue(prop, 0.65)) {
      // a bit keen; play the sound, no penalty
      reactScene(prop, true);
      return;
    }
    whiff(prop);
  }

  function whiff(prop) {
    if (G.mode !== "play") return;
    G.combo = 0;
    G.sync = clamp(G.sync - 3, 0, 100);
    const r = regions();
    addFloater("off-cue", "#8d7a5f", r.gateX, r.strip.y - 10);
    AudioBox.dud();
    fx.directorMood = clamp(fx.directorMood - 0.3, -1, 1);
    updateHud();
    if (G.sync <= 0) endReel(false);
  }

  function release(prop) {
    if (prop !== "storm") return;
    if (G.mode === "play") {
      const cue = G.cues.find(
        (c) => c.prop === "storm" && c.holding && !c.released,
      );
      if (cue) {
        cue.released = true;
        const frac = clamp((G.t - cue.t) / cue.dur, 0, 1);
        cue.holdFrac = frac;
        AudioBox.stormStop(frac >= 0.55);
        if (frac >= 0.97) {
          G.score += 120;
          G.sync = clamp(G.sync + 4, 0, 100);
          addFloater(
            "FULL BED +" + 120,
            "#7fb069",
            regions().gateX,
            regions().strip.y - 10,
          );
          fx.flash = 0.5;
        } else if (frac >= 0.5) {
          G.score += Math.round(120 * frac);
          G.sync = clamp(G.sync + 1, 0, 100);
          addFloater(
            "short bed",
            "#b9a888",
            regions().gateX,
            regions().strip.y - 10,
          );
        } else {
          G.combo = 0;
          G.sync = clamp(G.sync - 3, 0, 100);
          addFloater(
            "dropped!",
            "#d95d39",
            regions().gateX,
            regions().strip.y - 10,
          );
          fx.directorMood = clamp(fx.directorMood - 0.4, -1, 1);
        }
        updateHud();
        if (G.sync <= 0) endReel(false);
      } else if (AudioBox.stormNodes) {
        AudioBox.stormStop(false);
      }
    } else if (AudioBox.stormNodes) {
      AudioBox.stormStop(false);
    }
  }

  function reactScene(prop, soft) {
    if (prop === "boots") {
      fx.stepImpulse = 1;
    } else if (prop === "door") {
      fx.doorVel = soft ? 2.2 : 3.4;
    } else if (prop === "crash") {
      spawnShards();
      fx.shake = soft ? 3 : 6;
    }
  }

  function spawnShards() {
    const sc = sceneCfg();
    const v = sc.vase;
    for (let i = 0; i < 14; i++) {
      fx.shards.push({
        x: v.x + (Math.random() - 0.5) * v.w * 0.6,
        y: v.y - Math.random() * v.h * 0.7,
        vx: (Math.random() - 0.5) * 90,
        vy: -40 - Math.random() * 110,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 8,
        size: 2 + Math.random() * 4,
        age: 0,
      });
    }
    fx.flash = Math.max(fx.flash, 0.25);
  }

  function sceneCfg() {
    const r = regions();
    const sx = r.screen.x;
    const sy = r.screen.y;
    const sw = r.screen.w;
    const sh = r.screen.h;
    if (REEL_DEFS[G.reel].scene === "alley")
      return {
        door: {
          x: sx + sw * 0.72,
          y: sy + sh * 0.42,
          w: sw * 0.11,
          h: sh * 0.52,
        },
        vase: {
          x: sx + sw * 0.42,
          y: sy + sh * 0.88,
          w: sw * 0.05,
          h: sh * 0.14,
        },
      };
    if (REEL_DEFS[G.reel].scene === "inn")
      return {
        door: {
          x: sx + sw * 0.08,
          y: sy + sh * 0.4,
          w: sw * 0.1,
          h: sh * 0.54,
        },
        vase: {
          x: sx + sw * 0.6,
          y: sy + sh * 0.72,
          w: sw * 0.045,
          h: sh * 0.12,
        },
      };
    return {
      door: { x: sx + sw * 0.66, y: sy + sh * 0.3, w: sw * 0.14, h: sh * 0.64 },
      vase: { x: sx + sw * 0.3, y: sy + sh * 0.86, w: sw * 0.05, h: sh * 0.15 },
    };
  }

  // ---------- update ----------
  function update(dt) {
    if (G.mode === "intro") {
      G.t += dt;
      const remain = LEAD_IN - G.t;
      const num = Math.ceil(remain);
      if (num !== fx.lastLeaderNum && num >= 1 && num <= 3) {
        fx.lastLeaderNum = num;
        AudioBox.tick(num === 1);
      }
      if (G.t >= LEAD_IN) {
        G.mode = "play";
        G.t = LEAD_IN;
      }
      return;
    }
    if (G.mode !== "play") return;
    G.t += dt;

    // auto-miss / auto-complete holds
    for (const c of G.cues) {
      if (G.mode !== "play") break;
      if (c.judged) continue;
      const endT = c.t + (c.dur || 0);
      if (c.holding) {
        c.holdFrac = clamp((G.t - c.t) / c.dur, 0, 1);
        if (G.t > endT + 0.35 && !c.released) {
          // kept holding to the end
          c.released = true;
          AudioBox.stormStop(true);
          G.score += 120;
          G.sync = clamp(G.sync + 4, 0, 100);
          fx.flash = 0.5;
          updateHud();
        }
        continue;
      }
      if (G.t > endT + WIN_GOOD) applyMiss(c);
    }

    // rain envelope follows active storm hold
    const holding = G.cues.some(
      (c) => c.holding && !c.released && G.t < c.t + c.dur + 0.2,
    );
    fx.rain = lerp(fx.rain, holding ? 1 : 0, 1 - Math.pow(0.0025, dt));

    // decay effects
    // the director cools off if you keep the bed steady - slow recovery
    G.sync = clamp(G.sync + dt * 0.9, 0, 100);
    fx.flash = Math.max(0, fx.flash - dt * 1.8);
    fx.shake = Math.max(0, fx.shake - dt * 14);
    fx.directorMood = lerp(fx.directorMood, 0, 1 - Math.pow(0.4, dt));
    fx.stepImpulse = Math.max(0, fx.stepImpulse - dt * 1.6);
    fx.stepPhase += dt * (3 + fx.stepImpulse * 14);
    fx.walkerX += dt * (0.004 + fx.stepImpulse * 0.03);
    if (fx.walkerX > 1.15) fx.walkerX = -0.15;
    // door spring
    fx.doorVel -= fx.doorSwing * 26 * dt;
    fx.doorVel *= Math.pow(0.05, dt);
    fx.doorSwing += fx.doorVel * dt;

    // shards physics
    for (const s of fx.shards) {
      s.age += dt;
      s.vy += 340 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
    }
    if (fx.shards.length > 80) fx.shards.splice(0, fx.shards.length - 80);

    // floaters/rings ageing
    for (const f of fx.floaters) f.age += dt;
    while (fx.floaters.length && fx.floaters[0].age > 0.8) fx.floaters.shift();
    for (const ring of fx.rings) ring.age += dt;
    while (fx.rings.length && fx.rings[0].age > 0.5) fx.rings.shift();

    if (G.t >= G.reelLen) {
      // finished the reel - did we keep it together?
      endReel(true);
    }
  }

  function updateHud() {
    syncFill.style.width = G.sync.toFixed(1) + "%";
    const danger = G.sync < 26;
    syncFill.style.opacity = danger ? "0.75" : "1";
    scoreLabel.textContent = G.score + " pts";
    comboLabel.textContent = G.combo > 1 ? "streak \u00d7" + G.combo : "\u00a0";
  }

  // ---------- drawing ----------
  function draw() {
    const r = regions();
    ctx.save();
    // room background
    ctx.fillStyle = "#0a0806";
    ctx.fillRect(0, 0, W, H);

    const shake = fx.shake;
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawScreen(r);
    drawStrip(r);
    drawDirector(r);
    drawFloaters(r);

    ctx.restore();
  }

  function drawScreen(r) {
    const s = r.screen;
    // screen cloth
    ctx.fillStyle = "#111111";
    ctx.fillRect(s.x - 6, s.y - 6, s.w + 12, s.h + 12);

    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();

    const flicker =
      0.06 + 0.03 * Math.sin(performance.now() * 0.021) + Math.random() * 0.03;
    const baseLum = 0.82 - flicker;

    if (G.mode === "title" || G.mode === "final") {
      drawTitleCard(s, baseLum);
    } else if (G.mode === "intro") {
      drawLeader(s, baseLum);
    } else {
      drawSceneShot(s, baseLum);
    }

    // grain
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    for (let i = 0; i < 34; i++) {
      ctx.fillRect(
        s.x + Math.random() * s.w,
        s.y + Math.random() * s.h,
        1.4,
        1.4,
      );
    }
    // scratch line occasionally
    if (Math.random() < 0.06) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(s.x + Math.random() * s.w, s.y, 1, s.h);
    }
    // flash
    if (fx.flash > 0) {
      ctx.fillStyle = "rgba(255,240,210," + (fx.flash * 0.5).toFixed(3) + ")";
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    // vignette
    const vg = ctx.createRadialGradient(
      s.x + s.w / 2,
      s.y + s.h / 2,
      s.h * 0.3,
      s.x + s.w / 2,
      s.y + s.h / 2,
      s.h * 0.85,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.restore();

    // reel burn-in
    ctx.font = "11px Georgia, serif";
    ctx.fillStyle = "rgba(232,180,100,0.75)";
    ctx.textAlign = "left";
    ctx.fillText(REEL_DEFS[G.reel].name.toUpperCase(), s.x + 8, s.y + 16);
    if (G.mode === "play") {
      const remain = Math.max(0, G.reelLen - G.t);
      ctx.textAlign = "right";
      ctx.fillText(Math.ceil(remain) + "s", s.x + s.w - 8, s.y + 16);
    }
  }

  function mono(lum) {
    const v = Math.round(clamp(lum, 0, 1) * 235);
    return "rgb(" + v + "," + v + "," + (v + 6) + ")";
  }

  function drawTitleCard(s, lum) {
    ctx.fillStyle = "#0c0c0e";
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.textAlign = "center";
    ctx.fillStyle = mono(lum);
    ctx.font = Math.round(s.h * 0.11) + "px Georgia, serif";
    ctx.fillText(
      "R U S T L E   &   T H U M P",
      s.x + s.w / 2,
      s.y + s.h * 0.42,
    );
    ctx.font = Math.round(s.h * 0.05) + "px Georgia, serif";
    ctx.fillStyle = mono(lum * 0.7);
    ctx.fillText(
      "a foley picture in three reels",
      s.x + s.w / 2,
      s.y + s.h * 0.55,
    );
    ctx.font = Math.round(s.h * 0.038) + "px Georgia, serif";
    ctx.fillStyle = mono(lum * 0.5);
    ctx.fillText("the pit awaits your boots", s.x + s.w / 2, s.y + s.h * 0.68);
  }

  function drawLeader(s, lum) {
    const remain = clamp(LEAD_IN - G.t, 0, LEAD_IN);
    const num = Math.max(1, Math.ceil(remain));
    const frac = 1 - (remain - Math.floor(remain));
    ctx.fillStyle = "#101012";
    ctx.fillRect(s.x, s.y, s.w, s.h);
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const rad = Math.min(s.w, s.h) * 0.32;
    ctx.strokeStyle = mono(lum * 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - rad * 1.15, cy);
    ctx.lineTo(cx + rad * 1.15, cy);
    ctx.moveTo(cx, cy - rad * 1.15);
    ctx.lineTo(cx, cy + rad * 1.15);
    ctx.stroke();
    // sweeping wipe
    ctx.fillStyle = "rgba(220,220,225,0.14)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rad * 1.3, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mono(lum);
    ctx.textAlign = "center";
    ctx.font = Math.round(rad * 1.15) + "px Georgia, serif";
    ctx.fillText(String(num), cx, cy + rad * 0.4);
    ctx.font = Math.round(s.h * 0.04) + "px Georgia, serif";
    ctx.fillStyle = mono(lum * 0.65);
    ctx.fillText("P I C T U R E   S T A R T", cx, s.y + s.h * 0.14);
  }

  function drawSceneShot(s, lum) {
    const scene = REEL_DEFS[G.reel].scene;
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(s.x, s.y, s.w, s.h);

    // ---- backdrop per reel ----
    if (scene === "alley") {
      // skyline blocks
      ctx.fillStyle = mono(lum * 0.32);
      const bs = [
        [0.02, 0.3, 0.16],
        [0.2, 0.18, 0.24],
        [0.47, 0.26, 0.2],
        [0.69, 0.12, 0.3],
      ];
      bs.forEach(([px, ph, pw]) => {
        ctx.fillRect(s.x + s.w * px, s.y + s.h * (1 - ph), s.w * pw, s.h * ph);
      });
      // windows
      ctx.fillStyle = mono(lum * 0.55);
      for (let i = 0; i < 12; i++) {
        const wx = s.x + s.w * (0.05 + ((i * 0.199) % 0.85));
        const wy = s.y + s.h * (0.35 + ((i * 0.233) % 0.4));
        ctx.fillRect(wx, wy, s.w * 0.014, s.h * 0.03);
      }
      // ground
      ctx.fillStyle = mono(lum * 0.22);
      ctx.fillRect(s.x, s.y + s.h * 0.88, s.w, s.h * 0.12);
      // lamppost
      ctx.strokeStyle = mono(lum * 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.x + s.w * 0.16, s.y + s.h * 0.9);
      ctx.lineTo(s.x + s.w * 0.16, s.y + s.h * 0.4);
      ctx.quadraticCurveTo(
        s.x + s.w * 0.16,
        s.y + s.h * 0.33,
        s.x + s.w * 0.2,
        s.y + s.h * 0.33,
      );
      ctx.stroke();
      const lampGlow = ctx.createRadialGradient(
        s.x + s.w * 0.205,
        s.y + s.h * 0.35,
        2,
        s.x + s.w * 0.205,
        s.y + s.h * 0.35,
        s.h * 0.22,
      );
      lampGlow.addColorStop(0, "rgba(255,230,170,0.5)");
      lampGlow.addColorStop(1, "rgba(255,230,170,0)");
      ctx.fillStyle = lampGlow;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    } else if (scene === "inn") {
      // interior wall panels
      ctx.fillStyle = mono(lum * 0.3);
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = mono(lum * 0.45);
      ctx.lineWidth = 2;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(s.x + (s.w / 5) * i, s.y + s.h * 0.08);
        ctx.lineTo(s.x + (s.w / 5) * i, s.y + s.h * 0.9);
        ctx.stroke();
      }
      // window with night outside (rain lights up during holds)
      const wx = s.x + s.w * 0.38;
      const wy = s.y + s.h * 0.16;
      const ww = s.w * 0.2;
      const wh = s.h * 0.34;
      ctx.fillStyle = mono(lum * (0.12 + fx.rain * 0.1));
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = mono(lum * 0.6);
      ctx.lineWidth = 3;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.moveTo(wx, wy + wh / 2);
      ctx.lineTo(wx + ww, wy + wh / 2);
      ctx.stroke();
      // bar counter
      ctx.fillStyle = mono(lum * 0.42);
      ctx.fillRect(s.x, s.y + s.h * 0.72, s.w, s.h * 0.1);
      ctx.fillStyle = mono(lum * 0.3);
      ctx.fillRect(s.x, s.y + s.h * 0.82, s.w, s.h * 0.1);
    } else {
      // vault corridor
      ctx.fillStyle = mono(lum * 0.24);
      ctx.fillRect(s.x, s.y, s.w, s.h);
      // perspective floor lines
      ctx.strokeStyle = mono(lum * 0.4);
      ctx.lineWidth = 1.5;
      for (let i = 0; i <= 6; i++) {
        const k = i / 6;
        ctx.beginPath();
        ctx.moveTo(s.x + s.w * k, s.y + s.h);
        ctx.lineTo(s.x + s.w * (0.5 + (k - 0.5) * 0.3), s.y + s.h * 0.55);
        ctx.stroke();
      }
      // brick courses
      ctx.strokeStyle = mono(lum * 0.3);
      for (let ry = 0; ry < 5; ry++) {
        const yy = s.y + s.h * (0.06 + ry * 0.09);
        ctx.beginPath();
        ctx.moveTo(s.x, yy);
        ctx.lineTo(s.x + s.w, yy);
        ctx.stroke();
      }
      // torch flicker pools
      for (const tx of [0.18, 0.52]) {
        const fl = 0.5 + 0.2 * Math.sin(performance.now() * 0.01 + tx * 40);
        const tg = ctx.createRadialGradient(
          s.x + s.w * tx,
          s.y + s.h * 0.4,
          2,
          s.x + s.w * tx,
          s.y + s.h * 0.4,
          s.h * 0.3 * fl,
        );
        tg.addColorStop(0, "rgba(255,190,110," + 0.28 * fl + ")");
        tg.addColorStop(1, "rgba(255,190,110,0)");
        ctx.fillStyle = tg;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    }

    // ---- door ----
    const cfg = sceneCfg();
    const d = cfg.door;
    ctx.save();
    ctx.translate(d.x, d.y + d.h);
    const swing = Math.sin(clamp(fx.doorSwing, 0, 1.4) * Math.PI * 0.62);
    ctx.transform(1, 0, swing * 0.45, 1, swing * d.w * 0.45, 0);
    ctx.fillStyle = mono(lum * 0.5);
    ctx.fillRect(0, -d.h, d.w, d.h);
    ctx.strokeStyle = mono(lum * 0.28);
    ctx.lineWidth = 2;
    ctx.strokeRect(0, -d.h, d.w, d.h);
    ctx.fillStyle = mono(lum * 0.75);
    ctx.beginPath();
    ctx.arc(d.w * 0.82, -d.h * 0.52, Math.max(2, d.w * 0.06), 0, TAU);
    ctx.fill();
    ctx.restore();

    // ---- walker silhouette ----
    const wxp = s.x + s.w * fx.walkerX;
    const wys = s.y + s.h * 0.9;
    const legSwing = Math.sin(fx.stepPhase) * (0.25 + fx.stepImpulse * 0.5);
    const bob = Math.abs(Math.sin(fx.stepPhase)) * 2 * fx.stepImpulse;
    ctx.strokeStyle = mono(lum * 0.16);
    ctx.lineWidth = Math.max(3, s.h * 0.014);
    ctx.lineCap = "round";
    ctx.beginPath();
    // legs
    ctx.moveTo(wxp, wys - s.h * 0.2 - bob);
    ctx.lineTo(wxp + legSwing * s.h * 0.09, wys);
    ctx.moveTo(wxp, wys - s.h * 0.2 - bob);
    ctx.lineTo(wxp - legSwing * s.h * 0.09, wys);
    // body + head
    ctx.moveTo(wxp, wys - s.h * 0.2 - bob);
    ctx.lineTo(wxp, wys - s.h * 0.42 - bob);
    ctx.stroke();
    ctx.fillStyle = mono(lum * 0.16);
    ctx.beginPath();
    ctx.arc(wxp, wys - s.h * 0.47 - bob, s.h * 0.035, 0, TAU);
    ctx.fill();

    // ---- vase ----
    const v = cfg.vase;
    const vaseAlive = !fx.shards.some((sh) => sh.age < 1.2);
    if (vaseAlive) {
      ctx.fillStyle = mono(lum * 0.62);
      ctx.beginPath();
      ctx.moveTo(v.x - v.w * 0.28, v.y - v.h);
      ctx.quadraticCurveTo(
        v.x - v.w * 0.75,
        v.y - v.h * 0.5,
        v.x - v.w * 0.4,
        v.y,
      );
      ctx.lineTo(v.x + v.w * 0.4, v.y);
      ctx.quadraticCurveTo(
        v.x + v.w * 0.75,
        v.y - v.h * 0.5,
        v.x + v.w * 0.28,
        v.y - v.h,
      );
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(v.x - v.w * 0.55, v.y, v.w * 1.1, v.h * 0.12);
    } else if (fx.shards.length === 0) {
      // respawn quietly for the next pass
    }

    // ---- shards ----
    ctx.fillStyle = mono(lum * 0.8);
    for (const sh of fx.shards) {
      if (sh.age > 2.2) continue;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.rot);
      const a = clamp(1 - sh.age / 2.2, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillRect(-sh.size / 2, -sh.size / 2, sh.size, sh.size * 0.7);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // ---- rain ----
    if (fx.rain > 0.02) {
      ctx.strokeStyle = "rgba(200,215,235," + (0.32 * fx.rain).toFixed(3) + ")";
      ctx.lineWidth = 1;
      const drops = Math.floor(70 * fx.rain);
      const tt = performance.now() * 0.001;
      for (let i = 0; i < drops; i++) {
        const seed = i * 127.13;
        const rx = s.x + ((seed * 13.7) % s.w);
        const ry =
          s.y + ((seed * 7.9 + tt * 620 * (0.7 + (i % 5) * 0.12)) % s.h);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 3, ry + 12);
        ctx.stroke();
      }
    }
  }

  function drawStrip(r) {
    const st = r.strip;
    // housing
    ctx.fillStyle = "#141009";
    ctx.fillRect(st.x, st.y, st.w, st.h);
    // film base
    ctx.fillStyle = "#1c1712";
    ctx.fillRect(st.x, st.y + st.h * 0.08, st.w, st.h * 0.84);

    const speed = (W - r.gateX) / 2.2; // px per second
    const holeW = 9;
    const holeGap = 26;
    const off = (G.t * speed) % holeGap;
    ctx.fillStyle = "#0a0806";
    for (let x = -holeGap; x < st.w + holeGap; x += holeGap) {
      const hx = x - off;
      ctx.fillRect(hx, st.y + st.h * 0.025, holeW, st.h * 0.045);
      ctx.fillRect(hx, st.y + st.h * 0.93, holeW, st.h * 0.045);
    }

    // frames: fillers + cue cells
    const fillGap = 52;
    const foff = (G.t * speed) % fillGap;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = -fillGap; x < st.w + fillGap; x += fillGap) {
      const fxx = x - foff;
      ctx.strokeRect(fxx, st.y + st.h * 0.16, fillGap - 4, st.h * 0.68);
    }

    for (const c of G.cues) {
      const x = r.gateX + (c.t - G.t) * speed;
      const cwBase = 74;
      const cw = c.dur ? cwBase + c.dur * speed : cwBase;
      if (x + cw < -40 || x > W + 40) continue;
      const cy = st.y + st.h * 0.16;
      const chh = st.h * 0.68;
      // cell
      const future = G.t < c.t;
      ctx.fillStyle = future ? "#241d14" : "#181310";
      ctx.fillRect(x, cy, cw, chh);
      ctx.strokeStyle = c.judged
        ? c.result === "miss"
          ? "rgba(217,93,57,0.8)"
          : "rgba(127,176,105,0.8)"
        : "rgba(232,180,100,0.55)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, cy, cw, chh);
      // icon
      drawCueIcon(
        c.prop,
        x + cw / 2,
        cy + chh * (c.dur ? 0.32 : 0.5),
        chh * 0.3,
        future ? 1 : 0.45,
      );
      // hold band
      if (c.dur) {
        const bandY = cy + chh * 0.62;
        ctx.fillStyle = "rgba(143,160,190,0.25)";
        ctx.fillRect(x + 6, bandY, cw - 12, chh * 0.22);
        if (c.holdFrac > 0) {
          ctx.fillStyle = "rgba(160,190,230,0.6)";
          ctx.fillRect(x + 6, bandY, (cw - 12) * c.holdFrac, chh * 0.22);
        }
      }
    }

    // gate
    const gx = r.gateX;
    const grad = ctx.createLinearGradient(gx - 26, 0, gx + 26, 0);
    grad.addColorStop(0, "rgba(255,217,138,0)");
    grad.addColorStop(0.5, "rgba(255,217,138,0.28)");
    grad.addColorStop(1, "rgba(255,217,138,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(gx - 26, st.y, 52, st.h);
    ctx.strokeStyle = "#ffd98a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, st.y + 4);
    ctx.lineTo(gx, st.y + st.h - 4);
    ctx.stroke();
    // pointer
    ctx.fillStyle = "#ffd98a";
    ctx.beginPath();
    ctx.moveTo(gx - 7, st.y - 10);
    ctx.lineTo(gx + 7, st.y - 10);
    ctx.lineTo(gx, st.y - 2);
    ctx.closePath();
    ctx.fill();

    // hit rings
    for (const ring of fx.rings) {
      const k = ring.age / 0.5;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, 8 + k * 34, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawCueIcon(prop, x, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    ctx.strokeStyle = "#e8b464";
    ctx.fillStyle = "#e8b464";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (prop === "boots") {
      ctx.moveTo(-8, -10);
      ctx.lineTo(-8, 8);
      ctx.lineTo(6, 8);
      ctx.quadraticCurveTo(10, 8, 8, 4);
      ctx.lineTo(-1, 4);
      ctx.moveTo(-8, -2);
      ctx.lineTo(-1, -2);
      ctx.stroke();
    } else if (prop === "door") {
      ctx.rect(-9, -12, 16, 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(3, 2, 1.8, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-2, 0, 9, -Math.PI * 0.8, -Math.PI * 0.1);
      ctx.stroke();
    } else if (prop === "storm") {
      ctx.moveTo(-10, -8);
      ctx.quadraticCurveTo(-2, -13, 4, -8);
      ctx.quadraticCurveTo(10, -3, 14, -8);
      ctx.stroke();
      ctx.moveTo(2, -6);
      ctx.lineTo(-5, 4);
      ctx.lineTo(1, 4);
      ctx.lineTo(-6, 14);
      ctx.lineTo(6, 2);
      ctx.lineTo(0, 2);
      ctx.closePath();
      ctx.fill();
    } else if (prop === "crash") {
      ctx.moveTo(-4, -12);
      ctx.quadraticCurveTo(-12, -4, -8, 6);
      ctx.quadraticCurveTo(-6, 12, 0, 12);
      ctx.quadraticCurveTo(6, 12, 8, 6);
      ctx.quadraticCurveTo(12, -4, 4, -12);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-1, -10);
      ctx.lineTo(2, -2);
      ctx.lineTo(-2, 3);
      ctx.lineTo(2, 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDirector(r) {
    // foreground silhouette of the director watching the screen, bottom-right
    const x = W - 54;
    const y = r.screen.y + r.screen.h + 26;
    const mood = fx.directorMood;
    const lean = mood * 6;
    const slump = mood < -0.4 ? 6 : 0;
    ctx.fillStyle = "rgba(8,6,4,0.9)";
    ctx.beginPath();
    ctx.arc(x + lean, y - 26 + slump, 13, 0, TAU);
    ctx.fill();
    ctx.fillRect(x - 14 + lean, y - 14 + slump, 28, 30);
    // beret
    ctx.fillRect(x - 15 + lean, y - 34 + slump, 30, 6);
    // megaphone-ish arm pointing at screen when pleased
    if (mood > 0.5) {
      ctx.strokeStyle = "rgba(8,6,4,0.9)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + 10 + lean, y - 6 + slump);
      ctx.lineTo(x + 26 + lean, y - 20 + slump);
      ctx.stroke();
    }
  }

  function drawFloaters(r) {
    ctx.textAlign = "center";
    for (const f of fx.floaters) {
      const k = f.age / 0.8;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.font = "bold " + Math.round(13 + (1 - k) * 5) + "px Georgia, serif";
      ctx.fillText(f.text.toUpperCase(), f.x, f.y - k * 26);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- input ----------
  const KEY_TO_PROP = {};
  for (const p of PROP_LIST) for (const k of PROPS[p].keys) KEY_TO_PROP[k] = p;

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "m") {
      toggleSound();
      e.preventDefault();
      return;
    }
    if (k === "p") {
      togglePause();
      e.preventDefault();
      return;
    }
    if (k === "r") {
      if (G.mode === "title") return;
      startReel(G.mode === "final" ? 0 : G.reel);
      e.preventDefault();
      return;
    }
    if (G.mode !== "play") {
      if ((k === "enter" || k === " ") && overlay.classList.contains("show")) {
        cardBtn.click();
        e.preventDefault();
      }
      return;
    }
    const prop = KEY_TO_PROP[k];
    if (prop && !e.repeat) {
      press(prop);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const prop = KEY_TO_PROP[e.key.toLowerCase()];
    if (prop) release(prop);
  });

  document.querySelectorAll("#pads .pad").forEach((pad) => {
    const prop = pad.dataset.prop;
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      press(prop);
    });
    pad.addEventListener("pointerup", (e) => {
      e.preventDefault();
      release(prop);
    });
    pad.addEventListener("pointercancel", () => release(prop));
    pad.addEventListener("pointerleave", () => release(prop));
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  function toggleSound() {
    AudioBox.ensure();
    AudioBox.setMuted(!AudioBox.muted);
    soundBtn.textContent = "Sound: " + (AudioBox.muted ? "off" : "on");
  }

  soundBtn.addEventListener("click", toggleSound);
  pauseBtn.addEventListener("click", () => togglePause());
  restartBtn.addEventListener("click", () => {
    if (G.mode === "title") return;
    startReel(G.mode === "final" ? 0 : G.reel);
  });

  cardBtn.addEventListener("click", () => {
    AudioBox.ensure();
    if (G.mode === "title") startRun();
    else if (G.mode === "cut") startReel(G.reel);
    else if (G.mode === "reelEnd")
      startReel(Math.min(G.reel + 1, REEL_DEFS.length - 1));
    else if (G.mode === "final") startRun();
    else if (G.mode === "pause") togglePause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (G.mode === "play" || G.mode === "intro") togglePause(true);
    }
  });

  // ---------- main loop ----------
  let last = performance.now();
  let rafId = 0;
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.mode !== "pause") update(dt);
    if (G.mode === "play") updateHud();
    draw();
  }

  // ---------- go ----------
  resize();
  paintPadArts();
  updateHud();
  reelLabel.textContent = "Reel \u2013";
  showCard(
    "Rustle & Thump",
    "The picture is mute and tomorrow is the premiere. You are the foley artist: when a cue reaches the projector gate, hit its prop.<br><br><b>1 / A</b> coconut boots &middot; <b>2 / S</b> door &middot; <b>3 / D</b> thunder sheet (hold) &middot; <b>4 / F</b> breakage<br>Tap the pads on touch. Keep the sync meter up or the director calls cut.<br><br><b>P</b> pause &middot; <b>M</b> mute &middot; <b>R</b> restart reel",
    "Roll the reel",
  );
  rafId = requestAnimationFrame(frame);
  void rafId;
})();
