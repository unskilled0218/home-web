# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Branch `45-nfs-connection-check` against `main`, merge base `464eb6f`, through `3b8a088`: four files, 96 additions, no deletions. Reviewed the complete changes in `docs/nfs-backgrounds.md`, `docs/testing.md`, `test/nfs.test.js`, and `tasks/45-nfs-connection-check/4-implemented.md`, with unchanged `src/nfs.js` inspected for test/error-boundary context. No generated files changed. No `.brooks-lint.yaml` was found; balanced defaults apply.
**Health Score:** 99/100
**Trend:** 100 → 99 (−1) from task 45's plan review; this is a different review stage, not a like-for-like implementation trend.

The branch documents a supported operator correction without weakening runtime safety; one small negative-side-effect assertion needs strengthening.

## Findings

### Suggestion

**T5 Coverage Illusion — injected mount guard can be swallowed in rejection cases**

Symptom: the new table-driven regression in `test/nfs.test.js:25-43` uses `run: async () => assert.fail(...)` to require that existing mode never mounts. `prepareNfs()` wraps its command path in a broad catch at `src/nfs.js:67-68`, converting an injected assertion failure to `{ available: false, reason: 'failed', root: null }`. That is precisely the expected result for the two unsafe fixtures. Their external access-count assertion protects against an unwanted `stat()`, but there is no external mount-call counter, so an unwanted attempted mount that fails before directory access could escape detection in those rejection cases. The accepted fixture would fail if its result changed; this is a gap in the negative cases, not proof that current existing mode invokes mount.

Source: *The Art of Unit Testing* — Test Completeness; *How Google Tests Software* — Change Coverage. Assertions about forbidden effects must remain observable outside the production error boundary that normalizes failures.

Consequence: a future regression could try mounting while processing an unsafe existing share and still pass these two fixture cases. That weakens the specific “existing mode must not invoke mount” protection claimed by the new test and documentation, although the current runtime branch returns without invoking the command and no production behavior was changed here.

Remedy: increment a mount-call counter in the injected `run` function and assert zero after each `prepareNfs()` result, alongside the current availability and directory-access assertions. Keep the injected command inert; do not test this with a real mount or remove the application's non-fatal catch. The callback may still throw, but that throw must not be the only observer of the forbidden call.

## Assessment

- R2 Change Propagation: all four files address one NFS diagnosis. No application, Compose, dependency, configuration default, startup owner, or photo pipeline was modified. Operator-host setup is not silently replaced by application code, and historical review fixes remain excluded.
- R1 Cognitive Overload: the new regression is a short linear table with named cases and explanatory assertion messages. Documentation separates transport, topology, file access, catalog, image delivery, and browser display. Multiple stages are necessary because none proves the next stage.
- R3 Knowledge Duplication: the test exercises existing `parseMountInfo()`/`prepareNfs()` rather than reimplementing safety logic. The two documentation references serve different purposes—operator setup and simulated verification—and link to the dedicated NFS document. No competing runtime owner or validation policy was introduced.
- R4 Accidental Complexity: a documented fstab correction plus simulated regression is appropriate when the observed rejection is intended behavior. There is no speculative diagnosis service, failure-code expansion, privileged container workaround, or mandatory live-NAS test.
- R5 Dependency Disorder: no production imports or structural changes. The test continues using existing injected mount/stat/command seams and does not require a test-only production method.
- R6 Domain Model Distortion: host paths, application-visible paths, mount restrictions, NFS retry policy, root-squash, and browser decoding remain distinct. The docs correctly explain that `:ro` does not replace a hard retry policy and that editing fstab does not update an active mount. NFSv3 is recorded as an observed example rather than a global protocol requirement. Soft options are explicitly limited to this read-only photo use.
- Test review: this is documentation/test-only work, so the guide's production-change Quick Test Check is not required. The changed regression was nonetheless inspected for behavioral assertions and error boundaries. Its fixture names and external access assertions are clear; injected filesystem/command seams are appropriate. The one finding concerns an ineffective forbidden-effect observer, not broad mock abuse or absence of meaningful coverage.
- Safety review: the branch preserves operator control of mounts, avoids forced/lazy unmount guidance, warns about superblock sharing and kernel-stalled operations, keeps private paths out of public APIs, and records blocked live verification separately from simulated tests. No runtime release/version bump is required for unchanged production behavior; package version remains `0.17.14`.

## Verification And Follow-Up Context

- Review rerun: `node --test --test-timeout=10000 --test-reporter=spec test/nfs.test.js test/config.test.js test/photo-library.test.js` passed all 19 tests, with zero failures/skips, in about 0.10 seconds. These use injected mountinfo and temporary local fixtures, not the real share.
- Diagnostic probe: an in-memory mount-mode call with an injected `run` incremented a counter and threw `assert.fail()`. The call resolved to the generic failed result without propagating the assertion. No real command, mount, directory operation, or export access occurred. This confirms the error-boundary behavior behind the finding, not a current existing-mode mounting defect.
- Later conversation evidence, after `3b8a088`: the user applied the mount guidance, and a proc-mountinfo-only follow-up found `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2,vers=3` at `/home/container/workdir/wallpaper`, with the requested source. A simulated `stat` verified only that those mount options now pass validation; actual directory access, catalog contents, HTTP image delivery, and browser decoding were not tested.
- The user then reported that this dev container's WebUI still showed NFS unavailable. A narrow follow-up found no `NFS_*` values in the agent environment and no project `.env`; startup guidance was supplied using `NFS_MOUNT_MODE=existing NFS_MOUNT_PATH=/home/container/workdir/wallpaper node scripts/dev.js`. This does not establish the already-running web process's effective environment or successful restart/display. The runtime remains startup-configured, and the live WebUI outcome is unresolved.
- `4-implemented.md` is a historical record of the original hard-mount diagnosis before these follow-up checks. Its original observed mount rejection remains valid for that earlier state; it must not be read as the current mount's options or as proof of end-to-end resolution. This review records the subsequent context without rewriting implementation results or performing another live probe.
- No full Node/browser suite, live NFS scan, production restart, environment edit, mount operation, or package installation was performed during this review. Prior task 42/44 findings remain outside scope and are not claimed fixed.
- Score: 100 − 1 for one Suggestion = 99. Zero Critical and Warning findings. A passing simulated suite is not a claim that the user's live dashboard now displays photos.

## Summary

Strengthen the new test's forbidden mount-call observation with an external counter. The documentation and diagnostic boundary are otherwise sound, but live file access and dev-WebUI photo display remain unverified after the now-safe remount. Only this report and review history are committed; implementation, tests, plan, environment, version, mounts, and user data remain unchanged in this review stage.
