# goal

- [goal](#goal)
  - [command](#command)
  - [goal](#goal-1)

## command

Fix release package association support for https://git.lan, which reports version `28.2.0`, without merely allowlisting the version. Identify the server implementation and verify package-link semantics before changing the guard. Preserve exact identity checks, read-only correct links, refusal to replace conflicting or inaccessible associations, and reconciliation after uncertain writes. Add regression tests and update relevant documentation. Do not perform live publication, link/unlink/reassignment, server downgrade, or privileged setup.

## goal

Support safe release package association on the identified `28.2.0` server when verified API behavior permits it, while continuing to refuse unsafe or unverified writes. Prove compatibility and preserved safeguards through regression tests and document the supported behavior without live mutations.
