/* Ashglaze - throw six commissioned vessels on a spinning potter's wheel
   before each lump of clay stiffens. All behaviour lives in this file,
   wrapped in an IIFE so nothing leaks to global scope. */
(() => {
  'use strict';

  /* ---------- helpers ---------- */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;

  /* ---------- virtual stage ---------- */

  const VW = 640;
  const VH = 560;
  const S = 26; // profile slices, bottom -> top
  const RB = 150; // nominal vessel radius in virtual px
  const MINR = 16;
  const MAXR = 176;
  const MAXH = 340;
  const MINH = 70;
  const AXISX = VW / 2;
  const BASEY = 452;

  /* ---------- commissions ---------- */

  // pts: [t, radiusMultiplier] control points, t 0 bottom .. 1 top.
  const COMMS = [
    {
      name: 'Sun Pan',
      pts: [[0, 0.94], [0.12, 0.9], [0.45, 0.66], [0.75, 0.5], [0.92, 0.46], [1, 0.5]],
      tol: 30,
      time: 90,
      hfrac: 0.4,
    },
    {
      name: 'Straight Cup',
      pts: [[0, 0.52], [0.25, 0.5], [0.6, 0.47], [1, 0.5]],
      tol: 20,
      time: 85,
      hfrac: 0.62,
    },
    {
      name: 'Moon Jar',
      pts: [[0, 0.6], [0.18, 0.86], [0.4, 1.0], [0.62, 0.96], [0.8, 0.72], [1, 0.46]],
      tol: 24,
      time: 90,
      hfrac: 0.58,
    },
    {
      name: 'Gourd Bottle',
      pts: [[0, 0.42], [0.15, 0.78], [0.35, 0.94], [0.52, 0.7], [0.68, 0.32], [0.85, 0.22], [1, 0.24]],
      tol: 22,
      time: 85,
      hfrac: 0.74,
    },
    {
      name: 'Heron Vase',
      pts: [[0, 0.5], [0.2, 0.36], [0.5, 0.3], [0.75, 0.34], [0.9, 0.44], [1, 0.56]],
      tol: 20,
      time: 80,
      hfrac: 0.97,
    },
    {
      name: 'Night Tea Bowl',
      pts: [[0, 0.58], [0.3, 0.66], [0.55, 0.63], [0.8, 0.54], [1, 0.58]],
      tol: 16,
      time: 80,
      hfrac: 0.5,
    },
  ];

  const GRADES = [
    {
      min: 0.86,
      word: 'Master glaze',
      note: 'It rings like a struck bowl. The buyer will never know how close the wobble came.',
    },
    {
      min: 0.68,
      word: 'Kept',
      note: 'Honest ware. It will hold soup and memory alike.',
    },
    {
      min: 0.45,
      word: 'Seconds',
      note: 'Glaze laid thick, lines true-ish. It goes to the stall at the gate.',
    },
    {
      min: -1,
      word: 'Cracked in the fire',
      note: 'The kiln gods took their share. It happens.',
    },
  ];

  function gradeFor(acc) {
    for (const g of GRADES) if (acc >= g.min) return g;
    return GRADES[GRADES.length - 1];
  }

  function buildTarget(def) {
    const out = new Array(S);
    for (let i = 0; i < S; i++) {
      const t = (i + 0.5) / S;
      let k = 0;
      while (k < def.pts.length - 2 && def.pts[k + 1][0] < t) k++;
      const a = def.pts[k];
      const b = def.pts[k + 1];
      let u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      u = clamp(u, 0, 1);
      u = u * u * (3 - 2 * u); // smoothstep between control points
      out[i] = lerp(a[1], b[1], u) * RB;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < S - 1; i++) out[i] = (out[i - 1] + out[i] * 2 + out[i + 1]) / 4;
    }
    return out;
  }

  /* ---------- state ---------- */

  const c = $('wheel');
  const ctx = c.getContext('2d');

  let state = 'INTRO'; // INTRO | THROW | COLLAPSE | RESULT | FINALE
  let paused = false;
  let commIdx = 0;
  let lumps = 4;
  const LUMPS_START = 4;
  let made = new Array(COMMS.length).fill(null);
  let retrySame = false;

  let target = null;
  let def = null;
  let prof = [];
  let H = 160;
  let T = 90;
  let Tmax = 90;
  let moist = 1;
  let wobble = 0;
  let spin = 0.85;
  let ang = 0;
  let toolT = 0.45;
  let prevToolT = 0.45;
  let pressAmt = 0;
  let crackAcc = 0;
  const crackMarks = [];
  let collapseT = 0;
  let pudProf = null;
  let pudH = MINH * 0.6;

  const particles = [];

  // inputs
  let keyUp = false;
  let keyDown = false;
  let keyIn = false;
  let keyOut = false;
  let keyWater = false;
  let btnIn = false;
  let btnOut = false;
  let btnWater = false;
  let ptr = null; // {dir:-1|+1}

  /* ---------- audio ---------- */

  let AC = null;
  let master = null;
  let humOsc = null;
  let humGain = null;
  let scrapeGain = null;
  let muted = false;

  function ensureAudio() {
    if (AC) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      AC = new Ctor();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(AC.destination);

      humOsc = AC.createOscillator();
      humOsc.type = 'sawtooth';
      humOsc.frequency.value = 46;
      const humFilter = AC.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 150;
      humGain = AC.createGain();
      humGain.gain.value = 0;
      humOsc.connect(humFilter).connect(humGain).connect(master);
      humOsc.start();

      const len = AC.sampleRate;
      const buf = AC.createBuffer(1, len, AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = AC.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const bp = AC.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 850;
      bp.Q.value = 0.8;
      scrapeGain = AC.createGain();
      scrapeGain.gain.value = 0;
      noise.connect(bp).connect(scrapeGain).connect(master);
      noise.start();
    } catch (err) {
      AC = null;
    }
  }

  function tone(freq, type, dur, vol) {
    if (!AC) return;
    try {
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = type;
      o.frequency.value = freq;
      const t0 = AC.currentTime;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur);
    } catch (err) {
      /* keep playing silent */
    }
  }

  const sfxChime = () => {
    tone(660, 'sine', 0.5, 0.22);
    setTimeoutSafe(() => tone(990, 'sine', 0.7, 0.18), 110);
  };
  const sfxThud = () => {
    tone(72, 'sine', 0.45, 0.4);
    tone(48, 'triangle', 0.6, 0.3);
  };
  const sfxCrack = () => tone(140, 'square', 0.07, 0.16);
  const sfxSplash = () => tone(1250, 'sine', 0.09, 0.06);
  const sfxTick = () => tone(520, 'sine', 0.05, 0.05);

  function setTimeoutSafe(fn, ms) {
    try {
      setTimeout(fn, ms);
    } catch (err) {
      fn();
    }
  }

  /* ---------- DOM refs ---------- */

  const elOrderno = $('orderno');
  const elOrdername = $('ordername');
  const elGw = $('gw');
  const elGt = $('gt');
  const elGd = $('gd');
  const elAcc = $('acc');
  const elLumps = $('lumps');
  const elVeil = $('veil');
  const elInter = $('inter');
  const elFinale = $('finale');
  const elPauseov = $('pauseov');
  const elIstamp = $('istamp');
  const elIname = $('iname');
  const elInote = $('inote');
  const elBnext = $('bnext');
  const elShelf = $('shelf');
  const elFrank = $('frank');

  /* ---------- flow ---------- */

  function startComm(i) {
    commIdx = i;
    def = COMMS[i];
    target = buildTarget(def);
    prof = target.map(() => RB * 0.56);
    H = Math.round(def.hfrac * MAXH * 0.55);
    Tmax = def.time;
    T = Tmax;
    moist = 1;
    wobble = 0;
    spin = 0.85;
    ang = 0;
    toolT = 0.45;
    prevToolT = 0.45;
    pressAmt = 0;
    crackAcc = 0;
    crackMarks.length = 0;
    particles.length = 0;
    ptr = null;
    retrySame = false;
    state = 'THROW';
    paused = false;
    hide(elVeil);
    hide(elInter);
    hide(elFinale);
    hide(elPauseov);
    syncOrderCard();
  }

  function beginDay() {
    lumps = LUMPS_START;
    made = new Array(COMMS.length).fill(null);
    startComm(0);
  }

  function syncOrderCard() {
    elOrderno.textContent =
      'commission ' + (commIdx + 1) + ' of ' + COMMS.length;
    elOrdername.textContent = def.name;
  }

  function show(el) {
    el.classList.remove('hidden');
  }
  function hide(el) {
    el.classList.add('hidden');
  }

  function liveAcc() {
    let sum = 0;
    for (let i = 0; i < S; i++) sum += Math.abs(prof[i] - target[i]);
    return clamp(1 - sum / S / def.tol, 0, 1);
  }

  function setAside() {
    if (state !== 'THROW') return;
    const acc = liveAcc();
    const grade = gradeFor(acc);
    made[commIdx] = {
      prof: prof.slice(),
      H,
      acc,
      name: def.name,
      grade,
    };
    state = 'RESULT';
    setScrape(0);
    sfxChime();
    elIstamp.textContent = grade.word;
    elIstamp.classList.toggle('bad', acc < 0.45);
    elIname.textContent = def.name;
    elInote.textContent =
      'true ' +
      Math.round(acc * 100) +
      '% — ' +
      grade.note +
      (commIdx === COMMS.length - 1 ? '' : ' It cools on the shelf.');
    elBnext.textContent =
      commIdx === COMMS.length - 1 ? 'open the kiln ⏎' : 'next vessel ⏎';
    show(elInter);
  }

  function loseLump() {
    lumps -= 1;
    if (lumps > 0) {
      state = 'RESULT';
      retrySame = true;
      setScrape(0);
      sfxThud();
      elIstamp.textContent = 'Lost to the floor';
      elIstamp.classList.add('bad');
      elIname.textContent = def.name;
      elInote.textContent =
        'The wall shook itself off centre and slumped. ' +
        lumps +
        (lumps === 1 ? ' lump' : ' lumps') +
        ' of clay left.';
      elBnext.textContent = 'wedge another ⏎';
      show(elInter);
    } else {
      made[commIdx] = null;
      openKiln(true);
    }
  }

  function startCollapse() {
    state = 'COLLAPSE';
    collapseT = 1.15;
    pudProf = prof.map((r, i) => {
      const t = i / (S - 1);
      return r * Math.max(0.25, 1 - t * 1.7);
    });
    pudH = MINH * 0.6;
    setScrape(0);
    sfxThud();
  }

  function openKiln(outOfClay) {
    state = 'FINALE';
    setScrape(0);
    elShelf.textContent = '';
    let sum = 0;
    let n = 0;
    made.forEach((m, idx) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (m ? '' : ' empty');
      if (m) {
        slot.appendChild(potSvg(m.prof, m.H));
        sum += m.acc;
        n++;
      }
      const nm = document.createElement('span');
      nm.className = 'sname';
      nm.textContent = COMMS[idx].name;
      slot.appendChild(nm);
      const gr = document.createElement('span');
      gr.className = 'sgrade';
      gr.textContent = m ? m.grade.word : outOfClay ? 'no clay left' : '—';
      slot.appendChild(gr);
      elShelf.appendChild(slot);
    });
    let rank;
    if (n === 0) rank = 'A handful of mud, returned to the yard.';
    else {
      const mean = sum / n;
      if (mean >= 0.85) rank = 'Master of the yard — mean trueness ' + Math.round(mean * 100) + '%.';
      else if (mean >= 0.62)
        rank = 'An honest local hand — mean trueness ' + Math.round(mean * 100) + '%.';
      else rank = 'Apprentice still — the clay forgives. Mean trueness ' + Math.round(mean * 100) + '%.';
      if (n < COMMS.length) rank += ' The shelf stands part-filled.';
    }
    elFrank.textContent = rank;
    show(elFinale);
  }

  function advance() {
    if (state === 'INTRO') {
      ensureAudio();
      beginDay();
      return;
    }
    if (state === 'RESULT') {
      if (retrySame) startComm(commIdx);
      else if (commIdx === COMMS.length - 1) openKiln(false);
      else startComm(commIdx + 1);
      return;
    }
    if (state === 'FINALE') beginDay();
  }

  function togglePause() {
    if (state !== 'THROW' && !paused) return;
    paused = !paused;
    setScrape(0);
    if (paused) show(elPauseov);
    else hide(elPauseov);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    $('bsound').textContent = muted ? 'muted' : 'sound';
  }

  function setScrape(v) {
    if (scrapeGain && AC)
      scrapeGain.gain.setTargetAtTime(v, AC.currentTime, 0.05);
  }

  /* ---------- shaping ---------- */

  function tearTop() {
    sfxCrack();
    for (let i = 0; i < S; i++) {
      const t = i / (S - 1);
      if (t > 0.62) prof[i] *= 0.42;
    }
    crackMarks.push({ t: 0.66 + Math.random() * 0.28, side: Math.random() < 0.5 ? -1 : 1 });
    for (let k = 0; k < 14; k++)
      particles.push({
        x: AXISX + (Math.random() - 0.5) * 60,
        y: BASEY - H * 0.7 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 120,
        vy: -Math.random() * 80,
        life: 0.5,
        col: '#d96b4f',
        r: 2.2,
      });
  }

  function update(dt) {
    ang += dt * (2.2 + spin * 9);

    if (humGain && AC) {
      humGain.gain.setTargetAtTime(
        state === 'THROW' || state === 'COLLAPSE' ? 0.05 * spin : 0.02,
        AC.currentTime,
        0.1,
      );
      humOsc.frequency.setTargetAtTime(38 + spin * 26, AC.currentTime, 0.1);
    }

    if (state === 'COLLAPSE') {
      collapseT -= dt;
      const k = 1 - Math.exp(-dt * 6);
      for (let i = 0; i < S; i++) prof[i] = lerp(prof[i], pudProf[i], k);
      H = lerp(H, pudH, k);
      spin = Math.max(0, spin - dt * 0.6);
      if (collapseT <= 0) loseLump();
      updateParticles(dt);
      return;
    }

    if (state !== 'THROW') {
      updateParticles(dt);
      return;
    }

    const inKey = keyIn || btnIn || (!!ptr && ptr.dir < 0);
    const outKey = keyOut || btnOut || (!!ptr && ptr.dir > 0);
    const water = keyWater || btnWater;
    const dir = inKey === outKey ? 0 : inKey ? -1 : 1;
    const pressing = dir !== 0;

    pressAmt += ((pressing ? 1 : 0) - pressAmt) * Math.min(1, dt * 7);
    spin = clamp(spin - dt * 0.35 * pressAmt + dt * 0.28 * (1 - pressAmt), 0, 1);

    // tool height via keys (pointer sets it directly on move/down)
    if (keyUp) toolT = clamp(toolT - dt * 0.5, 0, 1);
    if (keyDown) toolT = clamp(toolT + dt * 0.5, 0, 1);
    const toolVel = (toolT - prevToolT) / Math.max(dt, 1e-4);
    prevToolT = toolT;

    if (pressing) {
      const eff = clamp(moist * 2.6, 0.22, 1);
      const rate = 30 * dt * eff;
      const idxF = toolT * S - 0.5;
      const sig = 2.6;
      for (let i = 0; i < S; i++) {
        const d = i - idxF;
        const g = Math.exp(-(d * d) / (2 * sig * sig));
        if (g < 0.01) continue;
        const delta = dir * rate * g;
        prof[i] = clamp(prof[i] + delta, MINR, MAXR);
        // displaced clay bulges the neighbours a little
        const smear = -delta * 0.3;
        if (i > 0) prof[i - 1] = clamp(prof[i - 1] + smear * 0.65, MINR, MAXR);
        if (i < S - 1) prof[i + 1] = clamp(prof[i + 1] + smear * 0.65, MINR, MAXR);
      }
      // pulling up while pressing in raises the wall
      if (dir < 0 && toolVel < -0.02) {
        const rise = -toolVel * 260 * dt * (0.4 + 0.6 * eff);
        H = clamp(H + rise, MINH, MAXH);
      }
      // wet clay slumps under the hand
      if (moist > 0.92) {
        for (let i = 0; i < S; i++) {
          const t = i / (S - 1);
          if (t > 0.55) prof[i] += dt * 6 * t;
        }
        H = clamp(H - dt * 3, MINH, MAXH);
      }
      // dry clay cracks instead of moving
      if (moist < 0.35) {
        crackAcc += dt * (0.35 - moist) * 2.2;
        if (crackAcc >= 1) {
          crackAcc = 0;
          tearTop();
        }
      }
      // off-centre stress builds with hard work, eases when the wheel settles
      wobble = clamp(wobble + dt * pressAmt * pressAmt * (0.17 - 0.12 * spin), 0, 1);
      if (toolT < 0.14 && spin > 0.55) wobble = clamp(wobble - dt * 0.1, 0, 1); // centring stroke
      if (wobble >= 1) {
        updateParticles(dt);
        startCollapse();
        return;
      }
      if (Math.random() < dt * pressAmt * 16)
        particles.push({
          x: AXISX + (dir < 0 ? 1 : -1) * (profAt(toolT) + 6),
          y: BASEY - toolT * H,
          vx: (Math.random() - 0.5) * 60,
          vy: -30 - Math.random() * 50,
          life: 0.45,
          col: '#c9825b',
          r: 1.8,
        });
    } else {
      wobble = clamp(wobble - dt * 0.04, 0, 1);
    }

    // moisture
    moist = clamp(moist - dt * (0.004 + 0.02 * pressAmt), 0, 1);
    if (water) {
      const wasDry = moist < 0.95;
      moist = clamp(moist + dt * 0.3, 0, 1);
      if (wasDry && Math.random() < dt * 26) {
        particles.push({
          x: AXISX + (Math.random() - 0.5) * profAt(toolT) * 1.6,
          y: BASEY - toolT * H,
          vx: (Math.random() - 0.5) * 50,
          vy: 20 + Math.random() * 60,
          life: 0.5,
          col: '#7fb4c9',
          r: 1.6,
        });
        if (Math.random() < 0.12) sfxSplash();
      }
    }

    setScrape(pressAmt * 0.12 * (0.3 + moist));

    T -= dt;
    if (T <= 0) {
      T = 0;
      if (liveAcc() < 0.4) {
        // too far gone when the clay stiffened: the lump is lost
        startCollapse();
      } else {
        setAside();
      }
    }

    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      if (p.life <= 0 || p.y > BASEY + 24) particles.splice(i, 1);
    }
  }

  function profAt(t) {
    const f = clamp(t, 0, 1) * S - 0.5;
    const i = clamp(Math.floor(f), 0, S - 1);
    const j = clamp(i + 1, 0, S - 1);
    const u = clamp(f - i, 0, 1);
    return lerp(prof[i], prof[j], u);
  }

  /* ---------- render ---------- */

  let bw = 0;
  let bh = 0;

  function resize() {
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w !== bw || h !== bh || c.width !== Math.round(w * dpr)) {
      bw = w;
      bh = h;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
  }

  function render() {
    resize();
    const scale = Math.min(c.width / VW, c.height / VH);
    const ox = (c.width - VW * scale) / 2;
    const oy = (c.height - VH * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.clearRect(-ox / scale, -oy / scale, c.width / scale, c.height / scale);

    drawWheelHead();

    if (target && (state === 'THROW' || state === 'COLLAPSE')) drawGhost();
    if (prof.length) drawPot();
    drawTool();
    drawParticles();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawWheelHead() {
    const rx = RB * 1.55;
    const ry = rx * 0.24;
    const wy = BASEY + 16;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(AXISX, wy + 10, rx * 1.02, ry * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    // wooden head
    const grad = ctx.createLinearGradient(AXISX - rx, 0, AXISX + rx, 0);
    grad.addColorStop(0, '#4a3323');
    grad.addColorStop(0.5, '#6b4a31');
    grad.addColorStop(1, '#42301f');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(AXISX, wy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // rotating spokes
    ctx.strokeStyle = 'rgba(240,226,207,0.16)';
    ctx.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      const a = ang * 0.5 + (k * Math.PI) / 3;
      const sx = AXISX + Math.cos(a) * rx * 0.82;
      const sy = wy + Math.sin(a) * ry * 0.82;
      ctx.beginPath();
      ctx.moveTo(AXISX, wy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
    // hub + splash pan rim
    ctx.fillStyle = '#2b2018';
    ctx.beginPath();
    ctx.arc(AXISX, wy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(224,164,88,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(AXISX, wy, rx + 14, ry * 1.12, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function outlinePts(radiusFn, height, wobFn) {
    const right = [];
    for (let i = 0; i < S; i++) {
      const t = i / (S - 1);
      const r = radiusFn(i, t);
      const w = wobFn ? wobFn(t) : 0;
      right.push({ x: AXISX + r + w, y: BASEY - t * height });
    }
    const left = [];
    for (let i = S - 1; i >= 0; i--) {
      const t = i / (S - 1);
      const r = radiusFn(i, t);
      const w = wobFn ? wobFn(t) : 0;
      left.push({ x: AXISX - (r + w), y: BASEY - t * height });
    }
    return right.concat(left);
  }

  function pathFrom(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function drawPot() {
    const wobAmp = Math.pow(wobble, 1.5) * 9;
    const pts = outlinePts(
      (i, t) => prof[i],
      H,
      (t) => Math.sin(ang * 2 + t * 4) * wobAmp * (0.25 + t),
    );
    const grad = ctx.createLinearGradient(AXISX - RB, 0, AXISX + RB, 0);
    grad.addColorStop(0, '#7d452c');
    grad.addColorStop(0.32, '#c9825b');
    grad.addColorStop(0.55, '#b06a45');
    grad.addColorStop(1, '#6f3d27');
    ctx.fillStyle = grad;
    pathFrom(pts);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,16,10,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // rim hollow
    const rt = prof[S - 1];
    const ty = BASEY - H;
    ctx.fillStyle = 'rgba(43,22,13,0.85)';
    ctx.beginPath();
    ctx.ellipse(AXISX, ty, Math.max(rt - 7, 4), Math.max(rt * 0.16, 3.5), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,226,207,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(AXISX, ty, rt, Math.max(rt * 0.18, 4), 0, 0, Math.PI * 2);
    ctx.stroke();

    // spinning sheen
    const sh = Math.sin(ang * 2);
    ctx.strokeStyle = 'rgba(255,235,210,' + (0.1 + 0.08 * sh).toFixed(3) + ')';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let i = 0; i < S; i++) {
      const t = i / (S - 1);
      const x = AXISX + Math.sin(ang) * prof[i] * 0.55 + Math.sin(ang * 2 + t * 4) * wobAmp * (0.25 + t);
      const y = BASEY - t * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // crack marks
    ctx.strokeStyle = 'rgba(60,25,14,0.9)';
    ctx.lineWidth = 1.6;
    for (const cm of crackMarks) {
      const y = BASEY - cm.t * H;
      const x = AXISX + cm.side * profAt(cm.t);
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + cm.side * 5, y);
      ctx.lineTo(x - cm.side * 2, y + 8);
      ctx.stroke();
    }
  }

  function drawGhost() {
    const th = def.hfrac * MAXH;
    const pts = outlinePts((i, t) => target[i], th, () => 0);
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(240,226,207,0.34)';
    ctx.lineWidth = 1.6;
    pathFrom(pts);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(240,226,207,0.55)';
    ctx.font = '11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('commissioned silhouette', AXISX, BASEY - th - 12);
  }

  function drawTool() {
    if (state !== 'THROW' && state !== 'COLLAPSE') return;
    const y = BASEY - toolT * H;
    const r = profAt(toolT);
    const activeSide = pressAmt > 0.05 ? lastDirSign() : 0;
    for (const side of [-1, 1]) {
      const isActive = side === activeSide;
      const gap = isActive ? 2 + (1 - pressAmt) * 6 : 14;
      const x = AXISX + side * (r + gap);
      ctx.fillStyle = isActive ? 'rgba(224,164,88,0.95)' : 'rgba(224,164,88,0.22)';
      ctx.beginPath();
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x + side * 12, y - 4);
      ctx.lineTo(x + side * 12, y + 4);
      ctx.lineTo(x, y + 9);
      ctx.closePath();
      ctx.fill();
    }
  }

  function lastDirSign() {
    if (keyIn || btnIn || (!!ptr && ptr.dir < 0)) return 1;
    if (keyOut || btnOut || (!!ptr && ptr.dir > 0)) return -1;
    return 1;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- HUD ---------- */

  function syncHud() {
    if (!def) return;
    elGw.style.width = Math.round(moist * 100) + '%';
    elGt.style.width = Math.round((1 - wobble) * 100) + '%';
    elGt.classList.toggle('low', wobble > 0.55);
    const tf = Tmax > 0 ? T / Tmax : 0;
    elGd.style.width = Math.round(tf * 100) + '%';
    elGd.classList.toggle('low', tf < 0.3);
    elAcc.textContent = 'true ' + Math.round(liveAcc() * 100) + '%';
    elLumps.textContent = '●'.repeat(Math.max(lumps, 0)) + '○'.repeat(LUMPS_START - Math.max(lumps, 0));
  }

  /* ---------- input ---------- */

  function anyOverlayOpen() {
    return (
      !elVeil.classList.contains('hidden') ||
      !elInter.classList.contains('hidden') ||
      !elFinale.classList.contains('hidden')
    );
  }

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)
    )
      e.preventDefault();
    if (paused && code !== 'KeyP') {
      if (code !== 'KeyM') togglePause();
      return;
    }
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        keyUp = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        keyDown = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        keyIn = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        keyOut = true;
        break;
      case 'Space':
        keyWater = true;
        break;
      case 'Enter':
        advance();
        break;
      case 'KeyP':
        togglePause();
        break;
      case 'KeyM':
        ensureAudio();
        toggleMute();
        break;
      case 'KeyR':
        if (state === 'THROW' || state === 'RESULT' || state === 'FINALE') {
          ensureAudio();
          beginDay();
        }
        break;
      default:
        if (state === 'INTRO') {
          ensureAudio();
          beginDay();
        }
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        keyUp = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        keyDown = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        keyIn = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        keyOut = false;
        break;
      case 'Space':
        keyWater = false;
        break;
    }
  });

  function canvasPoint(e) {
    const rect = c.getBoundingClientRect();
    const scale = Math.min(c.width / VW, c.height / VH);
    const ox = (c.width - VW * scale) / 2;
    const oy = (c.height - VH * scale) / 2;
    const vx = ((e.clientX - rect.left) * (c.width / rect.width) - ox) / scale;
    const vy = ((e.clientY - rect.top) * (c.height / rect.height) - oy) / scale;
    return { vx, vy };
  }

  function applyPointer(e) {
    const { vx, vy } = canvasPoint(e);
    if (vy > BASEY + 20 || vy < BASEY - MAXH - 40) return;
    toolT = clamp((BASEY - vy) / Math.max(H, 1), 0, 1);
    const dist = Math.abs(vx - AXISX);
    ptr.dir = dist <= profAt(toolT) ? 1 : -1;
  }

  c.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudio();
    if (state !== 'THROW' || paused) return;
    try {
      c.setPointerCapture(e.pointerId);
    } catch (err) {
      /* fine without capture */
    }
    ptr = { id: e.pointerId, dir: -1 };
    applyPointer(e);
  });

  c.addEventListener('pointermove', (e) => {
    if (!ptr || state !== 'THROW' || paused) return;
    applyPointer(e);
  });

  const releasePtr = () => {
    ptr = null;
  };
  c.addEventListener('pointerup', releasePtr);
  c.addEventListener('pointercancel', releasePtr);
  c.addEventListener('pointerleave', releasePtr);

  function holdButton(id, set) {
    const b = $(id);
    const on = (e) => {
      e.preventDefault();
      ensureAudio();
      set(true);
    };
    const off = () => set(false);
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  holdButton('bin', (v) => (btnIn = v));
  holdButton('bout', (v) => (btnOut = v));
  holdButton('bwater', (v) => (btnWater = v));

  $('bdone').addEventListener('click', (e) => {
    ensureAudio();
    setAside();
    e.currentTarget.blur();
  });
  elBnext.addEventListener('click', (e) => {
    advance();
    e.currentTarget.blur();
  });
  $('bnew').addEventListener('click', (e) => {
    beginDay();
    e.currentTarget.blur();
  });
  $('bpause').addEventListener('click', (e) => {
    togglePause();
    e.currentTarget.blur();
  });
  $('bsound').addEventListener('click', (e) => {
    ensureAudio();
    toggleMute();
    e.currentTarget.blur();
  });
  $('brestart').addEventListener('click', (e) => {
    ensureAudio();
    beginDay();
    e.currentTarget.blur();
  });

  elVeil.addEventListener('pointerdown', () => {
    ensureAudio();
    if (state === 'INTRO') beginDay();
    else hide(elVeil);
  });
  elPauseov.addEventListener('pointerdown', () => {
    if (paused) togglePause();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'THROW' && !paused) togglePause();
  });

  window.addEventListener('blur', () => {
    keyUp = keyDown = keyIn = keyOut = keyWater = false;
    btnIn = btnOut = btnWater = false;
    ptr = null;
  });

  /* ---------- debug hook (only with #debug hash) ---------- */

  if (location.hash.indexOf('debug') !== -1) {
    window.__ASHGLAZE_DEBUG__ = {
      get state() {
        return state;
      },
      fill(u) {
        for (let i = 0; i < S; i++) prof[i] = lerp(prof[i], target[i], u);
      },
      wob(v) {
        wobble = v;
      },
      dry() {
        moist = 0.1;
      },
      next() {
        advance();
      },
      begin() {
        ensureAudio();
        beginDay();
      },
      info() {
        return { commIdx, lumps, H, acc: liveAcc(), t: T };
      },
    };
  }

  /* ---------- main loop ---------- */

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    if (!paused && !(state === 'THROW' && document.hidden)) {
      update(dt);
      syncHud();
    }
    render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
