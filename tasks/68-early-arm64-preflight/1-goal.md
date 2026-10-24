# goal

- [goal](#goal)
  - [command](#command)
  - [goal](#goal-1)

## command

```text
Release stopped: Builder must advertise linux/amd64 and linux/arm64 on running nodes; inspect Buildx or ask the host administrator about QEMU/binfmt
Publication did not begin; failed during builder preflight

---

Check arm64 first before process
```

## goal

Check the selected Docker builder's AMD64/ARM64 readiness before lengthy dependency installation and test verification. Fail early with an actionable explanation when ARM64 support is unavailable, while retaining mandatory verification and real both-platform image runtime checks before publication. Do not install privileged host support or bypass release safety checks.
