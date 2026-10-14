# Implemented

## Result

Implemented task 42 on the new branch `42-safe-server-shutdown`. Version changed from `0.17.11` to `0.17.12` in both package manifests. Production Docker packaging and `start`/`start:lan` commands remain unchanged. No dashboard features, `todo.md`, existing core/log artifacts, system packages, or container privileges were changed.

## Changes

- Added a side-effect-free shared lifecycle budget module and a testable shutdown coordinator. Application shutdown has one promise, a five-second connection grace, and a 30-second overall deadline. Cleanup failures and forced termination retain nonzero status.
- Installed signal and IPC ownership before asynchronous bootstrap and side-effectful config loading. Startup checks stop intent between phases; constructed resources are registered individually. IPC control readiness prevents a development stop command from arriving before its handler exists. IPC owner loss uses the same shutdown path.
- Tracked admitted HTTP-handler promises independently from sockets. Admission closes immediately, idle connections close, and remaining owned connections close at the grace deadline. SQLite closes only after startup and store-using handler/weather work settle; unsafe cleanup does not close it beneath runnable work.
- Extended the existing NFS command seam with immediate preparation-child ownership. Actual child exit is tracked separately from operation settlement; denied signals, missing ownership, or live helpers cannot authorize successful cleanup or replacement startup. No real mount/unmount command was run for verification.
- Replaced native Node watch mode with a dependency-free metadata-polling supervisor. It scans the planned source/config scope every 500ms, coalesces edits, controls one direct child through IPC, and waits for shutdown and exit before replacement. Recoverable application failures wait for a new edit without retry loops; only child readiness clears remembered failure. Cleanup/spawn/control failure ends recovery nonzero. Budget-file changes require supervisor relaunch.
- Documented direct commands, npm forwarding limitations, lifecycle deadlines, optional NFS prerequisites, reload disposition, and distinctions between terminal, OS-signal, and IPC verification.

## Evidence-driven adjustments

Private-CA process testing found that Node `v24.21.0` populated `NODE_EXTRA_CA_CERTS` from the native env-file flag but did not trust the supplied private CA. Development therefore parses `.env` afresh with Node's `parseEnv()` into a child-only environment before spawn, retains the native child env-file flag, and lets original inherited environment values win. It never writes file values into the supervisor environment. Actual private-CA HTTPS trust passed after adding the CA and failed again after removing it. Normal launch commands are unchanged; documentation identifies the explicit startup-environment requirement on affected runtimes. New development env/reload assertions reside in `test/server-shutdown.test.js` and `test/dev-supervisor.test.js`, while existing `test/env.test.js` remains compatible.

A fixture using concurrent loopback fetch mutations stalled during early verification. It was replaced with deterministic request-stream dispatch through the real HTTP boundary; unfinished upload, keep-alive, and Wake socket cases still use real connections. Deferred waits now have explicit short deadlines. A separate IPC-disconnect test exposed that this Node runtime emitted child exit and stream end without emitting the parent's `close` event after parent-initiated disconnect. The process-test fixture now awaits exit plus stdout/stderr end explicitly. Focused disconnect tests passed in about 0.4 seconds, and the final full Node suite completed in about nine seconds.

## Verification

- Runtime: Node `v24.21.0`, npm `11.19.0`, `/usr/bin/node`, Linux UID/GID 1000.
- `npm run check`: passed. Also syntax-checked each `src/*.js`, `public/*.js`, and new `scripts/dev*.js` entry individually.
- `npm test -- --import=/tmp/opencode/task42-test-watchdog.mjs --test-timeout=10000 --test-reporter=spec`: 290 tests, 288 passed, two skipped, zero failures/cancellations; about 9.0 seconds. The external temporary watchdog bounds an unexpectedly stalled runner and is not part of repository code.
- `PLAYWRIGHT_PORT=43218 npm run test:browser`: all 81 browser tests passed in 45.8 seconds.
- Focused lifecycle tests covered shared shutdown ownership, startup interruption, HTTP admission, incomplete uploads, keep-alive, post-socket Wake audits, queued integration writes, independent cleanup rejection, SQLite ordering, forced deadlines, and simulated NFS timeout/denied-termination ownership.
- Development tests covered metadata add/change/delete, excluded paths/symlinks, missing env files, inherited precedence, syntax/config recovery, unchanged failures without retry, corrections observed before child exit, save bursts, startup/restart stop races, control readiness, IPC loss/failure, readiness-based status reset, and shared deadline ordering.
- Real disposable PTY Ctrl+C passed for normal and direct development launch: exit 0, immediate port reuse, owned PIDs gone, no native assertion/segfault, and no new core artifact in their temporary trees.
- npm-wrapper PTY Ctrl+C still reported `EACCES` and nonzero wrapper status. Its owned processes exited and the test port was released, but silent npm shutdown is not claimed fixed.
- Userspace owned-child SIGINT and SIGTERM probes emitted `EACCES` and returned false. Those two delivery tests explicitly skipped; IPC and terminal tests are not substitutes labeled as successful userspace signal delivery.
- `git diff --check`: passed.

## Remaining environment limits

Use `node scripts/dev.js` in this restricted environment. Clean npm forwarding additionally requires operator-controlled ordinary owned-process signal permission. Mount-mode NFS likewise requires permission to terminate an unresponsive preparation helper; disabled or safely pre-mounted NFS avoids that child. Project code does not grant these permissions or claim guaranteed cleanup of a frozen child when both IPC and OS termination are unavailable.

The interrupted early test runner left PIDs `28328` and `28335` stalled in the obsolete queued-mutation fixture. An attempted ordinary SIGTERM was denied; both remained present at the final targeted PID check. These are verification leftovers requiring an authorized operator to stop them, not successful shutdown acceptance. They were not hidden or reported as cleaned up. Final corrected fixtures passed, used isolated data, and verified their own process/port cleanup. No unrelated older runners or services were stopped.

Implementation is committed locally through the requested workflow. No push or merge is performed.
