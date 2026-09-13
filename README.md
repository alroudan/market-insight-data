# Market Insight Data

Free end-of-day Kuwait market data collector for [Market Insight](https://market.hamad.id).

## Sources

- Delayed prices, volume, valuation multiples and technical indicators: [TradingView Kuwait market scanner](https://www.tradingview.com/markets/stocks-kuwait/)
- Official disclosures and financial-statement links: [Boursa Kuwait](https://www.boursakuwait.com.kw/)

No Yahoo Finance, Twelve Data or paid market-data account is used.

## Schedule

GitHub Actions runs at **10:16 UTC (13:16 Kuwait time)** every **Sunday through Thursday**. A manual run is available from the repository's **Actions** tab.

## Output

- `data/latest.json` — the latest validated snapshot for the configured Kuwait stocks

The collector retains a stock's previous valid record if the current scan does not return it. It refuses to replace the snapshot if no fresh market records are returned.

## Important

This project provides delayed informational data, not investment advice. Public data interfaces can change, so failed workflow runs should be reviewed.
