/* ============================================================
   ZEROCAP · golf stat tracker
   Design goal: minimum input per hole, maximum insight after.
   Per hole you tap: score, putts, fairway, penalties.
   GIR, 3-putts, up-and-downs are DERIVED, not entered.
   ============================================================ */

/* ---------- Storage ---------- */
const DB = {
  key: 'grind.v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || this.fresh(); }
    catch { return this.fresh(); }
  },
  save(s) { localStorage.setItem(this.key, JSON.stringify(s)); },
  fresh() {
    return {
      profile: { name: '', goal: '85', startCap: null, weak: null, onboarded: false }, // goal tier + self-reported starting point
      rounds: [],                            // completed rounds
      practice: [],                          // logged range/practice sessions
      courses: {},                           // per-course GPS map: { key: { holes: { n: {tee,green} } } }
      draft: null                            // in-progress round
    };
  }
};
let S = DB.load();
if (!S.practice) S.practice = [];            // migrate older saves
if (!S.courses) S.courses = {};
const persist = () => DB.save(S);

/* ---------- Helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const uid = () => 'r' + (S.rounds.length + 1) + '_' + (S._c = (S._c || 0) + 1);
const gid = (p) => p + '_' + (S._c = (S._c || 0) + 1);   // generic id (sessions etc.)

// standard 18-hole par template (par 72) — user can tweak each hole
const PAR_TEMPLATE = [4,4,5,3,4,4,3,5,4, 4,3,4,5,4,4,3,4,5];

function relStr(n) {
  if (n === 0) return 'E';
  return n > 0 ? '+' + n : '' + n;
}
function relClass(n) { return n > 0 ? 'over' : n < 0 ? 'under' : 'even'; }

/* Goal tier benchmarks (per 18 holes). Rough targets by ability. */
const TIERS = {
  '95': { label: 'Break 95',  fir:.35, gir:.17, putts:35, scramble:.15, pen:3.5 },
  '90': { label: 'Break 90',  fir:.42, gir:.28, putts:33, scramble:.22, pen:2.5 },
  '85': { label: 'Break 85',  fir:.50, gir:.39, putts:32, scramble:.30, pen:1.8 },
  '80': { label: 'Break 80',  fir:.57, gir:.50, putts:30, scramble:.42, pen:1.2 },
  'scr':{ label: 'Scratch',   fir:.62, gir:.61, putts:29, scramble:.55, pen:0.7 },
};

/* Focus areas — shared by Coach (leaks) and Range (practice). */
const FOCUS = {
  tee:      { label: 'Off the tee', icon: '🚀', blurb: 'driving & accuracy' },
  approach: { label: 'Approach',    icon: '🎯', blurb: 'irons & hitting greens' },
  short:    { label: 'Short game',  icon: '⛳', blurb: 'chipping & pitching' },
  putting:  { label: 'Putting',     icon: '🥅', blurb: 'on the greens' },
};

/* Structured, scoreable drills. result out of `max`; `target` is a "good" score. */
const DRILLS = {
  tee: [
    { key:'gate',  name:'Fairway Gate',  max:10, target:6, desc:'Pick two targets ~30 yds apart as your fairway. 10 drives — count how many finish between them.' },
    { key:'shape', name:'Shape Control', max:10, target:6, desc:'On each ball, call "start left" or "start right" before you swing. 10 balls — count how many obeyed.' },
  ],
  approach: [
    { key:'ladder', name:'Wedge Ladder', max:9,  target:5, desc:'3 balls each to 50 / 75 / 100 yds. Count how many finish within ~15 ft (out of 9).' },
    { key:'green',  name:'Hit the Green', max:10, target:5, desc:'Pick a green-sized target. 10 approach shots — count how many "hit the green".' },
  ],
  short: [
    { key:'updown',  name:'Up-&-Down Ladder', max:10, target:5, desc:'10 chips from 10–20 yds. Count how many finish within a putter length (a makeable up-and-down).' },
    { key:'landing', name:'Landing Spot',      max:10, target:5, desc:'Drop a towel as a landing spot. 10 chips — count how many land on it.' },
  ],
  putting: [
    { key:'circle', name:'Make Circle', max:15, target:12, desc:'15 putts from ~4 ft around the hole. Count total makes.' },
    { key:'lag',    name:'Lag Ladder',  max:6,  target:4,  desc:'6 putts from 30–40 ft. Count how many finish inside 3 ft (tap-in range).' },
    { key:'gate',   name:'Gate Drill',  max:10, target:8,  desc:'Two tees just wider than the ball, 3 ft ahead. 10 putts through the gate.' },
  ],
};
function drillByKey(focus, key) { return (DRILLS[focus] || []).find(d => d.key === key); }

/* ============================================================
   DERIVED per-hole facts
   ============================================================ */
function holeFacts(h) {
  // h: {par, score, putts, fir: 'hit'|'left'|'right'|null, pen}
  const par = h.par, score = h.score, putts = h.putts ?? 0;
  const strokesToGreen = score - putts;             // shots used to reach green
  const gir = strokesToGreen <= (par - 2);          // green in regulation
  const threePutt = putts >= 3;
  const isDriveHole = par >= 4;                      // fairway only matters par4/5
  const firHit = h.fir === 'hit';
  const scrambleOpp = !gir;                          // missed green
  const scrambleWin = !gir && score <= par;         // got up & down
  return { par, score, putts, gir, threePutt, isDriveHole, firHit, fir: h.fir, scrambleOpp, scrambleWin, pen: h.pen || 0, toPar: score - par };
}

/* ============================================================
   AGGREGATE stats across a set of rounds
   ============================================================ */
function aggregate(rounds) {
  if (!rounds.length) return null;
  let holes = 0, totPutts = 0, girN = 0, firN = 0, firDen = 0,
      threeP = 0, scrOpp = 0, scrWin = 0, pen = 0, toPar = 0, roundToPar = [];

  for (const r of rounds) {
    let rTP = 0, rHoles = r.holes.length;
    for (const h of r.holes) {
      const f = holeFacts(h);
      holes++; totPutts += f.putts; toPar += f.toPar; rTP += f.toPar;
      if (f.gir) girN++;
      if (f.isDriveHole) { firDen++; if (f.firHit) firN++; }
      if (f.threePutt) threeP++;
      if (f.scrambleOpp) { scrOpp++; if (f.scrambleWin) scrWin++; }
      pen += f.pen;
    }
    // normalize a 9-hole round's to-par isn't scaled; store per-round to-par as played
    roundToPar.push({ tp: rTP, holes: rHoles, date: r.date, id: r.id });
  }
  const per18 = (x) => holes ? (x / holes) * 18 : 0;
  return {
    rounds: rounds.length,
    holes,
    scoringAvg18: per18(toPar),          // avg strokes over par per 18
    firPct: firDen ? firN / firDen : 0,
    girPct: holes ? girN / holes : 0,
    puttsPer18: per18(totPutts),
    threePuttPct: holes ? threeP / holes : 0,
    scramblePct: scrOpp ? scrWin / scrOpp : 0,
    penPer18: per18(pen),
    roundToPar,
    _raw: { girRate: holes ? girN/holes : 0, missedGirPer18: per18(holes - girN) }
  };
}

/* ============================================================
   STROKES-LOST engine  (rough estimate vs goal tier)
   Returns strokes lost per 18 by category.
   ============================================================ */
