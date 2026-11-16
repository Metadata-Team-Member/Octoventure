#!/usr/bin/env sh
# Publish the built single-file game to the gh-pages branch (served by GitHub Pages).
# Uses a throwaway clone of the branch; never force-pushes.
set -e
cd "$(dirname "$0")/.."
npm run build:dist >/dev/null
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
if git ls-remote --exit-code --heads "$REMOTE" gh-pages >/dev/null 2>&1; then
  git clone --quiet --branch gh-pages --single-branch "$REMOTE" "$TMP"
else
  git init --quiet "$TMP" && git -C "$TMP" checkout --quiet -b gh-pages && git -C "$TMP" remote add origin "$REMOTE"
fi
cp dist/index.html "$TMP/index.html"
touch "$TMP/.nojekyll"
git -C "$TMP" add -A
if git -C "$TMP" diff --cached --quiet; then echo "gh-pages already up to date"; else
  git -C "$TMP" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit --quiet -m "Publish build $(git rev-parse --short HEAD)"
  git -C "$TMP" push origin gh-pages
fi
rm -rf "$TMP"
