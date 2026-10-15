# implemented

## Outcome

Implemented on the new branch `47-npm-terminal-shutdown-exit`, version `0.17.16`. Fixed the release-blocking test contract: npm's intentional SIGINT termination is accepted only when independent evidence proves successful development application cleanup. Required terminal Ctrl+C coverage now applies only to direct development and `npm run dev`. Production SIGTERM/IPC behavior and the existing server SIGINT handler remain unchanged.

## Diagnosis

Baseline `node --test --test-name-pattern='terminal Ctrl' test/server-shutdown.test.js` reproduced the reported npm failure: normal/direct development cases passed, while npm returned Python wait status `-2` instead of the asserted zero. Environment: Linux, Node `v24.21.0`, npm `11.19.0`, Python `3.12.3`.

Test-only per-process evidence confirmed npm terminates by SIGINT while both `scripts/dev.js` and `src/server.js` exit normally with code zero. Their recorded process groups matched the terminal foreground group, and the server emitted `{ code: 0, cleanupSafe: true, forced: false, failure: null }`. No fallback fired. This is a wrapper/application contract mismatch, not evidence that the dashboard crashed. Installed npm's documented-in-source signal forwarding/re-emission behavior was inspected during planning; the wrapper's signal alone is not used to infer application success.

A negative integration case demonstrates why independent evidence is necessary: a temporary copied server closes its actual SQLite store and then throws from that cleanup operation. npm still returns `-2`, but server and supervisor both exit `1`, the lifecycle result reports unsafe cleanup, and the success assertion rejects the run. Production source files are not modified by that injection.

## Changes

- `test/fixtures/terminal-shutdown.py` now separates immediate-child exit from PTY EOF, continues draining output after wrapper exit, preserves raw wait status, and reports normal exit code, signal, timeout, drainage, and reaping separately. Timeout remains a failure even if its cooperative child subsequently exits. It waits only for its owned child and never signals a process group.
- `test/fixtures/terminal-marker.mjs` is copied into owned test trees as the preload. It records PID/parent/group/session, entry-point role, normal exit code, fallback use, and allowlisted outgoing `dashboard:stopped` fields. IPC forwarding retains its original receiver/arguments/return/callback semantics. No signal handlers, production telemetry, credentials, or settings are added to these records.
- `test/fixtures/terminal-outcome.js` centralizes the evidence predicates. Only npm's evidenced SIGINT representation is accepted alongside clean server/supervisor completion; direct development must exit zero. Missing evidence, replacement supervisor records, unsupported exit representations, unrelated signals, deadlines, fallback use, native failures, and unsafe application results fail. Existing npm `kill EACCES` support remains a separately diagnosed limitation with equally strict application-cleanup requirements, not silent npm success.
- `test/server-shutdown.test.js` retains two positive development terminal cases and adds the real cleanup-failure rejection. Only the normal-server terminal Ctrl+C scenario is removed. Production SIGTERM and IPC/disconnect checks, the existing SIGINT compatibility check, startup interruption, reload/env/TLS tests, and resource-drain tests remain. Terminal runs check recorded Node PIDs and the npm script-shell parent, port reuse, and new core artifacts. Teardown waits for recorded owned PIDs and preserves storage if their exit remains unconfirmed. Fixture environments clear inherited private CA paths.
- `test/terminal-shutdown.test.js` adds 26 outcome/driver tests, including negative evidence combinations, real SIGINT, late descendant output after wrapper exit, and bounded timeout. The late-output regression uses a test-only Linux subreaper through Python's standard-library `ctypes` so its cooperative orphan is adopted and reaped by the fixture rather than abandoned to container PID 1.
- Updated `docs/local-setup.md` and `docs/testing.md` for development-only Ctrl+C, production SIGTERM, supervisor IPC ownership, raw npm signal status, independent cleanup evidence, and separate permission limitations. Both package manifests now identify `0.17.16`; no dependency was installed or changed.

## Verification

- Focused server/terminal verification passed all 35 tests before the final negative integration case was added; the final three real terminal scenarios then passed together, including rejection of the actual cleanup failure.
- Five consecutive positive development-terminal runs passed: direct development exited `0`, npm exited via SIGINT (`-2`), server/supervisor exited `0`, all successful server results were non-forced and cleanup-safe, no fallback ran, and owned processes/ports were released.
- `node --test --test-timeout=10000 test/terminal-shutdown.test.js test/dev-supervisor.test.js test/shutdown.test.js test/http-shutdown.test.js`: 53 passed, zero failures/skips.
- Final `npm test -- --test-timeout=10000 --test-reporter=spec`: 342 passed, zero failures/skips, about 10.2 seconds. Real production SIGTERM and retained SIGINT capability tests both passed on this environment; no capability exemption was needed.
- Final ordinary `npm test`, matching the release gate: 342 passed, zero failures/skips, about 10.1 seconds. An earlier full bounded and ordinary run also passed before the final real-failure case was added.
- `npm run check` passed. All four changed/new JavaScript files were individually syntax-checked, and the Python driver was parsed through `ast.parse` without creating repository bytecode artifacts. `git diff --check` passed.

## Limits And Decisions

No production lifecycle correction was necessary: the failure was in what the terminal test inferred from npm's exit status. Runtime source, development launcher, shutdown budgets, release script, and release gating were not changed. npm permission-denied behavior is covered by outcome regression data and prior environment documentation, not newly claimed as a live `EACCES` reproduction; actual signal delivery succeeded during this implementation. Other runtime/shell exit representations are not accepted without equivalent evidence.

Browser tests and image/production-artifact smoke checks were not rerun because no application UI/runtime/dependency behavior changed. No live service, real integration, user `.env`, credential, existing core artifact, NFS mount, or `todo.md` was changed. No package installation, privilege change, image build, release, tag, push, or merge occurred. Test storage was owned and temporary, with confirmed cleanup on the passing runs. Unrelated archived NFS, IPC-disconnect, and Home Assistant transport findings remain out of scope.
