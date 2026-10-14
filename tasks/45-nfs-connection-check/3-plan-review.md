# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/45-nfs-connection-check/2-plan.md` at `cbb5011`, checked against `1-goal.md`, `src/nfs.js`, `src/photo-library.js`, `src/shutdown.js`, and `docker-compose.yml`. This assesses the proposed investigation and change boundaries, not a live NFS connection or implementation. No `.brooks-lint.yaml` was found; balanced defaults apply.
**Health Score:** 100/100
**Trend:** 94 → 100 (+6) from the latest PR Review record, which reviewed task 44 implementation; different scope and review stage make this a non-comparable quality trend.

The plan is ready for execution: it distinguishes diagnostic evidence from assumptions and gates live NFS work on operator-controlled prerequisites and cleanup.

## Findings

No Critical, Warning, or Suggestion findings identified within this planning scope.

## Assessment

- R2 Change Propagation: runtime changes are conditional on a demonstrated defect, with narrow NFS/configuration/photo boundaries and corresponding regression tests. A missing host mount or disabled configuration leads to operator guidance, not speculative application changes. Unrelated shutdown and display review remedies are excluded. Temporary servers/databases isolate verification from production preferences and integration state.
- R1 Cognitive Overload: the six stages distinguish configuration, name/service reachability, mount topology, application-user access, manifest/image delivery, and browser decoding. Although detailed, the plan uses explicit gates and stopping conditions rather than combining every failure into an ambiguous “connection failed” diagnosis. Staged pass/fail/blocked/not-run evidence gives the eventual report an actionable structure.
- R3 Knowledge Duplication: proposed investigation reuses current configuration parsing, mount preparation, photo-library, and HTTP boundaries rather than introducing a competing validator or settings owner. Mountinfo fixtures are evidence for targeted regressions, not an alternate runtime interpretation that silently changes safety policy.
- R4 Accidental Complexity: no mandatory diagnostics subsystem, status endpoint, persistence table, UI redesign, dependency, or automatic network retry is proposed. Stable operator-facing failure categories are allowed only when needed to distinguish the observed failure. Documentation-only and blocked outcomes are valid; implementation and version changes are not required merely to complete the workflow.
- R5 Dependency Disorder: the plan preserves preparation-child ownership and existing shutdown coordination. It keeps network/mount diagnostics out of disabled startup behavior and confines real-provider checks to explicit investigation. No new domain-to-infrastructure dependency or cycle is required by the proposed corrections.
- R6 Domain Model Distortion: disabled configuration, transport reachability, mount identity, readable directories, empty supported-image catalogs, safe HTTP delivery, and successful browser display remain separate claims. Host mount versus application-visible bind topology is explicitly distinguished. The user-requested TrueNAS source is a test target/example, not a hard-coded default or authorization to mutate exports.

## Safety And Feasibility Checks

- The recommended container path is `NFS_MOUNT_MODE=existing` with an operator-prepared host mount and read-only bind. The user's mode question does not establish that their failing deployment is Compose; step 1 correctly requires confirmation rather than silently assuming it.
- Existing-mode inspection must establish application-visible topology and access, not merely a host directory name or successful `stat()`. The plan requires evidence before changing exact mount-point handling or interpreting VFS/superblock options and prohibits accepting arbitrary local directories as a workaround.
- The live access gate at `2-plan.md:34` applies before filesystem/helper work, and the real-photo stage at lines 49–53 repeats the bounded-cleanup prerequisite. This matters because `src/photo-library.js:24-65` checks its deadline between awaits and `open()` at lines 92–116 performs further filesystem work. A successful small read does not guarantee a later scan/stream cannot stall. The plan already states that JavaScript races, shell timeouts, and cooperative scan checks are not hard cancellation and permits operator-run/blocked outcomes when cleanup is unavailable.
- Neither permission to send an owned-child signal nor an HTTP response deadline alone establishes cleanup of kernel-blocked filesystem work. Execution must honor the existing gate for the whole scan/image-serving phase; the plan does not authorize an unkillable probe or a production shutdown rewrite to bypass that gate.
- Mounting/remounting, root commands, package installation, NAS ACL changes, permission changes, and container privilege expansion remain operator actions. A non-root managed-mount experiment requires separate authorization, a dedicated unoccupied target, and verified cleanup. Leaving existing mounts intact is explicit.
- Public photo responses retain bounded relative names and opaque URLs; raw mount errors, source paths, command output, unrelated environment values, and personal catalogs are excluded. Narrow operator evidence can still identify the requested export without creating a public diagnostic API.
- DNS/TCP/RPC probes are properly treated as partial evidence. NFSv4 discovery/path/version differences and root-squash are hypotheses to investigate, not reasons to rewrite TrueNAS settings or retry unrelated exports.

## Verification Review

Quick Test Check is skipped because this is a documentation-only plan, not a production/test-code diff. The proposed verification is appropriate: deterministic injected mount/configuration failures, safe local photo fixtures, retained child-cleanup regressions, sanitized-response checks, and browser tests where the affected boundary changes. Real export verification remains separate and optional when prerequisites permit; ordinary test success cannot be reported as live TrueNAS success.

No live network probe, NFS file access, mount operation, runtime server, or test suite was run in this review. Source inspection supports the plan's description of cooperative deadlines and mount validation but does not diagnose the user's live failure. The score is 100 with zero deductions and applies only to plan quality.

## Summary

Execute the diagnostic stages in order, confirm the deployment context, and retain `existing` as the recommended host-mounted container path. If live access or cleanup cannot be established, record the exact operator prerequisite without claiming a successful connection or making speculative code changes. Only this review and its history entry are committed; the plan, implementation, version, environment, mounts, user data, and `todo.md` remain unchanged.
