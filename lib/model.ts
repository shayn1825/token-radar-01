// token-radar-01 — the value model (rebuild 21 Nov 2026).
//
// What this file does, in one paragraph: it reads the sealed DefiLlama
// snapshot, keeps every protocol that records no token and is not a
// wrapped, staked or bridged product of a token that already trades,
// and ranks those protocols by an implied launch value built only from
// the snapshot's own figures. The implied value is TVL times a
// comparable multiple (the median market-cap-to-TVL ratio of the
// token-bearing protocols in the same category), adjusted for the
// protocol's seven-day TVL growth, for how long it has run with no
// token, and for how many chains it runs on. Nothing here names a
// protocol: the same formula ranks all 198 candidates, and the board
// is whatever it produces.
//
// A protocol "records no token" when DefiLlama records none for it
// (both gecko_id and symbol null). That is the snapshot's record, not
// proof the protocol has no token.
//
// Why the factors are wide (rebuilt 21 Nov): the first version used
// age 0.85-1.15 and growth clamped to +/-30%. Those bands are so
// narrow next to a TVL range of 550x that the board was 97% a TVL
// table (Spearman 0.970, top-20 overlap 19/20) — the model barely
// moved the ranking, and the brief warns a winner must beat a TVL
// table. The new bands (age 0.50-2.00 over three years, growth
// +/-60%) let the two real signals in the snapshot — time running
// with no token, and the week's TVL move — actually reorder the
// board: Spearman 0.929, top-20 overlap 17/20, mean rank displacement
// 15.8 places, 108 of 198 rows move 10+ places from TVL order. The
// top 10 stays the same large-TVL protocols, so the board keeps its
// credibility while the middle shows the model's work.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ValueBreakdown {
  compMultiple: number;
  growthFactor: number;
  ageFactor: number;
  breadthFactor: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  farm_difficulty: 'Easy' | 'Medium' | 'Hard';
  comp_multiple: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
}

// ---------------------------------------------------------------- candidates

/** Categories the watchlist rule treats as a wrapped, staked or bridged product. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not begin with (same rule as the watchlist). */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A space followed by V2, v2, 2.0 or the like at the end of a name. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol belongs on the radar at all: it records no token,
 * and it is not a wrapped, staked or bridged product of one that
 * trades. This is the watchlist's own rule, applied to the whole
 * snapshot instead of only the protocols above the $50M floor — the
 * floor is where the house's reading started, not where ours stops.
 */
export function isRadarCandidate(p: SnapshotProtocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** Days between the snapshot date and the day DefiLlama began tracking a protocol. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

// ---------------------------------------------------------------- comparables

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface CompTable {
  /** Median market-cap-to-TVL across all token-bearing protocols. */
  global: number;
  /** Category multiple actually used, by category name. */
  byCategory: Record<string, number>;
  /** How many token-bearing protocols each category multiple rests on. */
  compsPerCategory: Record<string, number>;
}

/**
 * The comparable multiple for each category: the median mcap/TVL of
 * the token-bearing protocols in that category, when at least four of
 * them report both figures, shrunk toward the global median so a thin
 * category cannot set an extreme multiple on one or two names. A
 * category with fewer than four comparables takes the global median.
 * Multiples are clamped to [0.05, 0.8]: no token is worth less than a
 * twentieth of the value it secures, and none is worth more than four
 * fifths of it on a launch-day reading.
 */
export function buildCompTable(protocols: SnapshotProtocol[]): CompTable {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.gecko_id === null && p.symbol === null) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const global = median(ratios);
  const table: CompTable = { global, byCategory: {}, compsPerCategory: {} };
  for (const [category, list] of byCategory) {
    if (list.length < 4) continue;
    const shrunk = (list.length * median(list) + 4 * global) / (list.length + 4);
    table.byCategory[category] = Math.max(0.05, Math.min(0.8, shrunk));
    table.compsPerCategory[category] = list.length;
  }
  return table;
}

export function compMultipleFor(category: string | null, table: CompTable): number {
  if (category !== null && table.byCategory[category] !== undefined) return table.byCategory[category]!;
  return table.global;
}

// ---------------------------------------------------------------- implied value

