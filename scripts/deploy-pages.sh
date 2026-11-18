#!/usr/bin/env sh
# Publish the built single-file game to the gh-pages branch (served by GitHub Pages).
# Uses a throwaway clone of the branch; never force-pushes. Does not change git config.
# In GitHub Actions, GITHUB_TOKEN authorises the push. Locally the existing remote does.
set -e
cd "$(dirname "$0")/.."
npm run build:dist >/dev/null
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
gitc() {
  if [ -n "$GITHUB_TOKEN" ]; then
    git -c "http.extraheader=AUTHORIZATION: bearer ${GITHUB_TOKEN}" "$@"
  else
    git "$@"
  fi
}
if gitc ls-remote --exit-code --heads "$REMOTE" gh-pages >/dev/null 2>&1; then
  gitc clone --quiet --branch gh-pages --single-branch "$REMOTE" "$TMP"
else
  git init --quiet "$TMP" && git -C "$TMP" checkout --quiet -b gh-pages && git -C "$TMP" remote add origin "$REMOTE"
fi
cp dist/index.html "$TMP/index.html"
touch "$TMP/.nojekyll"
git -C "$TMP" add -A
if git -C "$TMP" diff --cached --quiet; then echo "gh-pages already up to date"; else
  NAME=$(git config --get user.name || true)
  EMAIL=$(git config --get user.email || true)
  if [ -z "$NAME" ] || [ -z "$EMAIL" ]; then
    NAME="GitHub Actions"
    EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
  fi
  git -C "$TMP" -c user.name="$NAME" -c user.email="$EMAIL" commit --quiet -m "Publish build $(git rev-parse --short HEAD)"
  gitc -C "$TMP" push origin gh-pages
fi
rm -rf "$TMP"
