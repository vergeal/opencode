import type { TokenUsage } from "@opencode/schema/token-usage"

// DeepSeek Flash list price in CNY per million tokens at peak hours; off-peak is half of every entry.
// DeepSeek charges cached input separately and has no separate cache-write price, so writes bill as cache misses.
export const flashPrice = {
  cacheRead: 0.04,
  input: 2,
  output: 8,
}

const empty: TokenUsage.Info = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

function sum(tokens: readonly TokenUsage.Info[]) {
  return tokens.reduce(
    (total, items) => ({
      input: total.input + items.input,
      output: total.output + items.output,
      reasoning: total.reasoning + items.reasoning,
      cache: { read: total.cache.read + items.cache.read, write: total.cache.write + items.cache.write },
    }),
    empty,
  )
}

const rate = (count: number, price: number) => (count * price) / 1_000_000

/**
 * Splits a session's spend into the three lines a Flash invoice has: billable input (a cache write bills as a miss),
 * cache reads, and output including reasoning. Feeds the price-details popover; totals match {@link flashCostCNY}.
 */
export function flashCostBreakdown(tokens: readonly TokenUsage.Info[]) {
  const total = sum(tokens)
  const input = total.input + total.cache.write
  const output = total.output + total.reasoning

  const lines = {
    input: { tokens: input, amount: rate(input, flashPrice.input) },
    cacheRead: { tokens: total.cache.read, amount: rate(total.cache.read, flashPrice.cacheRead) },
    output: { tokens: output, amount: rate(output, flashPrice.output) },
  }

  return { ...lines, total: lines.input.amount + lines.cacheRead.amount + lines.output.amount }
}

/**
 * Estimates spend at Flash prices so every session reads against one comparable amount.
 * Pass one session's tokens for a subagent, or the whole family's for a root session.
 */
export function flashCostCNY(tokens: readonly TokenUsage.Info[]) {
  return flashCostBreakdown(tokens).total
}

/**
 * Formats CNY amounts as `CNY ¥20.79`. The code carries the currency, because `¥` alone is also Japanese yen.
 * Amounts below one yuan keep four decimals, because Flash prices are small enough that two decimals would round a
 * short session to zero.
 */
export function createCNY(locale: string) {
  const format = (digits: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CNY",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })

  const fine = format(4)
  const coarse = format(2)

  return (value: number) => `CNY ${(Math.abs(value) < 1 ? fine : coarse).format(value)}`
}
