# NC Unlimited: Book lookup status

Generated from `data-nec.js`. Facts marked verified were read directly in NFPA LiNK (2020 NFPA 70) by Harrison/Codex on 2026-10-31 and relayed to the app; nothing here was read by the app's author. A lookup is never scored by the app.

## Resolved (6)
- **G02**: No. A 200 A service label is not enough. You need the size and material of the largest ungrounded conductor (Table 250.66), the arrangement of any parallel sets (use equivalent area per the table notes), and the electrode types the GEC serves (rod/pipe/plate only, concrete-encased only, ring), because each exception applies only if the connection does not continue to another electrode requiring a larger conductor. [Table 250.66 and its exceptions (verified, NFPA LiNK, Oct 31 2026)]
- **B02**: Six entering EGCs/bonding jumpers count 1 allowance for the first four (based on the largest) plus 1/4 for each additional one: 1 + 2 x 1/4 = 1.5 allowances at the largest conductor's Table 314.16(B) volume (for example 12 AWG: 1.5 x 2.25 = 3.375 in3). The old shortcut that all grounds count as one is not the 2020 rule. [314.16(B)(5) and Table 314.16(B) (verified, NFPA LiNK, Oct 31 2026)]
- **O04**: The next higher standard rating above 36 A is 40 A (240.6(A) lists 35 A then 40 A), but 240.4(B) permits using it ONLY if all three conditions hold: the protected conductors are not part of a branch circuit supplying more than one receptacle for cord-and-plug-connected portable loads; the 36 A ampacity does not correspond with the standard rating of a fuse or fixed-trip circuit breaker; and the next standard rating is 800 A or less. A general branch-circuit description does not establish the receptacle condition, so state it as an assumption you must confirm. 240.4(D) small-conductor limits are separate and still apply. Do not promote 36 A to 40 A as an unconditional answer. [240.4(B) and 240.6(A) (verified, NFPA LiNK, Oct 31 2026)]
- **D03**: 110.3(B): listed or labeled equipment must be installed and used in accordance with the instructions included in its listing or labeling. The governing instructions are the ones actually included with the listed assembly (terminals, working arrangement, torque and so on), not generic manufacturer recommendations. 110.3(A) lists the examination factors: suitability, mechanical strength, wire-bending and connection space, heating and others. Evidence to preserve: the listing or label, the instruction sheet that came with the equipment, and the exact clause relied on. The question gives no model or instructions, so no terminal clearance or torque value can be stated. [110.3(A) and 110.3(B) (verified, NFPA LiNK, Oct 31 2026)]
- **W04**: Conditional on the load facts. A neutral carrying only the unbalanced current need not be counted. The neutral DOES count on a 4-wire, 3-phase wye circuit where a MAJOR PORTION of the load is nonlinear, and on a 3-wire circuit of two phase conductors plus the neutral from a 4-wire wye system. 'Substantial nonlinear load' does not by itself prove the major-portion condition, so state what fraction of the load is nonlinear before counting the neutral. Grounding and bonding conductors are not counted (310.15(F)). [310.15(E) and (F) (verified, NFPA LiNK, Oct 31 2026)]
- **W01**: Use the 90 C column ampacity as the starting point for correction and adjustment, because 310.15(A) permits correction and adjustment factors to be applied to the ampacity for the conductor temperature rating. Then apply the separate termination check: the corrected or adjusted result may not exceed the ampacity for the 75 C termination rating (the 75 C column value for the same size and material) under 110.14(C). This is a qualified rule, not a universal 90 C shortcut. [310.15(A) (verified, NFPA LiNK, Oct 31 2026); Table 310.16 copper 14 to 500 kcmil and Table 310.15(B)(1) rows 31 to 60 C (verified)]

## Partly resolved (6)
- **G04**: still needed: 250.122(F) parallel-conductor text; 250.120 installation restrictions
- **G05**: still needed: Which electrodes must be connected when both a rod and a qualifying concrete-encased electrode are present (250.50, 250.52, 250.53 text)
- **G08**: still needed: 250.102(C) bonding-jumper sizing if the function is bonding
- **O07**: still needed: 430.32 overload text (the separate overload rule); The 430.52 and 240.4(G) relationship wording; 430.6(A)(1) current basis (table FLC vs nameplate)
- **L08**: still needed: 220.52 small-appliance and laundry; 220.53 fixed appliances; 220.54 dryer; 220.55 and Table 220.55 range; 220.82 optional method and the HVAC and motor inputs
- **L09**: still needed: Table 220.12 VA per square foot for the stated occupancy; Receptacle demand (220.14(I), 220.44, 220.14(K)); Motor contribution (220.50, 430.24)

## Still unresolved, by reference
### 250.66 (remainder) and 250.102(C)
Questions: G08, G07
- 250.102(C)(1) supply-side and main/system bonding-jumper sizing and the 12.5% rule

