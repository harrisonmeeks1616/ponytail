# Harrison OS — complete product implementation handoff

This is a product and engineering brief for the current implementation. It intentionally omits the personal profile, private conversation history, account identifiers, secrets, and real personal/work content. Use synthetic fixtures in source, screenshots, tests, and demonstrations.

## 1. Current instruction and destination

Build the complete agreed application today, October 31, 2026, America/New_York. Deliver all agreed Slices 1–3 as working, connected product capabilities; do not stop at the capability spike, a static mockup, or a reduced task-list MVP. There are roughly thirteen hours remaining from the 10:50 AM instruction. Work continuously through the authorized implementation and review steps. Distinguish what is implemented today from what requires actual device evidence, a connected account, or longitudinal use.

The selected repository and intended destination are `harrisonmeeks1616/ponytail`, branch `main`. Its current contents are an agent toolkit, not the field application. Begin from its current state, preserve that toolkit, and place the new application in a clearly isolated `harrison-os/` path. Do not turn a branch, a new private repository, a two-week pilot, or an invented signed-message convention into an additional permission gate. Safe isolated worktrees for bounded parallel implementation are useful, but their completed work must be integrated into the intended destination.

This repository is public. Never commit the original personal profile/report, private prompts or chat transcripts, real captures, private documents, real email addresses, credentials, service-token secrets, database exports, raw live logs, or populated local configuration. Inspect the existing source and its history for material that must be excluded before importing it. Use environment-variable examples and synthetic fixtures. Public source does not make user data public: content and secrets belong in authenticated backend storage and protected settings.

Use the sanitized existing Harrison OS application being seeded into repository-local `harrison-os/` as the implementation baseline, after inspection. It already contains substantially more than the spike. Continue its useful code and regression tests; do not recreate Slice 1 from the spike alone. The spike is a reference for isolated capability evidence and paid-for failure modes. This brief is self-contained for the cloud session: do not depend on access to another machine's local paths, private project folders, or private chat memory. Do not import private handoff/status documents or runtime secrets wholesale. Do not change the separate PM application, its data/resources, or the live crew application while doing this work. If the seed is not yet visible in the selected checkout, identify that exact transfer dependency rather than inventing its contents.

Earlier build pauses, pilot-first implementation delays, and signature-only approval rules in historical handoffs are superseded where they conflict with the current direct instruction. Actual missing credentials, required human authentication, and genuinely new consequential authority remain real constraints; identify those narrowly and continue all independent work.

## 2. Product purpose and essential experience

Harrison OS reduces the effort of capturing information, remembering context, tracking dependencies, preparing useful work, and returning after interruptions. Success means less administration and more dependable follow-through, not more tasks, more agent activity, or more time spent inside the application.

The three primary destinations are **Today, Projects, and Memory**. **Capture** is available everywhere. **Ask** opens a contextual Lumen assistant drawer; ordinary task management never requires chatting, choosing an agent, or configuring a model.

- **Today:** next fixed commitment; one recommended Next action with a short, explainable reason; a small selected action list; meaningful Needs you decisions. Waiting and background work remain compact until relevant. Hard commitments remain discoverable even when the suggested list is short.
- **Projects:** outcomes and ongoing responsibilities, each with a purpose, next action, obstacle/Waiting dependency, relevant sources, and where to resume. Ideas remain ideas until deliberately promoted into commitments.
- **Memory:** references, decisions, source material, solved problems, and editable preferences. Full-text and exact-term retrieval work without AI. Show current information first and identify superseded material.
- **Next:** opens the actual material needed to start: source, contact, draft, checklist, or resume point. Give easy correction, deferral, and a small number of alternatives. Recommendations remain overridable.
- **Work/Personal:** enforced data and output scopes, with a private all-life view. A work-only view may account for a private busy interval without exposing its title. A filter alone is not authorization.

Use a coherent, polished interface with strong typography, generous spacing, restrained domain colors, responsive light/dark appearances, accessible contrast, reduced-motion support, and satisfying optional completion feedback. Plain language takes priority over electrical metaphors. No developer dashboards, hashes, server health, model selectors, or agent transcripts in routine flows. Optional diagnostics can contain these details.

## 3. Scope and implementation order

Implement the complete agreed scope in stages so each integration can be checked, while continuing toward all three slices today. A failure in one connector or a missing human/device step must not halt unrelated product work.

### Slice 1 — complete daily core

