# Banu's SBA and Flagstar financing costs

The first construction draw was bank-funded on **July 16, 2026**; the draw
inspection sheet is dated July 14. User authorized costs before July 16 as
development and costs on or after July 16 as construction. Each payment is
allocated equally across Lots 1–4, with any fractional cents distributed across
the lots, and retains Banu as payer. SBA costs include principal and interest
by user instruction. Flagstar costs are recorded interest.

| Loan | Development | Construction | Total |
| --- | ---: | ---: | ---: |
| Banu SBA 3600818310 | $5,834.00 | $600.00 | $6,434.00 |
| MU SBA 9930608208 | $8,856.00 | $816.00 | $9,672.00 |
| Flagstar HELOC 0747511418 | $8,047.49 | $5,401.98 | $13,449.47 |
| Total | $22,737.49 | $6,817.98 | $29,555.47 |

Development loan groups remain under Banu's development financing within Land
Interest & Financing. Each loan has a separate top-level construction group.
Individual SBA payment IDs are preserved and reparented to their phase group.
Flagstar's four August–November payments are individual construction breakdowns;
the older $8,047.49 remains one development baseline, with its original statements,
since historical payment-level reconciliation is unavailable. Accounting totals
count group parents once, while individual breakdowns provide payment detail.

The unsupported $1,109.98 old SBA balance is archived, with its previous versions
preserved. It is excluded from active project costs. This is the only reduction
in overall project costs; moving development costs to construction creates no
additional expense.

The SBA 3600818310 history contains 37 screenshot-confirmed payments totaling
$5,534, plus five user-authorized $150 estimates for missing full-year months:
January/February 2024 and January/February/June 2025. Full-year 2024 costs are
$1,800; 2025 costs are $1,934, including the separate July 15 $134 row. The
November $150 recurring cost remains bank-unverified. The confirmed payment
history and the estimates are retained separately.

MU SBA 9930608208 has 41 confirmed payments totaling $9,468 (2023 $1,750;
2024 $3,000; 2025 $2,678; January–October 2026 $2,040), plus a bank-unverified
November $204 recurring cost. Both distinct July 15, 2025 rows are retained;
no June 2025 payment is inferred. Payments previously entered are included once.

## Monthly automation

The user-authorized SBA costs of **$150 and $204** recur on the 15th, starting
December 15, 2026, in America/New_York. Both now post to their loan's construction
group, with Banu as payer, and each cost is shared across all four lots. The
combined monthly cost is $354 ($88.50 per lot). The script adds one immutable
version of the construction group and one individual payment breakdown in a
single atomic insert. It does not increase development totals.

Monthly markers and unique version keys prevent duplicates. The entries remain
unverified costs until actual bank payments are confirmed; the automation does
not send money or invent a principal/interest breakdown.

The local LaunchAgent `com.greenfort.accountant.monthly-sba` runs on the 15th at
9:15 AM and on login/load, catching up any missed months. It requires this Mac's
logged-in session, network access, this repository, its `.env`, and Node. A
powered-off Mac cannot run the job; it catches up at the next login. Logs are
in `~/Library/Logs/GreenfortAccountant/monthly-sba*.log`.

```sh
node --env-file=.env scripts/record-monthly-sba.mjs
```

Disable the local schedule:

```sh
launchctl bootout "gui/$(id -u)/com.greenfort.accountant.monthly-sba"
```

## Reconciliation

`scripts/reclassify-banu-financing.mjs` previews the phase migration by default;
`--apply` writes a single atomic batch and verifies the result. It is idempotent.
The earlier SBA history scripts now detect the phase policy and exit without
changing the migrated records. They remain as an audit of screenshot transcription.
