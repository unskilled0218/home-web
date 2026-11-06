# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Measure And Diagnose](#1-measure-and-diagnose)
    - [2. Fix The Fixture And Bound The Gate](#2-fix-the-fixture-and-bound-the-gate)
    - [3. Verify The Actual Gate Safely](#3-verify-the-actual-gate-safely)
    - [4. Document And Commit](#4-document-and-commit)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Fix the release-test timeout and the ignored-worktree-secret fixture failure. Primary files are `scripts/release-verify.py`, `test/release-template/test_bash_release.py`, `test/release-template/test_verification.py`, and relevant publishing documentation. Inspect supervision/progress code for timing causes, but change it only if profiling establishes a bounded defect. Preserve verification coverage, source isolation, nonrecursive execution, publication blocking, process-tree termination, output bounds, and owned-resource cleanup. Do not publish, access real credentials, or run the real no-argument release command.

## Implementation Plan

### Summary

`local()` gives the Python release suite 1,200 seconds through `gate()` and `DATA.capture()`. Earlier complete runs took about 1,243 seconds, so legitimate execution already exceeds that budget. The last printed test is not proof of a hang. Separately, the ignored-secret test appends `ignored-secret\n` directly to a copied `.gitignore`; without a trailing newline, it becomes part of the preceding pattern and the secret file appears untracked. Fix the test setup, measure actual runtimes, and retain a finite gate budget with headroom.

### 1. Measure And Diagnose

- Create new branch `83-release-verification-timeout`. Record the starting revision, Python/Node versions, environment, and prior timing evidence.
- Reproduce the ignored-secret failure in isolation with `python3 -B -m unittest discover -s test/release-template -p test_bash_release.py -k ignored_worktree_secret -v`. Inspect the copied ignore-file bytes and Git's ignore/status results; confirm failure is in fixture setup rather than committed-snapshot filtering.
- Run the complete Python release suite once with monotonic per-test timing, including setup/teardown and subprocess costs. Use an external temporary `unittest` result/runner wrapper under `/tmp/opencode`, or supported unittest timing diagnostics; preserve discovery, all tests, failures, and the exit status. Do not add a profiling framework to production or run competing full suites concurrently.
- Record total elapsed time and the slowest cases. Inspect intentional waits, nested commands, and cleanup costs before optimizing. Do not reduce safety grace periods, remove negative-path sleeps blindly, or assume every long test is hung. Make only evidenced low-risk fixture optimizations; otherwise retain the runtime and size the budget honestly.

### 2. Fix The Fixture And Bound The Gate

- Make the ignored-secret fixture add a standalone ignore entry regardless of whether the prior `.gitignore` ends in a newline. Keep the fix local to fixture setup rather than changing the project's ignore rules to mask the problem.
- Cover both newline-present and newline-absent inputs. Assert the original final pattern remains intact, the synthetic secret is ignored but untracked, and the checkout is clean before invoking the isolated release. Keep the synthetic sentinel-output checks and the stub builder's assertion that `ignored-secret` is absent from the actual committed build context. Confirm the fixture reaches a successful build/publication simulation, not merely an early refusal.
- Introduce a clearly named fixed release-suite timeout in `scripts/release-verify.py`; keep `local()` using `gate()` with the same complete unittest discovery command. Start with a proposed 1,800-second budget, about 45% above the historical 1,243-second run. Finalize it against measured candidate gate execution with at least 25% headroom above the slower representative complete run; document the selected value and evidence. If runtime exceeds that proposal, diagnose before choosing another finite value.
- Share the release-suite command/budget through small internal constants or one cohesive helper only if needed to prevent isolated gate verification from drifting from `local()`. Do not add an operator-controlled skip, unbounded timeout, cached result, or new publication CLI mode. Leave application/dependency/packaging budgets unchanged unless separate evidence requires a scoped adjustment.
- Add a fast orchestration test in `test_verification.py` that checks `local()` dispatches the complete release suite exactly once with the selected finite budget and in the existing gate order. Mock expensive neighboring gates only in this contract test; do not run the entire suite recursively from a test discovered by that same suite.
- Retain and extend short real-command gate checks for success, nonzero exit, timeout, and overflow. Verify a short timeout raises a release-verification refusal, terminates owned descendants, and leaves an unrelated sentinel process alive. Use readiness markers before cancellation assertions; retain the existing SIGINT/SIGTERM and cleanup tests.

### 3. Verify The Actual Gate Safely

- Run focused tests for the ignored-secret scenarios, gate orchestration, pass/fail/timeout/overflow, descendant reaping, EOF timeout, progress, and nonrecursive publication blocking. Use the existing stubbed `BashPublicationTests` boundaries for release executions; require no authentication/login or build/publication events after verification refusal.
- Run `python3 -B -m unittest discover -s test/release-template -v` on the candidate and record exit status, test count, and elapsed time. Execute long runs in the background with logs under `/tmp/opencode`; wait for completion notifications rather than polling. Do not claim success from focused tests alone.
- Separately export the committed candidate revision to private temporary storage using the existing snapshot function. Build its isolated HOME/temp environment with `verification_environment()` and invoke the actual release-test `gate()` with the same command and production budget used by `local()`. Use an external temporary driver, not `release.sh` or a recursively discovered full-suite test. Record the exact revision, elapsed time, exit status, and budget margin. Ensure candidate fixes are committed before this snapshot run; add final results in a follow-up commit if necessary.
- In the isolated driver environment, remove ambient credential/proxy settings unless explicitly needed; use synthetic fixture credentials only. Confirm owned descendants and temporary work are cleaned on success and simulated failure, without deleting unrelated paths. Keep full-suite and gate runs sequential for interpretable timings.
- Run `npm test`, `npm run check`, `node --test test/release-config.test.js`, `bash scripts/release.sh --validate`, and `git diff --check`. Record any remaining unrelated failures explicitly. No actual Docker build, registry login, or remote publication is authorized.

### 4. Document And Commit

- Update `docs/releases.md` with the selected release-suite timeout and distinguish it from the unchanged application-suite budget; explain that timeout/nonzero results still block publication. Do not claim `--validate` executes the suites.
- Follow the existing patch-release convention: select the next unused patch after `0.17.50`, synchronize `VERSION`, npm manifest/lock root versions, release notes path, README release link, and current-notes link. Add concise release notes. Do not change dependency versions, historical task records, unrelated dashboard code, or `todo.md`.
- Write `4-implemented.md` with measured before/after timings, slow-test diagnosis, any optimization and its evidence, chosen timeout/headroom, ignored-secret regression results, isolated candidate-gate evidence, and remaining limitations. Commit only scoped implementation and documentation changes.

## Acceptance Criteria

- The complete Python release suite and the actual isolated release-test gate pass on the candidate revision with a finite documented budget and at least 25% measured headroom. All existing tests still execute; no recursive full-suite test is introduced.
- The ignored-secret regression passes with and without a trailing newline, preserving previous patterns, clean-checkout behavior, sentinel secrecy, and exclusion from the committed build context.
- Timeout, nonzero exit, overflow, and interruption still fail closed. Owned descendants are reaped, unrelated processes survive, temporary ownership is respected, and verification failure prevents authentication/publication.
- Runtime measurements distinguish normal execution from hangs and explain any delay reduction. Application verification and relevant metadata/syntax checks pass, or unrelated failures are recorded accurately.
- Documentation and patch-version metadata agree. No real credentials are accessed, no real no-argument release command is run, and no release is published.

## Risks And Decisions

- Raising the gate budget alone cannot fix the ignored-secret assertion failure; both causes must be verified independently.
- Smaller test waits can hide supervision races or weaken coverage. Prefer marker-based synchronization for diagnosed avoidable waits, not shorter production cleanup guarantees.
- One machine's timing does not establish a universal bound. Use measured headroom and retain progress reporting; document slower-host limitations rather than removing the deadline.
- Snapshot validation must use committed candidate fixes, not the old base or an unfiltered working-tree copy. Do not export ignored data, installed dependencies, or credential files.
- Full-suite timing and isolated gate execution are intentionally separate external runs. New in-suite tests verify orchestration cheaply and must never launch the full discovered suite again.
