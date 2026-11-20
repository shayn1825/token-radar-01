# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shayn1825/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shayn1825/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — the best token launch radar. It reads a sealed DefiLlama snapshot of 758 protocols, finds the 198 that record no token and are not a wrapped, staked or bridged product of one that trades, and ranks them by an implied launch value built only from the snapshot's own figures: TVL times a comparable multiple (the median market-cap-to-TVL ratio of token-bearing protocols in the same sector), adjusted for seven-day growth, for how long the protocol has run with no token, and for how many chains it runs on. Every row carries a concrete farm plan — what to do, what it costs, how long it takes. The dashboard is a static page: a sortable, filterable board, a detail view for every protocol with its value breakdown, and the methodology in full.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

At grade time the snapshot is at `/input/snapshot.json` and the output directory is `/output`. Locally, point `--input` at the kit's `input/snapshot.json`. Node 22.18 or later, standard library only, no network. The program runs twice and writes identical bytes both times.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1c6jcmp6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
