#!/usr/bin/env bash
# check.sh — mutedit checks: static check, unit tests, live check, the gate.
#
# | Call                       | Needs                 | Does                                                          | Time  |
# | -------------------------- | --------------------- | ------------------------------------------------------------- | ----- |
# | check.sh                   | -                     | prints this help                                              | -     |
# | check.sh --unit            | claude                | validate + unit tests (behaviour, security, speed, command)   | ~3 s  |
# | check.sh --live            | claude, tmux          | validate + live check in a real terminal, no model            | ~40 s |
# | check.sh --live --baseline | claude, tmux          | the above + the same session without the mod, to compare      | ~45 s |
# | check.sh --gate            | claude, tmux          | gate after a code change: validate + unit + live --baseline   | ~50 s |
# | ... --keep (with --live)   |                       | keeps the temp folder and the session copy                    |       |
#
# Flags combine (--unit --live = the gate without --baseline).
# Unit: `claude plugin test` finds tests only inside the plugin folder, so plugin/
# and tests/unit/*.test.ts are copied to a temp folder and run there.
# Live: make_session (below) builds a made-up session (every permission mode,
# every file tool, errors, a rejection, a plan file, a parallel group, bad paths);
# `claude --resume` draws it again through the mod in a hidden tmux window and the
# screen is read. /mutedit is driven too. Nothing is sent to the model. Your own
# on/off state is read first and put back at the end, also when a check fails.
# Output: tests/results/ (unit.txt, live-*.txt). Exit 0 only when every check passes.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
MOD=$(dirname "$HERE")/plugin
OUT=$HERE/results
SID=00000000-0000-4000-8000-000000000001
TMUX_NAME=mutedit-live
UNIT=0 LIVE=0 BASELINE=0 KEEP=0

for a in "$@"; do
  case $a in
    --unit) UNIT=1 ;;
    --live) LIVE=1 ;;
    --baseline) BASELINE=1 ;;
    --keep) KEEP=1 ;;
    --gate) UNIT=1 LIVE=1 BASELINE=1 ;;
    *) echo "error: unknown flag '$a'; allowed: --unit, --live, --baseline, --keep, --gate"; exit 1 ;;
  esac
