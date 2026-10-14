# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Current branch `42-safe-server-shutdown` relative to `main`, merge base `0cb6de9`, implementation `417238a`: 20 changed files, 809 additions and 35 deletions. Risk-focused review, with detailed inspection of lifecycle, HTTP admission/drain, NFS ownership, development supervision, and their tests. Generated `package-lock.json` skipped for design analysis; manifest version alignment checked.
**Health Score:** 90/100
**Trend:** 89 → 90 (+1) from the latest PR Review record, which reviewed this task's plan rather than implementation.

The branch removes native watch teardown and protects SQLite drainage, but two reproducible startup/control edge cases should be addressed before merge.

## Findings

### Warning

**Shutdown invariant — NFS can start a new helper after stop intent**

Symptom: `src/server.js:53-54` checks stop intent only after the entire `prepareNfs()` call. Within `src/nfs.js:53-63`, preparation can await mount enumeration and directory creation, then unconditionally invoke `run('mount', ...)`. Neither the preparation function nor that subprocess-creation boundary receives the coordinator's stopping state. A simulated sequence that paused `mkdirImpl`, began shutdown, and then resumed it still created a new owned child. With simulated denied termination, shutdown reached its forced deadline with one pending helper.

Source: *Code Complete* — Defensive programming and explicit state invariants; *A Philosophy of Software Design* — Strategic vs. Tactical Programming. The stop invariant is enforced around the outer phase, while the phase can still introduce the expensive side effect that cleanup must undo.

Consequence: Ctrl+C during pre-command NFS startup can turn an otherwise child-free stop into a new mount attempt and unsafe-cleanup failure. In the already documented signal-denied environment, that newly created helper may survive forced dashboard exit. Existing ownership tracking correctly refuses success, but it cannot prevent this avoidable cleanup blocker.

Remedy: Pass a narrow cancellation/stop predicate or signal into preparation, check it after asynchronous pre-command phases and immediately before invoking `run`, and return without creating a helper once stop intent is set. Retain actual-exit tracking for a helper already created. Add a deterministic regression that pauses mount enumeration or directory creation, requests stop, resumes startup, and verifies zero command launches, no later listen, and safe store closure.

**Child completion contract — IPC-error disconnect hides an already exited child from the supervisor**

Symptom: `scripts/dev-supervisor.js:73-81` explicitly disconnects the child channel after a send failure, but `scripts/dev-supervisor.js:117` observes completion only through `close`. On the installed Node `v24.21.0`, parent-initiated disconnect can yield `exit` without `close`. The implementation report already notes this runtime behavior, and `test/server-shutdown.test.js:32-33` works around it in the process fixture, not the production supervisor. A short-lived real cooperative child, an injected send-callback error, and 200ms application/50ms margin budgets reproduced exit 0 followed by the supervisor deadline diagnostic and `{ code: 1, cleanupSafe: false }`; the child had exited before that deadline. `FakeChild.close()` always emits both events, so existing supervisor tests cannot expose the mismatch.

Source: *Software Engineering at Google* — Observable behavior and dependency contracts; *Code Complete* — Error-handling discipline. The error path changes IPC ownership but retains a completion assumption that is invalid on the supported runtime.

Consequence: A recoverable local transport teardown causes an unnecessary default 35-second wait and a misleading report that child cleanup requires operator help, even when its process is gone. A nonzero IPC-failure result and prohibition on replacement remain appropriate; unconfirmed process exit and waiting the entire deadline do not.

Remedy: Track process exit independently from IPC and owned output completion. Join the applicable events for ordinary reloads without relying solely on `close` after explicit disconnect, retain nested-preparation/result safety checks, and keep IPC failure nonzero. Add a real cooperative-child regression for the send-error/disconnect path that confirms prompt completion after exit, no replacement, and no false unresponsive-child deadline diagnostic.

## Verification And Quick Test Check

- Ran `node --test --test-timeout=5000 test/shutdown.test.js test/dev-supervisor.test.js test/nfs.test.js test/http-shutdown.test.js`: all 33 tests passed, about 0.19 seconds.
- Reproduced the late-NFS-spawn case using existing injected command, directory, clock, and fake-child seams. No actual filesystem directory preparation, mount operation, server, user database, or denied OS signal was invoked.
- Reproduced the supervisor completion case with a real disposable Node child that exits cooperatively on IPC disconnect and has a one-second self-exit fallback. Injected only the send-callback error; the child exited 0. No OS signal, application server, or mount command was used.
- Existing implementation evidence records 288 passing Node tests with two signal-permission skips, and 81 passing browser tests. Those complete suites were not rerun for this review; terminal and signal-capability results are not newly claimed.
- Tests exist for the changed public behavior, exercise actual SQLite ordering, and use appropriate seams around clocks/processes. The mocks primarily verify behavior and ownership, not incidental calls. Multiple assertions generally support clear named scenarios; no separate mock-abuse or assertion-obscurity finding is warranted. Missing regressions are described with the two corresponding production findings rather than counted twice.
- Shared lifecycle budgets, dynamic config loading, HTTP handler registration before awaited dispatch, admission closure, weather reuse, and exit-status recovery were inspected. No new dependency cycle, unrelated feature change, speculative framework, or duplicated shutdown-budget policy was found.
- npm forwarding `EACCES`, denied userspace signal delivery, and already stalled verification PIDs remain explicitly documented environment limits. This review does not stop those PIDs, change policy, or claim those limits are fixed.

## Summary

Prevent new NFS preparation side effects once shutdown begins, then make supervisor completion independent of the disconnect-sensitive `close` event. The diff exceeds 500 lines and merits careful cross-boundary review, but its files share one lifecycle objective rather than unrelated responsibilities; the polling/IPC design and child-only env parsing are justified by recorded runtime evidence. Score uses balanced deductions: 100 minus two warnings at five points each. No implementation changes were made during this review.
