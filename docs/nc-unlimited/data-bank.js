(function(g){g.NC=g.NC||{};
g.NC.domains=[[1, "Bonding and grounding"], [2, "Overcurrent protection"], [3, "Wiring methods and terminations"], [4, "Boxes and fittings"], [5, "Service entrance and equipment"], [6, "Motors and control wiring"], [7, "Special occupancies and hazardous locations"], [8, "Load calculations"], [9, "Appliances, equipment, and lighting"], [10, "General definitions and installation"], [11, "Law, business, and practical applications"]];
g.NC.bank=[
{
"id": "G01",
"d": 1,
"q": "A drawing labels three conductors N, PE and GE. N returns ordinary load current; PE joins equipment enclosures; GE runs to the electrode system. Name each function, then identify the separate sizing route for each.",
"lookup": 1,
"hint": "Explain grounded conductor, EGC and GEC by their jobs before selecting a table. A label alone cannot establish all installation details.",
"route": "Article 100; Article 250; the existing guide contrasts Tables 250.66 and 250.122",
"book": "2020 NEC"
},
{
"id": "G02",
"d": 1,
"q": "A service label says 200 A. Is that fact alone enough to select a GEC? List the additional data needed before finding the minimum size.",
"lookup": 1,
"hint": "Look for ungrounded conductor material/size and electrode-specific provisions. Explain why one ampere label is an incomplete set of inputs.",
"route": "Article 250; GEC sizing and electrode provisions",
"book": "2020 NEC"
},
{
"id": "G03",
"d": 1,
"q": "Sketch a service, downstream panel and a load. Trace normal neutral current in one color and an enclosure fault back to its source in another. Identify every intentional bond and any unwanted parallel path.",
"lookup": 1,
"hint": "The exercise requires a complete return path and distinct normal/fault paths. Do not replace a circuit explanation with a ground-rod symbol.",
"route": "2020 NEC service grounding/bonding; downstream equipment grounding",
"book": "2020 NEC"
},
{
"id": "G04",
"d": 1,
"q": "For a feeder protected at 200 A, find the minimum copper EGC from the designated book. State whether any conductor-size increase or installation condition changes your answer.",
"lookup": 1,
"hint": "Record the exact row and all applicable adjustment or upsizing conditions. A number without the condition is incomplete.",
"route": "Article 250; Table 250.122 and applicable accompanying provisions",
"book": "2020 NEC"
},
{
"id": "G05",
"d": 1,
"q": "Compare a grounding electrode system containing only a rod with a system that also has a qualifying concrete-encased electrode. Determine which electrode connections are required and which sizing exceptions may apply.",
"lookup": 1,
"hint": "Identify electrode type, presence and qualifying conditions before applying a conductor exception.",
"route": "Article 250 electrode system and electrode-specific GEC provisions",
"book": "2020 NEC"
},
{
"id": "G06",
"d": 1,
"q": "One generator has a switched neutral; another transfer arrangement leaves the neutral directly connected to the other source. Determine the separately derived system status of each from the actual conductor connections.",
"lookup": 1,
"hint": "Draw the neutral connection first. Equipment type alone does not decide the classification.",
"route": "Article 100 separately derived system; Article 250 source grounding/bonding",
"book": "2020 NEC"
},
{
"id": "G07",
"d": 1,
"q": "Draw one service and one isolated transformer secondary. Label the main bonding jumper and system bonding jumper and locate each permitted connection point. Find the sizing provisions rather than reusing the EGC table.",
"lookup": 1,
"hint": "State which system and conductor function controls the jumper. Explain placement and parallel-path restrictions.",
"route": "Article 250; the existing session routes through 250.24, 250.28, 250.30 and 250.102",
"book": "2020 NEC"
},
{
"id": "G08",
"d": 1,
"q": "A service uses two parallel sets of aluminum phase conductors. What conductor information and aggregation treatment must you obtain before sizing the applicable grounding or bonding conductor?",
"lookup": 1,
"hint": "Do not size from the rating of one breaker or one conductor set without checking the rule for the function and arrangement.",
"route": "Article 250 parallel-conductor grounding/bonding provisions",
"book": "2020 NEC"
},
{
"id": "G09",
"d": 1,
"q": "A metal enclosure has a rod connected to it but no intentional equipment fault-return path to the source. Find the text governing an effective ground-fault current path and explain the protection problem.",
"lookup": 1,
"hint": "Identify the path required to operate the protective device; do not equate connection to earth with a complete source return.",
"route": "Article 250 general grounding/bonding requirements",
"book": "2020 NEC"
},
{
"id": "G10",
"d": 1,
"q": "For a 4.16 kV installation, locate the higher-voltage grounding provisions and identify system grounding, equipment grounding and applicable substation/fence requirements. What engineering data would still be needed for touch/step evaluation?",
"lookup": 1,
"hint": "Separate code-scope lookup from a completed substation grounding design. State the voltage and actual arrangement.",
"route": "2020 Article 250 Part X, as routed by the existing Day 13 session",
"book": "2020 NEC"
},
{
"id": "G11",
"d": 1,
"q": "Compare an impedance-grounded 480 V system with an impedance-grounded 4.16 kV system. Build a two-column list of scope, neutral/impedance connection, monitoring, grounding electrodes and EGC requirements.",
"lookup": 1,
"hint": "Use the provision for the stated voltage. Similar terminology does not justify transferring a lower-voltage condition to a higher-voltage installation.",
"route": "2020 Article 250; existing Day 14 starts at 250.36 and 250.187",
"book": "2020 NEC"
},
{
"id": "O01",
"d": 2,
"q": "A breaker is marked 100 A and 10 kA. Explain the two different ratings and identify which one must be compared with available fault current.",
"lookup": 1,
"hint": "Differentiate normal current/protection settings from interrupting capability. Verify the installation requirement.",
"route": "Articles 100 and 110 interrupting-rating provisions",
"book": "2020 NEC"
},
{
"id": "O02",
"d": 2,
"q": "The stated available fault current is 25 kA; a proposed device is individually marked 10 kA. Which additional facts and permitted protection arrangement would have to be verified before approval?",
"lookup": 1,
"hint": "Do not infer suitability from ampere rating. Check available fault current, equipment rating and any documented permitted combination.",
"route": "Article 110 interrupting rating and equipment short-circuit suitability",
"book": "2020 NEC"
},
{
"id": "O03",
"d": 2,
"q": "For this arithmetic exercise ONLY, required current = 1.25 × continuous current + noncontinuous current. The inputs are 36 A continuous and 24 A noncontinuous. What is the calculated minimum before selecting conductors or a device?",
"opts": {
"A": "60 A",
"B": "63 A",
"C": "69 A",
"D": "75 A"
},
"ans": "C",
"why": "1.25 × 36 = 45 A. Add 24 A = 69 A. This calculation does not choose a conductor size or establish whether the stated factor applies to a particular installation.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "O04",
"d": 2,
"q": "A conductor has usable ampacity 36 A in a general branch circuit. Find the conditions under which a next-standard-size OCP device is permitted and any restriction relevant to the described circuit.",
"lookup": 1,
"hint": "The ampacity alone is insufficient; name the circuit facts and each controlling condition before choosing a standard rating.",
"route": "Article 240 conductor protection and standard ratings",
"book": "2020 NEC"
},
{
"id": "O05",
"d": 2,
"q": "An 18-foot feeder tap supplies a downstream device. Find the applicable tap rule and enumerate termination, ampacity, physical protection and length conditions before deciding whether source-end OCP can be omitted.",
"lookup": 1,
"hint": "A short length alone is not a complete tap-rule answer. Treat every specified condition as a separate checklist item.",
"route": "Article 240 feeder-tap provisions; locate the rule in 2020",
"book": "2020 NEC"
},
{
"id": "O06",
"d": 2,
"q": "Compare a circuit breaker, a plug fuse and a cartridge fuse for their permitted locations, rating information and replacement constraints. Give one condition that prevents assuming the three are interchangeable.",
"lookup": 1,
"hint": "Find the device-specific requirements and enclosure/use conditions.",
"route": "Article 240 relevant device parts",
"book": "2020 NEC"
},
{
"id": "O07",
"d": 2,
"q": "A motor branch fault-protection device is larger than the ordinary ampacity of the branch conductors. Does that alone prove an error? Explain the distinction between fault protection and overload protection using the motor provisions.",
"lookup": 1,
"hint": "Separate conductor, overload and fault-protection decisions; identify the motor-specific conditions that govern.",
"route": "Articles 240 and 430",
"book": "2020 NEC"
},
{
"id": "O08",
"d": 2,
"q": "For equipment operating above 1,000 V, find the applicable overcurrent protection provisions. Record the voltage scope and one difference from an ordinary low-voltage circuit.",
"lookup": 1,
"hint": "Use the 2020 organization rather than a later-edition table of contents.",
"route": "2020 higher-voltage portions of Articles 240 and 490; confirm final route in the book",
"book": "2020 NEC"
},
{
"id": "O09",
"d": 2,
"q": "For an adjustable protective device, identify the exact rating or setting used by the relevant conductor/grounding rule. What prevents choosing a result from the frame size without reading the rule?",
"lookup": 1,
"hint": "Different decisions may use different device quantities. Quote the exact controlling condition in your own words.",
"route": "Articles 240 and 250; exact quantity depends on the selected provision",
"book": "2020 NEC"
},
{
"id": "W01",
"d": 3,
"q": "A conductor has 90°C insulation and the equipment terminals are rated 75°C. Identify the permissible column for correction/adjustment and the separate terminal limitation on the final usable ampacity.",
"lookup": 1,
"hint": "Do not make a 90°C insulation marking into permission for 90°C terminals. Show separate adjustment and terminal checks.",
"route": "2020 NEC terminal-temperature and Article 310 ampacity provisions",
"book": "2020 NEC"
},
{
"id": "W02",
"d": 3,
"q": "A supplied arithmetic model starts at 95 A, multiplies by 0.91 ambient and 0.80 conductor-count factors, and separately limits the result to a 65 A terminal value. Under ONLY those supplied assumptions, what is the usable maximum?",
"opts": {
"A": "65 A",
"B": "69.16 A",
"C": "76 A",
"D": "95 A"
},
"ans": "A",
"why": "95 × 0.91 × 0.80 = 69.16 A. The separate supplied terminal cap is 65 A, so min(69.16, 65) = 65 A. The factors, terminal value and actual-load/code applicability still require their own source checks.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "W03",
"d": 3,
"q": "A fictitious raceway has 2.00 in² of internal area. This exercise stipulates a 40% permitted fill and 0.12 in² per identical conductor. How many whole conductors fit under those assumptions?",
"opts": {
"A": "6",
"B": "7",
"C": "8",
"D": "16"
},
"ans": "A",
"why": "Permitted area = 2.00 × 0.40 = 0.80 in². 0.80 / 0.12 = 6.666…; round DOWN to 6 whole conductors. Check the actual wiring method and Chapter 9 data before using this in a design.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "W04",
"d": 3,
"q": "A four-wire wye feeder supplies a substantial nonlinear load. Determine whether its neutral is counted for the applicable ampacity adjustment. Record the actual condition controlling your answer.",
"lookup": 1,
"hint": "Counting physical wires and counting current-carrying conductors are different tasks. Verify the load/neutral rule.",
"route": "2020 Article 310 current-carrying-conductor provisions",
"book": "2020 NEC"
},
{
"id": "W05",
"d": 3,
"q": "A raceway is outdoors and subject to wet conditions. Compare a conductor marked only THHN with one actually marked THHN/THWN-2. Find the permitted-use rules from the markings, not from appearance.",
"lookup": 1,
"hint": "Document the environment and complete marking. A familiar insulation name is not evidence of all ratings.",
"route": "Article 300 wet locations and Article 310 conductor permitted-use provisions",
"book": "2020 NEC"
},
{
"id": "W06",
"d": 3,
"q": "Compare conduit fill and a wireway fill/adjustment case. Which wiring-method article and table must be used for each, and why can one generic percentage not settle both?",
"lookup": 1,
"hint": "Identify the wiring method before applying its space and ampacity rules.",
"route": "Specific raceway/wireway article; Chapter 9 where applicable",
"book": "2020 NEC"
},
{
"id": "W07",
"d": 3,
"q": "An elevator traveling cable includes power and control circuits. Locate the specific wiring and separation requirements; record the condition that permits or prohibits the proposed arrangement.",
"lookup": 1,
"hint": "The elevator application supplements general wiring rules. Do not infer conductor separation from a generic low-voltage rule alone.",
"route": "2020 Article 620, per existing Day 28 and study guide",
"book": "2020 NEC"
},
{
"id": "W08",
"d": 3,
"q": "For a medium-voltage conductor installation, locate the 2020 article and applicable ampacity table. List voltage, conductor construction, installation geometry and temperature assumptions before choosing a value.",
"lookup": 1,
"hint": "A table value without its installation basis is incomplete.",
"route": "2020 Article 311 and referenced ampacity provisions; existing Day 26",
"book": "2020 NEC"
},
{
"id": "W09",
"d": 3,
"q": "A question supplies DC conductor resistance but describes a three-phase AC circuit at nonunity power factor. What additional impedance information may be needed, and where does the 2020 book distinguish DC properties from AC impedance?",
"lookup": 1,
"hint": "State the model limitations rather than silently applying a resistance-only voltage-drop equation.",
"route": "Chapter 9 Tables 8 and 9; existing equipment/voltage-drop sessions",
"book": "2020 NEC"
},
{
"id": "W10",
"d": 3,
"q": "A lug is proposed for aluminum conductors. List the marking, preparation and torque/instruction evidence needed before accepting the termination.",
"lookup": 1,
"hint": "Conductor material and insulation rating do not establish terminal suitability by themselves.",
"route": "Article 110 termination and listing/instruction requirements",
"book": "2020 NEC"
},
{
"id": "B01",
"d": 4,
"q": "This fictional small-box arithmetic exercise stipulates: six conductor allowances, two device allowances, one clamp allowance and two grounding allowances, all at 2.25 in³ each. What required volume follows from those stated allowances?",
"opts": {
"A": "20.25 in³",
"B": "22.50 in³",
"C": "24.75 in³",
"D": "27.00 in³"
},
"ans": "C",
"why": "Allowances total 6 + 2 + 1 + 2 = 11. Volume = 11 × 2.25 = 24.75 in³. This does not verify that the supplied grounding/device/clamp counts match a real 2020 installation.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "B02",
"d": 4,
"q": "A box contains six EGCs/bonding jumpers. Determine the exact 2020 volume allowance for the described arrangement. Compare it with the older shortcut that all grounds always count as one.",
"lookup": 1,
"hint": "Read the 2020 provision and actual conductor arrangement. Record the exact counting rule rather than carrying forward an old mnemonic.",
"route": "2020 Article 314 box-fill conductor/grounding allowance provisions",
"book": "2020 NEC"
},
{
"id": "B03",
"d": 4,
"q": "A dimensional practice problem explicitly supplies the rule: straight-pull length must be at least eight times the largest raceway trade size. The largest size in this model is 3 inches. Calculate the minimum model length.",
"opts": {
"A": "18 in",
"B": "21 in",
"C": "24 in",
"D": "30 in"
},
"ans": "C",
"why": "8 × 3 = 24 inches under the supplied model. Confirm the conductor size, pull type, raceway sizing and applicability in 2020 before treating it as a code answer.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "B04",
"d": 4,
"q": "For a fictional angle-pull model, the supplied formula is six times the largest raceway in the relevant row plus the sum of the other raceway sizes in that row. Sizes are 3, 2 and 1 inches. Calculate that model dimension only.",
"opts": {
"A": "18 in",
"B": "21 in",
"C": "24 in",
"D": "36 in"
},
"ans": "B",
"why": "6 × 3 + 2 + 1 = 21 inches. Other required dimensions, same-conductor raceway spacing and actual applicability remain separate checks.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "B05",
"d": 4,
"q": "A box has straight and angle pulls involving large conductors. Sketch the entries and decide which method governs each required dimension; explain why a small-box cubic-inch calculation is insufficient.",
"lookup": 1,
"hint": "Treat each relevant row and pull relationship separately.",
"route": "2020 Article 314 pull/junction-box dimensions; existing guide starts at 314.28",
"book": "2020 NEC"
},
{
"id": "B06",
"d": 4,
"q": "A conduit body is intended to contain splices. Find the markings and permitted fill conditions required for that use. Is merely having a removable cover enough?",
"lookup": 1,
"hint": "Check permission, marked capacity and the actual conductor/splice contents.",
"route": "2020 Article 314 conduit-body provisions",
"book": "2020 NEC"
},
{
"id": "B07",
"d": 4,
"q": "In a small device box, determine the required free conductor length and extension beyond the opening for the stated installation. Identify any exception instead of memorizing one number without its scope.",
"lookup": 1,
"hint": "Record the measurement reference point, opening condition and exact exception.",
"route": "2020 Article 300 related conductor free-length provisions; confirm exact section in the book",
"book": "2020 NEC"
},
{
"id": "S01",
"d": 5,
"q": "Place a service point, meter, service disconnect and downstream panel on a one-line. Identify the service-conductor span and feeder span from the actual supply/control arrangement.",
"lookup": 1,
"hint": "A meter location or a panel label alone may not identify the service disconnect.",
"route": "Article 100 definitions and Article 230",
"book": "2020 NEC"
},
{
"id": "S02",
"d": 5,
"q": "A balanced single-phase 120/240 V service has a calculated apparent load of 26,400 VA. Assume the provided load has already received all required treatment. What line current follows?",
"opts": {
"A": "55 A",
"B": "100 A",
"C": "110 A",
"D": "220 A"
},
"ans": "C",
"why": "I = VA / V = 26,400 / 240 = 110 A. Use line-to-line 240 V for the stated balanced total, not 120 V. Conductor and OCP selection are separate.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "S03",
"d": 5,
"q": "Compare a proposed group of six service disconnects in one common enclosure with separate permitted enclosures/compartments. Determine the actual 2020 arrangement conditions.",
"lookup": 1,
"hint": "Do not stop at the slogan six disconnects. Verify equipment layout, scope and exceptions in the exam edition.",
"route": "2020 Article 230 service-disconnect arrangement provisions",
"book": "2020 NEC"
},
{
"id": "S04",
"d": 5,
"q": "A building receives a feeder from another building rather than a utility service. Which rules apply to the building disconnect and grounding? State why service and feeder terminology changes the analysis.",
"lookup": 1,
"hint": "Trace the source and define the conductor span before applying the requirements.",
"route": "2020 Articles 225 and 250; compare Article 230 service scope",
"book": "2020 NEC"
},
{
"id": "S05",
"d": 5,
"q": "A commercial service and a dwelling service have identical ampere labels. Determine whether the dwelling conductor allowance applies to both. List the occupancy and supply conditions that control.",
"lookup": 1,
"hint": "Use the exact dwelling allowance scope; an equal ampere label is not sufficient.",
"route": "2020 NEC dwelling service/feeder conductor allowance; locate final provision in the book",
"book": "2020 NEC"
},
{
"id": "S06",
"d": 5,
"q": "Prepare a service-drop clearance lookup for a driveway. What voltage, surface/use, geometry and attachment data must be supplied before a numerical clearance can be selected?",
"lookup": 1,
"hint": "Do not answer an unseen drawing. Record the condition and measurement points governing the chosen value.",
"route": "2020 Article 230 overhead service-conductor clearances",
"book": "2020 NEC"
},
{
"id": "S07",
"d": 5,
"q": "Determine whether ground-fault protection of equipment is required for a proposed service. Build the input list: voltage-to-ground, phase/wire configuration, device rating and relevant exceptions.",
"lookup": 1,
"hint": "Do not confuse equipment ground-fault protection with personnel GFCI protection.",
"route": "2020 Article 230 applicable service GFPE provisions",
"book": "2020 NEC"
},
{
"id": "S08",
"d": 5,
"q": "A farm has two supplied structures and a proposed disconnect at each. Distinguish the rules for multiple services from rules for a feeder/branch circuit to another building.",
"lookup": 1,
"hint": "Draw the actual supply architecture before selecting a rule.",
"route": "2020 Articles 225 and 230, with grounding/bonding in Article 250",
"book": "2020 NEC"
},
{
"id": "S09",
"d": 5,
"q": "Identify the permitted neutral-to-ground bonding point in a service arrangement and the treatment of a downstream panel. Explain how a misplaced bond can create an unintended parallel normal-current path.",
"lookup": 1,
"hint": "Verify location from the actual service disconnect arrangement; distinguish downstream equipment grounding.",
"route": "2020 Articles 230 and 250",
"book": "2020 NEC"
},
{
"id": "M01",
"d": 6,
"q": "A motor nameplate current is 22 A while the relevant NEC table value is 28 A. Identify which current basis applies to the branch conductor, overload device and branch fault-protection calculation.",
"lookup": 1,
"hint": "Make three separate decisions with references and exceptions; do not average the two currents.",
"route": "2020 Article 430; existing plan starts current-basis selection at 430.6",
"book": "2020 NEC"
},
{
"id": "M02",
"d": 6,
"q": "For an arithmetic-only motor drill, the supplied conductor rule is 125% of the supplied table FLC. Table FLC is 28 A. What is the calculated ampacity before terminal/adjustment checks?",
"opts": {
"A": "22 A",
"B": "28 A",
"C": "35 A",
"D": "44 A"
},
"ans": "C",
"why": "28 × 1.25 = 35 A. The problem supplies the current basis and multiplier. A real installation still needs duty, exception, terminal and installation checks.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "M03",
"d": 6,
"q": "A hypothetical overload exercise supplies a 125% multiplier on the nameplate current of 22 A. Compute that result only, without selecting an actual overload setting.",
"opts": {
"A": "22 A",
"B": "27.5 A",
"C": "28 A",
"D": "35 A"
},
"ans": "B",
"why": "22 × 1.25 = 27.5 A. Service factor, temperature rise, exceptions and permissible setting rules have not been supplied as actual NEC determinations.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "M04",
"d": 6,
"q": "A supplied feeder-conductor model adds 125% of the largest motor FLC to 100% of the others. The three currents are 40 A, 20 A and 15 A. What model ampacity results?",
"opts": {
"A": "75 A",
"B": "80 A",
"C": "85 A",
"D": "93.75 A"
},
"ans": "C",
"why": "Largest contribution = 1.25 × 40 = 50 A. Other contributions = 20 + 15 = 35 A. Total = 85 A. This does not calculate feeder OCP.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "M05",
"d": 6,
"q": "A branch fault-protection arithmetic drill supplies a factor of 250% and table current of 42 A. Compute the product before choosing any standard size or exception.",
"opts": {
"A": "84 A",
"B": "94.5 A",
"C": "105 A",
"D": "125 A"
},
"ans": "C",
"why": "42 × 2.50 = 105 A. The permitted device type, maximum multiplier, next-size treatment and starting exception must be checked separately for an actual motor.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "M06",
"d": 6,
"q": "A motor controller can start and stop a motor. Find whether it also qualifies as the required disconnect in the stated arrangement, including rating, visibility/location and permitted exceptions.",
"lookup": 1,
"hint": "A functional start/stop control does not establish disconnect compliance by itself.",
"route": "2020 Article 430 controller/disconnect provisions",
"book": "2020 NEC"
},
{
"id": "M07",
"d": 6,
"q": "Use ONLY this balanced three-phase resistance-only approximation: VD = sqrt(3) × K × I × D / CM. K = 12.9, I = 40 A, one-way D = 180 ft, CM = 41,740 circular mils, line voltage 480 V. Find approximate volts dropped and percent drop.",
"opts": {
"A": "1.93 V; 0.40%",
"B": "3.85 V; 0.80%",
"C": "7.71 V; 1.61%",
"D": "3.85 V; 1.85%"
},
"ans": "B",
"why": "VD = 1.7320508 × 12.9 × 40 × 180 / 41,740 = 3.854165764 V. Percent = 100 × 3.854165764 / 480 = 0.802951201%. Final rounded: 3.85 V and 0.80%. D is one-way; do not double it in this supplied three-phase formula. AC reactance, actual temperature and power factor are not modeled.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "M08",
"d": 6,
"q": "A feeder supplies several motors and other loads. Identify the separate conductor-ampacity and feeder fault-protection rules, and list all current/device inputs each calculation requires.",
"lookup": 1,
"hint": "A conductor sum does not automatically establish the feeder protective-device answer.",
"route": "2020 Article 430; existing Day 22 starts at 430.24 and 430.62",
"book": "2020 NEC"
},
{
"id": "M09",
"d": 6,
"q": "Power and control conductors share a proposed motor installation route. Determine whether the control circuit classification, insulation and routing permit the arrangement.",
"lookup": 1,
"hint": "Identify circuit class and equipment context before answering from a generic separation mnemonic.",
"route": "2020 motor-control wiring and applicable control-circuit provisions",
"book": "2020 NEC"
},
{
"id": "H01",
"d": 7,
"q": "A process can release flammable gas/vapor. Identify the classification system, material group, normal/abnormal release conditions and temperature marking data needed before selecting equipment.",
"lookup": 1,
"hint": "Building name alone does not determine class/division or zone, group or temperature suitability.",
"route": "2020 Articles 500–506; applicable process article",
"book": "2020 NEC"
},
{
"id": "H02",
"d": 7,
"q": "For an aircraft hangar, map the classified boundary from the actual floor/aircraft/process facts and identify permitted wiring and equipment inside it.",
"lookup": 1,
"hint": "Give the exact 2020 condition and diagram evidence; do not reuse a gasoline-station distance.",
"route": "2020 Article 513, Unlimited-specific scope in the official outline",
"book": "2020 NEC"
},
{
"id": "H03",
"d": 7,
"q": "A fuel dispenser circuit includes ungrounded conductors and a grounded conductor. Determine the required disconnecting action and any applicable exceptions.",
"lookup": 1,
"hint": "Identify all conductors included in the specific requirement. A generic motor disconnect rule is incomplete.",
"route": "2020 Article 514",
"book": "2020 NEC"
},
{
"id": "H04",
"d": 7,
"q": "A bulk fuel storage operation includes loading/unloading and tanks. Identify which process rules control classified boundaries, wiring, seals and equipment.",
"lookup": 1,
"hint": "Article selection is part of the answer; do not omit bulk storage while studying only fuel dispensing.",
"route": "2020 Article 515 and applicable general classified-location provisions",
"book": "2020 NEC"
},
{
"id": "H05",
"d": 7,
"q": "A spray finishing area uses a flammable coating. What process, ventilation and enclosure facts determine the applicable classified-location rules?",
"lookup": 1,
"hint": "Record the operation and actual boundaries before equipment selection.",
"route": "2020 Article 516 and referenced general provisions",
"book": "2020 NEC"
},
{
"id": "H06",
"d": 7,
"q": "A health-care space has patient-care activity. Identify the space classification and applicable grounding/wiring requirements, including any treatment of an essential electrical system.",
"lookup": 1,
"hint": "Health-care occupancy and exact space function both matter.",
"route": "2020 Article 517",
"book": "2020 NEC"
},
{
"id": "H07",
"d": 7,
"q": "Compare a general assembly space and a theater with stage equipment. Identify which special occupancy rules apply to each and one installation condition that changes the analysis.",
"lookup": 1,
"hint": "Do not treat Article 518 and theater/stage provisions as interchangeable.",
"route": "2020 Articles 518 and 520",
"book": "2020 NEC"
},
{
"id": "H08",
"d": 7,
"q": "For a swimming pool, distinguish equipotential bonding from the equipment grounding path. Locate the rules for the actual pool structure and underwater luminaire type.",
"lookup": 1,
"hint": "Two related protection functions require separate decisions; a bonding-grid sketch alone is incomplete.",
"route": "2020 Article 680",
"book": "2020 NEC"
},
{
"id": "H09",
"d": 7,
"q": "Classify three generator loads: required life-safety emergency loads, legally required standby loads and optional convenience loads. Determine the controlling system article and installation consequences.",
"lookup": 1,
"hint": "A generator does not automatically make every circuit an emergency system.",
"route": "2020 Articles 700, 701 and 702; then inspect the specific classification",
"book": "2020 NEC"
},
{
"id": "L01",
"d": 8,
"q": "A single-phase load is 28,800 VA at 240 V. With no additional factors to apply, what is the current?",
"opts": {
"A": "60 A",
"B": "100 A",
"C": "120 A",
"D": "240 A"
},
"ans": "C",
"why": "I = 28,800 / 240 = 120 A. The apparent load is already given; do not introduce an unstated demand factor.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "L02",
"d": 8,
"q": "A balanced three-phase load is 138.6 kVA at 480 V line-to-line. Use I = 1,000 × kVA / (sqrt(3) × V_LL). What is line current to the nearest ampere?",
"opts": {
"A": "96 A",
"B": "167 A",
"C": "289 A",
"D": "500 A"
},
"ans": "B",
"why": "138,600 / (1.7320508 × 480) = 166.7179 A, rounded to 167 A. Do not use line-to-neutral voltage in this stated formula.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "L03",
"d": 8,
"q": "A load consumes 72 kW at power factor 0.80. Assuming the stated model S = P / PF, what apparent power is required?",
"opts": {
"A": "57.6 kVA",
"B": "72 kVA",
"C": "90 kVA",
"D": "100 kVA"
},
"ans": "C",
"why": "72 / 0.80 = 90 kVA. Multiplying real power by PF goes in the wrong direction for this question.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "L04",
"d": 8,
"q": "This teaching problem supplies an assumed lighting factor of 3 VA/ft² for an area of 2,500 ft². What connected lighting VA follows from those two supplied inputs, before demand treatment?",
"opts": {
"A": "750 VA",
"B": "3,000 VA",
"C": "7,500 VA",
"D": "9,000 VA"
},
"ans": "C",
"why": "2,500 × 3 = 7,500 VA. This problem supplies the factor; it does not independently validate the occupancy-specific NEC factor.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "L05",
"d": 8,
"q": "A fictitious demand model retains the first 3,000 VA at 100% and the remaining 7,200 VA at 35%. What calculated demand follows?",
"opts": {
"A": "3,570 VA",
"B": "5,520 VA",
"C": "7,200 VA",
"D": "10,200 VA"
},
"ans": "B",
"why": "3,000 + (7,200 × 0.35) = 3,000 + 2,520 = 5,520 VA. Apply the two bands once. The model is supplied; confirm scope before using a real code demand rule.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "L06",
"d": 8,
"q": "A supplied sizing model uses 125% of 8,000 VA continuous load plus 100% of 12,000 VA noncontinuous load. What total VA follows?",
"opts": {
"A": "20,000 VA",
"B": "21,000 VA",
"C": "22,000 VA",
"D": "25,000 VA"
},
"ans": "C",
"why": "1.25 × 8,000 + 12,000 = 10,000 + 12,000 = 22,000 VA. It is a supplied model, not permission to apply 125% to every load.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "L07",
"d": 8,
"q": "Heating is 9 kVA and cooling is 13 kVA. Determine whether the actual controls and code method permit treating them as noncoincident. If permitted, show the contribution; if not, state what changes.",
"lookup": 1,
"hint": "A statement that loads usually do not run together is weaker than the required conditions. Verify the rule and actual arrangement.",
"route": "2020 Article 220 noncoincident-load treatment and applicable equipment provisions",
"book": "2020 NEC"
},
{
"id": "L08",
"d": 8,
"q": "Build a dwelling service worksheet with lighting, small-appliance/laundry, range, dryer, fixed appliances, HVAC and motor inputs. State which permitted calculation method you use and each required exception check.",
"lookup": 1,
"hint": "Do not mix a standard-method demand factor with an optional-method subtotal without authority.",
"route": "2020 Article 220; exact method and factor citations must be recorded",
"book": "2020 NEC"
},
{
"id": "L09",
"d": 8,
"q": "A commercial feeder serves lighting, receptacles and motors. Explain which lighting value, receptacle demand treatment and motor contribution apply to its stated occupancy and load details.",
"lookup": 1,
"hint": "Keep occupancy-specific values and separate motor treatment visible.",
"route": "2020 Article 220 with relevant motor and feeder provisions",
"book": "2020 NEC"
},
{
"id": "L10",
"d": 8,
"q": "Compare a 2020 and later-edition occupancy lighting table/organization. Identify the actual 2020 value and section used for a proposed office question. Why is a later-edition explanation insufficient as an exam key?",
"lookup": 1,
"hint": "The designated edition controls the lookup; do not invent a factor or section from memory.",
"route": "2020 Article 220 lighting provisions; existing guide flags later reorganization",
"book": "2020 NEC"
},
{
"id": "L11",
"d": 8,
"q": "Apply the rounding instruction explicitly supplied by this drill: fractions of an ampere at or above 0.5 round up; smaller fractions may be dropped. What are 123.5 A and 123.4 A?",
"opts": {
"A": "123 A and 123 A",
"B": "124 A and 124 A",
"C": "124 A and 123 A",
"D": "125 A and 124 A"
},
"ans": "C",
"why": "123.5 rounds up to 124; 123.4 drops to 123 under the given instruction. This mirrors the public handbook rounding guidance; do not substitute rounding for a separate NEC minimum/standard-size condition.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "E01",
"d": 9,
"q": "A balanced 75 kVA three-phase transformer has 480 V primary and 208 V secondary, both line-to-line. Use I = 75,000/(sqrt(3) × V_LL). What are approximate primary and secondary line currents?",
"opts": {
"A": "90.2 A and 208.2 A",
"B": "156.3 A and 360.6 A",
"C": "208.2 A and 90.2 A",
"D": "75 A and 75 A"
},
"ans": "A",
"why": "Primary = 75,000/(1.7320508 × 480) = 90.211 A. Secondary = 75,000/(1.7320508 × 208) = 208.179 A. These are current calculations only; OCP, conductors and bonding need separate rules.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "E02",
"d": 9,
"q": "A 500 kVA three-phase transformer has a 480 V secondary (line-to-line) and 5.75% impedance. Under the supplied stiff-source, secondary-terminal bolted-fault model, use I_FL = 500,000/(sqrt(3) × 480 V line-to-line), then I_SC = I_FL/0.0575. Choose the approximate result.",
"opts": {
"A": "1.046 kA",
"B": "6.014 kA",
"C": "10.459 kA",
"D": "104.59 kA"
},
"ans": "C",
"why": "I_FL = 601.4065 A. Convert 5.75% to 0.0575. I_SC = 601.4065/0.0575 = 10,459.24 A. Upstream/conductor impedance and motor contributions are outside this simplified model.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "calc"
},
{
"id": "E03",
"d": 9,
"q": "An HVAC nameplate states MCA 28 A and MOCP 45 A. Determine the separate conductor and protective-device decisions. What facts prevent sizing the conductor only from the 45 A number?",
"lookup": 1,
"hint": "Read the equipment markings and Article 440 conditions separately; no conductor size is asserted here.",
"route": "2020 Article 440 and applicable ampacity/termination rules",
"book": "2020 NEC"
},
{
"id": "E04",
"d": 9,
"q": "A transformer primary has suitable overcurrent protection. Does this alone prove that secondary conductors are protected? Identify the additional transformer and secondary-conductor questions.",
"lookup": 1,
"hint": "Transformer OCP and secondary-conductor protection are separate checks; do not assume one answer settles both.",
"route": "2020 Articles 450 and 240; applicable secondary conductor arrangement",
"book": "2020 NEC"
},
{
"id": "E05",
"d": 9,
"q": "A luminaire is proposed for a damp/wet location and a particular ceiling insulation condition. What listing, location and installation instructions must be checked?",
"lookup": 1,
"hint": "The complete luminaire and its actual markings matter; lamp wattage alone does not prove suitability.",
"route": "2020 Articles 110 and 410",
"book": "2020 NEC"
},
{
"id": "E06",
"d": 9,
"q": "For fixed electric space-heating equipment, find the applicable branch-circuit sizing and control/disconnect requirements. State whether the load treatment differs from a generic appliance.",
"lookup": 1,
"hint": "Identify the exact equipment type and applicable continuous-load treatment instead of using a general multiplier by habit.",
"route": "2020 Article 424 and relevant branch-circuit provisions",
"book": "2020 NEC"
},
{
"id": "E07",
"d": 9,
"q": "An elevator machine room contains lighting, receptacles and elevator equipment. Map the applicable circuits, disconnects and installation-space requirements for the stated equipment.",
"lookup": 1,
"hint": "Do not let one elevator feeder answer replace separate machine-room circuit and installation checks.",
"route": "2020 Article 620, plus applicable Articles 110 and 410",
"book": "2020 NEC"
},
{
"id": "D01",
"d": 10,
"q": "Classify three code statements as mandatory instruction, permitted option or explanatory note. For each, identify the operative text and the conditions before turning it into a rule.",
"lookup": 1,
"hint": "Shall, permission and informational notes have different roles. Check the actual code organization.",
"route": "2020 Article 90 and relevant text; Article 100 definitions where applicable",
"book": "2020 NEC"
},
{
"id": "D02",
"d": 10,
"q": "Equipment is reachable only after using a portable ladder. Find the actual accessible/readily accessible definitions and determine the result for the specific equipment requirement.",
"lookup": 1,
"hint": "Find the exact required term and any applicable exception; ordinary-language accessible is not a substitute.",
"route": "2020 Article 100 and equipment-specific requirement",
"book": "2020 NEC"
},
{
"id": "D03",
"d": 10,
"q": "A listed assembly has manufacturer installation instructions specifying terminals and working arrangement. Which instruction and installation rules govern, and what exact evidence must be preserved?",
"lookup": 1,
"hint": "Read the listing/instruction relationship and the actual equipment requirement rather than treating a generic recommendation as mandatory.",
"route": "2020 Article 110 and the equipment instructions",
"book": "2020 NEC"
},
{
"id": "P01",
"d": 11,
"q": "Harrison already holds a Limited license. He passes the Unlimited examination. What must still occur before his business is authorized to contract at the Unlimited level?",
"opts": {
"A": "Nothing; a passing score is the license",
"B": "Board license application/issuance (upgrade to Unlimited) and applicable licensing requirements",
"C": "Only purchasing a ground rod",
"D": "Only completing an online mock"
},
"ans": "B",
"why": "Passing alone does not authorize Unlimited contracting. Holding a Limited license does not by itself authorize Unlimited-level work; the business must be issued the Unlimited classification. The current handbook instructs passing candidates to complete the license application; current G.S. 87-43.2 specifies issuance requirements.",
"ref": "G.S. 87-43.2, current Legislature text; verified October 5, 2026; G.S. 87-43.2(a); corroborated by July 2026 handbook checklist.",
"kind": "law"
},
{
"id": "P02",
"d": 11,
"q": "One project includes $52,000 of contractor-supplied electrical value components and $18,000 of known owner-supplied electrical equipment, with no duplicate amount. Does calling the contractor contract $52,000 settle the project-value calculation?",
"opts": {
"A": "Yes; owner purchases are excluded",
"B": "No; total stated project value is $70,000",
"C": "Yes; split invoices always create separate projects",
"D": "Only voltage matters"
},
"ans": "B",
"why": "52,000 + 18,000 = 70,000. Rule .0303 includes relevant known or reasonably estimated electrical value regardless of who furnishes the materials/equipment. Do not confuse contract-label amount with project value.",
"ref": "21 NCAC 18B, current consolidated Board rules; verified October 5, 2026; .0303(4).",
"kind": "law"
},
{
"id": "P03",
"d": 11,
"q": "Under the Board renewal rule, when are the license renewal application and fee due relative to expiration?",
"opts": {
"A": "30 days before expiration",
"B": "Five days after expiration",
"C": "Only when a new job begins",
"D": "Every two years"
},
"ans": "A",
"why": "The trigger is license expiration. Distinguish this from the five-day listed-QI employment notice and annual exam scheduling rules.",
"ref": "21 NCAC 18B, current consolidated Board rules; verified October 5, 2026; .0405(a).",
"kind": "law"
},
{
"id": "P04",
"d": 11,
"q": "A firm adds or loses employment of a listed qualified individual. Under G.S. 87-43.2(a)(3), what reporting deadline is specified?",
"opts": {
"A": "Five days",
"B": "Ten days",
"C": "30 days",
"D": "One year"
},
"ans": "A",
"why": "The statute ties the five-day report to additions or loss of employment of listed QIs. State actor, trigger and deadline together.",
"ref": "G.S. 87-43.2, current Legislature text; verified October 5, 2026; G.S. 87-43.2(a)(3).",
"kind": "law"
},
{
"id": "P05",
"d": 11,
"q": "Assume the documented categories are accepted: 8,000 primary hours and 1,200 helper hours credited as secondary at 80%. Do these alone reach the current Unlimited 9,000 total-hour threshold?",
"opts": {
"A": "Yes; raw hours total 9,200",
"B": "Yes; every helper hour is primary",
"C": "No; credited total is 8,960, short by 40 hours",
"D": "No; the requirement is nine years"
},
"ans": "C",
"why": "Secondary credit = 1,200 × 0.80 = 960. Total = 8,000 + 960 = 8,960. Primary threshold is met; total threshold is not. The Board must accept the underlying activities and documentation.",
"ref": "21 NCAC 18B, current consolidated Board rules; verified October 5, 2026; .0201(b)(3) and .0202(b).",
"kind": "law"
},
{
"id": "P06",
"d": 11,
"q": "A defined total cost basis is $9,150. Compare a 20% markup price with a 20% margin price, rounded to cents.",
"opts": {
"A": "Both $10,980",
"B": "Markup $10,980; margin $11,437.50",
"C": "Markup $11,437.50; margin $10,980",
"D": "Both $11,437.50"
},
"ans": "B",
"why": "Markup: 9,150 × 1.20 = 10,980. Margin: 9,150/(1 − 0.20) = 11,437.50. Markup uses cost as denominator; margin uses selling price.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "law"
},
{
"id": "P07",
"d": 11,
"q": "Current assets are $120,000, current liabilities $80,000 and cash $9,000. Find working capital and current ratio. Do these alone prove a $25,000 payroll can immediately be paid in cash?",
"opts": {
"A": "$40,000; 1.5:1; no",
"B": "$40,000; 1.5:1; yes",
"C": "$200,000; 0.67:1; no",
"D": "$9,000; 1.5:1; yes"
},
"ans": "A",
"why": "Working capital = 120,000 − 80,000 = 40,000. Ratio = 120,000/80,000 = 1.5. Cash is only 9,000; collection/credit timing is missing. Working capital is not cash.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "law"
},
{
"id": "P08",
"d": 11,
"q": "In this network A takes two days; after A, B takes four and C takes five in parallel; D takes three and waits for both. Ignore resource constraints. Which path controls and how long is the project?",
"opts": {
"A": "A–B–D; 9 days",
"B": "A–C–D; 10 days",
"C": "A–B–C–D; 14 days",
"D": "Both paths; 12 days"
},
"ans": "B",
"why": "A–B–D = 2 + 4 + 3 = 9 days. A–C–D = 2 + 5 + 3 = 10 days. Longest dependent path controls under the stated model; B has one day of float.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "law"
},
{
"id": "P09",
"d": 11,
"q": "Original plan mini-case: circuit L1 serves eight Type A fixtures, each with two 32 W lamps, and three Type B fixtures, each with one 18 W lamp. Only lamp watts are requested. What connected lamp wattage is shown?",
"opts": {
"A": "310 W",
"B": "512 W",
"C": "566 W",
"D": "704 W"
},
"ans": "C",
"why": "A: 8 × 2 × 32 = 512 W. B: 3 × 1 × 18 = 54 W. Total = 566 W. Ballast/driver input, fans and code design load are not supplied. This is an original mini-case, not the official sample circuit.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "law"
},
{
"id": "P10",
"d": 11,
"q": "Original plan mini-case: there are nine two-lamp fixtures and five one-lamp fixtures on the traced circuit. Find fixture count and lamp count.",
"opts": {
"A": "14 fixtures; 14 lamps",
"B": "14 fixtures; 23 lamps",
"C": "23 fixtures; 14 lamps",
"D": "18 fixtures; 23 lamps"
},
"ans": "B",
"why": "Fixtures = 9 + 5 = 14. Lamps = 9 × 2 + 5 = 23. Do not substitute one quantity for the other in a wattage or takeoff question.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "law"
},
{
"id": "P11",
"d": 11,
"q": "Classify a smoke-detector alarm, a monitored valve off-normal condition and a wiring fault using the exact 2013 definitions. Identify which initiating, notification or interface device performs each role.",
"lookup": 1,
"hint": "Confirm the exact terms and system context; device role and signal classification are separate questions.",
"route": "2013 NFPA 72 definitions and fundamentals; existing worksheet starts at Chapters 3 and 10",
"book": "2013 NFPA 72"
},
{
"id": "P12",
"d": 11,
"q": "A fire-alarm battery arithmetic drill supplies these STUDY assumptions, without claiming prescribed 2013 durations: standby 0.25 A for 24 h, alarm 2.0 A for five minutes, then multiply the sum by 1.25. What capacity follows to two decimals?",
"opts": {
"A": "6.17 Ah",
"B": "7.71 Ah",
"C": "8.00 Ah",
"D": "12.50 Ah"
},
"ans": "B",
"why": "Standby = 0.25 × 24 = 6 Ah. Alarm = 2 × (5/60) = 0.1666667 Ah. Sum = 6.1666667; supplied multiplier gives 7.7083333 Ah = 7.71 Ah. Actual system standby/alarm duration, derating and selected battery capacity require separate 2013 verification.",
"ref": "Original arithmetic under the explicit problem assumptions; no NEC/NFPA compliance conclusion.",
"kind": "law"
},
{
"id": "P13",
"d": 11,
"q": "For one exact fire-alarm device and system type, find inspection, testing and maintenance tasks/frequencies in the 2013 book. Record the exact table row and any exception.",
"lookup": 1,
"hint": "Do not collapse inspection and testing into one generic annual answer.",
"route": "2013 NFPA 72 Chapter 14; exact row must be verified",
"book": "2013 NFPA 72"
},
{
"id": "P14",
"d": 11,
"q": "A smoke detector is proposed for door-release service. Determine the application-specific placement requirements for the actual door and ceiling arrangement, separate from ordinary area coverage.",
"lookup": 1,
"hint": "State the door/ceiling/system configuration; do not transfer a general spacing number to door-release service.",
"route": "2013 NFPA 72 initiating-device and interface provisions; exact section must be found",
"book": "2013 NFPA 72"
},
{
"id": "P15",
"d": 11,
"q": "An owner asks for additional work before a change price is agreed. In NASCLA 14th, locate contract-change documentation and notice topics, then write the facts/authorization/cost/schedule records needed for this case.",
"lookup": 1,
"hint": "Identify actual contract authority, notice and documentation; a verbal request does not settle every entitlement question.",
"route": "NASCLA NC Electrical 14th, contract/project-management topics. Record page; no page is invented",
"book": "NASCLA NC Electrical 14th"
}
];
})(typeof window!=='undefined'?window:globalThis);
