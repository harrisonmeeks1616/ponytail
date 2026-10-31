# Drafts and claim checking (Slice 2.4, 2.5)

Turn rough notes into an email, project update, handoff, materials list or call brief, then check the draft
against those notes. Nothing is sent: the user copies the draft. Email sending is not part of this release.

Files: `src/drafts.js` (routes, storage, template, optional AI rewrite), `src/claims.js` (pure claim
extraction and comparison), `migrations/0004_drafts.sql`, `public/views/drafts.js|css`, tests in
`tests/drafts.test.mjs` and `tests/claims.test.mjs`.

## What the user gets

- **Template draft** (always available, not AI): the user's facts, kept word for word (only a capital first
  letter and a closing period are added), arranged under plain headings with a greeting/sign-off for email.
  A cited project adds its saved place (stopped at, open question), open tasks with due dates, Waiting
  (who, status word such as "requested", promised date) and current decisions, each in the record's own words.
  Labelled "Template draft".
- **AI draft** (optional): only when `src/ai.js` reports AI configured **and** consent is on for the draft's
  scope. The material is sent as quoted, untrusted data with instructions to keep every name, number, date,
  condition, hedge and status word. The result must be JSON `{ "body": string }` or the template is kept.
  Labelled "AI draft". If AI was asked for but not used, the screen says why (not set up, not turned on for
  this scope, too slow, service problem, unusable answer).
- **Check before you send**: every body (template, AI or the user's edit) is compared with the material the
  draft was built from. Each flag shows plain words plus the quote from the notes and from the draft.

## Claim check (src/claims.js)

`extractClaims(text)` splits text into clauses (interpret.js sentence rules, then `;` and `, and/but/so`)
and returns `{ text, actor, action, quantities: [{ value, unit, text }], dates: [phrase], status,
conditions: [], hedges: [] }`. Status uses interpret.js `claimStatus` (asked/requested -> requested;
proposed/suggested/might -> proposed; confirmed/agreed/will -> confirmed; done/finished/completed ->
reported_complete; verified/inspected -> verified; negated or conflicting -> unspecified) plus drafting cues
need/please -> requested and could/propose/suggest -> proposed. No cue means `unspecified`; nothing is upgraded.

`compareClaims(sourceText, draftText)` pairs each draft claim with its most similar source claim (shared key
words, numbers and dates) and returns flags:

| type | meaning |
|---|---|
| `changed_quantity` | numbers or units differ (12 sheets vs 14 sheets; "two" equals "2") |
| `changed_date` | date phrases differ (Friday vs Thursday) |
| `changed_actor` | who acts changed and the new actor is not mentioned in the note (Mike will send -> We will send) |
| `status_upgraded` | the draft reaches confirmed / reported done / verified when the note does not (requested -> confirmed, even with the same names and numbers) |
| `certainty_removed` | the note hedges (probably, maybe, about 5) and the draft does not |
| `commitment_added` | the draft promises (will, guarantee, make sure) where the note does not, or adds a promise with no source |
| `condition_omitted` | the note's if/unless/once/pending condition is missing from the draft |
| `fact_omitted` | a fact in the notes has no counterpart in the draft |
| `unsupported_claim` | a draft statement has no counterpart in the notes, or states as fact what the notes ask as a question |

Headings ending in `:`, greetings and sign-offs, and lines with nothing checkable are not claims.

**This is a tripwire, not proof.** It is deterministic word matching. It catches the common meaning changes
listed above; it cannot prove a draft true, can miss a rephrased invention, and can flag harmless rewording.
The UI says so under every check.

## API

All routes need the normal owner identity and the CSRF header for writes. Writes name one scope; `all` is
accepted only by the list.

| Route | Body / query | Result |
|---|---|---|
| `GET /api/drafts?scope=work\|personal\|all` | | 200 `{ drafts: [draft] }`, newest change first, at most 200 |
| `POST /api/drafts` | `{ scope, kind: email\|materials\|update\|handoff\|call_brief, facts? (<=4000), source_refs?: ['item:<id>','capture:<id>','project:<id>'] (<=20, one project), recipient_label? (<=120), title? (<=200), use_ai?: boolean }` | 201 `{ draft, ai: { requested, used, reason? } }` |
| `GET /api/drafts/:id?scope=` | | 200 `{ draft }`, 404 `not_found` |
| `PATCH /api/drafts/:id` | `{ scope, body?, title?, recipient_label?, state?: draft\|reviewed\|archived }` | 200 `{ draft }`; a changed body is re-checked and a reviewed draft returns to `draft` |
| `POST /api/drafts/:id/check` | `{ scope }` | 200 `{ draft }` with fresh flags |
| `DELETE /api/drafts/:id?scope=` | | 200 `{ deleted: 1 }`, then `{ deleted: 0 }` (idempotent) |

Errors (400): `scope_required`, `scope_all_not_allowed`, `invalid_scope`, `invalid_kind`, `nothing_to_draft`
(no facts and no source), `invalid_source_refs` (bad shape, too many, more than one project),
`source_not_found` (missing or in another scope; never echoes content), `invalid_facts`, `invalid_title`,
`invalid_recipient_label`, `invalid_body`, `invalid_state`.

Draft JSON: `{ id, scope, kind, title, recipient_label, facts, source_refs, source_text, body, generated_by:
template|ai, flags: [{ type, message, source_quote, draft_quote, source_value?, draft_value? }], state,
created_at, updated_at, sample }`. `sample` is 1 when any cited record is sample data.

## Scope, privacy and deletion

- Every cited record is read through src/db.js in the draft's scope; another scope's record is a 400.
  The draft's scope is therefore the scope of all its sources. Test: a personal canary never appears in a work
  draft, list, error, event or AI prompt.
- `source_refs` stores every record whose words are in the draft: a cited project expands to the tasks,
  Waiting items, decisions and the checkpoint's capture/item it pulled in. `purgeRef(db, ref)` (also accepts
  `(db, scope, ref)`) returns a statement deleting every draft citing `ref`, so deleting any of those records
  deletes the draft (once the lead wires it into DERIVED_PURGERS).
- Events: `draft_created`, `draft_updated`, `draft_deleted` with ids, scope, kind, state and counts only.
- Injected instructions in facts or sources are kept as text in the draft and quoted in the AI prompt;
  nothing in this module can change items, captures, projects or reminders.

## Not in this release

Sending email; per-flag dismissal; draft export/restore (drafts are not yet in `/api/export`); a stored copy
of the original template after an AI rewrite (the facts and source text are kept and shown instead).
