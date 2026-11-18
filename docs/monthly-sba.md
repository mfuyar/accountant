# Banugul's owner-paid SBA and Flagstar financing

On November 18, 2026 the user confirmed that Banugul Barut Uyar personally paid
these loan amounts and should receive the funds back as owner contribution.
They are now **repayable owner contributions**, outside both construction and
development spending. They are also separate from partner profit payouts.

| Source | Owner contribution |
| --- | ---: |
| SBA 3600818310 | $6,434.00 |
| MU SBA 9930608208 | $9,672.00 |
| Flagstar HELOC 0747511418 | $13,449.47 |
| Total contributed / due back initially | $29,555.47 |

The 90 individual source entries retain their dates, loan identities, documents,
original principal/interest evidence and previous allocation information. Current
entries are recorded completed based on the user's confirmation of owner payment;
original bank-confirmation flags remain as evidence and are not rewritten. The
older Flagstar baseline remains an aggregate because individual historical payment
reconciliation is unavailable. The unsupported $1,109.98 old SBA balance stays
archived and is not a contribution.

## Where to view and settle

Open **Owner Contributions** in the project navigation. The screen shows paid
contributions, returns, the amount due to each owner, pending confirmations, and
individual history. Source documents can be opened where available. After paying
an owner back, use **Record a return of owner contribution** with the actual date,
method and reference. Returns reduce the balance owed without creating another
project expense or deducting partner profit. The screen does not send payments.

The Reports screen also shows a separate repayable-contributions summary. These
amounts do not enter project cost, construction ledger, job spending, loan-received
summaries or partner-profit totals.

## Storage and audit

The existing financing table stores the entries. The backward-compatible envelope
`greenfort-owner-capital` distinguishes contributions and returns from ordinary
loans. The application normalizes those entries as `owner_contribution` and
`owner_contribution_return`; they have no project-cost or partner-profit treatment.
No schema/RLS changes or browser secrets are required.

`scripts/move-banu-financing-to-owner-capital.mjs` previews by default. `--apply`
first writes and verifies unique contribution references, then archives the old
cost versions and adjusts the development parent in one immutable batch. Repeating
it does not add contributions again. The original costs and the earlier July 16
phase classification remain in immutable history, not in current spending.

The SBA screenshots, estimated full-year installments previously authorized by
the user, November recurring amounts and Flagstar totals are retained in the
migration provenance. Principal plus interest is the contribution amount where
both were included in the source payment.

## Monthly automation

The $150 and $204 SBA schedules continue on the 15th, starting December 15, 2026.
They now create **planned owner contributions**, not costs, until the owner-paid
payment is confirmed in the new screen. The combined expected contribution is
$354 per month. They never recreate construction or development ledger entries.

The local LaunchAgent `com.greenfort.accountant.monthly-sba` runs on the 15th at
9:15 AM and on login/load, catching up any missed months. It requires this Mac's
logged-in session, network access, repository, `.env` and Node. A filesystem lock
prevents concurrent recordings; stable payment references make reruns idempotent.
A powered-off Mac catches up at the next login. Logs are in
`~/Library/Logs/GreenfortAccountant/monthly-sba*.log`.

```sh
node --env-file=.env scripts/record-monthly-sba.mjs
```

Disable the local schedule:

```sh
launchctl bootout "gui/$(id -u)/com.greenfort.accountant.monthly-sba"
```
