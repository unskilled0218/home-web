# Implemented

- [Implemented](#implemented)
  - [Task and version](#task-and-version)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limitations and decisions](#limitations-and-decisions)

## Task and version

- Implemented `tasks/57-large-photo-library-scan/2-plan.md` on the new branch `57-large-photo-library-scan`, created from `49b48f2`. No existing task branch was reused.
- Updated `package.json` and both project version entries in `package-lock.json` from `0.17.25` to `0.17.26`, following the existing task-level patch convention.

## Changes

- Corrected `src/photo-library.js` so enumeration admits the last allowed entry once and then stops at 5,000, without incrementing the logical budget for a 5,001st entry. Processing now finishes the already-collected batch instead of breaking after its first child when that counter is full. Existing depth/budget guards still stop new subtree enumeration.
- Removed the shared-counter processing cutoff that also discarded admitted parent siblings after a nested directory exhausted enumeration. Added an ownership comment distinguishing new admission from finishing admitted work. Existing scan coalescing, deadline checks, sequential descriptor cleanup, containment/symlink checks, byte/count limits, opaque token generation/history, and stream admission remain in their existing paths.
- Added eight library regressions for 4,999/5,000/5,001/7,001-entry flat directories, an unsupported first entry, nested exhaustion with two admitted parent images, exhausted-budget subtree exclusion, and concurrent readers sharing the actual scan promise/result. Positive cases use a controlled clock and small valid PNGs; assertions check counts, uniqueness/sorting within admitted output, URLs, and representative streams without assuming complete-export membership.
- Added `test/fixtures/large-photo-library.js` for reused temporary fixture population and image bytes. Fixture cleanup is registered before population; representative reads explicitly await stream close. The API fixture drains its HTTP/service owners before closing SQLite and removing its temporary root.
- Added `test/large-photo-library-api.test.js` with a real 7,001-image library, isolated SQLite/HTTP server, and an injected Global service clock. It proves a 100-photo pool exists before browser demand, three rotations occur over fifteen seconds, Local/legacy manifests retain their caps, snapshots retain one current image, body limits/no-store headers hold, URLs stream valid fixture bytes, and reads leave shared preferences/Global revision/deadline unchanged.
- Updated shared Local/Global photo status text to describe a bounded pool, including singular/plural success wording and “No eligible photos were found within the bounded scan.” Added a controller regression distinguishing one displayed image from a 100-photo pool and confirmed empty from unavailable state. Updated the affected home browser assertion.
- Updated Images → NFS backgrounds help and `docs/nfs-backgrounds.md`, `docs/dashboard.md`, and `docs/testing.md`. Documentation now distinguishes total NAS files, admitted entries, accepted files, eligible photos, and one current decoded/displayed image; it explains bounded subset/random semantics and cooperative deadlines without claiming a complete export inventory. Dedicated mount guidance remains intact.

## Verification

- Before changing traversal, `node --test test/photo-library.test.js` ran 15 cases: nine passed and six failed. The exactly-5,000, 5,001, and 7,001-image cases returned **1 instead of 100**; the mixed directory returned **0 instead of 100**; nested exhaustion lost both expected root siblings; and the concurrent large scan returned one photo. This reproduces the defect with local fixtures rather than inferring success from code inspection.
- After the fix, `node --test test/photo-library.test.js test/large-photo-library-api.test.js` passed all **16 tests**. The real large-library API scenario supplied the bounded pool and rotated without connected browsers.
- `node --test test/photo-library.test.js test/large-photo-library-api.test.js test/photo-slideshow.test.js test/photo-slideshow-api.test.js test/local-photo-manifest-api.test.js test/dashboard.test.js`: all **70 tests passed**, with no failures, cancellations, or skips.
- `npm run check`: passed on version `0.17.26`. Individually syntax-checked all seven changed/new JavaScript implementation/test/fixture files: `src/photo-library.js`, `public/dashboard-photos.js`, `test/photo-library.test.js`, `test/large-photo-library-api.test.js`, `test/fixtures/large-photo-library.js`, `test/dashboard.test.js`, and `e2e/dashboard-home.spec.js`.
- `npm test`: all **501 Node test entries passed**, with no failures, cancellations, or skips. This includes existing HTTP/coordinator/process shutdown, actual signal probes, terminal Ctrl+C, source isolation, and streaming safeguards. The increase from 490 includes ten new behavioral cases and Node's automatic discovery of the new support-fixture module.
- After the final fixture stream-close wait was added, reran `node --test test/photo-library.test.js`: all **15 tests passed**; the individual JavaScript syntax checks also passed again.
- `npm run test:browser -- e2e/dashboard-home.spec.js e2e/server-photo-rotation.spec.js`: attempted all **64 selected scenarios**; every case failed before assertions because `/home/container/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` is missing. No browser assertion is reported as passing. The full browser suite was not repeated because the executable prerequisite remains absent.
- `git diff --check`: passed. No live NAS, mount command, provider request, credential change, or Wake packet was used for this task's new verification.

## Limitations and decisions

- The fix fills the accepted bounded pool instead of accidentally truncating it to the first file. The entry budget remains 5,000, the pool cap 100, depth eight, per-image/manifest byte limits 20/200 MiB, cooperative deadline ten seconds, token history 1,000, and concurrent streams eight. Eligible Local/Global counts can be lower after metadata validation. No API version, preference schema, mount behavior, or runtime dependency was added.
- A 100-photo pool from a 7,001-image fixture does not establish full-export coverage or uniform randomness across all deployment images. Directory admission can depend on filesystem iteration order before sorting, and capped scans can omit descendants. One current record/image request is normal playback behavior rather than a pool-size measurement.
- Actual deployment NFS contents/latency were not inspected. Local fixture timings demonstrate correctness only; slow or failed production I/O can still reach the existing cooperative deadline and unavailable/last-good handling. Existing scans remain owned until they settle or the existing shutdown deadline reports its outcome.
- Browser verification remains blocked. The operator must run `npx playwright install chromium firefox`, then rerun the focused browser command and full suite as appropriate. No browser or system packages were installed. Actual browser presentation/geometry/decoding assertions remain unverified in this environment.
- Goal/plan/review history, unrelated settings/CA/weather behavior, user configuration, and `todo.md` were not modified.
