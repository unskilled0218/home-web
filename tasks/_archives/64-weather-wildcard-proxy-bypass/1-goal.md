- [command](#command)
- [goal](#goal)

## command

Fix warning from previous task.

## goal

Resolve task 63's review warning by making weather transport wildcard-domain bypass rules match native Node behavior for both `NO_PROXY` and `no_proxy`. A `*.domain` rule must bypass the proxy for the domain itself and its subdomains. Add regression coverage comparing native and weather routing, checking successful responses and actual proxy use, while preserving startup proxy policy, connection settings, and owned dispatcher cleanup.
