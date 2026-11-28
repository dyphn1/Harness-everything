#!/bin/bash
# 24 arms, order from F2 report (seed 552202611); one stream per runner.
set -u
I=<path>
O=<path>
cd $I
stream() { local r=$1; shift; local auth=$1; shift
  for spec in "$@"; do arm=${spec%:*}; pair=${spec#*:}
    a=(); [ -n "$auth" ] && a=(--auth-dir "$auth")
    echo "$(date +%T) start $r $arm $pair" >> $O/../progress.log
    OPENCODE_PASSWORD=f24-$RANDOM$RANDOM perl -e 'alarm 2900; exec @ARGV' node behavioral-evals/ledger-pairs/arm.js --runner $r --arm $arm --pair $pair --out $O ${a[@]+"${a[@]}"} --timeout-ms 2700000 < /dev/null > $O/../$r-$pair-$arm.out 2>&1
    echo "$(date +%T) end $r $arm $pair exit=$?" >> $O/../progress.log
  done; }
mkdir -p $O
# codex stream already completed 13:22-13:27
stream opencode "" baseline:4 treatment:4 baseline:1 treatment:1 treatment:3 baseline:3 treatment:2 baseline:2 &
stream agy "" baseline:2 treatment:2 baseline:4 treatment:4 treatment:3 baseline:3 treatment:1 baseline:1 &
wait; echo ALLDONE >> $O/../progress.log
