# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/40-home-assistant-wol-settings/2-plan.md`, checked against `1-goal.md` and existing frontend lifecycle, Home Assistant normalization, device APIs, and persistence contracts. No production changes reviewed.
**Health Score:** 89/100
**Trend:** Stable at 89; prior review covered implementation on another task, so scores are not directly comparable.

The plan stays within the requested settings scope, but needs explicit ownership for asynchronous form results and independent refresh progress.

## Findings

### Warning

**R2 Change Propagation — Mutation completions can overwrite a newer dialog session**

Symptom: Steps 2 and 3 guard controller reads and duplicate mutations, but successful mutations unconditionally reset form baselines and clear tokens. The plan does not lock affected fields or define what happens when Settings closes and reopens, or the Wake-on-LAN editor changes, before a mutation completes. Existing `public/dashboard.js` allows dialog closure independently of requests.

Source: The Pragmatic Programmer — Orthogonality; A Philosophy of Software Design — Information Hiding and Leakage.

Consequence: A delayed save or disconnect can erase a newer draft, clear a newly entered secret, move focus into another editor, or display an old result as the current session's action. Controller request generations alone cannot protect DOM session ownership.

Remedy: Capture a dialog session and editor identity for each submitted action. Disable affected fields and editor-changing actions while their mutation is pending, without blocking unrelated settings. Let confirmed controller state update regardless of session, but allow form resets, action messages, and focus changes only for the originating current session/editor. Closing the dialog clears secret input without treating a potentially committed mutation as canceled. Test close/reopen and delayed completion explicitly.

**R2 Change Propagation — A shared refresh batch can stall the healthy integration**

Symptom: Step 3 proposes concurrent reads, one scheduler, and coalescing overlapping refreshes, but does not specify whether a batch must settle before another tick or opening refresh. A slow Home Assistant read could hold the batch even after Wake-on-LAN has completed. The five-second acceptance claim also omits network latency.

Source: The Pragmatic Programmer — Orthogonality; Code Complete — Defensive Programming and Error Handling.

Consequence: Healthy Wake-on-LAN updates can wait for the other API's deadline. Closing and reopening can coalesce with an old read instead of requesting fresh state. This contradicts isolated failures and prompt resumption even though both reads are technically concurrent.

Remedy: Keep one scheduler but coalesce reads per controller. Each tick invokes both independently without awaiting a combined batch before scheduling the next tick. Pause invalidates pre-pause reads; opening/resuming requests fresh state or queues one fresh read after a pending mutation. Apply each response as it arrives. Describe five seconds as a polling interval plus request latency, and test a stalled API while the other continues refreshing.

### Suggestion

**R3 Knowledge Duplication — Browser token validation could drift from backend URL policy**

Symptom: Step 2 requires unchanged normalized-origin checks without specifying the full URL eligibility check. `src/home-assistant.js:30-38` rejects credentials, non-root paths, queries, fragments, and non-HTTP(S) schemes before canonicalizing the origin. Comparing only `new URL(value).origin` would accept an ineligible URL for blank-token guidance.

Source: The Pragmatic Programmer — DRY; A Philosophy of Software Design — Information Hiding and Leakage.

Consequence: Browser guidance may say an empty token is valid for a URL the server rejects, and copying server policy without boundary tests can drift. Importing `src/home-assistant.js` into the browser is not viable because it imports Node crypto.

Remedy: Specify a small browser-only eligibility check for the existing URL contract, use canonical origin comparison only after eligibility succeeds, and leave token reuse authoritative on the server. Add equivalent/default-port/trailing-slash and forbidden URL cases. Do not introduce a broad shared server/browser refactor for this task.

## Summary

Two warnings and one suggestion were accepted and addressed in `2-plan.md`. The revised plan defines session-owned form effects, independently progressing refreshes, and precise URL validation boundaries. The score reflects the original plan; no implementation code changed, and the docs-only Quick Test Check was skipped. No project review configuration exists, so balanced defaults apply.

## Retained Decisions

- Reuse current APIs and encryption without introducing revision protocols, widgets, wake actions, or database migrations.
- Keep existing confirmed device deletion and its audit cascade, with an explicit warning. Ordinary reads and edits preserve history.
- Keep a dialog-scoped integration scheduler separate from active-dashboard synchronization; the screens have no presentation to synchronize while closed.
- Controller seams and real-server browser tests are justified by asynchronous requests and persisted cross-browser behavior. No speculative generic framework or rich domain model is needed for this CRUD task.
