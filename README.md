# Market Insight Data

Free end-of-day Boursa Kuwait data collector for [Market Insight](https://market.hamad.id).

## Data source

The scraper reads public company-profile summary data directly from [Boursa Kuwait](https://www.boursakuwait.com.kw/). It does not use Yahoo Finance, Twelve Data, or a paid market-data API.

## Schedule

GitHub Actions runs at **10:16 UTC (13:16 Kuwait time)** every **Sunday through Thursday**. A manual run is also available from the repository's **Actions** tab.

## Output

- `data/latest.json` — latest validated stock snapshot
- `data/history.json` — accumulated end-of-day close and volume history

If a profile fails or returns incomplete values, the scraper retains that stock's previous valid record. If every profile fails, it exits without replacing the last snapshot.

## Important

This project provides informational delayed data, not investment advice. Public-page structure can change, so failed workflow runs should be reviewed.
