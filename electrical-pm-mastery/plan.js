// Electrical PM Mastery: curriculum data and pure calculators.
// Loaded by index.html in the browser and by check.mjs / to-notion.mjs in Node.
(function (root) {
  'use strict';

  const PHASES = [
    { id: 1, name: 'Re-Entry', weeks: [1, 4], color: 'brown', aim: 'Recalibrate after two years away: your jobs, your money, the code, the market, and your daily habits.' },
    { id: 2, name: 'Core Control', weeks: [5, 17], color: 'orange', aim: 'Control the money, the paper, and the field: contracts, changes, estimating, cost, schedule, procurement, safety, closeout.' },
    { id: 3, name: 'Systems', weeks: [18, 30], color: 'yellow', aim: 'Know the electrical systems as well as your best general foreman, from the utility service to the fire alarm panel.' },
    { id: 4, name: 'Operator', weeks: [31, 43], color: 'blue', aim: 'Run it like an owner: claims, negotiation, leadership, preconstruction, finance, risk, and developing people.' },
    { id: 5, name: 'Mastery', weeks: [44, 52], color: 'green', aim: 'Calibrate against closed jobs, encode everything in playbooks, and teach it so it sticks.' },
  ];

  // Order matters: Monday through Sunday.
  const KINDS = [
    { id: 'learn', label: 'Learn', minutes: 45, hint: 'Study the concept with a free resource.' },
    { id: 'field', label: 'Field Rep', minutes: 30, hint: 'Apply it on a live job during your workday.' },
    { id: 'drill', label: 'Drill', minutes: 30, hint: 'Deliberate practice with a right answer.' },
    { id: 'mentor', label: 'Mentor', minutes: 20, hint: 'Mine a veteran for pattern knowledge.' },
    { id: 'numbers', label: 'Numbers', short: 'Nums', minutes: 45, hint: 'Tie it to cost, schedule, or cash.' },
    { id: 'deep', label: 'Deep Work', minutes: 120, hint: 'Build a lasting deliverable for your playbook.' },
    { id: 'review', label: 'Review', minutes: 20, hint: 'Retrieve, reflect, plan. Then rest.' },
  ];

  const RESOURCES = {
    company_files: { name: "Your company's closed job files", url: '', cost: 'Free', cat: 'Business', why: 'Estimates, cost reports, CO logs and daily reports from finished jobs. The answer key a 20-year veteran learned from the hard way. Ask accounting and estimating.' },
    nfpa: { name: 'NFPA Free Access (NEC, 70E, 72, 99, 110)', url: 'https://www.nfpa.org/for-professionals/codes-and-standards/list-of-codes-and-standards/free-access', cost: 'Free', cat: 'Code', why: 'Read-only current editions with a free account. No printing or copying.' },
    mikeholt: { name: 'Mike Holt Enterprises (free videos, articles, forum)', url: 'https://www.mikeholt.com', cost: 'Free', cat: 'Code', why: 'Code-change seminars and practical NEC explanations.' },
    mikeholt_yt: { name: 'Mike Holt on YouTube', url: 'https://www.youtube.com/results?search_query=Mike+Holt+NEC+code+changes', cost: 'Free', cat: 'Code', why: 'Edition-by-edition code change walkthroughs.' },
    electricianu: { name: 'Electrician U on YouTube', url: 'https://www.youtube.com/results?search_query=Electrician+U', cost: 'Free', cat: 'Code', why: 'Field-level explanations of code and installation practice.' },
    iaei: { name: 'IAEI Magazine', url: 'https://iaeimagazine.org', cost: 'Free', cat: 'Code', why: "Inspectors' view of the code and common violations." },
    ugly: { name: "Ugly's Electrical References", url: 'https://www.uglys.net', cost: '~$25', cat: 'Code', why: 'Pocket formulas and tables for field math.' },
    spd: { name: 'Eaton Bussmann Selecting Protective Devices handbook', url: 'https://www.eaton.com/content/dam/eaton/products/electrical-circuit-protection/fuses/technical-literature/bus-ele-br-3002-spd-2017.pdf', cost: 'Free', cat: 'Systems', why: 'Fault current, SCCR, selective coordination, and arc flash in one free PDF. Based on the 2017 NEC, so check section numbers against your adopted edition.' },
    siemens_step: { name: 'Siemens quickSTEP courses', url: 'https://www.siemens.com/en-us/products/low-voltage/quickstep/', cost: 'Free', cat: 'Systems', why: 'Self-paced basics of switchboards, panelboards, switchgear, and motor control.' },
    netaworld: { name: 'NETA (testing standards, NETA World articles)', url: 'https://www.netaworld.org', cost: 'Free articles', cat: 'Systems', why: 'Acceptance testing practice for gear, breakers, cable, and transformers.' },
    doe_codes: { name: 'DOE Building Energy Codes Program', url: 'https://www.energycodes.gov', cost: 'Free', cat: 'Systems', why: 'Energy code lighting and controls requirements with free training.' },
    osha_k: { name: 'OSHA 29 CFR 1926 Subpart K (Electrical)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926SubpartK', cost: 'Free', cat: 'Safety', why: 'The construction electrical safety rules you are accountable for.' },
    osha30: { name: 'OSHA Outreach 30-hour Construction', url: 'https://www.osha.gov/training/outreach', cost: '$', cat: 'Safety', why: 'Use an OSHA-authorized provider. Often employer-paid.' },
    procore: { name: 'Procore Learning and Certifications', url: 'https://learn.procore.com', cost: 'Free', cat: 'PM Tools', why: 'Free role-based PM courses and certificates, useful even if you use another platform.' },
    mit_pm: { name: 'MIT OpenCourseWare 1.040 Project Management', url: 'https://ocw.mit.edu/courses/1-040-project-management-spring-2009/', cost: 'Free', cat: 'PM Tools', why: 'University-level scheduling, cost, and risk fundamentals.' },
    projectlibre: { name: 'ProjectLibre', url: 'https://www.projectlibre.com', cost: 'Free', cat: 'PM Tools', why: 'Open-source CPM scheduling to practice logic and float.' },
    bluebeam: { name: 'Bluebeam Revu', url: 'https://www.bluebeam.com', cost: 'Company license', cat: 'PM Tools', why: 'Takeoff, markups, and document control. Use your company seat or a trial.' },
    powerbi: { name: 'Microsoft Learn: Power BI', url: 'https://learn.microsoft.com/en-us/training/powerplatform/power-bi', cost: 'Free', cat: 'PM Tools', why: 'Build job dashboards from your cost and labor data.' },
    excel: { name: 'Microsoft Excel training', url: 'https://support.microsoft.com/en-us/excel', cost: 'Free', cat: 'PM Tools', why: 'PivotTables and lookups for cost reports and logs.' },
    lci: { name: 'Lean Construction Institute', url: 'https://leanconstruction.org', cost: 'Free / member', cat: 'PM Tools', why: 'Last Planner System and pull planning.' },
    aia: { name: 'AIA Contract Documents (A201, A401 samples)', url: 'https://www.aiacontracts.com', cost: 'Free samples', cat: 'Contracts', why: 'Industry-standard general conditions and subcontract forms.' },
    consensus: { name: 'ConsensusDocs (750 subcontract)', url: 'https://www.consensusdocs.org', cost: 'Free samples', cat: 'Contracts', why: 'A subcontractor-friendlier standard to compare against.' },
    asbca: { name: 'Armed Services Board of Contract Appeals decisions', url: 'https://www.asbca.mil', cost: 'Free', cat: 'Contracts', why: 'Real disputes, real reasoning. Subcontractor claims appear as pass-through claims sponsored by the prime; search for electrical cases.' },
    neca_mlu: { name: 'NECA Manual of Labor Units', url: 'https://www.necanet.org', cost: 'Company copy', cat: 'Estimating', why: 'The industry labor-unit baseline. Your estimating department almost certainly owns it.' },
    ecmag: { name: 'Electrical Contractor magazine (NECA)', url: 'https://www.ecmag.com', cost: 'Free', cat: 'Business', why: 'Market, management, and technology articles for electrical contractors.' },
    ecmweb: { name: 'EC&M', url: 'https://www.ecmweb.com', cost: 'Free', cat: 'Business', why: 'Code, design, and market coverage.' },
    fmi: { name: 'FMI Insights', url: 'https://fminet.com/insights/', cost: 'Free', cat: 'Business', why: 'Construction business strategy, project selection, and talent research.' },
    pon: { name: 'Harvard Program on Negotiation free reports', url: 'https://www.pon.harvard.edu/free-reports/', cost: 'Free', cat: 'Leadership', why: 'BATNA, anchoring, and interest-based negotiation.' },
    library: { name: 'Public library + Libby app', url: 'https://www.overdrive.com/apps/libby', cost: 'Free', cat: 'Leadership', why: 'Borrow leadership and negotiation books free (Extreme Ownership, Never Split the Difference, Crucial Conversations, The Checklist Manifesto).' },
  };

  // Each week: theme, goal, six day tasks (Mon-Sat in KINDS order), two check questions, resources.
  const WEEKS = [
    // ---------- Phase 1: Re-Entry ----------
    { theme: 'Know Your Jobs Cold', goal: 'Build a one-page brief for every active project so nothing surprises you.',
      days: [
        'Read the subcontract (and the prime contract it flows down from) for your largest job, front to back. Highlight scope inclusions and exclusions, notice deadlines in days, payment terms, retainage, liquidated damages, and the change order process.',
        'Walk your largest job with the foreman for at least 30 minutes. Ask: "What is slowing you down?" and "What in the next three weeks worries you?" Write down every answer.',
        'Make a contract cheat card for each job: notice deadline, pay terms, retainage %, allowed CO markup, warranty start. One index card per job.',
        'Ask your most senior PM or ops manager: "What did the last PM on my jobs miss most often?" and "Which of my jobs would you worry about, and why?"',
        'Pull the latest cost report for each job. Record contract value, approved COs, pending COs, budget hours, hours to date, and reported % complete. Collect only; analysis comes next week.',
        'Write a one-page Job Brief per project: scope, money, key dates, top five risks with owners, key people (GC PM, super, engineer, inspector), open issues. This is your control panel.',
      ],
      quiz: [
        ['Your subcontract requires written notice of a claim within 7 days. The GC super verbally approved extra work. Are you protected?', 'No. Verbal approval rarely satisfies a written notice clause. Send written notice inside the window that names the event, who directed it, and states that cost and time impacts will follow. Missed notice is the most common way subs lose valid changes.'],
        ['What five things belong on every one-page Job Brief?', 'Scope (with exclusions), money (contract, COs, forecast margin), time (milestones, permanent power date), people (GC, owner, engineer, inspector contacts), and top risks with an owner and next action.'],
      ],
      res: ['company_files', 'aia', 'consensus'] },

    { theme: 'Money Baseline', goal: 'Read a cost report the way a CFO does and know every job\'s true margin.',
      days: [
        'Learn your company\'s job cost report: cost codes, budget vs actual, committed costs, projected final. Ask accounting for a 30-minute walkthrough of one report.',
        'Pick one cost code on one job (for example, branch rough-in on Level 2). Walk it and verify the % complete claimed on the cost report. Compare reality with the report.',
        'Use the Labor Productivity calculator on five cost codes: earned hours, productivity factor (PF), projected hours at completion.',
        'Ask the controller or CFO: "Which numbers do you look at first in a PM\'s monthly review, and what makes you lose confidence in a forecast?"',
        'Build a WIP snapshot for your jobs: contract, estimated total cost, cost to date, % complete (cost-to-cost), earned revenue, billed to date, over/under billing.',
        'Produce a Margin Truth sheet per job: bid margin vs current forecast margin, the three cost codes driving any fade, and one recovery action for each.',
      ],
      quiz: [
        ['Budget 1,000 hrs, 40% complete, 520 hrs spent. What are the PF and projected hours?', 'Earned = 400 hrs. PF = 400 / 520 = 0.77. Projected at completion = 1,000 / 0.77, about 1,300 hrs: a 300-hour fade if nothing changes.'],
        ['Why is underbilling more dangerous than it looks?', 'You earned revenue you have not billed, so your company is financing the job. It often hides cost overruns or unapproved changes, and sureties and banks treat persistent underbilling as a red flag.'],
      ],
      res: ['company_files', 'excel', 'fmi'] },

    { theme: 'Code Refresh: What Changed While You Were Out', goal: 'Close the two-year code gap and know which edition each AHJ enforces.',
      days: [
        'Open the NEC in NFPA\'s free reader. Confirm which edition (2020, 2023, or 2026) each of your project jurisdictions enforces. Skim the 2026 reorganization: load calculations moved from Article 220 to new Article 120.',
        'Ask your foreman and the inspector on one job: "What are inspectors writing up most this year?" Log every item.',
        'Find and bookmark ten sections you use weekly: 110.14(C), 110.16, 110.24, 110.26, 210.8, 240.4, 250.122, 300.4, 310.16, Chapter 9 Table 1.',
        'Ask an inspector or your QA lead: "Which code changes since 2020 caused the most rework on commercial jobs?"',
        'Estimate the cost impact of one code change on a current job (for example, 210.8(B) GFCI protection for receptacles in a commercial kitchen or on a rooftop).',
        'Watch two free code-change seminars for the edition your AHJ adopted. Write your top ten changes that affect commercial work into your playbook.',
      ],
      quiz: [
        ['Where are branch-circuit, feeder, and service load calculations in the 2026 NEC?', 'Article 120, relocated from Article 220. Most methods carried over, but some unit loads changed (for example, the dwelling lighting load for feeders and services), so verify against the 2026 text.'],
        ['What does 110.24 require at service equipment in other than dwelling units?', 'Legible field marking of the available fault current and the date the calculation was performed, updated when modifications change the available fault current.'],
      ],
      res: ['nfpa', 'mikeholt_yt', 'iaei'] },

    { theme: 'Market, Tools and Your Operating System', goal: 'Re-learn the market you buy in and install the habits that run the rest of the year.',
      days: [
        'Read five recent articles on electrical market conditions: switchgear and transformer lead times, copper pricing, labor availability, data center demand.',
        'Ask your gear and lighting supplier reps for current lead times on switchboards, panelboards, transformers, and generators. Log them with today\'s date.',
        'Complete one free Procore course (or your platform\'s equivalent) and find three features you were not using two years ago.',
        'Ask your purchasing manager or a supplier rep: "What changed most in the last two years in how we buy gear, wire, and fixtures?"',
        'Build a long-lead tracker for each job: item, spec section, submittal date, approval date, release date, quoted lead time, need-on-site date, float.',
        'Install your operating system: daily 45-minute learning block, Sunday review slot, one playbook document with a section per competency, and a field notebook. Take the Skills self-assessment in this app as your baseline.',
      ],
      quiz: [
        ['Gear lead time is 40 weeks, engineer review takes 3, release takes 1. How far before need-on-site must you submit?', 'At least 44 weeks plus freight transit (quoted lead time usually runs from release to ship), plus a resubmittal buffer of 2 to 4 weeks. Use the Submit-By calculator and put the date in the procurement log.'],
        ['Why track need-on-site date instead of only delivery date?', 'Need-on-site comes from the schedule. The gap between it and expected delivery is your float. Tracking delivery alone hides that you are late until recovery is impossible.'],
      ],
      res: ['ecmag', 'ecmweb', 'procore'] },

    // ---------- Phase 2: Core Control ----------
    { theme: 'Contracts I: Read Like a Lawyer, Think Like a Sub', goal: 'Spot the dozen clauses that decide whether a job makes money.',
      days: [
        'Compare a free AIA A401 or ConsensusDocs 750 sample with your company subcontract. Focus on scope, flow-down, pay-when-paid vs pay-if-paid, retainage, notice, changes, delay damages, no-damages-for-delay, indemnity, termination for convenience, disputes, warranty.',
        'On one job, list everywhere the work is being performed differently from the contract documents (sequence, access, design changes) and whether each was noticed in writing.',
        'Rate your current subcontract\'s twelve key clauses Green, Yellow, or Red for risk. Write one sentence on why for every Red.',
        'Ask your contracts manager or company attorney: "Which three clauses do you strike or negotiate every time, and which do you accept?"',
        'Calculate retainage held on each job and when it should release. Add it to your cash forecast.',
        'Write your Contract Risk Card template: a one-page summary you will complete for every new contract within 48 hours of receiving it.',
      ],
      quiz: [
        ['Pay-when-paid vs pay-if-paid?', 'Pay-when-paid is usually read as timing: the GC must still pay within a reasonable time. Pay-if-paid makes owner payment a condition precedent and shifts nonpayment risk to you. Enforceability varies by state.'],
        ['What is a flow-down clause, and why read the prime contract?', 'It binds you to the GC\'s obligations to the owner for your scope. Notice periods, liquidated damages, warranty, and insurance often live in the prime contract, so you can be bound by terms you never read.'],
      ],
      res: ['aia', 'consensus', 'company_files'] },

    { theme: 'Contracts II: The Change Management System', goal: 'No unpaid extra work: every change is noticed, priced, tracked, and collected.',
      days: [
        'Map your company\'s change process end to end: identify, notify, price, submit, track, approve, bill. Reread the changes clause and list every deadline.',
        'Start daily T&M discipline: any directed extra work gets a ticket signed by the GC\'s representative the same day, with crew names, hours, and material.',
        'Price two changes with the Change Order calculator: a small one (12 hrs, $800 material) and a larger one (160 hrs, $18,000 material, $4,000 equipment).',
        'Ask your best foreman: "What extra work do we routinely do for free?" Those are your leaks.',
        'Build a change order log per job: number, description, date noticed, date submitted, amount, status, days outstanding. Total your pending exposure.',
        'Write a one-page Change Management Standard: notice template, T&M ticket rules, pricing format, weekly follow-up, and an escalation trigger (for example, pending over 30 days).',
      ],
      quiz: [
        ['What four things must every notice of change include?', 'The event (what and when), the cause or direction (who, with document references), the impact on cost and schedule (even if "to be determined"), and a reservation of rights. Send it inside the contract\'s window.'],
        ['Why price impact and not just direct cost?', 'Changes disrupt planned work: remobilization, out-of-sequence work, trade stacking, extra supervision. Pricing only direct labor and material leaves that cost unrecovered. Reserve the right to claim impacts you cannot price yet.'],
      ],
      res: ['company_files', 'consensus'] },

    { theme: 'Estimating I: Takeoff and Labor Units', goal: 'Look at a drawing and know roughly what it costs to install.',
      days: [
        'Learn how your estimating department builds a bid: takeoff, labor units (NECA MLU or company database), labor factors (height, congestion, access, weather), pricing, quotes. Ask for a recent estimate to study.',
        'Time a real task: watch a crew install a known quantity (100 ft of 3/4" EMT at 10 ft, or 20 devices). Compute actual hours per unit and compare with the estimate.',
        'Take off one small area (a typical office floor\'s lighting and branch power) using Bluebeam or PDF measuring tools.',
        'Ask the chief estimator: "Where do our estimates miss most often? Which labor units do you adjust, and why?"',
        'Compare estimated vs actual hours for five cost codes on a closed job. Note which codes consistently overrun or underrun.',
        'Start your Labor Unit Book (a spreadsheet): item, unit, estimate unit, observed field unit, conditions. Add ten entries from this week.',
      ],
      quiz: [
        ['Name five labor factors that change installed cost for the same quantity.', 'Working height and lift use, congestion and trade coordination, access and material handling (floors, hoist), weather and temperature, crew experience and overtime, occupied-building or phasing restrictions.'],
        ['Why compare with closed jobs instead of only the labor manual?', 'The manual is a national baseline. Your closed jobs reflect your crews, region, and job types. They are the free answer key that turns opinion into calibrated judgment.'],
      ],
      res: ['neca_mlu', 'bluebeam', 'company_files'] },

    { theme: 'Estimating II: Feeders, Gear, Quotes and Buyout', goal: 'Master the big-ticket items where estimates win or lose.',
      days: [
        'Study feeder takeoff (conduit and wire by size and length, pull points, terminations) and the quote process for gear and lighting: scope letters, exclusions, escalation clauses, release dates.',
        'Walk the electrical rooms on one job. Compare installed or planned layout to drawings: working clearances (110.26), housekeeping pads, feeder routing.',
        'Level two gear or lighting quotes side by side. List every exclusion (freight, startup, spares, controls programming, tax) and normalize to an apples-to-apples total.',
        'Ask a senior estimator or purchasing manager: "How do you protect us from gear and copper escalation between bid and buyout?"',
        'Build a buyout log for one job: item, estimate amount, committed amount, savings or overrun. Total the buyout variance.',
        'Estimate one feeder schedule from a real project: conduit, conductor, terminations, labor. Compare your number with the original bid.',
      ],
      quiz: [
        ['Name four quote exclusions that commonly blow budgets.', 'Freight to site, startup and field service, controls programming and commissioning support, sales tax, spare parts, and escalation clauses tied to metals pricing.'],
        ['Why does 110.26 matter during buyout?', 'It sets working space around equipment. A substituted manufacturer with different dimensions can violate clearances in a tight room and force redesign, delay, and rework.'],
      ],
      res: ['neca_mlu', 'spd', 'siemens_step'] },

    { theme: 'Cost Control I: Earned Value for Labor', goal: 'Detect labor fade within two weeks of it starting, not at closeout.',
      days: [
        'Learn earned value for labor: budget hours by cost code, % complete from installed quantities (not hours spent), earned hours, PF = earned / actual.',
        'With the foreman, set up weekly quantity tracking for three cost codes (feet of conduit, devices, fixtures installed).',
        'Run the Labor Productivity calculator on five scenarios, including one where % complete is overstated by 10 points. Watch how it hides fade.',
        'Ask your best general foreman: "How do you know a crew is falling behind before the numbers show it?"',
        'Calculate PF for every active cost code on one job. Flag anything below 0.95.',
        'Build a weekly labor tracking sheet: cost code, budget hrs, installed / total qty, earned hrs, actual hrs, PF, projected hrs, gain or fade. Run it every Friday from now on.',
      ],
      quiz: [
        ['Why is "hours spent / budget hours" a bad measure of % complete?', 'It assumes you are on budget. Burn 60% of the hours and it reports 60% complete even if 45% is installed. Measure installed quantities or physical milestones.'],
        ['PF of 0.85 on a 4,000-hour cost code. What is the forecast?', 'Projected hours = 4,000 / 0.85, about 4,706 hours: roughly a 706-hour fade unless productivity improves.'],
      ],
      res: ['company_files', 'excel'] },

    { theme: 'Cost Control II: Forecasting, WIP and Cash', goal: 'Produce a forecast leadership trusts and keep every job cash positive.',
      days: [
        'Learn cost-to-complete forecasting by cost type (labor, material, equipment, subs, other), the WIP schedule, over/under billing, retainage, and the schedule of values for pay applications (G702/G703 style).',
        'Before this month\'s pay app, verify installed quantities and stored materials in the field so billing matches reality.',
        'Run the WIP calculator on three scenarios: overbilled, underbilled, and fade hidden by overbilling.',
        'Ask the controller: "What does a healthy cash-flow curve look like on our jobs, and when do jobs usually go cash negative?"',
        'Prepare a full monthly forecast for one job: cost to date plus cost to complete by cost type equals estimated final cost. Compare projected margin with bid margin.',
        'Write a monthly Project Financial Review template: forecast, margin bridge from bid to current, pending COs, cash position, retainage, top three risks and opportunities.',
      ],
      quiz: [
        ['Contract $2.0M, estimated total cost $1.7M, cost to date $850K, billed $1.1M. Over or under billed?', '% complete = 850 / 1,700 = 50%. Earned revenue = $1.0M. Billed $1.1M, so overbilled by $100K. Cash ahead, but it is a liability, not profit.'],
        ['What is a margin bridge?', 'A walk from bid margin to current forecast margin showing each driver: labor fade or gain, buyout, approved COs, pending COs, contingency used. It explains the forecast in one picture.'],
      ],
      res: ['company_files', 'excel', 'fmi'] },

    { theme: 'Scheduling I: CPM and the Electrical Sequence', goal: 'Read the GC\'s schedule critically and protect your critical path.',
      days: [
        'Study CPM basics: activities, logic, critical path, total float, free float, constraints. Practice in ProjectLibre or your company tool; MIT OCW 1.040 has free lectures.',
        'Map the electrical sequence on one job: underground, in-wall rough, overhead rough, gear set, feeders, permanent power, trim, testing, punch. Mark every dependency on other trades.',
        'Find the electrical activities on or near the critical path in the GC\'s current schedule. List the predecessors you do not control.',
        'Ask a GC superintendent: "What does electrical do that helps or hurts your schedule most?"',
        'Work backward from permanent power: utility service, gear delivery, feeders, inspection. Calculate the float on each.',
        'Build a three-week look-ahead for your scope tied to the GC schedule, with manpower per activity and constraints (material, information, access, inspections).',
      ],
      quiz: [
        ['Total float vs free float?', 'Total float: how long an activity can slip without delaying completion. Free float: how long it can slip without delaying the next activity. Unless the contract assigns float, it is usually shared and first-come, so other trades often use it before you need it.'],
        ['Why is permanent power the key electrical milestone?', 'It drives HVAC startup, testing, commissioning, elevator and fire alarm acceptance, and occupancy, and it depends on utility coordination and long-lead gear, the riskiest items you have.'],
      ],
      res: ['mit_pm', 'projectlibre'] },

    { theme: 'Scheduling II: Manpower, Pull Planning and Overtime', goal: 'Staff to the curve and avoid the productivity traps of stacking and overtime.',
      days: [
        'Study the manpower loading curve (ramp, peak, taper), crew sizing, the Last Planner System (pull planning, weekly work plans, Percent Plan Complete), and how overtime and stacking affect productivity.',
        'Attend or run a pull-planning session or weekly coordination meeting. Track PPC for your crews: tasks completed as promised / tasks planned.',
        'Run the Crew Size calculator with 40-hour and 50-hour weeks and two productivity assumptions. Note what changes.',
        'Ask your field superintendent: "When did we put too many people on a job, and what happened to productivity?"',
        'Plot planned vs actual manpower by week for one job. Note peaks and valleys that do not match the work.',
        'Write a manpower plan through completion for one job: crew by week, foreman assignments, apprentice ratio, overtime strategy, and triggers for adding or removing people.',
      ],
      quiz: [
        ['What is PPC and why track it?', 'Percent Plan Complete = commitments completed / commitments made in a week. It measures planning reliability, and tracking the reasons for misses exposes root causes.'],
        ['Why can adding workers fail to recover schedule?', 'Past optimal density, crews interfere with each other, wait on material and information, and supervision thins. Sustained overtime adds fatigue. Hours rise faster than output.'],
      ],
      res: ['lci', 'company_files'] },

    { theme: 'Procurement and Submittals', goal: 'Never let a submittal or long-lead item set your schedule.',
      days: [
        'Study the submittal process: Division 26, 27, and 28 spec sections, submittal schedule, product data vs shop drawings, review cycles, resubmittals, substitutions, release for fabrication.',
        'Audit material staging on one job: what is on site, what is needed in two weeks, what is damaged or missing. Discuss kitting and just-in-time delivery with the foreman.',
        'Read one Division 26 section (for example, 26 24 16 Panelboards) and list every submittal, testing, and warranty requirement.',
        'Ask your project engineer or APM: "Where does our submittal process get stuck?"',
        'Update the submittal log: number, section, submitted, returned, status, days in review. Flag anything beyond the contract review period.',
        'Create a procurement plan for one job: each package with quote, buyout, submittal, release, lead time, need date, and float. Highlight the five with the least float.',
      ],
      quiz: [
        ['Which CSI divisions cover electrical, communications, and electronic safety and security?', 'Division 26 Electrical, Division 27 Communications, Division 28 Electronic Safety and Security (fire alarm usually lives in 28).'],
        ['The engineer holds a submittal past the contract review period. What do you do?', 'Notify in writing, document the effect on release and delivery dates, and reserve rights for cost and schedule impacts.'],
      ],
      res: ['company_files', 'procore'] },

    { theme: 'RFIs, Coordination and VDC', goal: 'Resolve design gaps before they reach the field.',
      days: [
        'Study RFI practice (one question per RFI, references, a proposed solution, an impact flag) and VDC coordination: clash detection, coordination sign-off, model-based layout.',
        'Walk an area before rough-in with the drawings and find three conflicts with duct, sprinkler mains, or structure. Write them up as potential RFIs.',
        'Rewrite three old RFIs from your jobs: clear question, references, proposed solution, needed-by date, impact.',
        'Ask your VDC or BIM coordinator: "What do PMs do that makes coordination harder?"',
        'Build an RFI log: number, subject, sent, answered, days open, cost impact (Y/N), related CO. What is the average days open?',
        'Run a mini coordination review for one area: overlay electrical with mechanical and plumbing and list conflicts with proposed resolutions.',
      ],
      quiz: [
        ['What makes a good RFI?', 'One clear question, drawing and spec references, a proposed solution, a needed-by date, and a cost or schedule impact flag. It is also a notice document, so write it like one.'],
        ['Why link RFIs to change orders?', 'Clarifications often add scope. Linking them makes sure every answer that adds work is noticed and priced instead of absorbed.'],
      ],
      res: ['procore', 'company_files'] },

    { theme: 'Field Production: The Foreman Partnership', goal: 'Raise crew productivity by removing obstacles only the PM can remove.',
      days: [
        'Study what drives electrical productivity: material availability, information, tools and equipment, access, crew mix, rework. Read about lean\'s eight wastes in construction.',
        'Watch one crew for two hours without judging. Tally minutes installing vs waiting, walking, searching for material, or reworking.',
        'Rank the top three time-wasters you observed and propose a fix you control for each (deliveries, kitting, prefab, information).',
        'Ask your foreman: "If you could change one thing about how the office supports you, what would it be?" Then do it.',
        'Estimate the hours lost per week to the wastes you observed and convert them to dollars at the burdened rate.',
        'Create a Foreman Support Checklist: what the PM delivers weekly (look-ahead, material, drawings, answers, manpower) and a 30-minute weekly PM/foreman meeting agenda.',
      ],
      quiz: [
        ['Which categories of non-productive time should you watch on a crew?', 'Waiting (material, information, inspections, other trades), travel and walking, searching, rework, and excess handling. Many of them are PM-controlled.'],
        ['Why is the foreman the profit center?', 'Labor is the largest controllable risk in electrical work, and the foreman makes the hour-by-hour decisions that drive it. The PM\'s job is to make the foreman successful.'],
      ],
      res: ['lci', 'company_files'] },

    { theme: 'Safety Leadership', goal: 'Lead safety as part of production, not paperwork.',
      days: [
        'Read OSHA 1926 Subpart K and the core of NFPA 70E: electrically safe work condition, justification for energized work, energized work permits, shock and arc-flash risk assessments, PPE, LOTO.',
        'Join a toolbox talk on one job, then lead the next one yourself on lockout/tagout or temporary power.',
        'Write three scenarios where energized work is justified and three where it is not. Check them against NFPA 70E.',
        'Ask your safety director: "What are our top three incident types, what do they cost, and how do they affect our EMR?"',
        'Learn your company\'s EMR and how it affects bid eligibility and insurance cost. Estimate the true cost of one recordable injury on a job.',
        'Write a job-specific safety addendum: energization plan, LOTO for the gear, temporary power, GFCI or assured grounding program, and who can authorize energized work.',
      ],
      quiz: [
        ['When is energized work allowed under NFPA 70E?', 'When de-energizing creates additional hazards or increased risk, is infeasible because of equipment design or operational limitations, or the circuit is under 50 V with no increased arc or burn exposure. Schedule and convenience never qualify. A permit is required inside the restricted approach boundary or where arc-flash likelihood is increased; testing, troubleshooting, and voltage measuring by qualified persons are exempt from the permit.'],
        ['What does establishing an electrically safe work condition involve?', 'Identify all sources; interrupt load current and open the disconnects; visually verify the opening where possible; release stored electrical energy and block stored mechanical energy; apply LOTO; test each conductor for absence of voltage with a tester verified before and after; ground where induced voltage or stored energy is possible.'],
      ],
      res: ['osha_k', 'nfpa', 'osha30'] },

    { theme: 'Quality, Testing and Closeout', goal: 'Pass inspections the first time and bring the retainage home.',
      days: [
        'Study inspection prep, insulation resistance (megger) testing, torque verification, NETA ATS acceptance testing, punch lists, O&M manuals, as-builts, training, warranty, retention release.',
        'Do a pre-inspection walk with the foreman: labeling, box fill, supports, bonding, GFCI, working clearances. Fix it before the inspector sees it.',
        'Draft one job\'s closeout checklist from Division 01 and 26 05 00: every document, test report, and training requirement.',
        'Ask a senior PM: "Which closeout item held up retention the longest, and how do you avoid it now?"',
        'List the retainage on each job and the specific closeout items that gate its release. Estimate when the cash returns.',
        'Build a Closeout Tracker (item, responsible party, due date, status) and start it at 75% complete on every job, not at the end.',
      ],
      quiz: [
        ['What is NETA ATS?', 'The InterNational Electrical Testing Association\'s Acceptance Testing Specifications: the standard for field testing new power equipment such as gear, breakers, transformers, and cable before energization.'],
        ['Why start closeout at 75% complete?', 'O&M manuals, attic stock, test reports, as-builts, and training take weeks. Starting late delays final payment and retention, which can be your whole margin.'],
      ],
      res: ['netaworld', 'nfpa', 'company_files'] },

    // ---------- Phase 3: Systems ----------
    { theme: 'Services and Utility Coordination', goal: 'Get permanent power on time by mastering the utility process.',
      days: [
        'Read NEC Article 230 highlights and your utility\'s commercial service requirements handbook (free on its website): application, load letter, transformer pad, metering, CT cabinets.',
        'Identify the utility coordinator for one job. Confirm application status, utility design status, and any fees.',
        'From a one-line diagram, identify service voltage, main size, metering, service-entrance conductors, and the grounding electrode system.',
        'Ask a PM who has energized several large services: "Which utility delays surprised you, and what would you start earlier?"',
        'Build a utility timeline backward from permanent power: application, design, fees, pad and conduit, inspection release, transformer set, energize.',
        'Write a Utility Coordination Checklist for your region with contacts and typical durations.',
      ],
      quiz: [
        ['Which documents typically start a commercial utility service?', 'Service application, load calculation or load letter, site plan with transformer and meter locations, one-line diagram, and usually a request for available fault current.'],
        ['Why ask the utility for available fault current early?', 'It sets equipment short-circuit ratings and the 110.24 marking. A late or higher number can force gear changes.'],
      ],
      res: ['nfpa', 'mikeholt'] },

    { theme: 'Overcurrent Protection and Fault Current', goal: 'Understand interrupting ratings, SCCR, and series ratings well enough to catch submittal errors.',
      days: [
        'Study NEC 110.9 (interrupting rating), 110.10 (short-circuit current ratings), Article 240 basics, and equipment SCCR. The free Bussmann SPD handbook covers all of it.',
        'Check installed panel and equipment ratings (AIC, SCCR) against the available fault current at that point.',
        'Work three example problems from the SPD handbook on available fault current and equipment ratings.',
        'Ask your gear supplier\'s application engineer: "Which fault current mistakes do you see in contractor submittals?"',
        'Price the difference between a fully rated and a series-rated panelboard solution on a current job.',
        'Write a one-page Fault Current Field Guide: definitions, where to find ratings, submittal red flags, who to call.',
      ],
      quiz: [
        ['Interrupting rating vs SCCR?', 'Interrupting rating is the most current a device can safely interrupt. SCCR is the most fault current an assembly can withstand with its specified protection. Both must meet or exceed the available fault current where installed.'],
        ['What is a series rating?', 'A tested, listed combination in which an upstream device protects a downstream device with a lower interrupting rating. It must be a listed combination and the equipment must be marked accordingly.'],
      ],
      res: ['spd', 'nfpa'] },

    { theme: 'Grounding and Bonding', goal: 'Explain Article 250 to a foreman and catch errors in the field.',
      days: [
        'Study Article 250 essentials: system grounding, grounding electrode system, GEC sizing (250.66), main and system bonding jumpers, EGC sizing (250.122), separately derived systems (250.30), bonding of piping and steel.',
        'Inspect the service and one transformer for correct grounding and bonding. Note where the neutral-to-ground bond is made.',
        'Size EGCs from Table 250.122 for five circuits, including one where the phase conductors were upsized for voltage drop.',
        'Ask an inspector or senior electrician: "Which grounding mistakes do you still find on commercial jobs?"',
        'Find one place where grounding and bonding details drive cost (ground ring, steel bonding) and confirm it was estimated.',
        'Draw a grounding and bonding diagram for a service and one separately derived transformer, labeling each conductor with its code section.',
      ],
      quiz: [
        ['Where is the neutral-to-ground bond for a separately derived system such as a dry-type transformer?', 'At a single point between the source and the first system disconnecting means or overcurrent device (250.30(A)(1)), usually at the transformer or the first disconnect. Never in downstream panels. Bonding at both ends is allowed only under the narrow exception that creates no parallel neutral path.'],
        ['If you upsize ungrounded conductors for voltage drop, what happens to the EGC?', 'A wire-type EGC must be increased in proportion to the circular mil increase of the ungrounded conductors (250.122(B)), unless a qualified person sizes it under that section\'s exception.'],
      ],
      res: ['nfpa', 'mikeholt', 'electricianu'] },

    { theme: 'Feeders, Conductors and Voltage Drop', goal: 'Size, route, and price feeders correctly.',
      days: [
        'Study 310.16 ampacity, 110.14(C) termination temperature limits, adjustment and correction factors, parallel conductor rules, Chapter 9 conduit fill, and voltage drop guidance.',
        'Walk a feeder route: pull points, total bends between pull points, supports, firestopping.',
        'Run the Voltage Drop calculator for five feeders from a real job. Which ones need upsizing?',
        'Ask a general foreman: "What makes a big feeder pull go well or badly?"',
        'Price upsizing one long feeder for voltage drop vs relocating a transformer closer to the load.',
        'Build a feeder review checklist: size, ampacity at the terminal rating, adjustment factors, EGC, conduit fill, voltage drop, pull lengths, terminations.',
      ],
      quiz: [
        ['Why do termination ratings (110.14(C)) limit ampacity?', 'Equipment terminals are usually rated 60°C or 75°C. Even with 90°C insulation, usable ampacity is limited to the terminal temperature column unless every termination is rated higher.'],
        ['What is the maximum total bend between pull points in EMT or RMC?', '360 degrees (for example 358.26 and 344.26).'],
      ],
      res: ['nfpa', 'mikeholt', 'ugly'] },

    { theme: 'Transformers and Distribution Equipment', goal: 'Read a one-line diagram fluently and do the math in your head.',
      days: [
        'Study transformer basics (kVA, primary and secondary, delta-wye), Article 450 protection, 240.21(C) secondary conductors, panelboards (Article 408), switchboards, and I = kVA x 1000 / (1.732 x V).',
        'Trace power on one job from the service to a lighting panel: main, distribution, transformer, panel. Verify labels along the way.',
        'Use the Power calculator for five transformers (for example 75 kVA at 208V and 1,500 kVA at 480V).',
        'Ask an electrical engineer: "What do you wish contractors understood about one-line diagrams?"',
        'Check the gear and transformer budget on one job against current quotes.',
        'Redraw a real one-line diagram by hand, labeling every device, size, and conductor. Quiz yourself on it next week.',
      ],
      quiz: [
        ['Full-load amps of a 75 kVA transformer at 208V three-phase?', '75,000 / (1.732 x 208), about 208 A.'],
        ['Full-load amps of 1,500 kVA at 480V three-phase?', '1,500,000 / (1.732 x 480), about 1,804 A.'],
      ],
      res: ['siemens_step', 'nfpa', 'spd'] },

    { theme: 'Motors, HVAC and Mechanical Coordination', goal: 'Close the who-furnishes-what gaps between Divisions 23 and 26.',
      days: [
        'Study Article 430 basics (table FLC for sizing), Article 440 (MCA and MOCP), VFDs, starters, disconnects, and the responsibility matrix in the specs.',
        'Compare mechanical equipment schedules with electrical drawings: voltage, MCA, MOCP, disconnects. List every mismatch.',
        'For five pieces of HVAC equipment, check circuit sizing against MCA and MOCP from the nameplate or submittal.',
        'Ask the mechanical contractor\'s PM: "Where do electrical and mechanical scopes usually fight?"',
        'Price one equipment change (for example an RTU changed from 208V to 480V), including feeder, breaker, and disconnect.',
        'Build a Division 23/26 responsibility matrix: who furnishes, installs, wires power, wires controls, and starts up each equipment type.',
      ],
      quiz: [
        ['Which nameplate values size the circuit for A/C equipment?', 'Minimum Circuit Ampacity (MCA) for the conductors and Maximum Overcurrent Protection (MOCP) for the breaker or fuse (Article 440).'],
        ['Why use NEC table FLC instead of motor nameplate current for conductors?', '430.6(A) requires the table values for conductor and short-circuit/ground-fault protection sizing (with exceptions). Nameplate current is used for overload protection.'],
      ],
      res: ['nfpa', 'company_files'] },

    { theme: 'Emergency and Standby Power', goal: 'Deliver life-safety power that passes acceptance testing the first time.',
      days: [
        'Study Articles 700, 701, and 702, generators, transfer switches, separation of emergency wiring, selective coordination, and NFPA 110 testing basics.',
        'Review a generator and ATS installation or submittal: transfer times, load shed, remote annunciator, fuel, testing.',
        'Map the branches on one job\'s one-line: normal, emergency, legally required standby, optional standby. Confirm separation.',
        'Ask a commissioning agent or generator vendor: "What fails most often during load bank and transfer testing?"',
        'List every generator testing and startup cost (load bank, fuel, vendor startup, witness testing) and confirm each is in budget.',
        'Write an Emergency System Acceptance Checklist: documents, tests, witnesses, sequence.',
      ],
      quiz: [
        ['What is selective coordination and where is it required?', 'Localizing an overcurrent condition so only the nearest upstream device opens, across the full range of fault currents. Required for multiple-elevator feeders (620.62), critical operations data systems (645.27), emergency (700.32), legally required standby (701.32), and COPS (708.54). Healthcare essential electrical systems need coordination only for faults lasting longer than 0.1 second (517.31(G)).'],
        ['How quickly must emergency power be available under Article 700?', 'Within 10 seconds (700.12).'],
      ],
      res: ['nfpa', 'spd'] },

    { theme: 'Short-Circuit, Coordination and Arc-Flash Studies', goal: 'Understand the studies well enough to schedule, verify, and use them.',
      days: [
        'Learn what the studies are (short-circuit, protective device coordination, arc flash per NFPA 70E and IEEE 1584), who performs them, and the data they need.',
        'Collect as-installed data for a study: actual feeder lengths, conductor sizes, submitted equipment. Compare with design assumptions.',
        'Read a sample arc-flash label and explain each field: voltage, arc-flash boundary, incident energy or PPE category, working distance, approach boundaries.',
        'Ask a study engineer or testing firm: "Which contractor data problems delay studies most?"',
        'Put the study, breaker settings, and labeling into your schedule and budget with durations.',
        'Build a Studies and Labeling Plan: data collection, study due, settings applied, labels installed, all before energization.',
      ],
      quiz: [
        ['Why does the study need as-built data?', 'Fault current and incident energy depend on actual conductor lengths and sizes, transformer impedance, and device settings. Design assumptions can understate the hazard.'],
        ['What does 110.16 require?', 'Field or factory marking on equipment likely to be examined or maintained while energized (switchboards, panelboards, MCCs and similar) to warn of arc-flash hazards. 110.16(B) adds a permanent label with specific information: in the 2023 NEC for service and feeder-supplied equipment rated 1000 A or more (the 2020 edition covered service equipment 1200 A or more).'],
      ],
      res: ['nfpa', 'spd', 'netaworld'] },

    { theme: 'Lighting and Lighting Controls', goal: 'Deliver lighting controls that work at turnover and pass energy code.',
      days: [
        'Study energy code lighting control requirements (ASHRAE 90.1 and IECC: occupancy sensing, daylight response, automatic shutoff), networked controls, and controls commissioning.',
        'Check one controls installation against the sequence of operations. Note which devices need programming or calibration.',
        'Compare a fixture package: specified vs proposed lumens, CCT, driver and dimming type, controls compatibility, lead time.',
        'Ask the controls vendor: "What makes controls startup run late or fail functional testing?"',
        'Identify the controls startup and programming costs and who carries them (you, the vendor, or the owner).',
        'Write a Lighting Controls Turnover Checklist: programming, functional testing, owner training, as-built zone maps.',
      ],
      quiz: [
        ['Name three common energy-code lighting controls.', 'Occupancy or vacancy sensors, daylight-responsive controls, and automatic time-switch shutoff. Some codes add plug-load controls and high-end trim.'],
        ['Why release fixture packages in phases with the vendor?', 'Lead times are long and variable. Releasing by area and type keeps installation fed and avoids site storage problems.'],
      ],
      res: ['doe_codes', 'ecmag'] },

    { theme: 'Fire Alarm and Low Voltage', goal: 'Coordinate fire alarm and low-voltage scopes and pass acceptance testing.',
      days: [
        'Study NEC Article 760, NFPA 72 basics (initiating devices, notification appliances, interfaces), and how Divisions 27 and 28 are organized. Note that the 2023 NEC split old Article 725 into new articles.',
        'Walk the fire alarm interfaces on one job: elevator recall, HVAC shutdown, sprinkler flow and tamper, door holders. Confirm who wires each.',
        'Read the fire alarm sequence of operations matrix and test yourself on five events.',
        'Ask the fire alarm sub or inspector: "What fails most often during acceptance testing?"',
        'Confirm the fire alarm and low-voltage scope split in your estimate and look for gaps (pathways, back boxes, power).',
        'Build a Fire Alarm Acceptance Readiness checklist: pretest, documentation, interfaces, AHJ witness scheduling.',
      ],
      quiz: [
        ['What is a sequence of operations matrix?', 'A table mapping each fire alarm input (smoke, flow, pull station) to its outputs (alarm, elevator recall, fan shutdown, door release). It is the acceptance test script.'],
        ['Why do fire alarm interfaces fail late?', 'They depend on other trades (elevators, HVAC, sprinklers, doors) being complete and programmed, so gaps appear only in full system testing near occupancy.'],
      ],
      res: ['nfpa', 'ecmweb'] },

    { theme: 'Healthcare and Mission-Critical Work', goal: 'Understand the premium sectors where reliability rules everything.',
      days: [
        'Study NEC Article 517 (essential electrical system: life safety, critical, and equipment branches) with NFPA 99 context, plus data center basics: N+1 and 2N redundancy, UPS, busway, PDUs, commissioning levels.',
        'Walk a healthcare or mission-critical job with the superintendent (or study a public case study) and note special requirements: ICRA, shutdown procedures, redundant pathways.',
        'Draw the essential electrical system branches for a hospital from memory, then check against Article 517.',
        'Ask a PM who has built hospitals or data centers: "What is different about planning and owner expectations?"',
        'Estimate the extra cost of a planned shutdown in an occupied building: after-hours premium, temporary power, standby crew.',
        'Write a shutdown Method of Procedure (MOP) template: scope, roles, step-by-step sequence, verification, rollback, communication, sign-offs.',
      ],
      quiz: [
        ['What is a MOP in mission-critical work?', 'Method of Procedure: an approved, step-by-step script for work on live or critical systems with roles, sequence, verification points, and rollback steps.'],
        ['What does 2N redundancy mean?', 'Two complete, independent systems, each able to carry the full load, so either can fail without interrupting service.'],
      ],
      res: ['nfpa', 'ecmag'] },

    { theme: 'Solar, Storage and EV Charging', goal: 'Become fluent in the fastest-growing commercial scopes.',
      days: [
        'Study NEC Articles 690 (PV), 705 (interconnected sources), 706 (energy storage), and 625 (EV charging), plus load management and utility interconnection.',
        'Visit or review an EV charging or PV installation. Note equipment, interconnection point, and utility requirements.',
        'Calculate the service impact of ten 48 A Level 2 chargers sized as continuous loads, with and without load management.',
        'Ask a solar or EV installer: "Which utility or AHJ issues add the most time?"',
        'Price a small EV charging change order with the Change Order calculator: trenching, panel capacity, permits.',
        'Write a one-page market brief: which renewable and EV scopes your company should pursue and what skills or partners it needs.',
      ],
      quiz: [
        ['One 48 A Level 2 charger: what size branch circuit, and what changes with ten of them?', 'EV charging is a continuous load, so 48 A x 1.25 = a 60 A circuit (625.41). Ten chargers on a 208Y/120 V three-phase service, split 4/3/3 across phase pairs, put roughly 290 A on the worst phase (about 365 A at 125%). An automatic load management system can cap the calculated load (625.42).'],
        ['What limits a load-side PV connection on an existing panel?', 'Busbar and overcurrent device ratings under 705.12 (for example the 120% rule). Exceeding them forces a supply-side connection or a panel upgrade.'],
      ],
      res: ['nfpa', 'ecmweb'] },

    { theme: 'Medium Voltage and Commissioning', goal: 'Manage medium-voltage work and commissioning without surprises.',
      days: [
        'Study medium-voltage basics (over 1000 V): cable types, terminations and splices by qualified persons, VLF and insulation resistance testing, and commissioning levels L1 through L5.',
        'Review the commissioning plan on one job and list every electrical test, witness, and dependency.',
        'Build a commissioning test matrix for the electrical gear: test, standard, performer, witness, prerequisite.',
        'Ask a commissioning agent: "How can the electrical contractor make commissioning faster?"',
        'Confirm testing, commissioning, and witness time are budgeted, including standby crew time.',
        'Write a Commissioning Readiness Plan: L1 to L5 milestones and the electrical prerequisites for each.',
      ],
      quiz: [
        ['What are commissioning levels L1 to L5?', 'L1 factory witness testing, L2 delivery and site inspection, L3 installation verification and pre-functional checks, L4 functional performance testing, L5 integrated systems testing. This is common data center usage; definitions vary, so follow the project commissioning plan.'],
        ['Who may terminate or splice medium-voltage cable?', 'Qualified persons trained for that kit and voltage class, often with manufacturer certification, as the specs and safety program require.'],
      ],
      res: ['netaworld', 'nfpa'] },

    // ---------- Phase 4: Operator ----------
    { theme: 'Claims I: Documentation Discipline', goal: 'Keep every job file claim-ready, every day.',
      days: [
        'Study what makes a claim recoverable: notice, entitlement, causation, quantum. Read two board of contract appeals decisions involving electrical subcontractors.',
        'Audit one job\'s records: daily reports, dated and located photos, T&M tickets, meeting minutes, schedule updates, correspondence.',
        'Rewrite one daily report to claim-ready quality: manpower by area, work performed, delays and causes, directives received, weather, visitors.',
        'Ask a construction attorney or senior executive: "What documentation won or lost our last dispute?"',
        'Total the unpriced delays and disruptions on your jobs. What is the exposure?',
        'Write a Daily Report standard and a photo protocol (what, when, how to label) for your foremen.',
      ],
      quiz: [
        ['Name the four elements of a recoverable claim.', 'Timely notice, entitlement (a contractual basis), causation (the event caused the impact), and quantum (proven cost and time).'],
        ['What is the most valuable claim evidence?', 'Contemporaneous records: daily reports, dated photos, emails, and minutes created at the time, not reconstructed later.'],
      ],
      res: ['asbca', 'company_files'] },

    { theme: 'Claims II: Quantifying Lost Productivity', goal: 'Prove productivity losses with methods that hold up.',
      days: [
        'Study the measured mile method and the basics of schedule delay analysis (as-planned vs as-built, windows, time impact analysis).',
        'Identify an impacted area or period on a job and a comparable unimpacted one. Collect hours and installed quantities for both.',
        'Run the Measured Mile calculator with your data or the sample scenario.',
        'Ask an executive or claims consultant: "Which loss-of-productivity methods are most credible to owners and courts?"',
        'Turn one lost-productivity calculation into a priced request for equitable adjustment (REA) summary.',
        'Write a full REA outline: narrative, notice history, entitlement, schedule analysis, quantum, exhibits.',
      ],
      quiz: [
        ['What is the measured mile?', 'A comparison of productivity on unimpacted work with impacted work of the same kind. Lost hours = impacted actual hours - (impacted quantity / unimpacted rate).'],
        ['Why are total cost claims weak?', 'They assume the bid was perfect and every overrun was the other party\'s fault. Tribunals accept them only when no better method exists and strict conditions are met.'],
      ],
      res: ['asbca', 'company_files'] },

    { theme: 'Negotiation and Communication', goal: 'Win more change orders and keep the relationship.',
      days: [
        'Read free Harvard PON material on BATNA, interests vs positions, and anchoring. Borrow one negotiation book from the library.',
        'Prepare for and run one real negotiation this week (a CO, schedule relief, supplier price). Write your BATNA and walk-away first.',
        'Rewrite one tough letter (backcharge dispute or delay notice) so it is factual, contract-referenced, and calm.',
        'Ask the best negotiator in your company: "How do you prepare for a big CO negotiation with a GC?"',
        'Work out the full cost of one CO you might compromise on. What is the minimum you will accept, and why?',
        'Build a Negotiation Prep template: issue, interests on both sides, BATNA, opening, target, walk-away, concessions to trade, documentation.',
      ],
      quiz: [
        ['What is BATNA?', 'Best Alternative To a Negotiated Agreement: what you will do if this negotiation fails. It sets your walk-away point and your leverage.'],
        ['Interests vs positions?', 'Positions are what people ask for; interests are why (schedule certainty, budget, avoiding blame). Solving for interests creates more options than trading positions.'],
      ],
      res: ['pon', 'library'] },

    { theme: 'Leading Foremen and Crews', goal: 'Build foremen who run jobs like owners.',
      days: [
        'Study practical leadership: clear expectations, Situation-Behavior-Impact feedback, recognition, accountability. Borrow Extreme Ownership or Crucial Conversations.',
        'Hold a one-on-one with each foreman: what is going well, what is in the way, what they want to learn.',
        'Write SBI feedback for one positive and one corrective situation you observed.',
        'Ask a respected senior foreman: "Who was the best PM you ever worked for, and why?"',
        'Estimate the cost of foreman turnover on one job: learning curve, mistakes, recruiting.',
        'Write a Foreman Development Plan: skills to build (look-aheads, cost tracking, layout), training schedule, how you will measure progress.',
      ],
      quiz: [
        ['What is SBI feedback?', 'Situation (when and where), Behavior (what they did, observable), Impact (the effect). It keeps feedback specific and impersonal.'],
        ['What is the PM\'s main job with foremen?', 'Remove obstacles and deliver what they need (information, material, manpower, decisions), then hold them to clear outcomes.'],
      ],
      res: ['library'] },

    { theme: 'Preconstruction and Go/No-Go', goal: 'Win the right work, not just more work.',
      days: [
        'Study bid/no-bid criteria: client history, contract terms, schedule realism, design quality, competition, staffing, margin, bonding, strategic fit. Read FMI pieces on project selection.',
        'Sit in on an estimating bid review or go/no-go meeting. Observe how decisions are made.',
        'Score a current opportunity with a weighted go/no-go scorecard (build one if none exists).',
        'Ask your ops VP or owner: "Which jobs do we regret winning, and what would have warned us?"',
        'Calculate the full cost of bidding a job (estimator hours, PM time) against the expected value of winning it.',
        'Write a preconstruction Risk Register template: risk, probability, impact, mitigation, owner, contingency.',
      ],
      quiz: [
        ['Name five go/no-go criteria.', 'Client payment history, contract risk terms, schedule realism, design completeness, staffing availability, competition, margin potential, bonding capacity, strategic fit.'],
        ['Why can winning the wrong job hurt more than losing it?', 'It ties up your best people and cash on low or negative margin work and blocks better opportunities.'],
      ],
      res: ['fmi', 'company_files'] },

    { theme: 'Design-Assist and Design-Build', goal: 'Add value early and control risk when you hold design responsibility.',
      days: [
        'Study design-assist vs design-build: roles, professional liability, engineer of record relationships, target value design, budgeting from conceptual documents.',
        'Find one design improvement on a current job (routing, equipment location, prefab-friendly detail) and propose it through the proper channel.',
        'Build a conceptual budget for a 50,000 sq ft office using $/sq ft by system (distribution, branch power, lighting, fire alarm, low voltage) from company history.',
        'Ask a design-build PM or engineer: "What makes a design-assist partner valuable to you?"',
        'Compare your conceptual budget with the actual cost of a similar closed job.',
        'Write a Value Engineering proposal format: current design, alternate, savings, schedule effect, risks, approvals needed.',
      ],
      quiz: [
        ['Design-assist vs design-build?', 'Design-assist: you advise on cost and constructability while the engineer of record keeps design responsibility. Design-build: you hold design responsibility (usually through a contracted engineer) and the liability that comes with it.'],
        ['Why keep historical $/sq ft by system?', 'It produces fast, calibrated conceptual budgets and shows early when a design is trending over budget.'],
      ],
      res: ['company_files', 'fmi'] },

    { theme: 'Prefabrication and Productivity Strategy', goal: 'Move labor from the jobsite to a controlled environment where it pays.',
      days: [
        'Study electrical prefab: multi-gang assemblies, lighting whips, overhead racks, kitted feeders, prewired backboards. Learn the cost, logistics, and quality tradeoffs.',
        'Pick one repetitive task on a job that could be prefabricated. Measure current field time per unit.',
        'Compare field vs prefab cost for that task: labor rate and productivity, handling, shipping, rework.',
        'Ask your prefab manager (or a peer company\'s): "Which prefab items deliver the best return?"',
        'Calculate the break-even quantity for the prefab assembly.',
        'Write a Prefab Opportunity Plan for an upcoming job: items, quantities, drawings needed, release dates, delivery sequence.',
      ],
      quiz: [
        ['Why can prefab improve productivity?', 'Shop work has better ergonomics, lighting, tools, and material flow with fewer interruptions. It also reduces field congestion and improves quality.'],
        ['When does prefab not pay?', 'Low repetition, unstable design, high shipping and handling cost, or drawings that are not final early enough to build ahead.'],
      ],
      res: ['ecmag', 'lci'] },

    { theme: 'Financial Leadership', goal: 'Think like the CFO about margin, overhead, and cash.',
      days: [
        'Study gross margin vs net profit, overhead recovery, break-even volume, portfolio WIP, bonding capacity (working capital and equity), and cash conversion.',
        'Ask accounting for the current overhead rate and how it is applied in bids.',
        'Calculate break-even revenue (overhead / gross margin %) for two margin scenarios.',
        'Ask the CFO: "How do project results affect our bonding capacity and bank lines?"',
        'Build a portfolio view of your jobs: backlog, average margin, cash position, over/under billing.',
        'Write a one-page Financial Health Dashboard for your portfolio and present it to your manager.',
      ],
      quiz: [
        ['Overhead $3M and gross margin 15%. What is break-even revenue?', '$3M / 0.15 = $20M.'],
        ['Why do sureties care about over and under billing?', 'They show whether revenue recognition is aggressive and whether jobs are losing money. Large underbillings in particular can signal hidden losses.'],
      ],
      res: ['fmi', 'excel'] },

    { theme: 'Risk: Insurance, Bonds and Liens', goal: 'Know which risks are transferred, retained, or uninsured.',
      days: [
        'Study CGL, auto, workers\' comp, umbrella, builder\'s risk, OCIP/CCIP wrap-ups, additional insured, waivers of subrogation, performance and payment bonds, and your state\'s lien and prompt payment laws.',
        'Verify COIs and bond requirements for one job and for your lower-tier subs and suppliers.',
        'Build a lien deadline calendar for your jobs: preliminary notice, lien filing, enforcement deadlines.',
        'Ask your risk manager or broker: "Which claims have we had, and which coverage gaps surprised us?"',
        'Calculate the bond premium on one change order and confirm you are billing it.',
        'Write a Risk Transfer Checklist for new contracts: insurance, indemnity scope, bonds, waivers, lien rights.',
      ],
      quiz: [
        ['Why are lien deadlines critical?', 'Lien rights are strictly statutory. Missing a preliminary notice or filing deadline usually forfeits the right entirely, however valid the debt. On public jobs you usually cannot lien; your remedy is the payment bond (Miller Act or the state equivalent), which has its own notice deadlines.'],
        ['What is an OCIP or CCIP?', 'An owner- or contractor-controlled insurance program: one wrap-up policy covering enrolled contractors. You remove those insurance costs from your price and follow enrollment rules.'],
      ],
      res: ['company_files', 'fmi'] },

    { theme: 'Client Relationships and Business Development', goal: 'Become the PM clients ask for by name.',
      days: [
        'Study client experience: communication cadence, no-surprises reporting, responsiveness, and how GCs and owners choose subcontractors.',
        'Ask one GC PM or superintendent for candid feedback: "What should we do more of, and less of?"',
        'Write a monthly client update template: progress, milestones, risks, decisions needed, CO status.',
        'Ask your business development lead: "How do we win negotiated work, and what role does the PM play?"',
        'Calculate the lifetime value of a repeat client: annual volume x margin x years.',
        'Plan a post-project review with a client on a finished job: what went well, what to improve, what is next.',
      ],
      quiz: [
        ['What is no-surprises reporting?', 'Telling the client about risks and bad news early, with options, before they discover it. It builds trust and makes them a partner in the solution.'],
        ['Why is negotiated work valuable?', 'It usually carries better margins, earlier involvement, and less price competition, and it comes from trust earned on past jobs.'],
      ],
      res: ['fmi'] },

    { theme: 'Running a Portfolio of Projects', goal: 'Manage more work without losing control.',
      days: [
        'Study PM time management: weekly planning, time blocking, delegation levels, standard work. Borrow The Checklist Manifesto.',
        'Track your time for three days in 30-minute blocks. Classify each: high-value (decisions, field, client), admin, or firefighting.',
        'Pick five recurring tasks to delegate to a PE or APM and write a one-paragraph standard for each.',
        'Ask a senior PM who runs many jobs: "What is your weekly rhythm?"',
        'Calculate your weekly hours of reactive work and set a reduction target.',
        'Build your Weekly PM Rhythm: Monday planning, field days, Friday numbers, meetings, protected learning time.',
      ],
      quiz: [
        ['What is standard work for a PM?', 'Documented, repeatable routines (weekly cost review, look-ahead, CO follow-up) so nothing important depends on memory.'],
        ['Why track time before changing habits?', 'Perceived time use is usually wrong. Data shows where hours actually go and which changes matter.'],
      ],
      res: ['library'] },

    { theme: 'Technology and Data', goal: 'Use data and tools to see problems sooner and work faster.',
      days: [
        'Take a free Microsoft Learn module on Power BI or Excel PivotTables. Explore what your PM platform can report automatically.',
        'Ask your foremen which apps save them time and which waste it.',
        'Build a one-job dashboard (Excel or Power BI): PF by cost code, CO status, RFI aging, manpower vs plan.',
        'Ask your IT or VDC lead: "What data do we capture but never use?"',
        'Estimate hours saved per week by automating one recurring report.',
        'Test an AI assistant on a real task (summarize a spec section, draft an RFI or meeting minutes). Write rules for what you will use it for and what you will always verify by hand.',
      ],
      quiz: [
        ['Name three leading indicators for a job dashboard.', 'PF trend, Percent Plan Complete, RFI and submittal aging, pending CO value and age, manpower vs plan.'],
        ['What must you always verify when AI touches project documents?', 'Code references, quantities, dates, contract terms, and any figure that goes into a price or a notice. AI can draft; you are accountable.'],
      ],
      res: ['powerbi', 'excel', 'procore'] },

    { theme: 'Developing People', goal: 'Multiply yourself by building PEs, APMs, and foremen.',
      days: [
        'Study coaching basics: the GROW model (Goal, Reality, Options, Will), delegation levels, and stretch assignments.',
        'Give one PE, APM, or foreman a stretch assignment with clear expectations and a check-in date.',
        'Write a 90-day onboarding plan for a new project engineer.',
        'Ask HR or your manager: "How do we evaluate and promote PMs, and which skills separate the best?"',
        'Estimate the weekly hours you would regain if your PE fully owned submittals and RFIs.',
        'Deliver a 30-minute lunch-and-learn for your team on one topic you have mastered this year.',
      ],
      quiz: [
        ['What is the GROW model?', 'A coaching structure: Goal (what they want), Reality (where they are), Options (possible paths), Will (what they commit to).'],
        ['Why teach what you are learning?', 'Teaching forces you to organize knowledge and exposes gaps. It deepens expertise faster than rereading and builds your team at the same time.'],
      ],
      res: ['library'] },

    // ---------- Phase 5: Mastery ----------
    { theme: 'The Lessons-Learned Engine', goal: 'Extract twenty years of patterns from your company\'s closed jobs.',
      days: [
        'Learn post-mortem structure: plan vs actual for cost codes, schedule, and COs, and the cause behind each variance.',
        'Interview the foreman of a recently closed job about the three decisions that most affected the outcome.',
        'Analyze closed job #1: estimate vs actual by cost code. List the three largest variances and the root cause of each.',
        'Ask the PM of that job: "What would you do differently from day one?"',
        'Analyze closed jobs #2 and #3 the same way. Look for patterns across all three.',
        'Write a Lessons Learned report: top ten patterns, what to do differently, and which playbook pages to update.',
      ],
      quiz: [
        ['Why analyze closed jobs instead of only active ones?', 'Closed jobs have final, complete data. They show how early warning signs actually played out, which is how veterans build intuition.'],
        ['Cause vs symptom in a cost variance?', 'The symptom is the overrun (branch rough-in +20%). The cause is why (late drawings, wrong labor unit, crew mix, stacking). Fix causes.'],
      ],
      res: ['company_files'] },

    { theme: 'Your Personal Labor-Unit Book', goal: 'Carry calibrated labor units in your head like a 20-year estimator.',
      days: [
        'Review your Labor Unit Book from Week 7 and the closed-job analysis. Pick the 25 items you price most often.',
        'Observe and time three more tasks on site to add field data.',
        'Estimate hours for ten common items without looking, then compare with your book. Record your error.',
        'Ask the chief estimator to review your book and challenge any unit that looks wrong.',
        'Calculate your estimating accuracy: average absolute % error over your last 20 guesses.',
        'Finalize Labor Unit Book v1: 25 items with unit, company actual, manual unit, and condition notes.',
      ],
      quiz: [
        ['How do you measure estimating accuracy?', 'Average absolute percent error between your estimates and actuals across many items. Track it; it should fall over time.'],
        ['Why carry labor units in your head?', 'Fast gut checks in meetings and CO negotiations catch errors before they become commitments.'],
      ],
      res: ['neca_mlu', 'company_files'] },

    { theme: 'Playbook I: Project Startup', goal: 'Start every job right with a repeatable system.',
      days: [
        'Review your playbook pages on contracts, buyout, schedule, and safety. Decide what belongs in startup.',
        'Use your draft startup checklist on a new or recently started job and note the gaps.',
        'Build the internal kickoff meeting agenda: scope, budget, schedule, risks, roles, procurement, safety, communication.',
        'Ask your ops manager to review the checklist and add their must-haves.',
        'Load one job\'s budget from estimate to cost codes and verify it ties out.',
        'Finalize the Project Startup Playbook: contract risk card, kickoff agenda, buyout plan, procurement plan, baseline schedule, safety plan, communication plan.',
      ],
      quiz: [
        ['What should be done in the first 30 days of a new job?', 'Contract risk card, budget loaded by cost code, buyout plan, procurement and submittal schedule, baseline schedule and manpower plan, safety plan, internal and GC kickoffs.'],
        ['Why tie the estimate to cost codes before work starts?', 'Without a clean budget by cost code you cannot measure productivity or forecast accurately.'],
      ],
      res: ['company_files'] },

    { theme: 'Playbook II: Monthly Control', goal: 'Run the same reliable monthly control cycle on every job.',
      days: [
        'Review your cost, forecasting, CO, and schedule tools from Weeks 9 through 14.',
        'Run the full monthly cycle on one job: quantities, PF, forecast, billing, CO follow-up, look-ahead.',
        'Time the cycle and cut waste with templates, automation, and delegation.',
        'Ask leadership what they want to see in monthly reviews.',
        'Produce the monthly review package for every job.',
        'Finalize the Monthly Control Playbook: calendar, templates, checklists, and thresholds that trigger escalation.',
      ],
      quiz: [
        ['Give examples of escalation triggers.', 'PF below 0.90 on a major cost code, forecast margin down more than 2 points, a CO pending over 30 days, a critical submittal late, any safety incident.'],
        ['Why set thresholds in advance?', 'They make escalation automatic and unemotional, so problems surface early instead of being explained away.'],
      ],
      res: ['company_files', 'excel'] },

    { theme: 'Playbook III: Closeout and Turnover', goal: 'Close every job cleanly and collect every dollar.',
      days: [
        'Review your Week 17 closeout tracker and your company\'s closeout procedure.',
        'Apply the closeout tracker to the job closest to completion.',
        'Write the owner training agenda for electrical systems: gear, generator, lighting controls, fire alarm.',
        'Ask accounting: "What slows final billing and retention collection?"',
        'List all open retention and final billings across your jobs with expected collection dates.',
        'Finalize the Closeout Playbook: tracker, document checklist, training plan, warranty process, lessons-learned meeting.',
      ],
      quiz: [
        ['Name five electrical closeout documents.', 'As-builts, O&M manuals, test reports, warranties, training records, attic stock receipts, final inspection certificates, lien waivers.'],
        ['Why document the warranty start date?', 'Warranty usually starts at substantial completion (or as the contract says). A documented date lets you bill warranty calls that arrive after it expires.'],
      ],
      res: ['company_files'] },

    { theme: 'Credentials and Reputation', goal: 'Make your expertise visible and verifiable.',
      days: [
        'Compare credentials and costs: OSHA 30 (if not current), NFPA 70E training, a state electrical license (if eligible), PMP or CAPM, NECA or IEC chapter programs. Decide which serve your goals.',
        'Volunteer for one company or industry activity: safety committee, NECA or IEC chapter event, or a guest talk at an apprenticeship class.',
        'Take a free practice exam for the credential you chose.',
        'Ask a respected industry leader: "Which credentials or affiliations helped your career most?"',
        'Budget your credential plan: cost, time, and expected benefit.',
        'Write your three-year Professional Development Plan: credentials, roles, skills, and the people you will learn from.',
      ],
      quiz: [
        ['Which credential matters most for an electrical PM?', 'It depends on your goals. Competence matters most. OSHA 30 and NFPA 70E awareness are baseline; a state license matters if you will qualify a company; PMP helps in some organizations.'],
        ['Why get involved in an industry association?', 'Peers, training, labor relations insight, and reputation. Most problems you will face were already solved by someone in that room.'],
      ],
      res: ['osha30', 'nfpa'] },

    { theme: 'Capstone I: Full Estimate', goal: 'Prove you can estimate a real project end to end.',
      days: [
        'Select a recently bid project with full drawings and the company\'s final estimate.',
        'Walk a similar project in progress to calibrate your assumptions.',
        'Complete the takeoff for the full project or a defined building section.',
        'Ask the estimator who bid it to compare assumptions with you.',
        'Price labor, material, quotes, and markups. Compare with the company bid by system.',
        'Write a variance memo: where you differed, why, and what you will change in your method.',
      ],
      quiz: [
        ['What is usually the biggest risk in an electrical estimate?', 'Labor productivity assumptions and scope gaps between quotes. Your variance memo should name your top risk.'],
        ['How do you know an estimate is good?', 'It is complete (no scope gaps), calibrated against company actuals, and its assumptions are written down so others can challenge them.'],
      ],
      res: ['neca_mlu', 'bluebeam', 'company_files'] },

    { theme: 'Capstone II: Executive Project Review', goal: 'Present a project the way a senior PM does.',
      days: [
        'Review the best monthly review presentations in your company. Note structure and what leadership asks.',
        'Gather current data for your largest job.',
        'Practice a 10-minute presentation: status, forecast, margin bridge, COs, schedule, risks, asks.',
        'Ask your manager to role-play the toughest questions.',
        'Stress-test your forecast: what if PF drops 5%? What if half the pending COs are rejected?',
        'Deliver the review to leadership and ask for direct feedback.',
      ],
      quiz: [
        ['Which three questions will leadership always ask?', 'Are we making money, and is the forecast real? Will we finish on time? What do you need from us?'],
        ['Why stress-test a forecast?', 'It shows the range of outcomes and which assumptions matter most, so leadership trusts the number and you act early.'],
      ],
      res: ['company_files'] },

    { theme: 'Capstone III: Teach It and Plan Year Two', goal: 'Lock in mastery by teaching, then set the next horizon.',
      days: [
        'Review your playbook end to end. Identify the five lessons that matter most.',
        'Coach a PE or new PM through one of your playbook processes.',
        'Retake the Skills self-assessment and compare it with your Day 1 baseline.',
        'Ask three colleagues how you have grown and where you should go next.',
        'Total your year: margins vs bid, CO recovery rate, safety, schedule performance.',
        'Teach a one-hour session on your playbook. Write your Year Two plan.',
      ],
      quiz: [
        ['What separates a master PM from a good one?', 'Pattern recognition from many reps: they see problems early, act on small signals, protect the money with documentation, and develop people who multiply their impact.'],
        ['What keeps mastery growing after year one?', 'Deliberate practice with feedback: closed-job reviews, teaching, new markets, and honest post-mortems on every project.'],
      ],
      res: ['company_files'] },
  ];

  const FINAL_DAY = {
    theme: 'Graduation Review',
    goal: 'Measure how far you came and commit to Year Two.',
    task: 'Retake the Skills self-assessment. Compare all ten competencies with your Day 1 baseline. Reread your Day 1 notes. Choose the two competencies with the biggest remaining gap and make them the spine of your Year Two plan. Then take the day off.',
  };

  const SKILLS = [
    { id: 'code', name: 'Code and Systems', desc: 'NEC, NFPA 70E, distribution, life safety, specialty systems.' },
    { id: 'estimating', name: 'Estimating', desc: 'Takeoff, labor units, quotes, buyout.' },
    { id: 'cost', name: 'Cost Control', desc: 'Earned value, forecasting, WIP, cash.' },
    { id: 'contracts', name: 'Contracts and Changes', desc: 'Risk clauses, notice, CO pricing, claims.' },
    { id: 'schedule', name: 'Scheduling', desc: 'CPM, sequence, manpower, look-aheads.' },
    { id: 'procurement', name: 'Procurement', desc: 'Submittals, long lead, material flow.' },
    { id: 'field', name: 'Field Production', desc: 'Productivity, foreman support, prefab.' },
    { id: 'safety', name: 'Safety and Quality', desc: 'OSHA, 70E, inspections, testing, closeout.' },
    { id: 'leadership', name: 'Leadership', desc: 'Foremen, negotiation, communication, people.' },
    { id: 'business', name: 'Business Acumen', desc: 'Go/no-go, finance, risk, clients.' },
  ];

  const LEVELS = ['Not rated', 'Aware: I know it exists', 'Assisted: I do it with help', 'Independent: I do it reliably', 'Teacher: I can train others', 'Master: I see problems before they show'];

  // ---------- Curriculum builder ----------
  function phaseOfWeek(w) {
    return PHASES.find(p => w >= p.weeks[0] && w <= p.weeks[1]) || PHASES[PHASES.length - 1];
  }

  function buildDays() {
    const days = [];
    WEEKS.forEach((wk, i) => {
      const w = i + 1;
      const phase = phaseOfWeek(w).id;
      const next = WEEKS[i + 1];
      KINDS.forEach((kind, k) => {
        const task = k < 6 ? wk.days[k]
          : `Weekly review: answer this week's two check questions from memory, add one playbook page from "${wk.theme}", log which job reps worked, and schedule next week's reps${next ? ` for "${next.theme}"` : ''}. Then rest; recovery is part of the program.`;
        days.push({ n: w * 7 - 6 + k, week: w, phase, kind: kind.id, kindLabel: kind.label, minutes: kind.minutes, theme: wk.theme, goal: wk.goal, task, res: wk.res });
      });
    });
    days.push({ n: 365, week: 52, phase: 5, kind: 'review', kindLabel: 'Graduation', minutes: 90, theme: FINAL_DAY.theme, goal: FINAL_DAY.goal, task: FINAL_DAY.task, res: ['company_files'] });
    return days;
  }

  function buildCards() {
    const cards = [];
    WEEKS.forEach((wk, i) => wk.quiz.forEach(([q, a], j) => cards.push({ id: `w${i + 1}q${j + 1}`, week: i + 1, theme: wk.theme, q, a })));
    return cards;
  }

  // ---------- Dates ----------
  const DAY_MS = 86400000;
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function toISO(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(iso, n) { return toISO(parseISO(iso) + n * DAY_MS); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / DAY_MS); }
  // Program day number (1-based) for a calendar date, clamped to 1..365.
  function dayNumber(startISO, todayISO) { return Math.min(365, Math.max(1, daysBetween(startISO, todayISO) + 1)); }

  // Leitner spaced repetition: box 1..5, review interval in days.
  const LEITNER = [0, 1, 2, 4, 8, 16];
  function review(card, correct, todayISO) {
    const box = correct ? Math.min(5, (card.box || 1) + 1) : 1;
    return { box, due: addDays(todayISO, LEITNER[box]) };
  }

  // ---------- Calculators ----------
  // Circular mils, NEC Chapter 9 Table 8.
  const CMIL = { '14': 4110, '12': 6530, '10': 10380, '8': 16510, '6': 26240, '4': 41740, '3': 52620, '2': 66360, '1': 83690, '1/0': 105600, '2/0': 133100, '3/0': 167800, '4/0': 211600, '250': 250000, '300': 300000, '350': 350000, '400': 400000, '500': 500000, '600': 600000, '750': 750000 };
  // Explicit order: Object.keys would put integer-like keys ('14', '250') before '1/0'.
  const SIZES = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '300', '350', '400', '500', '600', '750'];
  // Approximate resistivity constant K (ohm-cmil/ft) at 75°C.
  const K = { cu: 12.9, al: 21.2 };
  // Table 310.16, 75°C column, with 240.4(D) small-conductor limits applied. No adjustment or correction factors.
  const AMP75 = {
    cu: { '14': 15, '12': 20, '10': 30, '8': 50, '6': 65, '4': 85, '3': 100, '2': 115, '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230, '250': 255, '300': 285, '350': 310, '400': 335, '500': 380, '600': 420, '750': 475 },
    al: { '12': 15, '10': 25, '8': 40, '6': 50, '4': 65, '3': 75, '2': 90, '1': 100, '1/0': 120, '2/0': 135, '3/0': 155, '4/0': 180, '250': 205, '300': 230, '350': 250, '400': 270, '500': 310, '600': 340, '750': 385 },
  };

  const calc = {
    // Labor earned value. pct is 0-100 from installed quantities.
    labor({ budgetHrs, pct, actualHrs, rate = 0 }) {
      const earned = budgetHrs * pct / 100;
      if (!(earned > 0) || !(actualHrs > 0)) return { earned, pf: null, eac: null, variance: null, varianceCost: null };
      const pf = earned / actualHrs;
      const eac = budgetHrs / pf; // assumes remaining work runs at today's PF
      const variance = budgetHrs - eac; // + gain, - fade
      return { earned, pf, eac, variance, varianceCost: variance * rate };
    },

    // Cost-to-cost percent complete, earned revenue, over/under billing.
    wip({ contract, estCost, costToDate, billed }) {
      const pct = estCost > 0 ? Math.min(1, costToDate / estCost) : 0;
      const earned = contract * pct;
      const gp = contract - estCost;
      // A projected loss is recognized in full as soon as it is known, not as the job progresses.
      return { pct, earned, overUnder: billed - earned, gp, margin: contract > 0 ? gp / contract : 0, costToComplete: Math.max(0, estCost - costToDate), loss: gp < 0 ? -gp : 0, overrun: costToDate > estCost };
    },

    // Change order: markup on self-performed work, separate markup on subs, bond on the total.
    changeOrder({ hours = 0, rate = 0, material = 0, taxPct = 0, equipment = 0, subs = 0, markupPct = 0, subMarkupPct = 0, bondPct = 0 }) {
      const labor = hours * rate;
      const mat = material * (1 + taxPct / 100);
      const self = labor + mat + equipment;
      const selfMarkup = self * markupPct / 100;
      const subMarkup = subs * subMarkupPct / 100;
      const subtotal = self + selfMarkup + subs + subMarkup;
      const bond = subtotal * bondPct / 100;
      return { labor, mat, equipment, self, selfMarkup, subs, subMarkup, subtotal, bond, total: subtotal + bond };
    },

    // Voltage drop, K method (resistive only; ignores reactance, fine for screening).
    voltageDrop({ phase, material, size, amps, feet, volts }) {
      const cm = CMIL[size];
      const k = K[material];
      const vd = (+phase === 3 ? Math.sqrt(3) : 2) * k * amps * feet / cm;
      return { vd, pct: vd / volts * 100 };
    },

    // Smallest conductor whose 75°C ampacity carries the load, or null.
    minSizeForAmps({ material, amps }) {
      return SIZES.find(size => (AMP75[material][size] || 0) >= amps) || null;
    },

    // Smallest conductor in the table that meets maxPct, or null.
    minSizeForDrop({ phase, material, amps, feet, volts, maxPct }) {
      return SIZES.find(size => calc.voltageDrop({ phase, material, size, amps, feet, volts }).pct <= maxPct) || null;
    },

    amps({ kva, volts, phase }) { return kva * 1000 / (+phase === 3 ? Math.sqrt(3) * volts : volts); },
    kva({ amps, volts, phase }) { return amps * (+phase === 3 ? Math.sqrt(3) * volts : volts) / 1000; },

    // Measured mile. Rates in units per hour.
    measuredMile({ baseQty, baseHrs, impQty, impHrs, rate = 0 }) {
      if (!(baseQty > 0 && baseHrs > 0 && impHrs > 0 && impQty >= 0)) return { baseRate: null, impRate: null, expected: null, lost: null, pctLoss: null, cost: null };
      const baseRate = baseQty / baseHrs;
      const expected = impQty / baseRate;
      const lost = impHrs - expected;
      return { baseRate, impRate: impQty / impHrs, expected, lost, pctLoss: lost / impHrs, cost: lost * rate };
    },

    // Average crew needed. productivityPct is your own assumption (100 = plan rate).
    crew({ remainingHrs, weeks, hrsPerWeek, productivityPct = 100 }) {
      if (!(weeks > 0 && hrsPerWeek > 0 && productivityPct > 0)) return { effectiveHrs: null, crew: null, crewRounded: null };
      const effectiveHrs = remainingHrs / (productivityPct / 100);
      const crew = effectiveHrs / (weeks * hrsPerWeek);
      return { effectiveHrs, crew, crewRounded: Math.ceil(crew - 1e-9) };
    },

    // Latest submittal date working back from need-on-site.
    submitBy({ needDate, leadWeeks, reviewWeeks, releaseWeeks, bufferWeeks = 0 }) {
      const totalWeeks = [leadWeeks, reviewWeeks, releaseWeeks, bufferWeeks].reduce((a, b) => a + (Number(b) || 0), 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(needDate)) return { totalWeeks, date: null };
      return { totalWeeks, date: addDays(needDate, -totalWeeks * 7) };
    },

    breakEven({ overhead, marginPct }) { return marginPct > 0 ? overhead / (marginPct / 100) : null; },
  };

  const EPM = { PHASES, KINDS, RESOURCES, WEEKS, SKILLS, LEVELS, FINAL_DAY, SIZES, CMIL, AMP75, buildDays, buildCards, phaseOfWeek, addDays, daysBetween, dayNumber, review, calc };
  root.EPM = EPM;
  if (typeof module === 'object' && module.exports) module.exports = EPM;
})(typeof window !== 'undefined' ? window : globalThis);