function strokesLost(stats, tierKey) {
  const t = TIERS[tierKey] || TIERS['85'];
  const fairwayHoles = 14;  // approx driving holes / 18
  const missedGir18 = Math.max(0, 18 - stats.girPct * 18);

  // Off the tee: penalties cost ~1 each; fairway misses vs goal cost a fraction
  const tee = stats.penPer18 * 0.9
            + Math.max(0, (t.fir - stats.firPct)) * fairwayHoles * 0.28;

  // Approach: each GIR under goal ~0.55 strokes
  const approach = Math.max(0, (t.gir - stats.girPct)) * 18 * 0.55;

  // Short game: missed up-and-downs vs goal, ~0.5 stroke each on missed greens
  const short = Math.max(0, (t.scramble - stats.scramblePct)) * missedGir18 * 0.5;

  // Putting: extra putts vs goal (direct)
  const putting = Math.max(0, stats.puttsPer18 - t.putts);

  const cats = [
    { key: 'tee', label: 'Off the tee', v: tee },
    { key: 'approach', label: 'Approach', v: approach },
    { key: 'short', label: 'Short game', v: short },
    { key: 'putting', label: 'Putting', v: putting },
  ];
  const total = cats.reduce((a, c) => a + c.v, 0);
  cats.sort((a, b) => b.v - a.v);
  return { cats, total, tier: t };
}

/* ============================================================
   HANDICAP (the "cap") — WHS-style estimate
   Score Differential = (AGS − Course Rating) × 113 / Slope.
   With no rating/slope entered we default rating=par, slope=113,
   so a differential collapses to score-to-par (a fair estimate).
   Index = average of the best N of last 20, per the WHS table.
   ============================================================ */
function roundDifferential(r) {
  const total = r.holes.reduce((a, h) => a + h.score, 0);
  const par = r.holes.reduce((a, h) => a + h.par, 0);
  const rating = (r.rating != null) ? r.rating : par;
  const slope = (r.slope != null && r.slope > 0) ? r.slope : 113;
  let diff = (total - rating) * 113 / slope;
  if (r.holes.length <= 9) diff *= 2;         // rough 18-hole equivalent
  return diff;
}
// WHS table: how many of the lowest differentials to use, + adjustment
function whsUsed(n) {
  if (n < 3) return null;
  const T = { 3:[1,-2], 4:[1,-1], 5:[1,0], 6:[2,-1], 7:[2,0], 8:[2,0],
    9:[3,0], 10:[3,0], 11:[3,0], 12:[4,0], 13:[4,0], 14:[4,0],
    15:[5,0], 16:[5,0], 17:[6,0], 18:[6,0], 19:[7,0], 20:[8,0] };
  const row = T[Math.min(n, 20)];
  return { count: row[0], adj: row[1] };
}
function handicapFrom(diffs) {
  const recent = diffs.slice(-20);
  const u = whsUsed(recent.length);
  if (!u) return null;
  const lowest = [...recent].sort((a, b) => a - b).slice(0, u.count);
  const avg = lowest.reduce((a, b) => a + b, 0) / lowest.length;
  return Math.round((avg + u.adj) * 10) / 10;
}
function capState() {
  const diffs = S.rounds.map(roundDifferential);
  const index = handicapFrom(diffs);
  if (index == null) {
    const sc = (S.profile.startCap != null) ? S.profile.startCap : null;
    return { established: false, selfReported: sc != null, index: sc, roundsNeeded: Math.max(1, 3 - S.rounds.length) };
  }
  const prev = S.rounds.length > 3 ? handicapFrom(diffs.slice(0, -1)) : null;
  const trend = (prev != null) ? Math.round((index - prev) * 10) / 10 : null;
  return { established: true, index, trend };
}
function capHistory() {                        // cap recomputed after each round (>=3)
  const diffs = S.rounds.map(roundDifferential);
  const hist = [];
  for (let i = 3; i <= diffs.length; i++) {
    const v = handicapFrom(diffs.slice(0, i));
    if (v != null) hist.push(v);
  }
  return hist;
}
function fmtCap(idx) {
  if (idx == null) return '—';
  return idx < 0 ? '+' + Math.abs(idx).toFixed(1) : idx.toFixed(1);   // "+" = plus handicap
}
// Compare a round to the player's cap and hand out praise or grief.
function roundCallout(r) {
  const cap = capState();
  if (cap.index == null) return null;
  const diff = roundDifferential(r);
  const over = diff - cap.index;                 // + means worse than cap
  const capStr = fmtCap(cap.index);
  const played = diff.toFixed(1);
  if (over >= 4)    return { tone: 'bad',  msg: `Oof. That one played to <b>${played}</b> — well above your <b>${capStr}</b> cap. 👀 The cap doesn't lie. Get to the Range.` };
  if (over >= 1.5)  return { tone: 'warn', msg: `That played to <b>${played}</b>, a bit over your <b>${capStr}</b> cap. Shake it off and grind it back.` };
  if (over <= -1.5) return { tone: 'good', msg: `🔥 <b>${played}</b> — better than your <b>${capStr}</b> cap. Keep that up and it's dropping.` };
  return { tone: 'good', msg: `Right around your <b>${capStr}</b> cap. Steady golf.` };
}
function calloutCard(c) {
  if (!c) return '';
  const col = c.tone === 'bad' ? 'var(--red)' : c.tone === 'warn' ? 'var(--gold)' : 'var(--green-lt)';
  return `<div class="card" style="border-color:${col}"><div style="font-size:15px;line-height:1.5">${c.msg}</div></div>`;
}
function capSpark(hist) {
  if (hist.length < 2) return '';
  const show = hist.slice(-14);
  const min = Math.min(...show), max = Math.max(...show), range = (max - min) || 1;
  const bars = show.map((v, i, arr) => {
    const h = 10 + ((max - v) / range) * 42;   // invert: lower cap = taller = improvement grows
    const last = i === arr.length - 1;
    return `<div style="flex:1;display:flex;align-items:flex-end"><div style="width:100%;height:${h}px;background:${last ? 'var(--green-lt)' : 'var(--card-2)'};border-radius:3px"></div></div>`;
  }).join('');
  return `<div style="display:flex;gap:3px;align-items:flex-end;height:56px;margin:12px 0 6px">${bars}</div>`;
}

/* ============================================================
   ROUTER
   ============================================================ */
let TAB = 'home';
let flashRoundId = null;   // id of a just-saved round, to show its callout once on Home
function go(tab) {
  TAB = tab;
  if (tab !== 'play') stopGeo();          // don't burn battery off the course
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}
document.querySelectorAll('#tabbar button').forEach(b =>
  b.addEventListener('click', () => go(b.dataset.tab)));

function render() {
  if (TAB === 'home') return viewHome();
  if (TAB === 'onboard') return viewOnboard();
  if (TAB === 'rounds') return viewRounds();
  if (TAB === 'play') return viewPlay();
  if (TAB === 'range') return viewRange();
  if (TAB === 'coach') return viewCoach();
  if (TAB === 'settings') return viewSettings();
}

function header(title, sub) {
  return `<div class="hd"><div class="brand">
      <div class="mark">⛳</div>
      <div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    </div></div>`;
}

/* ============================================================
   VIEW: ONBOARD (ask cap first, then generalize the game)
   ============================================================ */
