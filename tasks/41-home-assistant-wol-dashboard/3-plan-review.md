# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/41-home-assistant-wol-dashboard/2-plan.md` at `e98753e`, checked against `1-goal.md`, shared preferences, integration controllers, Home Assistant response projection/token storage, and frontend draft/lifecycle behavior. No implementation changes reviewed.
**Health Score:** 89/100
**Trend:** 95 → 89 (−6) from the previous PR Review; that review covered another task's implementation, so scores are not directly comparable.

The plan covers the requested dashboard behavior, but read-only polling must avoid control-token side effects and controller ownership should have one runtime path.

## Findings

### Warning

**R2 Change Propagation — Display polling can invalidate unrelated control clients**

Symptom: Step 3 polls the existing device endpoint every 30 seconds and discards controls only in the browser. `src/app.js:198-222` still issues a fresh control token for every returned control on every device response, including cached snapshots. `src/home-assistant-controls.js:3-15` caps storage at 10,000 tokens and evicts the oldest entries; tokens otherwise last ten minutes. With 600 controls, one dashboard's 20 reads during that lifetime already issue 12,000 tokens, before other clients contribute.

Source: The Pragmatic Programmer — Orthogonality; Software Engineering at Google — Backward Compatibility.

Consequence: A read-only dashboard can evict unexpired tokens held by existing API clients and make their actions fail with HTTP 404. Multiple browsers amplify this interference even though the new UI never submits a control action.

Remedy: Add an explicit display-only projection to the existing device GET, such as `?controls=0`, that does not call the token issuer. Use it for picker and dashboard snapshots. Preserve the default full response for existing clients and the existing connect response. Share display-field projection rather than duplicating it, and test repeated display reads against a deliberately small token store to prove an existing token remains resolvable and storage does not grow.

### Warning

**R4 Accidental Complexity — Test-only fallback creates two controller lifecycles**

Symptom: Step 3 retains a private owned-controller/poller path in `createIntegrationSettings()` expressly for isolated tests, while the actual dashboard injects externally owned controllers. Existing `public/dashboard-integration-settings.js:98-123` owns pause, polling, and disposal; the planned injected path must deliberately bypass those same operations.

Source: Refactoring — Speculative Generality; The Art of Unit Testing — Test Seams.

Consequence: Closing Settings means stopping reads in one path but retaining them in the other. Tests can pass against the old private-controller path while missing broken dashboard refresh or accidental disposal in the real shared-controller path. Future lifecycle changes require maintaining behavior with no production consumer.

Remedy: Require the two controllers as explicit dependencies of Settings. Let the coordinator own their lifecycle and the poller in every production and test setup. Settings owns only subscriptions, form drafts, event/session guards, and secret clearing. Update isolated tests to construct real controllers with fake fetch/timers and inject them; test coordinator-plus-Settings ownership without a private fallback. Keep `onChange` backward compatibility for existing controller callers.

### Suggestion

**R3 Knowledge Duplication — Previous-schema compatibility needs one decoder**

Symptom: Step 1 specifies a previous-schema decoder in `src/dashboard-preferences.js` and separate exact-schema handling for browser cache decoding, but gives no shared owner for that compatibility rule. Both environments already consume `public/dashboard-helpers.js`; the existing strict field/type rules live there.

Source: The Pragmatic Programmer — DRY; A Philosophy of Software Design — Information Hiding and Leakage.

Consequence: Separate copies of the old-field list and compatibility validation can diverge, accepting a browser record that the server rejects or silently normalizing corrupt stored values during a later schema change.

Remedy: Put a single pure stored/cache compatibility decoder beside preference validation in `public/dashboard-helpers.js`. Call it from the database reader and browser-cache reader. Recognize only complete current-schema records or complete valid previous-schema records; supply the empty selection field only for the latter. Keep strict API-write validation and permissive legacy browser initialization distinct. Test corrupt and valid previous records through both callers.

## Summary

Two warnings and one suggestion were accepted and addressed in `2-plan.md`. The revised plan isolates display reads from token issuance, gives controller lifecycle one owner, and centralizes stored/cache schema compatibility. The score describes the original plan; the docs-only Quick Test Check was skipped, and no runtime tests or implementation changes were performed.

## Retained Decisions

- Existing origin-scoped selection IDs correctly separate selection identity from configuration freshness; no raw IDs, token persistence, or extra selection store is needed.
- Independent five-second status/list polling and a demand-driven 30-second device reader are justified by two active consumers and asynchronous source changes. Do not turn them into a generic event framework.
- Revision-aware saves, dirty-draft preservation, same-source stale snapshots, manual per-device Wake requests, and explicit uncertain outcomes remain appropriate.
- Real-server browser tests with fake Home Assistant and wake delivery seams cover persistence and behavior without accessing external integrations or sending UDP packets.
- R1, R5, and R6 scans found no additional evidence-backed plan findings. Composition-root wiring, display DTOs, and feature-related edits across several files are not defects by themselves. No `.brooks-lint.yaml` exists; balanced defaults apply.
