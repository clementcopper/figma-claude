#!/bin/zsh
# What Claude Code's UI actually puts on screen, and where terminals differ: box drawing has to
# join without gaps, wide emoji must occupy two cells or everything after them shifts, combining
# marks must not, and 256-colour plus truecolour have to be distinguishable.

print -r -- $'\e[1mBox drawing\e[0m'
print -r -- '  ┌────────────┬────────────┐'
print -r -- '  │ left       │ right      │'
print -r -- '  ├────────────┼────────────┤'
print -r -- '  │ ▁▂▃▄▅▆▇█   │ ░▒▓█ ◐◑◒◓  │'
print -r -- '  └────────────┴────────────┘'
print -r -- '  ╭──────────╮  ═══╗  ┏━━━┓'
print -r -- '  ╰──────────╯     ║  ┗━━━┛'

print -r -- $'\n\e[1mWide characters — the pipes must line up\e[0m'
print -r -- '  |abcdefgh|'
print -r -- '  |🔴🟢🔵🟡|'
print -r -- '  |日本語漢字|'
print -r -- '  |✓✗→←↑↓⚠️ |'

print -r -- $'\n\e[1mCombining marks and umlauts\e[0m'
print -r -- '  |äöüßÄÖÜ|  |éàö|  |Größe|'

print -r -- $'\n\e[1mColour\e[0m'
printf '  256:  '
for i in 196 202 208 214 220 226 190 154 118 82 46; do printf '\e[38;5;%dm██\e[0m' $i; done
printf '\n  true: '
for i in 0 32 64 96 128 160 192 224 255; do printf '\e[38;2;%d;100;200m██\e[0m' $i; done
printf '\n  attr: \e[1mbold\e[0m \e[2mdim\e[0m \e[3mitalic\e[0m \e[4munderline\e[0m \e[7mreverse\e[0m \e[9mstrike\e[0m\n'
