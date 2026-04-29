#!/bin/bash
# Fetches the base StarDict bundle (Princeton WordNet, ~10MB tar.bz2)
# from the dict.org community mirror and stages the three files
# under dict/wordnet/{base.ifo, base.idx, base.dict.dz}. Idempotent —
# skips the download if the files already exist.
#
# License note: this StarDict pack repackages Princeton WordNet 2.x,
# which is distributed under the WordNet license (BSD-style, free for
# any use including redistribution). See:
#   https://wordnet.princeton.edu/license-and-commercial-use

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DICT_DIR="$PROJECT_ROOT/dict/wordnet"
URL="http://download.huzheng.org/dict.org/stardict-dictd_www.dict.org_wn-2.4.2.tar.bz2"
ARCHIVE_NAME="stardict-wordnet.tar.bz2"
EXPECTED_SUBDIR="stardict-dictd_www.dict.org_wn-2.4.2"

write_color() {
    case "${2:-}" in
        Red)    printf "\033[31m%s\033[0m\n" "$1" >&2 ;;
        Green)  printf "\033[32m%s\033[0m\n" "$1" >&2 ;;
        Yellow) printf "\033[33m%s\033[0m\n" "$1" >&2 ;;
        Blue)   printf "\033[34m%s\033[0m\n" "$1" >&2 ;;
        *)      printf "%s\n" "$1" >&2 ;;
    esac
}

if [[ -f "$DICT_DIR/base.ifo" && -f "$DICT_DIR/base.idx" && -f "$DICT_DIR/base.dict.dz" ]]; then
    write_color "WordNet StarDict already present at $DICT_DIR — skipping download" "Yellow"
    exit 0
fi

mkdir -p "$DICT_DIR"
cd "$DICT_DIR"

write_color "Downloading WordNet StarDict from $URL ..." "Blue"
if command -v curl >/dev/null 2>&1; then
    curl -sL -o "$ARCHIVE_NAME" "$URL"
elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$ARCHIVE_NAME" "$URL"
else
    write_color "Neither curl nor wget is available" "Red"
    exit 1
fi

write_color "Extracting ..." "Blue"
tar -xjf "$ARCHIVE_NAME"

# Normalise file names so the build script doesn't depend on the
# archive's internal naming convention.
mv "$EXPECTED_SUBDIR/dictd_www.dict.org_wn.ifo" "$DICT_DIR/base.ifo"
mv "$EXPECTED_SUBDIR/dictd_www.dict.org_wn.idx" "$DICT_DIR/base.idx"
mv "$EXPECTED_SUBDIR/dictd_www.dict.org_wn.dict.dz" "$DICT_DIR/base.dict.dz"

# Tidy up the staging dir + archive.
rm -rf "$EXPECTED_SUBDIR" "$ARCHIVE_NAME"

write_color "Staged: base.ifo / base.idx / base.dict.dz at $DICT_DIR" "Green"
