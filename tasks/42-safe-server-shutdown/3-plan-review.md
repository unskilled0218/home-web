# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/42-safe-server-shutdown/2-plan.md` at `12fc617`, checked against `1-goal.md`, startup/request/weather/NFS ownership, existing IPC tests, and the installed npm/Node signal and subprocess-timeout implementations. No production changes reviewed.
**Health Score:** 89/100
**Trend:** 95 → 89 (−6) from the previous PR Review; that entry covered another task's implementation, so scores are not directly comparable.

The plan separates the native watcher crash from npm's permission failure correctly, but development failure recovery and nested subprocess ownership need clearer contracts.

## Findings

### Warning

**R2 Change Propagation — An application error also ends the development reload owner**

Symptom: Step 4 (`2-plan.md:57`) requires unexpected child startup/runtime failure to end the supervisor. The same supervisor owns source polling and automatic reloads. This classifies an ordinary syntax/import error during an edit, or a temporarily invalid `.env` value, together with an unrecoverable supervisor or shutdown failure. No waiting-for-edit state or recovery rule is defined despite the goal requiring useful automatic development reload behavior.

Source: The Pragmatic Programmer — Orthogonality; Software Engineering at Google — Backward Compatibility.

Consequence: One broken intermediate save terminates both the application and the observer that could restart it after the corrected save. Developers must relaunch the command manually after routine editing mistakes. Avoiding an automatic crash loop does not require stopping observation; waiting for a new file change is different from immediately respawning the failed child.

Remedy: Separate recoverable application failure from supervisor/spawn failure and failed requested shutdown. After an ordinary application failure, retain polling with no live server and launch one replacement only after a new observed change. Keep diagnostics and the last failure status until successful recovery; define final exit behavior explicitly. Reserve fail-fast termination for unrecoverable ownership/spawn/cleanup failures. Add a syntax/import failure → corrected edit → successful restart test, plus an assertion that no child respawns while files remain unchanged.

**R2 Change Propagation — NFS preparation's timeout does not establish subprocess cleanup**

Symptom: Steps 2 and 4 rely on existing NFS preparation bounds while tracking the application store/weather/server and the supervisor's direct server child. `src/nfs.js:61` uses a five-second `execFile` timeout for an optional `mount` subprocess. The installed Node `child_process` implementation's timeout calls `child.kill(options.killSignal)`; it is not an independent guarantee of subprocess exit. The plan already records denied owned-child signals, but its process-level fixtures disable NFS mounting and do not cover that nested ownership boundary.

Source: Clean Architecture — Single Responsibility Principle; Code Complete — Defensive Programming and Error Handling.

Consequence: A blocked preparation process can survive a failed timeout kill or application deadline exit. The supervisor could observe its direct child exit without knowing whether preparation work remains, so the acceptance claim that all owned children/resources have been released is stronger than the proposed tracking and tests support. This is conditional on mount-mode NFS; disabled and pre-mounted configurations do not introduce this subprocess.

Remedy: Distinguish preparation-promise settlement from actual preparation-child exit. Extend only the ownership/cleanup interface for the subprocess already created by existing mount-mode behavior, or explicitly state the unsupported restricted-environment case and its operator prerequisite. Do not add new mount/unmount operations or privileges. Test the existing `run` seam with a delayed child and denied timeout termination, including shutdown during preparation; prevent a clean completion claim or replacement startup while owned preparation work remains unaccounted for.

### Suggestion

**R3 Knowledge Duplication — Supervisor timeout depends on a separately specified child timeout**

Symptom: Step 2 specifies a named 30-second application deadline, while Step 4 separately proposes a 35-second supervisor wait. Their ordering is a cross-process protocol invariant, but the plan does not assign one owner for the child budget or require the supervisor's value to be derived from it.

Source: The Pragmatic Programmer — DRY; A Philosophy of Software Design — Information Hiding and Leakage.

Consequence: Increasing the application's cleanup allowance later can make a healthy child exceed an unchanged supervisor deadline. The supervisor may report a cleanup blocker or attempt escalation before the child reaches its own supported limit, reintroducing signal-permission failures through an unrelated timeout change.

Remedy: Export one application deadline constant and derive the supervisor wait from that budget plus a named positive margin. Keep the shared value in a side-effect-free module or export that does not bootstrap the server. Add a test asserting the ordering and use injected budgets consistently in deterministic timeout tests; no new environment configuration or generic protocol framework is needed.

## Summary

Resolve the two ownership/recovery warnings before implementation and give the cross-process deadline relationship one source. Polling, IPC shutdown, handler drainage before SQLite closure, and a documented direct-launch fallback remain justified. This review records findings only: `2-plan.md` and implementation code are unchanged.

## Retained Decisions And Review Limits

- The native watch supervisor and npm's denied forwarding syscall are independent. Project code cannot grant permission to npm; the explicit acceptance constraint and operator prerequisite are appropriate rather than an application-only guarantee.
- Keeping env-file loading in each server child's Node startup preserves `.env` reloads, environment precedence, and startup-time TLS trust without pinning values in the supervisor.
- Tracking handler promises separately from sockets prevents closing SQLite underneath queued integration work. A nonzero, honestly reported process deadline is preferable to pretending forced shutdown completed all work.
- Dedicated lifecycle/coordinator modules are justified by asynchronous resource ownership; no generic hook framework or new runtime dependency is proposed. R1, R4, R5, and R6 scans found no additional evidence-backed findings.
- The docs-only Quick Test Check was skipped. Existing source/runtime implementations were inspected read-only; no server, native watch supervisor, signal probe, mount command, or new test was executed during this review. No `.brooks-lint.yaml` exists; balanced defaults apply.
