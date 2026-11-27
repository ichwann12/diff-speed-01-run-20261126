# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![make.fun · rank](https://make.fun/badge/diff-speed-01-run-20261126/ichwann12/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![make.fun · reward](https://make.fun/badge/diff-speed-01-run-20261126/ichwann12/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0: `solve.js` returns
exactly the same patch for every `{ old, new }`, but runs Myers's search over
interned line ids (integer compares, no per-point path objects) instead of
string compares, with the search state kept in flat `Int32Array` rows.

`main.ts` reads `/input/cases.json`, answers each case alone with `run`, and
writes `/output/answers.json`. Dependency-free, Node built-ins only.
