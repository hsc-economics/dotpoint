// Run with: sh tests/run_tests.sh   (uses macOS's built-in JavaScriptCore; no installs needed)
// Checks the data for mistakes a student would notice, and the logic for bugs.
load("data/syllabus.js");
load("data/evidence.js");
load("data/stats.js");
load("data/questions.js");
load("js/logic.js");

const L = DP_LOGIC, SY = DP_SYLLABUS, EV = DP_EVIDENCE, ST = DP_STATS;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; print("FAIL  " + name + "\n      " + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || "values differ"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || "expected true"); }

const dpIndex = L.dotpointIndex(SY);
const TODAY = "2026-10-29";

// ---------- syllabus ----------
test("syllabus: 9 focus areas, years 11 and 12 only", () => {
  eq(SY.focusAreas.length, 9);
  ok(SY.focusAreas.every((f) => f.year === 11 || f.year === 12));
});
test("syllabus: every focus area links to the official NESA page", () => {
  for (const f of SY.focusAreas) ok(/^https:\/\/curriculum\.nsw\.edu\.au\/learning-areas\/hsie\/economics-11-12-2025\/content\/year-1[12]\//.test(f.url), f.id);
});
test("syllabus: dot point ids are unique", () => {
  const ids = SY.focusAreas.flatMap((f) => f.dotpoints.map((d) => d.id));
  eq(new Set(ids).size, ids.length);
});
test("syllabus: every term has a definition ending in a full stop", () => {
  for (const f of SY.focusAreas) for (const d of f.dotpoints) for (const [t, def] of d.terms) {
    ok(t && def && def.length > 20 && /[.]$/.test(def), `${d.id}: ${t}`);
  }
});

// ---------- evidence ----------
test("evidence: ids unique", () => eq(new Set(EV.map((e) => e.id)).size, EV.length));
test("evidence: every card has all required fields", () => {
  for (const e of EV) {
    for (const k of ["id", "title", "date", "type", "keyFigure", "summary", "useFor", "checked"]) ok(e[k], `${e.id} missing ${k}`);
    ok(e.source && e.source.name && e.source.url, `${e.id} missing source`);
    ok(e.flash && e.flash.q && e.flash.a, `${e.id} missing flashcard`);
    ok(e.flash.q.endsWith("?"), `${e.id} flashcard question should end with ?`);
  }
});
test("evidence: every dot point reference exists", () => {
  for (const e of EV) { ok(e.dotpoints.length > 0, e.id); for (const id of e.dotpoints) ok(dpIndex[id], `${e.id} -> ${id}`); }
});
test("evidence: dates are real and not after the check date", () => {
  for (const e of EV) {
    ok(L.parseISO(e.date), `${e.id} bad date ${e.date}`);
    ok(L.parseISO(e.checked), `${e.id} bad checked date`);
    ok(e.date <= e.checked, `${e.id} event date after check date`);
  }
});
test("coverage: every dot point has at least one example and two key terms", () => {
  for (const f of SY.focusAreas) for (const d of f.dotpoints) {
    ok(EV.some((e) => e.dotpoints.includes(d.id)), `${d.id} has no examples`);
    ok(d.terms.length >= 2, `${d.id} has ${d.terms.length} key terms`);
  }
});
test("evidence: sources are https links", () => { for (const e of EV) ok(/^https:\/\//.test(e.source.url), e.id); });
test("evidence: summaries are short enough to read on a phone", () => {
  for (const e of EV) ok(e.summary.length <= 520, `${e.id} summary is ${e.summary.length} chars`);
});
test("evidence: written without em dashes used as asides", () => {
  for (const e of EV) ok(!/ — /.test(e.summary + e.useFor), e.id);
});

// ---------- stats ----------
test("stats: 20 indicators with data, 10 of them headline figures", () => {
  eq(ST.indicators.length, 20);
  eq(ST.indicators.filter((i) => i.group === "headline").length, 10);
});
test("stats: six daily numbers, each with at least two business days of data", () => {
  eq(ST.daily.length, 6);
  for (const d of ST.daily) {
    ok(d.points.length >= 2, d.id);
    for (let k = 1; k < d.points.length; k++) ok(d.points[k][0] > d.points[k - 1][0], `${d.id} not sorted`);
    ok(L.fmtValue(d, d.points[d.points.length - 1][1]) !== "–", d.id);
  }
});
test("stats: points sorted, unique dates, numeric values", () => {
  for (const i of ST.indicators) {
    ok(i.points.length >= 6, `${i.id} has ${i.points.length} points`);
    for (let k = 1; k < i.points.length; k++) ok(i.points[k][0] > i.points[k - 1][0], `${i.id} not sorted at ${i.points[k][0]}`);
    ok(i.points.every((p) => L.parseISO(p[0]) && typeof p[1] === "number" && isFinite(p[1])), i.id);
  }
});
test("stats: dot point references exist", () => { for (const i of ST.indicators) for (const id of i.dotpoints) ok(dpIndex[id], `${i.id} -> ${id}`); });
test("stats: values are in sensible ranges", () => {
  const range = { "cash-rate": [0, 20], cpi: [-5, 20], "trimmed-mean": [-5, 20], unemployment: [1, 20], participation: [50, 80],
    "gdp-growth": [-15, 15], "terms-of-trade": [20, 200], "current-account": [-15, 10], "aud-usd": [0.3, 1.5], twi: [30, 100],
    "wage-growth": [-2, 10], productivity: [-10, 10], "employment-growth": [-10, 10], vacancies: [0, 8], "bond-10y": [0, 12],
    "mortgage-rate": [1, 15], "housing-credit": [-5, 25], "consumption-growth": [-25, 25], "saving-ratio": [-5, 30], "commodity-prices": [20, 250] };
  for (const i of ST.indicators) { const [lo, hi] = range[i.id]; for (const [d, v] of i.points) ok(v >= lo && v <= hi, `${i.id} ${d} = ${v}`); }
});
test("stats: cash rate decisions are consistent with the series", () => {
  const dec = ST.cashRateDecisions;
  ok(dec.length > 10);
  const last = dec[dec.length - 1];
  const cr = ST.indicators.find((i) => i.id === "cash-rate");
  eq(cr.points[cr.points.length - 1][1], last.rate, "latest cash rate equals last decision");
  for (let k = 1; k < dec.length; k++) eq(+(dec[k - 1].rate + dec[k].change).toFixed(2), dec[k].rate, `decision ${dec[k].date}`);
});
test("stats: evidence card about 2026 rate rises matches the RBA data", () => {
  // Only decisions up to the card's date, so a later RBA move doesn't break the daily refresh.
  const card = EV.find((e) => e.id === "cash-rate-cycle-2025-26");
  const upTo = ST.cashRateDecisions.filter((d) => d.date <= card.date);
  const rises2026 = upTo.filter((d) => d.date.startsWith("2026") && d.change > 0);
  const cuts2025 = upTo.filter((d) => d.date.startsWith("2025") && d.change < 0);
  eq(rises2026.length, 4, "four rises in 2026");
  eq(cuts2025.length, 3, "three cuts in 2025");
  eq(rises2026[rises2026.length - 1].rate, 4.6);
  ok(card.summary.includes("4.60%") && card.summary.includes("3.60%") && card.summary.includes("4.35%"));
  // "highest since 2011": no rate at or above 4.60 between 2012 and 2026
  ok(ST.cashRateDecisions.filter((d) => d.date >= "2019" && d.date < "2026-09" && d.rate >= 4.6).length === 0);
});

// ---------- dates and freshness ----------
test("parseISO rejects impossible dates", () => { eq(L.parseISO("2026-02-30"), null); eq(L.parseISO("nope"), null); ok(L.parseISO("2024-02-29")); });
test("fmtDate", () => { eq(L.fmtDate("2026-09-29"), "29 Sep 2026"); });
test("fmtPeriod for quarterly, monthly and daily", () => {
  eq(L.fmtPeriod("2026-06-30", "Quarterly"), "June quarter 2026");
  eq(L.fmtPeriod("2026-09-30", "Monthly"), "September 2026");
  eq(L.fmtPeriod("2026-10-28", "Monthly (month-end)", true), "28 Oct 2026");
});
test("monthsBetween counts whole months", () => {
  eq(L.monthsBetween("2026-04-30", "2026-10-29"), 5);
  eq(L.monthsBetween("2026-04-29", "2026-10-29"), 6);
  eq(L.monthsBetween("2025-10-29", "2026-10-29"), 12);
});
test("freshness bands", () => {
  eq(L.freshness("2026-09-29", TODAY).level, "fresh");
  eq(L.freshness("2026-04-29", TODAY).level, "ageing");
  eq(L.freshness("2025-04-30", TODAY).level, "ageing");
  eq(L.freshness("2025-04-29", TODAY).level, "old");
  eq(L.freshness("2027-01-01", TODAY).level, "fresh"); // future-dated never shows as old
});
test("ageText", () => { eq(L.ageText(0), "in the past month"); eq(L.ageText(1), "1 month ago"); eq(L.ageText(12), "1 year ago"); eq(L.ageText(13), "over 1 year ago"); eq(L.ageText(24), "2 years ago"); eq(L.ageText(30), "over 2 years ago"); });

// ---------- spaced repetition ----------
const D = (iso) => L.parseISO(iso);
test("grade: new card answered well moves to box 1, due tomorrow", () => {
  const s = L.grade(null, "good", D(TODAY));
  eq(s.box, 1); eq(s.due, L.dayNumber(D(TODAY)) + 1); eq(s.reviews, 1);
});
test("grade: forgetting resets to box 0, due today, counts a lapse", () => {
  let s = L.grade(null, "good", D(TODAY)); s = L.grade(s, "good", D(TODAY)); s = L.grade(s, "again", D(TODAY));
  eq(s.box, 0); eq(s.due, L.dayNumber(D(TODAY))); eq(s.lapses, 1);
});
test("grade: 'unsure' never promotes and never drops below box 1", () => {
  eq(L.grade(null, "hard", D(TODAY)).box, 1);
  eq(L.grade({ box: 4, due: 0 }, "hard", D(TODAY)).box, 4);
  eq(L.grade({ box: 5, due: 0 }, "hard", D(TODAY)).box, 4);
});
test("grade: box is capped", () => { eq(L.grade({ box: 5, due: 0 }, "good", D(TODAY)).box, 5); });
test("grade: unknown result throws", () => { let threw = false; try { L.grade(null, "maybe", D(TODAY)); } catch (e) { threw = true; } ok(threw); });
test("grade does not mutate the old state", () => { const s0 = { box: 2, due: 5 }; L.grade(s0, "good", D(TODAY)); eq(s0, { box: 2, due: 5 }); });
test("dueQueue: overdue reviews first, then new cards, future cards excluded", () => {
  const t = L.dayNumber(D(TODAY));
  const cards = [{ id: "new", order: 0 }, { id: "future", order: 1 }, { id: "overdue", order: 2 }, { id: "today", order: 3 }];
  const states = { future: { box: 3, due: t + 2 }, overdue: { box: 2, due: t - 3 }, today: { box: 1, due: t } };
  eq(L.dueQueue(cards, states, D(TODAY)).map((c) => c.id), ["overdue", "today", "new"]);
  eq(L.dueQueue(cards, states, D(TODAY), 1).map((c) => c.id), ["overdue"]);
});

// ---------- deck ----------
const deck = L.buildDeck(SY, EV, ST);
test("deck: card ids unique", () => eq(new Set(deck.map((c) => c.id)).size, deck.length));
test("deck: every card has a question, answer and valid dot points", () => {
  for (const c of deck) { ok(c.q && c.a, c.id); for (const id of c.dotpoints) ok(dpIndex[id], `${c.id} -> ${id}`); }
});
test("deck: stat card ids change when a new figure is released", () => {
  const ind = ST.indicators[0];
  const a = L.statCards({ indicators: [ind] })[0];
  const b = L.statCards({ indicators: [{ ...ind, points: ind.points.concat([["2099-01-31", 1]]) }] })[0];
  ok(a.id !== b.id);
});
test("deck: stat questions read naturally", () => {
  for (const c of L.statCards(ST)) { ok(/^What (was|is) /.test(c.q) && c.q.endsWith("?"), c.q); ok(!/was worth the/.test(c.q), c.q); }
});

// ---------- statistics helpers ----------
const fake = (unit, decimals, pts, extra) => Object.assign({ id: "x", label: "Test", phrase: "the test rate", verb: "was", unit, decimals, frequency: "Monthly", adjustment: "Original", source: "ABS via RBA table H5", points: pts }, extra || {});
test("yearChange finds the observation a year earlier", () => {
  const ind = fake("%", 1, [["2025-09-30", 4.0], ["2026-03-31", 4.2], ["2026-09-30", 4.7]]);
  eq(L.yearChange(ind).delta, 0.7);
  eq(L.yearChange(ind).from[0], "2025-09-30");
});
test("yearChange returns null when no point is near a year earlier", () => {
  eq(L.yearChange(fake("%", 1, [["2026-03-31", 4.2], ["2026-09-30", 4.7]])), null);
});
test("fmtValue and fmtDelta", () => {
  eq(L.fmtValue(fake("%", 1, []), 4.25), "4.3%");
  eq(L.fmtValue(fake("% of GDP", 1, []), -3.7), "−3.7%");
  eq(L.fmtValue(fake("US$", 4, []), 0.7034), "US70.3¢");
  eq(L.fmtValue(fake("index", 1, []), 94.8), "94.8");
  eq(L.fmtDelta(fake("%", 1, []), 0.3), "+0.3 pts");
  eq(L.fmtDelta(fake("%", 1, []), -0.3), "−0.3 pts");
  eq(L.fmtDelta(fake("US$", 4, []), 0.048), "+4.8¢");
});
test("citationSentence mentions the target band and the source", () => {
  const ind = fake("%", 1, [["2025-09-30", 2.5], ["2026-09-30", 4.3]], { band: [2, 3], phrase: "headline inflation", source: "ABS Consumer Price Index (monthly)" });
  eq(L.citationSentence(ind), "In September 2026, headline inflation was 4.3%, above the RBA's 2–3% target band, up from 2.5% a year earlier (ABS).");
});
test("citationSentence for a daily series and an external source", () => {
  const ind = fake("US$", 4, [["2025-10-31", 0.655], ["2026-10-28", 0.7034]], { frequency: "Monthly (month-end)", phrase: "the Australian dollar", verb: "was worth", source: "WM/Reuters via RBA table F11.1" });
  eq(L.citationSentence(ind), "On 28 Oct 2026, the Australian dollar was worth US70.3¢, up from US65.5¢ a year earlier (WM/Reuters, via RBA).");
});
test("every real indicator produces a citation sentence ending in a full stop", () => {
  for (const i of ST.indicators) { const s = L.citationSentence(i); ok(/\)\.$/.test(s) && !/undefined|NaN/.test(s), s); }
});

// ---------- search ----------
test("search: empty query returns everything", () => eq(L.searchEvidence(EV, dpIndex, "  ").length, EV.length));
test("search: finds by key term (oligopoly)", () => ok(L.searchEvidence(EV, dpIndex, "oligopoly").some((e) => e.id === "accc-supermarkets-2025")));
test("search: all words must match", () => {
  const r = L.searchEvidence(EV, dpIndex, "inflation fuel").map((e) => e.id);
  ok(r.includes("fuel-shock-mar-2026"));
  ok(!r.includes("payday-super-2026"));
});
test("search: prefix match", () => ok(L.searchEvidence(EV, dpIndex, "tarif").some((e) => e.id === "us-tariffs-2026")));
test("search: nonsense returns nothing", () => eq(L.searchEvidence(EV, dpIndex, "zzqx").length, 0));

// ---------- progress ----------
test("normaliseProgress repairs junk", () => {
  eq(L.normaliseProgress(null).version, 1);
  eq(L.normaliseProgress({ version: 7 }).cards, {});
  eq(L.normaliseProgress({ version: 1, cards: [1, 2] }).cards, {});
});
test("mergeProgress keeps the newer copy", () => {
  const a = { version: 1, updatedAt: 10, dotStatus: { x: "shaky" }, cards: {}, seenEvidence: {} };
  const b = { version: 1, updatedAt: 20, dotStatus: { x: "confident" }, cards: {}, seenEvidence: {} };
  eq(L.mergeProgress(a, b).dotStatus.x, "confident");
  eq(L.mergeProgress(b, a).dotStatus.x, "confident");
  eq(L.mergeProgress(a, null).dotStatus.x, "shaky");
});
test("dotpointStatus: own rating wins, otherwise drills decide", () => {
  const p = L.emptyProgress();
  eq(L.dotpointStatus("hh-min-wage", p, deck, D(TODAY)), "none");
  const cards = deck.filter((c) => c.dotpoints.includes("hh-min-wage"));
  p.cards[cards[0].id] = { box: 1, due: 0 };
  eq(L.dotpointStatus("hh-min-wage", p, deck, D(TODAY)), "shaky");
  for (const c of cards) p.cards[c.id] = { box: 3, due: 0 };
  eq(L.dotpointStatus("hh-min-wage", p, deck, D(TODAY)), "confident");
  p.dotStatus["hh-min-wage"] = "shaky";
  eq(L.dotpointStatus("hh-min-wage", p, deck, D(TODAY)), "shaky");
});
test("suggestions: a new student is told to start a drill", () => {
  const s = L.suggestions({ deck, progress: L.emptyProgress(), today: D(TODAY), dpIndex, evidence: EV });
  eq(s[0].kind, "drill"); eq(s[0].title, "Start a 5-minute drill");
});
test("suggestions: due reviews come first", () => {
  const p = L.emptyProgress();
  p.cards[deck[0].id] = { box: 1, due: 0 };
  const s = L.suggestions({ deck, progress: p, today: D(TODAY), dpIndex, evidence: EV });
  eq(s[0].title, "1 card due for review");
  ok(/About 1 minute\./.test(s[0].detail), s[0].detail);
});

// ---------- reports ----------
test("cleanReport trims, caps length and whitelists reasons", () => {
  const r = L.cleanReport({ reason: "<script>", note: "  a   b  " + "x".repeat(900), target: "ev:1" });
  eq(r.reason, "Other"); ok(r.note.startsWith("a b ")); eq(r.note.length, 600);
});


// ---------- skill tree ----------
test("tree: every dot point is in exactly one branch", () => {
  const ids = SY.branches.flatMap((b) => b.nodes.map((n) => n.id));
  eq(new Set(ids).size, ids.length, "no duplicates");
  eq(ids.slice().sort(), Object.keys(dpIndex).sort(), "same set as the syllabus");
});
test("tree: parents are in the same branch, 'also' links exist, no cycles", () => {
  for (const b of SY.branches) {
    const inBranch = new Set(b.nodes.map((n) => n.id));
    for (const n of b.nodes) {
      for (const p of n.parents) ok(inBranch.has(p), `${n.id} parent ${p} not in ${b.id}`);
      for (const a of n.also || []) ok(dpIndex[a] && !inBranch.has(a), `${n.id} also ${a}`);
    }
    const rows = L.branchRows(b);
    eq(rows.flat().length, b.nodes.length, b.id);
    ok(rows.every((r) => r.length <= 4), `${b.id} has a row wider than 4 nodes`);
  }
});
test("syllabus: every dot point has a short name that fits a tree node", () => {
  for (const id of Object.keys(dpIndex)) { const sh = dpIndex[id].short; ok(sh && sh.length <= 26, `${id}: ${sh}`); }
});
test("skillLevel: levels follow drills, self-rating can't give Mastered", () => {
  const p = L.emptyProgress();
  const id = "fin-super";
  const cards = deck.filter((c) => c.dotpoints.includes(id));
  ok(cards.length >= 2, "needs at least two cards");
  eq(L.skillLevel(id, p, deck).level, 0);
  p.dotStatus[id] = "shaky"; eq(L.skillLevel(id, p, deck).level, 1);
  p.dotStatus[id] = "confident"; eq(L.skillLevel(id, p, deck).level, 2);
  delete p.dotStatus[id];
  p.cards[cards[0].id] = { box: 1, due: 0 }; eq(L.skillLevel(id, p, deck).level, 1);
  for (const c of cards) p.cards[c.id] = { box: 3, due: 0 };
  eq(L.skillLevel(id, p, deck).level, 3);
});
test("skillTree: roots are ready, children locked until a parent is started", () => {
  const p = L.emptyProgress();
  let t = L.skillTree(SY.branches, p, deck);
  eq(t["fin-role"].state, "ready");
  eq(t["fin-housing"].state, "locked");
  const c = deck.find((x) => x.dotpoints.includes("fin-interest-rates"));
  p.cards[c.id] = { box: 1, due: 0 };
  t = L.skillTree(SY.branches, p, deck);
  eq(t["fin-interest-rates"].state, "progress");
  eq(t["fin-housing"].state, "ready");
});
test("nextSkill: prefers a skill already started", () => {
  const p = L.emptyProgress();
  eq(L.nextSkill(SY.branches, p, deck).id, SY.branches[0].nodes[0].id);
  const c = deck.find((x) => x.dotpoints.includes("mp-limits"));
  p.cards[c.id] = { box: 1, due: 0 };
  ok(["mp-limits"].concat(c.dotpoints).includes(L.nextSkill(SY.branches, p, deck).id));
});
test("suggestions include the next skill when branches are given", () => {
  const sg = L.suggestions({ deck, progress: L.emptyProgress(), today: D(TODAY), dpIndex, evidence: EV, branches: SY.branches });
  ok(sg.some((x) => x.kind === "dotpoint" && x.title.startsWith("Next skill:")), JSON.stringify(sg));
});

// ---------- streaks and points ----------
test("streak counts back from today, or from yesterday if today isn't done yet", () => {
  eq(L.streak({}, TODAY), 0);
  eq(L.streak({ "2026-10-29": 3, "2026-10-28": 1, "2026-10-27": 2 }, TODAY), 3);
  eq(L.streak({ "2026-10-28": 1, "2026-10-27": 2 }, TODAY), 2);
  eq(L.streak({ "2026-10-27": 2 }, TODAY), 0);
  eq(L.streak({ "2026-03-01": 1, "2026-02-28": 1 }, "2026-03-01"), 2);
});
test("points: 10 per box climbed", () => { eq(L.points({ cards: { a: { box: 2 }, b: { box: 3 }, c: { box: 0 } } }), 50); });
test("normaliseProgress keeps study days", () => { eq(L.normaliseProgress({ version: 1, days: { [TODAY]: 2 } }).days[TODAY], 2); });

// ---------- examples: quotes and links to statistics ----------
test("examples: every card has a short, attributed quote with an https link", () => {
  for (const e of EV) {
    ok(e.quote && e.quote.text && e.quote.by, `${e.id} missing quote`);
    ok(e.quote.text.split(/\s+/).length <= 22, `${e.id} quote is ${e.quote.text.split(/\s+/).length} words`);
    ok(/^https:\/\//.test(e.quote.url), `${e.id} quote link`);
    ok(!/["“”]/.test(e.quote.text), `${e.id} quote should not include its own quotation marks`);
  }
});
test("examples: search finds words that only appear in a quote", () => {
  ok(L.searchEvidence(EV, dpIndex, "silver bullet").some((e) => e.id === "accc-supermarkets-2025"));
});
test("relatedIndicators / relatedExamples link through shared dot points", () => {
  const cpiCard = EV.find((e) => e.id === "cpi-sep-2026");
  ok(L.relatedIndicators(cpiCard, ST).some((i) => i.id === "cpi"));
  const cpi = ST.indicators.find((i) => i.id === "cpi");
  const rel = L.relatedExamples(cpi, EV);
  ok(rel.some((e) => e.id === "cpi-sep-2026"));
  ok(rel.every((e, k) => k === 0 || rel[k - 1].date >= e.date), "newest first");
});
test("every statistic links to at least one example", () => {
  for (const i of ST.indicators) ok(L.relatedExamples(i, EV).length > 0, i.id);
});


// ---------- sequence and site search ----------
test("sequence: builds on its parents and 'also' links, leads to its children", () => {
  const sq = L.sequence(SY.branches, "mp-cash-rate");
  ok(sq.buildsOn.includes("mp-objectives") && sq.buildsOn.includes("fin-interest-rates"), JSON.stringify(sq));
  ok(sq.leadsTo.includes("mp-limits"), JSON.stringify(sq));
  ok(L.sequence(SY.branches, "fin-interest-rates").leadsTo.includes("mp-cash-rate"));
});
test("searchAll finds dot points, examples and statistics together", () => {
  const r = L.searchAll("inflation", SY, EV, ST);
  ok(r.dotpoints.some((d) => d.id === "iss-inflation-causes"));
  ok(r.examples.some((e) => e.id === "cpi-sep-2026"));
  ok(r.stats.some((i) => i.id === "cpi"));
  const none = L.searchAll("   ", SY, EV, ST);
  eq(none.dotpoints.length + none.examples.length + none.stats.length, 0);
  ok(L.searchAll("oligopoly", SY, EV, ST).dotpoints.some((d) => d.id === "mkt-structures"), "matches key terms");
});
// ---------- essay feedback ----------
const QS = DP_QUESTIONS;
test("questions: ids unique, every dot point exists, every question starts with a key verb", () => {
  eq(new Set(QS.map((q) => q.id)).size, QS.length);
  for (const q of QS) {
    ok(q.year === 11 || q.year === 12, q.id);
    ok(q.dotpoints.length && q.dotpoints.every((id) => dpIndex[id]), `${q.id} dot points`);
    ok(L.verbOf(q.text) === L.tokens(q.text)[0], `${q.id} verb`);
  }
});
test("essay: word count and paragraphs", () => {
  eq(L.wordCount("The RBA raised rates to 4.60% in 2026."), 8);
  eq(L.wordCount("  "), 0);
  eq(L.paragraphs("One.\n\nTwo\nstill two.\n\n\nThree.").length, 3);
  eq(L.paragraphs("One.\nTwo.\nThree.").length, 3);
});
test("essay: bands for a 20-mark response", () => {
  eq([20, 17, 16, 13, 12, 9, 8, 5, 4, 1, 0].map(L.bandFor), ["17–20", "17–20", "13–16", "13–16", "9–12", "9–12", "5–8", "5–8", "1–4", "1–4", "0"]);
});
const ESSAY = "Inflation in Australia rose to 7.8% in 2022 because of supply shocks.\n\nThe RBA raised the cash rate to 4.35% which slowed demand.\n\nOverall monetary policy was partly effective.";
const ectx = { question: QS[0].text, essay: ESSAY, syllabus: SY, evidence: EV, stats: ST, today: TODAY };
test("essay: prompt has the question, verb meaning, numbered paragraphs, latest data and reply shape", () => {
  const p = L.essayPrompt(ectx);
  ok(p.includes(QS[0].text));
  ok(p.includes(L.VERBS.assess));
  ok(p.includes("[P3] Overall monetary policy was partly effective."));
  ok(p.includes("cpi: ") && p.includes(EV[0].id + " | "));
  ok(p.includes('"dataChecks"') && p.includes("Never rewrite"));
});
test("essay: feedback is cleaned before it is shown", () => {
  const f = L.parseFeedback({
    mark: "23", summary: "Good.",
    criteria: [{ id: "evidence", level: 9, comment: "Few stats." }, { id: "question", level: 3, comment: "Clear." }],
    strengths: [{ quote: "The RBA raised the cash rate to 4.35%", why: "Data." }, { quote: "words that are not in the essay", why: "x" }],
    improvements: [{ where: "P1", issue: "Old figure", action: "Update it" }, {}],
    dataChecks: [{ quote: "rose to 7.8% in 2022", status: "outdated", latest: "4.3% in Sep 2026", statId: "cpi" }, { quote: "invented", status: "outdated" }, { quote: "rose to 7.8%", status: "wrong" }],
    examples: [{ id: EV[0].id, why: "a" }, { id: EV[0].id, why: "dup" }, { id: "made-up", why: "b" }],
    stats: [{ id: "cpi" }, { id: "nope" }], dotpoints: ["mp-objectives", "nope"], nextStep: "Judge.",
  }, ectx);
  eq(f.mark, 20); eq(f.band, "17–20");
  eq(f.criteria.map((c) => c.id), L.CRITERIA.map((c) => c.id));
  eq(f.criteria.find((c) => c.id === "evidence").level, null);
  eq(f.criteria.find((c) => c.id === "question").level, 3);
  eq(f.strengths.length, 1); eq(f.improvements.length, 1); eq(f.dataChecks.length, 1);
  eq(f.examples.map((x) => x.id), [EV[0].id]); eq(f.stats.map((x) => x.id), ["cpi"]); eq(f.dotpoints, ["mp-objectives"]);
});
test("essay: a reply without a mark is rejected", () => {
  let threw = false; try { L.parseFeedback({ summary: "no mark" }, ectx); } catch (e) { threw = true; } ok(threw);
  threw = false; try { L.parseFeedback([1, 2], ectx); } catch (e) { threw = true; } ok(threw);
});

test("suggestion form lists every dot point (run tools/build_issue_template.py after changing dot points)", () => {
  const form = read(".github/ISSUE_TEMPLATE/suggest-evidence.yml");
  for (const f of SY.focusAreas) for (const d of f.dotpoints) ok(form.includes(`(${d.id})`), `form is missing ${d.id}`);
});

// ---------- the page ----------
const html = read("index.html");
const app = read("js/app.js");
test("page: every element id used by app.js exists in index.html or is created by app.js", () => {
  const used = [...app.matchAll(/\$\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);
  const created = new Set([...app.matchAll(/id: "([a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const v of ["today", "syllabus", "evidence", "stats", "drills", "essay"]) { created.add("view-" + v); created.add("h-" + v); }
  for (const id of new Set(used)) ok(html.includes(`id="${id}"`) || created.has(id), `missing #${id}`);
});
test("page: scripts load in dependency order", () => {
  const order = ["data/syllabus.js", "data/evidence.js", "data/stats.js", "data/questions.js", "data/config.js", "js/logic.js", "js/app.js"].map((f) => html.indexOf(`src="${f}"`));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), JSON.stringify(order));
});
test("page: no document skeleton tags (the publisher adds them)", () => {
  ok(!/<!doctype|<html|<head>|<body/i.test(html));
});
test("page: no game features left in the interface", () => {
  const app = read("js/app.js"), html = read("index.html");
  for (const w of ["L.streak(", "L.points(", "levelBadge", "Mastered", "level up", "Nice work", "skill tree"]) ok(!app.toLowerCase().includes(w.toLowerCase()), `app.js still mentions ${w}`);
  ok(!/@keyframes/.test(html), "no animations");
});
test("page: links a tab icon that exists", () => {
  for (const f of ["icons/favicon.svg", "icons/favicon-32.png", "icons/apple-touch-icon.png"]) {
    ok(html.includes(`href="${f}"`), `index.html does not link ${f}`);
    let found = true; try { read(f); } catch (e) { found = false; }
    ok(found, `${f} is missing`);
  }
});
test("page: has a short title", () => { const m = /<title>([^<]+)<\/title>/.exec(html); ok(m && m[1].split(" ").length <= 4, m && m[1]); });
test("page: app.js never uses innerHTML", () => ok(!/innerHTML/.test(app)));

print(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
