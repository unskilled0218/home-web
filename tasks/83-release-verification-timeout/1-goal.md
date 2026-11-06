# goal

- [goal](#goal)
  - [command](#command)
  - [goal](#goal-1)

## command

- Fix the release-test verification timeout in `scripts/release-verify.py`: the gate allows 1,200 seconds, but earlier full Python release-suite runs took about 1,243 seconds.
- Measure suite and slow-test runtimes to distinguish normal execution from hangs. Do not assume the last printed test is responsible. Improve avoidable delays where safe and choose an evidence-based bounded gate timeout with reasonable headroom.
- Diagnose and fix the known `test_ignored_worktree_secret_is_not_in_committed_snapshot` failure, checking the fixture's appended ignore entry against `.gitignore` without a trailing newline. Preserve the test's committed-snapshot and secret-exclusion guarantees.
- Preserve nonrecursive verification, publication blocking on failure, process-group timeout termination, and owned-resource cleanup. Do not skip tests, weaken assertions, remove timeouts, or bypass release gates.
- Run focused regression tests, the full Python release suite, and the release-test gate through an isolated nonpublishing verification path. Confirm timeout/failure handling and cleanup still work; record durations and any remaining failures. Do not publish a release, access real credentials, or invoke the real no-argument release command.

## goal

Make release-test verification complete reliably within an evidence-based bounded timeout, and fix the ignored-secret fixture failure without weakening committed-snapshot protection. Measure runtimes, improve safe avoidable delays, and verify the full suite plus isolated gate execution while preserving failure blocking, process termination, cleanup, and nonrecursive verification. Record durations and remaining failures without accessing real credentials or publishing a release.
