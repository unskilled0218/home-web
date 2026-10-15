# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/47-npm-terminal-shutdown-exit/2-plan.md` at `8d7a6e2`, against `1-goal.md` and the user's later development-only Ctrl+C clarification. Existing terminal fixtures, development launcher, and lifecycle budgets inspected as supporting context; no implementation review or runtime verification is claimed.
**Health Score:** 100/100
**Trend:** 95 → 100 (+5) against the latest PR Review record. That record reviewed task 46 implementation; different scopes make this a historical reference, not measured improvement in running code.

The plan is ready to implement and correctly limits required terminal Ctrl+C support to development without weakening production shutdown or release checks.

## Findings

No actionable findings.

## Review Basis

- Scope matches the user's correction: only `node scripts/dev.js` and `npm run dev` require terminal Ctrl+C verification. Removing the normal-server PTY scenario does not remove production SIGTERM, IPC/disconnect, admission/drain, or cleanup-failure coverage. Retaining the existing server SIGINT handler avoids an unnecessary compatibility change.
- The plan diagnoses npm wrapper status separately from application cleanup before selecting a remedy. A SIGINT exit is allowed only after intentional interruption, a successful server lifecycle result, normal supervisor exit, complete output capture, no fallback use, no leftover owned process, and port reuse. Negative cases prevent this from becoming a blanket acceptance of interrupted or failed commands.
- Current code supports the stated investigation: the PTY driver breaks immediately on wrapper exit, the preload's 12-second fallback can make eventual PID disappearance misleading, and the development launcher exits with the supervisor's result. Planned independent evidence addresses those gaps rather than just replacing `assert.equal(result.code, 0)` with a permissive status list.
- Process observation remains confined to owned temporary fixtures. Preserving IPC call semantics, avoiding intrusive signal handlers, allowlisting lifecycle fields, retaining diagnostics when cleanup is unconfirmed, and ordering deadlines are appropriate safeguards for this process-boundary test. Such instrumentation is justified by the existing false-pass risks; no production monitoring API or general process framework is proposed.
- Change Propagation, Cognitive Overload, Knowledge Duplication, Accidental Complexity, Dependency Disorder, and Domain Model Distortion were considered at plan level. Proposed fixture, assertion, and documentation edits share one shutdown-verification purpose. Production fixes are conditional on demonstrated causality, and unrelated archived findings remain excluded.
- Planned real PTY repetitions, late-output driver regression, deterministic rejection cases, existing lifecycle regressions, and both ordinary release-equivalent `npm test` and bounded full-suite runs provide a concrete verification path. Missing capabilities and npm `EACCES` remain explicit limitations rather than silent successful verification.
- No `.brooks-lint.yaml` was found; balanced defaults apply. The formal Quick Test Check is skipped because this review changes documentation only. Existing tests were read for feasibility, not scored as newly implemented tests.

## Verification Limits

This was a read-only inspection of the plan and supporting code. No servers, tests, PTY sessions, dependency installations, image operations, or release commands were run. The npm failure remains unresolved until implementation supplies the required process evidence and passing regression results. Neither `2-plan.md` nor implementation code was changed during this review.

## Summary

Proceed with the bounded development-only investigation and preserve the plan's independent cleanup predicates when correcting npm exit expectations. No plan revision is required; the score describes the proposed approach, not a verified runtime fix.
