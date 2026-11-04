import type { TokenUsage } from "@opencode/schema/token-usage"

// DeepSeek Flash list price in CNY per million tokens at peak hours; off-peak is half of every entry.
// DeepSeek charges cached input separately and has no separate cache-write price, so writes bill as cache misses.
const flash = {
  cacheRead: 0.04,
  input: 2,
  output: 8,
}

const empty: TokenUsage.Info = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

/**
 * Estimates spend at Flash prices so every session reads against one comparable amount.
 * Pass one session's tokens for a subagent, or the whole family's for a root session.
 */
export function flashCostCNY(tokens: readonly TokenUsage.Info[]) {
  const total = tokens.reduce(
    (sum, items) => ({
      input: sum.input + items.input,
      output: sum.output + items.output,
      reasoning: sum.reasoning + items.reasoning,
      cache: { read: sum.cache.read + items.cache.read, write: sum.cache.write + items.cache.write },
    }),
    empty,
  )

  const rate = (count: number, price: number) => (count * price) / 1_000_000

  return (
    rate(total.input + total.cache.write, flash.input) +
    rate(total.cache.read, flash.cacheRead) +
    rate(total.output + total.reasoning, flash.output)
  )
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