let ONBOARD = null;
const CAP_LEVELS = [
  ['Beginner', 'new · 25+', '25'],
  ['High', 'high teens · ~18', '18'],
  ['Mid', 'low teens · ~12', '12'],
  ['Low', 'single digits · ~6', '6'],
  ['Scratch', 'even par · 0', '0'],
  ['Plus', 'better than scratch · +2', '-2'],
];
function goalFromCap(c) { return c >= 18 ? '95' : c >= 12 ? '90' : c >= 8 ? '85' : c >= 4 ? '80' : 'scr'; }

function viewOnboard() {
  if (!ONBOARD) ONBOARD = { cap: (S.profile.startCap != null ? String(S.profile.startCap) : ''), weak: S.profile.weak || null };
  const O = ONBOARD;
  app.innerHTML = header('Set up', 'so Coach can help from day one') + `
    <div class="card">
      <h3>1 · Your current cap</h3>
      <div class="hint" style="margin-bottom:12px">Pick the level that fits you — or type your exact handicap below.</div>
      <div class="focus-grid">
        ${CAP_LEVELS.map(([lbl,sub,v]) => `
          <button class="focus-tile ${String(O.cap)===v?'on':''}" onclick="obSetLevel('${v}')">
            <div class="ft-label">${lbl}</div><div class="ft-blurb">${sub}</div></button>`).join('')}
      </div>
      <div class="field" style="margin:18px 0 0">
        <label style="font-size:14px">Know your exact handicap? Type it</label>
        <input id="obCap" type="number" inputmode="decimal" value="${O.cap}" placeholder="e.g. 14.5"
          oninput="obTypeCap(this.value)"
          style="width:100%;font-size:26px;font-weight:700;text-align:center;padding:18px 16px;border-radius:14px"/>
      </div>
    </div>
    <div class="card">
      <h3>2 · Your weak spot</h3>
      <div class="hint" style="margin-bottom:12px">Which part of your game costs you most? Coach will start there.</div>
      <div class="focus-grid">
        ${Object.entries(FOCUS).map(([k,f]) => `
          <button class="focus-tile ${O.weak===k?'on':''}" onclick="obSetWeak('${k}')">
            <div class="ft-label">${f.label}</div><div class="ft-blurb">${f.blurb}</div></button>`).join('')}
      </div>
    </div>
    <button class="btn" onclick="obSave()">Save & continue →</button>
    <div style="height:10px"></div>
    <button class="btn ghost sm" onclick="obSkip()">Skip — I'll just log rounds</button>`;
}
function obSetLevel(v) { ONBOARD.cap = v; render(); }
function obTypeCap(v) {                     // typing an exact value re-lights matching tile (or none)
  const wasPreset = CAP_LEVELS.some(l => l[2] === String(ONBOARD.cap));
  ONBOARD.cap = v;
  if (wasPreset || CAP_LEVELS.some(l => l[2] === String(v))) render();   // only re-render when tile-lit state changes
}
function obSetWeak(k) { ONBOARD.weak = (ONBOARD.weak === k ? null : k); render(); }
function obSave() {
  const c = parseFloat(ONBOARD.cap);
  S.profile.startCap = isFinite(c) ? c : null;
  S.profile.weak = ONBOARD.weak || null;
  S.profile.onboarded = true;
  if (S.profile.startCap != null) S.profile.goal = goalFromCap(S.profile.startCap);
  ONBOARD = null; persist(); go('home');
}
function obSkip() { S.profile.onboarded = true; ONBOARD = null; persist(); go('home'); }

/* ============================================================
   VIEW: HOME / STATS
   ============================================================ */
function viewHome() {
  const st = aggregate(S.rounds);
  if (!st) {
    const cap = capState();
    // Brand-new: welcome → onboarding
    if (!S.profile.onboarded && S.profile.startCap == null) {
      app.innerHTML = header('ZeroCap', 'play to zero') + `
        <div class="empty">
          <div class="big-ico">⛳</div>
          <h2>Welcome to ZeroCap</h2>
          <p>Let's set your starting cap and get a read on your game — 20 seconds — so Coach can help before your very first round.</p>
          <button class="btn" onclick="go('onboard')">Set up my game →</button>
          <div style="height:12px"></div>
          <button class="btn ghost sm" onclick="loadSample()">Explore with sample data</button>
        </div>`;
      return;
    }
    // Onboarded but no rounds yet: show self-reported starting cap + a seeded plan
    const weak = S.profile.weak ? FOCUS[S.profile.weak] : null;
    app.innerHTML = header('Your Stats', 'starting point') + `
      <div class="hero">
        <div class="cap" style="margin-bottom:2px;letter-spacing:1.5px">STARTING CAP</div>
        <div class="big">${fmtCap(cap.index)}</div>
        <div class="cap">self-reported · log a round to start tracking for real</div>
      </div>
      ${weak ? `<div class="card" style="border-color:var(--gold)">
        <h3>Where to start</h3>
        <div style="font-size:16px">You said <b>${weak.label}</b> is your weak spot. Warm it up, then log a round so Coach can confirm it with real data.</div>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn" onclick="go('play')">Log a round</button>
          <button class="btn ghost" onclick="startSession('${S.profile.weak}')">Practice ${weak.label}</button>
        </div>
      </div>` : `<button class="btn" onclick="go('play')">Log your first round ⛳</button>`}
      <div class="pill-note" style="margin-top:14px">Your real cap starts computing after 3 logged rounds and replaces this self-reported number.</div>`;
    return;
  }
  const sl = strokesLost(st, S.profile.goal);
  const focus = sl.cats[0];
  const last = S.rounds[S.rounds.length - 1];
  const lastTP = last.holes.reduce((a, h) => a + (h.score - h.par), 0);
  const cap = capState();
  const hist = capHistory();
  const hasRatings = S.rounds.some(r => r.rating != null);
  const flashed = flashRoundId && last.id === flashRoundId;
  flashRoundId = null;                                   // consume — only show once
  const callout = flashed ? roundCallout(last) : null;

  const capSub = !cap.established
    ? `log ${cap.roundsNeeded} more round${cap.roundsNeeded > 1 ? 's' : ''} for your first cap`
    : cap.trend == null ? 'your estimated handicap'
    : cap.trend < 0 ? `estimated handicap · <span style="color:#7be8a8">▼ ${Math.abs(cap.trend).toFixed(1)} improving</span>`
    : cap.trend > 0 ? `estimated handicap · <span style="color:#ffb3a3">▲ ${cap.trend.toFixed(1)}</span>`
    : 'estimated handicap · holding steady';

  app.innerHTML = header('Your Stats', `${st.rounds} round${st.rounds>1?'s':''} logged`) + `
    <div class="hero">
      <div class="cap" style="margin-bottom:2px;letter-spacing:1.5px">${cap.established ? 'ESTIMATED CAP' : 'YOUR CAP'}</div>
      <div class="big">${fmtCap(cap.index)}</div>
      <div class="cap">${capSub}</div>
    </div>

    ${calloutCard(callout)}

    ${cap.established && hist.length >= 2 ? `<div class="card">
      <h3>Cap trend · last ${Math.min(hist.length, 14)} rounds</h3>
      ${capSpark(hist)}
      <div class="hint">${cap.index > 0 ? `<b>${cap.index.toFixed(1)}</b> to scratch. ` : `You're at scratch or better 🏆 `}Best 8 of your last 20 (WHS-style). ${hasRatings ? '' : 'Add course rating & slope when you play for sharper numbers.'}</div>
    </div>` : ''}

    <div class="card" style="border-color:var(--gold)">
      <h3>Biggest leak vs ${sl.tier.label}</h3>
      <div style="display:flex;align-items:baseline;gap:10px">
        <div style="font-size:22px;font-weight:800">${focus.label}</div>
        <div style="color:var(--gold);font-weight:700">-${focus.v.toFixed(1)} shots / round</div>
      </div>
      <div class="hint">This is where you're bleeding the most strokes. Open <b>Coach</b> for the full breakdown & a practice focus.</div>
    </div>

    <div class="section-title">The numbers</div>
    <div class="grid">
      <div class="stat"><div class="v">${st.scoringAvg18 >= 0 ? '+' : ''}${st.scoringAvg18.toFixed(1)}</div><div class="l">Avg to par</div></div>
      <div class="stat"><div class="v">${last.holes.reduce((a,h)=>a+h.score,0)}</div><div class="l">Last score</div></div>
      ${statCard(pct(st.firPct), 'Fairways', st.firPct, TIERS[S.profile.goal].fir)}
      ${statCard(pct(st.girPct), 'Greens (GIR)', st.girPct, TIERS[S.profile.goal].gir)}
      ${statCard(st.puttsPer18.toFixed(1), 'Putts / round', st.puttsPer18, TIERS[S.profile.goal].putts, true)}
      ${statCard(pct(st.scramblePct), 'Scrambling', st.scramblePct, TIERS[S.profile.goal].scramble)}
      ${statCard(pct(st.threePuttPct), '3-putt %', st.threePuttPct, 0.06, true)}
      ${statCard(st.penPer18.toFixed(1), 'Penalties / rd', st.penPer18, TIERS[S.profile.goal].pen, true)}
    </div>

    <div class="section-title">Last round</div>
    <div class="round-item">
      <div>
        <div class="score">${last.holes.reduce((a,h)=>a+h.score,0)}</div>
        <div class="meta">${last.course || 'Round'} · ${fmtDate(last.date)}</div>
      </div>
      <div class="rel ${relClass(lastTP)}">${relStr(lastTP)}</div>
    </div>`;
}

