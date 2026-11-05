# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limitations](#limitations)

## Changes

- Implemented on the new branch `81-release-token-path`.
- Changed `scripts/release.json`'s default token-file path to `~/.config/token/git`. The authentication implementation remains unchanged, including tilde expansion, explicit custom configuration, `GIT_TOKEN` path precedence, and all credential security checks.
- Added seven isolated release-fixture scenarios for default HOME expansion, explicit overrides, custom configuration, legacy-only refusal, invalid-override refusal, unsafe permissions/symlinks, and credential-free help/validation. Tests use synthetic credentials and stubbed publication tools only; fixture configuration is committed before authentication checks.
- Updated the configuration assertion, publishing guidance, README release link, and versioned release notes. Documented that operators provision the new file themselves and may deliberately use the legacy location through `GIT_TOKEN`; there is no automatic fallback or filesystem migration.
- Advanced the patch version to `0.17.49` across `VERSION`, npm manifest/lock root versions, release configuration, notes, and documentation links. No dashboard code, dependency versions, historical notes, or archived tasks changed.

## Verification

- `node --test test/release-config.test.js`: six passed, zero failed.
- Token-focused Python fixture run: ten passed. Log: `/tmp/opencode/81-token-tests-verified.log`. Additional new-default help/validation and permission/symlink checks passed in a three-test focused run.
- `python3 -B -m unittest discover -s test/release-template -v`: 161 tests, 160 passed, one failed in the unchanged ignored-secret fixture described below. All new token-path scenarios passed. Log: `/tmp/opencode/81-release-suite-verified.log`.
- The initial full release-fixture run exposed a refusal-test assertion that incorrectly expected login after authentication failed. Corrected that test helper use and reverified the token-focused cases. It also exposed the unchanged `test_ignored_worktree_secret_is_not_in_committed_snapshot` failure; reproduced that failure from a temporary archive of unchanged `main` at `6387159`. Log: `/tmp/opencode/81-baseline-release.log`.
- `npm run check`: passed.
- `npm test`: 720 tests, 695 passed, 25 failed in the unchanged weather-proxy scenarios already reproduced on the baseline during task 79. Log: `/tmp/opencode/81-unit.log`.
- `bash scripts/release.sh --validate` and `--help`: passed, including with `GIT_TOKEN=/missing/must-not-read` to confirm these commands do not require credentials.
- `git diff --check`: passed.

## Limitations

- Full application-suite success remains blocked by the unrelated baseline weather-proxy failures on Node.js `v26.13.0`; this task does not change or diagnose that subsystem.
- The baseline ignored-secret release fixture fails source preflight with `Release requires a clean checkout`. Its test appends an ignore entry to the existing `.gitignore`, which lacks a trailing newline. This task leaves unrelated ignore-file/test behavior unchanged.
- No real credentials were read, moved, created, or copied. No actual release, registry authentication, remote publication, or Docker-daemon operation was performed; no-argument release executions occurred only inside isolated fixtures with stubbed publication tools. The Node configuration tests used Docker Compose's local configuration parser.
- Operators must provision `~/.config/token/git` themselves or explicitly configure another token file before publishing. Independent SSH/Git authentication is unchanged.