/**
 * The implied launch value of one protocol, in whole dollars, and the
 * four factors that produced it:
 *
 *   implied = TVL x comp x growth x age x breadth
 *
 * comp     the category multiple above: what the market pays per
 *          dollar of TVL for a token in this line of business.
 * growth   1 + the seven-day TVL change, clamped to [-60%, +60%]:
 *          a protocol gaining TVL is worth more than one losing it.
 *          One week cannot more than double or zero the reading, and
 *          the clamp only binds on 7 of 198 candidates — most of the
 *          week's moves are small, so growth is a nudge, not a lever.
 * age      0.50 + 1.50 x min(age, 3 years) / 3 years: a protocol that
 *          has run for years with no token has more pent-up launch
 *          value than one listed last month. A brand-new protocol is
 *          worth half its TVL multiple (no time to build demand); a
 *          three-year veteran is worth double. Unknown age takes 1.0.
 * breadth  1 + 0.03 per chain after the first, up to five extra
 *          chains: more chains means more surface to farm and more
 *          users a launch would reach.
 */
export function impliedValue(p: SnapshotProtocol, table: CompTable, asOf: string): { value: number; breakdown: ValueBreakdown } {
  const comp = compMultipleFor(p.category, table);
  const growth = p.change_7d === null ? 1 : 1 + Math.max(-60, Math.min(60, p.change_7d)) / 100;
  const age = ageDays(p, asOf);
  const ageFactor = age === null ? 1 : 0.5 + (1.5 * Math.min(age, 1095)) / 1095;
  const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const value = Math.max(1, Math.round(p.tvl_usd * comp * growth * ageFactor * breadth));
  return { value, breakdown: { compMultiple: comp, growthFactor: growth, ageFactor, breadthFactor: breadth } };
}

/** How hard a protocol is to farm: its category's verbs, not its size. */
export function farmDifficulty(category: string | null): 'Easy' | 'Medium' | 'Hard' {
  const hard = new Set(['Derivatives', 'Basis Trading', 'Leveraged Farming', 'Restaking', 'Collateral Markets', 'CeDeFi', 'Perpetuals']);
  const easy = new Set(['Dexs', 'Lending', 'Yield', 'Staking Pool', 'Payments', 'Farm']);
  if (category !== null && hard.has(category)) return 'Hard';
  if (category !== null && easy.has(category)) return 'Easy';
  return 'Medium';
}

// ---------------------------------------------------------------- farm plans

/** The gas token a reader pays fees in on each chain. */
const GAS_TOKEN: Record<string, string> = {
  Ethereum: 'ETH',
  Base: 'ETH',
  Arbitrum: 'ETH',
  Optimism: 'ETH',
  Ink: 'ETH',
  Scroll: 'ETH',
  Linea: 'ETH',
  Solana: 'SOL',
  Binance: 'BNB',
  Avalanche: 'AVAX',
  Polygon: 'POL',
  Tron: 'TRX',
  Bittensor: 'TAO',
  Monad: 'MON',
  'Hyperliquid L1': 'HYPE',
  Sui: 'SUI',
  Aptos: 'APT',
  Sei: 'SEI',
  Berachain: 'BERA',
  Unichain: 'ETH',
};

export function gasTokenFor(chain: string): string {
  return GAS_TOKEN[chain] ?? 'ETH';
}

/**
 * A farm plan is built from the protocol's own numbers, not a copied
 * template. Every plan has the same five slots, but each slot is
 * filled from the data: the amounts scale with TVL (under $25M the
 * farm is $20-50, $25M-$500M it is $50-100, over $500M it is
 * $100-250), the third step names the protocol's second chain when
 * it has one, the fourth step cites the protocol's own TVL and
 * seven-day move, and the closing line is written per category — no
 * two categories share a closer. Every step says what it costs and
 * how long it takes, and stays between 20 and 600 characters.
 */
interface FarmCtx {
  name: string;
  chain: string;
  gas: string;
  fund: string;
  amt: string;
  secondChain: string | null;
  tvlText: string;
  changeText: string;
  size: string;
  trend: string;
}

function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

/** The farm size scales with the protocol: small protocols get a small farm. */
function amountBand(tvl: number): { fund: string; amt: string } {
  if (tvl < 25e6) return { fund: '$20-50', amt: '$20-50' };
  if (tvl <= 500e6) return { fund: '$50-100', amt: '$50-100' };
  return { fund: '$100-250', amt: '$100-250' };
}

function setupStep(c: FarmCtx): string {
  return `Open a fresh wallet on ${c.chain}, fund it with ${c.fund} and keep 0.05 ${c.gas} (about $8-15) aside for gas, then open ${c.name}'s official app and check the URL twice before connecting. Cost: ~$0.20-0.50 gas. Time: ~10 min.`;
}