function pct(x) { return Math.round(x * 100) + '%'; }
// display, label, ACTUAL value, TARGET value, lowerIsBetter
function statCard(display, label, actual, target, lower = false) {
  let cls = 'flat', txt = 'on goal';
  const better = lower ? actual < target : actual > target;
  const rel = Math.abs(actual - target) / (Math.abs(target) || 1);
  if (rel > 0.05) {                       // >5% off goal is meaningful, works for %s and counts
    if (better) { cls = 'up'; txt = '▲ ahead of goal'; }
    else { cls = 'down'; txt = '▼ behind goal'; }
  }
  return `<div class="stat"><div class="v">${display}</div>
    <div class="l">${label}</div><div class="t ${cls}">${txt}</div></div>`;
}

/* ============================================================
   PRACTICE analytics (shared by Range + Coach)
   ============================================================ */
function practiceSummary() {
  const now = Date.now();
  const week = S.practice.filter(s => (now - new Date(s.date).getTime()) < 7 * 864e5);
  const byFocus = {};
  S.practice.forEach(s => { byFocus[s.focus] = (byFocus[s.focus] || 0) + 1; });
  let mostFocus = null, mostN = 0;
  for (const k in byFocus) if (byFocus[k] > mostN) { mostN = byFocus[k]; mostFocus = k; }
  return { total: S.practice.length, week: week.length, byFocus, mostFocus };
}
function drillProgress() {
  const groups = {};
  S.practice.filter(s => s.drillKey && s.result != null).forEach(s => {
    const id = s.focus + ':' + s.drillKey;
    (groups[id] = groups[id] || { focus: s.focus, drillName: s.drillName, max: s.max, target: s.target, logs: [] }).logs.push(s);
  });
  return Object.values(groups).map(g => {
    g.logs.sort((a, b) => new Date(a.date) - new Date(b.date));
    g.first = g.logs[0].result;
    g.last = g.logs[g.logs.length - 1].result;
    g.best = Math.max(...g.logs.map(l => l.result));
    g.count = g.logs.length;
    g.trend = g.count > 1 ? g.last - g.first : 0;
    return g;
  }).sort((a, b) => b.count - a.count);
}

/* ============================================================
   VIEW: RANGE (log practice sessions)
   ============================================================ */
let RANGE = null;   // in-progress logging flow (transient, not persisted)

function viewRange() {
  if (RANGE) return renderRangeLog();

  const st = aggregate(S.rounds);
  const leak = st ? strokesLost(st, S.profile.goal).cats[0] : null;
  const sum = practiceSummary();

  let banner = '';
  if (leak && leak.v > 0.1) {
    banner = `<div class="card" style="border-color:var(--gold)">
      <h3>🎯 Coach says</h3>
      <div style="font-size:16px;margin-bottom:10px">Your biggest leak is <b>${leak.label}</b> (-${leak.v.toFixed(1)} shots/round). Warm it up before you play.</div>
      <button class="btn" onclick="startSession('${leak.key}')">Practice ${leak.label} →</button>
    </div>`;
  }

  const sessions = [...S.practice].reverse().slice(0, 12).map(sessItem).join('');
  const list = S.practice.length
    ? `<div class="section-title">Recent sessions</div>${sessions}`
    : `<div class="empty" style="padding:30px 10px"><div class="big-ico">🪣</div>
        <h2>No practice logged</h2><p>Log what you work on at the range. Tie it to your leaks and watch your drill scores climb.</p></div>`;

  app.innerHTML = header('Range', 'practice with purpose') + banner + `
    <button class="btn" onclick="startSession(null)">+ Log a practice session</button>
    ${S.practice.length ? `<div class="grid three" style="margin-top:14px">
      <div class="stat"><div class="v">${sum.total}</div><div class="l">sessions</div></div>
      <div class="stat"><div class="v">${sum.week}</div><div class="l">this week</div></div>
      <div class="stat"><div class="v">${sum.mostFocus ? FOCUS[sum.mostFocus].icon : '–'}</div><div class="l">most practiced</div></div>
    </div>` : ''}
    ${list}`;
}

function sessItem(s) {
  const f = FOCUS[s.focus] || { icon: '⛳', label: s.focus };
  const badge = s.result != null
    ? `<div class="rel ${s.result >= (s.target ?? 0) ? 'under' : 'over'}">${s.result}/${s.max}</div>`
    : `<div class="rel even">${s.minutes ? s.minutes + 'm' : '—'}</div>`;
  return `<div class="round-item">
    <div><div style="font-size:16px;font-weight:700">${f.icon} ${s.drillName}</div>
      <div class="meta">${f.label} · ${fmtDate(s.date)}${s.rating ? ' · ' + '★'.repeat(s.rating) : ''}</div></div>
    ${badge}</div>`;
}

