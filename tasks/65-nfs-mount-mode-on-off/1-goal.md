# goal

- [goal](#goal)
  - [command](#command)
  - [goal](#goal-1)

## command

- `NFS_MOUNT_MODE` to on/off

## goal

Simplify `NFS_MOUNT_MODE` to `on` and `off`, replacing the current `disabled`, `mount`, and `existing` values. `on` enables NFS backgrounds using the configured source or existing mount; `off` disables them. Align configuration validation, examples, documentation, and tests with these values.
