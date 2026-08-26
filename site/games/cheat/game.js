/* Cheat! - penny-ante bluffing against three boarding-house regulars.
   All behaviour lives in this file, wrapped in an IIFE. No globals escape. */
(() => {
  "use strict";

  /* ---------------- constants ---------------- */

  const RANKS = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const PLURAL = [
    "Aces",
    "Twos",
    "Threes",
    "Fours",
    "Fives",
    "Sixes",
    "Sevens",
    "Eights",
    "Nines",
    "Tens",
    "Jacks",
    "Queens",
    "Kings",
  ];
  const SUITS = [
    { k: "s", g: "\u2660" },
    { k: "h", g: "\u2665" },
    { k: "d", g: "\u2666" },
    { k: "c", g: "\u2663" },
  ];
  const RED = { h: true, d: true };
  const PLACE = ["first", "second", "third", "fourth"];

  const AI_META = [
    { name: "Vera", honesty: 0.42, aggr: 0.62 },
    { name: "Edith", honesty: 0.74, aggr: 0.36 },
    { name: "Nell", honesty: 0.55, aggr: 0.78 },
  ];

  const SAY = {
    honest: [
      "Straight as my hall door.",
      "Count them and weep.",
      "These old faces again.",
      "Truth wants no luck.",
      "There they go. Mind your eyes.",
    ],
    lying: [
      "Would I lie to you, pet?",
      "Cross my heart and hope.",
      "Fresh as daisies.",
      "Not a fib among them.",
      "Swear on my mother's tea.",
    ],
    call: [
      "Cheat!",
      "I doubt it, dear.",
      "Those aren't yours. Show.",
      "Show them. Now.",
      "My grandmother heard cleaner lies.",
    ],
    pass: [
      "Go on then.",
      "Not worth my tea.",
      "Later, perhaps.",
      "Let it lie.",
    ],
    grumble: [
      "Bah - my own fault.",
      "Into the soup it goes.",
      "Should've known better.",
      "The luck of the devil.",
    ],
    caughtYou: [
      "Got you, pet.",
      "Those smelled funny.",
      "The eyes, dear. The eyes.",
    ],
    boldWrong: [
      "Bold. Wrong, but bold.",
      "That'll cost you.",
      "Teach you to trust me.",
    ],
  };

  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ---------------- state ---------------- */

  const S = {
    phase: "title", // title | deal | player-turn | ai-turn | call | resolve | end
    gen: 0,
    paused: false,
    hands: [[], [], [], []],
    pennies: [12, 9, 9, 9],
    pot: 12,
    pile: [],
    rankIdx: 6,
    out: [],
    sel: new Set(),
    kfocus: 0,
    mem: [0, 0, 0, 0], // times caught lying, per seat (0 = you)
  };

  const ui = {}; // transient ui handles (resolvers, timers)

  /* ---------------- pausable clock ---------------- */

  const clock = { t: 0, items: new Set() };

  function after(ms, fn) {
    const item = { due: clock.t + ms, fn };
    clock.items.add(item);
    return item;
  }

  function nap(ms) {
    return new Promise((res) => after(ms, res));
  }

  /* ---------------- audio (all synthesised) ---------------- */

  let AC = null;
  let master = null;
  let muted = false;

  function audio() {
    if (muted) return null;
    if (!AC) {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = 0.5;
        master.connect(AC.destination);
        startRain();
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
    return AC;
  }

  function startRain() {
    if (!AC) return;
    const len = AC.sampleRate * 2;
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const data = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.985;
      data[i] = brown * 6;
    }
    const src = AC.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = AC.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const g = AC.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(master);
    src.start();
  }

  function blip(freq, dur, type, vol, glideTo, when) {
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime + (when || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function hiss(dur, hpFreq, vol) {
    const ac = audio();
    if (!ac) return;
    const len = Math.max(1, (ac.sampleRate * dur) | 0);
    const buf = AC.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hpFreq || 1200;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol || 0.2, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(f).connect(g).connect(master);
    src.start();
  }

  const snd = {
    flick() {
      hiss(0.07, 1600, 0.22);
    },
    slide() {
      hiss(0.16, 500, 0.12);
    },
    coin() {
      blip(1568, 0.07, "triangle", 0.16);
      blip(2093, 0.1, "triangle", 0.14, null, 0.07);
    },
    callSting() {
      blip(220, 0.3, "square", 0.16, 96);
    },
    good() {
      blip(659, 0.1, "triangle", 0.2);
      blip(880, 0.16, "triangle", 0.2, null, 0.09);
    },
    bad() {
      blip(196, 0.28, "sawtooth", 0.14, 82);
    },
    win() {
      [523, 659, 784, 1046].forEach((f, i) =>
        blip(f, 0.16, "triangle", 0.2, null, i * 0.1),
      );
    },
    lose() {
      blip(330, 0.4, "sine", 0.18, 165);
    },
  };

  function setMuted(v) {
    muted = v;
    if (master) master.gain.value = muted ? 0 : 0.5;
    document
      .getElementById("btn-sound")
      .setAttribute("aria-pressed", String(!muted));
    document.getElementById("btn-sound").textContent = muted
      ? "Muted"
      : "Sound";
  }

  /* ---------------- deck helpers ---------------- */

  function freshDeck() {
    const deck = [];
    for (let r = 0; r < 13; r++) {
      for (const s of SUITS)
        deck.push({ r, s: s.k, g: s.g, id: RANKS[r] + s.k });
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function sortHand(i) {
    S.hands[i].sort(
      (a, b) =>
        a.r - b.r ||
        SUITS.findIndex((x) => x.k === a.s) -
          SUITS.findIndex((x) => x.k === b.s),
    );
  }

  const isLie = (cards) => cards.some((c) => c.r !== S.rankIdx);

  /* ---------------- rendering ---------------- */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function cardNode(card, extraCls) {
    const c = el(
      "div",
      "card" + (RED[card.s] ? " red" : "") + (extraCls ? " " + extraCls : ""),
    );
    const suitG = SUITS.find((x) => x.k === card.s).g;
    const tl = el("span", "corner");
    tl.append(document.createTextNode(RANKS[card.r]));
    tl.append(el("small", null, suitG));
    const br = el("span", "corner br");
    br.append(document.createTextNode(RANKS[card.r]));
    br.append(el("small", null, suitG));
    c.append(tl, el("span", "pip", suitG), br);
    return c;
  }

  function backNode(small) {
    return el("div", "card back" + (small ? " small" : ""));
  }

  function renderHand() {
    const hand = document.getElementById("hand");
    hand.textContent = "";
    S.hands[0].forEach((card, idx) => {
      const li = el("li");
      li.dataset.id = card.id;
      const n = cardNode(card);
      li.appendChild(n);
      if (!RED[card.s]) n.classList.add("red"); // (colour already set on .card)
      if (S.sel.has(card.id)) li.classList.add("sel");
      if (idx === S.kfocus) li.classList.add("kfocus");
      if (S.phase !== "player-turn") li.classList.add("dimmed");
      hand.appendChild(li);
    });
    refreshPlayButton();
  }

  function renderPile(revealFrom) {
    const pile = document.getElementById("pile");
    pile.textContent = "";
    const start = Math.max(0, S.pile.length - 9);
    for (let i = start; i < S.pile.length; i++) {
      const e = S.pile[i];
      const li = el("li");
      if (revealFrom != null && i >= revealFrom) {
        li.appendChild(cardNode(e.card));
      } else {
        li.appendChild(backNode());
      }
      pile.appendChild(li);
    }
  }

  function renderSeats(activeSeat) {
    for (let i = 1; i <= 3; i++) {
      const seat = document.getElementById("seat-" + i);
      seat.querySelector(".pcount").textContent = String(S.hands[i].length);
      seat.querySelector(".ppennies").textContent = S.pennies[i] + "d";
      seat.classList.toggle("active", activeSeat === i);
    }
    document.getElementById("pennies-you").textContent = S.pennies[0] + "d";
    document.getElementById("pot-amt").textContent = S.pot + "d";
  }

  function renderClaim() {
    document.getElementById("claim-rank").textContent = PLURAL[S.rankIdx];
  }

  function setStatus(t) {
    document.getElementById("status-line").textContent = t;
  }

  function flash(text, tone) {
    const v = document.getElementById("verdict");
    v.textContent = text;
    v.className = tone ? "show " + tone : "show";
    if (ui.flashItem) clock.items.delete(ui.flashItem);
    ui.flashItem = after(1900, () => {
      v.className = "";
      ui.flashItem = null;
    });
  }

  function say(seat, text, ms) {
    const holder = document.getElementById("seat-" + seat);
    const b = holder.querySelector(".bubble");
    b.textContent = text;
    b.hidden = false;
    if (ui.bubbleTimers && ui.bubbleTimers[seat])
      clock.items.delete(ui.bubbleTimers[seat]);
    ui.bubbleTimers = ui.bubbleTimers || {};
    ui.bubbleTimers[seat] = after(ms || 2100, () => {
      b.hidden = true;
      ui.bubbleTimers[seat] = null;
    });
  }

  function tellMark(seat, on, ms) {
    const holder = document.getElementById("seat-" + seat);
    holder.classList.toggle("telling", !!on);
    if (on && ms) after(ms, () => holder.classList.remove("telling"));
  }

  function setActive(seat) {
    renderSeats(seat === 0 ? -1 : seat);
    const you = document.getElementById("you");
    you.style.opacity = seat === 0 ? "1" : "0.86";
  }

  function refreshPlayButton() {
    const btn = document.getElementById("btn-play");
    const n = S.sel.size;
    if (S.phase !== "player-turn") {
      btn.disabled = true;
      btn.textContent = "Lay 1\u20134";
      return;
    }
    btn.disabled = n < 1 || n > 4;
    btn.textContent =
      n >= 1 && n <= 4
        ? "Lay " + n + " as " + PLURAL[S.rankIdx]
        : "Lay 1\u20134";
  }

  function setButtons(phase) {
    const call = document.getElementById("btn-call");
    const letgo = document.getElementById("btn-letgo");
    const live = phase === "call";
    call.disabled = !live;
    letgo.disabled = !live;
  }

  function renderAll(activeSeat) {
    renderHand();
    renderPile();
    renderSeats(activeSeat == null ? -9 : activeSeat);
    renderClaim();
  }

  /* ---------------- flying card animation ---------------- */

  function flyCards(fromEl, count) {
    const room = document.getElementById("room");
    const pileBox = document
      .getElementById("pile-wrap")
      .getBoundingClientRect();
    const from = fromEl.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const fc = backNode();
      fc.classList.add("flycard");
      const w = 44;
      fc.style.width = w + "px";
      fc.style.height = w * 1.4 + "px";
      const sx = from.left + (from.width - w) / 2 + (Math.random() * 24 - 12);
      const sy =
        from.top + (from.height - w * 1.4) / 2 + (Math.random() * 14 - 7);
      fc.style.left = sx + "px";
      fc.style.top = sy + "px";
      room.appendChild(fc);
      requestAnimationFrame(() => {
        fc.style.left = pileBox.left + 8 + Math.random() * 14 + "px";
        fc.style.top = pileBox.top + 8 + Math.random() * 12 + "px";
        fc.style.transform = "rotate(" + (Math.random() * 24 - 12) + "deg)";
      });
      setTimeout(() => fc.remove(), 640);
    }
    snd.flick();
  }

  /* ---------------- AI brains ---------------- */

  function aiChoosePlay(seat) {
    const meta = AI_META[seat - 1];
    const hand = S.hands[seat];
    const honest = hand.filter((c) => c.r === S.rankIdx);
    const junk = hand.filter((c) => c.r !== S.rankIdx);
    const desperation = Math.min(1, hand.length / 15 + 0.2);
    const lieChance = (1 - meta.honesty) * desperation * 0.58;

    let cards = [];
    const takeHonest = (n) => cards.push(...honest.splice(0, n));
    const takeJunk = (n) => {
      for (let k = 0; k < n && junk.length; k++) {
        cards.push(junk.splice((Math.random() * junk.length) | 0, 1)[0]);
      }
    };

    // nearly out: shove everything at the table before anyone blinks
    if (hand.length <= 3) {
      takeHonest(honest.length);
      takeJunk(4 - cards.length);
      return cards.slice(0, 4);
    }

    if (honest.length && Math.random() > lieChance * 0.6) {
      const want =
        honest.length <= 3 ? honest.length : 2 + ((Math.random() * 2) | 0);
      takeHonest(Math.min(want, 4));
      if (cards.length < 4 && hand.length > 8 && Math.random() < lieChance)
        takeJunk(1);
    } else {
      const maxN = Math.min(4, hand.length);
      const n = 1 + ((Math.random() * Math.min(3, maxN - 1)) | 0);
      if (honest.length && Math.random() < 0.4) takeHonest(1);
      takeJunk(n - cards.length);
    }
    cards = cards.slice(0, 4);
    return cards;
  }

  function aiWantsCall(seat, bySeat, count) {
    if (bySeat === seat) return false;
    const meta = AI_META[seat - 1];
    let susp = 0.18;
    if (count >= 3) susp += 0.14;
    if (count === 4) susp += 0.1;
    const byLeft = S.hands[bySeat].length;
    if (byLeft <= 2) susp += 0.16;
    else if (byLeft <= 5) susp += 0.06;
    if (S.pile.length >= 10) susp += 0.05;
    susp += 0.06 * Math.min(2, S.mem[bySeat]);
    return Math.random() < Math.min(0.6, meta.aggr * susp);
  }

  /* ---------------- turn engine ---------------- */

  const bad = (gen) => gen !== S.gen;

  function removeCards(seat, ids) {
    const hand = S.hands[seat];
    const taken = [];
    for (const id of ids) {
      const ix = hand.findIndex((c) => c.id === id);
      if (ix >= 0) taken.push(hand.splice(ix, 1)[0]);
    }
    return taken;
  }

  function commitLay(seat, cards) {
    const start = S.pile.length;
    for (const c of cards) S.pile.push({ card: c, by: seat });
    return start;
  }

  function transferPile(taker) {
    const n = S.pile.length;
    for (const e of S.pile) S.hands[taker].push(e.card);
    S.pile = [];
    sortHand(taker);
    return n;
  }

  function movePennies(from, to) {
    const give = Math.min(2, S.pennies[from]);
    S.pennies[from] -= give;
    S.pennies[to] += give;
    snd.coin();
  }

  async function resolveChallenge(gen, liarSeat, callerSeat, lied, batchStart) {
    S.phase = "resolve";
    setButtons("none");
    renderPile(batchStart); // flip the accused cards face-up
    snd.slide();
    await nap(1150);
    if (bad(gen)) return;

    const liarName = liarSeat === 0 ? "You" : AI_META[liarSeat - 1].name;
    const callerName = callerSeat === 0 ? "you" : AI_META[callerSeat - 1].name;

    if (lied) {
      S.mem[liarSeat]++;
      movePennies(liarSeat, callerSeat);
      const n = transferPile(liarSeat);
      if (liarSeat === 0) {
        flash("Caught! " + n + " cards back into your hand.", "bad");
        say(callerSeat, pick(SAY.caughtYou));
        snd.bad();
      } else {
        const gain = callerSeat === 0 ? " You pocket 2d." : "";
        flash(liarName + " bluffed!" + gain, callerSeat === 0 ? "good" : "");
        say(liarSeat, pick(SAY.grumble));
        if (callerSeat === 0) snd.good();
        else snd.callSting();
      }
    } else {
      movePennies(callerSeat, liarSeat);
      const n = transferPile(callerSeat);
      if (callerSeat === 0) {
        flash("They were honest. The pile is yours (" + n + " cards).", "bad");
        say(liarSeat, pick(SAY.boldWrong));
        snd.bad();
      } else {
        const cleared = liarSeat === 0 ? "You are" : liarName + " is";
        flash(
          callerName + " called wrong. " + cleared + " clear.",
          liarSeat === 0 ? "good" : "",
        );
        say(callerSeat, pick(SAY.grumble));
        if (liarSeat === 0) snd.good();
      }
    }
    renderAll(-9);
  }

  function checkOutAndEnd(gen) {
    for (let i = 0; i < 4; i++) {
      if (!S.out.includes(i) && S.hands[i].length === 0) S.out.push(i);
    }
    renderAll(-9);
  }

  function checkOutAndEnd(gen) {
    for (let i = 0; i < 4; i++) {
      if (!S.out.includes(i) && S.hands[i].length === 0) S.out.push(i);
    }
    if (S.out.length >= 1) {
      const winner = S.out[0];
      S.pennies[winner] += S.pot;
      S.pot = 0;
      endGame(gen, winner);
      return true;
    }
    return false;
  }

  function waitPlayerPlay(gen) {
    return new Promise((res) => {
      ui.playResolve = (ids) => {
        if (bad(gen)) return;
        ui.playResolve = null;
        res(ids);
      };
    });
  }

  function waitCallChoice(gen) {
    return new Promise((res) => {
      ui.callResolve = (choice) => {
        if (bad(gen)) return;
        ui.callResolve = null;
        res(choice);
      };
    });
  }

  function openCallTimer(dur) {
    S.callWindow = { ends: clock.t + dur, dur };
  }

  function closeCallTimer() {
    S.callWindow = null;
    document.getElementById("call-timer-fill").style.transform = "scaleX(0)";
  }

  async function doTurn(seat, gen) {
    setActive(seat);

    let laid;
    let fromEl;

    if (seat === 0) {
      S.phase = "player-turn";
      S.sel.clear();
      S.kfocus = Math.min(S.kfocus, Math.max(0, S.hands[0].length - 1));
      renderHand();
      setStatus(
        "Your go \u2014 the table owes " +
          PLURAL[S.rankIdx] +
          ". Lay the truth, or something near it.",
      );
      setButtons("none");
      const ids = await waitPlayerPlay(gen);
      if (bad(gen)) return false;
      laid = removeCards(0, ids);
      S.sel.clear();
      fromEl = document.getElementById("you");
    } else {
      S.phase = "ai-turn";
      renderHand();
      setButtons("none");
      setStatus(AI_META[seat - 1].name + " is counting her cards\u2026");
      await nap(430 + Math.random() * 500);
      if (bad(gen)) return false;
      laid = aiChoosePlay(seat);
      laid = removeCards(
        seat,
        laid.map((c) => c.id),
      ); // take them out of her hand
      fromEl = document.getElementById("seat-" + seat);
    }

    if (!laid.length) return true; // safety, cannot normally happen

    const batchStart = commitLay(seat, laid);
    flyCards(fromEl, laid.length);
    renderPile();

    const lied = isLie(laid);
    const claimTxt = laid.length + " as " + PLURAL[S.rankIdx];

    if (seat !== 0) {
      const meta = AI_META[seat - 1];
      say(seat, lied ? pick(SAY.lying) : pick(SAY.honest), 2400);
      tellMark(seat, lied && Math.random() < 0.45, 3000);
      setStatus(meta.name + " lays " + claimTxt + ". Doubt her?");
    } else {
      setStatus("You lay " + claimTxt + ". Faces around the table\u2026");
    }

    /* --- who calls? --- */
    let caller = -1;

    if (seat === 0) {
      // the three regulars consider, quickest trigger first
      const order = [1, 2, 3]
        .filter((i) => !S.out.includes(i))
        .sort((a, b) => AI_META[b - 1].aggr - AI_META[a - 1].aggr)
        .slice(0, 2);
      let settled = false;
      for (let k = 0; k < order.length && !settled; k++) {
        const watcher = order[k];
        await nap(k === 0 ? 720 : 460);
        if (bad(gen)) return false;
        const keen =
          aiWantsCall(watcher, 0, laid.length) * (k === 0 ? 1 : 0.78);
        if (Math.random() < keen) {
          settled = true;
          caller = watcher;
          say(watcher, pick(SAY.call), 2000);
          snd.callSting();
        } else if (k === 0 && Math.random() < 0.5) {
          say(watcher, pick(SAY.pass), 1300);
        }
      }
    } else {
      S.phase = "call";
      setButtons("call");
      openCallTimer(2700);
      const choice = await Promise.race([
        waitCallChoice(gen),
        nap(2700).then(() => "timeout"),
      ]);
      if (bad(gen)) return false;
      closeCallTimer();
      setButtons("none");
      if (choice === "call") {
        caller = 0;
        snd.callSting();
      } else {
        if (choice === "letgo") say(seat, pick(SAY.pass), 1200);
        const others = [1, 2, 3].filter(
          (i) => i !== seat && !S.out.includes(i),
        );
        for (const watcher of others) {
          await nap(360);
          if (bad(gen)) return false;
          if (aiWantsCall(watcher, seat, laid.length)) {
            caller = watcher;
            say(watcher, pick(SAY.call), 2000);
            snd.callSting();
            break;
          }
        }
      }
    }

    if (bad(gen)) return false;

    if (caller >= 0) {
      await resolveChallenge(gen, seat, caller, lied, batchStart);
      if (bad(gen)) return false;
    } else {
      S.phase = "resolve";
      await nap(350);
      if (bad(gen)) return false;
    }

    S.rankIdx = (S.rankIdx + 1) % 13;
    renderClaim();

    if (checkOutAndEnd(gen)) return false;
    return true;
  }

  async function runSession(gen) {
    let seat = 3; // player sits to the dealer's left, effectively
    let laps = 0;
    while (laps < 400) {
      laps++;
      seat = (seat + 1) % 4;
      if (S.out.includes(seat)) continue;
      const alive = [0, 1, 2, 3].filter((i) => S.hands[i].length > 0);
      if (alive.length <= 1) {
        if (!S.out.length) endGame(gen, alive[0]);
        return;
      }
      if (S.hands[seat].length === 0) continue;
      const again = await doTurn(seat, gen);
      if (!again || bad(gen)) return;
      S.mem = S.mem.map((m) => (m > 0 ? Math.max(0, m - 0.4) : 0));
    }
  }

  /* ---------------- game end ---------------- */

  function endGame(gen, winnerSeat) {
    S.phase = "end";
    setButtons("none");
    closeCallTimer();
    renderAll(-9);

    const standings = [...S.out];
    const rest = [0, 1, 2, 3]
      .filter((i) => !standings.includes(i))
      .sort((a, b) => S.hands[a].length - S.hands[b].length);
    standings.push(...rest);
    const place = standings.indexOf(0) + 1;

    const title = document.getElementById("end-title");
    const sub = document.getElementById("end-sub");
    const ledger = document.getElementById("end-ledger");

    if (winnerSeat === 0) {
      title.textContent = "Out first!";
      title.classList.remove("lost");
      sub.textContent = "The pot is yours. Vera mutters about the tea money.";
      snd.win();
    } else {
      title.textContent = AI_META[winnerSeat - 1].name + " sweeps the pot.";
      title.classList.add("lost");
      sub.textContent =
        "You finished " +
        PLACE[place - 1] +
        (place === 1 ? "" : ", holding " + S.hands[0].length + " cards.");
      snd.lose();
    }
    ledger.textContent =
      "Your purse: " + S.pennies[0] + "d (started the evening with 12d).";

    setStatus(winnerSeat === 0 ? "A clean sweep." : "Another hand, perhaps.");
    document.getElementById("end-card").classList.remove("hidden");
  }

  /* ---------------- dealing / restart ---------------- */

  function newDeal() {
    S.gen++;
    S.out = [];
    S.pile = [];
    S.sel.clear();
    S.kfocus = 0;
    S.mem = [0, 0, 0, 0];
    S.pennies = [12, 9, 9, 9];
    S.pot = 12;
    S.rankIdx = (Math.random() * 13) | 0;
    S.paused = false;
    document.body.classList.remove("paused");

    const deck = freshDeck();
    for (let i = 0; i < 4; i++) {
      S.hands[i] = deck.slice(i * 13, (i + 1) * 13);
      sortHand(i);
    }

    for (let i = 1; i <= 3; i++)
      document.getElementById("seat-" + i).classList.remove("telling");
    document.getElementById("verdict").className = "";
    closeCallTimer();
    document.getElementById("pause-card").classList.add("hidden");
    document.getElementById("end-card").classList.add("hidden");
    document.getElementById("help-card").classList.add("hidden");

    renderAll(-9);
    setStatus("Dealing thirteen apiece\u2026");
    S.phase = "deal";
    runSession(S.gen);
  }

  /* ---------------- input wiring ---------------- */

  function toggleSelect(id) {
    if (S.phase !== "player-turn") return;
    if (S.sel.has(id)) {
      S.sel.delete(id);
    } else {
      if (S.sel.size >= 4) {
        setStatus("Four to a lay \u2014 house rules.");
        return;
      }
      S.sel.add(id);
    }
    renderHand();
    if (S.sel.size) {
      setStatus(
        "Laying " +
          S.sel.size +
          " as " +
          PLURAL[S.rankIdx] +
          ". Honest? We shall see.",
      );
    } else {
      setStatus("Your go \u2014 the table owes " + PLURAL[S.rankIdx] + ".");
    }
  }

  function playerPlaySelected() {
    if (S.phase !== "player-turn" || !ui.playResolve) return;
    if (S.sel.size < 1 || S.sel.size > 4) return;
    const ids = [...S.sel];
    S.sel.clear();
    renderHand();
    ui.playResolve(ids);
  }

  function moveFocus(delta) {
    const len = S.hands[0].length;
    if (!len) return;
    S.kfocus = (S.kfocus + delta + len) % len;
    renderHand();
  }

  function toggleFocused() {
    const card = S.hands[0][S.kfocus];
    if (card) toggleSelect(card.id);
  }

  function chooseCall(choice) {
    if (S.phase === "call" && ui.callResolve) ui.callResolve(choice);
  }

  function togglePause(force) {
    if (S.phase === "title" || S.phase === "end") return;
    const wantPause = force != null ? force : !S.paused;
    if (wantPause === S.paused) return;
    S.paused = wantPause;
    document.body.classList.toggle("paused", S.paused);
    document.getElementById("pause-card").classList.toggle("hidden", !S.paused);
    if (AC) {
      if (S.paused) AC.suspend();
      else AC.resume();
    }
  }

  function wireEvents() {
    document.getElementById("btn-start").addEventListener("click", () => {
      document.getElementById("title-card").classList.add("hidden");
      audio();
      newDeal();
    });
    document.getElementById("btn-again").addEventListener("click", newDeal);
    document.getElementById("btn-new").addEventListener("click", newDeal);
    document
      .getElementById("btn-resume")
      .addEventListener("click", () => togglePause(false));
    document
      .getElementById("btn-sound")
      .addEventListener("click", () => setMuted(!muted));

    document.getElementById("btn-help").addEventListener("click", () => {
      document.getElementById("help-card").classList.remove("hidden");
      togglePause(true);
    });
    document.getElementById("btn-close-help").addEventListener("click", () => {
      document.getElementById("help-card").classList.add("hidden");
      togglePause(false);
    });

    document
      .getElementById("btn-play")
      .addEventListener("click", playerPlaySelected);
    document
      .getElementById("btn-call")
      .addEventListener("click", () => chooseCall("call"));
    document
      .getElementById("btn-letgo")
      .addEventListener("click", () => chooseCall("letgo"));

    document.getElementById("hand").addEventListener("click", (ev) => {
      const li = ev.target.closest("li[data-id]");
      if (li) toggleSelect(li.dataset.id);
    });

    document.addEventListener("keydown", (ev) => {
      const key = ev.key;
      const helpOpen = !document
        .getElementById("help-card")
        .classList.contains("hidden");
      const titleOpen = !document
        .getElementById("title-card")
        .classList.contains("hidden");
      const endOpen = !document
        .getElementById("end-card")
        .classList.contains("hidden");
      const pauseOpen = S.paused;

      if (key === "m" || key === "M") {
        setMuted(!muted);
        return;
      }

      if (titleOpen) {
        if (key === "Enter" || key === " ") {
          ev.preventDefault();
          document.getElementById("btn-start").click();
        }
        return;
      }
      if (endOpen) {
        if (key === "Enter" || key === " ") {
          ev.preventDefault();
          document.getElementById("btn-again").click();
        }
        if (key === "r" || key === "R") newDeal();
        return;
      }
      if (helpOpen) {
        if (["Escape", "Enter", "h", "H"].includes(key)) {
          ev.preventDefault();
          document.getElementById("btn-close-help").click();
        }
        return;
      }
      if (key === "p" || key === "P") {
        togglePause();
        return;
      }
      if (pauseOpen) {
        if (key === "Escape" || key === "Enter" || key === " ") {
          ev.preventDefault();
          togglePause(false);
        }
        return;
      }

      switch (key) {
        case "ArrowLeft":
        case "a":
        case "A":
          ev.preventDefault();
          moveFocus(-1);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          ev.preventDefault();
          moveFocus(1);
          break;
        case " ":
        case "Spacebar":
          ev.preventDefault();
          if (S.phase === "player-turn") toggleFocused();
          break;
        case "Enter":
          ev.preventDefault();
          if (S.phase === "player-turn") playerPlaySelected();
          break;
        case "c":
        case "C":
          chooseCall("call");
          break;
        case "l":
        case "L":
          chooseCall("letgo");
          break;
        case "r":
        case "R":
          newDeal();
          break;
        case "h":
        case "H":
          document.getElementById("help-card").classList.remove("hidden");
          togglePause(true);
          break;
        default:
          break;
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) togglePause(true);
    });
  }

  /* ---------------- main loop ---------------- */

  let lastFrame = performance.now();

  function frame(now) {
    const dt = Math.min(60, now - lastFrame);
    lastFrame = now;
    if (!S.paused) {
      clock.t += dt;
      const due = [];
      for (const item of clock.items) {
        if (clock.t >= item.due) due.push(item);
      }
      for (const item of due) {
        clock.items.delete(item);
        item.fn();
      }
      const cw = S.callWindow;
      if (cw) {
        const frac = Math.max(0, (cw.ends - clock.t) / cw.dur);
        document.getElementById("call-timer-fill").style.transform =
          "scaleX(" + frac.toFixed(4) + ")";
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */

  wireEvents();
  renderAll(-9);
  renderClaim();
  setStatus("Take a seat. The kettle knows you.");
  requestAnimationFrame(frame);
})();
