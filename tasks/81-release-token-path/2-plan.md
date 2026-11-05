# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Change the configured default](#1-change-the-configured-default)
    - [2. Verify path selection and credential safety](#2-verify-path-selection-and-credential-safety)
    - [3. Document migration and verify](#3-document-migration-and-verify)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Change the release workflow's default token-file path from `~/.config/git/token` to `~/.config/token/git`. Update current configuration, regression tests, and relevant documentation. Preserve explicit configuration and `GIT_TOKEN` overrides, credential security checks, and the existing release verification/publication flow. Do not move, read, copy, or create real credentials.

## Implementation Plan

### Summary

`scripts/release.json` owns the default path. `scripts/release-data.py:294-310` already selects `GIT_TOKEN` over `token_file`, expands `~`, and validates the file before using its contents. No new path resolver, migration command, or authentication mechanism is needed.

### 1. Change the configured default

- Set `scripts/release.json` → `token_file` to `~/.config/token/git`, keeping the schema, destination, username, and platforms unchanged.
- Keep path selection in `auth()` unchanged unless a focused regression test exposes a defect. `GIT_TOKEN` must remain a file-path override, not a raw token value; explicitly configured custom paths must still work.
- Do not automatically fall back to the old path when the new default is missing or invalid. Operators can deliberately use another path through configuration or `GIT_TOKEN`.
- Retain the existing external-project, regular-file, ownership, private-permission, no-symlink, size, and token-format checks. Do not weaken permissions or expose secrets in errors, logs, arguments, or version control.

### 2. Verify path selection and credential safety

- Update the expected configuration in `test/release-config.test.js:75-85` to require the new default while retaining version/release-target assertions.
- Add focused coverage in `test/release-template/test_bash_release.py` using temporary project/HOME/work directories and synthetic tokens only. Existing release fixtures replace `token_file` with an absolute temporary path, so their normal success cases alone cannot prove the new default works.
- Exercise the production default under an isolated `HOME`, with `GIT_TOKEN` unset and the synthetic token at `.config/token/git`. Keep the literal tilde path in fixture configuration so the real authentication helper must expand it. Commit fixture configuration changes before invoking the stubbed release flow, so dirty-source refusal cannot mask authentication behavior.
- Verify explicit `GIT_TOKEN` precedence with different synthetic default/override contents, or a missing/invalid default and a valid override. Also verify an explicit custom `token_file` still works.
- Verify a valid token only at the legacy path does not satisfy the new default, and that an explicitly selected missing or invalid override does not silently fall back to either location. Assert refusal before build/publication mutations.
- Retain existing unsafe-permission and symlink rejection tests; exercise those protections on the new default path as well. Keep `--help` and `--validate` credential-free, including when the new default does not exist.
- Assert synthetic token values never appear in captured stdout/stderr. Use existing stubbed Git/Docker/network fixture boundaries; do not access the operator's HOME, credentials, daemon, or publication services.

### 3. Document migration and verify

- Update `docs/releases.md` to name the new default and explain that operators must provision their token there themselves, outside the repository. Retain the private-file guidance and file-path override semantics.
- Explain the intentional compatibility boundary: the old location is no longer the default; an operator may explicitly set `GIT_TOKEN="$HOME/.config/git/token"` while migrating. Do not include token contents or run migration commands against actual files.
- Follow the existing patch-release convention during implementation: advance the current version from `0.17.48` to the next unused patch, synchronize `VERSION`, npm manifest/lock root versions, `scripts/release.json` notes, README's release link, and `docs/releases.md` current-notes link. Add concise versioned release notes describing the path change. Leave historical release notes and archived task records unchanged.
- Run `node --test test/release-config.test.js`, `python3 -B -m unittest discover -s test/release-template -v`, `npm run check`, `npm test`, `bash scripts/release.sh --validate`, and `git diff --check`.
- Run the repository release command only with `--help` or `--validate`; no-argument release execution belongs only inside the isolated stubbed test fixture. Record unrelated baseline/environment failures separately, without changing dashboard code or dependencies.

## Acceptance Criteria

- With no override, release authentication reads the synthetic token from `$HOME/.config/token/git` in an isolated regression test, using the production default configuration value.
- A legacy-only token does not trigger fallback. Explicit `GIT_TOKEN` and custom configured paths still work, with `GIT_TOKEN` taking precedence; invalid overrides fail closed.
- Existing credential validation and secret-output protections remain intact. Local help/validation do not read token files or contact publication services.
- Current configuration, tests, operator documentation, and release metadata agree on the new default. No real credential files or historical records are modified.
- Relevant verification passes, or unrelated baseline/environment limitations are recorded accurately. No real release is published.

## Risks And Decisions

- This is a default-location change, not automatic filesystem migration. Missing new credentials should produce the existing safe refusal rather than silently using old credentials.
- A fixture that overwrites `token_file` with an absolute path would miss the requested behavior; at least one test must preserve the literal production default and isolate `HOME`.
- Release configuration is included in provenance hashing. Its hash should change naturally; do not bypass identity checks, rewrite remote release records, or introduce a compatibility exception for prior releases.
- Do not change independent SSH/Git authentication, credential contents, other applications' token conventions, or release destination settings. This planning stage modifies no implementation code.