done
if [ $UNIT = 0 ] && [ $LIVE = 0 ]; then
  sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  [ $# = 0 ] && exit 0
  echo "error: --baseline and --keep need --live; run: tests/check.sh --live $*"; exit 1
fi
NEED="claude"; [ $LIVE = 1 ] && NEED="claude tmux sha1sum"
for c in $NEED; do
  command -v $c >/dev/null || { echo "error: $c not found; install it and run: tests/check.sh $*"; exit 1; }
done

T0=$(date +%s%N)
mkdir -p "$OUT"
PASS=0 FAIL=0
check() { # check <name> <0|1>
  if [ "$2" = 0 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; fi
}

WORK="" PROJ="" ORIG=""
cleanup() {
  [ -n "$WORK" ] || return 0
  if [ -n "$ORIG" ]; then set_state "$ORIG" >/dev/null 2>&1 || echo "error: your mutedit state was not put back; run: /mutedit $ORIG"; fi
  tmux kill-session -t $TMUX_NAME 2>/dev/null
  sleep 2  # claude writes its session once more while it closes
  if [ $KEEP = 1 ]; then echo "kept: $WORK, $PROJ"; else rm -rf "$WORK" "$PROJ"; fi
}
trap cleanup EXIT

# Open the session in a tall window (Claude Code draws on its own screen, no scrollback), wait for the prompt
open_session() { # open_session <extra claude args>
  tmux kill-session -t $TMUX_NAME 2>/dev/null
  # an installed copy of the mod is switched off, so only the copy under test (or none) draws
  printf '{"enabledPlugins":{"mutedit@mutedit":false}}' > "$WORK/no-installed-mod.json"
  tmux new-session -d -s $TMUX_NAME -x 220 -y 1500 -c "$WORK" "claude --settings $WORK/no-installed-mod.json $1 --resume $SID; sleep 60"
  local end=$((SECONDS + 40))
  while [ $SECONDS -lt $end ]; do
    local screen; screen=$(tmux capture-pane -p -t $TMUX_NAME)
    if grep -q "trust this folder" <<<"$screen"; then tmux send-keys -t $TMUX_NAME Down Enter; fi
    if grep -q "No conversation found" <<<"$screen"; then echo "error: claude did not find the session; the session format changed? check make_session in tests/check.sh against a fresh session file"; exit 1; fi
    grep -q "end of synthetic session" <<<"$screen" && grep -q "shift+tab to cycle" <<<"$screen" && { sleep 1; return 0; }
    sleep 0.5
  done
  echo "error: the session did not open in 40 s; look at: tmux attach -t $TMUX_NAME"; exit 1
}
capture() { tmux capture-pane -p -t $TMUX_NAME | grep -v '^\s*$' > "$1"; }
# Wait until the screen shows text (fixed string); 1 when it does not in 15 s
wait_for() {
  local end=$((SECONDS + 15))
  until tmux capture-pane -p -t $TMUX_NAME | grep -qF -- "$1"; do [ $SECONDS -ge $end ] && return 1; sleep 0.3; done
}
# Wait until a command answer row is exactly "mutedit: <text>" (Claude Code adds the "mutedit: " itself)
wait_answer() {
  local end=$((SECONDS + 15))
  until tmux capture-pane -p -t $TMUX_NAME | sed -n 's/^[[:space:]]*⎿[[:space:]]*//p' | sed 's/[[:space:]]*$//' | grep -qxF -- "mutedit: $1"; do
    [ $SECONDS -ge $end ] && return 1; sleep 0.3
  done
}
# Type a slash command and press Enter
slash() { tmux send-keys -t $TMUX_NAME -l "$1"; sleep 0.5; tmux send-keys -t $TMUX_NAME Enter; }
# Set the saved on/off state through the command in a fresh session
set_state() {
  open_session "--plugin-dir $MOD"
  slash "/mutedit $1"
  wait_answer "$1"
}

# Expected summary lines: <file tail> as the mod must draw it
expected() {
  for m in default acceptEdits auto bypassPermissions dontAsk; do
    printf '%s\n' "updated · $WORK/$m-a.txt · +1 −1"
    printf '%s\n' "created · $WORK/$m-b.txt · 3 lines"
    printf '%s\n' "updated · $WORK/$m-c.txt · +2 −3"
    printf '%s\n' "replace cell c1 · $WORK/$m.ipynb"
    printf '%s\n' "insert cell c9 · $WORK/$m.ipynb"
    printf '%s\n' "delete cell c2 · $WORK/$m.ipynb"
  done
  printf '%s\n' "created · /work/home/.claude/plans/demo-plan.md · 2 lines"
  printf '%s\n' "updated · $WORK/group.txt · +1 −1"
  printf '%s\n' 'updated · '"$WORK"'/esc\x1b[31mred\x1b[0m.txt · +1 −1'
  printf '%s\n' 'updated · '"$WORK"'/line\nbreak.txt · +1 −1'
  printf '%s\n' 'created · '"$WORK"'/evil\u202ecod.sh · 1 lines'
  printf '%s\n' 'created · '"$WORK"'/zw\u200bsp\u2028x.txt · 1 lines'
  printf '%s\n' "updated · $WORK/broken.txt · +1 −1"
  printf '%s\n' 'replace cell c\x1b[2Jx · '"$WORK"'/n.ipynb'
}
MOD_LINE='^(updated|created) · |^[a-z]+ cell .* · '
STOCK_DIFF='Added [0-9]+ lines?, removed|Wrote [0-9]+ lines? to|Updated cell '

check_mod_view() { # check_mod_view <capture file> <label>
  local f=$1 l=$2 n
  while IFS= read -r line; do
    grep -qxF -- "$line" "$f"; check "$l: missing line: $line" $?
  done < <(expected)
  grep -qE "^created · .*….*/end\.txt · 1 lines$" "$f"; check "$l: long path not cut to one line" $?
  n=$(grep -cE "$MOD_LINE" "$f"); [ "$n" = 39 ]; check "$l: mod lines $n, expected 39" $?
  n=$(grep -cE "$STOCK_DIFF" "$f"); [ "$n" = 0 ]; check "$l: stock diff lines $n, expected 0" $?
  n=$(grep -cE "File must be read first|File has not been read yet" "$f"); [ "$n" = 5 ]; check "$l: errors drawn $n, expected 5 (stock)" $?
  n=$(grep -cE "User rejected write to (.*/)?default-rejected.txt" "$f"); [ "$n" = 1 ]; check "$l: user rejection drawn $n, expected 1 (stock)" $?
  n=$(grep -cP '[\x00-\x08\x0b-\x1f\x7f\x{200b}-\x{200f}\x{2028}-\x{202e}\x{2066}-\x{2069}\x{feff}]' "$f"); [ "$n" = 0 ]; check "$l: lines with raw unsafe chars $n, expected 0" $?
}

# Made-up session for the live check: make_session <out.jsonl>
# Every record is made up: neutral files under /work/demo (swapped for the temp
# folder later), no data from real sessions. Record fields follow what Claude
# Code 2.1.295 writes to its session files. One section per permission mode (all
# file tools, success, error, user rejection, plan file), then a parallel group of
# reads + edit, then bad paths. Strings below are already JSON-escaped.
# A call is one line: tool <TAB> input <TAB> toolUseResult <TAB> result text <TAB> flags
# (flags: "" | err | err,denial); calls in one argument split by newlines are one parallel message.
make_session() {
  local out=$1 D=/work/demo TAB=$'\t' NL=$'\n'
  local OK_EDIT='"The file has been updated successfully."' OK_NEW='"File created successfully."'
  local NOT_READ_R='"Error: File has not been read yet. Read it first before writing to it."'
  local NOT_READ_T='"<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>"'
  local REJ_R='"User rejected tool use"'
  local REJ_T="\"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.\""
  local rows=() parent=null t=0 n=0 C k j m

  patch() { # patch <line>... → one hunk at 1,1
    local o=0 w=0 l ls=""
    for l in "$@"; do
      [ "${l:0:1}" = + ] || o=$((o + 1)); [ "${l:0:1}" = - ] || w=$((w + 1)); ls+=",\"$l\""
    done
    printf '[{"oldStart":1,"oldLines":%d,"newStart":1,"newLines":%d,"lines":[%s]}]' $o $w "${ls:1}"
  }
  edit() { # edit <path>
    printf 'Edit\t{"file_path":"%s","old_string":"two","new_string":"TWO"}\t{"filePath":"%s","oldString":"two","newString":"TWO","originalFile":"one\\ntwo\\nthree\\n","structuredPatch":%s,"userModified":false,"replaceAll":false}\t%s\t' \
      "$1" "$1" "$(patch ' one' -two +TWO ' three')" "$OK_EDIT"
  }
  create() { # create <path> [content]
    local c=${2-'x\ny\nz\n'}
    printf 'Write\t{"file_path":"%s","content":"%s"}\t{"type":"create","filePath":"%s","content":"%s","structuredPatch":[],"originalFile":null,"userModified":false}\t%s\t' \
      "$1" "$c" "$1" "$c" "$OK_NEW"
  }
  overwrite() { # overwrite <path>
    printf 'Write\t{"file_path":"%s","content":"p\\nq\\n"}\t{"type":"update","filePath":"%s","content":"p\\nq\\n","structuredPatch":%s,"originalFile":"x\\ny\\nz\\n","userModified":false}\t%s\t' \
      "$1" "$1" "$(patch -x -y -z +p +q)" "$OK_EDIT"
  }
  cell() { # cell <mode> <id> <source> <path>
    local mode=""; [ "$1" = replace ] || mode=",\"edit_mode\":\"$1\""
    printf 'NotebookEdit\t{"notebook_path":"%s","cell_id":"%s","new_source":"%s"%s}\t{"new_source":"%s","old_source":"print(1)","cell_type":"code","language":"python","edit_mode":"%s","cell_id":"%s","error":"","notebook_path":"%s","original_file":"{}","updated_file":"{}"}\t"Updated cell %s"\t' \
      "$4" "$2" "$3" "$mode" "$3" "$1" "$2" "$4" "$2"
  }
  read_() { # read_ <path>
    printf 'Read\t{"file_path":"%s"}\t{"type":"text","file":{"filePath":"%s","content":"x\\n","numLines":2,"startLine":1,"totalLines":2}}\t"1\\tx\\n2\\t"\t' "$1" "$1"
  }
  failed() { # failed <call> <toolUseResult> <text> <flags>
    local f; IFS=$TAB read -r -a f <<<"$1"
    printf '%s\t%s\t%s\t%s\t%s' "${f[0]}" "${f[1]}" "$2" "$3" "$4"
  }
  uuid5() { # uuid5 <name> → uuid5(NAMESPACE_URL, name), as Python's uuid module
    local h; h=$( { printf '\x6b\xa7\xb8\x11\x9d\xad\x11\xd1\x80\xb4\x00\xc0\x4f\xd4\x30\xc8'; printf '%s' "$1"; } | sha1sum)
    printf '%s-%s-5%s-%x%s-%s' ${h:0:8} ${h:8:4} ${h:13:3} $(( (0x${h:16:1} & 3) | 8 )) ${h:17:3} ${h:20:12}
  }
  base() { # base <kind> → record head without the closing brace; uses parent, t
    local u; u=$(uuid5 "$1$t")
    printf '{"parentUuid":%s,"isSidechain":false,"type":"%s","uuid":"%s","timestamp":"2026-01-01T%02d:%02d:%02d.000Z","userType":"external","entrypoint":"cli","cwd":"%s","sessionId":"%s","version":"2.1.295"' \
      "$parent" "$1" "$u" $((t / 3600)) $((t / 60 % 60)) $((t % 60)) "$D" "$SID"
  }
  add() { rows+=("$1"); parent=\"$(sed 's/.*"uuid":"\([^"]*\)".*/\1/' <<<"${1:0:300}")\"; t=$((t + 1)); }
  group() { # group <calls> <message id>
    local c f tid uses=() u r
    while IFS= read -r c; do
      IFS=$TAB read -r -a f <<<"$c"
      tid=$(printf 'toolu_%024d' $n); n=$((n + 1))
      add "$(base assistant),\"message\":{\"id\":\"$2\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-5-5\",\"content\":[{\"type\":\"tool_use\",\"id\":\"$tid\",\"name\":\"${f[0]}\",\"input\":${f[1]}}],\"stop_reason\":\"tool_use\",\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}"
      uses+=("$parent$TAB$tid$TAB$c")
    done <<<"$1"
    for u in "${uses[@]}"; do
      IFS=$TAB read -r -a f <<<"$u"  # src, tid, tool, input, result, text, flags
      r="{\"tool_use_id\":\"${f[1]}\",\"type\":\"tool_result\",\"content\":${f[5]}"
      [[ ${f[6]-} == err* ]] && r+=',"is_error":true'
      r="$(base user),\"message\":{\"role\":\"user\",\"content\":[$r}]},\"toolUseResult\":${f[4]},\"sourceToolAssistantUUID\":${f[0]}"
      [[ ${f[6]-} == *denial ]] && r+=',"toolDenialKind":"user-rejected"'
      add "$r}"
    done
  }
  section() { # section <number> <mode> <call or group>...
    local k=$1 mode=$2 j=0 c; shift 2
    rows+=("{\"type\":\"permission-mode\",\"permissionMode\":\"$mode\",\"sessionId\":\"$SID\"}")
    add "$(base user),\"message\":{\"role\":\"user\",\"content\":\"section $((k + 1)): $mode\"},\"permissionMode\":\"$mode\"}"
    for c in "$@"; do group "$c" "$(printf 'msg_%02d_%02d' $k $j)"; j=$((j + 1)); done
  }

  k=0
  for m in default acceptEdits plan auto bypassPermissions dontAsk; do
    if [ $m = plan ]; then
      section $k $m "$(create /work/home/.claude/plans/demo-plan.md '1. change two to TWO\n2. check\n')"
    else
      C=("$(edit "$D/$m-a.txt")" "$(create "$D/$m-b.txt")" "$(overwrite "$D/$m-c.txt")"
         "$(cell replace c1 'print(2)' "$D/$m.ipynb")" "$(cell insert c9 'print(3)' "$D/$m.ipynb")"
         "$(cell delete c2 '' "$D/$m.ipynb")" "$(failed "$(edit "$D/$m-e.txt")" "$NOT_READ_R" "$NOT_READ_T" err)")
      [ $m = default ] && C+=("$(failed "$(create "$D/default-rejected.txt")" "$REJ_R" "$REJ_T" err,denial)")
      section $k $m "${C[@]}"
    fi
    k=$((k + 1))
  done
  section 6 auto "$(read_ "$D/r1.txt")$NL$(read_ "$D/r2.txt")$NL$(read_ "$D/r3.txt")$NL$(edit "$D/group.txt")"
  local long; printf -v long '%*s' 50000 ''; long="$D/${long// /d/}end.txt"
  section 7 auto "$(edit "$D/esc\u001b[31mred\u001b[0m.txt")" "$(edit "$D/line\nbreak.txt")" \
    "$(create "$D/evil\u202ecod.sh" 'x\n')" "$(create "$D/zw\u200bsp\u2028x.txt" 'x\n')" "$(create "$long" 'x\n')" \
    "Edit${TAB}{\"file_path\":\"$D/broken.txt\",\"old_string\":\"a\",\"new_string\":\"b\"}${TAB}{\"filePath\":\"$D/broken.txt\",\"oldString\":\"a\",\"newString\":\"b\",\"originalFile\":\"a\\n\",\"structuredPatch\":[null,{\"lines\":null},{\"lines\":[null,5,\"+b\",\"-a\"]}],\"userModified\":false,\"replaceAll\":false}${TAB}$OK_EDIT${TAB}" \
    "$(cell replace 'c\u001b[2Jx' 'print(4)' "$D/n.ipynb")"
  add "$(base assistant),\"message\":{\"id\":\"msg_end\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-5-5\",\"content\":[{\"type\":\"text\",\"text\":\"end of synthetic session\"}],\"stop_reason\":\"end_turn\",\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}"
  printf '%s\n' "${rows[@]}" > "$out"
  echo "8 sections, $n tool calls, ${#rows[@]} records -> $out"
}

# Unit tests on a temp copy of plugin/ + tests/unit
run_unit() {
  local u; u=$(mktemp -d "${TMPDIR:-/tmp}/mutedit-unit.XXXXXX")
  cp -r "$MOD/." "$u/"
  rm -rf "$u/.claude-plugin/types" "$u/tsconfig.json"
  for t in "$HERE"/unit/*.test.ts; do
    sed "s#'../../plugin/hooks/#'./#" "$t" > "$u/hooks/$(basename "$t")"
  done
  claude plugin test "$u" > "$OUT/unit.txt" 2>&1
  local code=$?
  sed -i "s#$u/##g" "$OUT/unit.txt"
  rm -rf "$u"
  grep -E "^speed ms:|^rows ms:|^\(fail\)" "$OUT/unit.txt"
  local ran; ran=$(grep -E " pass$| fail$" "$OUT/unit.txt" | tr -d ' ' | tr '\n' ' ')
  echo "unit: $ran"
  [ $code = 0 ]; check "unit: claude plugin test failed, see $OUT/unit.txt" $?
}

# Static check: exactly these hooks and calls
V=$(claude plugin validate "$MOD" 2>&1)
grep -q "Validation passed" <<<"$V"; check "validate: not passed" $?
got=$(sed -n 's/.*register\.js hooks: //p' <<<"$V")
[ "$got" = "session.start, command.run{command=mutedit}, ui.render{component=ToolResult}" ]; check "validate: hooks are '$got'" $?
got=$(sed -n 's/.*register\.js calls: //p' <<<"$V" | sed 's/ (via [a-z]*)//g')
[ "$got" = '$.command.register, $.store.get, $.store.set, $.ui.ask, $.ui.resolve' ]; check "validate: calls are '$got'" $?


[ $UNIT = 1 ] && run_unit

# Live check
if [ $LIVE = 1 ]; then
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/mutedit-live.XXXXXX")
  PROJ=$HOME/.claude/projects/$(printf '%s' "$WORK" | sed 's#[^A-Za-z0-9]#-#g')
  mkdir -p "$PROJ"
  make_session "$WORK/session.jsonl" >/dev/null || { echo "error: session not built; look at make_session in tests/check.sh"; exit 1; }
  sed "s#/work/demo#$WORK#g" "$WORK/session.jsonl" > "$PROJ/$SID.jsonl"
  rm "$WORK/session.jsonl"

  # 1. Read your saved state from the dialog, dismiss it, then switch on
  open_session "--plugin-dir $MOD"
  slash "/mutedit"
  if wait_for "Turn it on or off?"; then
    ORIG=$(tmux capture-pane -p -t $TMUX_NAME | sed -n 's/.*mutedit is \(on\|off\)\. Turn it on or off?.*/\1/p' | tail -1)
    tmux send-keys -t $TMUX_NAME Escape
    wait_answer "$ORIG (unchanged)"; check "dialog: Esc did not answer exactly 'mutedit: $ORIG (unchanged)'" $?
  else
    check "dialog: /mutedit opened no dialog" 1
  fi
  [ -n "$ORIG" ] || { echo "error: could not read your mutedit state; nothing was changed"; exit 1; }
  echo "your state: $ORIG (put back at the end)"
  slash "/mutedit on"
  wait_answer on; check "/mutedit on: no answer exactly 'mutedit: on'" $?

  # 2. On: every edit is one line, also in ctrl+o
  open_session "--plugin-dir $MOD"
  capture "$OUT/live-mod.txt"
  check_mod_view "$OUT/live-mod.txt" "mod"
  tmux send-keys -t $TMUX_NAME C-o
  wait_for "Showing detailed transcript"; check "ctrl+o: detailed view did not open" $?
  sleep 2
  capture "$OUT/live-mod-ctrlo.txt"
  check_mod_view "$OUT/live-mod-ctrlo.txt" "ctrl+o"

  # 3. Off in the same session: rows already drawn keep one line, also on a redraw by ctrl+o
  tmux send-keys -t $TMUX_NAME C-o; sleep 1
  slash "/mutedit off"
  wait_answer off; check "/mutedit off: no answer exactly 'mutedit: off'" $?
  tmux send-keys -t $TMUX_NAME C-o
  wait_for "Showing detailed transcript"; sleep 2
  capture "$OUT/live-off-redraw.txt"
  n=$(grep -cE "$MOD_LINE" "$OUT/live-off-redraw.txt"); [ "$n" = 39 ]; check "off, redraw: old rows one line $n, expected 39" $?
  n=$(grep -cE "$STOCK_DIFF" "$OUT/live-off-redraw.txt"); [ "$n" = 0 ]; check "off, redraw: stock diff lines $n, expected 0" $?

  # 4. Off is kept: a new session draws every edit as the full diff
  open_session "--plugin-dir $MOD"
  capture "$OUT/live-off.txt"
  n=$(grep -cE "$MOD_LINE" "$OUT/live-off.txt"); [ "$n" = 0 ]; check "off, new session: mod lines $n, expected 0" $?
  n=$(grep -cE "$STOCK_DIFF" "$OUT/live-off.txt"); [ "$n" -ge 30 ]; check "off, new session: diff blocks $n, expected >= 30" $?

  # 5. The dialog switches on: pick 1 (On); a new session is one line again
  slash "/mutedit"
  wait_for "mutedit is off. Turn it on or off?"; check "dialog: no question 'mutedit is off. Turn it on or off?'" $?
  tmux send-keys -t $TMUX_NAME 1
  wait_for "New Edit, Write and NotebookEdit results show one line."; check "dialog: picking On gave no answer" $?
  open_session "--plugin-dir $MOD"
  capture "$OUT/live-on-again.txt"
  n=$(grep -cE "$MOD_LINE" "$OUT/live-on-again.txt"); [ "$n" = 39 ]; check "on again, new session: mod lines $n, expected 39" $?

  # 6. Without the mod: the session must really draw diffs there
  if [ $BASELINE = 1 ]; then
    open_session ""
    capture "$OUT/live-stock.txt"
    n=$(grep -cE "$MOD_LINE" "$OUT/live-stock.txt"); [ "$n" = 0 ]; check "stock: mod lines $n, expected 0" $?
    n=$(grep -cE "$STOCK_DIFF" "$OUT/live-stock.txt"); [ "$n" -ge 30 ]; check "stock: diff blocks $n, expected >= 30" $?
    echo "stock: $n diff blocks drawn without the mod"
  fi

fi

echo "checks: $PASS passed, $FAIL failed"
echo "output: $OUT/"
echo "took $(( ($(date +%s%N) - T0) / 1000000 )) ms"
[ $FAIL = 0 ]
