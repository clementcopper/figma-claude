#!/bin/zsh
# Black-box width check: print something, ask the terminal where the cursor now is (DSR, ESC[6n),
# and compare against what a correct terminal must answer. Works without seeing a single pixel.
probe() {
  local label="$1" text="$2" expect="$3"
  printf '\r\e[K%s' "$text"
  printf '\e[6n'
  local reply
  read -s -t 2 -d R reply
  local col="${reply##*;}"
  local got=$((col - 1))
  if [[ "$got" == "$expect" ]]; then
    print -r -- "  OK   $label: $got cells" >> /tmp/width.txt
  else
    print -r -- "  FAIL $label: $got cells, expected $expect" >> /tmp/width.txt
  fi
}
rm -f /tmp/width.txt
probe "ascii 8x"        "abcdefgh"   8
probe "emoji 4x wide"   "🔴🟢🔵🟡"   8
probe "CJK 4x wide"     "日本語漢"   8
probe "umlauts"         "äöüß"       4
probe "combining e+acute" $'é'  1
probe "box drawing"     "┌───┐"      5
printf '\r\e[K'
