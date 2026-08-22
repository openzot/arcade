/*
 * Orbit Post — slingshot mail across a tiny solar system.
 * Drag & release (or arrows + space) to throw the pod; planetary gravity
 * bends every throw. Land in the drop ring. Five runs, limited launch cells.
 */
(() => {
  'use strict';

  // ---------- world constants ----------
  const W = 1000;
  const H = 640;
  const TAU = Math.PI * 2;
  const PROBE_R = 6;
  const MAX_POWER = 640; // px/s at full pull
  const MIN_LAUNCH = 90; // px/s floor so a tap still leaves the pad
  const DRAG_SCALE = 1.7; // drag distance -> speed
  const SUB_DT = 1 / 240; // physics substep
  const FLIGHT_LIMIT = 22; // seconds before "out of inertia"
  const VOID = 90; // margin beyond the frame where the pod is lost

  const LEVELS = [
    {
      name: 'First Round',
      pad: { x: 110, y: 520 },
      goal: { x: 880, y: 150, r: 40 },
      planets: [{ x: 520, y: 330, r: 58, gm: 13500000, c1: '#d98a5f', c2: '#6b2f1d' }],
      moons: [],
      par: 1,
      cells: 6,
    },
    {
      name: 'The Long Way Down',
      pad: { x: 115, y: 115 },
      goal: { x: 875, y: 545, r: 38 },
      planets: [
        { x: 430, y: 215, r: 48, gm: 10000000, c1: '#7fd4c1', c2: '#1d5c4f' },
        { x: 645, y: 425, r: 52, gm: 11500000, c1: '#b48ad8', c2: '#3d2260' },
      ],
      moons: [],
      par: 1,
      cells: 6,
    },
    {
      name: 'Slingshot Alley',
      pad: { x: 100, y: 320 },
      goal: { x: 905, y: 320, r: 36 },
      planets: [
        {
          x: 505,
          y: 320,
          r: 64,
          gm: 15000000,
          c1: '#e0b15c',
          c2: '#6e4a14',
          ring: { rx: 1.75, w: 4, tilt: -0.45, col: 'rgba(255,222,150,0.5)' },
        },
        { x: 505, y: 118, r: 30, gm: 3800000, c1: '#8fa8c8', c2: '#2c3d55' },
        { x: 505, y: 522, r: 30, gm: 3800000, c1: '#8fa8c8', c2: '#2c3d55' },
      ],
      moons: [],
      par: 2,
      cells: 7,
    },
    {
      name: 'Moonrise',
      pad: { x: 108, y: 545 },
      goal: { x: 892, y: 118, r: 34 },
      planets: [{ x: 460, y: 340, r: 54, gm: 13000000, c1: '#c96f4a', c2: '#59221a' }],
      moons: [{ around: 0, orbit: 132, size: 13, speed: 1.5, phase: 2.1 }],
      par: 2,
      cells: 7,
    },
    {
      name: 'Binary Drop',
      pad: { x: 88, y: 88 },
      goal: { x: 918, y: 558, r: 32 },
      planets: [
        { x: 350, y: 245, r: 46, gm: 10500000, c1: '#7fb0e8', c2: '#1e3a63' },
        { x: 655, y: 425, r: 46, gm: 10500000, c1: '#e88f7f', c2: '#5c2318' },
        { x: 860, y: 175, r: 30, gm: 5200000, c1: '#9fe8b0', c2: '#1d5c33' },
      ],
      moons: [{ around: 1, orbit: 112, size: 12, speed: 1.8, phase: 0.4 }],
      par: 3,
      cells: 8,
    },
  ];

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const hud = $('hud');
  const hudRun = $('hud-run');
  const hudCells = $('hud-cells');
  const hudPar = $('hud-par');
  const hudScore = $('hud-score');
  const scrTitle = $('screen-title');
  const scrBanner = $('screen-banner');
  const scrEnd = $('screen-end');
  const SCREENS = [scrTitle, scrBanner, scrEnd];

  // ---------- persistence ----------
  function lsGet(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }
  function lsSet(key, val) {
    try {
      window.localStorage.setItem(key, val);
    } catch (err) {
      /* private mode etc. — play on without saving */
    }
  }

  let best = Number(lsGet('orbit-post-best', '0')) || 0;
  let muted = lsGet('orbit-post-muted', '0') === '1';

  // ---------- audio (all synthesised, lazily created on first gesture) ----------
  let actx = null;
  let master = null;

  function initAudio() {
    if (actx) {
      if (actx.state === 'suspended') {
        actx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(actx.destination);
    } catch (err) {
      actx = null;
    }
  }

  function tone(f0, f1, dur, type, vol, delay) {
    if (!actx || muted) return;
    try {
      const t0 = actx.currentTime + (delay || 0);
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
      }
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (err) {
      /* never let sound break the game */
    }
  }

  function thump(dur, vol) {
    if (!actx || muted) return;
    try {
      const len = Math.max(1, Math.floor(dur * actx.sampleRate));
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      const src = actx.createBufferSource();
      src.buffer = buf;
      const filt = actx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 700;
      const g = actx.createGain();
      g.gain.value = vol;
      src.connect(filt);
      filt.connect(g);
      g.connect(master);
      src.start(actx.currentTime);
    } catch (err) {
      /* ignore */
    }
  }

  const sLaunch = () => tone(300, 80, 0.28, 'square', 0.16);
  const sCrash = () => {
    thump(0.4, 0.5);
    tone(160, 40, 0.35, 'sawtooth', 0.18);
  };
  const sVoid = () => tone(220, 60, 0.5, 'sine', 0.14);
  const sUi = () => tone(500, 500, 0.06, 'sine', 0.12);
  const sFail = () => tone(330, 82, 0.6, 'sawtooth', 0.18);
  function sDeliver() {
    tone(523, 523, 0.12, 'triangle', 0.2, 0);
    tone(659, 659, 0.12, 'triangle', 0.2, 0.09);
    tone(784, 784, 0.12, 'triangle', 0.2, 0.18);
    tone(1046, 1046, 0.22, 'triangle', 0.2, 0.27);
  }

  // ---------- state ----------
  let mode = 'title'; // title | play | banner | over | win
  let totalScore = 0;
  let totalStars = 0;
  let play = null; // per-run runtime state
  let running = true;

  const stars = [];
  for (let i = 0; i < 150; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      z: 0.25 + Math.random() * 0.75,
      tw: 0.5 + Math.random() * 2.2,
    });
  }

  // ---------- tiny helpers ----------
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // ---------- physics ----------
  function gravAt(lv, x, y) {
    let ax = 0;
    let ay = 0;
    for (const p of lv.planets) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 144) continue;
      const a = Math.min(p.gm / d2, 2800); // clamp near-surface spikes
      const inv = 1 / Math.sqrt(d2);
      ax += a * dx * inv;
      ay += a * dy * inv;
    }
    return { x: ax, y: ay };
  }

  function planetHit(lv, x, y) {
    for (const p of lv.planets) {
      if (dist(x, y, p.x, p.y) < p.r + PROBE_R) return p;
    }
    return null;
  }

  function moonPos(lv, m, t) {
    const ang = m.phase + t * m.speed;
    const c = lv.planets[m.around];
    return { x: c.x + Math.cos(ang) * m.orbit, y: c.y + Math.sin(ang) * m.orbit };
  }

  function moonHit(lv, m, x, y, t) {
    const mp = moonPos(lv, m, t);
    return dist(x, y, mp.x, mp.y) < m.size + PROBE_R;
  }

  // ---------- particles ----------
  function burst(x, y, n, cols, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = spd * (0.25 + Math.random() * 0.75);
      play.parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.7,
        age: 0,
        c: cols[Math.floor(Math.random() * cols.length)],
        r: 1.5 + Math.random() * 2.5,
      });
    }
  }

  function updateParts(dt) {
    const ps = play.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
    }
  }

  // ---------- flow ----------
  function show(el) {
    for (const s of SCREENS) s.classList.toggle('hidden', s !== el);
    if (el) {
      const btn = el.querySelector('button:not(.hidden)');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function toast(text) {
    play.msg = { text, t: 2.2 };
  }

  function loadLevel(i) {
    const lv = LEVELS[i];
    play = {
      li: i,
      lv,
      t: 0,
      probe: { x: lv.pad.x, y: lv.pad.y, vx: 0, vy: 0 },
      flying: false,
      flightT: 0,
      flameT: 0,
      used: 0,
      aim: {
        angle: Math.atan2(lv.goal.y - lv.pad.y, lv.goal.x - lv.pad.x),
        pow: 0.62,
        active: true,
      },
      trail: [],
      parts: [],
      msg: null,
      shake: 0,
      flash: 0,
      trTick: 0,
    };
    mode = 'play';
    show(null);
    hud.hidden = false;
    updateHud();
    toast('Run ' + (i + 1) + ' — deliver the pod to the drop ring');
  }

  function startShift() {
    totalScore = 0;
    totalStars = 0;
    loadLevel(0);
  }

  function toTitle() {
    mode = 'title';
    hud.hidden = true;
    show(scrTitle);
  }

  function kickOff() {
    const sp = MIN_LAUNCH + play.aim.pow * (MAX_POWER - MIN_LAUNCH);
    launch(Math.cos(play.aim.angle) * sp, Math.sin(play.aim.angle) * sp);
  }

  function launch(vx, vy) {
    play.probe.vx = vx;
    play.probe.vy = vy;
    play.flying = true;
    play.flightT = 0;
    play.flameT = 0.28;
    play.used += 1;
    play.trail.length = 0;
    play.aim.active = false;
    sLaunch();
    updateHud();
  }

  function resetProbe() {
    const lv = play.lv;
    play.probe.x = lv.pad.x;
    play.probe.y = lv.pad.y;
    play.probe.vx = 0;
    play.probe.vy = 0;
    play.trail.length = 0;
  }

  function afterOutcomeCheck() {
    if (play.lv.cells - play.used <= 0 && mode === 'play') failLevel();
  }

  function crash(kind) {
    play.flying = false;
    play.shake = 1;
    burst(play.probe.x, play.probe.y, 30, ['#ff9d5c', '#ff5733', '#ffd166'], 260);
    sCrash();
    resetProbe();
    toast(kind === 'moon' ? 'Clipped the moon. Pod recalled.' : 'Crushed on impact. Pod recalled.');
    afterOutcomeCheck();
  }

  function lost(drift) {
    play.flying = false;
    sVoid();
    resetProbe();
    toast(drift ? 'Ran out of inertia. Pod recalled.' : 'Lost to the void. Pod recalled.');
    afterOutcomeCheck();
  }

  function deliver() {
    play.flying = false;
    const lv = play.lv;
    const spare = lv.cells - play.used;
    const starsEarned = play.used <= lv.par ? 3 : play.used <= lv.par + 2 ? 2 : 1;
    const pts = 500 + spare * 120 + starsEarned * 100;
    totalScore += pts;
    totalStars += starsEarned;
    burst(play.probe.x, play.probe.y, 42, ['#ffd166', '#5ce1ff', '#ffffff'], 320);
    play.flash = 1;
    sDeliver();
    mode = 'banner';
    $('banner-text').textContent = 'Delivered!';
    $('banner-sub').textContent =
      '+' +
      pts +
      ' pts · ' +
      '★'.repeat(starsEarned) +
      '☆'.repeat(3 - starsEarned) +
      ' · ' +
      play.used +
      (play.used === 1 ? ' launch' : ' launches') +
      ' (par ' +
      lv.par +
      ')';
    show(scrBanner);
    updateHud();
  }

  function nextFromBanner() {
    if (!play || mode !== 'banner') return;
    if (play.li + 1 >= LEVELS.length) {
      winGame();
      return;
    }
    loadLevel(play.li + 1);
  }

  function failLevel() {
    mode = 'over';
    sFail();
    $('end-title').textContent = 'Out of launch cells';
    $('end-detail').textContent =
      'The depot recalls what is left of the post. Run ' +
      (play.li + 1) +
      ' — ' +
      play.lv.name +
      ' — stays undelivered.';
    $('btn-retry').classList.remove('hidden');
    $('end-stars').textContent = '';
    show(scrEnd);
  }

  function retryLevel() {
    if (!play || mode === 'title') return;
    loadLevel(play.li);
  }

  function winGame() {
    mode = 'win';
    const newBest = totalScore > best;
    if (newBest) {
      best = totalScore;
      lsSet('orbit-post-best', String(best));
    }
    $('end-title').textContent = 'Shift complete!';
    $('end-detail').innerHTML =
      'Final score <b>' + totalScore + '</b> · ' + totalStars + '/15 stars · best ' + best;
    $('btn-retry').classList.add('hidden');
    $('end-stars').textContent = '★'.repeat(totalStars) + '☆'.repeat(15 - totalStars);
    show(scrEnd);
  }

  function updateHud() {
    const lv = play.lv;
    hudRun.textContent = 'Run ' + (play.li + 1) + '/' + LEVELS.length + ' · ' + lv.name;
    hudCells.innerHTML = 'Cells <b>' + (lv.cells - play.used) + '</b>/' + lv.cells;
    hudPar.textContent = 'Par ' + lv.par;
    hudScore.innerHTML = 'Score <b>' + totalScore + '</b>';
  }

  // ---------- input ----------
  function toWorld(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }

  let drag = null;

  function aimFromDrag(origin, cur) {
    const dx = origin.x - cur.x;
    const dy = origin.y - cur.y;
    const m = Math.hypot(dx, dy);
    if (m < 4) {
      play.aim.active = false;
      return;
    }
    play.aim.active = true;
    play.aim.angle = Math.atan2(dy, dx);
    play.aim.pow = Math.min(1, (m * DRAG_SCALE) / MAX_POWER);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    initAudio();
    if (mode !== 'play' || !play || play.flying) return;
    ev.preventDefault();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (err) {
      /* older browsers */
    }
    drag = toWorld(ev);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!drag || mode !== 'play' || !play || play.flying) return;
    aimFromDrag(drag, toWorld(ev));
  });

  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    if (mode !== 'play' || !play || play.flying) return;
    if (play.aim.active && play.aim.pow > 0.08) {
      kickOff();
    } else {
      play.aim.active = false;
    }
  });

  canvas.addEventListener('pointercancel', () => {
    drag = null;
    if (play) play.aim.active = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const keys = {};

  window.addEventListener('keydown', (ev) => {
    const k = ev.key;
    const onBtn = Boolean(ev.target) && ev.target.tagName === 'BUTTON';
    if ((k === ' ' || k === 'Enter') && onBtn) return; // let focused buttons work
    if (
      k === 'ArrowLeft' ||
      k === 'ArrowRight' ||
      k === 'ArrowUp' ||
      k === 'ArrowDown' ||
      k === ' '
    ) {
      ev.preventDefault(); // stop page scroll on space/arrows
    }
    keys[k] = true;
    initAudio();

    if ((mode === 'title' || mode === 'win' || mode === 'over') && (k === 'Enter' || k === ' ')) {
      if (mode === 'over') {
        retryLevel();
      } else {
        startShift();
      }
      return;
    }
    if (mode === 'banner' && (k === 'Enter' || k === ' ')) {
      nextFromBanner();
      return;
    }
    if ((k === 'r' || k === 'R') && mode === 'play') {
      retryLevel();
      return;
    }
    if (mode !== 'play' || !play || play.flying) return;
    if (k === 'Escape') {
      play.aim.active = false;
      return;
    }
    if (k === ' ' || k === 'Enter') {
      play.aim.active = true;
      kickOff();
    }
  });

  window.addEventListener('keyup', (ev) => {
    keys[ev.key] = false;
  });

  function kbAim(dt) {
    if (mode !== 'play' || !play || play.flying) return;
    const rot = 1.9 * dt;
    const dpow = 0.55 * dt;
    let touched = false;
    if (keys['ArrowLeft']) {
      play.aim.angle -= rot;
      touched = true;
    }
    if (keys['ArrowRight']) {
      play.aim.angle += rot;
      touched = true;
    }
    if (keys['ArrowUp']) {
      play.aim.pow = Math.min(1, play.aim.pow + dpow);
      touched = true;
    }
    if (keys['ArrowDown']) {
      play.aim.pow = Math.max(0.06, play.aim.pow - dpow);
      touched = true;
    }
    if (touched) play.aim.active = true;
  }

  // ---------- buttons ----------
  $('btn-start').addEventListener('click', () => {
    initAudio();
    sUi();
    startShift();
  });
  $('btn-next').addEventListener('click', () => {
    sUi();
    nextFromBanner();
  });
  $('btn-retry').addEventListener('click', () => {
    sUi();
    retryLevel();
  });
  $('btn-again').addEventListener('click', () => {
    sUi();
    startShift();
  });
  $('btn-home').addEventListener('click', () => {
    sUi();
    toTitle();
  });
  $('btn-reset').addEventListener('click', () => {
    sUi();
    startShift();
  });

  const btnMute = $('btn-mute');
  function syncMute() {
    btnMute.classList.toggle('off', muted);
    btnMute.setAttribute('aria-pressed', String(!muted));
    if (master) master.gain.value = muted ? 0 : 0.5;
  }
  btnMute.addEventListener('click', () => {
    muted = !muted;
    lsSet('orbit-post-muted', muted ? '1' : '0');
    syncMute();
    initAudio();
    sUi();
  });
  syncMute();

  // ---------- forecast ----------
  function computeForecast() {
    const pts = [];
    const aim = play.aim;
    const sp = MIN_LAUNCH + aim.pow * (MAX_POWER - MIN_LAUNCH);
    const st = {
      x: play.lv.pad.x,
      y: play.lv.pad.y,
      vx: Math.cos(aim.angle) * sp,
      vy: Math.sin(aim.angle) * sp,
    };
    const dt = 1 / 60;
    for (let i = 0; i < 110; i++) {
      const a = gravAt(play.lv, st.x, st.y);
      st.vx += a.x * dt;
      st.vy += a.y * dt;
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      if (i % 3 === 0) pts.push({ x: st.x, y: st.y });
      if (planetHit(play.lv, st.x, st.y)) {
        pts.push({ x: st.x, y: st.y, end: true });
        return pts;
      }
      for (const m of play.lv.moons) {
        if (moonHit(play.lv, m, st.x, st.y, play.t)) {
          pts.push({ x: st.x, y: st.y, end: true });
          return pts;
        }
      }
      if (st.x < -VOID || st.x > W + VOID || st.y < -VOID || st.y > H + VOID) return pts;
      if (dist(st.x, st.y, play.lv.goal.x, play.lv.goal.y) < play.lv.goal.r - 4) {
        pts.push({ x: st.x, y: st.y, goal: true });
        return pts;
      }
    }
    return pts;
  }

  // ---------- simulation tick ----------
  function tick(dt) {
    play.t += dt;
    if (play.msg) {
      play.msg.t -= dt;
      if (play.msg.t <= 0) play.msg = null;
    }
    if (play.shake > 0) play.shake = Math.max(0, play.shake - dt * 3);
    if (play.flash > 0) play.flash = Math.max(0, play.flash - dt * 2);
    if (play.flameT > 0) play.flameT -= dt;
    kbAim(dt);
    updateParts(dt);
    if (!play.flying) return;

    play.flightT += dt;
    const pr = play.probe;
    const a = gravAt(play.lv, pr.x, pr.y);
    pr.vx += a.x * dt;
    pr.vy += a.y * dt;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;

    play.trTick += 1;
    if (play.trTick % 10 === 0) {
      play.trail.push({ x: pr.x, y: pr.y });
      if (play.trail.length > 90) play.trail.shift();
    }

    const goal = play.lv.goal;
    if (dist(pr.x, pr.y, goal.x, goal.y) < goal.r - 4) {
      deliver();
      return;
    }
    if (planetHit(play.lv, pr.x, pr.y)) {
      crash('planet');
      return;
    }
    for (const m of play.lv.moons) {
      if (moonHit(play.lv, m, pr.x, pr.y, play.t)) {
        crash('moon');
        return;
      }
    }
    if (pr.x < -VOID || pr.x > W + VOID || pr.y < -VOID || pr.y > H + VOID) {
      lost(false);
      return;
    }
    if (play.flightT > FLIGHT_LIMIT) lost(true);
  }

  // ---------- rendering ----------
  function drawStars(now) {
    ctx.fillStyle = '#cfe0ff';
    for (const s of stars) {
      ctx.globalAlpha = s.z * (0.55 + 0.45 * Math.sin(now * s.tw + s.z * 9));
      const sz = s.z * 1.9;
      ctx.fillRect(s.x, s.y, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanets(lv) {
    for (const p of lv.planets) {
      if (p.ring) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.ring.tilt);
        ctx.strokeStyle = p.ring.col;
        ctx.lineWidth = p.ring.w;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * p.ring.rx, p.r * p.ring.rx * 0.32, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      const g = ctx.createRadialGradient(
        p.x - p.r * 0.38,
        p.y - p.r * 0.42,
        p.r * 0.12,
        p.x,
        p.y,
        p.r
      );
      g.addColorStop(0, p.c1);
      g.addColorStop(1, p.c2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = 'rgba(3,6,16,0.42)';
      ctx.beginPath();
      ctx.arc(p.x + p.r * 0.5, p.y + p.r * 0.55, p.r * 1.05, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(160,190,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 2, 0, TAU);
      ctx.stroke();
    }
  }

  function drawMoons(lv, t, now) {
    for (const m of lv.moons) {
      const mp = moonPos(lv, m, t);
      const c = lv.planets[m.around];
      ctx.strokeStyle = 'rgba(255,120,120,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, m.orbit, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#9aa3b8';
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, m.size, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, m.size, 0, TAU);
      ctx.clip();
      ctx.fillStyle = 'rgba(15,19,34,0.55)';
      ctx.beginPath();
      ctx.arc(mp.x + m.size * 0.4, mp.y + m.size * 0.4, m.size, 0, TAU);
      ctx.fill();
      ctx.restore();
      const pulse = 0.5 + 0.5 * Math.sin(now * 6);
      ctx.strokeStyle = 'rgba(255,80,80,' + (0.25 + 0.45 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, m.size + 3 + pulse * 2, 0, TAU);
      ctx.stroke();
    }
  }

  function drawGoal(g, now) {
    const pu = 0.5 + 0.5 * Math.sin(now * 2.4);
    ctx.strokeStyle = 'rgba(92,225,255,' + (0.55 + 0.35 * pu).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r - 2 + pu * 3, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(92,225,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + 10 + pu * 5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(92,225,255,0.9)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DROP', g.x, g.y - g.r - 14);
  }

  function drawPad(now) {
    const p = play.lv.pad;
    ctx.fillStyle = 'rgba(140,160,210,0.22)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 12, 26, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,200,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 20, p.y + 11);
    ctx.lineTo(p.x + 20, p.y + 11);
    ctx.stroke();
    const bl = 0.5 + 0.5 * Math.sin(now * 4);
    ctx.fillStyle = 'rgba(255,209,102,' + (0.35 + 0.6 * bl).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x - 16, p.y + 8, 2.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,196,235,0.75)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('POST', p.x, p.y + 30);
  }

  function drawForecastAndAim() {
    const pad = play.lv.pad;
    const aim = play.aim;
    if (play.flying || !aim.active) return;
    const pts = computeForecast();
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const base = 0.55 * (1 - i / Math.max(pts.length, 1));
      if (pt.end) {
        ctx.fillStyle = 'rgba(255,110,110,' + (base + 0.3).toFixed(3) + ')';
      } else if (pt.goal) {
        ctx.fillStyle = 'rgba(92,225,255,' + (base + 0.35).toFixed(3) + ')';
      } else {
        ctx.fillStyle = 'rgba(220,232,255,' + base.toFixed(3) + ')';
      }
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.end ? 4 : 2, 0, TAU);
      ctx.fill();
    }
    const lx = pad.x + Math.cos(aim.angle) * (18 + aim.pow * 74);
    const ly = pad.y + Math.sin(aim.angle) * (18 + aim.pow * 74);
    ctx.strokeStyle = 'rgba(255,209,102,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad.x, pad.y);
    ctx.lineTo(lx, ly);
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx - Math.cos(aim.angle - 0.45) * 9, ly - Math.sin(aim.angle - 0.45) * 9);
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx - Math.cos(aim.angle + 0.45) * 9, ly - Math.sin(aim.angle + 0.45) * 9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(92,225,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, 13, -Math.PI / 2, -Math.PI / 2 + TAU * aim.pow);
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,232,255,0.85)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(aim.pow * 100) + '%', pad.x + 18, pad.y - 14);
  }

  function drawTrail() {
    const tr = play.trail;
    for (let i = 1; i < tr.length; i++) {
      const a = i / tr.length;
      ctx.strokeStyle = 'rgba(126,200,255,' + (a * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 1 + a * 2;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
  }

  function drawProbe() {
    const p = play.probe;
    const ang = play.flying
      ? Math.atan2(p.vy, p.vx)
      : play.aim.active
        ? play.aim.angle
        : -0.5;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    if (play.flying && play.flameT > 0) {
      const fl = 10 + Math.random() * 10;
      const gr = ctx.createLinearGradient(-9, 0, -9 - fl, 0);
      gr.addColorStop(0, 'rgba(255,209,102,0.95)');
      gr.addColorStop(1, 'rgba(255,87,51,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(-8, -3.5);
      ctx.lineTo(-8 - fl, 0);
      ctx.lineTo(-8, 3.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#e9edf8';
    ctx.beginPath();
    ctx.arc(5, 0, 5.5, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-7, 5.5);
    ctx.arc(-7, 0, 5.5, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#39c2ff';
    ctx.beginPath();
    ctx.arc(3.5, 0, 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawParts() {
    for (const p of play.parts) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function roundRectFill(x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
  }

  function drawMsg() {
    if (!play.msg) return;
    const m = play.msg;
    ctx.globalAlpha = Math.min(1, m.t / 0.5);
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(m.text).width;
    ctx.fillStyle = 'rgba(8,12,24,0.78)';
    roundRectFill(W / 2 - tw / 2 - 14, 66, tw + 28, 30, 15);
    ctx.fillStyle = '#e6ecff';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.text, W / 2, 81);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  function render(now) {
    const sc = canvas.width / W;
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(-2, -2, W + 4, H + 4);
    drawStars(now);

    if (!play) {
      // title-screen diorama behind the overlay
      const lv = LEVELS[1];
      drawPlanets(lv);
      drawMoons(lv, now * 0.25, now);
      drawGoal(lv.goal, now);
      return;
    }

    ctx.save();
    if (play.shake > 0) {
      const s = play.shake * 7;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    drawPlanets(play.lv);
    drawMoons(play.lv, play.t, now);
    drawGoal(play.lv.goal, now);
    drawPad(now);
    drawForecastAndAim();
    drawTrail();
    drawProbe();
    drawParts();
    drawMsg();
    ctx.restore();

    if (play.flash > 0) {
      ctx.globalAlpha = play.flash * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-2, -2, W + 4, H + 4);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- main loop ----------
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!running || mode !== 'play') {
      render(now / 1000);
      return;
    }
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    while (acc >= SUB_DT) {
      tick(SUB_DT);
      acc -= SUB_DT;
      if (mode !== 'play') {
        acc = 0;
        break;
      }
    }
    render(now / 1000);
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      last = performance.now();
      acc = 0;
    }
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || W;
    const h = canvas.clientHeight || H;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  }

  resize();
  window.addEventListener('resize', resize);
  if (typeof window.ResizeObserver === 'function') {
    new ResizeObserver(resize).observe(canvas);
  }

  // ---------- test hook (read-only helpers used by the shift's own checks) ----------
  window.__op = {
    mode: () => mode,
    level: () => (play ? play.li + 1 : 0),
    score: () => totalScore,
    cells: () => (play ? play.lv.cells - play.used : 0),
    stars: () => totalStars,
    flying: () => Boolean(play && play.flying),
    deliver: () => {
      if (mode === 'play' && play) deliver();
    },
    crash: () => {
      if (mode === 'play' && play && play.flying) crash('moon');
    },
  };

  show(scrTitle);
  requestAnimationFrame(frame);
})();
