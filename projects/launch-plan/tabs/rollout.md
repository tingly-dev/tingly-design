# Rollout

## Phases

1. **Private beta** (Aug 4 – Sep 14). Twelve design partners, weekly calls with Product and Design. Exit criteria: MAPE under 12% and no open data-correctness issues.
2. **Public beta** (Sep 15 – Nov 3). All Scale accounts, opt-in from Settings. Exit criteria: MAPE under 10% across the cohort and p95 recompute time under 20 minutes.
3. **General availability** (Nov 4). On by default for Scale and Enterprise; the add-on becomes available to Growth the same day.

## Risks

| Risk | Mitigation | Owner |
| --- | --- | --- |
| Accounts with short billing history get unstable forecasts | Require 12 months of history; show a confidence band and a clear notice below that | Daniel Okafor |
| Customers read the forecast as a commitment | Label every chart as a model estimate; link to the assumptions in one click | Mei Lin |
| Add-on pricing slows Growth expansion deals | Review win rate and discount requests 30 days after launch | Tom Becker |

## Open questions

Should scenarios be shareable outside the workspace? Several design partners send scenarios to their board as PDFs today, and a read-only link would save them that step, but it widens the data exposure we have to review with Security before launch.

Do we backfill forecasts for accounts that connect after GA? A backfill of 12 monthly versions lets new accounts see accuracy history on day one; it adds about 40 minutes of compute per account.

*Sample document; Meridian is a fictional company.*
