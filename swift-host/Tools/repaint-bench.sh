#!/bin/zsh
# Full-screen repaints, the shape Claude Code's streaming UI actually produces: alt-screen,
# cursor home, every cell rewritten with colour. Not `cat` of a file — that only measures how
# fast a parser eats bytes, never how fast a grid redraws.

zmodload zsh/datetime
FRAMES=${1:-200}
COLS=${COLUMNS:-117}
ROWS=${LINES:-41}

# One line of coloured cells, built once so the loop measures the terminal and not zsh.
line=""
for ((c = 0; c < COLS; c++)); do
  line+=$'\e['"$((31 + c % 7))"'m#'
done
line+=$'\e[0m'

printf '\e[?1049h'                      # alt-screen, like a full-screen TUI
start=$EPOCHREALTIME
for ((f = 0; f < FRAMES; f++)); do
  printf '\e[H'                         # home, no clear — the redraw pattern that is cheapest
  for ((r = 0; r < ROWS - 1; r++)); do
    printf '%s\n' "$line"
  done
done
end=$EPOCHREALTIME
printf '\e[?1049l'                      # back to the normal screen

elapsed=$(( end - start ))
printf '[load] %d frames of %dx%d in %.3f s -> %.1f fps\n' \
  "$FRAMES" "$COLS" "$ROWS" "$elapsed" "$(( FRAMES / elapsed ))" > /tmp/loadfps.txt
