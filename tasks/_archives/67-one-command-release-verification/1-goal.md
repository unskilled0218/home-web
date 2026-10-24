# goal

- [goal](#goal)
  - [command](#command)
  - [goal](#goal-1)

## command

Automate verification so the user can just use one line: `bash scripts/release.sh`.

## goal

Make `bash scripts/release.sh` run the required verification automatically before building and releasing the AMD64/ARM64 image, without separate manual verification commands. Proceed only when checks pass and publication safety requirements are satisfied; otherwise stop with a clear, actionable error rather than bypassing existing blockers.
