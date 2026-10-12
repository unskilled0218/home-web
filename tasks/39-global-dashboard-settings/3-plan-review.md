# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review: `tasks/39-global-dashboard-settings/2-plan.md`, checked against `1-goal.md`, current calendar request ownership, bookmark source discovery, and the proposed aggregate snapshot/save contract. Findings refer to the input plan before this review's edits.
**Health Score:** 90/100
**Trend:** Stable at 90 from the previous PR Review. The previous scope reviewed task 38's implementation branch, so this is not a like-for-like quality trend.

The plan covers global persistence and conflict handling, with two synchronization boundaries needing refinement.

## Findings

### Warning

**R6 — Domain Model Distortion: write replies carry metadata outside the guarded-read contract**

Symptom: Steps 2 and 4 return a full shared snapshot from initialization and preference saves, including integration metadata. The observer contract explicitly captures hooks when an aggregate read starts, while the save path separately accepts and applies its server-confirmed result. It does not explicitly capture guards for POST/PUT or distinguish confirmation of written preferences from authority to apply incidental integration metadata in that reply.

Source: *Domain-Driven Design* — Aggregate Roots and invariant ownership; *The Mythical Man-Month* — Conceptual Integrity.

Consequence: A successful preference save can return metadata captured before an independent service controller adopted a newer source. Accepting the owned save result as wholly authoritative could roll that service backward even though its preference revision is valid. Treating the whole response as stale instead could falsely reject a successfully committed preference write.

Remedy: Capture guarded integration observers for every request that returns snapshot metadata, including initialization POST, successful PUT, and 409 snapshot bodies. Apply the preference confirmation through its own write/read ownership rules, then independently offer each available metadata section to its request-start observer. A stale/deferred service observer must not invalidate a valid preference confirmation. Add deferred-write and migration-result cases with newer service adoption occurring before the reply is delivered.

Evidence: The proposed API snapshot includes both independently versioned preferences and configuration identities, and `public/dashboard-bookmarks.js:170–184` already performs its own source discovery. Suspending only aggregate GETs does not prevent an independent content owner from advancing during a preference write.

**R2 — Change Propagation: connection work can suspend unrelated global preferences indefinitely**

Symptom: Step 4 reference-counts whole aggregate-read suspension around local location/connect/disconnect actions, resuming only after all finish. The goal requires a short automatic cross-browser settings interval and independent connection actions. The current calendar browser request helper at `public/dashboard-calendar.js:171–177` has no transport deadline, and its connect/disconnect operations at lines 245–297 wait on that helper without a separate bound.

Source: *The Pragmatic Programmer* — Orthogonality; *A Philosophy of Software Design* — Information Hiding and Leakage.

Consequence: One stalled calendar operation can hold the aggregate poll suspended, preventing unrelated remote colors, visibility, units, bookmark options, or other integration changes from appearing in that browser. Even a merely slow connection action couples the five-second preference channel to provider-dependent work it should not own.

Remedy: Replace whole-read suspension for integration actions with reference-counted per-service metadata deferral. Continue polling and applying confirmed preferences and other services every five seconds, reject that service's pre-mutation/during-mutation observations, and request one fresh post-action snapshot when its deferral ends. Retain short read suspension around the coordinator's own preference PUT. Bound local service mutation requests and reconcile status after timeout rather than assuming the server did not commit. Test remote preference propagation while a local connection remains pending, overlapping service actions, and deferred metadata delivery after completion.

Evidence: The aggregate GET is deliberately provider-free and already has per-service availability/observer boundaries. Pausing the entire channel is therefore broader than needed to protect a single service's mutation ownership, and the existing unbounded calendar browser fetch makes its impact observable rather than only theoretical.

## Summary

Both findings are addressed in the revised `2-plan.md`, with targeted verification and acceptance criteria. The 90/100 score records the reviewed input plan under balanced deductions: two warnings and no critical or suggestion findings. No implementation code changed; the Quick Test Check was skipped for this documentation-only stage.

The separate current-dashboard store, atomic migration, UTC defaults, revision-checked drafts, per-group application, and actual Firefox/Chromium verification are justified by the goal. Public metadata failure isolation correctly prevents an unrelated integration fault from falsifying preference-save success. No further findings were identified for cognitive overload, duplicated policy, speculative abstractions, or dependency direction at plan level.
