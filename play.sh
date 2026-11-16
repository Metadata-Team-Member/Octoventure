#!/usr/bin/env sh
# Zero-install on macOS/Linux: open the pre-built single-file game.
cd "$(dirname "$0")"
(xdg-open play/index.html || open play/index.html) 2>/dev/null