1. **Capture and inbox:** text, paste, existing device dictation/voice input, image/attachment capture, and supported sharing. Save originals before interpretation, without mandatory project/tag/priority/date selection. A suitable supported iOS Shortcut can be offered as an additional path, with its actual online/offline capability stated clearly.
2. **Durability:** local draft recovery, recoverable capture/reminder outbox, server persistence, idempotent retries, visible conflicts/errors, and honest local-versus-synced states. Local browser storage limitations must be acknowledged and tested.
3. **Editable interpretation:** propose actions, Waiting items, references, ideas, reminders, and decisions after saving. Preserve uncertain facts, spoken corrections, and original date phrases. A mention is not automatically a task; a possibility is not a commitment; another person's work is not assigned to the owner by implication.
4. **Complete direct task lifecycle:** create, edit, complete, reopen, archive, search, select for Today, defer appropriately, and undo reversible changes. Support simple recurrence without accumulating duplicate overdue instances. All open tasks must remain reachable without a search trick.
5. **Waiting:** who owes what, request date, last contact/reply recorded, actual promised date if one exists, next follow-up, affected outcome, ownership, and source. Surface the owner's actionable follow-up rather than treating someone else's pending work as the owner's overdue task. Say “No reply recorded” when the mailbox has not been checked.
6. **Today and Projects:** one clear next move, real deadlines, selected flexible work, minimal project details and direct actions. Completing one action exposes a useful next step when known.
7. **Save my place:** one quick optional action with safe prefills and source links. Preserve last meaningful state, unresolved issue, and next step without requiring four mandatory fields or a daily ritual. This is essential before a user pilot.
8. **Factual status and provenance:** preserve explicit actor, source quote, timestamps, scope, and distinct meanings such as requested, proposed, confirmed, reported complete, verified, and unspecified. These are not an ordered confidence ladder. Ambiguity remains unspecified; statuses never upgrade automatically.
9. **Reminders:** working scheduling/delivery route; app-owned intent versus actual route/provider authority; recurrence, cancellation, snooze/stop, deduplication, and recovery. Do not silently remove reminders if one route fails.
10. **Memory/search/export:** exact/full-text retrieval, current versus superseded records, editable memory, usable exports, and a tested restore path including relationships and attachments. Inspect actual derived-data deletion behavior rather than trusting a status label.

### Slice 2 — useful assistance and connected context

1. **Contextual Ask/Lumen:** one interface for bounded intake, planning, retrieval, follow-through preparation, and writing. Assemble only authorized in-scope context. Include at least one genuine model-backed workflow when API credentials and data authorization permit; retain useful deterministic/manual fallbacks. A stub or canned fixture must never be presented as a live AI result.
2. **Resume briefs:** build on the Slice 1 checkpoint with relevant current sources, what changed, unresolved questions, and the next useful action. Each factual assertion must trace to its source and scope. A gap of seven days does not require clearing the backlog before the app is useful.
3. **Decisions:** record options, recommendation, assumptions, outcome, reason, and supersession/reconsideration trigger when relevant. A superseded decision remains discoverable alongside its current replacement.
4. **Professional drafts:** prepare emails, material lists, project updates, handoffs, and call briefs while preserving the supplied facts and voice. Retain the original; show consequential changes and claims needing review. Drafts are copied/exported for the user; email sending is excluded from this release.
5. **Claim checking:** entity matching is a useful tripwire, not proof of truth. Preserve atomic claims, source quotes, actor, and factual status; visibly flag changed quantity, date, responsibility, certainty, commitment, and omitted material facts. Test requested resources becoming confirmed resources even when names and numbers are unchanged. No promise that a deterministic checker can prevent every invented commitment.
6. **Read-only calendar/ICS:** show real fixed events and busy intervals with provider identity, freshness, timezone, privacy, and connection health. Protect feed URLs and credentials. A missing provider/feed blocks that connection only; sample calendar data must be labeled. Do not imply ICS is a reliable alert route or a write-capable calendar integration without actual evidence.

### Slice 3 — follow-through across work and review

1. **PM digest:** source-linked, freshness-aware read-only summary of explicitly authorized PM information or user-supplied exports. Preserve the company system as the official source. Provide links and missing-context indicators; do not write to, read private local files from, or deploy the existing PM/Field Hub applications merely to populate a demo. If source authorization is unavailable, finish the adapter/import contract and show that connection as blocked rather than inventing live data.
2. **MCP interface:** a narrow authenticated/scoped server over supported Harrison OS capabilities, with documented tools, schemas, bounded results, explicit permissions, and negative scope/authority tests. Start with read/retrieval and only clearly authorized app-owned mutations. No generic shell, unrestricted file access, arbitrary SQL, permission changes, or bypass around normal action approval. Report actual client interoperability separately from server implementation.
3. **Weekly review:** concise useful changes, completed outcomes, upcoming hard commitments, due follow-ups, unresolved decisions, and resume points. Link claims to sources; allow correction, deferral, and deliberate selection. Do not silently reschedule hard dates, convert every idea into a task, punish a gap, or require a lengthy weekly ritual.

