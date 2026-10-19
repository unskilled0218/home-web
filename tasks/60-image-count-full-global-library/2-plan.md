# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Separate complete discovery from bounded manifests](#1-separate-complete-discovery-from-bounded-manifests)
    - [2. Keep every active image URL usable](#2-keep-every-active-image-url-usable)
    - [3. Rotate through the full Global library](#3-rotate-through-the-full-global-library)
    - [4. Show a persistent image count in Settings](#4-show-a-persistent-image-count-in-settings)
    - [5. Verify completeness, recovery, and resource use](#5-verify-completeness-recovery-and-resource-use)
    - [6. Update focused documentation](#6-update-focused-documentation)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Make every eligible image in the configured NFS photo tree available to Global slideshow playback and show image counts clearly in Settings. Target the reported Raspberry Pi 5 with 8 GB RAM and approximately 4 GiB available memory. Discovery must retain metadata rather than image contents, and Global browsers must continue receiving only the current image's metadata.

The current limits are independent: `src/photo-library.js` admits 5,000 directory entries, traverses eight levels, accepts 100 files and 200 MiB of aggregate source bytes, and retains 1,000 tokens. `src/photo-slideshow.js` separately slices to 100 records, and `public/photo-slideshow-data.js` rejects Global counts above 100. Settings currently mixes the count into transient playback status. Fix these connected constraints rather than increasing only one constant.

## Implementation Plan

### 1. Separate complete discovery from bounded manifests

- Refactor `src/photo-library.js` to own one cached complete metadata inventory and one coalesced refresh promise. Give the slideshow a complete-inventory method; retain bounded projections for the existing Local and legacy manifest methods. API reads must reuse the inventory rather than starting independent whole-tree scans.
- Enumerate directories incrementally with async iteration instead of collecting and sorting an entire directory's children. Remove the 5,000-entry cutoff, eight-level completeness restriction, 100-file limit, and aggregate source-byte limit from the complete inventory. Keep root containment, no-symlink traversal, supported extensions, nonempty regular-file checks, and the 20 MiB per-file limit. Apply the existing shared filename validator before admitting Global records.
- Replace the ten-second whole-scan deadline with cooperative batches that yield to the event loop and continue the same traversal until completion. Bound simultaneously open directory handles with an explicit traversal stack; do not retain one descriptor for every ancestor. Revalidate queued directories when opened. A slow but progressing tree must not restart at its first batch every 60 seconds.
- Stage each inventory generation and publish it atomically only after successful complete traversal. Keep the previous generation playable during refresh. Failure must preserve last-good inventory and mark it stale; a successful complete empty scan must clear it. Track loading, completion, discovered supported-file count, eligible count, and exclusion counts separately. A count is authoritative only for a completed scan, and supported-file count means nonempty supported regular files within the per-file size limit before filename eligibility.
- Introduce an injectable metadata budget, defaulting to 64 MiB of conservative accounted record/path/token storage across active, staging, and retained generations. Charge before allocation, bound traversal bookkeeping too, and avoid whole-inventory JSON copies. If the budget is exhausted, discard staging and expose an incomplete/resource-limit state instead of publishing a silently truncated pool. Treat this budget as accounting, not a guaranteed JavaScript heap ceiling; measure actual memory in verification.
- Keep refresh scheduling owned by the slideshow: scan at startup and 60 seconds after the preceding refresh settles, without overlapping work. Add a cooperative library stop/drain hook, attach it through `src/server.js` and `src/shutdown.js`, and account for Local/legacy readers sharing the same work. Stop prevents new scans and closes traversal resources after actual pending filesystem operations settle.

### 2. Keep every active image URL usable

- Replace the global 1,000-entry eviction rule with generation-aware token ownership. Every record in the active inventory must remain resolvable, including records after index 1,000 and the current selection while a refresh is staged. Keep unchanged metadata URLs stable and change URLs when observed size or modification time changes.
- Retain the previous published generation for a bounded grace period of at least 30 seconds to cover metadata polling and image decoding; account for it in the metadata budget. Expire obsolete generations without evicting active records. A failed staging scan must not replace active token mappings.
- Preserve opaque URLs, root containment and symlink checks when opening images, streaming reads, and the eight-stream limit. Never preload image bytes or create tokens for the entire inventory inside a browser response.

### 3. Rotate through the full Global library

- Update `src/photo-slideshow.js` to consume the complete eligible inventory without `slice(0, 100)`. Remove the Global `count <= 100` restriction from `validateSlideshowSnapshot` while retaining nonnegative safe-integer validation, state consistency checks, filename rules, and the 8,192-byte snapshot bound.
- Build name/date/random sequences over all eligible records, using references or indexes rather than cloned metadata. Replace whole-pool `JSON.stringify` comparison with inventory generation/change tracking. An unchanged refresh must preserve the sequence, current image, and rotation deadline; changed inventories must retain the current eligible image where possible.
- Preserve shared server-owned selection, client-free rotation, random-cycle coverage, no immediate random boundary repeat, and existing retry/fallback behavior. Refreshes must not reset an unchanged traversal before later images can play.
- Keep `/api/dashboard/photos/local` capped at 100 validated records and 256 KiB, and keep the legacy manifest bounded rather than serializing the complete inventory. Filter eligible Local records before taking its bounded projection. Local playback remains independent and must not configure or advance the Global cursor. Document this scope distinction explicitly.

### 4. Show a persistent image count in Settings

- Add a compact `GET /api/dashboard/photos/status` response from cached library state in `src/app.js`, with a shared validator in `public/photo-slideshow-data.js`. Include source enabled/available state, scan loading/completion/staleness, last completed supported and eligible counts, and an explicit incomplete/error reason. Keep the payload bounded, validate count relationships, expose no mount paths, and apply existing host/method/cache handling. Register this exact route before opaque-token matching.
- Add a dedicated image-count element under Settings → Images in `public/index.html`. Show the completed eligible count as the Global playable image count, with supported/excluded counts when different. While refreshing or unavailable, preserve the last completed count with a clear stale/loading label; initial unknown must not appear as zero. A completed empty library must show zero.
- Wire one lifecycle-owned status reader through `public/dashboard.js`, using the existing bounded request helper and cancellation conventions. Fetch when Images settings opens and refresh while it remains visible; cancel on close, page hide, and disposal, and refresh on reopen. Counts must work in either settings scope and stay separate from `photo-status`, so image decode errors cannot overwrite them.
- Update `public/dashboard-photos.js` status text and the explanatory Settings copy to describe the full Global inventory and bounded Local projection accurately. Show incomplete scans explicitly rather than claiming every NAS image has been inventoried.

### 5. Verify completeness, recovery, and resource use

- Update `test/photo-library.test.js` and `test/large-photo-library-api.test.js` using existing large-library fixtures. A 7,001-image tree must yield 7,001 eligible Global records, including images past entry 5,000 and index 1,000. Test deep nesting beyond eight levels, unsupported entries before images, and sparse supported files whose aggregate sizes exceed 200 MiB without exceeding the per-file limit.
- Fetch image bytes for early, middle, and final inventory tokens after publication and across unchanged refreshes. Cover replacement/deletion, staging failure, previous-generation grace expiry, budget exhaustion, and active-token retention. Confirm Local/legacy payload bounds and that their reads do not alter Global selection or preferences.
- Extend `test/photo-slideshow.test.js`, `test/photo-slideshow-data.test.js`, and API contract coverage for counts above 100 and complete name/date/random traversal. Use virtual time to traverse all 7,001 records across repeated unchanged refreshes, proving no reset, omission, or premature repeat. Test loading, stale, disabled, complete-empty, excluded-name, and resource-limited states.
- Extend lifecycle coverage for shared scans, event-loop yields, cooperative stop during traversal, descriptor closure, and draining actual pending filesystem promises. Preserve the existing nonzero shutdown result when kernel filesystem work cannot be confirmed complete.
- Extend `e2e/server-photo-rotation.spec.js` and photo fixtures for Global counts above 100, shared selection in two browsers, on-demand image requests, and Local scope isolation. Add browser coverage for the persistent Settings count, refresh/reopen behavior, stale counts, zero versus unknown, and decode errors leaving the count visible. Keep `e2e/photo-display-recovery.spec.js` passing.
- Run `npm run check`, `npm test`, and `npm run test:browser`. Record actual outcomes. Measure RSS/heap and scan duration for the 7,001-image fixture across at least three refreshes and a full virtual playback cycle; verify no image-byte buffering, unbounded generation retention, or cumulative memory growth. Record the baseline and peak rather than treating serialized metadata size as RAM use.
- On the target Raspberry Pi, verify the completed count against an operator-supplied eligible file count, sample a late-library image, observe rotation, and record process RSS plus available memory during refresh. If target access is unavailable, leave this explicitly pending rather than claiming hardware verification.

### 6. Update focused documentation

- Update `docs/nfs-backgrounds.md` for complete Global discovery, count semantics, metadata-budget failure, refresh progress, token lifetime, retained file restrictions, and bounded Local/legacy manifests. Remove obsolete claims that Global playback is limited to 100 images or 200 MiB of source files.
- Update `docs/testing.md` with the large-library and memory verification commands used. Keep operational results separate from fixture results and include the task's implementation record when implementation is performed.

## Acceptance Criteria

- A complete scan of 7,001 eligible images reports 7,001 Global playable files in Settings and `/api/dashboard/slideshow`; all participate in each playback traversal.
- Files beyond the old entry, depth, aggregate-byte, pool, and token limits remain discoverable and streamable. Unchanged periodic scans do not prevent reaching later files.
- Settings shows a persistent count independent of transient playback errors, distinguishes unknown from zero, and marks stale or incomplete results truthfully.
- Global metadata stays within 8,192 bytes, Local manifests stay within 256 KiB and 100 records, and image bytes remain streamed only on demand.
- Scans coalesce, yield, publish atomically, preserve last-good playback on failure, and participate in actual shutdown draining. Active tokens never disappear because a larger inventory was scanned.
- Automated checks pass, measured fixture memory is recorded, and any unavailable Raspberry Pi validation is listed as pending.

## Risks And Decisions

- “All images” means all readable, supported regular files satisfying the retained size and filename rules in a completed traversal. Corrupt or browser-unsupported content may still fail decoding; exclusions and discovery failures must remain visible.
- Use metadata-only in-memory inventory for this task. The 64 MiB accounting guard is an explicit resource failure boundary, not a replacement silent file-count cutoff. If representative libraries cannot fit, revisit a disk-backed catalog rather than claiming a partial subset is complete.
- The reported 4 GiB available memory is context, not permission to preload 4 GiB of source files. Decoded browser images can use far more RAM than compressed files; retain single-selection loading and measure actual process memory.
- Complete NFS enumeration can take longer than ten seconds. Cooperative batching protects responsiveness but cannot cancel a stuck kernel operation; retain actual-promise ownership and the existing shutdown deadline behavior.
- A filesystem can change during traversal, so counts describe the last successfully observed inventory rather than an atomic NAS snapshot. Changes appear on later refreshes.
- Global completeness is the requested playback fix. Local and legacy APIs remain bounded projections, clearly labeled in Settings and documentation.
