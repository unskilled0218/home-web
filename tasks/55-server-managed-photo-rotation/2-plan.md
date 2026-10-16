# Plan

- [Plan](#plan)
  - [Scope](#scope)
  - [Implementation plan](#implementation-plan)
    - [1. Define the server slideshow contract](#1-define-the-server-slideshow-contract)
    - [2. Add one server-owned image rotation service](#2-add-one-server-owned-image-rotation-service)
    - [3. Integrate startup, preferences, and shutdown](#3-integrate-startup-preferences-and-shutdown)
    - [4. Expose read-only slideshow state](#4-expose-read-only-slideshow-state)
    - [5. Make browsers follow the server selection](#5-make-browsers-follow-the-server-selection)
    - [6. Add layered regression coverage](#6-add-layered-regression-coverage)
    - [7. Update documentation and verify](#7-update-documentation-and-verify)
  - [Acceptance criteria](#acceptance-criteria)
  - [Risks and decisions](#risks-and-decisions)

## Scope

Move background discovery, image order, and rotation timing from individual browsers to one server-owned slideshow. It must scan and advance while the server runs, even with zero browser connections. New and returning browsers display the current server-selected image rather than restart a local sequence. Preserve existing shared image settings, bounded NFS access, image streaming protections, fallback backgrounds, transitions, captions, and unrelated dashboard behavior.

This task does not add image uploads, server-side image decoding, a permanent image-byte cache, new mount operations, an external scheduler, or durable slideshow history. Browser display and animation remain browser responsibilities. Server rotation starts afresh after a process restart using saved preferences; continuation across server restarts is not required.

## Implementation plan

### 1. Define the server slideshow contract

- Add a browser-safe `public/photo-slideshow-data.js` module containing strict validation for the new compact snapshot and its current-photo record. Allow only bounded relative names, finite modification times, and existing same-origin opaque image paths. Reject external URLs, absolute filesystem paths, malformed timestamps, oversized metadata, and unsupported schema versions.
- Use a versioned snapshot with `version`, `instanceId`, `revision`, `serverTime`, `enabled`, `available`, `loading`, `stale`, `count`, `current`, and `nextChangeAt`. `current` is `null` or `{ name, lastModified, url }`; the accepted photo count remains at most 100. `nextChangeAt` is a server timestamp or `null` when no rotation is scheduled. A bounded opaque `instanceId` changes on process/service restart; `revision` is a nonnegative monotonic selection revision within that instance, not a shared-preference revision.
- Keep disabled, loading, unavailable, and empty states distinguishable. `enabled: false` represents configured disabled NFS; a configured but failed source stays enabled/unavailable. Initial loading/unavailability has no current image. A successful empty scan has `available: true`, `count: 0`, and no current image/deadline. Last-good state retained after a failed refresh is marked stale. A nonempty published pool has a current image, and only pools with multiple images have a rotation deadline. Validate these relationships explicitly so browsers can clear a confirmed empty/disabled background without clearing on a transient outage.
- Increment the selection revision when the current photo changes or is cleared. Status/count/deadline updates can change without selecting a new image. Browsers must process those fields without unnecessarily decoding the same current image again.
- Keep the existing `order` values `name`, `date`, and `random`, and the existing `interval` range of 5–3600 seconds. Do not add another preference schema or force existing installations into random mode.
- Define random mode as a freshly shuffled traversal of the accepted photo pool, using an injectable random source and unbiased production shuffling. Avoid an immediate repeat at a shuffle boundary when at least two distinct photos exist. One-photo libraries may repeat; multiple connections during one interval intentionally share the same current selection.

### 2. Add one server-owned image rotation service

- Add `src/photo-slideshow.js` with explicit `start`, `configure`, `snapshot`, and idempotent asynchronous `stop` operations. Inject the photo library, clock, timer functions, and randomness for tests. Construction alone must not scan, arm timers, or read preferences.
- On start, scan the prepared photo source and choose an initial image immediately after a successful scan. Maintain one bounded cached manifest and one rotation cursor/shuffle bag for the installation, not one per client. Pass configured enablement separately from preparation availability so a failed mount is not reported as an intentional disable.
- Refresh the source at startup and every 60 seconds while enabled, regardless of connected viewers. Use at most one active scan, one scan/retry timer, and one rotation timer. Coalesce overlapping refresh work and never launch a replacement scan while an earlier scan is still executing. GET requests must not initiate these service scans.
- Keep rotation independent of scan duration: while a refresh is pending, continue selecting from the last successful pool. Missing/unavailable sources retry on the bounded scan cadence; a disabled or unsuccessfully prepared NFS source remains unavailable until server configuration/restart, without remount attempts.
- On a successful rescan, retain the current image and deadline if its identity remains valid, update future membership/order without jumping backward, and choose a replacement if the current image disappeared. A successful empty result clears the current selection. A failed refresh retains the last successful pool/current selection with `stale: true`; distinguish this from a confirmed empty library and first-load unavailability.
- Continue name/date order with the existing sort semantics. In random mode, shuffle on initial load, exhaustion, or a material pool/order change, not on every metadata poll or unchanged rescan. Only the service advances the cursor.
- If the event loop is late, advance once and schedule the next full interval from the actual transition time; do not replay every missed interval in a catch-up loop. With zero or one accepted image, do not create a needless rotation loop; discovery retries/rescans must still run when appropriate.
- Preserve `src/photo-library.js` limits: 5,000 entries, depth eight, 100 accepted images, 20 MiB per image, 200 MiB per manifest, 1,000 retained token entries, and eight concurrent streams. Keep symlink, root containment, regular-file, and MIME checks. Do not load all image bytes into memory just to maintain the slideshow.
- Make opaque image URLs change when observed file metadata changes, while leaving unchanged-file URLs stable across scans. Bind default token generation to relative path and observed modification/size metadata, retain bounded token history, and keep absolute paths private. This lets a replaced image at the same filename be decoded as a new selection rather than silently reused from the browser's decoded-image cache.

### 3. Integrate startup, preferences, and shutdown

- In `src/server.js`, create the slideshow after NFS preparation and photo-library creation, load the confirmed shared `order`/`interval` preferences once, attach it to the shutdown coordinator, and inject it into `createDashboardServer`. Start background work only after the HTTP listener is ready and startup has not been canceled, following the existing weather-service ownership pattern.
- Treat preference-read failure honestly: do not start rotation from invented authoritative defaults if an initialized record is corrupt/unavailable. Expose service unavailability and allow a later valid confirmed configuration to establish operation. Uninitialized stores may use the same normalized defaults as the dashboard preview without writing a preference record.
- In `src/app.js`, notify the service after successful preference saves and initialization, using the committed preference result. Conflicts, invalid input, failed persistence, and unrelated API requests must not reconfigure it. The notification must be synchronous, side-effect-bounded configuration, not an awaited filesystem scan or an extra preference write; notification failure must not relabel an already committed save as uncommitted.
- Compare only `order` and `interval` inside service configuration. Unchanged settings, unit/widget/layout saves, image presentation changes, and ordinary settings polls must not reset the selection, rescan the share, or rearm an unchanged deadline. An interval change keeps the current photo and schedules the next change from the commit/configuration time; an order change rebuilds the sequence and publishes its initial selection immediately.
- Extend `src/shutdown.js` to stop/drain the slideshow alongside admitted HTTP/weather work before SQLite closure and successful shutdown reporting. Handle resources attached while startup is already stopping, repeated shutdown, startup failure, and global deadline expiry. Cancel timers immediately and reject publication from late generations.
- Drain actual outstanding scan work and close filesystem handles through the existing library cleanup paths. Cooperative scan deadlines and generation checks are not proof that a stuck NFS operation has ended; retain the coordinator's existing unsafe-cleanup/nonzero outcome on deadline expiry instead of claiming success or launching replacement work.

### 4. Expose read-only slideshow state

- Add `GET /api/dashboard/slideshow` in `src/app.js`, behind existing trusted-LAN, Host, and Origin checks. Return only the bounded snapshot with `Cache-Control: no-store`; unsupported methods return 405. An absent injected slideshow service returns an explicit 503, not a newly started request-owned slideshow.
- Snapshot reads must not touch NFS, advance selection, create a new random sequence, write SQLite, or depend on the request's browser preferences. During initial scanning return the service's loading state promptly. Represent optional disabled/unavailable photo sources through the documented snapshot state without breaking other widgets.
- Keep `/api/dashboard/photos` and opaque `/api/dashboard/photos/:token` streaming compatible for existing callers. The manifest endpoint remains a legacy library operation; the updated dashboard no longer uses it for ordering or startup discovery. Do not return filesystem paths or introduce a browser-controlled “advance” endpoint.
- Preserve existing stream admission/draining and no-cache image serving. Test concurrent snapshot reads and image requests without changing the server's sequence or bypassing stream limits.

### 5. Make browsers follow the server selection

- Refactor `public/dashboard-photos.js` into one snapshot follower. Replace browser-side `orderPhotos`, index advancement, shuffle, and interval-based image choice with reads of `/api/dashboard/slideshow`. Remove the local `replace`/sequence path if no production callers remain, and update its tests rather than retaining a second hidden authority.
- On initial load, resume from document visibility changes, reconnect, and persisted-page restoration, fetch the current server snapshot immediately. Render its current image after decoding; never start at the first local manifest item or reset server state. Use `instanceId` plus selection revision/photo identity to reject obsolete snapshots and decode completions and to accept a fresh server instance safely.
- Maintain one in-flight metadata read and one polling/retry timer while visible. After each settled response, schedule from `nextChangeAt - serverTime`, with a 250ms minimum and a five-second maximum; use five seconds for loading, unavailable, stale/no-deadline, and request failures. Client wall-clock differences must not determine which photo is current. A scheduled wake only fetches server state; it must not choose an image locally.
- Bound response-body size to 8 KiB and metadata request duration to ten seconds, including body consumption. Bound decode attempts and retire late work when selection changes or the controller is disposed. An unchanged snapshot must not cancel/restart an ongoing decode of that same image or replay a transition.
- On transient metadata failure retain the last successfully decoded background, report stale/unavailable status, and retry without a local random fallback. A decode/image-stream failure keeps the prior good image and retries with backoff or waits for the next server selection. Do not loop immediately through all images, send client-driven skip commands, or let one browser's failure mutate the shared sequence. Clear the photo on an authoritative empty/disabled snapshot, not merely on a network failure.
- In `public/dashboard.js`, keep the existing photo renderer, captions, blur/color, opacity, animation/duration, and reduced-motion behavior. Split presentation updates from sequence ownership so saved presentation changes can update the current background/caption without resetting the server cursor or adding another polling owner. A refreshed snapshot for the same image must not replace DOM layers or restart transitions.
- Update `visibilitychange`, `pagehide`, `pageshow`, and startup handling to cancel/pause browser work while hidden, resume with one immediate read, and avoid duplicated timers or late decoded layers after suspension. A hidden or disconnected browser must have no influence on server rotation.
- Keep photo-caption layout updates DOM-only. Preserve fullscreen widget hiding, Custom layout geometry, dirty preference drafts, clock/calendar/weather/bookmark/Home Assistant ownership, and pending Wake actions.

### 6. Add layered regression coverage

- Add `test/photo-slideshow.test.js` with injected clocks, scan promises, and random sequences. Prove startup discovery and several rotations occur with zero clients; first reads observe the already advanced selection; reads do not advance or scan; random cycles are bounded/nonrepeating at boundaries; name/date modes, late timers, single/empty pools, interval/order changes, and no-op configuration behave as specified.
- Test slow/overlapping scans, initial failure, recovery, stale last-good manifests, successful empty results, removal/replacement of the current image, unchanged rescans, changed image identity, stop during a scan, and late completion after stop. Assert bounded timers and actual drain ownership, not just callback invocation.
- Extend `test/photo-library.test.js` for stable unchanged-file tokens and changed metadata producing a new opaque URL, while retaining path/symlink, budget, old-token, and concurrent-stream protections.
- Add `test/photo-slideshow-api.test.js` using the real server, SQLite store, injected service clock, and safe temporary photo fixtures. Verify the compact contract, no-store/method/Host/Origin rules, absent-service errors, read-only snapshots, preference initialization/saves/conflicts, and correct confirmed configuration without resetting on unrelated saves.
- Add pure snapshot-validation tests in `test/photo-slideshow-data.test.js`. Cover nullable states, oversized bodies/names, unsafe URLs, invalid revisions/timestamps, and impossible loading/empty/current/deadline combinations.
- Rewrite the photo-controller cases in `test/dashboard.test.js` for server-following semantics. Cover old-instance/out-of-order responses, delayed decodes, same-selection deduplication, fresh instance adoption, last-good retention, bounded retries, ten-second deadlines, visibility pause/resume, disposal, and persisted-page restoration. Use fake clocks and complete snapshot fixtures rather than statistical randomness or wall-clock sleeps.
- Extend `test/shutdown.test.js`, `test/http-shutdown.test.js`, and `test/server-shutdown.test.js` as applicable to prove the new production owner starts without browser demand, drains alongside HTTP, prevents successful shutdown while scan work is unconfirmed, and does not keep a stopped/replaced development child alive.
- Add `e2e/server-photo-rotation.spec.js` with a real app/service, injected server time/randomness, temporary valid PNG fixtures, and explicit browser polling time. Advance the server before opening a page, close all pages and advance again, then reopen and verify the server-selected photo is decoded and shown. Connect two isolated browsers and verify they converge without requesting a reset; suspend one, advance, and verify resume adopts the current photo rather than replaying missed images.
- Cover no duplicate transition for an unchanged snapshot, server restart/instance change, one-photo/empty/unavailable sources, failed decode retaining the last good background, preference updates, captions, and solid-background fallback. Reuse existing layout/fullscreen/integration scenarios to protect unrelated request owners and geometry.
- Update all affected `/api/dashboard/photos` browser fixtures and request-count assertions in `e2e/dashboard-home.spec.js`, `e2e/background-display-options.spec.js`, and other matching tests to model the new compact endpoint and its expected polling cadence. Distinguish ordinary metadata polling from forbidden extra scans, image re-decodes, timer replacement, and unrelated provider requests.

### 7. Update documentation and verify

- Update `docs/dashboard.md` and `docs/nfs-backgrounds.md` with server-owned rotation, 60-second discovery cadence, no-viewer behavior, shared current selection, browser polling/resume, random-mode guarantees/limits, failure semantics, and fresh process-restart state. Remove obsolete claims that every browser owns rotation or that files require page reload to be discovered. Preserve dedicated NFS mount/security guidance and maintain tables of contents for document headers.
- Update `docs/testing.md` where needed for new focused commands and deterministic server-clock browser fixtures. Keep README changes minimal and only if its existing behavior summary becomes inaccurate.
- Run focused service, schema, API, library, controller, and shutdown tests, then `npm run check`, `npm test`, `npm run test:browser`, and `git diff --check`. Syntax-check new browser/test files explicitly because the existing check script does not enumerate them individually.
- If Playwright Chromium remains absent, report browser verification as blocked and provide `npx playwright install chromium` for the operator; do not install system packages or claim unexecuted browser assertions pass.
- During implementation, bump `package.json` and `package-lock.json` from `0.17.23` to `0.17.24` following the existing task-level patch convention, and record actual results/limitations in `4-implemented.md`. This planning step changes no implementation or version files.

## Acceptance criteria

- The running server discovers photos and advances the saved ordering mode on the saved interval without any connected browser. Random mode does not restart from a fixed initial choice for every connection.
- Opening, reconnecting, resuming, or adding a second browser observes the current shared server selection without advancing/resetting it. Visibility changes and browser closure do not pause the server owner.
- Name/date/random modes and interval remain shared persisted preferences. Unrelated saves and repeated snapshots do not reset the current image, timer, transition, or request ownership.
- Browsers render only the server-selected image, retain the last good image during transient failures, and recover through bounded polling. No client-side random sequence remains active.
- Startup/background scans are coalesced and bounded; current selection and URLs update safely when source files change. Existing file/byte/depth/token/stream and trusted-LAN protections remain enforced.
- Empty, single-image, disabled, stale, and recovering sources have explicit behavior without tight loops, leaked timers, uncontrolled memory growth, or broken widgets. Shutdown does not report successful cleanup while work remains unconfirmed.
- Captions, animation/reduced motion, presentation controls, fullscreen preferences, Custom geometry, dirty drafts, and unrelated integration behavior retain their existing contracts.
- Required Node/syntax checks pass. Browser tests pass where dependencies are available; any environment blocker is documented explicitly rather than treated as a pass.

## Risks and decisions

- “Random whenever connecting” means joining an independently advancing shared random slideshow, not forcing a different image for every HTTP request. Two connections during the same interval can legitimately see the same image; one-photo libraries cannot provide distinct choices.
- Randomness applies only to the library's existing bounded accepted pool, not every file on an unlimited NFS export. Expanding those safety limits or scanning the entire share is outside scope.
- Retain shared `name` and `date` modes rather than overriding the user's saved order. Default `random` mode uses a shuffled traversal for variety, not a new shuffle on connection.
- Rotation state is in memory and restarts with a fresh instance/selection after server restart. Persisting cursor/history would add database writes and an upgrade contract not required by this goal.
- Five-second-capped metadata polling avoids introducing persistent SSE/WebSocket connections and their shutdown/admission costs. Images are fetched only when needed for display; “load on server” does not require downloading/decoding all image bytes when no viewers exist.
- Metadata refresh failures and confirmed empty libraries are different. Preserve last-good state only for transient failures; never silently replace corrupt shared preferences with defaults or keep showing a removed source as freshly available.
- NFS scan deadlines remain cooperative. The service must not mistake a canceled wait for canceled kernel/filesystem work or create an accumulating set of abandoned scans. Existing global shutdown safety policy remains authoritative.
- The legacy manifest endpoint stays compatible, but the updated browser's selection authority is exclusively the compact server snapshot. Do not add a fallback that silently returns to client-owned rotation when the new service is unavailable.