### Optional depth; preserve as future scope rather than silently pretending it shipped

The original product also allows later specialist views for drawing revision retrieval, richer field context, document assembly, receipts/expenses, personal administration, goal scenarios, learning/licensing practice, technical experiments, and an optional software Workbench. These reuse the shared records rather than becoming separate miniature apps. They are not a reason to delay Slices 1–3, nor should placeholder buttons imply completion. Record optional gaps explicitly if they are not implemented today.

Do not begin workstation monitoring, a complete drawing-interpretation engine, a permanent agent fleet console, an all-services synchronization mesh, or a wholesale rewrite. Embeddings and broad provider integrations are optional optimizations after exact/full-text search and narrow connections work. A native shell remains an available response to measured phone capability gaps, not something to reject solely because local development uses Windows.

## 4. Shared records, ownership, privacy, and authority

Use a small common model spanning Capture, Commitment/Action, Outcome/Project, Waiting, Person reference, Decision, Source/Attachment, Event reference, Connection, Preference, Checkpoint, and Automation run. Keep relevant source/provider IDs, timestamps, original input, privacy scope, state, and supersession links. Existing tables may be extended rather than replaced gratuitously.

Choose one authoritative owner per record/field. Existing task providers own their existing tasks unless the user chooses a scoped migration; calendar providers own real events; company systems own official project records; Harrison OS owns its captures and explicitly app-owned items. Imported items keep provider IDs, source links, and freshness. A local completion does not imply an external provider write succeeded. Use an actual authorized provider write or open the source application.

Keep Work and Personal scopes consistent across database access, retrieval, AI prompts/summaries, jobs, attachments, exports, notification previews, and MCP results. Derived content carries source IDs and the appropriate restrictive scope. Test with canary content through every relevant output path. An owner being the only user does not remove shared-screen or context-leak risks.

Let the user inspect, correct, export, and delete memories. Define deletion across original content, accepted derivatives, source quotes, search indexes, summaries, caches, embeddings if any, undo history, exports, and backups. Where retention is deliberate, explain it. Ensure a late retry cannot resurrect deleted content. A one-item correction is not silently promoted to a global preference.

Private reversible preparation—saving, organizing, retrieving, summarizing, drafting, and explicitly requested routine reminders—continues within existing authorization. Consequential outward actions require applicable concrete authorization tied to content, destination, recipients, attachments, and relevant state. Material payload changes invalidate approval. Do not add a redundant approval ritual when valid authorization already covers the action.

Incoming email, documents, OCR, web content, attachment instructions, and imported prompts are untrusted data. They cannot grant permissions, alter system policy, trigger privileged tools, or set priorities by themselves. Enforce authority in code, not only in model instructions. Preserve prepared, authorized, processing, confirmed, failed, and outcome-unknown distinctions as applicable. Reconcile uncertain external results before retrying; do not promise universal exactly-once behavior.

Keep credentials and API secrets server-side and out of the public repository. Human login and new account/permission steps remain human-controlled where required; an existing usable authorized connection should not generate a new unnecessary credential request. Missing work-text AI consent is a narrowly scoped data-use question, not a reason to halt all development or use a live private document as a demonstration.

## 5. Time, reminder, offline, and operating requirements

- Keep reminder time, deadline, planned work block, earliest start, and follow-up as separate concepts. Date-only values remain date-only. Preserve source timezone and original ambiguous phrase; initially use America/New_York. Replanning must not silently move a hard deadline or appointment.
- Anchor recurring local reminders to their wall-clock time across daylight-saving changes. Define explicit behavior for nonexistent and duplicated times. A reminder captured only offline is pending sync and not server-scheduled.
- Distinguish local intent/pending sync, confirmed scheduling, policy hold, accepted push/provider request, observed device behavior, and acknowledgement. Permission granted or API accepted does not prove a Lock Screen alert occurred. A service-worker beacon is not proof the user saw an alert.
- Use durable backend jobs and a recoverable local outbox. Do not depend on a closed iPhone web app keeping agents alive or uploading pending captures. Show precisely when opening/reconnecting is required.
- Quiet hours, personal-title visibility, Focus behavior, escalation, exceptions, and real-app session length are user choices. Use one notification policy; routine bookkeeping stays quiet; requested reminders and meaningful changes have clear reasons, deduplication, snooze, and stop.
- Preserve pending captures and notification acknowledgements through session expiry and recovery. Revocation tests affect only the new app, never the user's entire account or existing app sessions. A longer session is convenience, not a substitute for expiry correctness.
- Keep stalled deliveries honest. Runtime termination may prevent recording a failure; show unknown/overdue evidence rather than claiming delivery or a recorded failure. Measure real hosted resource cost and avoid unbounded cron batches.
- Provide authentication, scoped authorization, connection-health indicators, bounded retries/timeouts, cancellation, backups, tested restore, export, and actionable failure recovery. State configurable operating costs and failure behavior when configured limits are reached; do not invent numeric budget settings.
- Use models for language understanding/synthesis/drafting and difficult reconciliation. Use deterministic software for permissions, dates, scheduling, persistence, state transitions, and execution. Validate typed model outputs and source IDs. Model/provider selection remains configuration; chat subscriptions do not establish API credits or access to old assistant memories.

