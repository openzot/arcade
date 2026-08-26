/*
 * UXB — a Blitz bomb-disposal game for the arcade.
 *
 * Each device carries a bundle of fuze wires and a clockwork delay. The
 * wireless reads out disposal orders that pin every wire's place in the one
 * safe cutting sequence. Work the order out, then cut every wire before the
 * fuze burns down. A wire out of place detonates the charge.
 *
 * All behaviour lives here, wrapped in one IIFE. Vanilla canvas + Web Audio.
 */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */

  const TAU = Math.PI * 2;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function randInt(a, b) {
    return Math.floor(rand(a, b + 1));
  }

  function choice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function store(key, val) {
    try {
      if (val === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, val);
    } catch (e) {
      /* private mode etc. — play on without persistence */
    }
    return null;
  }

  /* ---------------- dom ---------------- */

  const canvas = $("scene");
  const ctx = canvas.getContext("2d");
  const stageEl = $("stage");
  const probeEl = $("probe");
  const hudDevice = $("hud-device");
  const hudScore = $("hud-score");
  const hudTime = $("hud-time");
  const hudBest = $("hud-best");
  const ordersTitle = $("orders-title");
  const ordersSerial = $("orders-serial");
  const ordersList = $("orders-list");
  const overlayEl = $("overlay");
  const ovKicker = $("ov-kicker");
  const ovTitle = $("ov-title");
  const ovBody = $("ov-body");
  const ovActions = $("ov-actions");

  if (!ctx.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
      return this;
    };
  }

  /* ---------------- flavour text ---------------- */

  const PLACES = [
    "under the goods shed, Bermondsey",
    "in the school shelter, Stepney",
    "beneath the viaduct arch, Walworth",
    "off Cable Street, past the crater field",
    "by the gasworks boundary, Bromley-by-Bow",
    "under the chapel floor, Poplar",
    "in the timber yard, Rotherhithe",
    "at the tram depot, Deptford",
    "behind the registry office, Camberwell",
    "in the allotment furrows, West Ham",
    "under the flyover pier, Limehouse",
    "in the coach house, Bethnal Green",
    "by the canal lock, Hackney Wick",
    "under the market floor, Spitalfields",
  ];

  const LOSE_LINES = [
    "The wardens will have the crater filled by morning.",
    "They are calling it a direct hit on an empty shop. It was not empty.",
    "Your number two digs alone tonight.",
    "The bus route is diverted. The buses stopped anyway.",
  ];

  /* ---------------- device generation ---------------- */

  const DEVICES_TOTAL = 5;
  const TIER_N = [4, 5, 6, 7, 8];
  const TIER_SECONDS = [75, 85, 95, 110, 125];
  const TIER_WIDE = [0.12, 0.22, 0.32, 0.44, 0.55];

  const COLOURS = [
    { name: "red", label: "red", hex: "#b03327" },
    { name: "amber", label: "amber", hex: "#cf9426" },
    { name: "blue", label: "blue", hex: "#3f6fa3" },
    { name: "green", label: "green", hex: "#5f7d43" },
  ];

  const ENDS = [
    { key: "bulb", cap: "Bulb-ended", low: "bulb-ended" },
    { key: "tag", cap: "Tag-ended", low: "tag-ended" },
    { key: "bare", cap: "Bare-ended", low: "bare-ended" },
  ];

  function colHtml(k) {
    return `<b class="oc-${COLOURS[k].name}">${COLOURS[k].label}</b>`;
  }

  function makeWires(n) {
    let cols;
    for (;;) {
      cols = [];
      for (let i = 0; i < n; i++) cols.push(randInt(0, COLOURS.length - 1));
      if (new Set(cols).size >= 2) break;
    }
    const stripeCount = randInt(1, Math.max(1, Math.floor(n / 2)));
    const striped = new Set(
      shuffle([...Array(n).keys()]).slice(0, stripeCount),
    );
    let ends;
    for (;;) {
      ends = [];
      for (let i = 0; i < n; i++) ends.push(randInt(0, ENDS.length - 1));
      if (new Set(ends).size >= 2) break;
    }
    const wires = [];
    for (let i = 0; i < n; i++) {
      wires.push({
        colour: cols[i],
        striped: striped.has(i),
        end: ends[i],
        jy: rand(-14, 14),
        bow: rand(16, 42),
        phase: rand(0, TAU),
      });
    }
    return wires;
  }

  /* Wide rules: "every X wire before every Y wire". Only offered when the
     hidden truth really keeps class X entirely ahead of class Y, so a rule
     is always honest. */
  function featureCandidates(wires, pos, a, b) {
    const wa = wires[a];
    const wb = wires[b];
    const dims = [];
    if (wa.colour !== wb.colour) {
      dims.push({
        get: (w) => w.colour,
        text: (A, B) =>
          `Every ${colHtml(A)} wire is cut before every ${colHtml(B)} wire.`,
      });
    }
    if (wa.striped !== wb.striped) {
      dims.push({
        get: (w) => w.striped,
        text: (A) =>
          A
            ? "Every <b>striped</b> wire is cut before every <b>plain</b> one."
            : "Every <b>plain</b> wire is cut before every <b>striped</b> one.",
      });
    }
    if (wa.end !== wb.end) {
      dims.push({
        get: (w) => w.end,
        text: (A, B) =>
          `${ENDS[A].cap} wires are cut before ${ENDS[B].low} ones.`,
      });
    }
    const out = [];
    for (const dim of dims) {
      const ca = dim.get(wa);
      const cb = dim.get(wb);
      const pairs = [];
      let honest = true;
      for (let x = 0; x < wires.length && honest; x++) {
        if (dim.get(wires[x]) !== ca) continue;
        for (let y = 0; y < wires.length; y++) {
          if (x === y || dim.get(wires[y]) !== cb) continue;
          if (pos[x] > pos[y]) {
            honest = false;
            break;
          }
          pairs.push([x, y]);
        }
      }
      if (honest && pairs.length) out.push({ text: dim.text(ca, cb), pairs });
    }
    return out;
  }

  /* Count linear extensions of the partial order, capped at `cap`, so the
     generator can prove each device has exactly one safe order. */
  function countOrders(n, pairList, cap) {
    const before = Array.from({ length: n }, () => []);
    for (const p of pairList) before[p[1]].push(p[0]);
    const used = new Array(n).fill(false);
    let count = 0;
    function rec(d) {
      if (count >= cap) return;
      if (d === n) {
        count++;
        return;
      }
      for (let x = 0; x < n; x++) {
        if (used[x]) continue;
        let ok = true;
        for (const a of before[x]) {
          if (!used[a]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        used[x] = true;
        rec(d + 1);
        used[x] = false;
        if (count >= cap) return;
      }
    }
    rec(0);
    return count;
  }

  function generateDevice(tierIdx) {
    const n = TIER_N[tierIdx];
    const wires = makeWires(n);

    for (let attempt = 0; attempt < 60; attempt++) {
      const truth = shuffle([...Array(n).keys()]);
      const pos = [];
      truth.forEach((w, i) => {
        pos[w] = i;
      });
      const rules = [];
      const covered = new Set();
      const markCovered = (r) => {
        for (const p of r.pairs) covered.add(p[0] * 32 + p[1]);
      };
      const addRule = (r) => {
        markCovered(r);
        if (!rules.some((q) => q.text === r.text)) rules.push(r);
      };

      /* Every consecutive pair of the hidden truth ends up pinned directly
         by some rule, so the puzzle provably has exactly one solution. */
      for (let i = 0; i < n - 1; i++) {
        const a = truth[i];
        const b = truth[i + 1];
        if (covered.has(a * 32 + b)) continue;
        const roll = Math.random();
        let rule = null;
        if (roll < TIER_WIDE[tierIdx]) {
          const cands = featureCandidates(wires, pos, a, b);
          if (cands.length) rule = choice(cands);
        } else if (roll < TIER_WIDE[tierIdx] + 0.33) {
          rule = {
            text: `Peg ${a + 1} comes immediately before peg ${b + 1}.`,
            pairs: [[a, b]],
          };
        }
        if (!rule && tierIdx >= 2 && i === 0 && Math.random() < 0.22) {
          const pairs = [];
          for (let j = 0; j < n; j++) if (j !== a) pairs.push([a, j]);
          rule = { text: `Peg ${a + 1} is the first wire cut.`, pairs };
        }
        if (!rule && tierIdx >= 2 && i === n - 2 && Math.random() < 0.18) {
          const pairs = [];
          for (let j = 0; j < n; j++) if (j !== b) pairs.push([j, b]);
          rule = { text: `Peg ${b + 1} is the last wire cut.`, pairs };
        }
        if (!rule) {
          rule = {
            text: `Peg ${a + 1} is cut before peg ${b + 1}.`,
            pairs: [[a, b]],
          };
        }
        addRule(rule);
      }

      const allPairs = [];
      for (const r of rules) for (const p of r.pairs) allPairs.push(p);
      if (countOrders(n, allPairs, 2) !== 1) continue;

      return finishDevice(wires, truth, rules, tierIdx);
    }

    /* unreachable fallback: plain positional chain */
    const truth = shuffle([...Array(n).keys()]);
    const rules = [];
    for (let i = 0; i < truth.length - 1; i++) {
      rules.push({
        text: `Peg ${truth[i] + 1} is cut before peg ${truth[i + 1] + 1}.`,
        pairs: [[truth[i], truth[i + 1]]],
      });
    }
    return finishDevice(wires, truth, rules, tierIdx);
  }

  function finishDevice(wires, truth, rules, tierIdx) {
    return {
      n: wires.length,
      wires,
      truth,
      rules,
      seconds: TIER_SECONDS[tierIdx],
      serial:
        choice("ABCDEFGHJKLMNPRSTUVWX") +
        randInt(1, 9) +
        choice("ABCDEFGHJKLMNPRSTUVWX") +
        "-" +
        String(randInt(10, 99)),
      place: choice(PLACES),
    };
  }

  /* ---------------- audio ---------------- */

  let actx = null;
  let master = null;
  let muted = store("uxb-muted") === "1";

  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(actx.destination);
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function setMuted(m) {
    muted = m;
    store("uxb-muted", m ? "1" : "0");
    if (master) master.gain.value = m ? 0 : 0.5;
    const b = $("btn-sound");
    b.classList.toggle("muted", m);
    b.setAttribute("aria-pressed", String(!m));
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (!actx || muted) return;
    const t0 = actx.currentTime + (when || 0);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, freq, when) {
    if (!actx || muted) return;
    const t0 = actx.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const sfx = {
    tick(hi) {
      tone(hi ? 1560 : 1180, 0.045, "square", hi ? 0.09 : 0.05);
    },
    snip() {
      noiseBurst(0.06, 0.35, 4200);
      tone(2300, 0.07, "triangle", 0.12, 0.01, 1400);
    },
    safe() {
      tone(880, 0.5, "sine", 0.22);
      tone(1174.7, 0.7, "sine", 0.18, 0.12);
      noiseBurst(0.25, 0.12, 2600, 0.02);
    },
    thud() {
      tone(120, 0.18, "sine", 0.3, 0, 60);
      noiseBurst(0.08, 0.2, 500);
    },
    boom() {
      tone(70, 1.4, "sine", 0.85, 0, 28);
      tone(52, 1.8, "triangle", 0.5, 0.02, 24);
      noiseBurst(0.9, 0.7, 300);
      noiseBurst(0.5, 0.4, 1200, 0.05);
    },
    ui() {
      tone(660, 0.05, "square", 0.06);
    },
    select() {
      tone(520, 0.04, "square", 0.045);
    },
  };

  /* ---------------- state ---------------- */

  const state = {
    mode: "title", // title | playing | stamp | boom | paused | report
    prevMode: "playing",
    tier: 0,
    devIndex: 0,
    score: 0,
    best: parseInt(store("uxb-best") || "0", 10) || 0,
    device: null,
    cutSet: new Set(),
    cutCount: 0,
    selected: -1,
    hovered: -1,
    timeLeft: 0,
    timeTotal: 1,
    lastTickSec: -1,
    particles: [],
    rings: [],
    shake: 0,
    flash: 0,
    stampT: 0,
    boomT: 0,
    specks: [],
  };

  /* deterministic backdrop rubble */
  (function makeSpecks() {
    let seed = 19400717;
    function srnd() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    for (let i = 0; i < 90; i++) {
      state.specks.push({ x: srnd(), y: srnd(), r: 0.4 + srnd() * 1.4 });
    }
  })();

  /* ---------------- geometry ---------------- */

  const geo = { W: 0, H: 0, paths: [], mids: [], casing: null };

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = stageEl.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geo.W = w;
    geo.H = h;
    layoutWires();
  }

  function bezPoint(p0, c1, c2, p1, t) {
    const u = 1 - t;
    return {
      x:
        u * u * u * p0.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * p1.x,
      y:
        u * u * u * p0.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * p1.y,
    };
  }

  function layoutWires() {
    geo.paths = [];
    geo.mids = [];
    geo.casing = null;
    const dev = state.device;
    if (!dev || !geo.W) return;
    const n = dev.n;
    const cw = clamp(geo.W * 0.15, 58, 104);
    const ch = geo.H * 0.62;
    const cx = geo.W / 2;
    const top = geo.H * 0.2;
    geo.casing = { x: cx - cw / 2, y: top, w: cw, h: ch };
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const frac = n === 1 ? 0.5 : i / (n - 1);
      const pad = ch * 0.09;
      const py = top + pad + (ch - pad * 2) * frac + dev.wires[i].jy * 0.6;
      const pegX = cx + side * (cw / 2);
      const tx = side === -1 ? 30 : geo.W - 30;
      const ty = py + dev.wires[i].jy;
      const bow = dev.wires[i].bow;
      const mx = (pegX + tx) / 2 + (side === -1 ? 6 : -6);
      const p0 = { x: pegX, y: py };
      const c1 = { x: mx, y: py + bow * 0.55 };
      const c2 = { x: mx, y: ty + bow * 0.55 };
      const p1 = { x: tx - side * 14, y: ty };
      const pts = [];
      for (let s = 0; s <= 26; s++) {
        pts.push(bezPoint(p0, c1, c2, p1, s / 26));
      }
      geo.paths.push({ p0, c1, c2, p1, pts, side });
      geo.mids.push(bezPoint(p0, c1, c2, p1, 0.5));
    }
  }

  function hitWire(mx, my) {
    const dev = state.device;
    if (!dev) return -1;
    let bestD = 17 * 17;
    let hit = -1;
    for (let i = 0; i < dev.n; i++) {
      if (state.cutSet.has(i)) continue;
      const path = geo.paths[i];
      if (!path) continue;
      for (let s = 2; s < path.pts.length - 2; s++) {
        const dx = path.pts[s].x - mx;
        const dy = path.pts[s].y - my;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          hit = i;
        }
      }
    }
    return hit;
  }

  function spawnSparks(x, y, count, spread, hot) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, TAU);
      const sp = rand(20, spread);
      state.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 30,
        life: rand(0.35, 0.9),
        age: 0,
        hot: hot !== false,
        size: rand(1, 2.6),
      });
    }
  }

  /* ---------------- rendering ---------------- */

  function drawBackdrop() {
    ctx.clearRect(0, 0, geo.W, geo.H);
    const g = ctx.createLinearGradient(0, 0, 0, geo.H);
    g.addColorStop(0, "#12100b");
    g.addColorStop(0.55, "#0d0b08");
    g.addColorStop(1, "#080706");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, geo.W, geo.H);
    ctx.fillStyle = "rgba(201,168,106,0.05)";
    for (const s of state.specks) {
      ctx.beginPath();
      ctx.arc(s.x * geo.W, s.y * geo.H, s.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawFuseBar(tNow, frac) {
    const y = 16;
    const x0 = 18;
    const x1 = geo.W - 18;
    const L = x1 - x0;
    const sparkX = x0 + L * clamp(frac, 0, 1);
    ctx.save();
    ctx.strokeStyle = "rgba(201,168,106,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = "#7a5b34";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(sparkX, y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(233,223,198,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(sparkX, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(120,112,96,0.4)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sparkX, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    if (state.mode === "playing") {
      const flick = 0.75 + 0.25 * Math.sin(tNow * 31);
      const gr = ctx.createRadialGradient(sparkX, y, 0, sparkX, y, 14);
      gr.addColorStop(0, `rgba(255,214,130,${0.9 * flick})`);
      gr.addColorStop(0.4, `rgba(255,138,40,${0.55 * flick})`);
      gr.addColorStop(1, "rgba(255,90,20,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(sparkX, y, 14, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffe9b0";
      ctx.beginPath();
      ctx.arc(sparkX, y, 2.2, 0, TAU);
      ctx.fill();
      if (Math.random() < 0.3) spawnSparks(sparkX, y, 1, 40);
    }
    ctx.restore();
  }

  function drawCasing() {
    const c = geo.casing;
    if (!c) return;
    const cg = ctx.createLinearGradient(c.x, 0, c.x + c.w, 0);
    cg.addColorStop(0, "#3a3527");
    cg.addColorStop(0.5, "#4a4433");
    cg.addColorStop(1, "#2e2a1e");
    ctx.fillStyle = cg;
    ctx.strokeStyle = "#191611";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(c.x, c.y + 12, c.w, c.h - 12, 10);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x + 2, c.y + 18);
    ctx.quadraticCurveTo(c.x + c.w / 2, c.y - 26, c.x + c.w - 2, c.y + 18);
    ctx.closePath();
    ctx.fillStyle = "#403a2b";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#211d15";
    ctx.beginPath();
    ctx.roundRect(c.x - 5, c.y + c.h - 8, c.w + 10, 12, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(233,223,198,0.16)";
    for (let ry = c.y + 30; ry < c.y + c.h - 16; ry += 34) {
      ctx.beginPath();
      ctx.arc(c.x + 8, ry, 1.8, 0, TAU);
      ctx.arc(c.x + c.w - 8, ry, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.font = '600 11px "Courier New", monospace';
    ctx.fillStyle = "rgba(233,223,198,0.28)";
    ctx.textAlign = "center";
    if (state.device) ctx.fillText(state.device.serial, 0, 3.5);
    ctx.restore();
  }

  function drawTerminal(i, w, p1) {
    const dead = state.cutSet.has(i);
    ctx.save();
    ctx.translate(p1.x, p1.y);
    if (ENDS[w.end].key === "bulb") {
      ctx.fillStyle = dead ? "#57503f" : "#f2e7c9";
      ctx.strokeStyle = dead ? "#40392c" : "#c9a86a";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (!dead) {
        ctx.strokeStyle = "#a8843c";
        ctx.beginPath();
        ctx.moveTo(-3, -2);
        ctx.lineTo(-1, 2);
        ctx.lineTo(1, -2);
        ctx.lineTo(3, 2);
        ctx.stroke();
      }
    } else if (ENDS[w.end].key === "tag") {
      ctx.fillStyle = dead ? "#6b6350" : "#e9dfc6";
      ctx.strokeStyle = "#8a744a";
      ctx.beginPath();
      ctx.rect(-6, -8, 12, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#8c2f24";
      ctx.fillRect(-4, -2, 8, 1.6);
      ctx.fillRect(-4, 2, 8, 1.6);
    } else {
      ctx.strokeStyle = dead ? "#57503f" : "#cabfa2";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(-2, 2);
      ctx.moveTo(3, -6);
      ctx.lineTo(3, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPegLabel(i, p0) {
    const dead = state.cutSet.has(i);
    const dir = geo.paths[i].side;
    ctx.save();
    ctx.translate(p0.x, p0.y);
    ctx.beginPath();
    ctx.arc(dir * 13, 0, 9, 0, TAU);
    ctx.fillStyle = "#171410";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = dead ? "#4a4335" : "#8a744a";
    ctx.stroke();
    ctx.fillStyle = dead ? "#6b6350" : "#e9dfc6";
    ctx.font = '700 10px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), dir * 13, 0.5);
    ctx.restore();
  }

  function drawWirePath(i, tNow) {
    const dev = state.device;
    const w = dev.wires[i];
    const path = geo.paths[i];
    const col = COLOURS[w.colour];
    const sway =
      state.mode === "playing" ? Math.sin(tNow * 1.7 + w.phase) * 2.2 : 0;
    const c1 = { x: path.c1.x + sway, y: path.c1.y };
    const c2 = { x: path.c2.x + sway * 0.6, y: path.c2.y };

    ctx.beginPath();
    ctx.moveTo(path.p0.x, path.p0.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, path.p1.x, path.p1.y);
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();

    ctx.lineWidth = 5;
    ctx.strokeStyle = col.hex;
    ctx.stroke();

    if (w.striped) {
      ctx.save();
      ctx.lineWidth = 5;
      ctx.setLineDash([6, 10]);
      ctx.strokeStyle = "rgba(240,232,208,0.85)";
      ctx.stroke();
      ctx.restore();
    }

    const sel = state.selected === i;
    const hov = state.hovered === i;
    if (sel || hov) {
      ctx.save();
      ctx.lineWidth = sel ? 11 : 9;
      ctx.strokeStyle = sel
        ? `rgba(233,223,198,${0.45 + 0.25 * Math.sin(tNow * 6)})`
        : "rgba(233,223,198,0.22)";
      ctx.setLineDash(sel ? [10, 8] : []);
      ctx.lineDashOffset = -tNow * 40;
      ctx.stroke();
      ctx.restore();
    }

    drawTerminal(i, w, path.p1);
    drawPegLabel(i, path.p0);
  }

  function drawStub(i, tEnd, atStart) {
    const pts = geo.paths[i].pts;
    const a = atStart ? pts[0] : pts[Math.max(0, pts.length - 5)];
    const b = atStart ? pts[Math.min(pts.length - 1, 4)] : pts[pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#3d372b";
    ctx.stroke();
    const tip = atStart ? b : a;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y + 2, 2.4, 0, TAU);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function drawStamp() {
    if (state.stampT <= 0) return;
    const k = 1 - state.stampT / 1.25;
    const pop = k < 0.18 ? k / 0.18 : 1;
    const scale = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3));
    const alpha = state.stampT < 0.25 ? state.stampT / 0.25 : 1;
    ctx.save();
    ctx.translate(geo.W / 2, geo.H * 0.3);
    ctx.rotate(-0.12);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = '800 34px "Courier New", monospace';
    const tw = ctx.measureText("MADE SAFE").width;
    ctx.strokeStyle = "#8c2f24";
    ctx.lineWidth = 3;
    ctx.strokeRect(-tw / 2 - 16, -30, tw + 32, 60);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-tw / 2 - 10, -24, tw + 20, 48);
    ctx.fillStyle = "#8c2f24";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("MADE SAFE", 0, 1);
    ctx.restore();
  }

  function drawLowTime(tNow) {
    if (state.mode !== "playing" || state.timeLeft > 12) return;
    const a =
      (0.16 + 0.1 * Math.sin(tNow * 6)) *
      clamp((12 - state.timeLeft) / 12, 0, 1);
    const g = ctx.createLinearGradient(0, geo.H, 0, 0);
    g.addColorStop(0, `rgba(178,51,39,${a})`);
    g.addColorStop(1, "rgba(178,51,39,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, geo.W, geo.H);
  }

  function draw(tNow) {
    drawBackdrop();
    if (!state.device) return;

    ctx.save();
    if (state.shake > 0) {
      ctx.translate(
        rand(-state.shake, state.shake),
        rand(-state.shake, state.shake),
      );
    }

    drawFuseBar(tNow, state.timeLeft / state.timeTotal);
    drawCasing();

    for (let i = 0; i < state.device.n; i++) {
      if (state.cutSet.has(i)) {
        drawStub(i, true);
        drawStub(i, false);
      }
    }
    for (let i = 0; i < state.device.n; i++) {
      if (!state.cutSet.has(i)) drawWirePath(i, tNow);
    }

    for (const p of state.particles) {
      const fade = 1 - p.age / p.life;
      ctx.fillStyle = p.hot
        ? `rgba(255,${Math.floor(150 + 100 * fade)},60,${fade})`
        : `rgba(90,84,66,${fade})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }

    drawStamp();
    drawLowTime(tNow);

    for (const r of state.rings) {
      ctx.strokeStyle = `rgba(255,196,110,${Math.max(0, r.a)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,240,210,${clamp(state.flash, 0, 1)})`;
      ctx.fillRect(0, 0, geo.W, geo.H);
    }
  }

  /* ---------------- hud & orders panel ---------------- */

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return (
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0")
    );
  }

  function refreshHud() {
    hudDevice.textContent = `DEVICE ${Math.min(
      state.devIndex + 1,
      DEVICES_TOTAL,
    )}/${DEVICES_TOTAL}`;
    hudScore.textContent = `${state.score} PTS`;
    hudTime.textContent = fmtTime(state.timeLeft);
    hudTime.classList.toggle(
      "low",
      state.mode === "playing" && state.timeLeft <= 12,
    );
    hudBest.textContent = state.best > 0 ? `BEST ${state.best}` : "";
  }

  function renderOrders() {
    const dev = state.device;
    ordersTitle.textContent = `Field Orders \u2014 Device ${
      state.devIndex + 1
    }`;
    ordersSerial.textContent = `SERIAL ${dev.serial} \u00b7 ${dev.place}`;
    ordersList.innerHTML = "";
    dev.rules.forEach((r, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="ord-num">${idx + 1}.</span> ${r.text}`;
      ordersList.appendChild(li);
    });
  }

  function probeDefault() {
    const left = state.device ? state.device.n - state.cutCount : 0;
    probeEl.innerHTML =
      state.mode === "playing"
        ? `${left} WIRES REMAIN \u00b7 CLOCKWORK FUZE RUNNING`
        : "\u00a0";
  }

  function probeWire(i) {
    const w = state.device.wires[i];
    const parts = [
      `PEG ${i + 1}`,
      COLOURS[w.colour].label.toUpperCase(),
      w.striped ? "STRIPED" : "PLAIN",
      ENDS[w.end].key.toUpperCase(),
    ];
    probeEl.innerHTML = `${parts.join(" \u00b7 ")} \u2014 <b>TAP AGAIN TO CUT</b>`;
  }

  /* ---------------- overlay ---------------- */

  function showOverlay(kicker, title, bodyHtml, buttons) {
    ovKicker.textContent = kicker;
    ovTitle.textContent = title;
    ovBody.innerHTML = bodyHtml;
    ovActions.innerHTML = "";
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      if (b.cls) btn.className = b.cls;
      btn.addEventListener("click", () => {
        btn.blur();
        sfx.ui();
        b.fn();
      });
      ovActions.appendChild(btn);
    }
    overlayEl.classList.add("show");
  }

  function hideOverlay() {
    overlayEl.classList.remove("show");
  }

  function showTitle() {
    state.mode = "title";
    refreshHud();
    probeEl.innerHTML = "\u00a0";
    showOverlay(
      "ROYAL ENGINEERS \u00b7 1940",
      "UXB",
      `<p>London, the Blitz. Five buried parachutes in five nights. Every fuze carries a bundle of wires and a clockwork delay, and the wireless has just read your disposal orders.</p>
       <div class="how">READ THE ORDERS &mdash; they pin each wire's place.<br />
       WORK OUT the one sequence that obeys them all.<br />
       CUT every wire in that order &mdash; tap it twice, or arrows + Enter.<br />
       One wire out of place, or one second too slow, and it goes.</div>
       <p>Devices grow from four wires to eight across the shift. Steady hands, Number One.</p>`,
      [{ label: "BEGIN SHIFT", cls: "primary", fn: startShift }],
    );
  }

  function showPaused() {
    showOverlay(
      "SHIFT SUSPENDED",
      "PAUSED",
      `<p>The clockwork waits for no one &mdash; tonight it will wait for you.</p>
       <p class="stamp-line">Device ${state.devIndex + 1} of ${
         DEVICES_TOTAL
       } &middot; ${fmtTime(state.timeLeft)} left on the fuze</p>`,
      [
        { label: "RESUME", cls: "primary", fn: resumeGame },
        { label: "ABANDON SHIFT", fn: showTitle },
      ],
    );
  }

  function finaliseScore() {
    if (state.score > state.best) {
      state.best = state.score;
      store("uxb-best", String(state.best));
      return true;
    }
    return false;
  }

  function rankFor(score) {
    if (score >= 5200) return "awarded the George Cross.";
    if (score >= 3800) return "awarded the George Medal.";
    if (score >= 2400) return "mentioned in dispatches twice over.";
    return "commended for steady work under fire.";
  }

  function showWin() {
    state.mode = "report";
    const newBest = finaliseScore();
    refreshHud();
    showOverlay(
      `${DEVICES_TOTAL} DEVICES \u00b7 ALL CLEAR`,
      "ALL CLEAR",
      `<p>The last fuze is cold and the street above is quiet. You made safe every device this week without losing a man.</p>
       <ul><li>Score <b>${state.score}</b>${
         newBest ? " \u2014 a new personal best" : ""
       }</li><li>You are ${rankFor(state.score)}</li></ul>
       <p>The bus runs Monday. Go home, Number One.</p>`,
      [{ label: "NEW SHIFT", cls: "primary", fn: startShift }],
    );
  }

  function showDetonated() {
    state.mode = "report";
    const cleared = state.devIndex;
    const newBest = finaliseScore();
    refreshHud();
    showOverlay(
      "REPORT TO DIVISION",
      "DETONATED",
      `<p>${state.device.place}. Device ${state.devIndex + 1} went up.</p>
       <ul><li>Devices made safe: <b>${cleared}</b> of ${
         DEVICES_TOTAL
       }</li><li>Score <b>${state.score}</b>${
         newBest ? " \u2014 a new personal best" : ""
       }</li></ul>
       <p>${choice(LOSE_LINES)}</p>`,
      [{ label: "NEW SHIFT", cls: "primary", fn: startShift }],
    );
  }

  /* ---------------- game flow ---------------- */

  function startShift() {
    audio();
    state.score = 0;
    state.devIndex = 0;
    state.tier = 0;
    hideOverlay();
    newDevice();
    state.mode = "playing";
    refreshHud();
  }

  function newDevice() {
    state.device = generateDevice(state.tier);
    state.cutSet = new Set();
    state.cutCount = 0;
    state.selected = -1;
    state.hovered = -1;
    state.timeTotal = state.device.seconds;
    state.timeLeft = state.device.seconds;
    state.lastTickSec = Math.ceil(state.timeLeft);
    state.particles = [];
    state.rings = [];
    state.flash = 0;
    state.shake = 0;
    renderOrders();
    layoutWires();
    probeDefault();
  }

  function pauseGame() {
    if (state.mode !== "playing" && state.mode !== "stamp") return;
    state.prevMode = state.mode;
    state.mode = "paused";
    showPaused();
  }

  function resumeGame() {
    if (state.mode !== "paused") return;
    hideOverlay();
    state.mode = state.prevMode || "playing";
    refreshHud();
  }

  function beginStamp() {
    state.score += 500 + Math.round(Math.max(0, state.timeLeft)) * 10;
    state.mode = "stamp";
    state.stampT = 1.25;
    sfx.safe();
    setTimeout(() => sfx.thud(), 160);
    refreshHud();
    probeDefault();
  }

  function detonate() {
    state.mode = "boom";
    state.boomT = 1.15;
    state.flash = 1;
    state.shake = 15;
    const mid = (state.selected >= 0 && geo.mids[state.selected]) || {
      x: geo.W / 2,
      y: geo.H / 2,
    };
    state.rings = [
      { x: mid.x, y: mid.y, r: 6, a: 0.9 },
      { x: mid.x, y: mid.y, r: 2, a: 0.7 },
    ];
    spawnSparks(mid.x, mid.y, 60, 320);
    for (let i = 0; i < 26; i++) {
      state.particles.push({
        x: mid.x + rand(-30, 30),
        y: mid.y + rand(-30, 30),
        vx: rand(-60, 60),
        vy: rand(-120, 20),
        life: rand(0.6, 1.4),
        age: 0,
        hot: false,
        size: rand(2, 4),
      });
    }
    sfx.boom();
    probeDefault();
  }

  function doCut(i) {
    if (!state.device || state.mode !== "playing") return;
    if (state.cutSet.has(i)) return;
    const expected = state.device.truth[state.cutCount];
    const mid = geo.mids[i];
    spawnSparks(mid.x, mid.y, 14, 130);
    state.cutSet.add(i);
    state.selected = -1;
    sfx.snip();
    if (i === expected) {
      state.cutCount++;
      probeDefault();
      if (state.cutCount === state.device.n) beginStamp();
    } else {
      detonate();
    }
  }

  function selectWire(i) {
    if (i === state.selected) {
      doCut(i);
      return;
    }
    state.selected = i;
    probeWire(i);
    sfx.select();
  }

  /* ---------------- input ---------------- */

  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  canvas.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || state.mode !== "playing") return;
    const pt = canvasPoint(ev);
    const h = hitWire(pt.x, pt.y);
    if (h !== state.hovered) {
      state.hovered = h;
      if (h >= 0 && h !== state.selected) probeWire(h);
      else probeDefault();
    }
  });

  canvas.addEventListener("pointerdown", (ev) => {
    if (state.mode !== "playing") return;
    ev.preventDefault();
    audio();
    const pt = canvasPoint(ev);
    const h = hitWire(pt.x, pt.y);
    if (h < 0) {
      state.selected = -1;
      probeDefault();
      return;
    }
    selectWire(h);
  });

  function cycleSelection(dir) {
    const dev = state.device;
    if (!dev || state.mode !== "playing") return;
    const alive = [];
    for (let i = 0; i < dev.n; i++) if (!state.cutSet.has(i)) alive.push(i);
    if (!alive.length) return;
    let idx = alive.indexOf(state.selected);
    idx = (idx + dir + alive.length) % alive.length;
    state.selected = alive[idx];
    probeWire(state.selected);
  }

  window.addEventListener("keydown", (ev) => {
    const k = ev.key;
    if (k === "m" || k === "M") {
      setMuted(!muted);
      return;
    }
    if (k === "p" || k === "P") {
      if (state.mode === "paused") resumeGame();
      else pauseGame();
      return;
    }
    if (k === "r" || k === "R") {
      showTitle();
      return;
    }
    if (state.mode !== "playing") {
      if ((k === "Enter" || k === " ") && state.mode === "title") {
        ev.preventDefault();
        startShift();
      }
      return;
    }
    if (k === "ArrowUp" || k === "ArrowLeft") {
      ev.preventDefault();
      cycleSelection(-1);
    } else if (k === "ArrowDown" || k === "ArrowRight") {
      ev.preventDefault();
      cycleSelection(1);
    } else if (k === "Enter" || k === " ") {
      ev.preventDefault();
      if (state.selected >= 0) doCut(state.selected);
    } else if (k === "Escape") {
      state.selected = -1;
      probeDefault();
    }
  });

  $("btn-sound").addEventListener("click", () => {
    audio();
    setMuted(!muted);
  });
  $("btn-pause").addEventListener("click", () => {
    if (state.mode === "paused") resumeGame();
    else pauseGame();
  });
  $("btn-restart").addEventListener("click", () => {
    showTitle();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "playing") pauseGame();
  });

  window.addEventListener("resize", resizeCanvas);

  /* ---------------- update & main loop ---------------- */

  function update(dt) {
    state.flash = Math.max(0, state.flash - dt * 3.2);
    state.shake = Math.max(0, state.shake - dt * 26);

    for (const p of state.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.hot ? 190 : 90) * dt;
      p.vx *= 1 - dt * 1.6;
    }
    state.particles = state.particles.filter((p) => p.age < p.life);

    for (const r of state.rings) {
      r.r += dt * 340;
      r.a -= dt * 1.4;
    }
    state.rings = state.rings.filter((r) => r.a > 0);

    if (state.mode === "playing") {
      state.timeLeft -= dt;
      const sec = Math.ceil(state.timeLeft);
      if (sec !== state.lastTickSec && sec > 0) {
        state.lastTickSec = sec;
        sfx.tick(sec <= 10);
      }
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        refreshHud();
        detonate();
        return;
      }
      refreshHud();
    } else if (state.mode === "stamp") {
      state.stampT -= dt;
      if (state.stampT <= 0) {
        state.devIndex++;
        if (state.devIndex >= DEVICES_TOTAL) {
          showWin();
        } else {
          state.tier = state.devIndex;
          newDevice();
          state.mode = "playing";
          refreshHud();
        }
      }
    } else if (state.mode === "boom") {
      state.boomT -= dt;
      if (state.boomT <= 0) showDetonated();
    }
  }

  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */

  /* Headless self-test hook: inert unless the page is loaded with
     #uxb-debug in the URL. Never part of normal play. */
  if (location.hash === "#uxb-debug") {
    window.__uxb = { state, geo };
  }

  setMuted(muted);
  resizeCanvas();
  showTitle();
  requestAnimationFrame(frame);
})();
