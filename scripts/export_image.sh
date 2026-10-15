#!/bin/bash

set -euo pipefail

usage() {
  echo "Usage: $0 <release-tag>" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

release_tag=$1
if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Release tag must match vMAJOR.MINOR.PATCH: $release_tag" >&2
  exit 2
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
package_version=$(node -p "require('$project_root/package.json').version")
if [ "$release_tag" != "v$package_version" ]; then
  echo "Release tag $release_tag does not match package version v$package_version" >&2
  exit 2
fi

head_commit=$(git -C "$project_root" rev-parse HEAD)
if [ -n "$(git -C "$project_root" status --porcelain --untracked-files=all -- . ':(exclude)dist')" ]; then
  echo "Files outside dist/ have uncommitted changes; refusing to build a release" >&2
  exit 1
fi

node "$project_root/scripts/check-build-platforms.js"

dist_dir="$project_root/dist"
mkdir -p "$dist_dir"
commit_file="$dist_dir/home-web-$release_tag.commit"
rm -f "$commit_file"
temporary_archive=
trap 'if [ -n "$temporary_archive" ]; then rm -f "$temporary_archive"; fi' EXIT

for platform in linux/amd64 linux/arm64; do
  image="home-web:$release_tag"
  platform_name=${platform//\//-}
  archive_name="home-web-$release_tag-$platform_name.tar.gz"
  archive="$dist_dir/$archive_name"
  checksum="$archive.sha256"
  temporary_archive=$(mktemp "$dist_dir/.$archive_name.XXXXXX")

  docker buildx build \
    --platform "$platform" \
    --build-arg "APP_VERSION=$package_version" \
    --build-arg "VCS_REF=$head_commit" \
    --tag "$image" \
    --load \
    "$project_root"

  built_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
  if [ "$built_platform" != "$platform" ]; then
    echo "Built image platform is $built_platform, expected $platform" >&2
    exit 1
  fi

  docker image save "$image" | gzip -n > "$temporary_archive"
  mv "$temporary_archive" "$archive"
  temporary_archive=
  (
    cd "$dist_dir"
    sha256sum "$archive_name" > "$archive_name.sha256"
  )

  size=$(wc -c < "$archive")
  digest=$(cut -d " " -f 1 "$checksum")
  echo "Archive: $archive"
  echo "Image: $image"
  echo "Platform: $platform"
  echo "Size: $size bytes"
  echo "SHA-256: $digest"
done

printf '%s\n' "$head_commit" > "$commit_file"
echo "Commit: $head_commit"