### 250.122 (A) and (F), 250.120
Questions: G04, G01, G09
- 250.122(A) not larger than circuit conductors
- 250.122(F) parallel conductors
- 250.120 installation restrictions; 250.4(A)(5) fault path; objectionable current

### 250 electrodes and systems
Questions: G05, G03, G06, G07, G10, G11
- 250.50 and 250.52 which electrodes must be bonded together and the concrete-encased electrode definition (20 ft, 1/2 in rebar, 2 in)
- 250.53(A) supplemental electrode and 25 ohm text
- 250.30 separately derived systems and 250.24, 250.28 bonding rules
- Part X (over 1000 V) grounding, 250.36 and 250.187 scopes and voltage ranges

### 310.16 (remainder) and 110.14
Questions: W05, W10
- Table 310.4 and 310.10 wet-location markings (THHN vs THWN-2)
- 110.14(D) torque and aluminum termination marking
- App reference rows only (no question blocked): Table 310.16 copper 600 to 2000 kcmil; 110.14(C)(1) 60 vs 75 C detail; 310.15(B)(1) rows at or below 30 C and above 60 C; 310.15(C)(1) 24 in condition and mixed-system sentence

### 314.16(B) remainder, 314.28, 314.16(C), 300.14
Questions: B05, B06, B07
- 314.16(B)(3) fixture studs, hickeys and support fittings
- Whether (B)(5) repeats the 250.146(D) isolated-ground sentence
- 314.28(A)(1) and (A)(2) straight and angle pull rules and entry spacing
- 314.16(C) conduit-body fill and marking
- 300.14 free conductor length

### 430 (beyond Table 430.52)
Questions: M01, M06, M08, M09, O07
- 430.6(A)(1) current basis and exceptions (table FLC vs nameplate)
- 430.22 branch conductor
- 430.32 overload settings and 430.32(C)
- 430.24 feeder conductors and 430.62 feeder protection
- 430.102, 430.109, 430.110 controller vs disconnect
- 430.52(C)(3) instantaneous-trip exception values
- Part VI control circuits (430.72)

### 220 (beyond Table 220.42)
Questions: L07, L08, L09, L10
- Table 220.12 VA per square foot for every occupancy, with the 2020 office value
- 220.52 small-appliance and laundry, and whether they join the general lighting load
- 220.53, 220.54, 220.55 and Table 220.55
- 220.60 noncoincident loads and 220.82 optional method
- 220.14(I), 220.44, 220.14(K) receptacle demand
- 220.50 motors

### 240 and 110.9/110.10
Questions: O01, O02, O05, O06, O08, O09
- 110.9 interrupting rating and 110.10 short-circuit suitability
- 240.4(D) small-conductor limits (not required for O04, which is resolved)
- 240.21(B) feeder taps (10 ft, 25 ft)
- 240 Parts for breakers, plug and cartridge fuses
- 240 Part IX and 490 over 1000 V protection
- 240.6(A) remainder of the standard list and the adjustable-trip rule

### 230 and 225
Questions: S01, S03, S04, S05, S06, S07, S08, S09
- Article 100 service definitions; 230.2 number of services
- 230.71 and 230.72 disconnect grouping
- 225.30 to 225.32 and 250.32 second building feeder
- 230.42 and 310.12 dwelling service conductor allowance
- 230.24(B) clearance rows and voltage conditions
- 230.95 ground-fault protection thresholds
- 250.24(A)(5) neutral-to-ground bonding point

### Special occupancies and emergency systems
Questions: H01, H02, H03, H04, H05, H06, H07, H08, H09, W07, E07
- 500.5 and 500.6 class, division and group definitions
- Articles 513, 514, 515, 516 classification boundaries and wiring rules
- Article 517 grounding and essential systems
- Articles 518 and 520
- Article 680 bonding, GFCI and underwater luminaires
- Articles 700, 701, 702 transfer times (700.12) and battery duration
- Article 620 traveling cable and machine-room rules

### 311, 490 and over-1000 V
Questions: W08, O08, G10
- Article 311 scope and medium-voltage ampacity tables with conditions
- Article 490 equipment rules
- Part X of Article 250
- 110 Part III clearances above 1000 V

### Chapter 9 tables
Questions: W06, W09
- Chapter 9 Table 1 percent fill, Note 4 nipple rule
- Tables 4 and 5 conductor and conduit areas
- Tables 8 and 9 resistance and AC impedance (and the wireway article fill)

### Equipment, general and definitions
Questions: E03, E04, E05, E06, D01, D02
- Article 440 (440.4, 440.22, 440.32, MCA and MOCP)
- 450.3(B) transformer protection and 240.21(C) secondary conductors
- Articles 410 and 424 relevant provisions
- Article 90 and Article 100 definitions (accessible, readily accessible)

### 2013 NFPA 72 and NASCLA
Questions: P11, P13, P14, P15
- 2013 NFPA 72 Chapter 3 and 10 definitions; Chapter 14 table rows; Chapter 17 door-release placement
- NASCLA NC Electrical page for contract-change documentation (edition on your cover)