## 6. Existing implementation and evidence to preserve

The following is documentary evidence read on October 31, not a new independent test run. Inspect commits and current repository contents before relying on it.

| Existing component | Reported state | What it does not establish |
|---|---|---|
| Local real Harrison OS application | Slice 1 model, deterministic interpretation, Today, open tasks, Waiting, Projects, one-tap checkpoint, Memory, return view, scope/deletion/export, reminders; 207/207 unit and 11/11 local browser scenarios reported | Not deployed; not proven on iPhone; not Slices 2–3; no real AI integration yet |
| Isolated sample-data spike | Deployed with Access; desktop owner sign-in and one unique capture observed; 98/98 unit and 13/13 local browser scenarios reported | No actual iPhone login/offline/locked-alert result; Shortcut connection still absent |
| Auth incident fix | Per-request JWKS fetch with bounded timeout; client API timeout; regression tests; ported into local main app | Redeploy alone does not prove the cause fixed; preserve and rerun targeted regressions |
| Hosted resource measurements | Real read/write/cron CPU samples; crypto/send probes; no observed kill in those windows | Simulated sends are not evidence that a real alert arrived, and sampled CPU is not a universal guarantee |
| Phone scenarios | Ready for user testing; no result reported | Must stay not tested, failed, or blocked as appropriate; never infer a pass from desktop activity |

The paid-for auth lesson is to avoid sharing an in-flight cross-request I/O promise on this runtime. Port the corrected implementation and tests rather than an older spike version. Preserve owner-versus-Shortcut audience separation and route restrictions. Keep destructive teardown, migration, and existing production resources separate from ordinary implementation.

The prior handoff's fixed DST deadline is evidence planning, not a rule that prevents building today. Tomorrow is November 1, 2026. If practical, create the real daily phone reminder before the transition and record actual observations. Missing a pre-transition baseline limits that specific test; it does not require postponing the application until next year. Deterministic timezone/clock fixtures can be tested now, while actual-device observations remain separately identified.

The existing end-to-end runner has machine-specific external Playwright paths. Make the imported app reproducible from this repository with explicit supported dependencies and documented setup. Do not preserve an accidental dependency on another private project directory.

## 7. Acceptance matrix

For each case record exact code/build, environment, steps, expected and observed behavior, evidence, and pass/fail/blocked/not-tested. Separate code/unit proof, local browser proof, hosted integration proof, real phone proof, and pilot evidence.

