// Source: Harrison OS Notion, NC Unlimited · Study (Exam Plan & Readiness, 8-Week Study Execution Plan). Read 2026-10-31.
(function (g) {
  g.NC = g.NC || {};

  g.NC.exam = {
    startISO: "2026-12-07T15:00:00Z", // Mon Dec 7 2026 10:00 AM EST (UTC-5)
    date: "2026-12-07",
    center: "PSI Charlotte, Tyvola Executive Park, 5701 Westpark Drive, Suite 101, Charlotte, NC 28217 (I-77 exit 5, Tyvola Rd, Westpark Dr)",
    window: "10:00 AM to 4:00 PM ET (360 minutes). Be there by 9:30; check in by 9:45. Starting more than 15 minutes late forfeits the booking.",
    questions: 100, minutes: 360, passPct: 70,
    cutoffISO: "2026-12-05T15:00:00Z", // PSI 48h cutoff: Sat Dec 5 10:00 AM
    cutoffText: "PSI cancel/reschedule cutoff: Saturday Dec 5, 10:00 AM (48 hours). Personal decision margin: Wednesday Dec 2.",
    books: [
      ["2020 NEC (complete bound)", "Required and permitted. Timed navigation, exact 2020 provisions, calculations, exceptions."],
      ["2013 NFPA 72 (complete bound)", "Required and permitted for Unlimited. Chapter navigation plus system-specific numbers."],
      ["NASCLA North Carolina Electrical, 14th edition", "Admitted under the current handbook. Only the 14th edition is allowed from June 16, 2026. Recall first, then verify and page-key it."],
      ["G.S. 87 Art. 4 and 21 NCAC 18B", "STUDY sources only. Separate law/rules documents are not on the admitted list. Content inside NASCLA can be consulted."],
      ["Official Lighting and Power Plans", "Tested. Study drawings are at the back of the NCBEEC/PSI handbook (printed pp. 69-70). No personal plan packet is authorized."],
      ["2023 NEC (saved copy)", "Supporting explanation only. NOT the exam edition. Article 220 and higher-voltage layout differ from 2020."]
    ],
    bookRules: [
      "Complete softbound, spiral or hardbound books only. No loose-leaf, no partial references.",
      "Highlighting, underlining and notes already on the pages are permitted. Highlight pencil notes; pen notes need not be highlighted.",
      "No writing in books during the exam. No inserted papers, loose or attached.",
      "Permanent tabs meeting the current handbook rules only. Temporary flags, stapled tabs and divider tabs are prohibited. A brand name alone does not prove compliance; compare the product against the handbook.",
      "NFPA 13 is outside this exam's reference set. NFPA 70E is optional enrichment, not an admitted reference.",
      "Test center supplies calculator, scratch paper and pencils."
    ],
    ids: "Two valid, unexpired signed IDs, at least one government photo ID, names matching registration.",
    contacts: "NCBEEC office@ncbeec.org (919) 733-9042. PSI examschedule@psionline.com (855) 746-8173. Verify details in your actual confirmation.",
    links: [
      ["NCBEEC/PSI current handbook", "https://www.ncbeec.org/psi-exam-book-2026-002-2/"],
      ["Board examinations", "https://www.ncbeec.org/examinations/"],
      ["Board FAQ", "https://www.ncbeec.org/faq/"],
      ["Board rules, 21 NCAC 18B", "https://www.ncbeec.org/title-21-ncac-18b/"],
      ["G.S. Chapter 87", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_87.html"],
      ["PSI NCBEEC portal", "https://test-takers.psiexams.com/ncbeec"],
      ["NASCLA NC Electrical 14th notice", "https://store.nascla.org/products/north-carolina-electrical-14th-edition"],
      ["NFPA free access: NEC 2020", "https://link.nfpa.org/free-access/publications/70/2020"],
      ["NFPA free access: NFPA 72 (2013)", "https://link.nfpa.org/free-access/publications/72/2013"]
    ]
  };

  // Official approximate blueprint (sums to 100).
  g.NC.blueprint = [
    [1, "Bonding and grounding", 11], [2, "Overcurrent protection", 9], [3, "Wiring methods and terminations", 10],
    [4, "Boxes and fittings", 7], [5, "Service entrance and equipment", 9], [6, "Motors and control wiring", 9],
    [7, "Special occupancies and hazardous locations", 9], [8, "Load calculations", 11],
    [9, "Appliances, equipment, and lighting", 7], [10, "General definitions and installation", 3],
    [11, "Law, business, plans, NFPA 72 (mixed, no fixed subcounts)", 15]
  ];

  // Coaching gates (separate from the Board's 70% pass line).
  g.NC.gates = { mockPct: 82, mockCount: 2, maxMinutes: 360, categoryFloor: 70, adequateSample: 15, week4Pct: 75, lookupSeconds: 90 };

  // Active calendar: Harrison's Oct 25 condensed schedule (supersedes the Sept 28 dated rows for pacing).
  g.NC.calendar = [
    { from: "2026-10-26", to: "2026-10-31", title: "Week 1 · Setup, index, grounding, OCP, wiring", detail: "Mon-Thu two 1-hour blocks (7 and 8 PM). Index/tab orientation (NFPA link until the paper book lands), Art. 250 grounding and bonding, Art. 240 overcurrent, Ch. 3 wiring methods, each with practice problems. Sat Oct 31: 25-question diagnostic + timed calculations warm-up." },
    { from: "2026-11-01", to: "2026-11-01", title: "Sunday off", detail: "Rest day." },
    { from: "2026-11-02", to: "2026-11-07", title: "Week 2 · Diagnostic repair, services, loads, ampacity, motors", detail: "Weak-spot review from the diagnostic, index/tab fluency with the physical book, services and feeder calcs, branch-circuit and load calcs, ampacity/derating/voltage drop, motors and transformers. Sat: two timed calculation blocks." },
    { from: "2026-11-08", to: "2026-11-08", title: "Sunday off", detail: "Rest day." },
    { from: "2026-11-09", to: "2026-11-14", title: "Week 3 · Boxes, raceways, fill, load-calc review", detail: "Boxes, raceways and fill, dwelling and commercial load-calc review, motor and transformer practice, calculation weak-spot review. Sat: timed calculation set." },
    { from: "2026-11-15", to: "2026-11-15", title: "Sunday off", detail: "Rest day." },
    { from: "2026-11-16", to: "2026-11-21", title: "Week 4 · Special occupancies, equipment, NFPA 72 basics", detail: "Special occupancies and hazardous locations, special equipment and conditions, appliances, lighting and general-use equipment, NFPA 72 basics. Sat: timed practice + breadth weak-spot review." },
    { from: "2026-11-22", to: "2026-11-22", title: "Sunday Nov 22 · One timed set", detail: "One timed practice set." },
    { from: "2026-11-23", to: "2026-11-28", title: "Week 5 · NC law, NASCLA business, full-length run", detail: "NC licensing law, NASCLA business and project management, timed practice with every miss logged by topic, breadth review (plans, services and feeders), miss-list review. Thanksgiving off. Sat Nov 28: full-length timed practice run." },
    { from: "2026-11-29", to: "2026-11-29", title: "Sunday off", detail: "Rest day." },
    { from: "2026-11-30", to: "2026-12-04", title: "Week 6 · Miss list, weak topics, plans, final tab check", detail: "Full miss-list review, weak-topic final pass, plan-reading practice, final tab/index check on the exact books going into the room." },
    { from: "2026-12-05", to: "2026-12-05", title: "CRAM Saturday Dec 5", detail: "Weakest topics + full miss list, high-volume timed sets. Lay out books and ID. PSI cancel cutoff is 10:00 AM today." },
    { from: "2026-12-06", to: "2026-12-06", title: "CRAM Sunday Dec 6", detail: "Rapid-fire formulas, key tables, index speed. Hard stop in the evening, early lights-out. Protect sleep: the 6-hour exam is the performance." },
    { from: "2026-12-07", to: "2026-12-07", title: "EXAM DAY", detail: "5:00 AM 45-minute rapid review, then the exam 10:00 AM to 4:00 PM at PSI Charlotte Tyvola. Arrive by 9:30. Save the result; identify the Board licensing/upgrade step." }
  ];

  g.NC.arc = [
    "The diagnostic steers everything. Score by topic; weak-spot slots take whatever it flags.",
    "The miss list is the cram syllabus. Log every miss by article; Dec 5-6 works that list plus formula and table speed.",
    "Navigation is the exam. Unlimited is open-book and lookup-heavy. Find-it-fast beats rereading.",
    "Unlimited-vs-Limited deltas first: load calcs at scale, motors and transformers, special occupancies, NASCLA business and NC law.",
    "Protect Dec 6 sleep. Cramming ends in the evening, not at midnight."
  ];

  // The 47 dated sessions (Sept 28 base plan). cat codes: S speed, L law, G ground, M math, V motors, H high voltage, O occupancies, F NFPA 72, X mock
  g.NC.sessions = [
    [1, "2026-09-28", 1, 2, "S", "Books, baseline and booking", "Confirm Board authorization window (expiry is not in the Sept 10 email). Check complete 2020 NEC, 2013 NFPA 72, NASCLA 14th; compliant permanent tabs. Baseline: record score, time and two weak areas."],
    [2, "2026-09-29", 1, 2, "S", "Find the rule fast", "20 timed lookups, contents vs index. Articles 90, 100, 110 plus tabbed 210, 220, 230, 240, 250, 310, 430, 450. Record median lookup time; section, condition and exception for each miss."],
    [3, "2026-09-30", 1, 2, "S", "Branch circuits, services and protection", "20 questions across Arts. 200-240. Separate continuous-load sizing from protective-device selection. Correct each miss from the 2020 text."],
    [4, "2026-10-01", 1, 2, "S", "Conductors and terminations", "20 questions across Arts. 300-450: 110.14(C), Table 310.16, ambient correction, conductor-count adjustment, wiring methods. State insulation rating, terminal limit and conditions before selecting ampacity."],
    [5, "2026-10-02", 1, 2, "S", "Box fill, raceway fill and plans", "314.16 and 314.28 for box fill and pull space; Ch. 9 Tables 1, 4, 5 for raceway fill; Table 8 for conductor properties. One official plan-tracing exercise. Keep fill, ampacity adjustment and pull dimensions separate."],
    [6, "2026-10-05", 2, 2, "L", "QI, licensee and classification", "Recall G.S. 87 Art. 4, then verify. QI = passed classification exam AND Board certification; listed QI supervises under an issued license. Distinguish passing, QI status and license issuance."],
    [7, "2026-10-06", 2, 2, "L", "Project value and responsibilities", "21 NCAC 18B .0303, supervision and permit rules. Owner-supplied electrical materials count toward project value. Splitting contracts alone does not avoid limits. Five varied scenarios."],
    [8, "2026-10-07", 2, 2, "L", "Experience credits and licensing recall", "Handbook .0201/.0202: Unlimited = 9,000 hours incl. 8,000 primary. Map secondary credit rates 100/80/50/20/10% to activities; three credit examples; renewal, supervision, permits."],
    [9, "2026-10-08", 2, 2, "L", "NASCLA navigation and business", "Map all NASCLA 14th chapters. Contracts/change orders, insurance/workers' comp, payroll, estimating, markup vs margin, cash flow, scheduling. Recall, then locate page and verify year."],
    [10, "2026-10-09", 2, 2, "L", "Law, business, alarms and plans", "30 timed law/business questions, recall first. Five NFPA 72 index lookups, one plan-reading exercise. Record score and lookup time."],
    [11, "2026-10-12", 3, 2, "G", "GEC versus EGC", "Table 250.66 GEC (by ungrounded supply conductor size/material, electrode exceptions) vs Table 250.122 EGC (by upstream OCPD). Parallel conductors and upsizing. A service ampere label alone may not settle GEC size."],
    [12, "2026-10-13", 3, 2, "G", "Main and system bonding jumpers", "Draw service and separately derived one-lines. MBJ/SBJ under 250.24, 250.28, 250.30; sizing via 250.28(D)/250.102(C)(1). Trace neutral current vs fault-return path."],
    [13, "2026-10-14", 3, 2, "G", "Grounding above 1,000 volts", "2020 Art. 250 Part X and its over-1,000 V scope. System and equipment grounding, substation/fence cases. Code lookup is not a touch/step-potential engineering design."],
    [14, "2026-10-15", 3, 2, "G", "Impedance-grounded systems", "Compare actual scope of 250.36 with 250.187 (2020). Voltage range, neutral/impedance connection, electrode and equipment-grounding paths, monitoring. Do not transfer a lower-voltage rule."],
    [15, "2026-10-16", 3, 2, "G", "Grounding application test", "Up to 30 grounding/bonding scenarios in 90 minutes; correct and re-solve high-impact misses. State conductor function before choosing a table. Log and set a delayed retest."],
    [16, "2026-10-19", 4, 2, "M", "Load calculations: dwelling", "Full Art. 220 dwelling worksheet (2020). Pick the permitted method; classify loads; demand/noncoincident only where allowed; total VA; convert to current. Continuous-load and service/feeder checks separate."],
    [17, "2026-10-20", 4, 2, "M", "Load calculations: commercial", "Commercial/industrial feeder and service loads under Art. 220: occupancy lighting values, demand rules, motor contribution. Three-phase: S(kVA) = sqrt(3) x V_LL x I / 1000. Distinguish kVA, kW and PF."],
    [18, "2026-10-21", 4, 2, "M", "Wye, delta and transformer current", "Wye: V_LL = sqrt(3) V_ph, I_line = I_ph. Delta: V_LL = V_ph, I_line = sqrt(3) I_ph. Primary and secondary current separately: I = 1000 kVA / (sqrt(3) V_LL). Then OCP, conductors, grounding as separate decisions."],
    [19, "2026-10-22", 4, 2, "M", "Transformer fault-current estimate", "I_SC = I_FL / (Z%/100). 5.75% becomes 0.0575. Three-phase bolted fault at the secondary, stiff source; upstream and conductor impedance and motor contribution treated separately."],
    [20, "2026-10-23", 4, 2, "X", "Fresh mixed checkpoint", "30 fresh mixed questions, 90 minutes, then 30 minutes to grade and find two largest gaps. Target 75%+. Record sample size and exposure."],
    [21, "2026-10-26", 5, 2, "V", "Motor current basis and conductors", "430.6 and Tables 430.248/430.250 give motor full-load CURRENT, not ampacity. 430.22: continuous-duty branch conductor generally at least 125% of table FLC; then terminal limits, adjustment, exceptions."],
    [22, "2026-10-27", 5, 2, "V", "Motor protection: separate decisions", "Conductor, overload, branch short-circuit/ground-fault and feeder protection as separate answers. Overload uses nameplate under 430.32; branch fault 430.52; feeder 430.24/430.62."],
    [23, "2026-10-28", 5, 2, "V", "Voltage drop with stated assumptions", "Three-phase resistance approximation VD = sqrt(3) K I D / CM. D is ONE-WAY feet, I line amps, CM circular mils; K matches material/temperature. Use AC impedance and PF when asked."],
    [24, "2026-10-29", 5, 2, "S", "Equipment, lighting and coverage sweep", "Appliance, HVAC, lighting, elevator/machine-room rules; Ch. 9 Tables 8 vs 9. Check all 11 categories before Mock A and repair the biggest uncovered topic."],
    [25, "2026-10-31", 5, 6, "X", "Full mock A (six-hour block)", "Fresh full-scope 100 questions, one uninterrupted six-hour sitting, admitted books, no coaching. Record answers, time, raw score and category results. Corrections happen later."],
    [26, "2026-11-02", 6, 2, "H", "Mock A repair and higher voltage", "First hour: correct Mock A's recurring errors. Then 2020 Arts. 311 and 490 plus 110 clearances: MV conductor scope, ampacity tables/conditions, shields, equipment. Verify numbers in 2020."],
    [27, "2026-11-03", 6, 2, "O", "Hazardous locations and hangars", "Arts. 500-506, 511, 513, 514, 515, 516: class/division or zone, group, temperature, seals, boundaries. Dedicated lookups for aircraft hangars and bulk storage."],
    [28, "2026-11-04", 6, 2, "O", "Special occupancies and emergency systems", "Timed: 517 health care, 518 assembly, 520 theaters, 550 mobile homes, 680 pools, 700 emergency. 701/702 only to identify the system. 620 elevators."],
    [29, "2026-11-05", 6, 2, "X", "Repair gaps before Mock B", "Re-solve Mock A errors from blank paper; fresh questions in two weakest categories; one NFPA 72 lookup set; a plan drill. NFPA 70E is optional, not admitted."],
    [30, "2026-11-07", 6, 6, "X", "Full mock B (six-hour block)", "Second fresh 100-question full-scope form, six hours, same rules. Record score, time and category evidence before corrections. Exposed questions are not fresh evidence."],
    [31, "2026-11-09", 7, 2, "F", "NFPA 72 systems and navigation", "2013 NFPA 72 chapters 10, 12, 14, 17, 18, 23, 26, 29 by function. For each number record system type, condition and exact section. No later-edition substitutions."],
    [32, "2026-11-10", 7, 2, "F", "Detection, door release and plans", "Verify detector placement and door-release requirements in the 2013 text. Plan-reading: trace circuits, symbols, notes, schedules. Log the evidence location."],
    [33, "2026-11-11", 7, 2, "X", "Mixed calculations under time", "20 timed calc questions: loads, transformers, motors, GEC/EGC/bonding jumpers, fill, voltage drop. Label units, reference, current basis, assumptions before arithmetic."],
    [34, "2026-11-12", 7, 2, "X", "Mock B repair and readiness decision", "Correct B, delayed retest of recurring errors, inspect category coverage. Gate: two fresh full mocks at 82%+ in six hours, no persistent category below 70%."],
    [35, "2026-11-14", 7, 6, "X", "Full mock C (six-hour block)", "Third fresh full-scope form, one sitting, admitted books only. Record actual results, not a completion inferred from the date."],
    [36, "2026-11-16", 8, 2, "X", "Mock C correction and delayed recall", "Grade and source-check C; correct every significant miss; re-solve recurring errors without the old solution. Mastered only after two clean delayed re-solves on separate days."],
    [37, "2026-11-17", 8, 2, "L", "Law and business final polish", "Recall QI/licensee duties, project value, renewal, permits, contracts, bonds/insurance, estimating, payroll; locate NASCLA 14th pages. Recheck handbook and PSI confirmation."],
    [38, "2026-11-18", 8, 2, "X", "Mixed precision and weak-area sets", "Review readiness evidence after C. Fresh short sets in weak areas, delayed retests. No new six-hour exam this week."],
    [39, "2026-11-19", 8, 2, "S", "Table navigation and light review", "Known mistakes plus Tables 250.66, 250.102(C)(1), 250.122, 310.16, 430.248/430.250, Ch. 9; NFPA 72 and NASCLA page navigation. Stop early if retrieval is clean."],
    [40, "2026-11-21", 9, 6, "X", "Buffer: full mock D (six-hour block)", "Fourth fresh full-scope form, six hours. If none is available, timed 50 fresh mixed questions plus correction. Never repeat an exposed form as a readiness score."],
    [41, "2026-11-23", 9, 2, "X", "Buffer: Mock D correction and readiness review", "Grade D, correct misses. Readiness review 14 days out: two fresh full mocks at 82%+ and no category under 70%? Pick the two weakest categories for the final ten days."],
    [42, "2026-11-24", 9, 2, "S", "Buffer: weakest two categories", "Targeted fresh questions in the two weakest categories; re-solve recurring misses cold. Then Thanksgiving week off (optional 20-minute recall)."],
    [43, "2026-11-30", 10, 2, "L", "Buffer: law, business and NFPA 72 refresh", "Recall QI duties, limits, permits, contracts, bonds/insurance, payroll; NASCLA pages; short 2013 NFPA 72 navigation drill. Recheck handbook and PSI confirmation."],
    [44, "2026-12-01", 10, 2, "M", "Buffer: mixed calculations, fresh short set", "20 fresh timed calc questions (loads, transformers, motors, GEC/EGC, fill, voltage drop). Label units, reference and assumptions first; correct and log misses."],
    [45, "2026-12-02", 10, 1.5, "X", "Buffer: date-change decision and delayed retests", "Dec 2 is your 5-day personal margin. PSI cutoff is Sat Dec 5, 10:00 AM. Review evidence; delayed retests. No new six-hour exam."],
    [46, "2026-12-03", 10, 1.5, "S", "Buffer: table navigation and light review", "Known mistakes, key tables, NFPA 72 and NASCLA page navigation. Stop early if retrieval is clean."],
    [47, "2026-12-04", 10, 0.5, "X", "Stand down and pack", "No study. Confirm Dec 7 10:00 AM appointment and route; pack the three admitted books and two valid signed IDs (one government photo). Arrive by 9:30."]
  ];
  g.NC.catNames = { S: "Code speed", L: "Law and business", G: "Grounding/bonding", M: "Math/transformers", V: "Motors/VD", H: "High voltage", O: "Special occupancies", F: "NFPA 72", X: "Mock/checkpoint" };

  g.NC.verification = [
    "Board authorization start and expiry dates (the Sept 10 eligibility email gives no expiry; Dec 9 was an old inference, not a limit).",
    "2020 NEC: check edition-sensitive values and exceptions in the book: ampacity, box-fill grounds, GFCI scope, service disconnects, lighting factors, higher voltage.",
    "2013 NFPA 72: complete the numerical worksheet (system type, number, unit, condition, exception, exact section).",
    "NASCLA 14th: add page references to the 60 law/business cards; read every chapter.",
    "Sample assumptions: lighting-duty in official Q22-23, receptacle/duty in Q26 stay explicit.",
    "Fresh practice: obtain full forms with separate keys; record your own timed results."
  ];
})(typeof window !== "undefined" ? window : globalThis);
