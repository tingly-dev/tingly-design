# Metric definitions

Each metric below is computed from the Meridian metrics layer and reported weekly in the Forecast launch dashboard.

## Forecast accuracy (MAPE)

Mean absolute percentage error between forecast ARR and actual ARR, per account, at a 3-month horizon. We take the forecast published on the first day of each month and compare it with actual ARR three months later, then report the median across accounts. Accounts with less than 12 months of billing history are excluded.

## Weekly active forecast

A Scale account counts as active in a week when at least one user opens a forecast or a scenario on two or more separate days. Views by Meridian staff and API reads are excluded.

## Add-on adoption

The number of Growth accounts with a paid Forecast add-on on the last day of the period. Trials and accounts in a payment grace period do not count.

## Scenarios saved

Scenarios saved per active account per month. A scenario edited several times in a month counts once.