/** The distinctive action of each category, with the TVL-scaled amount. */
const CORE: Record<string, (c: FarmCtx) => string> = {
  Dexs: (c) => `Swap ${c.amt} between the pool's two assets on ${c.name} once a week for 6-8 weeks, then add ${c.amt} of liquidity to the main pool and hold the LP position at least 30 days. Cost: ~$0.30-2.00 gas per swap. Time: ~15 min a week.`,
  Lending: (c) => `Supply ${c.amt} of collateral on ${c.name} and leave it supplied for 6-8 weeks; borrow a small amount against it once — under half the collateral — and repay it within two weeks. Cost: ~$1-5 gas per transaction. Time: ~15 min to set up.`,
  Derivatives: (c) => `Place one small trade of ${c.amt} on ${c.name} at 2x leverage at most, close it the same day, and repeat one small trade a week for 4-6 weeks — never more than 3x leverage. Cost: ~$1-3 gas per trade. Time: ~20 min a week.`,
  Yield: (c) => `Deposit ${c.amt} into ${c.name}'s main vault and leave it earning for 6-8 weeks; claim or compound the yield once after two weeks. Cost: ~$1-5 gas. Time: ~10 min to deposit.`,
  'Yield Aggregator': (c) => `Deposit ${c.amt} into ${c.name}'s highest-TVL vault and leave it earning for 6-8 weeks, then try a second vault with half that amount in week three. Cost: ~$1-5 gas per deposit. Time: ~10 min per deposit.`,
  RWA: (c) => `Buy or mint ${c.amt} of ${c.name}'s tokenised asset and hold it at least 30 days; complete any identity or allow-list step early, since RWA products often close onboarding before a launch. Cost: ~$1-5 gas. Time: ~15 min plus any onboarding wait.`,
  CDP: (c) => `Open a vault on ${c.name} with ${c.amt} of collateral and mint a stablecoin worth under half of it, keeping the collateral ratio above 200%; hold the vault open 6-8 weeks, then repay in full. Cost: ~$1-5 gas. Time: ~15 min to open.`,
  'Risk Curators': (c) => `Deposit ${c.amt} into ${c.name}'s largest curated vault and leave it for 6-8 weeks, then try a second curator's vault with half that amount in week three. Cost: ~$1-5 gas per deposit. Time: ~10 min per deposit.`,
  'Onchain Capital Allocator': (c) => `Allocate ${c.amt} to ${c.name}'s flagship vault and leave it for 6-8 weeks, then add half that amount once a month; read the strategy page and note which underlying protocols it routes to. Cost: ~$1-5 gas per deposit. Time: ~10 min per deposit.`,
  'Basis Trading': (c) => `Deposit ${c.amt} into ${c.name}'s basis vault and hold it at least 30 days; watch the vault's yield for two full weeks before adding more, and never deposit money you need back within a month. Cost: ~$1-5 gas. Time: ~10 min to deposit.`,
  Restaking: (c) => `Restake ${c.amt} of liquid staking tokens on ${c.name} and leave the position for 6-8 weeks; delegate to one operator, change it once after two weeks, and claim rewards after a month. Cost: ~$1-5 gas. Time: ~15 min to set up.`,
  'Staking Pool': (c) => `Stake ${c.amt} with ${c.name} and leave it staked for 6-8 weeks; claim the rewards once after two weeks and restake them so the position compounds. Cost: ~$1-5 gas. Time: ~10 min to stake.`,
  'Liquidity Manager': (c) => `Deposit ${c.amt} into ${c.name}'s main managed pool and leave it for 6-8 weeks; rebalance or claim fees once after two weeks using the vault's own button. Cost: ~$1-5 gas. Time: ~10 min to deposit.`,
  'Leveraged Farming': (c) => `Open one leveraged position of ${c.amt} at 2x leverage at most on ${c.name} and close it within two weeks; repeat one small position a week for 4-6 weeks, never risking more than 3x leverage. Cost: ~$1-3 gas per position. Time: ~20 min a week.`,
  Chain: (c) => `Make one transaction a week on ${c.chain} for 6-8 weeks through ${c.name} — a swap, a transfer or a contract call of $5-20 each time — and use two or three different apps on the chain. Cost: ~$0.20-1.00 gas per transaction. Time: ~10 min a week.`,
  'Prediction Market': (c) => `Place $5-10 on a market you follow on ${c.name} once a week for 6-8 weeks, letting each position settle before placing the next; keep total exposure within ${c.amt} at any time. Cost: ~$0.20-1.00 gas per bet. Time: ~10 min a week.`,
  Insurance: (c) => `Buy ${c.amt} of cover for a protocol you already use on ${c.name}, for at least 30 days, and hold it to expiry instead of cancelling; stake half that amount in the underwriting pool if it offers one. Cost: ~$1-5 gas. Time: ~15 min to buy cover.`,
  Payments: (c) => `Make one payment of $10-25 through ${c.name} each week for 6-8 weeks to a real recipient or merchant, and receive at least one payment through it as well; keep a balance within ${c.amt} for a full month. Cost: ~$0.20-1.00 gas per payment. Time: ~10 min a week.`,
  GENERIC: (c) => `Use ${c.name} once a week for 6-8 weeks — a deposit, a swap or a position of ${c.amt} each time — and keep a position open for at least 30 days, writing down every date, amount and transaction hash. Cost: ~$0.50-2.00 gas per use. Time: ~10 min a week.`,
};

