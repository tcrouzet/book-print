#!/bin/bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export GIT_TERMINAL_PROMPT=0

REPOSITORY=$(gh repo view --json nameWithOwner,defaultBranchRef)
REPO=$(jq -er '.nameWithOwner' <<< "$REPOSITORY")
BRANCH=$(jq -er '.defaultBranchRef.name' <<< "$REPOSITORY")
[[ "$(git branch --show-current)" == "$BRANCH" ]] || { printf 'Lance release.sh depuis la branche par défaut : %s\n' "$BRANCH" >&2; exit 1; }

CURRENT=$(jq -er '.version | select(test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"))' manifest.json) \
  || { printf 'Version attendue dans manifest.json : majeur.mineur.patch, sans préversion.\n' >&2; exit 1; }
PATCH_VERSION=${CURRENT##*.}
TAG="${CURRENT%.*}.$((10#$PATCH_VERSION + 1))"
MIN_APP=$(jq -er '.minAppVersion' manifest.json)

npm test
npm run build
node scripts/check-resources.mjs

git add .
if ! git diff --cached --quiet; then
  current_date=$(date +"%Y-%m-%d %H:%M:%S")
  git commit -m "Sync before release $current_date"
fi
git push -u origin "$BRANCH"
[[ -z "$(git status --porcelain)" ]] || { printf 'Arbre git non propre\n' >&2; exit 1; }

RELEASE_TMP=$(mktemp -d "${TMPDIR:-/tmp}/bookbinder-release.XXXXXX")
trap 'rm -rf -- "$RELEASE_TMP"' EXIT
jq --arg v "$TAG" '.version = $v' manifest.json > "$RELEASE_TMP/manifest.json"
mv -- "$RELEASE_TMP/manifest.json" manifest.json
npm version "$TAG" --no-git-tag-version --ignore-scripts
if [[ -f versions.json ]]; then
  jq --arg v "$TAG" --arg m "$MIN_APP" '. + {($v): $m}' versions.json > "$RELEASE_TMP/versions.json"
  mv -- "$RELEASE_TMP/versions.json" versions.json
fi

git add .
git commit -m "Release $TAG"
git push -u origin "$BRANCH"

PUBLISHED=$(gh api "repos/$REPO/contents/manifest.json" --jq '.content | @base64d | fromjson')
jq -en --slurpfile local manifest.json --argjson published "$PUBLISHED" '$local[0] == $published' >/dev/null \
  || { printf 'Publication arrêtée : le manifest GitHub diffère du manifest de la release.\n' >&2; exit 1; }

# GitHub Actions builds and publishes the artifacts from this tag.
git tag "$TAG"
git push origin "$TAG"
printf 'Release %s confiée à GitHub Actions : https://github.com/%s/actions\n' "$TAG" "$REPO"
