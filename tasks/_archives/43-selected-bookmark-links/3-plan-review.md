# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/43-selected-bookmark-links/2-plan.md` at `0be70be`, checked against `1-goal.md` and the current bookmark, preference-storage, and form boundaries. No implementation review or runtime verification is claimed.
**Health Score:** 94/100
**Trend:** 90 → 94 (+4) from the latest PR Review record; the previous record reviewed task 42 implementation, so this is not a like-for-like quality trend.

The plan is actionable and appropriately scoped, but selected-content capacity needs an explicit policy and moved-link repair needs a concrete user action.

## Findings

### Warning

**Selection availability — queue priority does not reserve cache capacity**

Symptom: `2-plan.md:40-42` prioritizes selected-folder requests and preserves global count/byte limits, while `2-plan.md:43` retains the full available catalog for the picker. It does not define eviction, reserved capacity, or selected-record admission when previously browsed unselected catalog content already consumes the browser budget. Current `public/dashboard-bookmarks.js:116-128,167-172` rejects unloaded-folder work once a folder is budget-limited and admits links in provider order against totals from all retained folders. Request priority alone changes neither rule. A page can fill its cache in Settings, then receive a new confirmed selection for another folder from another browser, or refresh a folder whose selected record appears after unselected records, without making capacity available for the selected content.

Source: *Code Complete* — Defensive programming and explicit invariants; *A Philosophy of Software Design* — Strategic vs. Tactical Programming. The controller must own both demand and admission policy; a scheduling-order patch alone does not establish the selected-content invariant.

Consequence: Saved valid choices may remain unresolved because unrelated unselected records occupy the cache, even when the selected content itself fits the existing budget. The same choices may appear after page reload, making availability depend on earlier picker browsing. Repeated retries or status messages do not repair that local admission problem. Provider truncation is a legitimate explicit limit; starvation by evictable local catalog data is avoidable.

Remedy: Specify a bounded controller-owned capacity transition when confirmed selections change and before admitting selected-folder results. For example, evict no-longer-demanded unselected folder content first, prioritize known selected records within successfully returned results, recalculate totals/limit state, and then admit remaining catalog records within the unchanged count/byte limits. Preserve durable choices and picker checkbox drafts when cached content is evicted, and prevent stale in-flight unselected results from reclaiming protected capacity. Define a precise unresolved state only when selected content genuinely cannot fit or provider limits prevent retrieval. Add tests that fill the cache with unselected records, apply a remote selection in an unloaded folder, and refresh a selected record late in a returned folder; verify selected content becomes visible without a reload, bounds hold, and no preference write occurs automatically.

### Suggestion

**Domain Model Distortion — moved-link repair is promised without a defined interaction**

Symptom: `2-plan.md:44,87` separates durable bookmark identity from its saved folder hint and promises that selecting/saving the same discovered bookmark repairs the hint explicitly. The picker contract at `2-plan.md:50-54` defines checkbox selection, missing entries, Select none, and Save preferences, but does not say how an already-selected bookmark discovered under a new folder becomes a repairable draft record. Matching by bookmark identity means that checkbox may already be checked; rebuilding its record from the catalog on every update would instead alter draft data without explicit user intent.

Source: *Domain-Driven Design* — Ubiquitous Language and invariant ownership; *A Philosophy of Software Design* — Information Hiding. “Selected bookmark” and “repair its discovery location” are distinct operations even though they refer to one identity.

Consequence: Implementers may require an unexplained uncheck/recheck sequence, retain the old hint forever, or silently update hints during polling. The last option conflicts with the plan's explicit-save/draft-preservation rules, while the first two leave the documented moved-link recovery hard to use or ineffective after a cold restart.

Remedy: Define one explicit repair action, such as “Use this folder” for a discovered selected bookmark whose current collection differs from its saved hint. It should update only that existing draft record, mark the shared-preference draft dirty, and persist only on Save preferences. Keep a single picker row per bookmark identity, preserve the old hint on mere discovery, and test discovery without mutation, explicit repair, stale-revision rejection, reload/discard, successful save, and cold-start loading from the repaired hint.

## Assessment

- Change propagation: the planned files belong to the same bookmark-selection/shared-preference change. No unrelated feature work or shutdown remediation is included. Extending the existing revisioned JSON record and sync owner avoids a second persistence protocol.
- Cognitive load: the plan distinguishes durable bookmark identity, folder discovery hints, credential-sensitive configuration ownership, picker drafts, confirmed dashboard policy, and temporary request authorization. These distinctions are justified by current boundaries rather than speculative abstractions. The capacity transition above remains the material missing rule.
- Knowledge duplication: shared structured validation and a single dashboard projection are planned; collection identity extraction explicitly avoids duplicating the tree/result decision. No independent duplicate-policy finding is warranted.
- Accidental complexity: no native browser launcher, generic picker framework, account-wide search service, second polling loop, or new SQL table is proposed. Keeping one request owner is a sound tradeoff despite the richer demand state.
- Dependency direction: the proposed shared data helper can remain side-effect-free and dependency-light, with server/browser boundary adapters consuming it. No required cycle or infrastructure dependency in the preference value model was found.
- Domain fidelity: `null` versus `[]`, source/account-scoped bookmark IDs, explicit empty guidance, and preservation of unavailable choices fit the goal. Partial-catalog and moved-link limitations are stated honestly; the repair interaction should be made equally explicit.
- Quick Test Check: skipped as a production-code check because this is a documentation-only plan. The planned verification includes real popup navigation, SQLite restart persistence, cross-browser conflicts, safe source changes, drafts, and layout. The two finding remedies add focused cases for gaps in that proposed coverage; no test suite was run.
- No `.brooks-lint.yaml` was found; balanced defaults apply. Score calculation is 100 minus one warning at five points and one suggestion at one point. Existing shutdown review warnings remain outside this task.

## Summary

Define selected-content admission/eviction before implementation, then specify an explicit moved-link hint repair action. Otherwise, the plan preserves the current security and shared-settings contracts and provides strong behavioral verification without expanding into another-browser launching. Only this review and the review-history record are committed; `2-plan.md` and implementation code remain unchanged.
