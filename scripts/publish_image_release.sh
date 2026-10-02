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

: "${FORGEJO_TOKEN:?set FORGEJO_TOKEN to the shared token with repository and package write access}"

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
package_version=$(node -p "require('$project_root/package.json').version")
if [ "$release_tag" != "v$package_version" ]; then
  echo "Release tag $release_tag does not match package version v$package_version" >&2
  exit 2
fi

commit_file="$project_root/dist/home-web-$release_tag.commit"
if [ ! -s "$commit_file" ]; then
  echo "Missing export commit marker; run scripts/export_image.sh first" >&2
  exit 1
fi

head_commit=$(git -C "$project_root" rev-parse HEAD)
export_commit=$(tr -d '[:space:]' < "$commit_file")
if [ "$export_commit" != "$head_commit" ]; then
  echo "Export was built from $export_commit, but HEAD is $head_commit" >&2
  exit 1
fi
if [ -n "$(git -C "$project_root" status --porcelain --untracked-files=all -- . ':(exclude)dist')" ]; then
  echo "Files outside dist/ have uncommitted changes; refusing to publish" >&2
  exit 1
fi

assets=()
asset_names=()
for platform in linux-amd64 linux-arm64; do
  archive_name="home-web-$release_tag-$platform.tar.gz"
  archive="$project_root/dist/$archive_name"
  checksum="$archive.sha256"
  if [ ! -s "$archive" ] || [ ! -s "$checksum" ]; then
    echo "Missing $archive_name or its checksum; run scripts/export_image.sh first" >&2
    exit 1
  fi
  (
    cd "$(dirname "$archive")"
    sha256sum -c "$(basename "$checksum")"
  )
  assets+=("$archive" "$checksum")
  asset_names+=("$archive_name" "$(basename "$checksum")")
done

api_url="https://git.lan/api/v1/repos/dev/home-web"
auth_config=$(mktemp)
response=$(mktemp)
release_payload=
release_id=
uploaded_asset_ids=()

cleanup() {
  local exit_status=$?
  local asset_id
  trap - EXIT
  if [ "$exit_status" -ne 0 ] && [ -n "$release_id" ]; then
    for asset_id in "${uploaded_asset_ids[@]}"; do
      if ! curl --silent --show-error --fail --config "$auth_config" --output /dev/null --request DELETE "$api_url/releases/$release_id/assets/$asset_id"; then
        echo "Could not remove partial Forgejo asset $asset_id; delete it manually" >&2
      fi
    done
  fi
  rm -f "$auth_config" "$response"
  if [ -n "$release_payload" ]; then
    rm -f "$release_payload"
  fi
  exit "$exit_status"
}
trap cleanup EXIT

chmod 600 "$auth_config"
printf 'header = "Authorization: token %s"\n' "$FORGEJO_TOKEN" > "$auth_config"

tag_commit=$(git -C "$project_root" rev-parse -q --verify "refs/tags/$release_tag^{commit}" 2>/dev/null || true)
if [ -n "$tag_commit" ] && [ "$tag_commit" != "$head_commit" ]; then
  echo "Release tag $release_tag already identifies a different commit" >&2
  exit 1
fi
if [ -z "$tag_commit" ]; then
  git -C "$project_root" tag "$release_tag" "$head_commit"
fi
git -C "$project_root" push origin "refs/tags/$release_tag"

status=$(curl --silent --show-error --config "$auth_config" --output "$response" --write-out '%{http_code}' "$api_url/releases/tags/$release_tag")
if [ "$status" = "404" ]; then
  release_payload=$(mktemp)
  node - "$release_tag" "$head_commit" > "$release_payload" <<'NODE'
const [tagName, targetCommitish] = process.argv.slice(2);
process.stdout.write(JSON.stringify({ tag_name: tagName, target_commitish: targetCommitish, name: tagName, draft: false, prerelease: false }));
NODE
  status=$(curl --silent --show-error --config "$auth_config" --header 'Content-Type: application/json' --output "$response" --write-out '%{http_code}' --request POST --data-binary "@$release_payload" "$api_url/releases")
  if [ "$status" != "201" ]; then
    echo "Forgejo release creation failed with HTTP $status" >&2
    cat "$response" >&2
    exit 1
  fi
elif [ "$status" != "200" ]; then
  echo "Forgejo release lookup failed with HTTP $status" >&2
  cat "$response" >&2
  exit 1
fi

release_id=$(node - "$response" "${asset_names[@]}" <<'NODE'
const fs = require('node:fs');
const [responsePath, ...assetNames] = process.argv.slice(2);
const release = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
const existing = new Set((release.assets ?? []).map((asset) => asset.name));
const duplicates = assetNames.filter((name) => existing.has(name));
if (duplicates.length) {
  console.error(`Release already has asset(s): ${[...new Set(duplicates)].sort().join(', ')}`);
  process.exit(1);
}
process.stdout.write(String(release.id));
NODE
)

upload_asset() {
  local path=$1
  local name
  local upload_status
  name=$(basename "$path")
  upload_status=$(curl --silent --show-error --config "$auth_config" --output "$response" --write-out '%{http_code}' --form "attachment=@$path" "$api_url/releases/$release_id/assets?name=$name")
  if [ "$upload_status" != "201" ]; then
    echo "Forgejo asset upload failed for $name with HTTP $upload_status" >&2
    cat "$response" >&2
    return 1
  fi
  node - "$response" <<'NODE'
const fs = require('node:fs');
process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).id));
NODE
}

for asset in "${assets[@]}"; do
  asset_id=$(upload_asset "$asset")
  uploaded_asset_ids+=("$asset_id")
  echo "Uploaded $(basename "$asset")"
done
uploaded_asset_ids=()
