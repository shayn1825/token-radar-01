// token-radar-01 — the value model.
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
 * growth   1 + the seven-day TVL change, clamped to [-30%, +30%]:
 *          a protocol gaining TVL is worth more than one losing it,
 *          but one week's move cannot double or halve the reading.
 * age      0.85 + 0.30 x min(age, 3 years) / 3 years: a protocol that
 *          has run for years with no token has more pent-up launch
 *          value than one listed last month. Unknown age takes 1.0.
 * breadth  1 + 0.03 per chain after the first, up to five extra
 *          chains: more chains means more surface to farm and more
 *          users a launch would reach.
 */
export function impliedValue(p: SnapshotProtocol, table: CompTable, asOf: string): { value: number; breakdown: ValueBreakdown } {
  const comp = compMultipleFor(p.category, table);
  const growth = p.change_7d === null ? 1 : 1 + Math.max(-30, Math.min(30, p.change_7d)) / 100;
  const age = ageDays(p, asOf);
  const ageFactor = age === null ? 1 : 0.85 + (0.3 * Math.min(age, 1095)) / 1095;
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

/** A farm-plan template: steps with {name}, {chain} and {gas} filled in. */
type PlanTemplate = (name: string, chain: string, gas: string) => string[];

function fill(template: string[], name: string, chain: string, gas: string): string[] {
  return template.map((s) => s.replaceAll('{name}', name).replaceAll('{chain}', chain).replaceAll('{gas}', gas));
}

const GENERIC_PLAN: PlanTemplate = (name, chain, gas) => fill([
  `Fund a fresh wallet with $50-100 on ${chain} and keep 0.05 ${gas} (about $8-15) aside for gas; open ${name}'s official app, check the URL twice, and connect that wallet.`,
  `Use ${name} once a week for 6-8 weeks: a deposit, a swap or a position, $20-50 each time, so the address shows repeat activity instead of a single visit.`,
  `Keep a position open in ${name} for at least 30 days and write down every deposit date, amount and transaction hash in one note.`,
  `Join ${name}'s official announcements channel and check it weekly; if a points program opens, join it the same week and keep every receipt.`,
], name, chain, gas);

const PLANS: Record<string, PlanTemplate> = {
  Dexs: (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s swap page and connect your wallet there.`,
    `Swap $20-50 between the pool's two assets once a week for 6-8 weeks; each swap costs roughly $0.30-2 in gas on ${chain}.`,
    `Add $50-100 of liquidity to ${name}'s main pool and hold the LP position at least 30 days; note the pool, the deposit date and the transaction hash.`,
    `Swap on ${name} at least twice a month after that, and vote or stake if the app offers it, so the address keeps showing activity.`,
    `Watch ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Lending: (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s app and connect your wallet there.`,
    `Supply $50-100 of collateral on ${name} and leave it supplied for 6-8 weeks; supplying costs one transaction, about $1-5 on ${chain}.`,
    `Borrow $10-20 against the collateral once, repay it within two weeks, and keep the borrow well under half the collateral so nothing gets liquidated.`,
    `Top the supply up by $20-50 once a month and use the app again, so the address shows a living position rather than a single deposit.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Derivatives: (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.1 ${gas} (about $15-30) for gas; open ${name}'s trading page and connect your wallet there.`,
    `Place one small trade of $10-25 with 2x leverage at most, close it the same day, and write down the entry, the exit and the fee it cost.`,
    `Repeat one small trade a week for 4-6 weeks, never risking more than $25 a trade and never using more than 3x leverage.`,
    `Provide $50-100 of liquidity to ${name}'s vault or pool if it offers one, and hold it at least 30 days.`,
    `Watch ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Yield: (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s vault list and connect your wallet there.`,
    `Deposit $50-100 into ${name}'s main vault and leave it earning for 6-8 weeks; the deposit costs one transaction, about $1-5 on ${chain}.`,
    `Claim or compound the yield once, after at least two weeks, and note the date, the amount and the transaction hash.`,
    `Add $20-50 to the vault once a month so the address shows a growing position rather than a single deposit.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Yield Aggregator': (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s vault list and connect your wallet there.`,
    `Deposit $50-100 into ${name}'s highest-TVL vault and leave it earning for 6-8 weeks; the deposit costs one transaction, about $1-5 on ${chain}.`,
    `Try a second vault with $20-50 in week three, so the address shows more than one strategy in use.`,
    `Claim or compound the yield once a month and write down each date, amount and transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  RWA: (name, chain, gas) => fill([
    `Bridge $100-250 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s app, read its eligibility page, and connect your wallet there.`,
    `Buy or mint $50-100 of ${name}'s tokenised asset and hold it at least 30 days; the purchase costs one transaction, about $1-5 on ${chain}.`,
    `Complete any identity or allow-list step ${name} asks for early, since RWA products often close onboarding before a launch.`,
    `Hold the position through one full monthly cycle and keep the purchase receipt, the date and the transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  CDP: (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s vault page and connect your wallet there.`,
    `Open a vault with $50-100 of collateral and mint $10-20 of the stablecoin, keeping the collateral ratio above 200% so nothing gets liquidated.`,
    `Hold the vault open for 6-8 weeks and repay the minted amount in full before closing it; note every date and transaction hash.`,
    `Use the minted stablecoin once, for a swap or a deposit inside ${name}, so the address shows the full loop.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Risk Curators': (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s vault list and connect your wallet there.`,
    `Deposit $50-100 into ${name}'s largest curated vault and leave it for 6-8 weeks; the deposit costs one transaction, about $1-5 on ${chain}.`,
    `Try a second curator's vault with $20-50 in week three, so the address shows more than one allocation.`,
    `Keep the deposits through one full monthly cycle and write down each vault, date, amount and transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Onchain Capital Allocator': (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s vault list and connect your wallet there.`,
    `Allocate $50-100 to ${name}'s flagship vault and leave it for 6-8 weeks; the deposit costs one transaction, about $1-5 on ${chain}.`,
    `Add $20-50 to the same vault once a month so the address shows a growing allocation rather than a single deposit.`,
    `Read ${name}'s strategy page and note which underlying protocols it routes to, in case a later step asks for them by name.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Basis Trading': (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.1 ${gas} (about $15-30) for gas; open ${name}'s vault page and connect your wallet there.`,
    `Deposit $50-100 into ${name}'s basis vault and hold it at least 30 days; the deposit costs one transaction, about $1-5 on ${chain}.`,
    `Watch the vault's yield for two full weeks before adding more, and never deposit money you need back within a month.`,
    `Top up by $20-50 once, after the first month, and write down every deposit date, amount and transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Restaking: (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s restake page and connect your wallet there.`,
    `Restake $20-50 of liquid staking tokens on ${name} and leave the position for 6-8 weeks; the restake costs one transaction, about $1-5 on ${chain}.`,
    `Delegate the position to one operator or vault, and change it once after two weeks so the address shows an active choice.`,
    `Claim any restaking rewards after a month and note the date, the amount and the transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Staking Pool': (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s staking page and connect your wallet there.`,
    `Stake $50-100 with ${name} and leave it staked for 6-8 weeks; the stake costs one transaction, about $1-5 on ${chain}.`,
    `Claim the staking rewards once, after at least two weeks, and note the date, the amount and the transaction hash.`,
    `Restake the claimed rewards once so the position compounds, and keep the stake running through a full month.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Liquidity Manager': (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s vault list and connect your wallet there.`,
    `Deposit $50-100 into ${name}'s main managed pool and leave it for 6-8 weeks; the deposit costs one transaction, about $1-5 on ${chain}.`,
    `Rebalance or claim fees once after two weeks, using the vault's own button, and note the date and the transaction hash.`,
    `Add $20-50 once a month so the address shows a growing position rather than a single deposit.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Leveraged Farming': (name, chain, gas) => fill([
    `Bridge $100-200 to ${chain} and keep 0.1 ${gas} (about $15-30) for gas; open ${name}'s farm page and connect your wallet there.`,
    `Open one leveraged position of $25-50 at 2x leverage at most, and close it within two weeks; write down the entry, the exit and the fee.`,
    `Repeat one small position a week for 4-6 weeks, never risking more than $50 at a time and never using more than 3x leverage.`,
    `Keep the position's collateral ratio above 200% at all times so a price swing cannot liquidate it.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Chain: (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.1 ${gas} (about $15-30) for gas; open ${name}'s bridge or app page and connect your wallet there.`,
    `Make one transaction a week on ${chain} for 6-8 weeks: a swap, a transfer or a contract call, $5-20 each time.`,
    `Use two or three different apps on ${chain} so the address shows real chain usage, not a single contract.`,
    `Hold at least $20 of assets on ${chain} for a full month and write down every activity date and transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  'Prediction Market': (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s market list and connect your wallet there.`,
    `Place $5-10 on a market you follow, once a week for 6-8 weeks, and let each position settle before placing the next.`,
    `Trade both sides over time: buy YES on one market and NO on another, so the address shows real market activity.`,
    `Keep total exposure under $50 at any time and write down each market, side, amount and settlement date.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Insurance: (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s cover page and connect your wallet there.`,
    `Buy $20-50 of cover for a protocol you already use, for at least 30 days; the purchase costs one transaction, about $1-5 on ${chain}.`,
    `Hold the cover to expiry instead of cancelling it, and note the cover, the dates and the transaction hash.`,
    `Stake $20-50 in ${name}'s underwriting pool if it offers one, and leave it for a full month.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
  Payments: (name, chain, gas) => fill([
    `Bridge $50-100 to ${chain} and keep 0.05 ${gas} (about $8-15) for gas; open ${name}'s app and connect your wallet there.`,
    `Make one payment of $10-25 through ${name} each week for 6-8 weeks, to a real recipient or merchant.`,
    `Receive at least one payment through ${name} as well, so the address shows both sides of the flow.`,
    `Keep a balance of $20-50 in ${name} for a full month and write down each payment's date, amount and transaction hash.`,
    `Check ${name}'s announcements weekly; if a points program opens, join it the same week and keep every receipt.`,
  ], name, chain, gas),
};

/**
 * The farm plan for one protocol: the template of its category, or
 * the generic plan when its category has none. Every step names the
 * protocol, its main chain and its gas token, says what it costs and
 * how long it takes, and stays between 20 and 600 characters.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasTokenFor(chain);
  const template = (p.category !== null && PLANS[p.category] !== undefined ? PLANS[p.category]! : GENERIC_PLAN);
  return template(p.name, chain, gas);
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
    .sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
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
