# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review: `tasks/38-linkwarden-bookmark-tree/2-plan.md`, checked against `1-goal.md`, existing Linkwarden cache behavior, server status/collection APIs, and configuration mutation paths. Findings refer to the input plan before this review's edits.
**Health Score:** 90/100
**Trend:** 99 → 90 (−9) from the previous PR Review. The previous scope reviewed task 37's implementation branch, so the scores are not a like-for-like quality trend.

The plan covers the requested presentation and recovery behavior, but two lifecycle contracts need explicit transition rules.

## Findings

### Warning

**R6 — Domain Model Distortion: source adoption conflicts with blanket identity rejection**

Symptom: Step 4 requires checking the current configuration identity before applying every asynchronous status, tree, folder, or mutation result. The same step expects initial saved-account discovery, successful connection, successful disconnect, and detected external reconfiguration to establish a different identity. No explicit exception or adoption path separates authoritative source-discovery responses from data responses belonging to an already established source.

Source: *Domain-Driven Design* — Entity lifecycle and Aggregate Roots; *The Mythical Man-Month* — Conceptual Integrity.

Consequence: Applying the blanket equality rule literally could reject the initial non-null configuration ID, a successful PUT's new identity, or an external connection change. Conversely, allowing arbitrary mismatched replies to update identity would weaken the old-account response guard. The implementation would need to invent precedence rules inside the most concurrency-sensitive path.

Remedy: In Step 4, define one authoritative source-adoption operation for the latest owned status request and successful owned configuration mutations. Those responses can adopt a new configuration ID, invalidate prior source work, and clear source-specific state. Ordinary tree/folder responses require exact equality with the adopted ID and a live request generation; mismatches initiate a coalesced status discovery rather than adopting the data response. Keep discovery sequencing and mutation ownership guards explicit, and test startup discovery, same-URL reconnect, disconnect, external changes, and obsolete status replies.

Evidence: The existing status route determines configuration from the server-saved encrypted record, and the planned `configurationId` changes on every successful save. Establishing or changing that identity is therefore a distinct operation from validating a folder response against it.

**R6 — Domain Model Distortion: access-denied content can remain eligible in the server cache**

Symptom: Step 3 prohibits stale fallback after provider 401/403 and clears usable displayed content, but does not explicitly retire denied cache entries or invalidate in-flight writes. In `src/linkwarden.js:179–186`, the current fresh-cache path returns before making a provider request, while refresh failure handling captures the previous cached value locally. Merely excluding authentication/authorization errors from that catch fallback would leave the independent fresh-cache path and late successful work eligible.

Source: *Domain-Driven Design* — Aggregate Roots and invariant ownership; *Code Complete* — defensive programming and complete error paths.

Consequence: After a forced refresh reports access loss, a subsequent normal request within the old 60-second freshness window could return the denied content again. Concurrent requests begun before the access failure could also repopulate the cache or browser tree. This conflicts with the plan's requirement that protected old content not reappear while access is denied.

Remedy: In Steps 3–4, specify access-failure retirement at both owners. A committed-source 401 invalidates that source's cached entries and pending result generations; a folder 403 evicts and invalidates that folder's entry without clearing permitted siblings, while a collection-listing denial retires the tree and source contents. Guard terminal results as well as cache writes, release retired entries' byte/LRU accounting, and clear matching browser snapshots and queued work. A readability-only status response for the same identity must not lift the browser's re-authentication block. Preserve the existing exception for a rejected provisional PUT. Add a fresh-cache → forced denial → normal read sequence and delayed-response tests.

Evidence: The current cache freshness check is independent of refresh error classification, and the existing global cache generation protects writes only when explicitly invalidated. The plan needs a retirement transition in addition to its new error codes and stale-fallback exclusion.

## Summary

Both findings are addressed in the revised `2-plan.md`, including targeted acceptance and verification cases. The 90/100 score records the reviewed input plan under balanced deductions: two warnings and no critical or suggestion findings. No implementation code changed; the Quick Test Check was skipped for this documentation-only stage.

The stable folder identifiers, bounded token recovery, separate renderer/controller, root-expanded Compact policy, and presentation-only fullscreen behavior are appropriate for the existing APIs. Per-stage request/cache limits are tied to the new multi-folder consumer rather than speculative infrastructure. No further findings were identified for unrelated change propagation, duplicated policy, unnecessary abstraction, or dependency direction at plan level.
