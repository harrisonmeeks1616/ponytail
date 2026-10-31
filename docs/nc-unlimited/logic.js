// Pure logic for the NC Unlimited study app. No DOM. Loaded by index.html and by tests/nc-unlimited.test.js.
(function (g) {
  const L = {};
  const DAY = 86400000;

  // ---- dates (America/New_York, because the exam and the plan live there) ----
  L.nyDate = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now || new Date());
  L.addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
  L.diffDays = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
  L.countdown = (now, startISO) => {
    const ms = Date.parse(startISO) - (now || new Date()).getTime();
    if (ms <= 0) return { over: true, days: 0, hours: 0, minutes: 0 };
    return { over: false, days: Math.floor(ms / DAY), hours: Math.floor(ms / 3600000) % 24, minutes: Math.floor(ms / 60000) % 60 };
  };
  L.calendarFor = (cal, iso) => cal.find((c) => iso >= c.from && iso <= c.to) || null;

  // ---- sessions ----
  L.nextSession = (sessions, done) => sessions.find((s) => !done[s[0]]) || null;
  L.hours = (sessions, done) => {
    let d = 0, t = 0;
    for (const s of sessions) { t += s[3]; if (done[s[0]]) d += s[3]; }
    return { done: d, total: t };
  };

  // ---- spaced repetition for the error log: ~1,3,7,14 days; mastered = two clean re-solves on separate days ----
  const STEPS = [1, 3, 7, 14];
  L.newError = (e, today) => ({ id: e.id || "e" + Date.now() + Math.random().toString(36).slice(2, 6), concept: e.concept, wrong: e.wrong || "", rule: e.rule || "", source: e.source || "", ref: e.ref || "", type: e.type || "", created: today, retests: [], mastered: false, next: L.addDays(today, STEPS[0]) });
  L.retest = (err, today, clean) => {
    const e = { ...err, retests: err.retests.concat([{ date: today, clean: !!clean }]) };
    let streak = 0, lastDay = null;
    for (const r of e.retests) {
      if (!r.clean) { streak = 0; lastDay = null; continue; }
      if (r.date !== lastDay) { streak++; lastDay = r.date; }
    }
    e.mastered = streak >= 2;
    e.streak = streak;
    e.next = e.mastered ? null : L.addDays(today, clean ? STEPS[Math.min(streak, STEPS.length - 1)] : STEPS[0]);
    return e;
  };
  L.dueErrors = (errs, today) => errs.filter((e) => !e.mastered && e.next && e.next <= today).sort((a, b) => (a.next < b.next ? -1 : 1));

  // ---- Leitner boxes for the 60 law cards: box 0 new; intervals in days ----
  const BOX = [0, 1, 3, 7, 14, 30];
  L.review = (st, ok, today) => {
    const box = ok ? Math.min((st ? st.box : 0) + 1, BOX.length - 1) : 1;
    return { box, due: L.addDays(today, BOX[box]), n: ((st && st.n) || 0) + 1, last: today };
  };
  L.dueCards = (ids, state, today) => ids.filter((id) => !state[id] || state[id].due <= today);

  // ---- bank grading: only keyed items score; lookup items stay "pending" until you record a citation ----
  L.gradeMcq = (item, pick) => ({ ok: pick === item.ans, ans: item.ans });
  L.bankStats = (bank, attempts, verified) => {
    const byDomain = {};
    for (const it of bank) byDomain[it.d] = byDomain[it.d] || { d: it.d, total: 0, keyed: 0, tried: 0, right: 0, lookupDone: 0, lookup: 0 };
    for (const it of bank) {
      const s = byDomain[it.d];
      s.total++;
      if (it.lookup) { s.lookup++; if (verified[it.id]) s.lookupDone++; } else s.keyed++;
      const a = attempts[it.id];
      if (a && !it.lookup) { s.tried++; if (a.ok) s.right++; }
    }
    return Object.values(byDomain);
  };

  // ---- readiness gates (coaching targets, NOT a pass prediction; official pass line is 70%) ----
  L.readiness = (mocks, gates, cats) => {
    const fresh = mocks.filter((m) => m.form === "full" && m.fresh && !m.assisted && m.minutes <= gates.maxMinutes);
    const good = fresh.filter((m) => m.score >= gates.mockPct);
    const reasons = [];
    if (good.length < gates.mockCount) reasons.push(`Fresh full mocks at ${gates.mockPct}%+ within ${gates.maxMinutes} min: ${good.length}/${gates.mockCount}`);
    const low = [];
    for (const c of cats) {
      if (c.n >= gates.adequateSample && c.pct < gates.categoryFloor) low.push(c);
    }
    if (low.length) reasons.push("Persistent category below " + gates.categoryFloor + "%: " + low.map((c) => c.name).join(", "));
    const thin = cats.filter((c) => c.n < gates.adequateSample).length;
    if (thin) reasons.push(`${thin} categories have fewer than ${gates.adequateSample} fresh questions, so their percentages are not trustworthy yet`);
    const cleared = fresh.length >= 1 || good.length > 0;
    return { met: reasons.length === 0, reasons, freshCount: fresh.length, goodCount: good.length, hasData: mocks.length > 0 && cleared };
  };
  // weight x error rate, highest first; categories with no data are leads, not rankings
  L.weakest = (cats) => cats.filter((c) => c.n > 0).map((c) => ({ ...c, risk: c.weight * (1 - c.pct / 100) })).sort((a, b) => b.risk - a.risk);

  // ---- calculators (screening tools; the 2020 NEC, your contract and the engineer govern) ----
  const r = (x, p) => Math.round(x * Math.pow(10, p == null ? 2 : p)) / Math.pow(10, p == null ? 2 : p);
  const C = {};
  C.ampsThree = (kva, vLL) => r((1000 * kva) / (Math.sqrt(3) * vLL));
  C.ampsSingle = (kva, v) => r((1000 * kva) / v);
  C.kvaThree = (amps, vLL) => r((Math.sqrt(3) * vLL * amps) / 1000);
  C.vaToAmpsThree = (va, vLL) => r(va / (Math.sqrt(3) * vLL));
  C.transformer = (kva, vp, vs) => ({ primary: C.ampsThree(kva, vp), secondary: C.ampsThree(kva, vs) });
  C.faultAtSecondary = (kva, vs, zPct) => { const fl = (1000 * kva) / (Math.sqrt(3) * vs); return { fl: r(fl, 1), isc: r((fl * 100) / zPct, 0), ka: r((fl * 100) / zPct / 1000, 1) }; };
  C.continuous = (cont, non) => r(1.25 * cont + non);
  C.adjust = (base, factors, termCap) => { const adj = r(factors.reduce((a, f) => a * f, base)); return { adjusted: adj, usable: termCap ? Math.min(adj, termCap) : adj }; };
  C.motorConductor = (flc, mult) => r(flc * (mult || 1.25));
  C.vdThree = (k, amps, feet, cm, vLL) => { const vd = (Math.sqrt(3) * k * amps * feet) / cm; return { vd: r(vd), pct: r((vd / vLL) * 100) }; };
  C.vdSingle = (k, amps, feet, cm, v) => { const vd = (2 * k * amps * feet) / cm; return { vd: r(vd), pct: r((vd / v) * 100) }; };
  C.pullStraight = (largestInches) => 8 * largestInches;
  C.pullAngle = (rowInches) => { const a = rowInches.slice().sort((x, y) => y - x); return 6 * a[0] + a.slice(1).reduce((s, x) => s + x, 0); };
  C.priceMarkup = (cost, pct) => r(cost * (1 + pct / 100));
  C.priceMargin = (cost, pct) => r(cost / (1 - pct / 100));
  C.marginOfMarkup = (pct) => r((pct / (100 + pct)) * 100);
  C.breakEven = (fixed, varPctOfSales) => r(fixed / (1 - varPctOfSales / 100));
  C.progress = (contract, changes, eligible, retPct, prevNet) => { const rev = contract + changes, ret = r(eligible * retPct / 100), net = eligible - ret; return { revised: rev, retainage: ret, netEarned: net, due: r(net - prevNet), pctComplete: r((eligible / rev) * 100, 1) }; };
  C.simpleInterest = (p, apr, days, basis) => r(p * (apr / 100) * (days / (basis || 365)));
  C.overtime = (hours, rate) => r(Math.min(hours, 40) * rate + Math.max(hours - 40, 0) * rate * 1.5);
  C.criticalPath = (tasks) => { // tasks: {A:{d:2,after:[]},...}
    const ef = {};
    const go = (k) => (ef[k] != null ? ef[k] : (ef[k] = tasks[k].d + Math.max(0, ...tasks[k].after.map(go))));
    Object.keys(tasks).forEach(go);
    return { finish: Math.max(...Object.values(ef)), ef };
  };
  L.calc = C;

  // ---- backup ----
  L.exportState = (s) => JSON.stringify({ app: "nc-unlimited", v: 1, at: new Date().toISOString(), state: s });
  L.importState = (txt) => { const j = JSON.parse(txt); if (j.app !== "nc-unlimited" || !j.state) throw new Error("Not an NC Unlimited backup"); return j.state; };

  g.NCLogic = L;
  if (typeof module !== "undefined" && module.exports) module.exports = L;
})(typeof window !== "undefined" ? window : globalThis);
