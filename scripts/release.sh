#!/bin/bash

set -euo pipefail

usage() {
  echo "Usage: $0 [--promote-latest]" >&2
  exit 2
}

mode=release
if [ "$#" -gt 1 ]; then
  usage
fi
if [ "$#" -eq 1 ]; then
  if [ "$1" != "--promote-latest" ]; then
    usage
  fi
  mode=promote
fi

: "${FORGEJO_TOKEN:?set FORGEJO_TOKEN to the shared token with repository and package write access}"
FORGEJO_USER=${FORGEJO_USER:-dev}

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
for command in git node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is not installed: $command" >&2
    exit 1
  fi
done

package_version=$(node -p "require('$project_root/package.json').version")
release_tag="v$package_version"
if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Package version must be MAJOR.MINOR.PATCH: $package_version" >&2
  exit 1
fi

current_branch=$(git -C "$project_root" branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "Releases must run from main; current branch is ${current_branch:-detached HEAD}" >&2
  exit 1
fi
if [ -n "$(git -C "$project_root" status --porcelain --untracked-files=all -- . ':(exclude)dist')" ]; then
  echo "Files outside dist/ have uncommitted changes; refusing to release" >&2
  exit 1
fi

head_commit=$(git -C "$project_root" rev-parse HEAD)
git -C "$project_root" fetch --tags origin
tag_commit=$(git -C "$project_root" rev-parse -q --verify "refs/tags/$release_tag^{commit}" 2>/dev/null || true)
if [ -n "$tag_commit" ] && [ "$tag_commit" != "$head_commit" ]; then
  echo "Release tag $release_tag already identifies a different commit" >&2
  exit 1
fi

for command in curl docker gzip npm sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is not installed: $command" >&2
    exit 1
  fi
done

original_docker_config=${DOCKER_CONFIG:-$HOME/.docker}
original_docker_context=$(docker context show)
release_docker_config=$(mktemp -d)
raw_manifest=
forgejo_auth_config=
forgejo_response=
cleanup() {
  local exit_status=$?
  trap - EXIT
  rm -rf "$release_docker_config"
  if [ -n "$raw_manifest" ]; then rm -f "$raw_manifest"; fi
  if [ -n "$forgejo_auth_config" ]; then rm -f "$forgejo_auth_config"; fi
  if [ -n "$forgejo_response" ]; then rm -f "$forgejo_response"; fi
  exit "$exit_status"
}
trap cleanup EXIT
chmod 700 "$release_docker_config"
printf '%s\n' '{"auths":{}}' > "$release_docker_config/config.json"
if [ -d "$original_docker_config/buildx" ]; then
  cp -R "$original_docker_config/buildx" "$release_docker_config/buildx"
fi
if [ -d "$original_docker_config/contexts" ]; then
  cp -R "$original_docker_config/contexts" "$release_docker_config/contexts"
fi
export DOCKER_CONFIG=$release_docker_config
export DOCKER_CONTEXT=$original_docker_context

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is not available" >&2
  exit 1
fi
if ! docker buildx inspect --bootstrap >/dev/null 2>&1; then
  echo "Docker Buildx builder could not start" >&2
  exit 1
fi

if [ "$mode" = release ]; then
  (
    cd "$project_root"
    npm test
    npm run check
  )
  git -C "$project_root" push origin main
else
  git -C "$project_root" fetch origin main
fi

remote_commit=$(git -C "$project_root" rev-parse origin/main)
if [ "$remote_commit" != "$head_commit" ]; then
  echo "origin/main is $remote_commit, expected $head_commit" >&2
  exit 1
fi

printf '%s' "$FORGEJO_TOKEN" | docker login git.lan --username "$FORGEJO_USER" --password-stdin
registry_image=git.lan/dev/home-web

verify_manifest() {
  local image=$1
  raw_manifest=$(mktemp)
  docker buildx imagetools inspect --raw "$image" > "$raw_manifest"
  node - "$raw_manifest" <<'NODE'
const fs = require('node:fs');
const index = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const platforms = (index.manifests ?? []).map(({ platform = {} }) => `${platform.os}/${platform.architecture}`).sort();
const expected = ['linux/amd64', 'linux/arm64'];
if (JSON.stringify(platforms) !== JSON.stringify(expected)) {
  console.error(`Published platforms are ${platforms.join(', ') || 'missing'}, expected ${expected.join(', ')}`);
  process.exit(1);
}
NODE
  rm -f "$raw_manifest"
  raw_manifest=
}

promote_latest() {
  docker buildx imagetools create --tag "$registry_image:latest" "$registry_image:$release_tag"
  verify_manifest "$registry_image:latest"
}

verify_forgejo_release() {
  forgejo_auth_config=$(mktemp)
  forgejo_response=$(mktemp)
  chmod 600 "$forgejo_auth_config"
  printf 'header = "Authorization: token %s"\n' "$FORGEJO_TOKEN" > "$forgejo_auth_config"
  local status
  status=$(curl --silent --show-error --config "$forgejo_auth_config" --output "$forgejo_response" --write-out '%{http_code}' "https://git.lan/api/v1/repos/dev/home-web/releases/tags/$release_tag")
  if [ "$status" != "200" ]; then
    echo "Forgejo release lookup failed with HTTP $status" >&2
    exit 1
  fi
  node - "$forgejo_response" "$release_tag" <<'NODE'
const fs = require('node:fs');
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tag = process.argv[3];
if (release.draft || release.prerelease) {
  console.error('Forgejo release must be published and not marked as a prerelease');
  process.exit(1);
}
const expected = new Set([
  `home-web-${tag}-linux-amd64.tar.gz`,
  `home-web-${tag}-linux-amd64.tar.gz.sha256`,
  `home-web-${tag}-linux-arm64.tar.gz`,
  `home-web-${tag}-linux-arm64.tar.gz.sha256`
]);
for (const asset of release.assets ?? []) {
  if (expected.has(asset.name) && Number(asset.size) > 0) expected.delete(asset.name);
}
if (expected.size) {
  console.error(`Forgejo release is missing asset(s): ${[...expected].sort().join(', ')}`);
  process.exit(1);
}
NODE
  rm -f "$forgejo_auth_config" "$forgejo_response"
  forgejo_auth_config=
  forgejo_response=
}

if [ "$mode" = promote ]; then
  if [ -z "$tag_commit" ]; then
    echo "Release tag $release_tag does not exist locally" >&2
    exit 1
  fi
  verify_manifest "$registry_image:$release_tag"
  verify_forgejo_release
  promote_latest
  echo "Promoted $registry_image:$release_tag to latest"
  exit 0
fi

image_exists() {
  local image=$1
  local output
  if output=$(docker buildx imagetools inspect "$image" 2>&1); then
    return 0
  fi
  if [[ "$output" == *"manifest unknown"* || "$output" == *"no such manifest"* || "$output" == *"$image: not found"* ]]; then
    return 1
  fi
  echo "Could not confirm that registry image is absent: $image" >&2
  echo "$output" >&2
  return 2
}

for image in "$registry_image:$release_tag" "$registry_image:$release_tag-linux-amd64" "$registry_image:$release_tag-linux-arm64"; do
  if image_exists "$image"; then
    echo "Registry image already exists and will not be overwritten: $image" >&2
    exit 1
  else
    inspect_status=$?
    if [ "$inspect_status" -ne 1 ]; then
      exit "$inspect_status"
    fi
  fi
done

"$project_root/scripts/export_image.sh" "$release_tag"
for platform in linux/amd64 linux/arm64; do
  platform_name=${platform//\//-}
  archive="$project_root/dist/home-web-$release_tag-$platform_name.tar.gz"
  gzip -dc "$archive" | docker image load
  built_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "home-web:$release_tag")
  if [ "$built_platform" != "$platform" ]; then
    echo "Loaded image platform is $built_platform, expected $platform" >&2
    exit 1
  fi
  platform_image="$registry_image:$release_tag-$platform_name"
  docker image tag "home-web:$release_tag" "$platform_image"
  docker image push "$platform_image"
done

docker buildx imagetools create \
  --tag "$registry_image:$release_tag" \
  "$registry_image:$release_tag-linux-amd64" \
  "$registry_image:$release_tag-linux-arm64"
verify_manifest "$registry_image:$release_tag"

"$project_root/scripts/publish_image_release.sh" "$release_tag"
promote_latest
echo "Released $release_tag and updated $registry_image:latest"