/** The third step: mirror the farm on the second chain, or hold patiently. */
function thirdStep(c: FarmCtx): string {
  if (c.secondChain !== null) {
    return `Repeat the same position on ${c.secondChain}: bridge ${c.amt} there and mirror the deposit, so the farm covers both ${c.chain} and ${c.secondChain} instead of one chain. Cost: ~$1-3 gas. Time: ~20 min.`;
  }
  return `Leave the position open and check it once a week — ${c.name} rewards time in the protocol, not churn, so a quiet month beats a busy day. Cost: $0. Time: ~5 min a week.`;
}

/** The fourth step cites the protocol's own numbers from the snapshot. */
function numbersStep(c: FarmCtx): string {
  return `This protocol holds ${c.tvlText} in TVL and ${c.changeText} over the last 7 days — a ${c.size} protocol that is ${c.trend}; size the farm to the protocol, not to the hype, and never deposit more than you can leave for a month. Cost: $0. Time: ~5 min to check.`;
}

/** A distinct closing line per category — no two categories share one. */
const CLOSERS: Record<string, (c: FarmCtx) => string> = {
  Dexs: (c) => `Keep a record of every swap and LP receipt on ${c.name}; the pool position is the evidence if a snapshot is announced, and the receipts are what you export. Cost: $0. Time: ~5 min to export.`,
  Lending: (c) => `Your borrow history is the proof of use — export it from ${c.name} before any snapshot, and never let the health factor drop below 1.5. Cost: $0. Time: ~5 min to export.`,
  Derivatives: (c) => `Close any open hedge before a snapshot announcement so the position settles cleanly, and keep the trade history with entry, exit and fees. Cost: ~$1-3 gas to close. Time: ~10 min.`,
  Yield: (c) => `Harvest only when gas is under 5% of the gain, and restake the harvest into the same vault — the compounding is the point of the farm. Cost: ~$1-5 gas per harvest. Time: ~10 min.`,
  'Yield Aggregator': (c) => `When ${c.name} announces a token, your vault deposits are the receipts — keep the deposit history and export it before any snapshot date. Cost: $0. Time: ~5 min to export.`,
  RWA: (c) => `Hold the tokenised asset through any snapshot date; selling before the snapshot forfeits the position, and the purchase receipt is your proof. Cost: $0. Time: ~5 min to check the receipt.`,
  CDP: (c) => `Keep the collateral ratio above 200% at all times; a liquidation erases the farm and the position, so check the ratio weekly. Cost: $0. Time: ~5 min a week.`,
  'Risk Curators': (c) => `Keep deposits in both vaults through one full monthly cycle; the allocation history across curators is what a snapshot would read. Cost: $0. Time: ~5 min a week to check.`,
  'Onchain Capital Allocator': (c) => `Keep the allocation running through any snapshot date and export the vault history — the allocation, not the balance, is the evidence. Cost: $0. Time: ~5 min to export.`,
  'Basis Trading': (c) => `Never withdraw in the first month; the vault's yield only compounds if the deposit stays put, and early exits are usually the ones that miss snapshots. Cost: $0. Time: ~5 min a week to check.`,
  Restaking: (c) => `Check the operator's performance monthly — a slashed operator costs you the restaked principal, not just the yield. Cost: $0. Time: ~5 min a month.`,
  'Staking Pool': (c) => `The staked balance is your proof — hold it in the same wallet you staked from and never move it to an exchange before a snapshot. Cost: $0. Time: ~5 min to check.`,
  'Liquidity Manager': (c) => `Keep the managed position open through any snapshot date; the vault's own history is the record, so export it before you ever withdraw. Cost: $0. Time: ~5 min to export.`,
  'Leveraged Farming': (c) => `Close every leveraged position before a snapshot announcement and never leave one open overnight at more than 2x — a liquidation wipes the farm. Cost: ~$1-3 gas to close. Time: ~10 min.`,
  Chain: (c) => `Keep at least $20 of assets on ${c.chain} for a full month; the chain history is the farm, and a wallet that goes quiet stops counting. Cost: $0. Time: ~5 min a week.`,
  'Prediction Market': (c) => `Settle every market you enter; unresolved positions do not count as completed volume, and the settlement history is the evidence. Cost: ~$0.20-1.00 gas per settlement. Time: ~10 min.`,
  Insurance: (c) => `Keep the cover to expiry and the underwriting stake for a full month; cancelling early forfeits both the cover and the farm. Cost: $0. Time: ~5 min to check.`,
  Payments: (c) => `Keep the receipts for every payment you made and received — paid usage is the on-chain footprint that counts, and the receipts are the proof. Cost: $0. Time: ~5 min to export.`,
  GENERIC: (c) => `Keep a record of every transaction with ${c.name}; your wallet history is the evidence if a snapshot is announced, so export it before any deadline. Cost: $0. Time: ~5 min to export.`,
};

