# Publish a container release

The token must have repository-write and package-write access and remain outside this repository. Reuse the protected reference token file by injecting it only for the release process:

```sh
FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" ./scripts/release.sh
```

`scripts/release.sh` runs only from a clean `main` checkout. It reads the exact semantic version from `package.json`, runs all tests and syntax checks, pushes `main`, builds AMD64 and ARM64 image archives with checksum files under ignored `dist/`, creates the matching versioned Git tag and Forgejo release, uploads all four release assets, and finally builds and pushes the two-platform registry image only as `git.lan/dev/home-web:latest`. No versioned or architecture-specific registry tags are published. Run only one release at a time because `latest` is intentionally mutable. `FORGEJO_USER` defaults to `dev` and can be overridden when the shared token belongs to another account. Docker authentication uses a minimal temporary configuration with no inherited credential helper and is removed on exit, so the shared token is not left in the normal Docker credential store or host keychain.

The release workstation needs Node 24, Git, curl, Docker with Buildx, a builder capable of `linux/amd64` and `linux/arm64`, and trusted TLS configuration for `git.lan` in Git, curl, and Docker. Install binfmt support once on a Linux Docker host when cross-platform emulation is required, then confirm the builder before releasing:

```sh
docker run --privileged --rm tonistiigi/binfmt --install amd64,arm64
docker buildx inspect --bootstrap
```

The release command performs real Git, Forgejo API, and registry mutations. Never put `FORGEJO_TOKEN` in `.env`, Compose, shell scripts, command arguments, or Git. If the Git tag, Forgejo release, and all release assets were created but the final `latest` push failed, verify that state and run `scripts/release.sh --promote-latest` with the same token. Recovery verifies `main`, the version tag, and all four release assets before rebuilding and publishing `latest` from that exact commit. For an earlier partial failure, inspect and clean up the incomplete Forgejo release before starting again; release assets are never overwritten silently.

[Back to README](../README.md)
