# Trendvektor sources (no Apify)

Apify Reddit/TikTok actors are **retired** (monthly hard-limit / billing dead).
Do not call `user-Apify-*`, `trudax/*`, `clockworks/*`, or any Apify actor.

## Working stack (prefer in this order)

1. **user-X** — trends, news, `search_posts_all`, `get_posts_counts_recent` (primary live signal).
2. **WebSearch / WebFetch** — same-day macro + public Reddit aggregators:
   - https://apewisdom.io/stocks/ORCL/ (24h WSB/Reddit mentions + sentiment %)
   - https://altindex.com/ticker/orcl/reddit-mentions (daily mentions + sentiment /100)
   - https://thedistributed.co/stocks/ORCL/ (30d Reddit mention mix)
3. **user-Treg** (when signed in) — cheap routed Reddit/TikTok, no Apify:
   - `treg.reddit.subreddit.posts` / `scrapecreators.reddit.search.posts` (~$0.001–0.002)
   - `treg.tiktok.search.videos` with `q` like `ORCL stock` / `Oracle stock` (~$0.001)
4. **user-Bright Data** — only if auth works (currently often 401); scrape aggregator pages, not Apify.

## Recording sources in `stockstrend-data.json`

- Omit `user-Apify-Reddit` / `user-Apify-TikTok` entirely.
- Prefer keys: `user-X`, `WebSearch`, `PublicReddit` (aggregators), `user-Treg` (live Reddit/TikTok), optional `user-Bright Data`.
- Prefer omitting Apify; a single "Apify retired" note in freshness is OK. Never keep `user-Apify-*` keys.

## Chart UI

`stockstrend.html` owns visual QA. Tick JSON commits should avoid touching HTML.
