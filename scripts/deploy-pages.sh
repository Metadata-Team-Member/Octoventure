#!/usr/bin/env sh
# Publish the built single-file game to the gh-pages branch (served by GitHub Pages).
# Uses a throwaway clone of the branch; never force-pushes. Does not change git config.
# In GitHub Actions the clone and push use the Actions token in the remote URL (it is not printed).
# Locally the existing origin remote is used unchanged.
set -e
cd "$(dirname "$0")/.."
npm run build:dist >/dev/null
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
URL=$REMOTE
ggit() { git "$@"; }
if [ -n "$GITHUB_ACTIONS" ] && [ -n "$GITHUB_TOKEN" ]; then
  case "$REMOTE" in
    https://github.com/*) path=${REMOTE#https://github.com/} ;;
    git@github.com:*) path=${REMOTE#git@github.com:} ;;
    *) echo "deploy-pages: origin is not a github.com remote" >&2; exit 1 ;;
  esac
  path=${path%.git}
  URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${path}.git"
  # The token in the URL is the only credential. An empty helper clears any that would prompt.
  ggit() { git -c credential.helper= -c credential.https://github.com.helper= "$@"; }
fi
if ggit ls-remote --exit-code --heads "$URL" gh-pages >/dev/null 2>&1; then
  ggit clone --quiet --branch gh-pages --single-branch "$URL" "$TMP"
else
  git init --quiet "$TMP" && git -C "$TMP" checkout --quiet -b gh-pages && git -C "$TMP" remote add origin "$URL"
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
  ggit -C "$TMP" push --quiet origin gh-pages
  echo "published gh-pages"
fi