function startSession(focus) {
  RANGE = { step: focus ? 'drill' : 'focus', focus: focus || null, drill: null, freeform: false, result: 0, minutes: 20, rating: 0, notes: '' };
  go('range');
}
function logDrill(focus, key) {   // deep-link from Coach straight to a drill result
  const d = drillByKey(focus, key);
  RANGE = { step: 'result', focus, drill: key, freeform: false, result: Math.round(d.max / 2), minutes: 20, rating: 0, notes: '' };
  go('range');
}
function rangePickFocus(f) { RANGE.focus = f; RANGE.step = 'drill'; render(); }
function rangePickDrill(key) {
  if (key === '') { RANGE.freeform = true; RANGE.drill = null; RANGE.result = null; }
  else { RANGE.freeform = false; RANGE.drill = key; RANGE.result = Math.round(drillByKey(RANGE.focus, key).max / 2); }
  RANGE.step = 'result'; render();
}
function rangeBump(field, delta, min, max) {
  RANGE[field] = Math.max(min, Math.min(max, (RANGE[field] || 0) + delta)); render();
}
function rangeRating(r) { RANGE.rating = (RANGE.rating === r ? 0 : r); render(); }
function rangeNotes(v) { RANGE.notes = v; }   // no re-render on keystroke
function rangeBack() {
  if (RANGE.step === 'result') { RANGE.step = 'drill'; render(); }
  else if (RANGE.step === 'drill') { RANGE.step = 'focus'; RANGE.focus = null; render(); }
  else { RANGE = null; render(); }
}
function rangeCancel() { RANGE = null; render(); }
function rangeSave() {
  const d = RANGE.drill ? drillByKey(RANGE.focus, RANGE.drill) : null;
  S.practice.push({
    id: gid('s'), date: new Date().toISOString(), focus: RANGE.focus,
    drillKey: RANGE.drill || null, drillName: d ? d.name : 'Range session',
    result: d ? RANGE.result : null, max: d ? d.max : null, target: d ? d.target : null,
    minutes: RANGE.freeform ? RANGE.minutes : null,
    rating: RANGE.rating || null, notes: (RANGE.notes || '').trim()
  });
  persist(); RANGE = null;
  go('range');
}

function renderRangeLog() {
  const r = RANGE;
  // STEP 1: choose focus
  if (r.step === 'focus') {
    app.innerHTML = header('Log session', 'what did you work on?') + `
      <div class="focus-grid">
        ${Object.entries(FOCUS).map(([k, f]) => `
          <button class="focus-tile" onclick="rangePickFocus('${k}')">
            <div class="ft-label">${f.label}</div><div class="ft-blurb">${f.blurb}</div></button>`).join('')}
      </div>
      <button class="btn ghost" onclick="rangeCancel()">Cancel</button>`;
    return;
  }
  const f = FOCUS[r.focus];
  // STEP 2: choose drill
  if (r.step === 'drill') {
    app.innerHTML = header(f.label, 'pick a drill — or just hit balls') + `
      ${DRILLS[r.focus].map(d => `
        <div class="drill-card" onclick="rangePickDrill('${d.key}')">
          <div class="dc-top"><b>${d.name}</b><span class="chip good">good: ${d.target}/${d.max}</span></div>
          <div class="dc-desc">${d.desc}</div>
        </div>`).join('')}
      <div class="drill-card" onclick="rangePickDrill('')">
        <div class="dc-top"><b>🪣 Just hit balls</b></div>
        <div class="dc-desc">Freeform session — log time & how it felt.</div>
      </div>
      <button class="btn ghost" onclick="rangeBack()">← Back</button>`;
    return;
  }
  // STEP 3: result
  const d = r.drill ? drillByKey(r.focus, r.drill) : null;
  const stars = [1,2,3,4,5].map(n =>
    `<button class="star ${r.rating >= n ? 'on' : ''}" onclick="rangeRating(${n})">★</button>`).join('');

  app.innerHTML = header(d ? d.name : 'Range session', f.label) + `
    ${d ? `
      <div class="pill-note" style="margin-bottom:16px">${d.desc}</div>
      <div class="field"><label>Your score — how many out of ${d.max}?</label>
        <div class="stepper">
          <button onclick="rangeBump('result',-1,0,${d.max})">−</button>
          <div class="val">${r.result}<small>of ${d.max} · good is ${d.target}+</small></div>
          <button onclick="rangeBump('result',1,0,${d.max})">+</button>
        </div>
      </div>`
    : `
      <div class="field"><label>Time at the range</label>
        <div class="stepper">
          <button onclick="rangeBump('minutes',-5,0,300)">−</button>
          <div class="val">${r.minutes}<small>minutes</small></div>
          <button onclick="rangeBump('minutes',5,0,300)">+</button>
        </div>
      </div>`}

    <div class="field"><label>How'd it feel?</label>
      <div class="rating">${stars}</div></div>

    <div class="field"><label>Notes (optional)</label>
      <textarea id="rnotes" rows="2" placeholder="swing thoughts, what clicked..." oninput="rangeNotes(this.value)" style="width:100%;background:var(--card-2);color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-family:inherit;font-size:15px">${r.notes}</textarea></div>

    <div class="navbtns">
      <button class="btn ghost" onclick="rangeBack()">← Back</button>
      <button class="btn" onclick="rangeSave()">Save session ✓</button>
    </div>`;
}

/* ============================================================
   VIEW: COACH (strokes-lost breakdown + practice plan)
   ============================================================ */
