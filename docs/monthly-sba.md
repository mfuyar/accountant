# Banu's monthly SBA payment costs

User authorized $150 per month, including principal and interest, for Banu's SBA
loan 3600818310. The schedule starts December 15, 2026 and uses the 15th of each
month in America/New_York. The loan now has individual breakdowns for 37 visible
screenshot payments totaling $5,534. The user explicitly authorized full-year
2024/2025 costs: January/February 2024 and January/February/June 2025 are estimated
$150 monthly costs ($750), with bank payment and actual payment dates unverified.
2024 totals $1,800; 2025 totals $1,934, retaining the separate July 15 $134 payment.
November's recurring $150 remains unverified. These amounts are reconciled within
the existing $7,543.98 aggregate; the remaining $1,109.98 of the old lump sum is
isolated as a prior balance awaiting reconciliation. It is not represented as a
confirmed payment. The May/June screenshot payments are now identified within
the existing aggregate, rather than added again. Future recurring entries also
create individual breakdowns. The idempotent reconciliation script is
`scripts/reconcile-banu-sba-history.mjs`.

A second, separate loan, **MU payments for SBA**, is SBA loan 9930608208,
attributed to Banu with a $204 monthly project cost on the 15th, starting
December 15, 2026. Its full 2023–2026 history was reconciled from four screenshots:
41 confirmed payments total $9,468 (2023 $1,750; 2024 $3,000; 2025 $2,678;
January–October 2026 $2,040). November's recurring cost of $204 remains bank
payment unverified, bringing the parent to $9,672. Each of the 41 payments and
the unverified November cost is a separate breakdown; totals count only the
parent. The earlier five June–October entries are included once. Both distinct
July 15, 2025 rows are retained; no June 2025 payment is inferred. Principal and
interest are both counted per user instruction. It shares the personal-loan and
land-financing parent costs with the first loan, but has its own cost ID, monthly
markers and schedule. Future $204 entries also create individual breakdowns.

The idempotent reconciliation script is `scripts/reconcile-mu-sba-history.mjs`.

`scripts/record-monthly-sba.mjs` processes both loans separately, adding an
immutable version of each SBA cost and both parent costs in one atomic insert.
The total recurring cost is $354 per month. Monthly markers and unique
version keys prevent duplicates. The cost retains Banu as payer. Each entry says
the bank payment and principal/interest split are unverified; the script records
costs and does not send payments or mark the historical aggregate paid.

The local LaunchAgent `com.greenfort.accountant.monthly-sba` runs on the 15th at
9:15 AM and on login/load, catching up any missed months. It requires this Mac's
logged-in session, network access, the repository, its `.env`, and Node. A
powered-off Mac cannot run the job; it catches up when the user next logs in.
Logs are in `~/Library/Logs/GreenfortAccountant/monthly-sba*.log`.

Manual run:

```sh
node --env-file=.env scripts/record-monthly-sba.mjs
```

To disable the local schedule:

```sh
launchctl bootout "gui/$(id -u)/com.greenfort.accountant.monthly-sba"
```
