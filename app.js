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
      profile: { name: '', goal: '85' },   // goal handicap tier
      rounds: [],                            // completed rounds
      practice: [],                          // logged range/practice sessions
      draft: null                            // in-progress round
    };
  }
};
let S = DB.load();
if (!S.practice) S.practice = [];            // migrate older saves
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
  tee:      { label: 'Off the tee', icon: '🚀' },
  approach: { label: 'Approach',    icon: '🎯' },
  short:    { label: 'Short game',  icon: '⛳' },
  putting:  { label: 'Putting',     icon: '🥅' },
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
   ROUTER
   ============================================================ */
let TAB = 'home';
function go(tab) {
  TAB = tab;
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}
document.querySelectorAll('#tabbar button').forEach(b =>
  b.addEventListener('click', () => go(b.dataset.tab)));

function render() {
  if (TAB === 'home') return viewHome();
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
   VIEW: HOME / STATS
   ============================================================ */
function viewHome() {
  const st = aggregate(S.rounds);
  if (!st) {
    app.innerHTML = header('ZeroCap', 'play to zero') + `
      <div class="empty">
        <div class="big-ico">⛳</div>
        <h2>No rounds yet</h2>
        <p>Tap <b>Play</b> to log your first round. Just score, putts, fairway & penalties per hole — ZeroCap figures out the rest.</p>
        <button class="btn" onclick="go('play')">Start a round</button>
        <div style="height:12px"></div>
        <button class="btn ghost sm" onclick="loadSample()">Load sample data to explore</button>
      </div>`;
    return;
  }
  const sl = strokesLost(st, S.profile.goal);
  const focus = sl.cats[0];
  const last = S.rounds[S.rounds.length - 1];
  const lastTP = last.holes.reduce((a, h) => a + (h.score - h.par), 0);

  app.innerHTML = header('Your Stats', `${st.rounds} round${st.rounds>1?'s':''} logged`) + `
    <div class="hero">
      <div class="big">${st.scoringAvg18 >= 0 ? '+' : ''}${st.scoringAvg18.toFixed(1)}</div>
      <div class="cap">avg score to par (per 18)</div>
    </div>

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
            <div class="fi">${f.icon}</div><div>${f.label}</div></button>`).join('')}
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
const PRACTICE = {
  tee: { title: 'Off the tee', drills: [
    'Play a "fairway finder" club off tight holes — accuracy over 10 yards of distance.',
    'On the range, pick a target & fairway width; track hit % over 20 balls.',
    'Cut penalties: club down when trouble is in play. Bogey > double.' ]},
  approach: { title: 'Approach', drills: [
    'Dial in wedge distances: hit 10 balls each at 50/75/100 yds, note carry.',
    'Aim for the fat middle of greens, not pins — GIR is king.',
    'Know your real club distances (carry, not "hero" numbers).' ]},
  short: { title: 'Short game', drills: [
    'Up-and-down ladder: 10 chips from 10–20 yds, get each within a putter length.',
    'One-club chipping — learn to fly-and-roll to a spot.',
    'Practice the "worst-case" shot: bunkers & bad lies you actually face.' ]},
  putting: { title: 'Putting', drills: [
    'Lag drill: 6 putts from 30–40 ft, goal is zero 3-putts.',
    'Make circle: 15 putts from 3–4 ft around the hole, must make 12+.',
    'Speed first, line second — most 3-putts are distance control.' ]},
};
function viewCoach() {
  const st = aggregate(S.rounds);
  if (!st) {
    app.innerHTML = header('Coach') + `<div class="empty"><div class="big-ico">🎯</div>
      <h2>Coach needs data</h2><p>Log a round or two and Coach will pinpoint exactly where you're losing strokes and what to practice.</p>
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
   VIEW: PLAY (hole-by-hole entry)
   ============================================================ */
function newDraft() {
  return {
    id: uid(),
    date: new Date().toISOString(),
    course: '',
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
        <button class="btn" onclick="startRound()">Start round ⛳</button>
      </div>
      <div class="pill-note">Par defaults to a standard layout — you can bump each hole's par in one tap as you play.</div>`;
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
  S.rounds.push({ id: d.id, date: d.date, course: d.course, holes: d.holes });
  S.draft = null; persist();
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
  app.innerHTML = header('Scorecard', `${r.course || 'Round'} · ${fmtDate(r.date)}`) + `
    <div class="hero"><div class="big">${total}</div><div class="cap">${relStr(tp)} to par</div></div>
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
