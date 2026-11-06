# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Timing And Verification](#timing-and-verification)
  - [Limits](#limits)

## Changes

- Created branch `83-release-verification-timeout` from `3c347fb`. Runtime: Python `3.12.3`, Node.js `v26.13.0`, Linux with `/proc` and child-subreaper supervision.
- Made the release-suite command and timeout named internal constants in `scripts/release-verify.py`. The final budget is 1,800 seconds rather than 1,200; application and other gate budgets are unchanged. The slower complete candidate run fits with 42.42% headroom, above the required 25%.
- Fixed the ignored-secret fixture by adding a newline separator before its ignore entry. Both newline-present and newline-absent variants assert the preceding pattern remains intact, the synthetic secret is ignored/untracked, and Git status is clean. Both must complete the stubbed build/publication flow; the existing builder asserts the secret is absent from the committed context, and output checks reject its sentinel.
- Added a fast orchestration test recording the exact once-only full unittest command, fixed budget, isolated HOME, and existing gate order. It does not recursively run the suite. Added a real gate timeout test proving a ready detached descendant is reaped while an unrelated process survives.
- Preserved supervision, progress, cleanup grace periods, byte limits, publication checks, and production source filtering. No speculative performance change was applied before full profiling results.
- Advanced patch version to `0.17.51`, synchronized npm root versions, release configuration, README/current-notes links, and added release notes. Publishing guidance separates the release-suite budget from the application-suite budget and states that failures still block publication.

## Timing And Verification

- Original ignored-secret failure reproduced from a clean archive of `3c347fb`: `Release requires a clean checkout`, one test in 0.864 seconds. Log: `/tmp/opencode/83-original-ignore.log`.
- Fixed newline variants: two passed in 30.671 seconds. Log: `/tmp/opencode/83-focused-ignore.log`. A focused profile of the formerly failing case now reaching a complete release simulation took 14.943 seconds; almost all time was in waiting for the real fixture subprocess, not in test setup. No production cleanup budget was shortened.
- Focused gate checks passed: three tests in 1.278 seconds. Existing publication-blocking test passed; focused supervision checks passed five tests in 2.698 seconds, and progress checks passed 20 tests in 50.159 seconds. Logs: `/tmp/opencode/83-focused-gates.log`, `/tmp/opencode/83-focused-blocking.log`, `/tmp/opencode/83-focused-supervision.log`, and `/tmp/opencode/83-focused-progress.log`.
- `npm test`: 820 passed, zero failed/skipped. `npm run check`, six release-configuration tests, `bash scripts/release.sh --validate`, and `git diff --check`: passed. Application log: `/tmp/opencode/83-unit.log`.
- Full baseline monotonic profile of a clean archive of `3c347fb`: 161 tests, 160 passed, one ignored-secret failure, zero errors; 1,214.042 seconds elapsed. Logs: `/tmp/opencode/83-baseline.log` and `/tmp/opencode/83-baseline-timings.json`. This independently exceeds the old 1,200-second gate.
- Slowest baseline methods: link-failure preservation, 76.132 seconds (one initial publication and nine retry faults); promotion-evidence refusal, 72.649 seconds (seven fresh publication faults); association-prerequisite refusal, 71.555 seconds (an initial publication and 24 prerequisite faults); fresh-readiness refusals, 60.043 seconds (24 faults). Timings follow repeated real stubbed-release subprocess execution, not a single test stuck at the final printed line. No low-risk avoidable fixed delay was established; coverage and cleanup waits remain unchanged.
- Complete candidate Python suite against a clean archive of commit `a4dccc9`: 164 passed, zero failures/errors; 1,263.869 seconds elapsed, with 536.131 seconds remaining under the new budget (42.42% headroom above runtime). Logs: `/tmp/opencode/83-candidate.log` and `/tmp/opencode/83-candidate-timings.json`. The additional successful ignored-secret build and newline variant intentionally add work; this is not a claimed speed optimization.
- Actual isolated release-test gate for committed candidate `a4dccc9`: 164 tests passed, exit 0, in 1,251.737 seconds under the actual 1,800-second budget, leaving 548.263 seconds (43.80% headroom above runtime). The external driver used `DATA.snapshot()`, imported the candidate verifier, and used its exact command/budget with sanitized HOME/temp paths. Logs: `/tmp/opencode/83-isolated-gate.log` and `/tmp/opencode/83-gate-result.json`.
- After the actual gate, real nonzero-exit and short-timeout simulations both raised verification refusal. The driver confirmed the unrelated sentinel survived, all owned descendants were reaped, the suite's temporary parent was empty, and the entire owned snapshot work directory was removed. No publication entry point was invoked.

## Limits

- All implementation code was verified from candidate commit `a4dccc9`. The follow-up commit changes only this result record and publishing documentation's measured-runtime description; no executable changes were made after the complete candidate runs.
- The measured budget is not a guarantee for every slower host. A later genuine hang or regression still times out, emits diagnostics, and blocks publication. No safe avoidable delay was established, so this task makes no speedup claim.
- No real credentials were accessed, no actual release or registry authentication was performed, and no real no-argument release command was run. Publication executes only through isolated test command ports; Node configuration tests use the local Compose parser.
