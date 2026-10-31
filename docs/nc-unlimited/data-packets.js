(function (g) { g.NC = g.NC || {}; g.NC.packets = {
 1: {
  objective: "Day 01 Books, baseline & booking: PSI appointment is booked for December 7, 2026, 10:00 AM-4:00 PM (America/New_York); confirm the Board authorization window, whose expiry is not in the September 10 eligibility email. Check complete 2020 NEC, 2013 NFPA 72 and NASCLA NC Electrical 14th; use compliant permanent tabs. Resume any unfinished baseline without resetting progress, or use 20 fresh mixed questions if prior answers are exposed. Record score, time and two weak areas.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "D01 General definitions and installation: Classify three code statements as mandatory instruction, permitted option or explanatory note. For each, identify the operative text and the conditions before turning it into a rule. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Shall, permission and informational notes have different roles. Check the actual code organization.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 90 and relevant text; Article 100 definitions where applicable."
   },
   {
    q: "O03 Overcurrent protection: For this arithmetic exercise ONLY, required current = 1.25 x continuous current + noncontinuous current. The inputs are 36 A continuous and 24 A noncontinuous. What is the calculated minimum before selecting conductors or a device? A. 60 A  B. 63 A  C. 69 A  D. 75 A",
    a: "C - 69 A. 1.25 x 36 = 45 A. Add 24 A = 69 A. This calculation does not choose a conductor size or establish whether the stated factor applies to a particular installation.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W02 Wiring methods and terminations: A supplied arithmetic model starts at 95 A, multiplies by 0.91 ambient and 0.80 conductor-count factors, and separately limits the result to a 65 A terminal value. Under ONLY those supplied assumptions, what is the usable maximum? A. 65 A  B. 69.16 A  C. 76 A  D. 95 A",
    a: "A - 65 A. 95 x 0.91 x 0.80 = 69.16 A. The separate supplied terminal cap is 65 A, so min(69.16, 65) = 65 A. The factors, terminal value and actual-load/code applicability still require their own source checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "S02 Service entrance and equipment: A balanced single-phase 120/240 V service has a calculated apparent load of 26,400 VA. Assume the provided load has already received all required treatment. What line current follows? A. 55 A  B. 100 A  C. 110 A  D. 220 A",
    a: "C - 110 A. I = VA / V = 26,400 / 240 = 110 A. Use line-to-line 240 V for the stated balanced total, not 120 V. Conductor and OCP selection are separate.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L01 Load calculations: A single-phase load is 28,800 VA at 240 V. With no additional factors to apply, what is the current? A. 60 A  B. 100 A  C. 120 A  D. 240 A",
    a: "C - 120 A. I = 28,800 / 240 = 120 A. The apparent load is already given; do not introduce an unstated demand factor.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "G01 Bonding and grounding: A drawing labels three conductors N, PE and GE. N returns ordinary load current; PE joins equipment enclosures; GE runs to the electrode system. Name each function, then identify the separate sizing route for each. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Explain grounded conductor, EGC and GEC by their jobs before selecting a table. A label alone cannot establish all installation details.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100; Article 250; the existing guide contrasts Tables 250.66 and 250.122."
   },
   {
    q: "M02 Motors and control wiring: For an arithmetic-only motor drill, the supplied conductor rule is 125% of the supplied table FLC. Table FLC is 28 A. What is the calculated ampacity before terminal/adjustment checks? A. 22 A  B. 28 A  C. 35 A  D. 44 A",
    a: "C - 35 A. 28 x 1.25 = 35 A. The problem supplies the current basis and multiplier. A real installation still needs duty, exception, terminal and installation checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E01 Appliances, equipment, and lighting: A balanced 75 kVA three-phase transformer has 480 V primary and 208 V secondary, both line-to-line. Use I = 75,000/(sqrt(3) x V_LL). What are approximate primary and secondary line currents? A. 90.2 A and 208.2 A  B. 156.3 A and 360.6 A  C. 208.2 A and 90.2 A  D. 75 A and 75 A",
    a: "A - 90.2 A and 208.2 A. Primary = 75,000/(1.7320508 x 480) = 90.211 A. Secondary = 75,000/(1.7320508 x 208) = 208.179 A. These are current calculations only; OCP, conductors and bonding need separate rules.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P09 Law, business, and practical applications: Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown? A. 310 W  B. 512 W  C. 566 W  D. 704 W",
    a: "C - 566 W. A: 8 x 2 x 32 = 512 W. B: 3 x 1 x 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. Original mini-case, not the official sample circuit.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-09-28; week 1; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 2: {
  objective: "Day 02 Find the rule fast: Compare 2020 NEC contents versus index with 20 timed lookups. Cover Articles 90, 100 and 110 plus the tabbed 210, 220, 230, 240, 250, 310, 430 and 450. Record median lookup time and the section, condition and exception for each miss.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "D01 General definitions and installation: Classify three code statements as mandatory instruction, permitted option or explanatory note. For each, identify the operative text and the conditions before turning it into a rule. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Shall, permission and informational notes have different roles. Check the actual code organization.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 90 and relevant text; Article 100 definitions where applicable."
   },
   {
    q: "D02 General definitions and installation: Equipment is reachable only after using a portable ladder. Find the actual accessible/readily accessible definitions and determine the result for the specific equipment requirement. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Find the exact required term and any applicable exception; ordinary-language accessible is not a substitute.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 100 and equipment-specific requirement."
   },
   {
    q: "D03 General definitions and installation: A listed assembly has manufacturer installation instructions specifying terminals and working arrangement. Which instruction and installation rules govern, and what exact evidence must be preserved? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Read the listing/instruction relationship and the actual equipment requirement rather than treating a generic recommendation as mandatory.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 110 and the equipment instructions."
   },
   {
    q: "S01 Service entrance and equipment: Place a service point, meter, service disconnect and downstream panel on a one-line. Identify the service-conductor span and feeder span from the actual supply/control arrangement. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A meter location or a panel label alone may not identify the service disconnect.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100 definitions and Article 230."
   },
   {
    q: "O01 Overcurrent protection: A breaker is marked 100 A and 10 kA. Explain the two different ratings and identify which one must be compared with available fault current. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Differentiate normal current/protection settings from interrupting capability. Verify the installation requirement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Articles 100 and 110 interrupting-rating provisions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-09-29; week 1; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 3: {
  objective: "Day 03 Branch circuits, services & protection: Solve 20 questions across Articles 200-240: branch circuits, feeders, service conductors/disconnects and overcurrent protection. Separate continuous-load sizing from protective-device selection. Correct each miss from the designated 2020 text.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "O03 Overcurrent protection: For this arithmetic exercise ONLY, required current = 1.25 x continuous current + noncontinuous current. The inputs are 36 A continuous and 24 A noncontinuous. What is the calculated minimum before selecting conductors or a device? A. 60 A  B. 63 A  C. 69 A  D. 75 A",
    a: "C - 69 A. 1.25 x 36 = 45 A. Add 24 A = 69 A. This calculation does not choose a conductor size or establish whether the stated factor applies to a particular installation.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "O04 Overcurrent protection: A conductor has usable ampacity 36 A in a general branch circuit. Find the conditions under which a next-standard-size OCP device is permitted and any restriction relevant to the described circuit. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The ampacity alone is insufficient; name the circuit facts and each controlling condition before choosing a standard rating.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 240 conductor protection and standard ratings."
   },
   {
    q: "O05 Overcurrent protection: An 18-foot feeder tap supplies a downstream device. Find the applicable tap rule and enumerate termination, ampacity, physical protection and length conditions before deciding whether source-end OCP can be omitted. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A short length alone is not a complete tap-rule answer. Treat every specified condition as a separate checklist item.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 240 feeder-tap provisions; locate the rule in 2020."
   },
   {
    q: "S01 Service entrance and equipment: Place a service point, meter, service disconnect and downstream panel on a one-line. Identify the service-conductor span and feeder span from the actual supply/control arrangement. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A meter location or a panel label alone may not identify the service disconnect.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100 definitions and Article 230."
   },
   {
    q: "S02 Service entrance and equipment: A balanced single-phase 120/240 V service has a calculated apparent load of 26,400 VA. Assume the provided load has already received all required treatment. What line current follows? A. 55 A  B. 100 A  C. 110 A  D. 220 A",
    a: "C - 110 A. I = VA / V = 26,400 / 240 = 110 A. Use line-to-line 240 V for the stated balanced total, not 120 V. Conductor and OCP selection are separate.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "S03 Service entrance and equipment: Compare a proposed group of six service disconnects in one common enclosure with separate permitted enclosures/compartments. Determine the actual 2020 arrangement conditions. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not stop at the slogan six disconnects. Verify equipment layout, scope and exceptions in the exam edition.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 230 service-disconnect arrangement provisions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-09-30; week 1; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 4: {
  objective: "Day 04 Conductors & terminations: Solve 20 questions across Articles 300-450, emphasizing 110.14(C), Table 310.16, ambient correction, conductor-count adjustment and wiring methods. State insulation rating, terminal limit and actual installation conditions before selecting ampacity.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "W02 Wiring methods and terminations: A supplied arithmetic model starts at 95 A, multiplies by 0.91 ambient and 0.80 conductor-count factors, and separately limits the result to a 65 A terminal value. Under ONLY those supplied assumptions, what is the usable maximum? A. 65 A  B. 69.16 A  C. 76 A  D. 95 A",
    a: "A - 65 A. 95 x 0.91 x 0.80 = 69.16 A. The separate supplied terminal cap is 65 A, so min(69.16, 65) = 65 A. The factors, terminal value and actual-load/code applicability still require their own source checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W04 Wiring methods and terminations: A four-wire wye feeder supplies a substantial nonlinear load. Determine whether its neutral is counted for the applicable ampacity adjustment. Record the actual condition controlling your answer. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Counting physical wires and counting current-carrying conductors are different tasks. Verify the load/neutral rule.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 310 current-carrying-conductor provisions."
   },
   {
    q: "W05 Wiring methods and terminations: A raceway is outdoors and subject to wet conditions. Compare a conductor marked only THHN with one actually marked THHN/THWN-2. Find the permitted-use rules from the markings, not from appearance. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Document the environment and complete marking. A familiar insulation name is not evidence of all ratings.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 300 wet locations and Article 310 conductor permitted-use provisions."
   },
   {
    q: "W10 Wiring methods and terminations: A lug is proposed for aluminum conductors. List the marking, preparation and torque/instruction evidence needed before accepting the termination. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Conductor material and insulation rating do not establish terminal suitability by themselves.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 110 termination and listing/instruction requirements."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-01; week 1; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 5: {
  objective: "Day 05 Box fill, raceway fill & plans: Use 314.16 and 314.28 for box fill and pull space; Chapter 9 Tables 1, 4 and 5 for raceway fill, and Table 8 for conductor properties. Complete one official lighting/power-plan tracing exercise. Keep fill, ampacity adjustment and pull dimensions separate.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "B01 Boxes and fittings: This fictional small-box arithmetic exercise stipulates: six conductor allowances, two device allowances, one clamp allowance and two grounding allowances, all at 2.25 in3 each. What required volume follows from those stated allowances? A. 20.25 in3  B. 22.50 in3  C. 24.75 in3  D. 27.00 in3",
    a: "C - 24.75 in3. Allowances total 6 + 2 + 1 + 2 = 11. Volume = 11 x 2.25 = 24.75 in3. This does not verify that the supplied grounding/device/clamp counts match a real 2020 installation.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "B02 Boxes and fittings: A box contains six EGCs/bonding jumpers. Determine the exact 2020 volume allowance for the described arrangement. Compare it with the older shortcut that all grounds always count as one. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Read the 2020 provision and actual conductor arrangement. Record the exact counting rule rather than carrying forward an old mnemonic.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 314 box-fill conductor/grounding allowance provisions."
   },
   {
    q: "B03 Boxes and fittings: A dimensional practice problem explicitly supplies the rule: straight-pull length must be at least eight times the largest raceway trade size. The largest size in this model is 3 inches. Calculate the minimum model length. A. 18 in  B. 21 in  C. 24 in  D. 30 in",
    a: "C - 24 in. 8 x 3 = 24 inches under the supplied model. Confirm the conductor size, pull type, raceway sizing and applicability in 2020 before treating it as a code answer.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "B04 Boxes and fittings: For a fictional angle-pull model, the supplied formula is six times the largest raceway in the relevant row plus the sum of the other raceway sizes in that row. Sizes are 3, 2 and 1 inches. Calculate that model dimension only. A. 18 in  B. 21 in  C. 24 in  D. 36 in",
    a: "B - 21 in. 6 x 3 + 2 + 1 = 21 inches. Other required dimensions, same-conductor raceway spacing and actual applicability remain separate checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W03 Wiring methods and terminations: A fictitious raceway has 2.00 in2 of internal area. This exercise stipulates a 40% permitted fill and 0.12 in2 per identical conductor. How many whole conductors fit under those assumptions? A. 6  B. 7  C. 8  D. 16",
    a: "A - 6. Permitted area = 2.00 x 0.40 = 0.80 in2. 0.80 / 0.12 = 6.666...; round DOWN to 6 whole conductors. Check the actual wiring method and Chapter 9 data before using this in a design.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P09 Law, business, and practical applications: Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown? A. 310 W  B. 512 W  C. 566 W  D. 704 W",
    a: "C - 566 W. A: 8 x 2 x 32 = 512 W. B: 3 x 1 x 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. Original mini-case, not the official sample circuit.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-02; week 1; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 6: {
  objective: "Day 06 QI, licensee & classification: Recall G.S. 87 Article 4, then verify. A qualified individual passes the classification exam AND receives Board certification; a listed QI supervises/directs work under an issued license. Distinguish passing, QI status and license issuance. Review current classification limits and licensing gates.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P01 Law, business, and practical applications: A candidate passes the Unlimited examination. What must still occur before treating the business as licensed? A. Nothing; a passing score is the license  B. Board license application/issuance and applicable licensing requirements  C. Only purchasing a ground rod  D. Only completing an online mock (Closed-book recall first; source-check after committing answer)",
    a: "B - Board license application/issuance and applicable licensing requirements. Passing alone does not issue the contracting license. The current handbook instructs passing candidates to complete the license application; current G.S. 87-43.2 specifies issuance requirements.",
    src: "G.S. 87-43.2(a); corroborated by July 2026 handbook checklist. G.S. 87-43.2, current Legislature text; verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P03 Law, business, and practical applications: Under the Board renewal rule, when are the license renewal application and fee due relative to expiration? A. 30 days before expiration  B. Five days after expiration  C. Only when a new job begins  D. Every two years (Closed-book recall first; source-check after committing answer)",
    a: "A - 30 days before expiration. The trigger is license expiration. Distinguish this from the five-day listed-QI employment notice and annual exam scheduling rules.",
    src: "21 NCAC 18B .0405(a), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-05; week 2; time target 2 h; category: Law & Business. Use existing material: NC Law & Business cards 01, 02, 05, 06, 07 and 08. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 7: {
  objective: "Day 07 Project value & responsibilities: Study 21 NCAC 18B .0303 and supervision/permit rules. Include known or reasonably estimated owner-supplied electrical materials/equipment in project value. Learn the actual separate-project conditions; dividing contracts alone does not avoid license limits. Solve five varied scenarios.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P02 Law, business, and practical applications: One project includes $52,000 of contractor-supplied electrical value components and $18,000 of known owner-supplied electrical equipment, with no duplicate amount. Does calling the contractor contract $52,000 settle the project-value calculation? A. Yes; owner purchases are excluded  B. No; total stated project value is $70,000  C. Yes; split invoices always create separate projects  D. Only voltage matters (Closed-book recall first; source-check after committing answer)",
    a: "B - No; $70,000. 52,000 + 18,000 = 70,000. Rule .0303 includes relevant known or reasonably estimated electrical value regardless of who furnishes the materials/equipment. Do not confuse contract-label amount with project value.",
    src: "21 NCAC 18B .0303(4), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P15 Law, business, and practical applications: An owner asks for additional work before a change price is agreed. In NASCLA 14th, locate contract-change documentation and notice topics, then write the facts/authorization/cost/schedule records needed for this case. Write: answer > exact source > condition/exception > elapsed time. (Admitted-book business lookup)",
    a: "Book lookup required: Identify actual contract authority, notice and documentation; a verbal request does not settle every entitlement question.",
    src: "Book lookup required (NASCLA NC Electrical 14th, contract/project-management topics; record page, no page invented): https://store.nascla.org/products/north-carolina-electrical-14th-edition"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-06; week 2; time target 2 h; category: Law & Business. Use existing material: cards 03, 04, 13, 14, 15 and 16; worked scenarios 11 and 15. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 8: {
  objective: "Day 08 Experience credits & licensing recall: Use current handbook .0201/.0202: Unlimited requires 9,000 credited hours including 8,000 primary. Map secondary credit rates 100%, 80%, 50%, 20%, 10% to their exact qualifying activities; solve three credit examples. Spend remaining time on renewal, supervision, permits and exam-to-license steps.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P05 Law, business, and practical applications: Assume the documented categories are accepted: 8,000 primary hours and 1,200 helper hours credited as secondary at 80%. Do these alone reach the current Unlimited 9,000 total-hour threshold? A. Yes; raw hours total 9,200  B. Yes; every helper hour is primary  C. No; credited total is 8,960, short by 40 hours  D. No; the requirement is nine years (Closed-book recall first; source-check after committing answer)",
    a: "C - 8,960 credited hours; 40 short. Secondary credit = 1,200 x 0.80 = 960. Total = 8,000 + 960 = 8,960. Primary threshold is met; total threshold is not. The Board must accept the underlying activities and documentation.",
    src: "21 NCAC 18B .0201(b)(3) and .0202(b); 21 NCAC 18B, current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P03 Law, business, and practical applications: Under the Board renewal rule, when are the license renewal application and fee due relative to expiration? A. 30 days before expiration  B. Five days after expiration  C. Only when a new job begins  D. Every two years (Closed-book recall first; source-check after committing answer)",
    a: "A - 30 days before expiration. The trigger is license expiration. Distinguish this from the five-day listed-QI employment notice and annual exam scheduling rules.",
    src: "21 NCAC 18B .0405(a), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-07; week 2; time target 2 h; category: Law & Business. Use existing material: cards 11, 12, 17, 18, 19 and 20. Recalculate documented credit categories. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 9: {
  objective: "Day 09 NASCLA navigation & business: Use NASCLA NC Electrical 14th, an admitted reference. Map all chapters; practice contracts/change orders, insurance/workers' compensation, payroll, estimating, markup versus margin, cash flow and scheduling. Recall first, then locate the page and verify the condition/year.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P06 Law, business, and practical applications: A defined total cost basis is $9,150. Compare a 20% markup price with a 20% margin price, rounded to cents. A. Both $10,980  B. Markup $10,980; margin $11,437.50  C. Markup $11,437.50; margin $10,980  D. Both $11,437.50 (Business arithmetic; NASCLA navigation may follow)",
    a: "B - $10,980 and $11,437.50. Markup: 9,150 x 1.20 = 10,980. Margin: 9,150/(1 - 0.20) = 11,437.50. Markup uses cost as denominator; margin uses selling price.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P07 Law, business, and practical applications: Current assets are $120,000, current liabilities $80,000 and cash $9,000. Find working capital and current ratio. Do these alone prove a $25,000 payroll can immediately be paid in cash? A. $40,000; 1.5:1; no  B. $40,000; 1.5:1; yes  C. $200,000; 0.67:1; no  D. $9,000; 1.5:1; yes (Business arithmetic; NASCLA navigation may follow)",
    a: "A - $40,000; 1.5:1; no. Working capital = 120,000 - 80,000 = 40,000. Ratio = 120,000/80,000 = 1.5. Cash is only 9,000; collection/credit timing is missing. Working capital is not cash.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P08 Law, business, and practical applications: In this network A takes two days; after A, B takes four and C takes five in parallel; D takes three and waits for both. Ignore resource constraints. Which path controls and how long is the project? A. A-B-D; 9 days  B. A-C-D; 10 days  C. A-B-C-D; 14 days  D. Both paths; 12 days (Business arithmetic; NASCLA navigation may follow)",
    a: "B - A-C-D; 10 days. A-B-D = 2 + 4 + 3 = 9 days. A-C-D = 2 + 5 + 3 = 10 days. Longest dependent path controls under the stated model; B has one day of float.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P15 Law, business, and practical applications: An owner asks for additional work before a change price is agreed. In NASCLA 14th, locate contract-change documentation and notice topics, then write the facts/authorization/cost/schedule records needed for this case. Write: answer > exact source > condition/exception > elapsed time. (Admitted-book business lookup)",
    a: "Book lookup required: Identify actual contract authority, notice and documentation; a verbal request does not settle every entitlement question.",
    src: "Book lookup required (NASCLA NC Electrical 14th, contract/project-management topics; record page, no page invented): https://store.nascla.org/products/north-carolina-electrical-14th-edition"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-08; week 2; time target 2 h; category: Law & Business. Use existing material: cards 50-60; choose six and record NASCLA 14th pages. Worked scenarios 1, 2, 6, 7 and 10. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 10: {
  objective: "Day 10 Law, business, alarms & plans: Run 30 timed law/business questions: recall first, then check statutory/rule wording and navigate the admitted NASCLA. Add five NFPA 72 index lookups and one official plan-reading exercise. Record score and lookup time; do not label NASCLA or the entire mixed category closed-book.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P01 Law, business, and practical applications: A candidate passes the Unlimited examination. What must still occur before treating the business as licensed? A. Nothing; a passing score is the license  B. Board license application/issuance and applicable licensing requirements  C. Only purchasing a ground rod  D. Only completing an online mock (Closed-book recall first; source-check after committing answer)",
    a: "B - Board license application/issuance and applicable licensing requirements. Passing alone does not issue the contracting license. The current handbook instructs passing candidates to complete the license application; current G.S. 87-43.2 specifies issuance requirements.",
    src: "G.S. 87-43.2(a); corroborated by July 2026 handbook checklist. G.S. 87-43.2, current Legislature text; verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P02 Law, business, and practical applications: One project includes $52,000 of contractor-supplied electrical value components and $18,000 of known owner-supplied electrical equipment, with no duplicate amount. Does calling the contractor contract $52,000 settle the project-value calculation? A. Yes; owner purchases are excluded  B. No; total stated project value is $70,000  C. Yes; split invoices always create separate projects  D. Only voltage matters (Closed-book recall first; source-check after committing answer)",
    a: "B - No; $70,000. 52,000 + 18,000 = 70,000. Rule .0303 includes relevant known or reasonably estimated electrical value regardless of who furnishes the materials/equipment. Do not confuse contract-label amount with project value.",
    src: "21 NCAC 18B .0303(4), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P06 Law, business, and practical applications: A defined total cost basis is $9,150. Compare a 20% markup price with a 20% margin price, rounded to cents. A. Both $10,980  B. Markup $10,980; margin $11,437.50  C. Markup $11,437.50; margin $10,980  D. Both $11,437.50 (Business arithmetic; NASCLA navigation may follow)",
    a: "B - $10,980 and $11,437.50. Markup: 9,150 x 1.20 = 10,980. Margin: 9,150/(1 - 0.20) = 11,437.50. Markup uses cost as denominator; margin uses selling price.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P09 Law, business, and practical applications: Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown? A. 310 W  B. 512 W  C. 566 W  D. 704 W",
    a: "C - 566 W. A: 8 x 2 x 32 = 512 W. B: 3 x 1 x 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. Original mini-case, not the official sample circuit.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-09; week 2; time target 2 h; category: Law & Business. Use existing material: six unseen/retrieval cards from 01-20 plus existing business scenarios; include NFPA and plan work. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 11: {
  objective: "Day 11 GEC versus EGC: Distinguish Table 250.66 GEC sizing by ungrounded supply-conductor size/material and electrode-specific exceptions from Table 250.122 EGC sizing by upstream OCPD rating/setting. Check parallel conductors and applicable upsizing rules. A service ampere rating alone may not settle GEC size.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G01 Bonding and grounding: A drawing labels three conductors N, PE and GE. N returns ordinary load current; PE joins equipment enclosures; GE runs to the electrode system. Name each function, then identify the separate sizing route for each. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Explain grounded conductor, EGC and GEC by their jobs before selecting a table. A label alone cannot establish all installation details.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100; Article 250; the existing guide contrasts Tables 250.66 and 250.122."
   },
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "G04 Bonding and grounding: For a feeder protected at 200 A, find the minimum copper EGC from the designated book. State whether any conductor-size increase or installation condition changes your answer. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Record the exact row and all applicable adjustment or upsizing conditions. A number without the condition is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; Table 250.122 and applicable accompanying provisions."
   },
   {
    q: "G05 Bonding and grounding: Compare a grounding electrode system containing only a rod with a system that also has a qualifying concrete-encased electrode. Determine which electrode connections are required and which sizing exceptions may apply. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Identify electrode type, presence and qualifying conditions before applying a conductor exception.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250 electrode system and electrode-specific GEC provisions."
   },
   {
    q: "G08 Bonding and grounding: A service uses two parallel sets of aluminum phase conductors. What conductor information and aggregation treatment must you obtain before sizing the applicable grounding or bonding conductor? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not size from the rating of one breaker or one conductor set without checking the rule for the function and arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250 parallel-conductor grounding/bonding provisions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-12; week 3; time target 2 h; category: Grounding/Bonding.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 12: {
  objective: "Day 12 Main & system bonding jumpers: Draw service and separately derived system one-lines. Locate MBJ/SBJ under 250.24, 250.28 and 250.30; use 250.28(D)/250.102(C)(1) for applicable bonding-jumper sizing. Trace normal neutral current and the fault-return path; check permitted bonding location and parallel-path restrictions.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G03 Bonding and grounding: Sketch a service, downstream panel and a load. Trace normal neutral current in one color and an enclosure fault back to its source in another. Identify every intentional bond and any unwanted parallel path. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The exercise requires a complete return path and distinct normal/fault paths. Do not replace a circuit explanation with a ground-rod symbol.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC service grounding/bonding; downstream equipment grounding."
   },
   {
    q: "G06 Bonding and grounding: One generator has a switched neutral; another transfer arrangement leaves the neutral directly connected to the other source. Determine the separately derived system status of each from the actual conductor connections. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Draw the neutral connection first. Equipment type alone does not decide the classification.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100 separately derived system; Article 250 source grounding/bonding."
   },
   {
    q: "G07 Bonding and grounding: Draw one service and one isolated transformer secondary. Label the main bonding jumper and system bonding jumper and locate each permitted connection point. Find the sizing provisions rather than reusing the EGC table. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State which system and conductor function controls the jumper. Explain placement and parallel-path restrictions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; the existing session routes through 250.24, 250.28, 250.30 and 250.102."
   },
   {
    q: "G09 Bonding and grounding: A metal enclosure has a rod connected to it but no intentional equipment fault-return path to the source. Find the text governing an effective ground-fault current path and explain the protection problem. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Identify the path required to operate the protective device; do not equate connection to earth with a complete source return.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250 general grounding/bonding requirements."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-13; week 3; time target 2 h; category: Grounding/Bonding.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 13: {
  objective: "Day 13 Grounding above 1,000 volts: Locate 2020 NEC Article 250 Part X and its over-1,000 V scope. Work system grounding, equipment grounding and applicable substation/fence cases from the exact sections. Distinguish code lookup from a complete touch/step-potential engineering design.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G10 Bonding and grounding: For a 4.16 kV installation, locate the higher-voltage grounding provisions and identify system grounding, equipment grounding and applicable substation/fence requirements. What engineering data would still be needed for touch/step evaluation? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Separate code-scope lookup from a completed substation grounding design. State the voltage and actual arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 250 Part X, as routed by the existing Day 13 session."
   },
   {
    q: "O08 Overcurrent protection: For equipment operating above 1,000 V, find the applicable overcurrent protection provisions. Record the voltage scope and one difference from an ordinary low-voltage circuit. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Use the 2020 organization rather than a later-edition table of contents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 higher-voltage portions of Articles 240 and 490; confirm final route in the book."
   },
   {
    q: "W08 Wiring methods and terminations: For a medium-voltage conductor installation, locate the 2020 article and applicable ampacity table. List voltage, conductor construction, installation geometry and temperature assumptions before choosing a value. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A table value without its installation basis is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 311 and referenced ampacity provisions; existing Day 26."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-14; week 3; time target 2 h; category: Grounding/Bonding.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 14: {
  objective: "Day 14 Impedance-grounded systems: Compare the actual scope of 250.36 with 250.187 in the 2020 NEC. Identify voltage range, neutral/impedance connection, grounding electrode and equipment-grounding paths, routing and monitoring requirements. Do not transfer a lower-voltage rule automatically to a higher-voltage system.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G11 Bonding and grounding: Compare an impedance-grounded 480 V system with an impedance-grounded 4.16 kV system. Build a two-column list of scope, neutral/impedance connection, monitoring, grounding electrodes and EGC requirements. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Use the provision for the stated voltage. Similar terminology does not justify transferring a lower-voltage condition to a higher-voltage installation.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 250; existing Day 14 starts at 250.36 and 250.187."
   },
   {
    q: "G10 Bonding and grounding: For a 4.16 kV installation, locate the higher-voltage grounding provisions and identify system grounding, equipment grounding and applicable substation/fence requirements. What engineering data would still be needed for touch/step evaluation? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Separate code-scope lookup from a completed substation grounding design. State the voltage and actual arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 250 Part X, as routed by the existing Day 13 session."
   },
   {
    q: "G03 Bonding and grounding: Sketch a service, downstream panel and a load. Trace normal neutral current in one color and an enclosure fault back to its source in another. Identify every intentional bond and any unwanted parallel path. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The exercise requires a complete return path and distinct normal/fault paths. Do not replace a circuit explanation with a ground-rod symbol.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC service grounding/bonding; downstream equipment grounding."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-15; week 3; time target 2 h; category: Grounding/Bonding.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 15: {
  objective: "Day 15 Grounding application test: Complete up to 30 grounding/bonding scenarios within 90 minutes; use remaining time to correct and re-solve the highest-impact misses. State conductor function before choosing a table. Log verified corrections and set a delayed retest.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G01 Bonding and grounding: A drawing labels three conductors N, PE and GE. N returns ordinary load current; PE joins equipment enclosures; GE runs to the electrode system. Name each function, then identify the separate sizing route for each. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Explain grounded conductor, EGC and GEC by their jobs before selecting a table. A label alone cannot establish all installation details.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100; Article 250; the existing guide contrasts Tables 250.66 and 250.122."
   },
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "G03 Bonding and grounding: Sketch a service, downstream panel and a load. Trace normal neutral current in one color and an enclosure fault back to its source in another. Identify every intentional bond and any unwanted parallel path. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The exercise requires a complete return path and distinct normal/fault paths. Do not replace a circuit explanation with a ground-rod symbol.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC service grounding/bonding; downstream equipment grounding."
   },
   {
    q: "G04 Bonding and grounding: For a feeder protected at 200 A, find the minimum copper EGC from the designated book. State whether any conductor-size increase or installation condition changes your answer. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Record the exact row and all applicable adjustment or upsizing conditions. A number without the condition is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; Table 250.122 and applicable accompanying provisions."
   },
   {
    q: "G05 Bonding and grounding: Compare a grounding electrode system containing only a rod with a system that also has a qualifying concrete-encased electrode. Determine which electrode connections are required and which sizing exceptions may apply. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Identify electrode type, presence and qualifying conditions before applying a conductor exception.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250 electrode system and electrode-specific GEC provisions."
   },
   {
    q: "G06 Bonding and grounding: One generator has a switched neutral; another transfer arrangement leaves the neutral directly connected to the other source. Determine the separately derived system status of each from the actual conductor connections. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Draw the neutral connection first. Equipment type alone does not decide the classification.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 100 separately derived system; Article 250 source grounding/bonding."
   },
   {
    q: "G07 Bonding and grounding: Draw one service and one isolated transformer secondary. Label the main bonding jumper and system bonding jumper and locate each permitted connection point. Find the sizing provisions rather than reusing the EGC table. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State which system and conductor function controls the jumper. Explain placement and parallel-path restrictions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; the existing session routes through 250.24, 250.28, 250.30 and 250.102."
   },
   {
    q: "G08 Bonding and grounding: A service uses two parallel sets of aluminum phase conductors. What conductor information and aggregation treatment must you obtain before sizing the applicable grounding or bonding conductor? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not size from the rating of one breaker or one conductor set without checking the rule for the function and arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250 parallel-conductor grounding/bonding provisions."
   },
   {
    q: "G09 Bonding and grounding: A metal enclosure has a rod connected to it but no intentional equipment fault-return path to the source. Find the text governing an effective ground-fault current path and explain the protection problem. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Identify the path required to operate the protective device; do not equate connection to earth with a complete source return.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250 general grounding/bonding requirements."
   },
   {
    q: "G10 Bonding and grounding: For a 4.16 kV installation, locate the higher-voltage grounding provisions and identify system grounding, equipment grounding and applicable substation/fence requirements. What engineering data would still be needed for touch/step evaluation? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Separate code-scope lookup from a completed substation grounding design. State the voltage and actual arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 250 Part X, as routed by the existing Day 13 session."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-16; week 3; time target 2 h; category: Grounding/Bonding.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 16: {
  objective: "Day 16 Load calculations: dwelling: Build a complete Article 220 dwelling worksheet in the 2020 edition. Select the permitted method; classify loads, apply demand/noncoincident treatment only where allowed, total VA and convert to current. Explain the continuous-load and service/feeder checks separately.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "L04 Load calculations: This teaching problem supplies an assumed lighting factor of 3 VA/ft2 for an area of 2,500 ft2. What connected lighting VA follows from those two supplied inputs, before demand treatment? A. 750 VA  B. 3,000 VA  C. 7,500 VA  D. 9,000 VA",
    a: "C - 7,500 VA. 2,500 x 3 = 7,500 VA. This problem supplies the factor; it does not independently validate the occupancy-specific NEC factor.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L05 Load calculations: A fictitious demand model retains the first 3,000 VA at 100% and the remaining 7,200 VA at 35%. What calculated demand follows? A. 3,570 VA  B. 5,520 VA  C. 7,200 VA  D. 10,200 VA",
    a: "B - 5,520 VA. 3,000 + (7,200 x 0.35) = 3,000 + 2,520 = 5,520 VA. Apply the two bands once. The model is supplied; confirm scope before using a real code demand rule.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L06 Load calculations: A supplied sizing model uses 125% of 8,000 VA continuous load plus 100% of 12,000 VA noncontinuous load. What total VA follows? A. 20,000 VA  B. 21,000 VA  C. 22,000 VA  D. 25,000 VA",
    a: "C - 22,000 VA. 1.25 x 8,000 + 12,000 = 10,000 + 12,000 = 22,000 VA. It is a supplied model, not permission to apply 125% to every load.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L07 Load calculations: Heating is 9 kVA and cooling is 13 kVA. Determine whether the actual controls and code method permit treating them as noncoincident. If permitted, show the contribution; if not, state what changes. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A statement that loads usually do not run together is weaker than the required conditions. Verify the rule and actual arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 220 noncoincident-load treatment and applicable equipment provisions."
   },
   {
    q: "L08 Load calculations: Build a dwelling service worksheet with lighting, small-appliance/laundry, range, dryer, fixed appliances, HVAC and motor inputs. State which permitted calculation method you use and each required exception check. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not mix a standard-method demand factor with an optional-method subtotal without authority.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 220; exact method and factor citations must be recorded."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-19; week 4; time target 2 h; category: Math/Transformers.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 17: {
  objective: "Day 17 Load calculations: commercial: Solve commercial/industrial feeder and service load problems under Article 220. Use the correct occupancy lighting values, demand rules and motor contribution. For balanced three-phase loads use S(kVA)=sqrt(3)xV_LLxI_line/1000; distinguish kVA from kW and power factor.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "L01 Load calculations: A single-phase load is 28,800 VA at 240 V. With no additional factors to apply, what is the current? A. 60 A  B. 100 A  C. 120 A  D. 240 A",
    a: "C - 120 A. I = 28,800 / 240 = 120 A. The apparent load is already given; do not introduce an unstated demand factor.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L02 Load calculations: A balanced three-phase load is 138.6 kVA at 480 V line-to-line. Use I = 1,000 x kVA / (sqrt(3) x V_LL). What is line current to the nearest ampere? A. 96 A  B. 167 A  C. 289 A  D. 500 A",
    a: "B - 167 A. 138,600 / (1.7320508 x 480) = 166.7179 A, rounded to 167 A. Do not use line-to-neutral voltage in this stated formula.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L03 Load calculations: A load consumes 72 kW at power factor 0.80. Assuming the stated model S = P / PF, what apparent power is required? A. 57.6 kVA  B. 72 kVA  C. 90 kVA  D. 100 kVA",
    a: "C - 90 kVA. 72 / 0.80 = 90 kVA. Multiplying real power by PF goes in the wrong direction for this question.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L09 Load calculations: A commercial feeder serves lighting, receptacles and motors. Explain which lighting value, receptacle demand treatment and motor contribution apply to its stated occupancy and load details. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Keep occupancy-specific values and separate motor treatment visible.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 220 with relevant motor and feeder provisions."
   },
   {
    q: "L10 Load calculations: Compare a 2020 and later-edition occupancy lighting table/organization. Identify the actual 2020 value and section used for a proposed office question. Why is a later-edition explanation insufficient as an exam key? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The designated edition controls the lookup; do not invent a factor or section from memory.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 220 lighting provisions; existing guide flags later reorganization."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-20; week 4; time target 2 h; category: Math/Transformers.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 18: {
  objective: "Day 18 Wye, delta & transformer current: For balanced wye: V_LL=sqrt(3)xV_phase and I_line=I_phase; for delta: V_LL=V_phase and I_line=sqrt(3)xI_phase. Calculate primary and secondary line current separately: I_line=1000xkVA/(sqrt(3)xV_LL). Then separate transformer OCP, conductors and grounding decisions.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "E01 Appliances, equipment, and lighting: A balanced 75 kVA three-phase transformer has 480 V primary and 208 V secondary, both line-to-line. Use I = 75,000/(sqrt(3) x V_LL). What are approximate primary and secondary line currents? A. 90.2 A and 208.2 A  B. 156.3 A and 360.6 A  C. 208.2 A and 90.2 A  D. 75 A and 75 A",
    a: "A - 90.2 A and 208.2 A. Primary = 75,000/(1.7320508 x 480) = 90.211 A. Secondary = 75,000/(1.7320508 x 208) = 208.179 A. These are current calculations only; OCP, conductors and bonding need separate rules.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L02 Load calculations: A balanced three-phase load is 138.6 kVA at 480 V line-to-line. Use I = 1,000 x kVA / (sqrt(3) x V_LL). What is line current to the nearest ampere? A. 96 A  B. 167 A  C. 289 A  D. 500 A",
    a: "B - 167 A. 138,600 / (1.7320508 x 480) = 166.7179 A, rounded to 167 A. Do not use line-to-neutral voltage in this stated formula.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L03 Load calculations: A load consumes 72 kW at power factor 0.80. Assuming the stated model S = P / PF, what apparent power is required? A. 57.6 kVA  B. 72 kVA  C. 90 kVA  D. 100 kVA",
    a: "C - 90 kVA. 72 / 0.80 = 90 kVA. Multiplying real power by PF goes in the wrong direction for this question.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E04 Appliances, equipment, and lighting: A transformer primary has suitable overcurrent protection. Does this alone prove that secondary conductors are protected? Identify the additional transformer and secondary-conductor questions. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Transformer OCP and secondary-conductor protection are separate checks; do not assume one answer settles both.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 450 and 240; applicable secondary conductor arrangement."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-21; week 4; time target 2 h; category: Math/Transformers.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 19: {
  objective: "Day 19 Transformer fault-current estimate: Use I_SC approx I_FL/(Z%/100)=I_FL x 100/Z%. Example conversion only: 5.75% becomes 0.0575, not 5.75. This is a three-phase bolted-fault estimate at transformer secondary terminals with a stiff source; upstream/conductor impedance and motor contribution need separate treatment.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "E02 Appliances, equipment, and lighting: A 500 kVA, 480 V three-phase transformer has 5.75% impedance. Under the supplied stiff-source, secondary-terminal bolted-fault model, use I_FL = 500,000/(sqrt(3) x 480), then I_SC = I_FL/0.0575. Choose the approximate result. A. 1.046 kA  B. 6.014 kA  C. 10.459 kA  D. 104.59 kA",
    a: "C - approximately 10.459 kA. I_FL = 601.4065 A. Convert 5.75% to 0.0575. I_SC = 601.4065/0.0575 = 10,459.24 A. Upstream/conductor impedance and motor contributions are outside this simplified model.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "O01 Overcurrent protection: A breaker is marked 100 A and 10 kA. Explain the two different ratings and identify which one must be compared with available fault current. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Differentiate normal current/protection settings from interrupting capability. Verify the installation requirement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Articles 100 and 110 interrupting-rating provisions."
   },
   {
    q: "O02 Overcurrent protection: The stated available fault current is 25 kA; a proposed device is individually marked 10 kA. Which additional facts and permitted protection arrangement would have to be verified before approval? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not infer suitability from ampere rating. Check available fault current, equipment rating and any documented permitted combination.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 110 interrupting rating and equipment short-circuit suitability."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-22; week 4; time target 2 h; category: Math/Transformers.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 20: {
  objective: "Day 20 Fresh mixed checkpoint: Take 30 fresh mixed questions under a 90-minute limit; use 30 minutes to grade and identify two largest gaps. Include loads, transformers, grounding, protection, law/business, NFPA 72 and plans. Coaching target: at least 75%; record sample size and exposure, then schedule corrections.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "L02 Load calculations: A balanced three-phase load is 138.6 kVA at 480 V line-to-line. Use I = 1,000 x kVA / (sqrt(3) x V_LL). What is line current to the nearest ampere? A. 96 A  B. 167 A  C. 289 A  D. 500 A",
    a: "B - 167 A. 138,600 / (1.7320508 x 480) = 166.7179 A, rounded to 167 A. Do not use line-to-neutral voltage in this stated formula.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E01 Appliances, equipment, and lighting: A balanced 75 kVA three-phase transformer has 480 V primary and 208 V secondary, both line-to-line. Use I = 75,000/(sqrt(3) x V_LL). What are approximate primary and secondary line currents? A. 90.2 A and 208.2 A  B. 156.3 A and 360.6 A  C. 208.2 A and 90.2 A  D. 75 A and 75 A",
    a: "A - 90.2 A and 208.2 A. Primary = 75,000/(1.7320508 x 480) = 90.211 A. Secondary = 75,000/(1.7320508 x 208) = 208.179 A. These are current calculations only; OCP, conductors and bonding need separate rules.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "O03 Overcurrent protection: For this arithmetic exercise ONLY, required current = 1.25 x continuous current + noncontinuous current. The inputs are 36 A continuous and 24 A noncontinuous. What is the calculated minimum before selecting conductors or a device? A. 60 A  B. 63 A  C. 69 A  D. 75 A",
    a: "C - 69 A. 1.25 x 36 = 45 A. Add 24 A = 69 A. This calculation does not choose a conductor size or establish whether the stated factor applies to a particular installation.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P06 Law, business, and practical applications: A defined total cost basis is $9,150. Compare a 20% markup price with a 20% margin price, rounded to cents. A. Both $10,980  B. Markup $10,980; margin $11,437.50  C. Markup $11,437.50; margin $10,980  D. Both $11,437.50 (Business arithmetic; NASCLA navigation may follow)",
    a: "B - $10,980 and $11,437.50. Markup: 9,150 x 1.20 = 10,980. Margin: 9,150/(1 - 0.20) = 11,437.50. Markup uses cost as denominator; margin uses selling price.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P09 Law, business, and practical applications: Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown? A. 310 W  B. 512 W  C. 566 W  D. 704 W",
    a: "C - 566 W. A: 8 x 2 x 32 = 512 W. B: 3 x 1 x 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. Original mini-case, not the official sample circuit.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W02 Wiring methods and terminations: A supplied arithmetic model starts at 95 A, multiplies by 0.91 ambient and 0.80 conductor-count factors, and separately limits the result to a 65 A terminal value. Under ONLY those supplied assumptions, what is the usable maximum? A. 65 A  B. 69.16 A  C. 76 A  D. 95 A",
    a: "A - 65 A. 95 x 0.91 x 0.80 = 69.16 A. The separate supplied terminal cap is 65 A, so min(69.16, 65) = 65 A. The factors, terminal value and actual-load/code applicability still require their own source checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M02 Motors and control wiring: For an arithmetic-only motor drill, the supplied conductor rule is 125% of the supplied table FLC. Table FLC is 28 A. What is the calculated ampacity before terminal/adjustment checks? A. 22 A  B. 28 A  C. 35 A  D. 44 A",
    a: "C - 35 A. 28 x 1.25 = 35 A. The problem supplies the current basis and multiplier. A real installation still needs duty, exception, terminal and installation checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-23; week 4; time target 2 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 21: {
  objective: "Day 21 Motor current basis & conductors: Use 430.6 and Tables 430.248/430.250 to obtain motor full-load CURRENT, not conductor ampacity. Apply 430.22 for the applicable continuous-duty motor branch conductor, generally at least 125% of table FLC; then check terminal limits, ampacity adjustment and stated exceptions.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "M02 Motors and control wiring: For an arithmetic-only motor drill, the supplied conductor rule is 125% of the supplied table FLC. Table FLC is 28 A. What is the calculated ampacity before terminal/adjustment checks? A. 22 A  B. 28 A  C. 35 A  D. 44 A",
    a: "C - 35 A. 28 x 1.25 = 35 A. The problem supplies the current basis and multiplier. A real installation still needs duty, exception, terminal and installation checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "W02 Wiring methods and terminations: A supplied arithmetic model starts at 95 A, multiplies by 0.91 ambient and 0.80 conductor-count factors, and separately limits the result to a 65 A terminal value. Under ONLY those supplied assumptions, what is the usable maximum? A. 65 A  B. 69.16 A  C. 76 A  D. 95 A",
    a: "A - 65 A. 95 x 0.91 x 0.80 = 69.16 A. The separate supplied terminal cap is 65 A, so min(69.16, 65) = 65 A. The factors, terminal value and actual-load/code applicability still require their own source checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-26; week 5; time target 2 h; category: Motors/VD.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 22: {
  objective: "Day 22 Motor protection: separate decisions: Work conductor, overload, branch short-circuit/ground-fault protection and feeder protection as separate answers. Overload uses nameplate current under 430.32; evaluate service factor/temperature-rise and applicable exceptions. Branch fault protection follows 430.52; feeder treatment follows 430.24/430.62.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "M03 Motors and control wiring: A hypothetical overload exercise supplies a 125% multiplier on the nameplate current of 22 A. Compute that result only, without selecting an actual overload setting. A. 22 A  B. 27.5 A  C. 28 A  D. 35 A",
    a: "B - 27.5 A. 22 x 1.25 = 27.5 A. Service factor, temperature rise, exceptions and permissible setting rules have not been supplied as actual NEC determinations.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M04 Motors and control wiring: A supplied feeder-conductor model adds 125% of the largest motor FLC to 100% of the others. The three currents are 40 A, 20 A and 15 A. What model ampacity results? A. 75 A  B. 80 A  C. 85 A  D. 93.75 A",
    a: "C - 85 A. Largest contribution = 1.25 x 40 = 50 A. Other contributions = 20 + 15 = 35 A. Total = 85 A. This does not calculate feeder OCP.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M05 Motors and control wiring: A branch fault-protection arithmetic drill supplies a factor of 250% and table current of 42 A. Compute the product before choosing any standard size or exception. A. 84 A  B. 94.5 A  C. 105 A  D. 125 A",
    a: "C - 105 A. 42 x 2.50 = 105 A. The permitted device type, maximum multiplier, next-size treatment and starting exception must be checked separately for an actual motor.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M08 Motors and control wiring: A feeder supplies several motors and other loads. Identify the separate conductor-ampacity and feeder fault-protection rules, and list all current/device inputs each calculation requires. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A conductor sum does not automatically establish the feeder protective-device answer.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing Day 22 starts at 430.24 and 430.62."
   },
   {
    q: "M06 Motors and control wiring: A motor controller can start and stop a motor. Find whether it also qualifies as the required disconnect in the stated arrangement, including rating, visibility/location and permitted exceptions. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A functional start/stop control does not establish disconnect compliance by itself.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430 controller/disconnect provisions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-27; week 5; time target 2 h; category: Motors/VD. M06 added from the 'Weeks 1-8 learning packets' nested page (Week 5 set); it is not in the Day 22 page itself. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 23: {
  objective: "Day 23 Voltage drop with stated assumptions: Practice balanced three-phase resistance-only approximation VD approx sqrt(3) x K x I x D/CM. D is ONE-WAY feet, I line amperes, CM circular mils; K must match material/temperature. Convert kcmil correctly and compute %VD against line voltage. Use AC impedance/power factor where the question requires them.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "M07 Motors and control wiring: Use ONLY this balanced three-phase resistance-only approximation: VD = sqrt(3) x K x I x D / CM. K = 12.9, I = 40 A, one-way D = 180 ft, CM = 41,740 circular mils, line voltage 480 V. Find approximate volts dropped and percent drop. A. 1.93 V; 0.40%  B. 3.85 V; 0.80%  C. 7.71 V; 1.61%  D. 3.85 V; 1.85%",
    a: "B - approximately 3.85 V and 0.80%. VD = 1.7320508 x 12.9 x 40 x 180 / 41,740 = 3.8542 V. Percent = 100 x 3.8542 / 480 = 0.80297%. D is one-way; do not double it in this supplied three-phase formula. AC reactance, actual temperature and power factor are not modeled.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W09 Wiring methods and terminations: A question supplies DC conductor resistance but describes a three-phase AC circuit at nonunity power factor. What additional impedance information may be needed, and where does the 2020 book distinguish DC properties from AC impedance? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State the model limitations rather than silently applying a resistance-only voltage-drop equation.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Chapter 9 Tables 8 and 9; existing equipment/voltage-drop sessions."
   },
   {
    q: "L03 Load calculations: A load consumes 72 kW at power factor 0.80. Assuming the stated model S = P / PF, what apparent power is required? A. 57.6 kVA  B. 72 kVA  C. 90 kVA  D. 100 kVA",
    a: "C - 90 kVA. 72 / 0.80 = 90 kVA. Multiplying real power by PF goes in the wrong direction for this question.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-28; week 5; time target 2 h; category: Motors/VD.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 24: {
  objective: "Day 24 Equipment, lighting & final coverage sweep: Review appliance, HVAC, lighting and elevator/machine-room rules; use Chapter 9 Tables 8 and 9 to distinguish DC properties from AC impedance. Before Mock A, check all 11 official categories, including special occupancies, NFPA 72 and plans. Repair the largest uncovered topic within this block.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "E03 Appliances, equipment, and lighting: An HVAC nameplate states MCA 28 A and MOCP 45 A. Determine the separate conductor and protective-device decisions. What facts prevent sizing the conductor only from the 45 A number? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Read the equipment markings and Article 440 conditions separately; no conductor size is asserted here.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 440 and applicable ampacity/termination rules."
   },
   {
    q: "E04 Appliances, equipment, and lighting: A transformer primary has suitable overcurrent protection. Does this alone prove that secondary conductors are protected? Identify the additional transformer and secondary-conductor questions. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Transformer OCP and secondary-conductor protection are separate checks; do not assume one answer settles both.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 450 and 240; applicable secondary conductor arrangement."
   },
   {
    q: "E05 Appliances, equipment, and lighting: A luminaire is proposed for a damp/wet location and a particular ceiling insulation condition. What listing, location and installation instructions must be checked? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The complete luminaire and its actual markings matter; lamp wattage alone does not prove suitability.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 110 and 410."
   },
   {
    q: "E06 Appliances, equipment, and lighting: For fixed electric space-heating equipment, find the applicable branch-circuit sizing and control/disconnect requirements. State whether the load treatment differs from a generic appliance. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Identify the exact equipment type and applicable continuous-load treatment instead of using a general multiplier by habit.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 424 and relevant branch-circuit provisions."
   },
   {
    q: "E07 Appliances, equipment, and lighting: An elevator machine room contains lighting, receptacles and elevator equipment. Map the applicable circuits, disconnects and installation-space requirements for the stated equipment. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not let one elevator feeder answer replace separate machine-room circuit and installation checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 620, plus applicable Articles 110 and 410."
   },
   {
    q: "W09 Wiring methods and terminations: A question supplies DC conductor resistance but describes a three-phase AC circuit at nonunity power factor. What additional impedance information may be needed, and where does the 2020 book distinguish DC properties from AC impedance? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State the model limitations rather than silently applying a resistance-only voltage-drop equation.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Chapter 9 Tables 8 and 9; existing equipment/voltage-drop sessions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-10-29; week 5; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 25: {
  objective: "Day 25 Full mock A six-hour block: Take one fresh, full-scope 100-question NC Unlimited mock in one uninterrupted six-hour timed sitting with admitted references and no coaching. Include all 11 categories, NC law/business, NFPA 72 and plans. Record answers, time, raw score and category results; corrections occur in later study blocks.",
  steps: [
   "Before starting: use a legitimate, fresh, complete 100-question NC Unlimited form with separate unexposed key, all 11 domains, NFPA 72/business/plans and the correct edition. Record its provider/form/edition and prior exposure. NEC 2020, NFPA 72 (2013) and NASCLA NC Electrical 14th are the designated books; no AI coaching during a personal readiness run.",
   "During: commit each answer; flag uncertainty; plan approximately 75 minutes per 25 questions, retaining the final hour for review. Record actual interruptions/assistance and label split sittings.",
   "After: save answer sheet before viewing key; record raw score /100, elapsed time and category counts. Source-resolve disputed answers separately, leaving the original score visible. Corrections belong in the next scheduled repair block."
  ],
  questions: [],
  checks: [
   "The new 100-item learning bank is not this validated form (open-response lookups, unverified technical keys). Do not count it as Mock A, invent a score, or expose a reserved publisher key. If no qualifying form is available, record that blocker and use an explicitly labelled learning session. Buffer D retains the row's 50-question fresh-set alternative.",
   "Readiness coaching gate: two fresh full mocks at 82%+ within six hours, no persistent category below 70% with adequate fresh samples.",
   "AI validation remains 0/3 documented perfect runs until actual independent runs meet the existing protocol."
  ],
  notes: "Planned 2026-10-31; week 5; time target 6 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 26: {
  objective: "Day 26 Mock A repair & higher voltage: Use the first hour to correct Mock A's highest-impact recurring errors. Then navigate 2020 Articles 311 and 490 plus 110 clearances: conductor scope, applicable MV ampacity tables/conditions, shields and equipment rules. State voltage and installation assumptions; verify section numbers in 2020.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "W08 Wiring methods and terminations: For a medium-voltage conductor installation, locate the 2020 article and applicable ampacity table. List voltage, conductor construction, installation geometry and temperature assumptions before choosing a value. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A table value without its installation basis is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 311 and referenced ampacity provisions; existing Day 26."
   },
   {
    q: "O08 Overcurrent protection: For equipment operating above 1,000 V, find the applicable overcurrent protection provisions. Record the voltage scope and one difference from an ordinary low-voltage circuit. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Use the 2020 organization rather than a later-edition table of contents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 higher-voltage portions of Articles 240 and 490; confirm final route in the book."
   },
   {
    q: "G10 Bonding and grounding: For a 4.16 kV installation, locate the higher-voltage grounding provisions and identify system grounding, equipment grounding and applicable substation/fence requirements. What engineering data would still be needed for touch/step evaluation? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Separate code-scope lookup from a completed substation grounding design. State the voltage and actual arrangement.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 250 Part X, as routed by the existing Day 13 session."
   },
   {
    q: "O02 Overcurrent protection: The stated available fault current is 25 kA; a proposed device is individually marked 10 kA. Which additional facts and permitted protection arrangement would have to be verified before approval? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not infer suitability from ampere rating. Check available fault current, equipment rating and any documented permitted combination.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 110 interrupting rating and equipment short-circuit suitability."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-02; week 6; time target 2 h; category: High Voltage/Safety. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 27: {
  objective: "Day 27 Hazardous locations & hangars: Drill Articles 500-506 and 511, 513, 514, 515, 516: class/division or zone, material group, temperature suitability, seals and boundaries. Give aircraft hangars and bulk storage dedicated lookups. Explain why an ordinary-location answer would be incomplete.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "H01 Special occupancies and hazardous locations: A process can release flammable gas/vapor. Identify the classification system, material group, normal/abnormal release conditions and temperature marking data needed before selecting equipment. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Building name alone does not determine class/division or zone, group or temperature suitability.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 500-506; applicable process article."
   },
   {
    q: "H02 Special occupancies and hazardous locations: For an aircraft hangar, map the classified boundary from the actual floor/aircraft/process facts and identify permitted wiring and equipment inside it. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Give the exact 2020 condition and diagram evidence; do not reuse a gasoline-station distance.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 513, Unlimited-specific scope in the official outline."
   },
   {
    q: "H03 Special occupancies and hazardous locations: A fuel dispenser circuit includes ungrounded conductors and a grounded conductor. Determine the required disconnecting action and any applicable exceptions. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Identify all conductors included in the specific requirement. A generic motor disconnect rule is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 514."
   },
   {
    q: "H04 Special occupancies and hazardous locations: A bulk fuel storage operation includes loading/unloading and tanks. Identify which process rules control classified boundaries, wiring, seals and equipment. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Article selection is part of the answer; do not omit bulk storage while studying only fuel dispensing.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 515 and applicable general classified-location provisions."
   },
   {
    q: "H05 Special occupancies and hazardous locations: A spray finishing area uses a flammable coating. What process, ventilation and enclosure facts determine the applicable classified-location rules? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Record the operation and actual boundaries before equipment selection.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 516 and referenced general provisions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-03; week 6; time target 2 h; category: Special Occupancies.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 28: {
  objective: "Day 28 Special occupancies & emergency systems: Run timed questions on 517 health care, 518 assembly, 520 theaters, 550 mobile homes, 680 pools and 700 emergency systems; compare 701/702 only to identify the system. Include 620 elevator controls/traveling cables. Check triggers and exceptions in the 2020 text.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "H06 Special occupancies and hazardous locations: A health-care space has patient-care activity. Identify the space classification and applicable grounding/wiring requirements, including any treatment of an essential electrical system. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Health-care occupancy and exact space function both matter.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 517."
   },
   {
    q: "H07 Special occupancies and hazardous locations: Compare a general assembly space and a theater with stage equipment. Identify which special occupancy rules apply to each and one installation condition that changes the analysis. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not treat Article 518 and theater/stage provisions as interchangeable.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 518 and 520."
   },
   {
    q: "H08 Special occupancies and hazardous locations: For a swimming pool, distinguish equipotential bonding from the equipment grounding path. Locate the rules for the actual pool structure and underwater luminaire type. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Two related protection functions require separate decisions; a bonding-grid sketch alone is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 680."
   },
   {
    q: "H09 Special occupancies and hazardous locations: Classify three generator loads: required life-safety emergency loads, legally required standby loads and optional convenience loads. Determine the controlling system article and installation consequences. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A generator does not automatically make every circuit an emergency system.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 700, 701 and 702; then inspect the specific classification."
   },
   {
    q: "W07 Wiring methods and terminations: An elevator traveling cable includes power and control circuits. Locate the specific wiring and separation requirements; record the condition that permits or prohibits the proposed arrangement. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The elevator application supplements general wiring rules. Do not infer conductor separation from a generic low-voltage rule alone.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 620, per existing Day 28 and study guide."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-04; week 6; time target 2 h; category: Special Occupancies.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 29: {
  objective: "Day 29 Repair gaps before Mock B: Re-solve Mock A errors from blank paper, then use fresh questions in the two weakest official categories. Include one NFPA 72 lookup set and a plan-reading drill. NFPA 70E safety enrichment is optional after core coverage; it is not an admitted exam reference or a substitute for tested NEC topics.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P13 Law, business, and practical applications: For one exact fire-alarm device and system type, find inspection, testing and maintenance tasks/frequencies in the 2013 book. Record the exact table row and any exception. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not collapse inspection and testing into one generic annual answer.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 Chapter 14; exact row must be verified. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P09 Law, business, and practical applications: Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown? A. 310 W  B. 512 W  C. 566 W  D. 704 W",
    a: "C - 566 W. A: 8 x 2 x 32 = 512 W. B: 3 x 1 x 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. Original mini-case, not the official sample circuit.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P10 Law, business, and practical applications: Original plan mini-case: there are nine two-lamp fixtures and five one-lamp fixtures on the traced circuit. Find fixture count and lamp count. A. 14 fixtures; 14 lamps  B. 14 fixtures; 23 lamps  C. 23 fixtures; 14 lamps  D. 18 fixtures; 23 lamps (Original plan-reading arithmetic)",
    a: "B - 14 fixtures; 23 lamps. Fixtures = 9 + 5 = 14. Lamps = 9 x 2 + 5 = 23. Do not substitute one quantity for the other in a wattage or takeoff question.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-05; week 6; time target 2 h; category: Mock Exam. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 30: {
  objective: "Day 30 Full mock B six-hour block: Use a second fresh 100-question full-scope form in one six-hour sitting under the same reference rules. Record raw score, time and category evidence before corrections. Compare recurring error causes with A; do not count repeated/exposed questions as fresh readiness evidence.",
  steps: [
   "Before starting: use a legitimate, fresh, complete 100-question NC Unlimited form with separate unexposed key, all 11 domains, NFPA 72/business/plans and the correct edition. Record its provider/form/edition and prior exposure. NEC 2020, NFPA 72 (2013) and NASCLA NC Electrical 14th are the designated books; no AI coaching during a personal readiness run.",
   "During: commit each answer; flag uncertainty; plan approximately 75 minutes per 25 questions, retaining the final hour for review. Record actual interruptions/assistance and label split sittings.",
   "After: save answer sheet before viewing key; record raw score /100, elapsed time and category counts. Source-resolve disputed answers separately, leaving the original score visible. Corrections belong in the next scheduled repair block."
  ],
  questions: [],
  checks: [
   "The new 100-item learning bank is not this validated form (open-response lookups, unverified technical keys). Do not count it as a mock, invent a score, or expose a reserved publisher key. If no qualifying form is available, record that blocker and use an explicitly labelled learning session. Buffer D retains the row's 50-question fresh-set alternative.",
   "Readiness coaching gate: two fresh full mocks at 82%+ within six hours, no persistent category below 70% with adequate fresh samples.",
   "AI validation remains 0/3 documented perfect runs until actual independent runs meet the existing protocol."
  ],
  notes: "Planned 2026-11-07; week 6; time target 6 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 31: {
  objective: "Day 31 NFPA 72 systems & navigation: Use the 2013 NFPA 72: navigate Chapters 10, 12, 14, 17, 18, 23, 26 and 29 by function. Work initiating devices, notification, pathways, power and inspection/testing. For each numerical answer record system type, condition and exact section; avoid later-edition substitutions.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P12 Law, business, and practical applications: A fire-alarm battery arithmetic drill supplies these STUDY assumptions, without claiming prescribed 2013 durations: standby 0.25 A for 24 h, alarm 2.0 A for five minutes, then multiply the sum by 1.25. What capacity follows to two decimals? A. 6.17 Ah  B. 7.71 Ah  C. 8.00 Ah  D. 12.50 Ah (NFPA-related arithmetic under explicitly supplied assumptions)",
    a: "B - 7.71 Ah. Standby = 0.25 x 24 = 6 Ah. Alarm = 2 x (5/60) = 0.1666667 Ah. Sum = 6.1666667; supplied multiplier gives 7.7083333 Ah = 7.71 Ah. Actual system standby/alarm duration, derating and selected battery capacity require separate 2013 verification.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P13 Law, business, and practical applications: For one exact fire-alarm device and system type, find inspection, testing and maintenance tasks/frequencies in the 2013 book. Record the exact table row and any exception. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not collapse inspection and testing into one generic annual answer.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 Chapter 14; exact row must be verified. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P14 Law, business, and practical applications: A smoke detector is proposed for door-release service. Determine the application-specific placement requirements for the actual door and ceiling arrangement, separate from ordinary area coverage. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State the door/ceiling/system configuration; do not transfer a general spacing number to door-release service.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 initiating-device and interface provisions; exact section must be found. (https://link.nfpa.org/free-access/publications/72/2013)"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-09; week 7; time target 2 h; category: NFPA 72.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 32: {
  objective: "Day 32 Detection, door release & plans: Verify detector placement and door-release service requirements in the 2013 text; distinguish the specific door arrangement and application from general area coverage. Complete handbook lighting/power-plan exercises by tracing circuits, symbols, notes and schedules. Log the evidence location.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P14 Law, business, and practical applications: A smoke detector is proposed for door-release service. Determine the application-specific placement requirements for the actual door and ceiling arrangement, separate from ordinary area coverage. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State the door/ceiling/system configuration; do not transfer a general spacing number to door-release service.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 initiating-device and interface provisions; exact section must be found. (https://link.nfpa.org/free-access/publications/72/2013)"
   },
   {
    q: "P09 Law, business, and practical applications: Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown? A. 310 W  B. 512 W  C. 566 W  D. 704 W",
    a: "C - 566 W. A: 8 x 2 x 32 = 512 W. B: 3 x 1 x 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. Original mini-case, not the official sample circuit.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P10 Law, business, and practical applications: Original plan mini-case: there are nine two-lamp fixtures and five one-lamp fixtures on the traced circuit. Find fixture count and lamp count. A. 14 fixtures; 14 lamps  B. 14 fixtures; 23 lamps  C. 23 fixtures; 14 lamps  D. 18 fixtures; 23 lamps (Original plan-reading arithmetic)",
    a: "B - 14 fixtures; 23 lamps. Fixtures = 9 + 5 = 14. Lamps = 9 x 2 + 5 = 23. Do not substitute one quantity for the other in a wattage or takeoff question.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-10; week 7; time target 2 h; category: NFPA 72.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 33: {
  objective: "Day 33 Mixed calculations under time: Complete 20 timed calculation questions mixing loads, transformers, motors, GEC/EGC/bonding jumpers, box/raceway fill and voltage drop. Reserve time to grade and reconstruct missed setups. Label units, reference, current basis and assumptions before arithmetic.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "L01 Load calculations: A single-phase load is 28,800 VA at 240 V. With no additional factors to apply, what is the current? A. 60 A  B. 100 A  C. 120 A  D. 240 A",
    a: "C - 120 A. I = 28,800 / 240 = 120 A. The apparent load is already given; do not introduce an unstated demand factor.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L02 Load calculations: A balanced three-phase load is 138.6 kVA at 480 V line-to-line. Use I = 1,000 x kVA / (sqrt(3) x V_LL). What is line current to the nearest ampere? A. 96 A  B. 167 A  C. 289 A  D. 500 A",
    a: "B - 167 A. 138,600 / (1.7320508 x 480) = 166.7179 A, rounded to 167 A. Do not use line-to-neutral voltage in this stated formula.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E01 Appliances, equipment, and lighting: A balanced 75 kVA three-phase transformer has 480 V primary and 208 V secondary, both line-to-line. Use I = 75,000/(sqrt(3) x V_LL). What are approximate primary and secondary line currents? A. 90.2 A and 208.2 A  B. 156.3 A and 360.6 A  C. 208.2 A and 90.2 A  D. 75 A and 75 A",
    a: "A - 90.2 A and 208.2 A. Primary = 75,000/(1.7320508 x 480) = 90.211 A. Secondary = 75,000/(1.7320508 x 208) = 208.179 A. These are current calculations only; OCP, conductors and bonding need separate rules.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E02 Appliances, equipment, and lighting: A 500 kVA, 480 V three-phase transformer has 5.75% impedance. Under the supplied stiff-source, secondary-terminal bolted-fault model, use I_FL = 500,000/(sqrt(3) x 480), then I_SC = I_FL/0.0575. Choose the approximate result. A. 1.046 kA  B. 6.014 kA  C. 10.459 kA  D. 104.59 kA",
    a: "C - approximately 10.459 kA. I_FL = 601.4065 A. Convert 5.75% to 0.0575. I_SC = 601.4065/0.0575 = 10,459.24 A. Upstream/conductor impedance and motor contributions are outside this simplified model.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M02 Motors and control wiring: For an arithmetic-only motor drill, the supplied conductor rule is 125% of the supplied table FLC. Table FLC is 28 A. What is the calculated ampacity before terminal/adjustment checks? A. 22 A  B. 28 A  C. 35 A  D. 44 A",
    a: "C - 35 A. 28 x 1.25 = 35 A. The problem supplies the current basis and multiplier. A real installation still needs duty, exception, terminal and installation checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M04 Motors and control wiring: A supplied feeder-conductor model adds 125% of the largest motor FLC to 100% of the others. The three currents are 40 A, 20 A and 15 A. What model ampacity results? A. 75 A  B. 80 A  C. 85 A  D. 93.75 A",
    a: "C - 85 A. Largest contribution = 1.25 x 40 = 50 A. Other contributions = 20 + 15 = 35 A. Total = 85 A. This does not calculate feeder OCP.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M07 Motors and control wiring: Use ONLY this balanced three-phase resistance-only approximation: VD = sqrt(3) x K x I x D / CM. K = 12.9, I = 40 A, one-way D = 180 ft, CM = 41,740 circular mils, line voltage 480 V. Find approximate volts dropped and percent drop. A. 1.93 V; 0.40%  B. 3.85 V; 0.80%  C. 7.71 V; 1.61%  D. 3.85 V; 1.85%",
    a: "B - approximately 3.85 V and 0.80%. VD = 1.7320508 x 12.9 x 40 x 180 / 41,740 = 3.8542 V. Percent = 100 x 3.8542 / 480 = 0.80297%. D is one-way; do not double it in this supplied three-phase formula. AC reactance, actual temperature and power factor are not modeled.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "B01 Boxes and fittings: This fictional small-box arithmetic exercise stipulates: six conductor allowances, two device allowances, one clamp allowance and two grounding allowances, all at 2.25 in3 each. What required volume follows from those stated allowances? A. 20.25 in3  B. 22.50 in3  C. 24.75 in3  D. 27.00 in3",
    a: "C - 24.75 in3. Allowances total 6 + 2 + 1 + 2 = 11. Volume = 11 x 2.25 = 24.75 in3. This does not verify that the supplied grounding/device/clamp counts match a real 2020 installation.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "B04 Boxes and fittings: For a fictional angle-pull model, the supplied formula is six times the largest raceway in the relevant row plus the sum of the other raceway sizes in that row. Sizes are 3, 2 and 1 inches. Calculate that model dimension only. A. 18 in  B. 21 in  C. 24 in  D. 36 in",
    a: "B - 21 in. 6 x 3 + 2 + 1 = 21 inches. Other required dimensions, same-conductor raceway spacing and actual applicability remain separate checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W03 Wiring methods and terminations: A fictitious raceway has 2.00 in2 of internal area. This exercise stipulates a 40% permitted fill and 0.12 in2 per identical conductor. How many whole conductors fit under those assumptions? A. 6  B. 7  C. 8  D. 16",
    a: "A - 6. Permitted area = 2.00 x 0.40 = 0.80 in2. 0.80 / 0.12 = 6.666...; round DOWN to 6 whole conductors. Check the actual wiring method and Chapter 9 data before using this in a design.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-11; week 7; time target 2 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 34: {
  objective: "Day 34 Mock B repair & readiness decision: Correct B's misses, retest recurring errors after a delay and inspect category coverage. Use the actual appointment/authorization/cancellation terms for any date decision. Coaching gate remains two fresh full mocks at 82%+ within six hours and no persistent category below 70% across adequate samples.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-12; week 7; time target 2 h; category: Mock Exam. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 35: {
  objective: "Day 35 Full mock C six-hour block: Take the third fresh full-scope 100-question form in a single six-hour sitting. Use admitted books only and record score/time without assistance. This is 23 days before the December 7 exam; buffer mock D follows on November 21. Record actual results, not a completion inferred from this planned date.",
  steps: [
   "Before starting: use a legitimate, fresh, complete 100-question NC Unlimited form with separate unexposed key, all 11 domains, NFPA 72/business/plans and the correct edition. Record its provider/form/edition and prior exposure. NEC 2020, NFPA 72 (2013) and NASCLA NC Electrical 14th are the designated books; no AI coaching during a personal readiness run.",
   "During: commit each answer; flag uncertainty; plan approximately 75 minutes per 25 questions, retaining the final hour for review. Record actual interruptions/assistance and label split sittings.",
   "After: save answer sheet before viewing key; record raw score /100, elapsed time and category counts. Source-resolve disputed answers separately, leaving the original score visible. Corrections belong in the next scheduled repair block."
  ],
  questions: [],
  checks: [
   "The new 100-item learning bank is not this validated form (open-response lookups, unverified technical keys). Do not count it as a mock, invent a score, or expose a reserved publisher key. If no qualifying form is available, record that blocker and use an explicitly labelled learning session. Buffer D retains the row's 50-question fresh-set alternative.",
   "Readiness coaching gate: two fresh full mocks at 82%+ within six hours, no persistent category below 70% with adequate fresh samples.",
   "AI validation remains 0/3 documented perfect runs until actual independent runs meet the existing protocol."
  ],
  notes: "Planned 2026-11-14; week 7; time target 6 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 36: {
  objective: "Day 36 Mock C correction & delayed recall: Grade and source-check C; correct every significant miss and re-solve recurring errors without viewing the old solution. Consolidate only actual misses in Active Recall & Error Log. Check Mastered? only after two clean delayed re-solves on separate days.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "L10 Load calculations: Compare a 2020 and later-edition occupancy lighting table/organization. Identify the actual 2020 value and section used for a proposed office question. Why is a later-edition explanation insufficient as an exam key? Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: The designated edition controls the lookup; do not invent a factor or section from memory.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 220 lighting provisions; existing guide flags later reorganization."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-16; week 8; time target 2 h; category: Mock Exam. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 37: {
  objective: "Day 37 Law & business final polish: Recall QI/licensee duties, project value/splitting, renewal, permits, contracts, bonds/insurance, estimating and payroll. Then locate supporting NASCLA 14th pages. Recheck the current Board handbook and the actual PSI confirmation for admitted books, IDs, reporting time and center.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P01 Law, business, and practical applications: A candidate passes the Unlimited examination. What must still occur before treating the business as licensed? A. Nothing; a passing score is the license  B. Board license application/issuance and applicable licensing requirements  C. Only purchasing a ground rod  D. Only completing an online mock (Closed-book recall first; source-check after committing answer)",
    a: "B - Board license application/issuance and applicable licensing requirements. Passing alone does not issue the contracting license. The current handbook instructs passing candidates to complete the license application; current G.S. 87-43.2 specifies issuance requirements.",
    src: "G.S. 87-43.2(a); corroborated by July 2026 handbook checklist. G.S. 87-43.2, current Legislature text; verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P02 Law, business, and practical applications: One project includes $52,000 of contractor-supplied electrical value components and $18,000 of known owner-supplied electrical equipment, with no duplicate amount. Does calling the contractor contract $52,000 settle the project-value calculation? A. Yes; owner purchases are excluded  B. No; total stated project value is $70,000  C. Yes; split invoices always create separate projects  D. Only voltage matters (Closed-book recall first; source-check after committing answer)",
    a: "B - No; $70,000. 52,000 + 18,000 = 70,000. Rule .0303 includes relevant known or reasonably estimated electrical value regardless of who furnishes the materials/equipment. Do not confuse contract-label amount with project value.",
    src: "21 NCAC 18B .0303(4), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P03 Law, business, and practical applications: Under the Board renewal rule, when are the license renewal application and fee due relative to expiration? A. 30 days before expiration  B. Five days after expiration  C. Only when a new job begins  D. Every two years (Closed-book recall first; source-check after committing answer)",
    a: "A - 30 days before expiration. The trigger is license expiration. Distinguish this from the five-day listed-QI employment notice and annual exam scheduling rules.",
    src: "21 NCAC 18B .0405(a), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P05 Law, business, and practical applications: Assume the documented categories are accepted: 8,000 primary hours and 1,200 helper hours credited as secondary at 80%. Do these alone reach the current Unlimited 9,000 total-hour threshold? A. Yes; raw hours total 9,200  B. Yes; every helper hour is primary  C. No; credited total is 8,960, short by 40 hours  D. No; the requirement is nine years (Closed-book recall first; source-check after committing answer)",
    a: "C - 8,960 credited hours; 40 short. Secondary credit = 1,200 x 0.80 = 960. Total = 8,000 + 960 = 8,960. Primary threshold is met; total threshold is not. The Board must accept the underlying activities and documentation.",
    src: "21 NCAC 18B .0201(b)(3) and .0202(b); 21 NCAC 18B, current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P06 Law, business, and practical applications: A defined total cost basis is $9,150. Compare a 20% markup price with a 20% margin price, rounded to cents. A. Both $10,980  B. Markup $10,980; margin $11,437.50  C. Markup $11,437.50; margin $10,980  D. Both $11,437.50 (Business arithmetic; NASCLA navigation may follow)",
    a: "B - $10,980 and $11,437.50. Markup: 9,150 x 1.20 = 10,980. Margin: 9,150/(1 - 0.20) = 11,437.50. Markup uses cost as denominator; margin uses selling price.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P15 Law, business, and practical applications: An owner asks for additional work before a change price is agreed. In NASCLA 14th, locate contract-change documentation and notice topics, then write the facts/authorization/cost/schedule records needed for this case. Write: answer > exact source > condition/exception > elapsed time. (Admitted-book business lookup)",
    a: "Book lookup required: Identify actual contract authority, notice and documentation; a verbal request does not settle every entitlement question.",
    src: "Book lookup required (NASCLA NC Electrical 14th, contract/project-management topics; record page, no page invented): https://store.nascla.org/products/north-carolina-electrical-14th-edition"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-17; week 8; time target 2 h; category: Law & Business. Use existing material: cards 02-09, 11, 14-17, 21-28 and finance/contract cards: choose six weakest, then scenarios 1, 8, 11 or 15. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 38: {
  objective: "Day 38 Mixed precision & weak-area sets: Review readiness evidence after Mock C. Use fresh short sets in weak areas and delayed retests; avoid a new six-hour exam this week (mock D is November 21). The date-change decision moved to December 2, five calendar days before the December 7 exam; the actual PSI cutoff controls.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P02 Law, business, and practical applications: One project includes $52,000 of contractor-supplied electrical value components and $18,000 of known owner-supplied electrical equipment, with no duplicate amount. Does calling the contractor contract $52,000 settle the project-value calculation? A. Yes; owner purchases are excluded  B. No; total stated project value is $70,000  C. Yes; split invoices always create separate projects  D. Only voltage matters (Closed-book recall first; source-check after committing answer)",
    a: "B - No; $70,000. 52,000 + 18,000 = 70,000. Rule .0303 includes relevant known or reasonably estimated electrical value regardless of who furnishes the materials/equipment. Do not confuse contract-label amount with project value.",
    src: "21 NCAC 18B .0303(4), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "H09 Special occupancies and hazardous locations: Classify three generator loads: required life-safety emergency loads, legally required standby loads and optional convenience loads. Determine the controlling system article and installation consequences. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: A generator does not automatically make every circuit an emergency system.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Articles 700, 701 and 702; then inspect the specific classification."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-18; week 8; time target 2 h; category: Mock Exam. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 39: {
  objective: "Day 39 Table navigation & light review: Light final review of known mistakes and Tables 250.66, 250.102(C)(1), 250.122, 310.16, 430.248/430.250 and Chapter 9. Include NFPA 72 and NASCLA page navigation. Stop early if retrieval is clean; Time Target is a maximum allocation, not a requirement to cram.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G04 Bonding and grounding: For a feeder protected at 200 A, find the minimum copper EGC from the designated book. State whether any conductor-size increase or installation condition changes your answer. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Record the exact row and all applicable adjustment or upsizing conditions. A number without the condition is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; Table 250.122 and applicable accompanying provisions."
   },
   {
    q: "G07 Bonding and grounding: Draw one service and one isolated transformer secondary. Label the main bonding jumper and system bonding jumper and locate each permitted connection point. Find the sizing provisions rather than reusing the EGC table. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State which system and conductor function controls the jumper. Explain placement and parallel-path restrictions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; the existing session routes through 250.24, 250.28, 250.30 and 250.102."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "W03 Wiring methods and terminations: A fictitious raceway has 2.00 in2 of internal area. This exercise stipulates a 40% permitted fill and 0.12 in2 per identical conductor. How many whole conductors fit under those assumptions? A. 6  B. 7  C. 8  D. 16",
    a: "A - 6. Permitted area = 2.00 x 0.40 = 0.80 in2. 0.80 / 0.12 = 6.666...; round DOWN to 6 whole conductors. Check the actual wiring method and Chapter 9 data before using this in a design.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-19; week 8; time target 2 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 40: {
  objective: "Buffer Full mock D six-hour block: Take a fourth fresh full-scope 100-question form in one six-hour sitting, admitted books only, no assistance. If no fourth fresh form is available, do a timed 50-question fresh mixed set plus correction instead; never repeat an exposed form as a readiness score. Record the actual score and time.",
  steps: [
   "Before starting: use a legitimate, fresh, complete 100-question NC Unlimited form with separate unexposed key, all 11 domains, NFPA 72/business/plans and the correct edition. Record its provider/form/edition and prior exposure. NEC 2020, NFPA 72 (2013) and NASCLA NC Electrical 14th are the designated books; no AI coaching during a personal readiness run.",
   "During: commit each answer; flag uncertainty; plan approximately 75 minutes per 25 questions, retaining the final hour for review. Record actual interruptions/assistance and label split sittings.",
   "After: save answer sheet before viewing key; record raw score /100, elapsed time and category counts. Source-resolve disputed answers separately, leaving the original score visible. Corrections belong in the next scheduled repair block."
  ],
  questions: [],
  checks: [
   "The new 100-item learning bank is not this validated form (open-response lookups, unverified technical keys). Do not count it as a mock, invent a score, or expose a reserved publisher key. If no qualifying form is available, record that blocker and use an explicitly labelled learning session. Buffer D retains the row's 50-question fresh-set alternative.",
   "Readiness coaching gate: two fresh full mocks at 82%+ within six hours, no persistent category below 70% with adequate fresh samples.",
   "AI validation remains 0/3 documented perfect runs until actual independent runs meet the existing protocol."
  ],
  notes: "Planned 2026-11-21; week 9; time target 6 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 41: {
  objective: "Buffer Mock D correction & final readiness review: Grade and source-check mock D; correct every significant miss. Readiness review 14 days before the December 7 exam: two fresh full mocks at 82%+ within six hours and no persistent category below 70%? Pick the two weakest categories for the final ten days.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-23; week 9; time target 2 h; category: Mock Exam. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 42: {
  objective: "Buffer Weakest two categories: Targeted fresh questions in the two weakest categories from the November 23 review. Re-solve recurring misses without viewing old solutions. Then take Thanksgiving week off (optional 20-minute recall only).",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-24; week 9; time target 2 h; category: Code Speed. Start with actual prior misses: choose the two highest-impact categories from real results. Starter items are a learning fallback and may be repeats; they cannot replace fresh readiness evidence. Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 43: {
  objective: "Buffer Law & business + NFPA 72 refresh: Recall QI/licensee duties, project limits, permits, contracts, bonds/insurance and payroll; locate supporting NASCLA 14th pages. Then a short 2013 NFPA 72 navigation drill. Recheck the handbook and PSI confirmation for admitted books, IDs, reporting time and center.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "P01 Law, business, and practical applications: A candidate passes the Unlimited examination. What must still occur before treating the business as licensed? A. Nothing; a passing score is the license  B. Board license application/issuance and applicable licensing requirements  C. Only purchasing a ground rod  D. Only completing an online mock (Closed-book recall first; source-check after committing answer)",
    a: "B - Board license application/issuance and applicable licensing requirements. Passing alone does not issue the contracting license. The current handbook instructs passing candidates to complete the license application; current G.S. 87-43.2 specifies issuance requirements.",
    src: "G.S. 87-43.2(a); corroborated by July 2026 handbook checklist. G.S. 87-43.2, current Legislature text; verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P02 Law, business, and practical applications: One project includes $52,000 of contractor-supplied electrical value components and $18,000 of known owner-supplied electrical equipment, with no duplicate amount. Does calling the contractor contract $52,000 settle the project-value calculation? A. Yes; owner purchases are excluded  B. No; total stated project value is $70,000  C. Yes; split invoices always create separate projects  D. Only voltage matters (Closed-book recall first; source-check after committing answer)",
    a: "B - No; $70,000. 52,000 + 18,000 = 70,000. Rule .0303 includes relevant known or reasonably estimated electrical value regardless of who furnishes the materials/equipment. Do not confuse contract-label amount with project value.",
    src: "21 NCAC 18B .0303(4), current consolidated Board rules; verified October 5, 2026: https://www.ncbeec.org/title-21-ncac-18b/"
   },
   {
    q: "P04 Law, business, and practical applications: A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified? A. Five days  B. Ten days  C. 30 days  D. One year (Closed-book recall first; source-check after committing answer)",
    a: "A - Five days. The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together. Current law practice: an older NASCLA example or undated question may use a different date; preserve source/date and resolve conflict.",
    src: "G.S. 87-43.2(a)(3), ncleg.gov current text, verified October 5, 2026: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-43.2.html"
   },
   {
    q: "P06 Law, business, and practical applications: A defined total cost basis is $9,150. Compare a 20% markup price with a 20% margin price, rounded to cents. A. Both $10,980  B. Markup $10,980; margin $11,437.50  C. Markup $11,437.50; margin $10,980  D. Both $11,437.50 (Business arithmetic; NASCLA navigation may follow)",
    a: "B - $10,980 and $11,437.50. Markup: 9,150 x 1.20 = 10,980. Margin: 9,150/(1 - 0.20) = 11,437.50. Markup uses cost as denominator; margin uses selling price.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P11 Law, business, and practical applications: Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Confirm the exact terms and system context; device role and signal classification are separate questions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10. (https://link.nfpa.org/free-access/publications/72/2013)"
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-11-30; week 10; time target 2 h; category: Law & Business.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 44: {
  objective: "Buffer Mixed calculations, fresh short set: Twenty fresh timed calculation questions (loads, transformers, motors, GEC/EGC, fill, voltage drop). Label units, reference and assumptions before arithmetic; correct and log misses.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "L01 Load calculations: A single-phase load is 28,800 VA at 240 V. With no additional factors to apply, what is the current? A. 60 A  B. 100 A  C. 120 A  D. 240 A",
    a: "C - 120 A. I = 28,800 / 240 = 120 A. The apparent load is already given; do not introduce an unstated demand factor.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "L02 Load calculations: A balanced three-phase load is 138.6 kVA at 480 V line-to-line. Use I = 1,000 x kVA / (sqrt(3) x V_LL). What is line current to the nearest ampere? A. 96 A  B. 167 A  C. 289 A  D. 500 A",
    a: "B - 167 A. 138,600 / (1.7320508 x 480) = 166.7179 A, rounded to 167 A. Do not use line-to-neutral voltage in this stated formula.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E01 Appliances, equipment, and lighting: A balanced 75 kVA three-phase transformer has 480 V primary and 208 V secondary, both line-to-line. Use I = 75,000/(sqrt(3) x V_LL). What are approximate primary and secondary line currents? A. 90.2 A and 208.2 A  B. 156.3 A and 360.6 A  C. 208.2 A and 90.2 A  D. 75 A and 75 A",
    a: "A - 90.2 A and 208.2 A. Primary = 75,000/(1.7320508 x 480) = 90.211 A. Secondary = 75,000/(1.7320508 x 208) = 208.179 A. These are current calculations only; OCP, conductors and bonding need separate rules.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "E02 Appliances, equipment, and lighting: A 500 kVA, 480 V three-phase transformer has 5.75% impedance. Under the supplied stiff-source, secondary-terminal bolted-fault model, use I_FL = 500,000/(sqrt(3) x 480), then I_SC = I_FL/0.0575. Choose the approximate result. A. 1.046 kA  B. 6.014 kA  C. 10.459 kA  D. 104.59 kA",
    a: "C - approximately 10.459 kA. I_FL = 601.4065 A. Convert 5.75% to 0.0575. I_SC = 601.4065/0.0575 = 10,459.24 A. Upstream/conductor impedance and motor contributions are outside this simplified model.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M02 Motors and control wiring: For an arithmetic-only motor drill, the supplied conductor rule is 125% of the supplied table FLC. Table FLC is 28 A. What is the calculated ampacity before terminal/adjustment checks? A. 22 A  B. 28 A  C. 35 A  D. 44 A",
    a: "C - 35 A. 28 x 1.25 = 35 A. The problem supplies the current basis and multiplier. A real installation still needs duty, exception, terminal and installation checks.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "M07 Motors and control wiring: Use ONLY this balanced three-phase resistance-only approximation: VD = sqrt(3) x K x I x D / CM. K = 12.9, I = 40 A, one-way D = 180 ft, CM = 41,740 circular mils, line voltage 480 V. Find approximate volts dropped and percent drop. A. 1.93 V; 0.40%  B. 3.85 V; 0.80%  C. 7.71 V; 1.61%  D. 3.85 V; 1.85%",
    a: "B - approximately 3.85 V and 0.80%. VD = 1.7320508 x 12.9 x 40 x 180 / 41,740 = 3.8542 V. Percent = 100 x 3.8542 / 480 = 0.80297%. D is one-way; do not double it in this supplied three-phase formula. AC reactance, actual temperature and power factor are not modeled.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "B01 Boxes and fittings: This fictional small-box arithmetic exercise stipulates: six conductor allowances, two device allowances, one clamp allowance and two grounding allowances, all at 2.25 in3 each. What required volume follows from those stated allowances? A. 20.25 in3  B. 22.50 in3  C. 24.75 in3  D. 27.00 in3",
    a: "C - 24.75 in3. Allowances total 6 + 2 + 1 + 2 = 11. Volume = 11 x 2.25 = 24.75 in3. This does not verify that the supplied grounding/device/clamp counts match a real 2020 installation.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "W03 Wiring methods and terminations: A fictitious raceway has 2.00 in2 of internal area. This exercise stipulates a 40% permitted fill and 0.12 in2 per identical conductor. How many whole conductors fit under those assumptions? A. 6  B. 7  C. 8  D. 16",
    a: "A - 6. Permitted area = 2.00 x 0.40 = 0.80 in2. 0.80 / 0.12 = 6.666...; round DOWN to 6 whole conductors. Check the actual wiring method and Chapter 9 data before using this in a design.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "S02 Service entrance and equipment: A balanced single-phase 120/240 V service has a calculated apparent load of 26,400 VA. Assume the provided load has already received all required treatment. What line current follows? A. 55 A  B. 100 A  C. 110 A  D. 220 A",
    a: "C - 110 A. I = VA / V = 26,400 / 240 = 110 A. Use line-to-line 240 V for the stated balanced total, not 120 V. Conductor and OCP selection are separate.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   },
   {
    q: "P12 Law, business, and practical applications: A fire-alarm battery arithmetic drill supplies these STUDY assumptions, without claiming prescribed 2013 durations: standby 0.25 A for 24 h, alarm 2.0 A for five minutes, then multiply the sum by 1.25. What capacity follows to two decimals? A. 6.17 Ah  B. 7.71 Ah  C. 8.00 Ah  D. 12.50 Ah (NFPA-related arithmetic under explicitly supplied assumptions)",
    a: "B - 7.71 Ah. Standby = 0.25 x 24 = 6 Ah. Alarm = 2 x (5/60) = 0.1666667 Ah. Sum = 6.1666667; supplied multiplier gives 7.7083333 Ah = 7.71 Ah. Actual system standby/alarm duration, derating and selected battery capacity require separate 2013 verification.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-12-01; week 10; time target 2 h; category: Math/Transformers.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 45: {
  objective: "Buffer Date-change decision & delayed retests: December 2 is the five-calendar-day personal margin for the December 7 appointment. PSI's actual cutoff is 48 hours before (Saturday, December 5, 10:00 AM). Review readiness evidence, then delayed retests of recurring errors. No new six-hour exam this close to test day.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G02 Bonding and grounding: A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; GEC sizing and electrode provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-12-02; week 10; time target 1.5 h; category: Mock Exam.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 46: {
  objective: "Buffer Table navigation & light review: Light review of known mistakes and Tables 250.66, 250.102(C)(1), 250.122, 310.16, 430.248/430.250 and Chapter 9, plus NFPA 72 and NASCLA page navigation. Stop early if retrieval is clean.",
  steps: [
   "10 min: retrieve yesterday's difficult concept without notes.",
   "20 min: rotate NC law/business or NFPA 72/plan work already assigned.",
   "60 min: main task and the starter questions; use the designated books.",
   "25 min: commit answers, open the key, source-check and reconstruct misses.",
   "5 min: record actual evidence and the next delayed re-solve."
  ],
  questions: [
   {
    q: "G04 Bonding and grounding: For a feeder protected at 200 A, find the minimum copper EGC from the designated book. State whether any conductor-size increase or installation condition changes your answer. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Record the exact row and all applicable adjustment or upsizing conditions. A number without the condition is incomplete.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; Table 250.122 and applicable accompanying provisions."
   },
   {
    q: "G07 Bonding and grounding: Draw one service and one isolated transformer secondary. Label the main bonding jumper and system bonding jumper and locate each permitted connection point. Find the sizing provisions rather than reusing the EGC table. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: State which system and conductor function controls the jumper. Explain placement and parallel-path restrictions.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: Article 250; the existing session routes through 250.24, 250.28, 250.30 and 250.102."
   },
   {
    q: "W01 Wiring methods and terminations: A conductor has 90C insulation and the equipment terminals are rated 75C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Do not make a 90C insulation marking into permission for 90C terminals. Show separate adjustment and terminal checks.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 NEC terminal-temperature and Article 310 ampacity provisions."
   },
   {
    q: "M01 Motors and control wiring: A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation. Write: answer > exact source > condition/exception > elapsed time. (Permitted-book lookup)",
    a: "Book lookup required: Make three separate decisions with references and exceptions; do not average the two currents.",
    src: "Book lookup required (2020 NEC unless stated; no verified section). Starting route: 2020 Article 430; existing plan starts current-basis selection at 430.6."
   },
   {
    q: "W03 Wiring methods and terminations: A fictitious raceway has 2.00 in2 of internal area. This exercise stipulates a 40% permitted fill and 0.12 in2 per identical conductor. How many whole conductors fit under those assumptions? A. 6  B. 7  C. 8  D. 16",
    a: "A - 6. Permitted area = 2.00 x 0.40 = 0.80 in2. 0.80 / 0.12 = 6.666...; round DOWN to 6 whole conductors. Check the actual wiring method and Chapter 9 data before using this in a design.",
    src: "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion."
   }
  ],
  checks: [
   "Attempt record: date; actual minutes; question IDs/form; fresh/repeat/previously exposed; keyed correct x/y; lookup results verified x/y; assistance; slowest lookup; unresolved citations."
  ],
  notes: "Planned 2026-12-03; week 10; time target 1.5 h; category: Code Speed.  Original learning material (Oct 5, 2026). NEC 2020 / NFPA 72 (2013) / NASCLA NC Electrical 14th. Technical lookup keys require designated-book confirmation; only explicitly keyed arithmetic/current-law items are scorable under their stated conditions. Not a validated 100-question MCQ simulation; does not satisfy fresh-mock readiness or the three-perfect-AI-run requirement. Starter items do not replace the row's larger question target. Correction: concept > error cause (knowledge/navigation/setup/arithmetic/reading/time) > exact designated source > corrected method > new-case retest. Add only actual misses to the Active Recall & Error Log. Retest at 1/3/7/14-day points; Mastered after two clean delayed re-solves on separate days."
 },
 47: {
  objective: "Day 40 Stand down & pack: No study block. Spend about 30 minutes confirming the December 7, 10:00 AM appointment and route, and packing the three admitted books plus two valid, unexpired signed IDs, one government photo ID, with matching registration names. Plan to arrive by 9:30. Keep December 5-6 for rest and normal sleep.",
  steps: [
   "Use the actual PSI confirmation to confirm date/time, center, route, IDs and cancellation terms.",
   "Bring the three admitted books prepared to current rules; two valid unexpired signature-bearing IDs with matching names, including government photo ID. Aim to arrive by 9:30 for the 10:00 AM December 7 appointment."
  ],
  questions: [],
  checks: [
   "No new test or learning drill assigned. Record packing/route confirmation only.",
   "Preserve December 5-6 rest.",
   "Do not infer authorization expiration from a reported eligibility-email date."
  ],
  notes: "Planned 2026-12-04; week 10; time target 0.5 h; category: Mock Exam."
 }
}; })(typeof window !== "undefined" ? window : globalThis);
