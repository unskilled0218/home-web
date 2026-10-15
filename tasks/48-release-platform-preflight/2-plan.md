# plan

## scope

Fail before release builds when the selected Buildx builder does not advertise the required Linux AMD64 and ARM64 targets. Share the check between release and direct image export, report builder identity and supported/missing platforms, and give administrator-controlled emulation/native-builder guidance. Do not install emulation, build images, publish, push, change credentials, or alter runtime application behavior.

## Implementation And Verification

Add a Node-based Buildx inspection helper using the existing Node prerequisite and the portable labeled inspection output; the installed Buildx does not support `inspect --format`. Invoke it before release tests/push/login and before export artifact creation. Cover AMD64-only, both-platform, ARM64 variant, multiple-node, inspection-error, malformed-output, and failed-node cases with fake Docker commands; verify entrypoint ordering without contacting real Git remotes, registries, or builders. Update dedicated release documentation and record results. Leave changes uncommitted unless requested.
