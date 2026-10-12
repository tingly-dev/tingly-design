# Requirements

## Goals

1. Give every Scale account a 12-month ARR forecast that refreshes nightly from connected billing and CRM data.
2. Make each forecast explainable: every change between two versions is attributed to a named driver (new business, expansion, contraction, churn).
3. Let finance teams run scenarios by adjusting drivers, without exporting data out of Meridian.

## Non-goals

- Bookings, cash or GAAP revenue forecasts. Forecast models ARR only in this release.
- Custom model training per account. All accounts use the same model family, calibrated on their own history.
- Write-back to Salesforce opportunities or forecast categories.

## Success metrics

Measured 60 days after general availability. Definitions are in *Metric definitions*.

| Metric | Target | Beta today |
| --- | --- | --- |
| Forecast accuracy (MAPE, 3-month horizon) | ≤ 8% | 9.4% |
| Scale accounts with a weekly active forecast | 40% | 31% |
| Growth accounts on the Forecast add-on | 150 | Not offered yet |
| Scenarios saved per active account per month | 4 | 2.6 |

## Functional requirements

- **Drivers.** New business, expansion, contraction and churn, each modeled per segment (plan, region, sales motion). Segments come from the existing metrics layer.
- **Scenarios.** Up to 10 saved scenarios per workspace. A scenario overrides one or more drivers for a date range and never changes the base forecast.
- **Explainability.** A variance view compares any two forecast versions and lists the drivers that account for at least 90% of the change.
- **Freshness.** Forecasts recompute nightly at 02:00 in the workspace time zone and within 15 minutes of a manual refresh.
- **Permissions.** Viewing follows dashboard permissions. Editing drivers and saving scenarios requires the Finance admin role.

## Pricing and packaging

Forecast is included in Scale and Enterprise at no extra cost. Growth accounts can add it for $8 per seat per month ($6 billed yearly). Starter does not include Forecast; the upgrade prompt appears only to workspace admins.
