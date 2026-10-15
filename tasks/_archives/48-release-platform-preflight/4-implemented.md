# implemented

## Outcome

Added a shared platform preflight in `scripts/check-build-platforms.js`. `scripts/release.sh` runs it before tests, Git fetch/push, registry login, and builds, including promotion mode. `scripts/export_image.sh` runs it before creating export storage or artifacts. Missing Linux AMD64 or ARM64 capability fails nonzero with the selected builder name, advertised platforms from running nodes, and administrator-controlled QEMU/binfmt or native-builder guidance. No automatic privileged operation or emulation installation is included.

The helper reads portable labeled `docker buildx inspect --bootstrap` output because the installed Buildx rejects `inspect --format`. It accepts architecture variants and capabilities spread across multiple running native nodes, ignores stopped/error nodes, and fails closed when inspection output is missing or unrecognized. Failed inspection preserves the diagnostic rather than replacing it with a generic build error. The check verifies advertised capability, not actual emulated execution; the documentation states this limitation.

## Verification

- Added 15 fake-command tests covering AMD64-only builders, both targets, ARM64 variants, forced-platform markers, multiple nodes, empty/unrecognized output, missing targets, failed/stopped nodes, and inspection errors.
- Release, promotion, and direct-export entrypoint tests verify missing ARM64 stops execution before Git remote work, tests, registry authentication, builds, emulation installation, and partial export artifacts. No real publishing command is used by these tests.
- Focused platform/release suites: 21 passed, zero failures/skips. Initial mock executables inherited the fixture package's ES-module mode; giving the mock `bin` directory an explicit CommonJS package fixed the fixture without weakening assertions.
- Full `npm test -- --test-timeout=10000 --test-reporter=spec`: 357 passed, zero failures/skips, about 10.3 seconds.
- `npm run check`, `bash -n scripts/release.sh scripts/export_image.sh`, `node --check scripts/check-build-platforms.js`, and `git diff --check` passed.

## Limits

Updated dedicated release documentation. Application version/dependencies, user credentials/configuration, runtime services, and `todo.md` are unchanged. No real bootstrap, image build, emulation registration, release, tag, or merge was performed. The user subsequently requested committing and pushing these changes; the existing clean-main release guard remains in force.