| ID | Required outcome | Minimum meaningful evidence |
|---|---|---|
| A1 | Save rough text without required classification; original preserved | Working UI/API and persisted record; measured acknowledgement time |
| A2 | Offline capture survives close/reopen/reconnect with one record | Local browser scenario plus actual installed iPhone scenario; lost-response retry test |
| A3 | Draft and pending work survive first login, normal return, expiry and re-login | Authentication scenarios on actual installed app; no global session revocation |
| A4 | Correction supersedes date/quantity interpretation; idea stays an idea | Adversarial language examples with original retained and no active old commitment |
| A5 | Direct lifecycle and recurrence work without chat | Create/edit/complete/reopen/archive/undo/search; recurrence does not multiply overdue items |
| A6 | Waiting preserves actor, actual promised date, follow-up and ownership | Another person's work is not an overdue owner task; no unsupported “no reply received” |
| A7 | Today explains its recommendation and retains hard dates | User override; changed flexible block leaves real deadline unchanged |
| A8 | Resume after interruption and seven-day gap without cleanup | Current checkpoint/source/next step; synthetic elapsed-time case now, real longitudinal evidence later |
| A9 | Reminder schedules and alerts honestly | Named live route; actual app-closed/phone-locked observation; denied permission/disconnection/unknown-outcome cases |
| A10 | Daily local time, date-only values, DST gaps/overlaps stay intentional | Deterministic timezone tests plus separately labeled real Nov 1 observation if available |
| A11 | Notification tap survives expiry/offline and is acknowledged once after recovery | Pending acknowledgement retained; replay/re-login; distinguish unavailable test path from pass |
| A12 | Current/superseded decisions and scope-aware memory retrieve correctly | Exact/full-text search without AI; sources, dates, replacement links and correction paths |
| A13 | Draft meaning is preserved and consequential mutations exposed | Requested→confirmed, actor/responsibility changes, omitted conditions, unchanged-entity false certainty, quantities/dates |
| A14 | One genuine bounded AI workflow works when authorized/configured | Real API result with typed validation and source context; timeout/error/cancel/fallback behavior |
| A15 | Calendar and PM digest are honestly read-only and current | Real authorized source or explicitly labeled import; provider IDs/freshness; unavailable connector clearly blocked |
| A16 | MCP respects authentication, scope and authority | Actual supported client call if available; wrong-scope/unauthorized-tool tests; no generic execution escape |
| A17 | Weekly review surfaces useful changes without inventing obligations | Source-linked review from shared records; deliberate selection/deferral; hard commitments preserved |
| A18 | Personal canaries do not leak through work outputs | Search, Ask, drafts, attachments, export, notifications, jobs, digest and MCP adversarial checks |
| A19 | Imported malicious instructions cannot trigger privileged actions | Attachment/source content injection case with code-enforced permission boundaries |
| A20 | Delete and export/restore are coherent | Derived-copy/undo/search/outbox retry tests; records, attachments, relationships, scope and restore verified |
| A21 | App is usable on phone and desktop with accessibility needs | 360–430 px, safe areas, keyboard/on-screen keyboard, 200% zoom, screen reader labels, reduced motion; real phone distinct |
| A22 | New app preserves the repository's toolkit and separate existing field apps/resources | Diff/resource checks, relevant existing workflow checks, public-source privacy inspection |
| A23 | Fresh checkout can run and deploy through documented authorized flow | Reproducible dependencies/config examples, migrations, CI or equivalent checks, guarded target resources |

Target measures are hypotheses to measure: about one second for normal local save acknowledgement, about fifteen seconds to useful project resumption, about one minute to useful return after a gap, and roughly under five minutes daily administration. Do not claim time saved without observations. The two-week pilot measures adoption/correction burden/missed follow-ups and remains post-delivery validation; it does not block implementing Slices 2–3 today.

## 8. Today delivery and review contract

1. Inspect the selected main branch, repository instructions, existing toolkit entry points/CI, seeded `harrison-os/` baseline, and open changes. Map the new app path and integration boundaries before editing. Record real remaining scope, not a fresh speculative architecture document. Do not assume a field app exists in this repository.
2. Integrate and continue the seeded Slice 1, its corrected auth/offline/time contracts, and useful regressions. Complete omissions needed by the acceptance matrix. Preserve the toolkit and leave separate production field applications/resources alone.
3. Implement Slice 2 and Slice 3 in bounded parallel tasks with clear owned files/interfaces and safe integration. Do not have multiple writers blindly edit one checkout. Avoid review expansion that consumes the delivery window without resolving a concrete uncertainty.
4. Integrate and verify the complete app, including meaningful cross-slice flows: capture→interpret→action/Waiting→reminder→source-linked resume→draft/decision→weekly review; and authorized calendar/PM/MCP paths. Use sample content in demos. Run appropriate tests once changes are integrated, then fix failures rather than accumulating ceremonial review rounds.
5. Prepare a concrete walkthrough and a concise batched phone test session. Independent implementation continues while device results, credentials, or provider details are pending. Ask only narrow questions that materially affect a connection, data use, privacy policy, or actual deployment.
6. Keep a durable build record of decisions/reasons, exact commits, tests, current evidence, known limitations, and next action. Make ordinary completed controls available; remove dead controls or label unavailable capabilities honestly.
7. Report each slice/capability as **implemented**, **locally verified**, **integrated**, **deployed**, **device verified**, or **proven in use**, with exact evidence. These labels are not interchangeable. A reported pass from another agent is not automatically independent verification.

The target today is the complete coherent app across the agreed slices, with working available integrations and clearly bounded external prerequisites. Do not quietly redefine “complete” as the spike or another plan. Equally, do not invent phone results, a configured provider, authorized work-text AI use, calendar access, production readiness, or two-week pilot success to satisfy the deadline. Surface a specific residual blocker and keep moving on everything else that is authorized.
