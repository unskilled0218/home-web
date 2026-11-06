# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Timing And Verification](#timing-and-verification)
  - [Limits](#limits)

## Changes

- Created branch `83-release-verification-timeout` from `3c347fb`. Runtime: Python `3.12.3`, Node.js `v26.13.0`, Linux with `/proc` and child-subreaper supervision.
- Made the release-suite command and timeout named internal constants in `scripts/release-verify.py`. The candidate budget is 1,800 seconds rather than 1,200; application and other gate budgets are unchanged. Final timing acceptance remains pending below.
- Fixed the ignored-secret fixture by adding a newline separator before its ignore entry. Both newline-present and newline-absent variants assert the preceding pattern remains intact, the synthetic secret is ignored/untracked, and Git status is clean. Both must complete the stubbed build/publication flow; the existing builder asserts the secret is absent from the committed context, and output checks reject its sentinel.
- Added a fast orchestration test recording the exact once-only full unittest command, fixed budget, isolated HOME, and existing gate order. It does not recursively run the suite. Added a real gate timeout test proving a ready detached descendant is reaped while an unrelated process survives.
- Preserved supervision, progress, cleanup grace periods, byte limits, publication checks, and production source filtering. No speculative performance change was applied before full profiling results.
- Advanced patch version to `0.17.51`, synchronized npm root versions, release configuration, README/current-notes links, and added release notes. Publishing guidance separates the release-suite budget from the application-suite budget and states that failures still block publication.

## Timing And Verification

- Original ignored-secret failure reproduced from a clean archive of `3c347fb`: `Release requires a clean checkout`, one test in 0.864 seconds. Log: `/tmp/opencode/83-original-ignore.log`.
- Fixed newline variants: two passed in 30.671 seconds. Log: `/tmp/opencode/83-focused-ignore.log`. A focused profile of the formerly failing case now reaching a complete release simulation took 14.943 seconds; almost all time was in waiting for the real fixture subprocess, not in test setup. No production cleanup budget was shortened.
- Focused gate checks passed; existing publication-blocking and progress/supervision checks passed. Logs: `/tmp/opencode/83-focused-gates.log`, `/tmp/opencode/83-focused-blocking.log`, `/tmp/opencode/83-focused-supervision.log`, and `/tmp/opencode/83-focused-progress.log`.
- `npm test`, `npm run check`, six release-configuration tests, `bash scripts/release.sh --validate`, and `git diff --check`: passed. Application log: `/tmp/opencode/83-unit.log`.
- Full baseline monotonic profile: running against a separate clean archive, not the changing worktree. Results will be recorded from `/tmp/opencode/83-baseline-timings.json` after completion.
- Complete candidate Python suite and actual isolated committed-candidate release gate: pending. These runs must complete sequentially before implementation is declared verified. An external driver uses the candidate snapshot, production gate command/budget, sanitized HOME/temp environment, and real failure simulations without invoking publication.

## Limits

- This candidate commit enables verification of committed fixes; the full timing results and gate acceptance will be added in a follow-up commit. Do not interpret the focused results as full release-suite success.
- No real credentials were accessed, no actual release or registry authentication was performed, and no real no-argument release command was run. Publication executes only through isolated test command ports; Node configuration tests use the local Compose parser.
