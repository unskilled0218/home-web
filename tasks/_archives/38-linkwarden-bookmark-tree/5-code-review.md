# Brooks-Lint Review

**Mode:** PR Review
**Scope:** All changes on `38-linkwarden-bookmark-tree` relative to `main`, merge base `68c588b`, through implementation commit `bfd6df5`. One implementation commit changes 21 files with 1,090 additions and 83 deletions. The complete changed-file inventory was examined; review depth is sampled around server request/cache ownership, browser source transitions and budgets, tree rendering, responsive integration, and corresponding checks. `package-lock.json` was skipped as generated content.
**Health Score:** 90/100
**Trend:** Stable at 90 from the previous PR Review. The previous scope reviewed this task's plan, so this is not a like-for-like implementation quality trend.

The feature has broad verification and clear module boundaries, but two reproduced lifecycle issues remain.

## Findings

### Warning

**R6 — Domain Model Distortion: an obsolete listing denial can retire a newer source**

Symptom: `src/linkwarden.js:213–221` captures `cacheGeneration` for `listCollections` and checks it on successful results, but its failure path calls `clearCache` for any non-provisional 401/403 without checking whether the captured generation is still current. Response cancellation is awaited before this catch runs, leaving a transition window in which successful reconfiguration can advance the generation and start new reads. The neighboring `getBookmarks` failure handling at lines 235–238 already gates cache retirement on the current generation.

Source: *Domain-Driven Design* — Aggregate Roots and lifecycle ownership; *Code Complete* — complete error-path and state-transition discipline.

Consequence: A denial belonging to the previous account can clear the new account's cache and abort its pending reads with authentication/access-denied reasons. Those new reads can then report a false re-authentication requirement even though their provider never denied them. API post-await configuration checks do not prevent the collateral invalidation of newer work that has already occurred inside the client.

Remedy: Gate `listCollections` access-failure retirement with `generation === cacheGeneration`, just as the bookmark path does. Treat obsolete failures as changed-source results without clearing or aborting the current generation. Add a regression that advances configuration during cleanup of an old denied listing, starts a new-generation bookmark request, then settles the old failure; the newer request/cache must remain usable.

Evidence: A read-only inline reproduction used the real Linkwarden client and an old 401 response whose body-cancel callback performed `clearCache()` and started a new-generation bookmark read. Both the old listing and the newer read ended with `LINKWARDEN_AUTHENTICATION_REQUIRED`; the newer provider request had not returned an authentication failure.

**R6 — Domain Model Distortion: retired folder data leaves a permanent budget-limit latch**

Symptom: `public/dashboard-bookmarks.js:31` derives the global limit flag from any folder's historical `budgetLimited` value. The folder-denial branch at line 153 clears bookmarks, bytes, loaded state, and stale state but retains `budgetLimited` and old truncation metadata. `enqueue` at lines 111–114 blocks every unloaded folder whenever that global flag is set, including explicit `retryFolder` calls.

Source: *Domain-Driven Design* — Aggregate Roots and resource invariants; *A Philosophy of Software Design* — Information Hiding and invariant ownership.

Consequence: If a partially accepted folder later receives 403, its content quota is released but the stale limit marker still prevents loading it again. The renderer offers Retry folder, yet the action performs no request even after access is restored and capacity is available. Other newly disclosed folders can also remain blocked until a full source reset or page reload.

Remedy: Clear retired content's budget/truncation markers together with its byte/count contribution, and make loading eligibility reflect current available quota rather than only historical partial-result flags. Ensure explicit retries with available capacity can enqueue while accepted results remain bounded. Add a combined limit → folder denial → access restoration/retry case, and verify sibling contents and quota accounting remain intact.

Evidence: A read-only reproduction loaded seven folders with 1,500 links each, reaching the 10,000-link budget and partially accepting the last folder. After denying that folder, only 9,000 links remained, but `limit` stayed true and the denied folder was unloaded. Restoring the mock's access and calling `retryFolder` left total request count unchanged at `10 → 10`.

## Quick Test Check

Corresponding tests exist for the changed behavior. Node checks exercise real API/store boundaries, source adoption, mutation ordering, budgets, request deadlines, token recovery, and access retirement. Chromium checks exercise real DOM geometry, disclosure, keyboard operation, saved preferences, focus, fullscreen space release, and unrelated-owner preservation. Controlled provider responses and request observations are appropriate for these concurrency and network requirements; the main assertions verify usable state/output rather than only mock wiring.

The reviewed implementation passed `npm run check`, separate changed-module syntax checks, all 195 Node test entries, and all 54 Chromium cases during implementation. Those full suites were not repeated during this documentation-only review. Both findings were independently reproduced against the reviewed code without adding tests or modifying implementation files. Existing checks cover denial and source change separately, and quota and folder failure separately, but miss the combined transitions above.

Fullscreen restoration is covered through the native fullscreen API and fullscreenchange events. The implementation record accurately notes that synthetic Escape does not invoke headless Chromium's browser-level exit; no direct interactive Escape verification is claimed.

## Summary

Fix generation-scoped listing retirement first, then repair quota eligibility after folder-content retirement. No critical findings were identified; the two warnings account for the 90/100 score under balanced deductions.

This is a large cohesive bookmark feature spanning server APIs, bounded retrieval, browser ownership, presentation, and verification. Stable identifiers, separate controller/view modules, native disclosure, shared URL validation, and presentation-only transitions provide coherent boundaries. No additional findings were identified for unrelated change propagation, speculative infrastructure, duplicated policy, or dependency direction. This stage records findings only and applies no implementation or test fixes.