function viewCoach() {
  const st = aggregate(S.rounds);
  if (!st) {
    const weakKey = S.profile.weak;
    if (weakKey) {
      const f = FOCUS[weakKey];
      app.innerHTML = header('Coach', 'starting plan') + `
        <div class="card" style="border-color:var(--gold)">
          <h3>🎯 Starting focus: ${f.label}</h3>
          <div class="hint" style="margin-bottom:14px">You told us this is your weak spot — here's where to start. Log a round and Coach confirms it with real strokes-lost data.</div>
          ${DRILLS[weakKey].map(d => `<div class="drill-card" onclick="logDrill('${weakKey}','${d.key}')">
            <div class="dc-top"><b>${d.name}</b><span class="chip good">good: ${d.target}/${d.max}</span></div>
            <div class="dc-desc">${d.desc}</div><div class="dc-log">Log at range →</div></div>`).join('')}
        </div>
        <button class="btn" onclick="go('play')">Log a round for full analysis</button>`;
      return;
    }
    app.innerHTML = header('Coach') + `<div class="empty"><div class="big-ico">🎯</div>
      <h2>Coach needs data</h2><p>Log a round or two and Coach will pinpoint exactly where you're losing strokes and what to practice. Or set your weak spot in <b>You → Your game</b>.</p>
      <button class="btn" onclick="go('play')">Log a round</button></div>`;
    return;
  }
  const sl = strokesLost(st, S.profile.goal);
  const max = Math.max(...sl.cats.map(c => c.v), 0.1);
  const focus = sl.cats[0];
  const sum = practiceSummary();
  const prog = drillProgress();

  // Are they practicing their biggest leak?
  let align;
  if (sum.total === 0) {
    align = `<div class="hint">You haven't logged any practice yet. Your fastest win: work on <b>${focus.label}</b>.</div>
      <button class="btn sm" style="margin-top:10px" onclick="startSession('${focus.key}')">Log a ${focus.label} session</button>`;
  } else if (sum.mostFocus === focus.key) {
    align = `<div class="hint">✅ Nice — most of your range time is going to <b>${focus.label}</b>, your biggest leak. Keep it up.</div>`;
  } else {
    align = `<div class="hint">⚠️ Most of your practice is on <b>${FOCUS[sum.mostFocus].label}</b>, but your biggest leak is <b>${focus.label}</b>. Rebalance to score faster.</div>`;
  }

  app.innerHTML = header('Coach', `goal: ${sl.tier.label}`) + `
    <div class="card">
      <h3>Where your strokes go</h3>
      <div class="hint" style="margin-bottom:14px">Estimated shots lost per round vs a <b>${sl.tier.label}</b> golfer. Total gap ≈ <b>${sl.total.toFixed(1)}</b> shots.</div>
      ${sl.cats.map(c => `
        <div class="bar-row">
          <div class="top"><b>${c.label}${c.key===focus.key?'<span class="focus-tag">FOCUS</span>':''}</b>
            <span class="n">-${c.v.toFixed(1)}</span></div>
          <div class="track"><div class="fill ${c.key}" style="width:${Math.max(4,(c.v/max)*100)}%"></div></div>
        </div>`).join('')}
    </div>

    <div class="card">
      <h3>🎯 Practice focus: ${focus.label}</h3>
      <div class="hint" style="margin-bottom:14px">Fixing this is your fastest path to lower scores. Tap a drill to log it at the range.</div>
      ${DRILLS[focus.key].map(d => `
        <div class="drill-card" onclick="logDrill('${focus.key}','${d.key}')">
          <div class="dc-top"><b>${d.name}</b><span class="chip good">good: ${d.target}/${d.max}</span></div>
          <div class="dc-desc">${d.desc}</div>
          <div class="dc-log">Log at range →</div>
        </div>`).join('')}
    </div>

    <div class="card">
      <h3>Your practice</h3>
      <div class="grid three" style="margin-bottom:12px">
        <div class="stat"><div class="v">${sum.total}</div><div class="l">sessions</div></div>
        <div class="stat"><div class="v">${sum.week}</div><div class="l">this week</div></div>
        <div class="stat"><div class="v">${sum.mostFocus ? FOCUS[sum.mostFocus].icon : '–'}</div><div class="l">most on</div></div>
      </div>
      ${align}
    </div>

    ${prog.length ? `<div class="card"><h3>Drill progress</h3>
      ${prog.map(g => {
        const arrow = g.count < 2 ? '' : g.trend > 0 ? `<span class="up">▲ +${g.trend}</span>` : g.trend < 0 ? `<span class="down">▼ ${g.trend}</span>` : `<span class="flat">→ 0</span>`;
        return `<div class="bar-row">
          <div class="top"><b>${FOCUS[g.focus].icon} ${g.drillName}</b>
            <span class="n">last ${g.last}/${g.max} · best ${g.best} ${arrow}</span></div>
          <div class="track"><div class="fill putting" style="width:${Math.max(4,(g.last/g.max)*100)}%"></div></div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="pill-note">Estimates get sharper the more rounds you log. Numbers are relative to your goal tier — change it under <b>You</b>.</div>`;
}

/* ============================================================
   GPS shot tracking (Phase 1)
   Phone marks its own position; distances via haversine.
   Greens/tees saved per course so distances return next round.
   ============================================================ */
let gpsOn = false;         // opt-in per session
let geoWatch = null;       // watchPosition id
let lastPos = null;        // { lat, lng, acc }

function metersBetween(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const toYards = m => m * 1.09361;

function startGeo() {
  if (!('geolocation' in navigator) || geoWatch != null) return;
  geoWatch = navigator.geolocation.watchPosition(
    p => { lastPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; updateGeoLive(); },
    () => { /* keep last fix; error surfaced in readout */ },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
}
function stopGeo() { if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; } }
function geoEnable() {
  if (!('geolocation' in navigator)) { alert('This device has no GPS.'); return; }
  gpsOn = true; startGeo(); renderHole();
}

function courseKey() { return ((S.draft && S.draft.course) || '(unnamed)').toLowerCase().trim() || '(unnamed)'; }
function courseHoleGeo(num) { const c = S.courses[courseKey()]; return (c && c.holes && c.holes[num]) || null; }
function saveCourseGeo(num, type, pos) {
  const ck = courseKey();
  const c = S.courses[ck] || (S.courses[ck] = { holes: {} });
  (c.holes[num] || (c.holes[num] = {}))[type] = { lat: pos.lat, lng: pos.lng };
  persist();
}
function greenForHole(h) {
  const gm = (h.marks || []).find(m => m.type === 'green');
  if (gm) return gm;
  const cg = courseHoleGeo(h.num);
  return (cg && cg.green) || null;
}
function geoMark(type) {
  if (!lastPos) { alert('No GPS fix yet — give it a few seconds to settle.'); return; }
  const h = curHole();
  (h.marks || (h.marks = [])).push({ type, lat: lastPos.lat, lng: lastPos.lng, acc: lastPos.acc });
  if (type === 'tee' || type === 'green') saveCourseGeo(h.num, type, lastPos);
  persist(); renderHole();
}
function geoUndo() {
  const h = curHole();
  if (h.marks && h.marks.length) { h.marks.pop(); persist(); renderHole(); }
}
// live-update just the readout between renders (no full re-render, keeps it smooth)
function updateGeoLive() {
  const el = document.getElementById('geoLive');
  if (!el || !S.draft || TAB !== 'play') return;
  const h = curHole(), green = greenForHole(h);
  const acc = lastPos ? Math.round(lastPos.acc) : null;
  const dtg = (green && lastPos) ? Math.round(toYards(metersBetween(lastPos, green))) : null;
  el.innerHTML = geoLiveInner(dtg, acc, green);
}
function geoLiveInner(dtg, acc, green) {
  const accCls = acc != null && acc <= 8 ? 'good' : acc != null && acc <= 15 ? '' : 'bad';
  const top = dtg != null
    ? `<b style="font-size:36px;letter-spacing:-1px">${dtg}</b> <span style="color:var(--muted)">yds to green</span>`
    : `<span class="hint">${green ? 'getting a fix…' : 'walk to the green and Mark it to unlock distances'}</span>`;
  return `${top}<div style="margin-top:6px"><span class="chip ${accCls}">GPS ${acc != null ? '±' + acc + 'm' : 'searching…'}</span></div>`;
}

function gpsPanel(h) {
  if (!gpsOn) {
    return `<div class="card"><button class="btn ghost" onclick="geoEnable()">📍 Track shots with GPS</button>
      <div class="hint" style="margin-top:8px;text-align:center">Live distance to the green + shot yardages. Optional.</div></div>`;
  }
  const marks = h.marks || [];
  const hasGreen = marks.some(m => m.type === 'green');
  const green = greenForHole(h);
  const acc = lastPos ? Math.round(lastPos.acc) : null;
  const dtg = (green && lastPos) ? Math.round(toYards(metersBetween(lastPos, green))) : null;

  // Stepped actions: tee → play → done. Only show the next relevant step.
  let actions;
  if (!marks.length) {
    actions = `<button class="btn" onclick="geoMark('tee')">Mark tee</button>`;
  } else if (hasGreen) {
    actions = `<div class="hint" style="text-align:center;font-size:14px">✓ Hole tracked — on to the next tee</div>`;
  } else {
    actions = `<button class="btn" onclick="geoMark('shot')">📍 At my ball</button>
      <div style="height:8px"></div>
      <button class="btn ghost sm" onclick="geoMark('green')">I'm on the green</button>`;
  }

  let shots = '';
  let shotNum = 0;
  for (let i = 1; i < marks.length; i++) {
    const yds = Math.round(toYards(metersBetween(marks[i-1], marks[i])));
    const label = marks[i].type === 'green' ? 'Approach → green' : `Shot ${++shotNum}`;
    shots += `<div class="row" style="padding:9px 0"><div class="lbl">${label}</div><div style="font-weight:700;font-variant-numeric:tabular-nums">${yds} yds</div></div>`;
  }

  return `<div class="card">
    <div id="geoLive" style="text-align:center;margin-bottom:14px">${geoLiveInner(dtg, acc, green)}</div>
    ${actions}
    ${marks.length ? `<div style="margin-top:10px">${shots}
      <div style="text-align:right;margin-top:4px"><button class="btn ghost sm" onclick="geoUndo()">Undo last mark</button></div></div>` : ''}
  </div>`;
}

/* ============================================================
   VIEW: PLAY (hole-by-hole entry)
   ============================================================ */
function newDraft() {
  return {
    id: uid(),
    date: new Date().toISOString(),
    course: '',
    rating: null, slope: null,
    holesCount: 18,
    idx: 0,
    holes: PAR_TEMPLATE.map((par, i) => ({ num: i + 1, par, score: par, putts: 2, fir: par >= 4 ? null : null, pen: 0 }))
  };
}

function viewPlay() {
  if (!S.draft) {
    app.innerHTML = header('Play') + `
      <div class="card">
        <h3>New round</h3>
        <div class="field"><label>Course (optional)</label>
          <input id="courseName" type="text" placeholder="e.g. Pine Valley" style="width:100%"/></div>
        <div class="field"><label>How many holes?</label>
          <div class="seg">
            <button class="on" id="h18" onclick="pickHoles(18)">18</button>
            <button id="h9" onclick="pickHoles(9)">9</button>
          </div></div>
        <div class="field"><label>Course rating & slope (optional — sharpens your cap)</label>
          <div style="display:flex;gap:10px">
            <input id="cRating" type="number" inputmode="decimal" placeholder="Rating (e.g. 71.2)" style="width:100%"/>
            <input id="cSlope" type="number" inputmode="numeric" placeholder="Slope (e.g. 128)" style="width:100%"/>
          </div></div>
        <button class="btn" onclick="startRound()">Start round ⛳</button>
      </div>
      <div class="pill-note">Par defaults to a standard layout — you can bump each hole's par in one tap as you play. Leave rating/slope blank and we'll estimate your cap from par.</div>`;
    return;
  }
  renderHole();
}

let _holesPick = 18;
function pickHoles(n) {
  _holesPick = n;
  $('#h18').classList.toggle('on', n === 18);
  $('#h9').classList.toggle('on', n === 9);
}
function startRound() {
  const d = newDraft();
  d.course = ($('#courseName')?.value || '').trim();
  const rating = parseFloat($('#cRating')?.value);
  const slope = parseInt($('#cSlope')?.value, 10);
  d.rating = isFinite(rating) ? rating : null;
  d.slope = isFinite(slope) ? slope : null;
  d.holesCount = _holesPick;
  if (_holesPick === 9) d.holes = d.holes.slice(0, 9);
  S.draft = d; persist();
  renderHole();
}

function renderHole() {
  const d = S.draft;
  const h = d.holes[d.idx];
  const f = holeFacts(h);
  const prog = ((d.idx) / d.holes.length) * 100;
  if (gpsOn) startGeo();

  app.innerHTML = `
    <div class="playtop">
      <div class="name">${d.course || 'Round'}</div>
      <button class="btn ghost sm" onclick="finishRound()">Finish</button>
    </div>
    <div class="progress"><span style="width:${prog}%"></span></div>

    <div class="holehdr">
      <div class="num">Hole ${h.num} of ${d.holes.length}</div>
      <div class="par">${h.score}<small> strokes</small></div>
    </div>

    ${gpsPanel(h)}

    <div class="field">
      <label>Par</label>
      <div class="seg">
        ${[3,4,5].map(p => `<button class="${h.par===p?'on':''}" onclick="setPar(${p})">Par ${p}</button>`).join('')}
      </div>
    </div>

    <div class="field">
      <label>Score</label>
      <div class="stepper">
        <button onclick="bump('score',-1)">−</button>
        <div class="val">${h.score}<small>${relStr(f.toPar)}</small></div>
        <button onclick="bump('score',1)">+</button>
      </div>
    </div>

    <div class="field">
      <label>Putts</label>
      <div class="stepper">
        <button onclick="bump('putts',-1)">−</button>
        <div class="val">${h.putts}<small>${f.threePutt?'3-putt':'&nbsp;'}</small></div>
        <button onclick="bump('putts',1)">+</button>
      </div>
    </div>

    ${h.par >= 4 ? `
    <div class="field">
      <label>Fairway</label>
      <div class="seg">
        <button class="${h.fir==='left'?'on miss':''}" onclick="setFir('left')">◀ Left</button>
        <button class="${h.fir==='hit'?'on':''}" onclick="setFir('hit')">Hit ✓</button>
        <button class="${h.fir==='right'?'on miss':''}" onclick="setFir('right')">Right ▶</button>
      </div>
    </div>` : ''}

    <div class="field">
      <label>Penalty strokes</label>
      <div class="stepper">
        <button onclick="bump('pen',-1)">−</button>
        <div class="val">${h.pen}</div>
        <button onclick="bump('pen',1)">+</button>
      </div>
    </div>

    <div class="derived">
      <span class="chip ${f.gir?'good':'bad'}">${f.gir?'GIR ✓':'Missed green'}</span>
      ${!f.gir ? `<span class="chip ${f.scrambleWin?'good':''}">${f.scrambleWin?'Up & down ✓':'Scramble'}</span>` : ''}
      ${f.threePutt ? `<span class="chip bad">3-putt</span>` : ''}
    </div>

    <div class="navbtns">
      <button class="btn ghost" onclick="prevHole()" ${d.idx===0?'disabled style=opacity:.4':''}>← Prev</button>
      <button class="btn" onclick="nextHole()">${d.idx === d.holes.length-1 ? 'Review ✓' : 'Next →'}</button>
    </div>`;
}

function curHole() { return S.draft.holes[S.draft.idx]; }
function setPar(p) {
  const h = curHole();
  const delta = p - h.par;
  h.par = p; h.score = Math.max(1, h.score + delta); // keep score-to-par-ish sensible
  if (p < 4) h.fir = null;
  persist(); renderHole();
}
function setFir(v) { const h = curHole(); h.fir = (h.fir === v ? null : v); persist(); renderHole(); }
function bump(field, d) {
  const h = curHole();
  h[field] = Math.max(field === 'score' ? 1 : 0, (h[field] || 0) + d);
  if (h.putts > h.score) h.putts = h.score; // can't putt more than total
  persist(); renderHole();
}
function prevHole() { if (S.draft.idx > 0) { S.draft.idx--; persist(); renderHole(); } }
function nextHole() {
  const d = S.draft;
  if (d.idx < d.holes.length - 1) { d.idx++; persist(); renderHole(); }
  else finishRound();
}
function finishRound() {
  const d = S.draft;
  const total = d.holes.reduce((a, h) => a + h.score, 0);
  const tp = d.holes.reduce((a, h) => a + (h.score - h.par), 0);
  if (!confirm(`Save this round?\n\nScore: ${total} (${relStr(tp)})`)) return;
  S.rounds.push({ id: d.id, date: d.date, course: d.course, rating: d.rating ?? null, slope: d.slope ?? null, holes: d.holes });
  S.draft = null; flashRoundId = d.id; persist();
  go('home');
}

/* ============================================================
   VIEW: ROUNDS
   ============================================================ */
function viewRounds() {
  if (!S.rounds.length) {
    app.innerHTML = header('Rounds') + `<div class="empty"><div class="big-ico">📋</div>
      <h2>No rounds yet</h2><p>Your logged rounds will show up here with full scorecards.</p>
      <button class="btn" onclick="go('play')">Start a round</button></div>`;
    return;
  }
  const items = [...S.rounds].reverse().map(r => {
    const total = r.holes.reduce((a, h) => a + h.score, 0);
    const tp = r.holes.reduce((a, h) => a + (h.score - h.par), 0);
    return `<div class="round-item" onclick="openRound('${r.id}')">
      <div><div class="score">${total}</div>
        <div class="meta">${r.course || 'Round'} · ${fmtDate(r.date)} · ${r.holes.length} holes</div></div>
      <div class="rel ${relClass(tp)}">${relStr(tp)}</div>
    </div>`;
  }).join('');
  app.innerHTML = header('Rounds', `${S.rounds.length} logged`) + items;
}

function openRound(id) {
  const r = S.rounds.find(x => x.id === id);
  if (!r) return;
  const st = aggregate([r]);
  const total = r.holes.reduce((a, h) => a + h.score, 0);
  const tp = r.holes.reduce((a, h) => a + (h.score - h.par), 0);
  const cells = r.holes.map(h => {
    const f = holeFacts(h);
    const c = f.toPar < 0 ? 'var(--gold)' : f.toPar === 0 ? 'var(--txt)' : f.toPar === 1 ? 'var(--muted)' : 'var(--red)';
    return `<div style="text-align:center;padding:6px 2px">
      <div style="font-size:11px;color:var(--muted)">${h.num}</div>
      <div style="font-size:18px;font-weight:800;color:${c}">${h.score}</div>
      <div style="font-size:10px;color:var(--muted)">par ${h.par}</div></div>`;
  }).join('');
  const diff = roundDifferential(r);
  app.innerHTML = header('Scorecard', `${r.course || 'Round'} · ${fmtDate(r.date)}`) + `
    <div class="hero"><div class="big">${total}</div><div class="cap">${relStr(tp)} to par · cap differential ${diff.toFixed(1)}${r.rating ? ` (rating ${r.rating}/slope ${r.slope || 113})` : ''}</div></div>
    ${calloutCard(roundCallout(r))}
    <div class="card"><h3>Hole by hole</h3>
      <div style="display:grid;grid-template-columns:repeat(9,1fr);gap:2px">${cells}</div></div>
    <div class="grid">
      ${statCard(pct(st.firPct),'Fairways',st.firPct,TIERS[S.profile.goal].fir)}
      ${statCard(pct(st.girPct),'Greens',st.girPct,TIERS[S.profile.goal].gir)}
      ${statCard((r.holes.reduce((a,h)=>a+h.putts,0)),'Putts',r.holes.reduce((a,h)=>a+h.putts,0),TIERS[S.profile.goal].putts,true)}
      ${statCard(pct(st.scramblePct),'Scrambling',st.scramblePct,TIERS[S.profile.goal].scramble)}
    </div>
    <div class="btn-row">
      <button class="btn ghost" onclick="go('rounds')">← Back</button>
      <button class="btn danger" onclick="deleteRound('${r.id}')">Delete</button>
    </div>`;
}
function deleteRound(id) {
  if (!confirm('Delete this round?')) return;
  S.rounds = S.rounds.filter(r => r.id !== id); persist(); go('rounds');
}

/* ============================================================
   VIEW: SETTINGS / YOU
   ============================================================ */
function viewSettings() {
  app.innerHTML = header('You') + `
    <div class="card">
      <div class="row"><div class="lbl">Name<small>shows on your profile</small></div>
        <input type="text" value="${S.profile.name || ''}" onchange="setName(this.value)" placeholder="Your name"/></div>
      <div class="row"><div class="lbl">Goal<small>benchmarks compare you to this</small></div>
        <select onchange="setGoal(this.value)">
          ${Object.entries(TIERS).map(([k,t])=>`<option value="${k}" ${S.profile.goal===k?'selected':''}>${t.label}</option>`).join('')}
        </select></div>
    </div>
    <div class="card">
      <h3>Your game</h3>
      <div class="row"><div class="lbl">Starting cap<small>self-reported, used until 3 rounds logged</small></div>
        <input type="number" inputmode="decimal" value="${S.profile.startCap ?? ''}" onchange="setStartCap(this.value)" placeholder="—" style="width:88px"/></div>
      <div class="row"><div class="lbl">Weak spot<small>Coach's starting focus</small></div>
        <select onchange="setWeak(this.value)">
          <option value="">—</option>
          ${Object.entries(FOCUS).map(([k,f])=>`<option value="${k}" ${S.profile.weak===k?'selected':''}>${f.label}</option>`).join('')}
        </select></div>
    </div>
    <div class="card">
      <h3>Data</h3>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn ghost sm" onclick="loadSample()">Load sample rounds</button>
        <button class="btn ghost sm" onclick="exportData()">Export JSON</button>
      </div>
      <button class="btn danger" onclick="wipe()">Erase all data</button>
    </div>
    <div class="pill-note">Everything is stored locally on this device. Cloud sync & accounts come when we add the paid tier.</div>`;
}
function setName(v){ S.profile.name = v.trim(); persist(); }
function setGoal(v){ S.profile.goal = v; persist(); }
function setStartCap(v){ const n = parseFloat(v); S.profile.startCap = isFinite(n) ? n : null; persist(); }
function setWeak(v){ S.profile.weak = v || null; persist(); }
function wipe(){ if(confirm('Erase ALL rounds and settings?')){ S = DB.fresh(); persist(); go('home'); } }
function exportData(){
  const blob = new Blob([JSON.stringify(S,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = 'grind-data.json'; a.click(); URL.revokeObjectURL(url);
}

/* ---------- Sample data ---------- */
function loadSample() {
  const mk = (course, offsets) => {
    const holes = PAR_TEMPLATE.map((par, i) => {
      const o = offsets[i] ?? 0;
      const score = par + o;
      const putts = o >= 2 ? 3 : (Math.random() < 0.25 ? 1 : 2);
      const fir = par >= 4 ? (Math.random() < 0.5 ? 'hit' : (Math.random()<0.5?'left':'right')) : null;
      const pen = o >= 3 && Math.random() < 0.6 ? 1 : 0;
      return { num: i+1, par, score, putts: Math.min(putts, score), fir, pen };
    });
    return { id: uid(), date: new Date(Date.now()).toISOString(), course, holes };
  };
  const rnd = () => PAR_TEMPLATE.map(() => { const r=Math.random(); return r<0.08?-1:r<0.45?0:r<0.78?1:r<0.93?2:3; });
  S.rounds.push(mk('Pebble Creek', rnd()));
  S.rounds.push(mk('Oak Ridge', rnd()));
  S.rounds.push(mk('Riverbend', rnd()));
  persist(); go('home');
}

/* ---------- date ---------- */
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------- boot ---------- */
// resume in-progress round if any
if (S.draft) { /* stays on home; user can tap Play to resume */ }
go('home');

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
