# Manual clinic subscriptions

Super Admin → **Subscription Plans** defines prices, included modules and limits.
Super Admin → **Subscriptions** assigns, renews, replaces and cancels clinic access.
There is no subscription payment gateway and no automatic debit.

## Assign or renew

1. Select the clinic and an active plan.
2. Select monthly, yearly or trial. Periods means months for monthly and years for yearly.
3. Enter the agreed price **per billing cycle**, not a collected payment. Trials should have a zero amount.
4. Enter the approval or renewal reference.
5. **Renew / activate** extends an unexpired matching plan and cycle from its existing expiry. An expired assignment starts from now. To change the plan/cycle immediately use **Replace now**. Replacement logs out existing devices.

The previous assignment remains as superseded history. Cancellation requires a reason and revokes all clinic sessions immediately. Profile editing does not change subscription dates, prices or plan assignments. Manual clinic suspension remains independent of subscription dates.

## Expiry and warnings

The expiry timestamp is exclusive: access is denied at that exact instant. Dates in the UI use the viewer's local timezone. Calendar renewal preserves the time of day and clamps month ends. Trials use the configured number of days; existing legacy trials are evaluated against their configured trial days without extending access.

Clinic workspaces show a warning during the final 30 days. Super Admin sees current subscriptions, days remaining and history. These are in-app reminders; no email or SMS reminder service is configured.

Login and every authenticated API request check the current subscription. Expiry revokes every tenant session, including administrators, staff and patient/broker sessions. Open online browsers refresh access through the existing live session stream (approximately 20–30 seconds); a server sweep also clears expired sessions each minute. Offline browsers cannot be remotely cleared until they reconnect, but their server tokens are rejected. Reactivating a clinic never restores previously revoked tokens.

Public appointment/TV streams, patient self-registration and CRM synchronization also check subscription access. The platform owner's Super Admin session remains accessible to renew clinics.

## Limits and reporting

- Branch, login-account and doctor creation are checked inside serialized MongoDB transactions, including CRM creation and role conversion. Existing records are retained when a plan is changed; assignments below existing capacity are rejected.
- Purchased modules are validated on the server independently of staff roles. Clinic admin permission does not bypass subscription module checks.
- AI allowance counts attempted requests per clinic per UTC calendar month, in addition to the existing per-user rate limit. Zero disables AI use.
- Document and print-template uploads check the clinic's stored BSON size against its storage allowance. This is an application upload safeguard, not an Atlas disk quota; storage includes embedded files. Existing clinical records are never deleted to reclaim space.
- Contract MRR includes only current active paid terms; annual cycle prices are divided by twelve. Trial, expired and superseded assignments do not contribute. Contract MRR is not collected cash or an invoice ledger.

No credentials, new environment variables, payment gateway, external mail service or local database setup is required for these controls.
