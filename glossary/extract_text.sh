#!/bin/bash
# Local only — NEVER commit txt/ or the epubs (public repo).
# Usage: ./extract_text.sh /path/to/epubs   -> txt/1-*.txt ... txt/8-*.txt (series order)
set -euo pipefail
mkdir -p txt
i=1
for b in Dungeon_Crawler_Carl Carls_Doomsday_Scenario The_Dungeon_Anarchists_Cookbook The_Gate_of_the_Feral_Gods The_Butchers_Masquerade The_Eye_of_the_Bedlam_Bride This_Inevitable_Ruin A_Parade_of_Horribles; do
  pandoc "$1/$b.epub" -t plain --wrap=none -o "txt/$i-$b.txt"; i=$((i+1))
done
