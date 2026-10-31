// Source: Harrison OS Notion, Electrical Study Guide + Fire Alarms & Plan Reading + Optional Starter. Study explanations only:
// confirm final numerical values, exceptions and citations in the 2020 NEC / 2013 NFPA 72 before relying on them.
(function (g) {
  g.NC = g.NC || {};

  // id, name, approx questions, purpose, definitions[], sections, lookup path, common mistake, demonstrate
  g.NC.categories = [
    { id: 1, name: "Bonding and grounding", q: 11, purpose: "Build the correct fault-current path and distinguish it from connection to earth.",
      defs: ["Grounded conductor: intentionally connected to ground, often the neutral; may carry normal load current.", "EGC: the fault-return path joining normally non-current-carrying metal parts; not for normal load current.", "GEC: connection from the system/equipment to the electrode system.", "Bonding: electrical continuity between conductive parts. Main bonding jumper = service; system bonding jumper = separately derived system.", "Separately derived system: a supply with no direct circuit-conductor connection to another source except grounding/bonding connections. A generator's status depends on the actual conductor connections, including neutral switching."],
      sections: "Systems requiring grounding, connection location, conductor identification, electrode types, jumper/GEC/EGC sizing, bonding grids, terminals, ground-fault protection, low- vs higher-voltage rules.",
      path: "Article 100 > Article 250. Separate the GEC table (250.66), supply-side jumper provisions (250.102) and EGC table (250.122); read each provision's conditions.",
      mistake: "Using a breaker-based EGC table to size a GEC, or treating a ground rod as the effective fault-return path.",
      demo: "Trace a service fault back to its source, then explain how the path changes at a downstream panel and an isolated transformer secondary." },
    { id: 2, name: "Overcurrent protection", q: 9, purpose: "Select protection appropriate to the conductor, equipment and type of abnormal current.",
      defs: ["Overload: excessive current long enough to cause overheating; a short circuit or ground fault is different.", "Short circuit: unintended connection between points at different potentials.", "Ground fault: unintended connection from an ungrounded conductor to grounded metal or earth.", "Interrupting rating: the maximum fault current a device is identified to interrupt at rated voltage; not the ampere rating that carries load.", "SCCR concerns an assembly's short-circuit capability; it is not a breaker's ampere rating."],
      sections: "Circuit location, sizing, breakers, plug/cartridge fuses, enclosures, accessible locations, higher-voltage protection.",
      path: "Articles 100, 110 and 240, then the equipment article (430, 440, etc.).",
      mistake: "Applying a next-standard-size allowance without its conditions, or assuming motor branch protection equals motor overload protection.",
      demo: "Name what each protective device protects, choose the rule, and explain any exception before selecting a standard rating." },
    { id: 3, name: "Wiring methods and terminations", q: 10, purpose: "Choose a suitable wiring system and keep adequate ampacity after installation conditions.",
      defs: ["Ampacity: allowable continuous current under conditions of use without exceeding the conductor's temperature rating.", "Correction/adjustment: factors for ambient temperature and grouped current-carrying conductors.", "Raceway fill: occupied cross-sectional area; a space calculation separate from ampacity adjustment.", "Termination limitation: the equipment terminal rating can restrict usable ampacity even when insulation is rated higher."],
      sections: "Permitted raceway/cable uses, physical protection, supports, wet/outdoor locations, wireway and conduit fill, conductor properties, cabinets/panelboards/switchboards, traveling cables/controls, higher-voltage wiring.",
      path: "110.14 > Article 300 > the specific cable/raceway article > Article 310 > Chapter 9 tables. Article 620 for elevator traveling cables.",
      mistake: "Using the 90C conductor column as permission for 90C terminals, or counting fill and current-carrying conductors identically.",
      demo: "State wiring method, environment, material/insulation, termination rating, grouped-conductor condition and governing table before calculating." },
    { id: 4, name: "Boxes and fittings", q: 7, purpose: "Provide sufficient wiring volume, bending space and access for the actual conductors and devices.",
      defs: ["Box fill: volume required by conductors plus allowances for devices, clamps, grounds, other contents.", "Pull-box sizing: dimensional space for large conductors to bend and be pulled; not the small-conductor cubic-inch method.", "Conduit body: an accessible raceway component; permission to splice and its marked capacity need separate attention."],
      sections: "Box types, covers, extension rings, supports, accessibility, fittings, conductor free length, box volume, straight/angle/U pulls.",
      path: "Article 314: 314.16 for fill, 314.28 for pull/junction dimensions; Article 300 for related installation rules.",
      mistake: "Counting every physical wire as one full allowance, applying an old grounding-conductor counting shortcut, or using the straight-pull 8x rule for an angle pull.",
      demo: "Inventory each item before totaling volume. For a pull box, draw the entries, find the largest raceway in each relevant row, and check every required dimension." },
    { id: 5, name: "Service entrance and equipment", q: 9, purpose: "Distinguish utility-service rules from feeder rules; coordinate service conductors, disconnects, protection and bonding.",
      defs: ["Service point: connection between the utility's facilities and premises wiring.", "Service conductors: between the service point and the service disconnecting means.", "Service equipment: equipment controlling and disconnecting the supply at the service.", "Feeder: circuit conductors supplying branch-circuit overcurrent devices from the service or another supply."],
      sections: "Overhead/underground installation, clearances, service-conductor size, disconnect location/grouping, equipment ratings, overcurrent protection, bonding, required ground-fault protection.",
      path: "Articles 100, 110, 220, 230 and 250; Article 225 when a feeder/branch circuit supplies another building.",
      mistake: "Applying the dwelling-service allowance to a commercial service, or treating a meter/disconnect label as proof of the service bonding point.",
      demo: "Mark service point, service disconnect, grounded conductor, bonding jumper, GEC and downstream feeder on a one-line before choosing sizes." },
    { id: 6, name: "Motors and control wiring", q: 9, purpose: "Keep the separate motor sizing and protection decisions separate.",
      defs: ["Table FLC: NEC table current used for many motor-circuit calculations, subject to exceptions.", "Nameplate current: used for overload treatment where the rule specifies it.", "Overload device: protects against sustained motor overheating.", "Branch short-circuit/ground-fault device: clears faults; motor-starting allowances explain why its rating can exceed ordinary conductor protection.", "Controller: starts, stops or regulates the motor; does not automatically satisfy every disconnect requirement."],
      sections: "Branch and feeder ampacity, overloads, fault protection, disconnect/controller size, type and location, separation of control conductors.",
      path: "Article 430. Start with 430.6 to choose the current basis, then conductor (430.22), feeder (430.24), overload (430.32), branch protection (430.52), feeder protection (430.62).",
      mistake: "Applying one multiplier and one current value to everything. 'Never use nameplate' is too absolute: 430.6 has rules and exceptions.",
      demo: "Produce separate answers for conductor, overload, branch fault protection, feeder, controller and disconnect, labelling the current source for each." },
    { id: 7, name: "Special occupancies and hazardous locations", q: 9, purpose: "Recognize when a special location supplements or modifies the general installation rules.",
      defs: ["Class: kind of hazardous material (gas/vapor, dust, fibers/flyings).", "Division: how the hazardous atmosphere can be present. Zones are an alternative framework with their own rules.", "Group/temperature marking: equipment suitability for the specific material and ignition conditions.", "Emergency system: legally required system for essential life-safety loads; distinct from optional standby."],
      sections: "General classified locations; aircraft hangars; bulk storage; finishing/spray; fuel dispensing; commercial garages; health care; assembly/theaters; mobile homes/parks; pools; emergency systems.",
      path: "Articles 500-506, 511, 513, 514, 515, 516, 517, 518, 520, 550, 680, 700.",
      mistake: "Guessing a classified boundary from the building name, skipping Article 515 bulk storage, or calling every generator an Article 700 system.",
      demo: "Identify the exact occupancy/process and area classification, then find wiring, sealing, bonding and equipment rules for that location." },
    { id: 8, name: "Load calculations", q: 11, purpose: "Convert specified loads into the required branch, feeder or service capacity using the applicable method.",
      defs: ["Connected load: total listed loads before demand treatment.", "Demand factor: allowed relationship between calculated demand and connected load in a specified case.", "Continuous load: maximum current expected for three hours or more.", "Noncoincident loads: loads that will not operate simultaneously under conditions supporting the allowance.", "VA vs W: apparent vs real power; do not silently assume a power factor."],
      sections: "Branch circuits, computed totals, conductor ampacity, protective-device sizing, lower- and higher-voltage cases.",
      path: "Article 220 plus 210, 215, 230 and the equipment article. Pick a standard or optional method BEFORE calculating.",
      mistake: "Mixing methods, applying a demand factor twice, multiplying every load by 125%, or confusing line-to-line with line-to-neutral voltage.",
      demo: "Write inputs and units, choose the method, classify loads, apply justified factors, total VA, convert to current, then check conductor/protection. EDITION CHECK: Article 220 was reorganized between 2020 and 2023; use 2020 section numbers." },
    { id: 9, name: "Appliances, equipment and lighting", q: 7, purpose: "Identify equipment-specific requirements that modify a generic branch-circuit answer.",
      defs: ["MCA: minimum circuit ampacity marked for applicable equipment.", "MOCP/MOP: maximum permitted overcurrent protection where marked; does not mean the conductor is sized at that rating.", "Transformer primary/secondary: input and output sides, each needing its own current and protection analysis.", "Luminaire: the complete lighting unit, not just the lamp."],
      sections: "Air conditioning; residential/commercial/industrial equipment; lighting; space heating/boilers; transformers; machine rooms.",
      path: "Articles 410, 422, 424, 430, 440, 450, plus 620 for elevator machine rooms. Read listing instructions and markings.",
      mistake: "Sizing HVAC conductors from MOCP alone, treating primary protection as proof of secondary conductor protection, or carrying residential assumptions into industrial applications.",
      demo: "Identify the equipment article and nameplate inputs, then justify conductor size, protection, disconnect, grounding and installation space separately." },
    { id: 10, name: "General definitions and installation", q: 3, purpose: "Read the language of the NEC accurately enough to avoid losing questions across all categories.",
      defs: ["Shall: mandatory.", "Shall be permitted: an allowed option whose conditions still matter.", "Listed/labeled: evaluated through the product-evaluation system; apply the equipment's actual listing and instructions.", "Accessible vs readily accessible: not interchangeable; read the definition for the equipment.", "Informational note: explanatory, not a mandatory requirement."],
      sections: "Definitions, code organization, installation requirements, working space, equipment suitability, markings, instructions.",
      path: "Article 90 > Article 100 > Article 110 > the installation-specific article.",
      mistake: "Turning an informational-note recommendation into a universal mandate, or answering the installation you expect in the field instead of the facts in the question.",
      demo: "Identify scope, mandatory text, exceptions and cross-references; explain why the selected rule applies before comparing answer choices." },
    { id: 11, name: "Law, business and practical applications", q: 15, purpose: "Five source types in the largest category; the Board publishes no fixed count for each.",
      defs: ["Licensing law: G.S. Chapter 87, Article 4.", "Board rules: 21 NCAC 18B (exam, licensing, supervision, business conduct, renewal).", "Business practice: NASCLA NC Electrical 14th (planning, estimating, contracts, project management, controls).", "Plans/estimating: symbols, notes, schedules, circuit references, dimensions, quantities, scope.", "NFPA 72 (2013): fire-alarm/signaling devices, notification, pathways, operation, testing."],
      sections: "Law recall, ten NASCLA concepts, official plan questions, timed NFPA 72 lookups.",
      path: "NASCLA 14th (admitted), NFPA 72 (2013) (admitted), the official handbook plans. Statutes and rules are study sources, not admitted references.",
      mistake: "Spending all Category 11 time on law recall while neglecting NFPA 72 and the official plans. Do not label all 15 questions closed book.",
      demo: "Run law cards, ten business concepts, plan questions and timed NFPA lookups every week." }
  ];

  // Technical checks before calling a topic mastered (Exam Plan & Readiness, section 11)
  g.NC.masteryChecks = [
    ["Grounding", "Explain why a 200 A service description alone may not settle a GEC question; identify service-conductor size/material and electrode-specific provisions. Separate Tables 250.66 and 250.122 from supply-side bonding provisions."],
    ["Motors", "Four boxes on scratch paper: branch conductor, overload, branch fault protection, feeder protection. Record when table FLC or nameplate governs each. Never reuse one result for all four."],
    ["Ampacity", "Record insulation column, terminal limit, ambient correction, current-carrying count and adjustment. A neutral carrying nonlinear load can change the count. State the continuous-load assumption; do the 215.2 sizing check and the conductor-protection check separately."],
    ["Box/raceway", "Distinguish volume fill, raceway cross-section fill, ampacity adjustment and large-conductor pull-space dimensions. One answer does not establish the other three."],
    ["2020-sensitive", "Verify in 2020: box-fill grounding-conductor allowances, non-dwelling lighting factors, GFCI scope, service-disconnect arrangements, high-voltage organization. A later-edition explanation can be educational and still the wrong exam answer."],
    ["Hazardous locations", "Start with material/hazard classification, division or zone and exact boundary; THEN choose wiring, sealing, equipment, disconnects. There is no universal hazardous distance."],
    ["Transformers", "Calculate primary and secondary currents separately; then address transformer OCP, secondary conductors and grounding/bonding independently."]
  ];

  // Article-level navigation map for lookup-speed drills: [prompt, answer (article/section), note]
  g.NC.nav = [
    ["Definitions of accessible, readily accessible, listed, labeled", "Article 100", "Definitions live in 100; scope and 'shall' language in 90."],
    ["Scope, enforcement, mandatory vs permissive vs informational", "Article 90", "Informational notes are not requirements."],
    ["General installation: working space, terminations, equipment suitability", "Article 110", "110.14 terminations, 110.9 interrupting rating, 110.10 circuit impedance."],
    ["Branch-circuit requirements", "Article 210", "Continuous loads and receptacle loading rules sit here."],
    ["Feeder requirements", "Article 215", "215.2 feeder sizing."],
    ["Calculating loads (dwelling, commercial, optional methods)", "Article 220", "2020 numbering differs from 2023: use 2020."],
    ["Services (overhead/underground, disconnects, clearances)", "Article 230", ""],
    ["Overcurrent protection, standard ratings, 240.4 conductor protection", "Article 240", "240.6 standard ratings."],
    ["Grounding and bonding (GEC, EGC, bonding jumpers, electrodes)", "Article 250", "250.66 GEC; 250.122 EGC; 250.102 bonding-jumper sizing."],
    ["Outside branch circuits and feeders / second building", "Article 225", ""],
    ["Wiring methods general rules", "Article 300", ""],
    ["Conductor ampacity tables, ambient and adjustment factors", "Article 310", "Table 310.16; 310.15 correction and adjustment."],
    ["Boxes, conduit bodies, fill, pull/junction sizing", "Article 314", "314.16 box fill; 314.28 pull boxes."],
    ["Cabinets and panelboards", "Article 408", "408.36 panelboard protection limits."],
    ["Luminaires and lighting equipment", "Article 410", ""],
    ["Appliances", "Article 422", ""],
    ["Fixed electric space heating", "Article 424", ""],
    ["Motors, motor circuits and controllers", "Article 430", "430.6 current basis first."],
    ["Air-conditioning and refrigeration equipment", "Article 440", "MCA/MOCP nameplate."],
    ["Transformers", "Article 450", "Primary and secondary separately."],
    ["Hazardous (classified) locations: general frameworks", "Articles 500-506", "Class/Division vs Zone."],
    ["Commercial garages, repair and storage", "Article 511", ""],
    ["Aircraft hangars", "Article 513", "Unlimited-only per the scope columns."],
    ["Motor fuel dispensing facilities", "Article 514", ""],
    ["Bulk storage plants", "Article 515", "Explicitly in the official scope."],
    ["Spray application, dipping, coating", "Article 516", ""],
    ["Health care facilities", "Article 517", ""],
    ["Places of assembly", "Article 518", ""],
    ["Theaters, audience areas, studios", "Article 520", ""],
    ["Mobile homes, manufactured homes, mobile home parks", "Article 550", ""],
    ["Elevators, escalators and related equipment", "Article 620", "Traveling cables, machine rooms."],
    ["Swimming pools, fountains, similar installations", "Article 680", "Bonding, grounding, GFCI, underwater lighting."],
    ["Emergency systems (legally required life safety)", "Article 700", "Contrast 701 standby, 702 optional standby."],
    ["Over-1,000 V grounding (2020)", "Article 250 Part X", "Do not use 2023 reorganized headings as a 2020 map."],
    ["Medium-voltage cable and over-1,000 V equipment", "Articles 311 and 490", "Verify voltage range and numbers in 2020."]
  ];

  // NFPA 72 (2013) chapter map by function
  g.NC.nfpa = {
    defs: ["Alarm: signals a condition requiring the specified emergency response.", "Supervisory: off-normal condition in a monitored protective system or equipment.", "Trouble: a fault affecting system operation.", "Initiating device: starts a signal (detector, manual station).", "Notification appliance: communicates to occupants.", "Control interface: connects the alarm system output to another building function."],
    chapters: [["3", "Definitions", "Use the code's actual terms."], ["7", "Documentation", "Design, completion and test records."], ["10", "Fundamentals", "Power and basic system operation."], ["12", "Circuits and pathways", "Performance, monitoring, survivability."], ["14", "Inspection, testing, maintenance", "Inspection observes; testing verifies operation; maintenance preserves function."], ["17", "Initiating devices", "Detection and signal initiation."], ["18", "Notification appliances", "Audible/visible occupant notification."], ["21", "Emergency control interfaces", "Connections to controlled building functions."], ["23", "Protected-premises systems", "System operation at the protected property."], ["24", "Emergency communications", "Voice and other messaging."], ["26", "Supervising-station systems", "Remote signal receipt and handling."], ["27", "Public emergency reporting", "Public reporting-system context."], ["29", "Household alarms and systems", "Single/multiple-station and household applications."]],
    drill: "Timed NFPA drill: identify the system and device > choose the chapter > locate the rule > read the exceptions > record citation and elapsed time.",
    worksheet: [
      ["Distinguish alarm, supervisory and trouble; identify device and signal function", "3, 10", "Definition and a scenario classification"],
      ["Primary/secondary power and battery calculation", "10; system-specific chapter", "Standby/alarm durations for the stated system, currents, calculation, applicable factor"],
      ["Pathway classification, monitoring and survivability", "12", "Failure condition and required performance"],
      ["Inspection vs testing vs maintenance", "14", "Exact device, frequency/table row, responsible action"],
      ["Smoke/heat/manual initiation", "17", "Listed spacing, ceiling/obstruction conditions, location, exception"],
      ["Audible/visible notification", "18", "Occupancy/mode, sound measurement, mounting and candela/table conditions"],
      ["Control interfaces, protected premises, voice, supervising station, household", "21, 23, 24, 26, 29", "Correct system chapter and special requirement"]
    ]
  };

  // Plan reading
  g.NC.plans = {
    elements: [["Legend", "Symbol definitions for this drawing set. Check it instead of assuming your company's symbols."], ["General/keyed note", "Text governing an installation or marked location. Read before counting or sizing."], ["Panel schedule", "Circuit assignments with load/equipment data. Cross-check circuit number, panel and voltage."], ["One-line/riser", "Supply/distribution relationships. Trace source, feeder, transformer, downstream equipment."], ["Equipment schedule", "Specified equipment characteristics. Extract voltage, rating, special notes."], ["Dimension/scale", "Basis for distance or quantity. Prefer stated dimensions; confirm scale before measuring a reproduced page."], ["Takeoff", "Measured/countable quantities for the stated scope. Keep quantities, labor, waste and pricing separate."]],
    steps: ["Identify the requested output", "Point to the actual plan data", "Apply the correct rule or calculation", "Check units and scope"],
    traps: "Do not invent an unseen dimension, assume a circuit supplies an unshown load, or treat an estimate as a bid without its terms. Fixture count, lamp count, connected lamp watts and code design load are different quantities.",
    q2: { title: "Official sample Q2: trace the circuit before totalling watts", note: "Handbook printed page 69, first-floor lighting plan, start at the A5,7 home run.", rows: [["A", 12, 80], ["B", 1, 80], ["C", 1, 150], ["E", 1, 150]], total: "15 fixtures, 28 lamps, 1,340 W connected lamp watts" },
    sample: [
      ["Q10", "408.36 Exception No. 1 (2020): two main breakers/fuse sets, not service equipment, combined ratings no greater than the panelboard; retains the 42-device limit and counts each pole of a 2/3-pole breaker. Sample math: 6 x 3 + 8 x 2 = 34; 42 - 34 = 8 (answer A). Do not turn this into a universal 42-circuit limit."],
      ["Q21-23", "Actual current A: 15,000/120 + 30,000/(sqrt3 x 208) = 208.27 A. Published key 300 A / 300 kcmil is consistent with treating the lighting AND heater as continuous: 208.27 x 1.25 = 260.34 A; 75C copper 300 kcmil = 285 A OK; 90C start 320 x 0.80 = 256 A adjusted > 208.27 A; next standard fuse 300 A only if 240.4(B) conditions apply. If only the heater is continuous: 125 + 1.25 x 83.27 = 229.09 A and a 250 A / 250 kcmil result can follow. The lighting duty is an inference; keep the ambiguity visible."],
      ["Q26", "Published key 12 A (80% of 15 A). A duplex at one outlet is TWO receptacles, so multiple-receptacle loading rules can apply even with one outlet location. A single item on its own individual circuit invokes different provisions. Mark the assumption; do not memorize 'always 12'."]
    ]
  };

  // Worked examples from the study guide, used by calculators/tests
  g.NC.worked = [
    ["Balanced 3-phase current", "30,000 VA at 208 V: I = 30,000 / (sqrt3 x 208) = 83.27 A (load current, not a breaker size)."],
    ["Continuous load 125%", "40 A continuous + 20 A noncontinuous: 1.25 x 40 + 20 = 70 A (does not apply to every load or listed assembly)."],
    ["Adjusted ampacity", "Starting 100 A with factors 0.80 and 0.91 = 72.8 A. Compare with load AND terminal limit; do not round up to a breaker size without 240.4 conditions."],
    ["Motor conductor", "Table FLC 28 A continuous duty x 125% = 35 A minimum conductor ampacity before terminal checks; do NOT reuse 35 A as the overload or breaker."],
    ["Straight pull", "3-inch largest raceway: 8 x 3 = 24 inches in the pull direction (314.28(A)(1))."],
    ["Angle/U pull", "3-inch and 2-inch in the same row: 6 x 3 + 2 = 20 inches from entries to the opposite wall; also check other rows, other wall, same-conductor entry spacing, exceptions."],
    ["Transformer currents", "45 kVA 3-phase: primary at 480 V = 54.13 A; secondary at 208 V = 124.91 A. Evaluate OCP, primary conductors, secondary conductors, grounding separately."],
    ["Transformer fault estimate", "1,000 kVA at 480 V: I_FL = 1,202.8 A; 5% impedance: I_SC = 24,056 A (24.1 kA). Stiff source, bolted three-phase at secondary terminals; not arc-flash."],
    ["Voltage drop (3-phase approx.)", "VD = sqrt3 x K x I x D / CM; D one-way feet; 250 kcmil = 250,000 CM. K depends on material/temperature. Use AC impedance and PF when asked."],
    ["Markup vs margin", "Cost $1,000: 20% markup gives $1,200 price and 16.67% margin; a 20% margin target gives $1,250."]
  ];

  g.NC.errorTypes = ["Code Lookup Miss", "Math Error", "Rote Memorization", "Setup Error", "Reading Error", "Time Management"];
  g.NC.sourceMaterials = ["2020 NEC", "2013 NFPA 72", "NC Statutes", "NC Board Rules", "NASCLA", "Official Plans"];

  // Optional starter (7 hours, six sessions): menu for rebuilding a reduced schedule.
  g.NC.starter = [
    ["Session 1 · Baseline A (60 min)", "Books, notes and phone out of reach. Unseen 30-question set. Answer Q1-15 closed book, 3 minutes max each, record answer, confidence and elapsed. STOP RULE: do not score or research; Q16-30 stay cold."],
    ["Session 2 · Baseline B (60 min)", "Answer Q16-30 the same way (45 min), score all 30 (7 min), tag each miss by category, access mode and error type (8 min). Output: total score, three weakest categories, dominant error type."],
    ["Session 3 · Category 11 split drill (60 min)", "Recite law cards 01-15 without notes (20); explain ten NASCLA concepts in one sentence each (15); two official plan questions (10); five timed NFPA 72 lookups across Ch. 10, 12, 14, 17, 18, 23, 26, 29 (15)."],
    ["Session 4 · Article 250 (60 min)", "Distinguish grounded conductor, EGC, GEC, supply-side bonding jumper, system bonding jumper from memory (10); ten timed lookups (30); one GEC, one EGC, one bonding-jumper sizing, table first (15); log misses (5)."],
    ["Session 5 · Load and motor calculations (60 min)", "Write inputs and sequence before opening the NEC (5); one Art. 220 commercial/industrial load problem (22); correct (5); one Art. 430 problem covering conductor, branch protection, overloads, disconnect/controller, feeder (20); re-solve from blank paper (8)."],
    ["Session 6 · Unlimited additions (120 min)", "Closed-book map of Arts. 500-506, 511, 513-518, 520, 550, 680, 700 (15); 20 timed lookups with extra reps on 513 (50); ten-question Category 7 set at 3 min each (30); real ten-minute break; correct every miss with article and signal words (10); score the sprint gate (5)."]
  ];
  g.NC.starterExit = ["All 30 baseline answers completed, scored, labeled for prior exposure.", "Every miss tagged by category and error type.", "First 15 law cards at least 12/15 on the first scored recall pass.", "NFPA 72 and Article 250 median lookup times recorded; routine goal below 90 seconds.", "Load and motor problems each re-solved cleanly from blank paper.", "Category 7 targeted set at least 70%, every miss corrected.", "One next priority chosen from measured weakness."];

  g.NC.weeklyPackets = [
    [1, "Navigation, circuits and fill", ["D01", "D02", "W01", "W02", "W03", "B01", "B03", "S01", "O03", "P09"]],
    [2, "NC law, business, alarms and plans", ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P11", "P15"]],
    [3, "Grounding and bonding", ["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08", "G10", "G11"]],
    [4, "Loads and transformers", ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "E01", "E02"]],
    [5, "Motors, voltage drop and equipment", ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "E03", "W09"]],
    [6, "Higher voltage and special occupancies", ["W08", "O08", "H01", "H02", "H03", "H04", "H05", "H06", "H08", "H09"]],
    [7, "NFPA 72, plans and timed calculations", ["P11", "P12", "P13", "P14", "P09", "P10", "L02", "E01", "M07", "B04"]],
    [8, "Precision, law refresh and delayed retrieval", ["P02", "P04", "P06", "G02", "W01", "O04", "M01", "L10", "E04", "H09"]]
  ];
})(typeof window !== "undefined" ? window : globalThis);