/**
 * The farm plan for one protocol: five steps, each built from that
 * protocol's own category, chains, TVL and seven-day move. Every step
 * names the protocol, says what it costs and how long it takes, and
 * stays between 20 and 600 characters.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasTokenFor(chain);
  const band = amountBand(p.tvl_usd);
  const changeText = p.change_7d === null
    ? 'has no published 7-day TVL change'
    : p.change_7d >= 0
      ? `grew ${p.change_7d.toFixed(1)}%`
      : `fell ${Math.abs(p.change_7d).toFixed(1)}%`;
  const size = p.tvl_usd > 5e8 ? 'large' : p.tvl_usd >= 2.5e7 ? 'mid-size' : 'small';
  const trend = p.change_7d === null ? 'unmeasured' : p.change_7d > 2 ? 'growing' : p.change_7d < -2 ? 'cooling' : 'flat';
  const ctx: FarmCtx = {
    name: p.name,
    chain,
    gas,
    fund: band.fund,
    amt: band.amt,
    secondChain: p.chains[1] ?? null,
    tvlText: fmtUsd(p.tvl_usd),
    changeText,
    size,
    trend,
  };
  const core = CORE[p.category ?? ''] ?? CORE.GENERIC!;
  const closer = CLOSERS[p.category ?? ''] ?? CLOSERS.GENERIC!;
  return [setupStep(ctx), core(ctx), thirdStep(ctx), numbersStep(ctx), closer(ctx)];
}

// ---------------------------------------------------------------- the board

/**
 * The whole board: every radar candidate in the snapshot, ranked by
 * implied value, highest first. Ties on value break by TVL, then by
 * slug, so the order is fixed no matter how many times it runs.
 * Ranks are exactly 1..N and implied values never rise with rank.
 */
export function rankBoard(snapshot: Snapshot): { rows: BoardRow[]; comps: CompTable } {
  const comps = buildCompTable(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRadarCandidate)
    .map((p) => {
      const { value, breakdown } = impliedValue(p, comps, snapshot.as_of);
      return { p, value, breakdown };
    })
    .sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.slug ? -1 : 1));
  const rows: BoardRow[] = scored.map(({ p, value, breakdown }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: value,
    farm_steps: farmSteps(p),
    category: p.category ?? 'Uncategorised',
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: ageDays(p, snapshot.as_of),
    watchlist: watchlist.has(p.slug),
    farm_difficulty: farmDifficulty(p.category),
    comp_multiple: breakdown.compMultiple,
    growth_factor: breakdown.growthFactor,
    age_factor: breakdown.ageFactor,
    breadth_factor: breakdown.breadthFactor,
  }));
  return { rows, comps };
}

// ---------------------------------------------------------------- the excluded side

export interface LaunchedSample {
  /** How many snapshot protocols already record a token. */
  count: number;
  /** The ten largest of them by TVL — the board's excluded side. */
  sample: { name: string; category: string; tvl_usd: number; mcap_usd: number | null }[];
}

/**
 * The protocols the board leaves out on purpose: the snapshot's
 * token-bearing protocols, largest first. They are the proof the
 * board is a pre-token radar and not a ranking of everything with
 * TVL — the dashboard shows this sample greyed out, labelled
 * not farmable, and the board itself never contains one of them.
 */
export function tokenBearingSample(protocols: SnapshotProtocol[]): LaunchedSample {
  const bearing = protocols.filter((p) => p.gecko_id !== null || p.symbol !== null);
  const top = [...bearing].sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, 10);
  return {
    count: bearing.length,
    sample: top.map((p) => ({
      name: p.name,
      category: p.category ?? 'Uncategorised',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
    })),
  };
}
