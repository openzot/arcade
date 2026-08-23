/*
 * Going Once — a candlelit country auction house.
 *
 * Twelve lots, three sharp rivals, one purse. Every lot hides a true value
 * that is only revealed when the hammer falls. Buy low, let the rivals soak
 * up the duds, and clear £120 profit before midnight.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  tiny helpers
   * ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[irand(0, arr.length - 1)];
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const gbp = (n) => "£" + n;

  const el = {
    lotCounter: $("lot-counter"),
    purseTop: $("purse-top"),
    lotNo: $("lot-no"),
    lotCat: $("lot-cat"),
    lotCard: $("lot-card"),
    lotArt: $("lot-art"),
    lotName: $("lot-name"),
    lotNote: $("lot-note"),
    auctioneer: $("auctioneer-line"),
    goingBar: $("going-bar"),
    goingLabel: $("going-label"),
    bidAmount: $("bid-amount"),
    bidHolder: $("bid-holder"),
    purseAmount: $("purse-amount"),
    quotaBar: $("quota-bar"),
    quotaLabel: $("quota-label"),
    purseBox: $("purse-box"),
    rivals: $("rivals"),
    ledgerList: $("ledger-list"),

    bidBtn: $("bid-btn"),

    passBtn: $("pass-btn"),
    keysHint: $("keys-hint"),
    overlayTitle: $("overlay-title"),
    overlayEnd: $("overlay-end"),
    overlayPause: $("overlay-pause"),
    startBtn: $("start-btn"),
    restartBtn: $("restart-btn"),
    resumeBtn: $("resume-btn"),
    endVerdict: $("end-verdict"),
    endStars: $("end-stars"),
    endSummary: $("end-summary"),
    endTally: $("end-tally"),
  };

  /* ------------------------------------------------------------------ *
   *  constants
   * ------------------------------------------------------------------ */
  const LOT_COUNT = 12;
  const START_PURSE = 300;
  const STEP = 5;
  const QUOTA = 120;
  const GOLD_TARGET = 220;
  const DEAL_TIME = 0.95;
  const RESOLVE_TIME = 2.9;
  const PREBID_TIME = 4.6;
  const bidTime = (i) => Math.max(2.3, 3.1 - i * 0.07);

  /* ------------------------------------------------------------------ *
   *  catalogue data
   * ------------------------------------------------------------------ */
  const CATS = {
    porcelain: {
      label: "Porcelain",
      art: '<path d="M24 8h16l-3 8c6 4 9 10 9 17 0 12-7 19-14 19s-14-7-14-19c0-7 3-13 9-17l-3-8z"/><path d="M25 52h14"/>',
      adj: [
        "Staffordshire",
        "crack-glazed",
        "gilded",
        "willow-pattern",
        "spill-vase",
      ],
      noun: ["vase", "tureen", "figurine", "chamber stick", "milk jug"],
    },
    clocks: {
      label: "Clocks & Watches",
      art: '<circle cx="32" cy="36" r="17"/><path d="M32 26v10l8 5"/><path d="M25 10h14"/><path d="M27 10l2 9M37 10l-2 9"/>',
      adj: ["bracket", "carriage", "ormolu", "annular", "ship's"],
      noun: ["clock", "watch", "barometer", "regulator", "chronometer"],
    },
    paintings: {
      label: "Paintings",
      art: '<rect x="10" y="12" width="44" height="38" rx="2"/><path d="M14 42l11-12 8 8 9-11 8 9"/><circle cx="23" cy="22" r="3"/>',
      adj: ["gilt-framed", "watercolour", "moorland", "candlelit", "miniature"],
      noun: [
        "seascape",
        "study",
        "portrait of a stranger",
        "sheep dip",
        "ruin",
      ],
    },
    furniture: {
      label: "Furniture",
      art: '<path d="M22 8v30h22v18"/><path d="M22 38v18"/><path d="M22 46h22"/><path d="M22 30h20"/>',
      adj: ["mahogany", "inlaid", "captain's", "faded rosewood", "priest's"],
      noun: ["writing desk", "armchair", "cabinet", "stool", "cheval mirror"],
    },
    jewellery: {
      label: "Jewellery",
      art: '<circle cx="32" cy="39" r="15"/><path d="M24 17l8-9 8 9-8 8z"/>',
      adj: ["jet", "pearl", "cut-steel", "garnet", "mourning"],
      noun: ["brooch", "locket", "cufflinks", "ring", "ear-drops"],
    },
    books: {
      label: "Books & Maps",
      art: '<path d="M12 13h15a7 7 0 017 7v32a7 7 0 00-7-6H12z"/><path d="M52 13H37a7 7 0 00-7 7v32a7 7 0 017-6h15z"/>',
      adj: [
        "leather-bound",
        "hand-coloured",
        "water-stained",
        "first-printing",
        "parish",
      ],
      noun: ["atlas", "sermon", "natural history", "cookery book", "survey"],
    },
    curios: {
      label: "Curiosities",
      art: '<circle cx="22" cy="22" r="10"/><path d="M29 29l24 24"/><path d="M44 44l7-7M51 51l6-6"/>',
      adj: ["brass", "taxidermy", "shagreen", "convex", "walrus"],
      noun: [
        "spyglass",
        "herring jar",
        "snuff box",
        "door stop",
        "letter knife",
      ],
    },
  };

  const NOTES = {
    treasure: [
      "Signed and dated 1889, provenance letter enclosed.",
      "Unrestored — the family kept it under glass.",
      "Exhibition piece. The catalogue raves, quietly.",
      "Maker's mark crisp beneath the handle.",
      "From the Halloway estate. Their name opens doors.",
    ],
    decent: [
      "Honest wear, nothing sinister.",
      "The catalogue hedges with the word 'attributed'.",
      "Presentable; one foot neatly repaired.",
      "Cleaned at some point — the shine is new.",
      "No faults to speak of, none to brag of.",
    ],
    junk: [
      "Labelled 'after' the famous maker. After. Not by.",
      "A reproduction doing an impression of an heirloom.",
      "Hairline crack, running honest and deep.",
      "Smells faintly of the attic it came from.",
      "The reserve is optimistic. Very optimistic.",
    ],
  };

  const TIERS = [
    { id: "treasure", lo: 95, hi: 175 },
    { id: "decent", lo: 45, hi: 90 },
    { id: "junk", lo: 8, hi: 38 },
  ];

  const RIVAL_DEFS = [
    {
      id: "colonel",
      name: "Col. Hartop",
      purse: 210,
      quirk: "Never goes a shilling past £70 on anything.",
      cap: 70,
      delay: [0.4, 1.0],
      portrait:
        '<circle cx="32" cy="28" r="15"/><circle cx="40" cy="25" r="4.5"/><path d="M40 30v7"/><path d="M23 35c4 5 14 5 18 0"/><path d="M17 57c2-9 28-9 30 0"/>',
      tellCovet: "polishes his monocle furiously",
      out: [
        "Bah — highway robbery.",
        "Not at that figure, sir.",
        "You may have it.",
      ],
      win: ["Sold to me, then.", "Just so.", "Steady value, this."],
    },
    {
      id: "prynn",
      name: "Miss Prynn",
      purse: 240,
      quirk:
        "Fights tooth and nail for porcelain, clocks & jewels; barely glances elsewhere.",
      loves: ["porcelain", "clocks", "jewellery"],
      delay: [0.7, 1.4],
      portrait:
        '<circle cx="32" cy="31" r="14"/><circle cx="32" cy="12" r="6"/><path d="M20 57c2-9 22-9 24 0"/><path d="M25 30a2 2 0 004 0M35 30a2 2 0 004 0"/><path d="M27 38c3 2 7 2 10 0"/>',
      out: [
        "You'll forgive me, I'm sure.",
        "*fans herself* Too rich for me.",
        "Keep it, keep it.",
      ],
      win: [
        "Oh, it was made for me.",
        "*satisfied rustle*",
        "The parlour wants it.",
      ],
    },
    {
      id: "quill",
      name: "Mr. Quill",
      purse: 170,
      quirk: "Sits on his hands until the hammer hangs, then strikes once.",
      sniper: true,
      delay: [0.2, 0.4],
      portrait:
        '<path d="M23 5h18v15H23z"/><path d="M18 20h28"/><circle cx="32" cy="34" r="12"/><path d="M20 57c2-8 22-8 24 0"/>',
      out: ["…", "Another time."],
      win: ["*a single nod*", "Adequate."],
    },
  ];

  const AE_DEAL = [
    "Lot {n} — a {name}. Look it over.",
    "Next up, lot {n}: {name}.",
    "Now then. Lot {n}, a {name}, fresh from the estate.",
  ];
  const AE_INVITE = "Who'll say {open} to start us?";
  const AE_BID = [
    "{who} says {amt}.",
    "{amt} — from {who}, boldly.",
    "At {amt} — {who}.",
  ];
  const AE_SOLD = [
    "Sold — {amt} to {who}!",
    "The hammer falls: {amt}, {who}.",
    "{who} has it at {amt}.",
  ];

  /* ------------------------------------------------------------------ *
   *  state
   * ------------------------------------------------------------------ */
  const state = {
    phase: "title", // title | dealing | bidding | resolving | done
    paused: false,
    muted: false,
    lotIndex: 0,
    lots: [],
    purse: START_PURSE,
    profit: 0,
    spent: 0,
    earned: 0,
    won: 0,
    history: [],
    t: 0,
    phaseT: 0,
    barT: PREBID_TIME,
    barMax: PREBID_TIME,
    high: null, // { actor: 'you' | rival, amount }
    goingStage: 0,
  };

  const player = { out: false };
  let rivals = [];
  let lot = null;
  let opening = 10;

  /* ------------------------------------------------------------------ *
   *  audio (all synthesised, created on first user gesture)
   * ------------------------------------------------------------------ */
  let AC = null;
  let master = null;

  function ensureAudio() {
    if (!AC) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        AC = new Ctx();
        master = AC.createGain();
        master.gain.value = state.muted ? 0 : 0.15;
        master.connect(AC.destination);
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
  }

  function tone(freq, dur, type, vol, when, glideTo) {
    if (!AC || state.muted) return;
    const t0 = AC.currentTime + (when || 0);
    const osc = AC.createOscillator();
    const gain = AC.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function knock(dur, vol, when, freq) {
    if (!AC || state.muted) return;
    const t0 = AC.currentTime + (when || 0);
    const len = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const filt = AC.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = freq || 900;
    const gain = AC.createGain();
    gain.gain.value = vol;
    src.connect(filt);
    filt.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  const sfx = {
    tick() {
      tone(500 + Math.random() * 90, 0.07, "square", 0.35);
    },
    open() {
      tone(330, 0.1, "square", 0.3);
    },
    gavel() {
      knock(0.09, 0.8, 0, 1400);
      tone(90, 0.22, "sine", 0.9, 0.01);
      knock(0.06, 0.5, 0.16, 1200);
    },
    coin() {
      tone(880, 0.09, "triangle", 0.4);
      tone(1318, 0.16, "triangle", 0.4, 0.09);
    },
    bad() {
      tone(200, 0.35, "sawtooth", 0.3, 0, 88);
    },
    pass() {
      knock(0.12, 0.25, 0, 500);
    },
  };

  function toggleMute() {
    state.muted = !state.muted;
    try {
      localStorage.setItem("going-once-muted", state.muted ? "1" : "0");
    } catch (err) {
      /* private mode etc. */
    }
    if (master) master.gain.value = state.muted ? 0 : 0.15;
    renderHint();
  }

  /* ------------------------------------------------------------------ *
   *  night generation
   * ------------------------------------------------------------------ */
  function makeLots() {
    const tiers = [];
    TIERS.forEach((t) => {
      for (let i = 0; i < 4; i++) tiers.push(t);
    });
    for (let i = tiers.length - 1; i > 0; i--) {
      const j = irand(0, i);
      [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
    }
    const catKeys = Object.keys(CATS);
    for (let i = catKeys.length - 1; i > 0; i--) {
      const j = irand(0, i);
      [catKeys[i], catKeys[j]] = [catKeys[j], catKeys[i]];
    }
    const used = new Set();
    return tiers.map((tier, i) => {
      const cat = catKeys[i % catKeys.length];
      const def = CATS[cat];
      let name = "";
      let guard = 0;
      do {
        name = pick(def.adj) + " " + pick(def.noun);
        guard++;
      } while (used.has(name) && guard < 30);
      used.add(name);
      const value = round5(rand(tier.lo, tier.hi));
      return {
        cat,
        catLabel: def.label,
        name,
        note: pick(NOTES[tier.id]),
        value,
        opening: clamp(round5(value * rand(0.28, 0.42)), 10, 85),
      };
    });
  }

  function planRivals() {
    rivals.forEach((r) => {
      r.maxThisLot = rivalMax(r);
      r.out = false;
      r.struck = false;
      r.pricedAt = null;
      r.nextAt = 0;
      r.canOpen =
        !r.sniper && opening <= r.maxThisLot && opening + STEP <= r.purse;

      r.openAt = r.canOpen ? rand(0.9, 2.3) : Infinity;
    });
  }

  function rivalMax(r) {
    let m;
    if (r.cap) {
      m = Math.min(r.cap, round5(lot.value * rand(0.72, 1.08)));
    } else if (r.sniper) {
      m = round5(lot.value * rand(0.72, 0.98));
    } else if (r.loves && r.loves.includes(lot.cat)) {
      m = round5(lot.value * rand(0.88, 1.18));
    } else {
      m = lot.value <= 60 ? round5(lot.value * rand(0.5, 0.8)) : 0;
    }
    return Math.max(10, Math.min(m, r.purse));
  }

  /* ------------------------------------------------------------------ *
   *  rendering
   * ------------------------------------------------------------------ */
  const ICON_OPEN =
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  function renderLot() {
    const def = CATS[lot.cat];
    el.lotNo.textContent = "Lot " + (state.lotIndex + 1);
    el.lotCat.textContent = def.label;
    el.lotName.textContent = lot.name;
    el.lotNote.textContent = lot.note;
    el.lotArt.innerHTML = ICON_OPEN + def.art + "</svg>";
    el.lotCard.classList.remove("dealing");
    void el.lotCard.offsetWidth;
    el.lotCard.classList.add("dealing");
    el.lotCounter.textContent =
      "Lot " + (state.lotIndex + 1) + " of " + LOT_COUNT;
  }

  function renderPurse() {
    el.purseAmount.textContent = gbp(state.purse);
    el.purseTop.textContent = gbp(state.purse);
    const frac = clamp(state.profit / QUOTA, 0, 1) * 100;
    el.quotaBar.style.width = frac.toFixed(1) + "%";
    el.purseBox.classList.toggle("hit-target", state.profit >= QUOTA);
    el.quotaLabel.textContent =
      state.profit >= QUOTA
        ? "Target cleared — everything now is glory"
        : "Clear " + gbp(QUOTA) + " by midnight to keep the shop";
  }

  function renderBid() {
    if (state.high) {
      el.bidAmount.textContent = gbp(state.high.amount);
      el.bidHolder.textContent = "held by " + whoName(state.high.actor);
    } else {
      el.bidAmount.textContent = "—";
      el.bidHolder.textContent = "No bid yet";
    }
  }

  function whoName(actor) {
    return actor === "you" ? "you" : actor.name;
  }

  function renderRivals() {
    rivals.forEach((r) => {
      r.el.purse.textContent = gbp(r.purse);
      r.el.card.classList.toggle("out", r.out);
      r.el.card.classList.toggle("idle", !r.out);
      r.el.status.textContent = r.out ? "out" : "";
    });
  }

  function renderHint() {
    el.keysHint.textContent =
      "Space/B bid · X pass · P pause · R restart · M sound " +
      (state.muted ? "(muted)" : "(on)");
  }

  function renderButtons() {
    const bidding = state.phase === "bidding";
    const canBid =
      bidding && !player.out && state.high === null
        ? state.purse >= opening
        : bidding &&
          !player.out &&
          state.high !== null &&
          state.high.actor !== "you" &&
          state.purse >= state.high.amount + STEP;
    if (canBid) {
      const amt = state.high ? state.high.amount + STEP : opening;
      el.bidBtn.textContent = state.high
        ? "Bid " + gbp(amt)
        : "Open " + gbp(amt);
      el.bidBtn.disabled = false;
      el.bidBtn.classList.add("pulse");
    } else {
      el.bidBtn.textContent = player.out
        ? "Sit this lot out"
        : state.high && state.high.actor === "you"
          ? "Your bid stands"
          : bidding
            ? "Out of purse"
            : "Bid";
      el.bidBtn.disabled = true;
      el.bidBtn.classList.remove("pulse");
    }
    el.passBtn.disabled = !bidding || player.out;
  }

  function setAuctioneer(text) {
    el.auctioneer.textContent = text;
  }

  function showBubble(r, text, ms) {
    r.el.bubble.textContent = text;
    r.el.bubble.classList.add("show");
    clearTimeout(r.bubbleTimer);
    r.bubbleTimer = setTimeout(
      () => r.el.bubble.classList.remove("show"),
      ms || 1900,
    );
  }

  function ledgerRow(text, profit, mine) {
    const empty = el.ledgerList.querySelector(".ledger-empty");
    if (empty) empty.parentNode.removeChild(empty);
    const li = document.createElement("li");
    const spanL = document.createElement("span");

    spanL.textContent = text;
    const spanR = document.createElement("span");
    spanR.className = "l-profit";
    if (mine && typeof profit === "number") {
      spanR.textContent = (profit >= 0 ? "+" : "−") + "£" + Math.abs(profit);
      spanR.classList.add(profit >= 0 ? "good" : "bad");
    } else {
      spanR.textContent = profit || "";
    }
    li.appendChild(spanL);
    li.appendChild(spanR);
    el.ledgerList.insertBefore(li, el.ledgerList.firstChild);
  }

  /* ------------------------------------------------------------------ *
   *  flow
   * ------------------------------------------------------------------ */
  function newNight() {
    state.phase = "dealing";
    state.paused = false;
    state.lotIndex = 0;
    state.purse = START_PURSE;
    state.profit = 0;
    state.spent = 0;
    state.earned = 0;
    state.won = 0;
    state.history = [];
    state.high = null;
    player.out = false;
    rivals.forEach((r) => {
      r.purse = r.def.purse;
    });
    state.lots = makeLots();
    el.overlayTitle.classList.add("hidden");
    el.overlayEnd.classList.add("hidden");
    el.overlayPause.classList.add("hidden");
    el.ledgerList.innerHTML =
      '<li class="ledger-empty" id="ledger-empty">Nothing bought yet.</li>';
    buildRivalCards();
    renderPurse();
    renderHint();
    dealLot(0);
  }

  function dealLot(i) {
    state.lotIndex = i;
    lot = state.lots[i];
    opening = lot.opening;
    state.high = null;
    state.t = 0;
    state.goingStage = 0;
    player.out = false;
    planRivals();
    renderLot();
    renderBid();
    renderRivals();
    renderButtons();
    el.goingBar.style.width = "100%";
    el.goingLabel.textContent = "Reading the catalogue…";
    setAuctioneer(
      pick(AE_DEAL)
        .replace("{n}", String(i + 1))
        .replace("{name}", lot.name),
    );
    // tells
    const colonel = rivals.find((r) => r.cap);
    if (colonel && lot.value >= 110 && colonel.maxThisLot < lot.value * 0.55) {
      showBubble(
        colonel,
        "*" + colonel.tellCovet + "*  If only the pension stretched…",
        2400,
      );
    }
    const prynn = rivals.find((r) => r.loves);
    if (prynn && prynn.loves.includes(lot.cat)) {
      showBubble(
        prynn,
        "Oh — " + CATS[lot.cat].label.toLowerCase() + ". You know I shouldn't…",
        2400,
      );
    }
    const quill = rivals.find((r) => r.sniper);
    if (quill) quill.el.card.classList.toggle("sniping", quill.canOpen);
    state.phase = "dealing";
    state.phaseT = DEAL_TIME;
  }

  function startBidding() {
    state.phase = "bidding";
    state.t = 0;
    state.barMax = PREBID_TIME;
    state.barT = PREBID_TIME;
    el.goingLabel.textContent = "Who'll open at " + gbp(opening) + "?";
    setAuctioneer(AE_INVITE.replace("{open}", gbp(opening)));
    renderButtons();
  }

  function placeBid(actor) {
    const amount = state.high ? state.high.amount + STEP : opening;
    state.high = { actor, amount };
    state.barMax = bidTime(state.lotIndex);
    state.barT = state.barMax;
    state.goingStage = 0;
    rivals.forEach((r) => {
      r.struck = false;
      r.pricedAt = null;
      r.nextAt = 0;
    });
    if (actor === "you") {
      sfx.tick();
      setAuctioneer(
        pick([
          "The newcomer at the back says {amt}.",
          "{amt} from the young dealer.",
          "{amt} — you, confidently.",
        ]).replace("{amt}", gbp(amount)),
      );
    } else {
      sfx.open();
      setAuctioneer(
        pick(AE_BID).replace("{who}", actor.name).replace("{amt}", gbp(amount)),
      );
      if (Math.random() < 0.5)
        showBubble(
          actor,
          pick([
            "{amt}.".replace("{amt}", gbp(amount)),
            "Hmm.",
            "I'll say {amt}.".replace("{amt}", gbp(amount)),
          ]),
          1500,
        );
    }
    renderBid();
    renderButtons();
  }

  function dropOut(r) {
    if (r.out) return;
    r.out = true;
    sfx.pass();
    showBubble(r, pick(r.def.out), 1800);
    renderRivals();
  }

  function playerBid() {
    if (state.phase !== "bidding" || player.out) return;
    if (state.high && state.high.actor === "you") return;
    const amount = state.high ? state.high.amount + STEP : opening;
    if (amount > state.purse) return;
    placeBid("you");
  }

  function playerPass() {
    if (state.phase !== "bidding" || player.out) return;
    player.out = true;
    sfx.pass();
    setAuctioneer("The newcomer stands down. Sensible, perhaps.");
    renderButtons();
  }

  function resolveLot() {
    state.phase = "resolving";
    state.phaseT = RESOLVE_TIME;
    el.bidBtn.classList.remove("pulse");
    renderButtons();
    const label = "Lot " + (state.lotIndex + 1) + " · " + lot.name;
    if (!state.high) {
      el.goingLabel.textContent = "Passed in";
      setAuctioneer("No bid? Passed in — and no harm done.");
      state.history.push({
        name: lot.name,
        value: lot.value,
        paid: 0,
        buyer: null,
      });
      ledgerRow(label + " — passed in", "", false);
      sfx.pass();
      return;
    }
    sfx.gavel();
    const winner = state.high.actor;
    const paid = state.high.amount;
    el.goingLabel.textContent = "Sold!";
    if (winner === "you") {
      const profit = lot.value - paid;
      state.purse -= paid;
      state.profit += profit;
      state.spent += paid;
      state.earned += lot.value;
      state.won += 1;
      state.history.push({
        name: lot.name,
        value: lot.value,
        paid,
        buyer: "you",
      });
      setAuctioneer(
        pick(AE_SOLD)
          .replace("{amt}", gbp(paid))
          .replace("{who}", "the newcomer"),
      );
      el.bidHolder.textContent =
        "Appraised " +
        gbp(lot.value) +
        " — you " +
        (profit >= 0
          ? "cleared " + gbp(profit)
          : "paid " + gbp(-profit) + " dear");
      ledgerRow(label + " — you paid " + gbp(paid), profit, true);
      if (profit >= 0) sfx.coin();
      else sfx.bad();
    } else {
      state.history.push({
        name: lot.name,
        value: lot.value,
        paid,
        buyer: winner.name,
      });
      setAuctioneer(
        pick(AE_SOLD).replace("{amt}", gbp(paid)).replace("{who}", winner.name),
      );
      el.bidHolder.textContent =
        "Appraised " +
        gbp(lot.value) +
        " — " +
        (paid > lot.value ? "they overpaid" : "they bargained");
      ledgerRow(label + " — " + winner.name + " " + gbp(paid), "", false);
      showBubble(winner, pick(winner.def.win), 1800);
    }
    renderPurse();
    renderRivals();
  }

  function nextLot() {
    if (state.lotIndex + 1 < LOT_COUNT) dealLot(state.lotIndex + 1);
    else finishNight();
  }

  function finishNight() {
    state.phase = "done";
    const profit = state.profit;
    let verdict, stars;
    if (profit >= GOLD_TARGET) {
      verdict = "Talk of the county";
      stars = "★★★";
    } else if (profit >= QUOTA) {
      verdict = "The shop stays open";
      stars = "★★☆";
    } else if (profit > 0) {
      verdict = "A night of thin margins";
      stars = "★☆☆";
    } else {
      verdict = "Bought dear, sold dearer to nobody";
      stars = "✗ ✗ ✗";
    }
    el.endVerdict.textContent = verdict;
    el.endStars.textContent = stars;
    el.endSummary.textContent =
      "You bought " +
      state.won +
      " lot" +
      (state.won === 1 ? "" : "s") +
      " for " +
      gbp(state.spent) +
      "; the appraiser makes them " +
      gbp(state.earned) +
      ". Profit " +
      gbp(profit) +
      " against a " +
      gbp(QUOTA) +
      " target.";
    el.endTally.innerHTML = "";
    state.history.forEach((h) => {
      const li = document.createElement("li");
      const spanL = document.createElement("span");
      spanL.textContent = h.name;
      const spanR = document.createElement("span");
      if (h.buyer === "you") {
        const p = h.value - h.paid;
        spanR.textContent =
          "you " +
          gbp(h.paid) +
          " → " +
          gbp(h.value) +
          " (" +
          (p >= 0 ? "+" : "−") +
          "£" +
          Math.abs(p) +
          ")";
        spanR.className = p >= 0 ? "good" : "bad";
      } else if (h.buyer) {
        spanR.textContent =
          h.buyer + " " + gbp(h.paid) + " · worth " + gbp(h.value);
      } else {
        spanR.textContent = "passed in";
      }
      li.appendChild(spanL);
      li.appendChild(spanR);
      el.endTally.appendChild(li);
    });
    el.overlayEnd.classList.remove("hidden");
    setAuctioneer("That concludes the evening's sale.");
    sfx.gavel();
  }

  /* ------------------------------------------------------------------ *
   *  rival AI
   * ------------------------------------------------------------------ */
  function aiTick() {
    const barFrac = state.barT / state.barMax;
    for (const r of rivals) {
      if (r.out) continue;
      const amount = state.high ? state.high.amount + STEP : opening;
      if (amount > r.purse) {
        if (state.high) dropOut(r);
        continue;
      }
      const wants = state.high
        ? state.high.amount < r.maxThisLot
        : opening <= r.maxThisLot;
      if (!wants) {
        if (state.high) dropOut(r);
        continue;
      }
      if (state.high && state.high.actor === r) continue;
      if (r.sniper) {
        if (state.high && barFrac < 0.22 && !r.struck) {
          placeBid(r);
          r.struck = true;
        }
      } else if (!state.high) {
        if (state.t >= r.openAt) placeBid(r);
      } else {
        if (r.pricedAt !== state.high.amount) {
          r.pricedAt = state.high.amount;
          r.nextAt = state.t + rand(r.def.delay[0], r.def.delay[1]);
        } else if (state.t >= r.nextAt) {
          placeBid(r);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  main loop
   * ------------------------------------------------------------------ */
  function update(dt) {
    if (state.phase === "dealing") {
      state.phaseT -= dt;
      if (state.phaseT <= 0) startBidding();
    } else if (state.phase === "bidding") {
      state.t += dt;
      state.barT -= dt;
      aiTick();
      const frac = clamp(state.barT / state.barMax, 0, 1);
      el.goingBar.style.width = (frac * 100).toFixed(1) + "%";
      if (frac < 0.33 && state.goingStage < 2) {
        state.goingStage = 2;
        el.goingLabel.textContent = "Going twice…";
      } else if (frac < 0.66 && state.goingStage < 1) {
        state.goingStage = 1;
        el.goingLabel.textContent = "Going once…";
      }
      if (state.barT <= 0) resolveLot();
    } else if (state.phase === "resolving") {
      state.phaseT -= dt;
      if (state.phaseT <= 0) nextLot();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.paused && !document.hidden) update(dt);
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ *
   *  pause / visibility
   * ------------------------------------------------------------------ */
  function setPaused(p) {
    if (p && state.phase !== "bidding") return;
    state.paused = p;
    el.overlayPause.classList.toggle("hidden", !p);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.phase === "bidding") setPaused(true);
  });

  /* ------------------------------------------------------------------ *
   *  input
   * ------------------------------------------------------------------ */
  function primaryAction() {
    if (!el.overlayTitle.classList.contains("hidden")) {
      startGame();
    } else if (!el.overlayEnd.classList.contains("hidden")) {
      ensureAudio();
      newNight();
    } else if (state.paused) {
      setPaused(false);
    } else if (state.phase === "bidding") {
      playerBid();
    }
  }

  function startGame() {
    ensureAudio();
    newNight();
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    // let a focused button handle Enter/Space itself so actions don't fire twice
    if (
      (e.key === "Enter" || e.key === " ") &&
      e.target &&
      e.target.tagName === "BUTTON"
    ) {
      return;
    }
    const k = e.key.toLowerCase();
    if (k === " " || k === "enter" || k === "b") {
      e.preventDefault();
      primaryAction();
    } else if (k === "x") {
      e.preventDefault();
      playerPass();
    } else if (k === "p") {
      e.preventDefault();
      if (state.paused) setPaused(false);
      else setPaused(true);
    } else if (k === "r") {
      e.preventDefault();
      if (!el.overlayTitle.classList.contains("hidden")) startGame();
      else newNight();
    } else if (k === "m") {
      toggleMute();
    }
  });

  function bindClick(btn, fn) {
    btn.addEventListener("click", () => {
      ensureAudio();
      if (document.activeElement && document.activeElement.blur)
        document.activeElement.blur();
      fn();
    });
  }

  bindClick(el.bidBtn, playerBid);
  bindClick(el.passBtn, playerPass);
  bindClick(el.startBtn, startGame);
  bindClick(el.restartBtn, newNight);
  bindClick(el.resumeBtn, () => setPaused(false));

  /* ------------------------------------------------------------------ *
   *  rival cards
   * ------------------------------------------------------------------ */
  function buildRivalCards() {
    el.rivals.innerHTML = "";
    rivals.forEach((r) => {
      const li = document.createElement("li");
      li.className = "rival idle";
      const portrait = document.createElement("span");
      portrait.className = "portrait";
      portrait.innerHTML = ICON_OPEN + r.def.portrait + "</svg>";
      const who = document.createElement("span");
      who.className = "who";
      const nameRow = document.createElement("span");
      nameRow.className = "r-name";
      const nm = document.createElement("span");
      nm.textContent = r.def.name;
      const purse = document.createElement("span");
      purse.className = "r-purse";
      nameRow.appendChild(nm);
      nameRow.appendChild(purse);
      const status = document.createElement("span");
      status.className = "r-status";
      const quirk = document.createElement("p");
      quirk.className = "r-quirk";
      quirk.textContent = r.def.quirk;
      const bubble = document.createElement("span");
      bubble.className = "bubble";
      who.appendChild(nameRow);
      who.appendChild(status);
      who.appendChild(quirk);
      li.appendChild(portrait);
      li.appendChild(who);
      li.appendChild(bubble);
      el.rivals.appendChild(li);
      r.el = { card: li, purse, status, bubble };
      r.purse = r.def.purse;
    });
  }

  /* ------------------------------------------------------------------ *
   *  boot
   * ------------------------------------------------------------------ */
  try {
    state.muted = localStorage.getItem("going-once-muted") === "1";
  } catch (err) {
    state.muted = false;
  }
  rivals = RIVAL_DEFS.map((def) => ({
    ...def,
    def,
    purse: def.purse,
    out: false,
    el: null,
  }));

  buildRivalCards();
  renderPurse();
  renderHint();
  requestAnimationFrame(frame);
})();
