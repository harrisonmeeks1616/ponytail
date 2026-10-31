// NEC 2020 / NFPA 72 (2013) quick reference for the NC Unlimited app.
// STATUS: NOTHING HERE IS VERIFIED AGAINST THE 2020 NEC TEXT. Built 2026-10-31 without access to the code book.
//   conf "S" = search-corroborated: several independent secondary summaries agreed (still not the code text).
//   conf "R" = recalled: general code knowledge, not corroborated in this session.
// The exam answers come from YOUR designated book. The app lets you tick "verified in my book" per row and record the page.
(function (g) {
  g.NC = g.NC || {};
  const N = (g.NC.nec = {});

  N.status = "Not verified against the 2020 NEC. Confidence tags: S = several secondary sources agreed, R = recalled and not corroborated. Check every value in your own bound 2020 book and tick it off.";

  // Table 240.6(A) standard ampere ratings
  N.std = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000, 5000, 6000];

  // Conductor sizes with area in kcmil (for GEC and voltage-drop CM). AWG areas are the Chapter 9 Table 8 values.
  N.kcmil = { "14": 4.11, "12": 6.53, "10": 10.38, "8": 16.51, "6": 26.24, "4": 41.74, "3": 52.62, "2": 66.36, "1": 83.69, "1/0": 105.6, "2/0": 133.1, "3/0": 167.8, "4/0": 211.6 };
  const kc = (s) => (N.kcmil[s] != null ? N.kcmil[s] : parseFloat(s));
  N.size = kc;

  // Table 310.16 allowable ampacities, not more than three current-carrying conductors, 30C ambient. [60C, 75C, 90C]
  N.t31016 = {
    cu: { "14": [15, 20, 25], "12": [20, 25, 30], "10": [30, 35, 40], "8": [40, 50, 55], "6": [55, 65, 75], "4": [70, 85, 95], "3": [85, 100, 115], "2": [95, 115, 130], "1": [110, 130, 145], "1/0": [125, 150, 170], "2/0": [145, 175, 195], "3/0": [165, 200, 225], "4/0": [195, 230, 260], "250": [215, 255, 290], "300": [240, 285, 320], "350": [260, 310, 350], "400": [280, 335, 380], "500": [320, 380, 430], "600": [350, 420, 475], "700": [385, 460, 520], "750": [400, 475, 535], "800": [410, 490, 555], "900": [435, 520, 585], "1000": [455, 545, 615], "1250": [495, 590, 665], "1500": [525, 625, 705], "1750": [545, 650, 735], "2000": [555, 665, 750] },
    al: { "12": [15, 20, 25], "10": [25, 30, 35], "8": [35, 40, 45], "6": [40, 50, 55], "4": [55, 65, 75], "3": [65, 75, 85], "2": [75, 90, 100], "1": [85, 100, 115], "1/0": [100, 120, 135], "2/0": [115, 135, 150], "3/0": [130, 155, 175], "4/0": [150, 180, 205], "250": [170, 205, 230], "300": [195, 230, 260], "350": [210, 250, 280], "400": [225, 270, 305], "500": [260, 310, 350], "600": [285, 340, 385], "700": [315, 375, 425], "750": [320, 385, 435], "800": [330, 395, 445], "900": [355, 425, 480], "1000": [375, 445, 500], "1250": [405, 485, 545], "1500": [435, 520, 585], "1750": [455, 545, 615], "2000": [470, 560, 630] }
  };
  N.t31016conf = "R"; // 4 AWG row (70/85/95) and 250/300 kcmil Cu rows also appear in your Notion worked examples (255/285 at 75C, 290/320 at 90C).

  // Table 310.15(C)(1): adjustment for more than three current-carrying conductors in a raceway/cable over 24 in.
  N.adj = [[1, 3, 100], [4, 6, 80], [7, 9, 70], [10, 20, 50], [21, 30, 45], [31, 40, 40], [41, 9999, 35]];
  N.adjConf = "S";

  // Table 310.15(B)(1): ambient correction for 30C base. rows [maxC, f60, f75, f90]; null = not permitted for that column
  N.ambient = [[25, 1.08, 1.05, 1.04], [30, 1.0, 1.0, 1.0], [35, 0.91, 0.94, 0.96], [40, 0.82, 0.88, 0.91], [45, 0.71, 0.82, 0.87], [50, 0.58, 0.75, 0.82], [55, 0.41, 0.67, 0.76], [60, null, 0.58, 0.71], [65, null, 0.47, 0.65], [70, null, 0.33, 0.58]];
  N.ambientConf = "R";

  // Table 250.66: GEC size by largest ungrounded conductor. Rows keyed by area ceiling in kcmil: [ceiling, Cu GEC, Al GEC]
  N.t25066 = {
    cu: [[66.36, "8", "6"], [105.6, "6", "4"], [167.8, "4", "2"], [350, "2", "1/0"], [600, "1/0", "3/0"], [1100, "2/0", "4/0"], [1e9, "3/0", "250"]],
    al: [[105.6, "8", "6"], [167.8, "6", "4"], [250, "4", "2"], [500, "2", "1/0"], [900, "1/0", "3/0"], [1750, "2/0", "4/0"], [1e9, "3/0", "250"]]
  };
  N.t25066labels = { cu: ["2 or smaller", "1 or 1/0", "2/0 or 3/0", "over 3/0 through 350", "over 350 through 600", "over 600 through 1100", "over 1100"], al: ["1/0 or smaller", "2/0 or 3/0", "4/0 or 250", "over 250 through 500", "over 500 through 900", "over 900 through 1750", "over 1750"] };
  N.t25066conf = "R"; // the 3/0-350 -> 2 Cu and 350-600 -> 1/0 Cu rows were also recalled independently by a search summary; no source printed them.

  // Table 250.122: EGC size by rating/setting of the automatic OCPD ahead of the equipment (not exceeding). [OCPD, Cu, Al]
  N.t250122 = [[15, "14", "12"], [20, "12", "10"], [60, "10", "8"], [100, "8", "6"], [200, "6", "4"], [300, "4", "2"], [400, "3", "1"], [500, "2", "1/0"], [600, "1", "2/0"], [800, "1/0", "3/0"], [1000, "2/0", "4/0"], [1200, "3/0", "250"], [1600, "4/0", "350"], [2000, "250", "400"], [2500, "350", "600"], [3000, "400", "600"], [4000, "500", "750"], [5000, "700", "1200"], [6000, "800", "1200"]];
  N.t250122conf = "R"; // 200 A -> 6, 400 A -> 3, 600 A -> 1, 2000 A -> 250 Cu agreed with search summaries; Al column least certain.

  // Table 314.16(B): volume allowance per conductor, cubic inches
  N.box = { "18": 1.5, "16": 1.75, "14": 2.0, "12": 2.25, "10": 2.5, "8": 3.0, "6": 5.0 };
  N.boxConf = "S";

  // Chapter 9 Table 1 percent fill; Table 4 areas are not reproduced here: use your book.
  N.fill = [["1 conductor", 53], ["2 conductors", 31], ["over 2 conductors", 40]];

  // Table 430.52 maximum rating or setting of motor branch-circuit short-circuit and ground-fault protective devices, % of FLC (squirrel-cage, single-phase, polyphase)
  N.t43052 = [["Nontime delay fuse", 300], ["Dual-element (time-delay) fuse", 175], ["Instantaneous-trip breaker", 800], ["Inverse-time breaker", 250]];
  N.t43052conf = "S";

  // Table 220.12 general lighting load, VA per square foot (verify exact occupancy list in the book)
  N.t22012 = [["Dwelling units", 3], ["Hospitals", 2], ["Hotels and motels, including apartment houses without provision for cooking by tenants", 2], ["Offices", 3.5], ["Banks", 3.5], ["Restaurants", 2], ["Schools", 3], ["Stores", 3], ["Barber shops and beauty parlors", 3], ["Industrial commercial (loft) buildings", 2], ["Clubs", 2], ["Court rooms", 2], ["Churches", 1], ["Armories and auditoriums", 1], ["Lodge rooms", 1.5], ["Garages, commercial (storage)", 0.5], ["Warehouses (storage)", 0.25], ["Corridors, closets, stairways (not one-family dwellings)", 0.5], ["Storage spaces (not one-family dwellings)", 0.25]];
  N.t22012conf = "R";

  // Table 220.42 dwelling lighting demand (applied to general lighting + small appliance + laundry)
  N.t22042 = [[3000, 100], [120000, 35], [1e12, 25]];
  N.t22042conf = "S";

  // rules: [id, group, section, text, conf, note]
  N.groups = ["Grounding and bonding", "Overcurrent protection", "Conductors and terminations", "Boxes and raceways", "Services", "Motors", "Load calculations", "Transformers", "Special occupancies", "NFPA 72 (2013)", "Edition traps"];
  N.rules = [
    // grounding 0
    ["g1", 0, "250.66(A)", "GEC to a rod, pipe or plate electrode is not required to be larger than 6 AWG copper or 4 AWG aluminum, and that limit covers only the portion of the GEC that serves those electrodes.", "R", "Do not carry the No. 6 limit to a common GEC that also serves other electrode types."],
    ["g2", 0, "250.66(B)", "GEC to a concrete-encased electrode is not required to be larger than 4 AWG copper.", "R", ""],
    ["g3", 0, "250.66(C)", "GEC to a ground ring is not required to be larger than the ring conductor.", "R", ""],
    ["g4", 0, "250.52(A)(3)", "Concrete-encased electrode: at least 20 ft of one or more bare or zinc-galvanized steel reinforcing bars 1/2 in or larger, or at least 20 ft of bare copper 4 AWG or larger, encased by at least 2 in of concrete near the bottom of the foundation.", "R", ""],
    ["g5", 0, "250.52(A)(5), 250.53(A)(2)", "Rod electrode: at least 8 ft in contact with the soil. A single rod, pipe or plate must be supplemented by an additional electrode unless it has 25 ohms or less to earth.", "R", "Confirm the supplemental-electrode wording in 2020."],
    ["g6", 0, "250.102(C)(1), 250.28(D), 250.24(C)", "Supply-side bonding jumper, main or system bonding jumper, and the grounded-conductor minimum are sized from the Table 250.66 pattern by the largest ungrounded conductor; above 1100 kcmil copper or 1750 kcmil aluminum the bonding jumper is not less than 12.5% of the largest ungrounded conductor area.", "R", "Do not size these from Table 250.122."],
    ["g7", 0, "250.122(A), (B), (F)", "EGC from Table 250.122 by the OCPD ahead of the equipment; not required larger than the circuit conductors; increased proportionally when the ungrounded conductors are upsized for voltage drop; each parallel set needs its own full-size EGC.", "R", ""],
    ["g8", 0, "250.30(A)", "A separately derived system gets one system bonding jumper, at the source or at the first disconnecting means, not both.", "R", "A generator is separately derived only if its neutral is actually switched or not solidly connected to another source."],
    // OCP 1
    ["o1", 1, "240.4(B)", "The next higher standard OCPD rating is permitted for conductors when the ampacity does not match a standard rating, only if the rating is 800 A or less, the conductors do not supply a multioutlet receptacle branch circuit for cord-and-plug loads, and the next size up does not exceed the allowed limit.", "R", "A 250 kcmil conductor adjusted to 232 A cannot skip the 250 A size to reach 300 A."],
    ["o2", 1, "240.4(D)", "Small-conductor limits for copper: 14 AWG 15 A, 12 AWG 20 A, 10 AWG 30 A. Aluminum: 12 AWG 15 A, 10 AWG 25 A.", "R", "Applies after any adjustment and correction, subject to 240.4(E)-(G) exceptions."],
    ["o3", 1, "240.21(B)(1), (B)(2)", "Feeder tap rules: a tap of 10 ft or less needs ampacity at least 1/10 of the feeder OCPD rating and at least the load; a tap of 25 ft or less needs at least 1/3 of the feeder OCPD rating.", "R", "Read the full conditions (enclosure, termination, protection)."],
    ["o4", 1, "110.9, 110.10", "Interrupting rating must be at least the available fault current at the line terminals; equipment must also be coordinated so a fault does not damage it beyond its rating (110.10).", "R", "Not the same as the ampere rating."],
    ["o5", 1, "210.19(A)(1), 210.20(A), 215.2(A)(1), 230.42(A)", "Continuous loads: conductors and OCPD sized for 125% of the continuous load plus 100% of the noncontinuous load, unless the assembly is listed for 100%.", "R", "Three checks stay separate: sizing at terminals, adjusted ampacity against actual load, and conductor protection."],
    ["o6", 1, "Informational notes to 210.19, 215.2", "The 3% branch-circuit and 5% total voltage-drop figures are informational notes, not mandatory requirements.", "R", "Informational notes are not enforceable unless adopted."],
    // wiring 2
    ["w1", 2, "110.14(C)(1)", "Termination temperature: for circuits of 100 A or less, or conductors 14 AWG through 1 AWG, use the 60C column unless the equipment is listed and marked for 75C; for more than 100 A or conductors larger than 1 AWG, use the 75C column unless otherwise permitted.", "R", "A 90C insulation rating can be used for correction and adjustment, but the termination caps the final ampacity."],
    ["w2", 2, "310.15(C)(1)", "Adjustment factors for more than three current-carrying conductors apply when conductors are installed in a raceway or cable for more than 24 in; they do not apply to raceways 24 in or shorter. Only power and lighting conductors of mixed systems count.", "S", "Neutral counting is in 310.15(E) in 2020 (your Notion route cites (E)(3)): a neutral carrying only unbalanced current is not counted; neutrals carrying nonlinear harmonic current are counted."],
    ["w3", 2, "Table 310.16, 310.15(B)(1)", "2020 numbering: Table 310.16 (ampacities), Table 310.15(B)(1) (ambient correction), Table 310.15(C)(1) (adjustment). In the 2017 code the ampacity table was 310.15(B)(16) and adjustment was 310.15(B)(3)(a).", "R", "One search summary disagreed about which edition renumbered the table. Use your 2020 contents page."],
    ["w4", 2, "Chapter 9 Table 1, Note 4", "Raceway fill: 53% for one conductor, 31% for two, 40% for over two. Conduit and tubing nipples not exceeding 24 in may be filled to 60%.", "R", "Fill is a space calculation, separate from ampacity adjustment."],
    ["w5", 2, "Table 300.5", "Minimum cover (in): direct-buried cables 24; rigid metal and IMC conduit 6; nonmetallic raceways listed for direct burial 18; residential branch circuits 120 V, 20 A or less with GFCI 12; low-voltage landscape lighting 6. Cover under streets, roads and driveways is greater.", "R", "Read the table notes and the street/driveway column."],
    // boxes 3
    ["b1", 3, "314.16(B)(1)-(5)", "Box fill counts: each conductor that originates and ends in the box counts 1; an unbroken conductor passing through counts 1; a loop at least twice the minimum length required in 300.14 counts 2; each device yoke counts 2 based on the largest conductor connected; internal cable clamps count 1 total based on the largest conductor; fixture studs or hickeys count 1 each type; conductors that stay wholly inside the box (jumpers) are not counted.", "S", ""],
    ["b2", 3, "314.16(B)(5)", "Equipment grounding conductors: in the 2020 text all EGCs and equipment bonding jumpers entering the box are counted as a single volume allowance based on the largest EGC; an additional set under 250.146(D) (isolated grounds) adds one more allowance.", "R", "Search results disagreed on which edition introduced the single-allowance wording versus a 1/4 allowance for each extra EGC. This is the 2020-sensitive item your plan flags: verify it first."],
    ["b3", 3, "314.28(A)(1)", "Straight pull: the box length is at least 8 times the trade size of the largest raceway.", "R", ""],
    ["b4", 3, "314.28(A)(2)", "Angle or U pull: at least 6 times the largest raceway plus the sum of the other raceway trade sizes on the same wall; distance between raceway entries enclosing the same conductor is at least 6 times the largest raceway.", "R", "Check every wall and row. Over 1,000 V is 314.71."],
    // services 4
    ["s1", 4, "230.79(C)", "A one-family dwelling service disconnect is rated not less than 100 A, 3-wire.", "R", ""],
    ["s2", 4, "230.71", "A service may have up to six disconnecting means (switches or breakers) grouped in one location.", "R", ""],
    ["s3", 4, "230.24(B)", "Service conductor clearances over finished grade: 10 ft (not over 150 V to ground, pedestrian access); 12 ft (residential property and driveways); 15 ft (areas subject to truck traffic); 18 ft (public streets, alleys, roads).", "R", ""],
    ["s4", 4, "230.95", "Ground-fault protection of equipment: solidly grounded wye service over 150 V to ground and not over 1000 V phase to phase, with a service disconnect of 1000 A or more. Maximum setting 1200 A; maximum time delay 1 second at 3000 A or more.", "R", ""],
    // motors 5
    ["m1", 5, "430.6(A)(1)", "Use Table 430.247 to 430.250 full-load current for conductor ampacity and for branch-circuit short-circuit and ground-fault protection and disconnect sizing; use nameplate current for overload protection (430.32), subject to the exceptions.", "R", "Not 'never use nameplate': read the exceptions."],
    ["m2", 5, "430.22", "Single continuous-duty motor branch conductor: at least 125% of table FLC.", "R", "Then check terminals and adjustment."],
    ["m3", 5, "430.24", "Motor feeder: 125% of the largest motor FLC plus the sum of the FLCs of the other motors plus other loads.", "R", ""],
    ["m4", 5, "430.32(A)(1)", "Overload: 125% of nameplate for motors with a marked service factor of 1.15 or more or a temperature rise of 40C or less; 115% for other motors. 430.32(C) allows up to 140% and 130% where the first setting will not start the motor.", "R", ""],
    ["m5", 5, "430.52(C)(1), Table 430.52", "Branch-circuit protective device maximums as percent of FLC: nontime-delay fuse 300; dual-element fuse 175; instantaneous-trip breaker 800; inverse-time breaker 250. If the value does not match a standard size, the next higher standard size is permitted. Starting exceptions raise dual-element fuses to 225% and inverse-time breakers to 400% (FLC 100 A or less) or 300% (over 100 A).", "S", "Search summaries disagreed on exception numbering. A source claiming 1300% for instantaneous-trip breakers is the Design B energy-efficient starting exception, not the base table: verify."],
    ["m6", 5, "430.62(A)", "Motor feeder short-circuit and ground-fault protection: the largest branch-circuit device rating or setting plus the sum of the FLCs of the other motors and other loads.", "R", ""],
    ["m7", 5, "430.110(A)", "Disconnect ampere rating at least 115% of the motor full-load current (or horsepower rated per 430.109).", "R", "A controller is not automatically the disconnect."],
    // loads 6
    ["l1", 6, "220.42", "Dwelling general lighting demand: first 3,000 VA at 100%, 3,001 to 120,000 VA at 35%, over 120,000 VA at 25%. Applied to the combined general lighting, small-appliance and laundry load.", "S", "Common error: applying 35% to the whole total."],
    ["l2", 6, "220.52", "Small appliance branch circuits: at least two 20 A circuits at 1,500 VA each; laundry circuit at least 1,500 VA.", "R", ""],
    ["l3", 6, "220.53", "Four or more fixed appliances (not ranges, dryers, HVAC) on the same feeder: 75% demand.", "R", ""],
    ["l4", 6, "220.54", "Household electric dryer: 5,000 W or nameplate rating, whichever is larger.", "R", ""],
    ["l5", 6, "Table 220.55", "One household range of 12 kW or less: 8 kW demand in Column C; ranges over 12 kW up to 27 kW: increase Column C by 5% for each kW (or major fraction) over 12.", "S", ""],
    ["l6", 6, "220.56", "Commercial kitchen equipment demand: 1 or 2 units 100%, 3 units 90%, 4 units 80%, 5 units 70%, 6 or more 65%.", "R", ""],
    ["l7", 6, "220.61", "Neutral demand: first 200 A at 100%, the portion over 200 A at 70%; no reduction for the neutral of a 4-wire wye feeding nonlinear loads.", "R", ""],
    ["l8", 6, "220.82", "Optional dwelling method: first 10 kVA of general loads at 100%, the remainder at 40%, plus the larger of the heating or cooling load per 220.82(C).", "R", "Confirm the heating and cooling percentages in the 2020 table."],
    ["l9", 6, "220.14(I), 220.44, 220.14(K)", "Nondwelling receptacles: 180 VA per yoke or strap; 220.44 demand: first 10 kVA at 100%, remainder at 50%. Banks and offices use the greater of receptacle count at 180 VA or 1 VA per square foot.", "R", "Confirm 220.14(K) wording in 2020."],
    ["l10", 6, "220.18, 215.2", "Continuous load 125% belongs to the conductor or device sizing check. Do not also multiply a demand-calculated load a second time.", "R", ""],
    // transformers 7
    ["t1", 7, "450.3(B)", "Transformers 1000 V or less, primary-only protection: 125% of rated primary current for 9 A or more (next higher standard size permitted); 167% for under 9 A; 300% for under 2 A. With secondary protection, the primary can be up to 250% and the secondary 125% (9 A or more).", "R", "Calculate primary and secondary currents separately. Secondary conductors are protected under Article 240 rules, not by Article 450."],
    // special 8
    ["p1", 8, "500.5", "Class I: flammable gases, vapors. Class II: combustible dust. Class III: ignitible fibers or flyings. Division 1: hazard present under normal operation or frequent maintenance; Division 2: not normally present. Groups: Class I A acetylene, B hydrogen, C ethylene, D propane/gasoline; Class II E metal dust, F carbon dust, G grain dust.", "R", "Never infer a boundary from a building name."],
    ["p2", 8, "501.15(A)", "Class I Division 1 conduit seals within 18 in of an enclosure with arcing or high-temperature devices, and at classified boundaries where required.", "R", "Exact seal distances and exceptions vary by location: verify before use."],
    ["p3", 8, "700.12, 701.12, Article 702", "Emergency systems (700): power available within 10 seconds. Legally required standby (701): within 60 seconds. Optional standby (702): no required transfer time.", "S", "Battery duration: sources disagreed (90 minutes for unit equipment versus 2 hours for other storage batteries). Verify 700.12 in the book."],
    ["p4", 8, "680.22(A)", "Pool receptacles: at least one 125 V receptacle between 6 ft and 20 ft from the inside wall of the pool, and 125 V, 15 and 20 A receptacles within 20 ft GFCI protected.", "R", ""],
    ["p5", 8, "680.26", "Equipotential bonding grid: bonded parts connected with solid copper conductor not smaller than 8 AWG.", "R", ""],
    // NFPA 72 9
    ["f1", 9, "NFPA 72-2013 spot detectors", "Smooth ceiling smoke detector listed spacing 30 ft nominal; the 0.7 rule: every point on the ceiling within 0.7 times the 30 ft spacing (21 ft) of a detector. In a 10 ft corridor this can stretch spacing toward 41 ft.", "S", "Secondary sources, edition mixed. Read the 2013 chapter 17 text and exceptions (height, beams, door release)."],
    ["f2", 9, "NFPA 72-2013 17.14.5", "Manual fire alarm box operable part 42 in minimum and 48 in maximum above the floor.", "S", "Section number came from a city permit sheet quoting the 2013 edition."],
    ["f3", 9, "NFPA 72-2013 10.6.7.2", "Secondary power: 24 hours standby plus 5 minutes of alarm; 15 minutes at maximum connected load for emergency voice systems.", "S", "Battery derating factor (1.20 vs 1.25) was not settled: use the book."]
  ];

  // Edition traps (Notion plan + search)
  N.traps = [
    "Article 220 was reorganized between 2020 and 2023. Use 2020 section numbers.",
    "Ampacity table numbering: 2017 Table 310.15(B)(16); 2020 Table 310.16.",
    "Higher-voltage material is organized differently in 2023: do not use its headings as a 2020 map.",
    "Box-fill EGC counting changed around 2020. Verify the 2020 wording before using any shortcut.",
    "GFCI scope and service-disconnect arrangements also moved between editions: confirm in 2020.",
    "Informational notes (such as 3% and 5% voltage drop) are not mandatory text.",
    "A free-access web view, a 2023 PDF or a vendor chart is not the designated book: your exam answer comes from the 2020 NEC."
  ];

  // Not yet covered: needs a primary source or your book before it goes in the app
  N.gaps = ["Article 490 and 311 numbers (medium voltage)", "Part X of Article 250 (over 1000 V grounding) numbers", "Articles 511, 513, 514, 515, 516 classification distances", "Article 517 essential electrical system detail", "Articles 518, 520, 550, 620 numbers", "Chapter 9 Tables 4, 5, 8, 9 values", "Table 430.247 to 430.250 motor full-load currents", "NFPA 72 heat detector spacing, notification candela and sound levels, test frequency tables"];
})(typeof window !== "undefined" ? window : globalThis);
