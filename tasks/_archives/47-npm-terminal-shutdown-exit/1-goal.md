# goal

## command

```text
✖ failing tests:

test at test/server-shutdown.test.js:104:54
✖ terminal Ctrl+C stops the npm launch without native watch teardown (320.769455ms)
  AssertionError [ERR_ASSERTION]: fixture-pid:2929

  > dashboard@0.17.15 dev
  > node scripts/dev.js

  fixture-pid:2941
  fixture-pid:2952
  dashboard listening at http://127.0.0.1:36445
  ^C

  -2 !== 0

      at TestContext.<anonymous> (file:///home/container/workdir/home-web/test/server-shutdown.test.js:112:15)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: -2,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

- Got this error while release
- tasks/_archives/42-safe-server-shutdown

## goal

Resolve the npm terminal-shutdown test failure that blocks release, using archived task 42 as lifecycle context. Establish whether npm's termination by SIGINT is a valid wrapper outcome after clean application shutdown or evidence of an actual shutdown defect, then correct the project contract and implementation or test accordingly. Do not assume `-2` means the dashboard crashed: the Python PTY fixture converts a signal-terminated process status to a negative signal number, so this result identifies SIGINT termination of its immediate child, npm.

The current test runs normal Node, direct development, and `npm run dev` inside a real PTY. It sends Ctrl+C after listening, checks that the port is free, recorded processes are gone, and no native crash/core artifact appeared, then requires exit code zero except for an npm output containing `EACCES`. The supplied failure contains no `EACCES`, so that exception does not apply. Task 46's branch review reproduced this same `-2` assertion both in the full suite and an isolated rerun; direct terminal launch cases passed. Treat that as evidence to investigate, not proof of the root cause or permission to generalize the old exception.

Separate npm/shell/process-group termination from the development supervisor and server's own lifecycle result. Determine which processes receive terminal SIGINT, whether the server and supervisor finish their owned cleanup, and whether the fixture captures enough terminal output and descendant completion to make a trustworthy assertion. Preserve strict failure detection for application startup/runtime errors, incomplete cleanup, unresponsive children, unexpected signals, native assertions, segmentation faults, and new core artifacts. Do not simply accept every negative exit code, suppress stderr, skip the npm case, swallow genuine failures, or force success without cleanup evidence. If npm's SIGINT result is expected, constrain any test allowance to that wrapper and intentional interruption scenario, with independent evidence of successful application cleanup.

Keep shutdown idempotent and bounded, preserve automatic development reload and startup configuration, and prevent replacement children after stop intent. Retain direct launch behavior, HTTP admission/drain ordering, SQLite safety, background-work ownership, and temporary resource isolation. Require no root privileges, container-policy changes, new system packages, or broad process termination. If an upstream npm/runtime constraint genuinely remains, document the exact supported behavior and prerequisite rather than claiming an application fix.

Completion requires repeatable focused PTY tests and the full Node suite without this unexplained assertion failure. Cover normal and direct development interruption, the npm wrapper's evidenced intentional-interruption outcome, and failure cases that must remain nonzero or unsafe. Verify only owned temporary processes, ports, databases, keys, and artifacts. Keep `scripts/release.sh` test gating intact; do not bypass tests, publish a release, push commits, create tags, build images, or modify a running user service as part of diagnosing this failure. Update focused testing/local setup documentation only where the established contract changes, and record runtime/tool versions and any real verification limits.

This task does not reopen unrelated archived findings, including NFS preparation, IPC completion, or Home Assistant transport disposal, unless evidence establishes they directly cause this npm failure. Do not modify `todo.md`, user `.env`, credentials, existing core files, or implementation code during this goal-writing stage.
