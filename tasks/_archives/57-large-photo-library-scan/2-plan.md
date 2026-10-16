# Plan

- [Plan](#plan)
  - [Scope](#scope)
  - [Implementation plan](#implementation-plan)
    - [1. Define entry-budget and pool semantics](#1-define-entry-budget-and-pool-semantics)
    - [2. Correct bounded traversal and cleanup](#2-correct-bounded-traversal-and-cleanup)
    - [3. Add large-directory regression coverage](#3-add-large-directory-regression-coverage)
    - [4. Verify Local and Global consumers and clarify counts](#4-verify-local-and-global-consumers-and-clarify-counts)
    - [5. Document limits and verify the implementation](#5-document-limits-and-verify-the-implementation)
  - [Acceptance criteria](#acceptance-criteria)
  - [Risks and decisions](#risks-and-decisions)

## Scope

Fix the photo-library traversal defect that can return one image from a directory containing 5,000 or more entries. The deployed report describes more than 7,000 images, but the current code confuses exhausting the enumeration budget with abandoning work already admitted. Correct discovery within the existing bounds, protect both Local playback and the Global server-owned slideshow, and make displayed counts explicitly describe a bounded accepted pool rather than a complete inventory.

Keep the existing 5,000-entry per-scan budget, depth-eight bound, 100-photo accepted pool, 20 MiB per file, 200 MiB per manifest, ten-second cooperative scan deadline, 1,000 retained tokens, and eight concurrent streams. Supporting every image in an unlimited export or uniformly sampling all 7,000 files would require a separate discovery/pool contract. This task fixes erroneous first-file truncation and clarifies those limits; it does not claim that a corrected 100-photo pool represents every image on the NAS. This planning stage changes only this document.

## Implementation plan

### 1. Define entry-budget and pool semantics

- Treat `entries` in `src/photo-library.js` as one shared budget for directory entries admitted across the recursive scan. Files, directories, unsupported extensions, and symlink entries all consume admission budget; accepting a photo is a later, separate decision. Never reset the counter for a child directory or increase it because a caller opens another browser.
- Stop admitting new directory entries when the budget reaches 5,000, including an exactly-full directory. Close the iterator through its normal early-break path. Avoid admitting or incrementing the logical counter for an extra 5,001st entry merely to detect exhaustion; ordinary filesystem iterator buffering is not a promise of exact kernel read counts.
- Exhaustion stops new enumeration/descent, not processing of already-collected `children` arrays. Every admitted regular-file candidate in the current directory and its parent frames must still receive the existing validation while the scan deadline permits. An admitted directory may have unenumerated descendants when no budget remains; skip that descent and continue already-admitted sibling files.
- Preserve sorting of each admitted directory batch and the final relative-name candidate ordering. Selection remains limited to the sorted admitted candidates that satisfy file/count/byte limits. Filesystem iteration order can affect which entries enter a capped batch; do not claim a globally alphabetical or random sample of the complete export.
- Reaching a normal entry/depth/pool/byte bound can produce an available partial manifest. Actual discovery I/O errors or deadline expiry retain the existing unavailable result instead of publishing a falsely successful partial scan. Eligible slideshow counts may be lower than the library count because Local/Global projection additionally validates names.

### 2. Correct bounded traversal and cleanup

- Rework the admission check around the `opendir` loop in `src/photo-library.js:42–46` so the last allowed entry is admitted once and enumeration then stops. Remove the processing-loop cutoff at lines 48–62 that currently breaks after its first child whenever enumeration has already filled the global counter. Keep the `visit` depth/budget guard for genuinely new subtree enumeration.
- Continue processing admitted siblings after a nested directory exhausts the remaining budget. Do not treat `entries >= MAX_ENTRIES` as a reason to return out of an existing parent frame that still owns collected file candidates.
- Retain `checkDeadline()` during enumeration and candidate processing, sequential descriptor-owned `open`/`stat`/`close`, directory-handle `finally` cleanup, `O_NOFOLLOW`, `/proc/self/fd` containment verification, regular-file/type checks, and existing byte limits. Budget exhaustion is not permission to abandon open handles, load image bytes, relax deadlines, or start background replacement scans.
- Keep `list()` scan coalescing and its actual promise lifetime unchanged. Preserve metadata-sensitive opaque URLs, stable unchanged-file tokens, bounded token history, stream reservations, and late-scan publication guards in the existing service. Do not introduce per-browser libraries or cursor writes to compensate for a short manifest.
- Preserve the manifest/API schemas and the Local producer-side eligibility projection. This fix requires no SQLite preference change, mount operation, protocol version increase, configurable limit expansion, or new runtime dependency.

### 3. Add large-directory regression coverage

- Extend `test/photo-library.test.js` with independent temporary fixtures at 4,999, 5,000, 5,001, and 7,001 root entries containing small supported regular image files. Under a controlled scan clock and sufficient manifest-byte budget, assert availability, 100 accepted photos, unique/sorted relative names, valid opaque URLs, and readable representative streams. The exactly-full and over-budget cases must fail against the current first-child cutoff; the below-budget case protects the existing path.
- Do not assert that the first 100 names from the entire 7,001-file directory were returned: only the admitted subset is sorted. Use all-valid inputs for the large flat cases so directory-entry ordering cannot turn the count assertion into a sampling-dependent test. Keep fixture files small and register cleanup before populating them.
- Add an exactly-full mixed directory whose first sorted entry is unsupported and whose remaining admitted entries include at least 100 safe images. This must produce a populated pool rather than zero images after inspecting the unsupported first entry.
- Add a nested exhaustion case with a small root batch containing a directory followed by two supported root-level files. Fill that child directory with enough unsupported entries to consume the remaining shared budget. Assert that both already-admitted root files are still returned after the child exhausts enumeration. This protects parent-frame continuation rather than just the flat-directory loop.
- Add a budget-preservation case where the root's admitted batch fills the budget with a directory plus unsupported entries, and the only supported image is inside that unenumerated subtree. Assert an available empty manifest: processing admitted siblings must not restart or bypass the exhausted budget to discover descendants.
- Preserve the existing recursive discovery, symlink/replacement containment, oversized-file, token continuity/change, cooperative deadline, and eight-stream admission tests. Add coalesced concurrent `list()` reads against a large fixture and verify that they share the same scan promise/result rather than doing overlapping work.
- Use the existing injected clock for positive scan-correctness cases so temporary filesystem speed is not confused with expiry of a production NFS deadline; retain independent deadline tests. Await actual scan/stream completion and cleanup, with bounded test deadlines. Avoid wall-clock sleeps, statistical randomness, fixed event-loop-turn waits for filesystem completion, or production methods added only for tests. Share a small fixture builder only if it is reused.

### 4. Verify Local and Global consumers and clarify counts

- Add a focused real-library/API regression, preferably `test/large-photo-library-api.test.js`, using the over-7,000-file fixture, isolated SQLite store, injected service clock, and existing `createDashboardServer` seams. Assert that legacy `/api/dashboard/photos`, `/api/dashboard/photos/local`, and `/api/dashboard/slideshow` observe the corrected bounded pool, with each version's existing validation/body limits intact. Use ordinary eligible names so filtering does not obscure the traversal result.
- Configure the isolated Global service with `order: 'name'` and `interval: 5`, start it before any browser demand, and await its real initial scan. With an accepted pool of 100 tiny images, assert `count: 100`, one valid `current`, and a scheduled deadline. Advance the injected rotation clock by fifteen seconds, below the sixty-second rescan cadence, and prove selection changes. Reading snapshots and Local manifests must not advance/reset the Global revision/cursor/deadline or write shared preferences.
- Confirm Local manifest counts match its eligible records and opaque URLs stream through the existing route. A single `current` field or one image byte request at startup is normal display behavior; it must not be mistaken for a one-photo library. Reuse existing Local-controller, schema, coalescing, stream-limit, and shutdown coverage rather than generating thousands of decoded browser layers.
- Update the success status copy in `public/dashboard-photos.js`, reused by Local playback, from an unqualified “NFS backgrounds loaded” count to wording such as “Using N backgrounds from the bounded photo pool.” Update confirmed-empty wording to say no eligible photos were found within the bounded scan, rather than implying the entire export is empty. Keep disabled/unavailable/stale states and last-good retention distinct.
- Update the NFS help text in `public/index.html` to explain the scan-entry budget, separate 100-photo pool cap, eligibility filtering, and the fact that this is not the total NAS image count. Match affected controller/browser status assertions, including `test/dashboard.test.js` and `e2e/dashboard-home.spec.js`, without changing layout, saved settings, playback timing, request ownership, or transition behavior.

### 5. Document limits and verify the implementation

- Update `docs/nfs-backgrounds.md` and `docs/dashboard.md` to distinguish total files on disk, admitted scan entries, accepted library photos, eligible Local/Global photos, and the single displayed current image. Explain that a scan can be capped even when the export contains more files, unsupported entries consume budget, and random ordering applies to the accepted pool rather than every image in an unlimited export. Preserve dedicated mount/security guidance and document tables of contents.
- Update `docs/testing.md` with the focused large-directory/parent-continuation checks and their controlled-clock/local-fixture design. No real NAS, mount, provider account, credential change, or Wake packet is required. Record scan timings only as local fixture results, not a deployment NFS performance guarantee.
- During implementation, bump `package.json` and both project version entries in `package-lock.json` from `0.17.25` to `0.17.26`, and write actual changes/results/limitations to `4-implemented.md`. The goal and plan remain historical task documents rather than being rewritten as implementation results.
- Run `node --test test/photo-library.test.js test/large-photo-library-api.test.js test/photo-slideshow.test.js test/photo-slideshow-api.test.js test/local-photo-manifest-api.test.js test/dashboard.test.js`, then `npm run check`, `npm test`, and `git diff --check`. Individually syntax-check changed/new JavaScript files because the current glob-based check script does not enumerate every file as a separate Node check. Run existing HTTP/coordinator/process shutdown checks where traversal ownership/cleanup changes warrant it.
- Run relevant browser status/playback cases with `npm run test:browser -- e2e/dashboard-home.spec.js e2e/server-photo-rotation.spec.js`; use the full browser suite when executable dependencies are available and report any failures accurately. Chromium/Firefox were absent during the preceding task; if still absent, mark browser assertions blocked and give the operator `npx playwright install chromium firefox`. Do not install system packages or claim unexecuted browser assertions passed. This planning stage requires document/diff checks only.

## Acceptance criteria

- Exactly-full and over-budget flat directories with enough valid small images return a populated pool of 100 photos, rather than one or zero caused by the processing cutoff. The 7,001-image fixture reproduces the deployment-size class without relying on a live NAS.
- Unsupported first entries and nested budget exhaustion do not discard already-admitted sibling candidates. Enumeration still admits at most 5,000 entries globally per scan, and an exhausted budget never restarts for another subtree.
- File/count/depth/byte/deadline/token/stream limits and containment/symlink protections retain their existing behavior. Concurrent library readers coalesce; actual filesystem work/handles remain owned until completion or an honest existing shutdown deadline outcome.
- Legacy manifests, eligible-only Local manifests, and the Global slideshow expose consistent corrected pool behavior within their existing schemas. The Global server rotates across multiple accepted images without client demand; reads do not change selection authority or shared preferences.
- Settings/help/documentation label pool counts as bounded discovery results, not total library inventory or the number of simultaneously decoded images. Confirmed empty, disabled, and unavailable/stale sources remain distinguishable.
- Required Node/syntax/diff checks pass. Relevant browser checks pass when dependencies exist; missing prerequisites and unrelated existing failures are recorded explicitly.

## Risks and decisions

- The defect is reproducible from the current control flow, but deployment filesystem contents/latency have not been inspected. Other eligibility, size, depth, mount, or decode failures can reduce usable photos independently; a corrected scan is not a promise that all 7,000 deployment files become playable.
- The 5,000-entry budget and 100-photo pool are separate safety/transport contracts, including hard bounds in Local/Global validators and consumers. Retain them for this fix. Raising either limit, rolling through the entire export, or uniformly sampling all files would need coordinated discovery, protocol, and resource-budget decisions beyond the first-file defect.
- Continuing admitted processing performs more valid work than the broken one-file path and can expose a real slow-NFS deadline. Keep cooperative timeout/unavailable/last-good semantics honest rather than disabling the deadline or labeling a timed-out partial result as a successful scan. Existing source retries and shutdown safety remain authoritative.
- A capped scan can miss deeper images or files outside the admitted directory subset, and filesystem iteration order need not be globally stable/alphabetical. Tests and user-facing language must not imply a complete count, complete membership, or uniform random coverage of the export.
