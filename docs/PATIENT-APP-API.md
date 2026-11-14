# Patient mobile API

Implemented in the existing Mongo backend under `/api/v1/patient-app`. Staff controls use `/api/v1/patient-app-admin`; payment callbacks use `/api/v1/webhooks/payments`. The React Native screens remain static until the next integration step.

The [OpenAPI reference](patient-app.openapi.json) contains all 84 registered operations, their authentication requirements, path parameters and strict JSON request schemas. A live copy is available at `GET /api/v1/patient-app/openapi.json`. Response schemas and query filters are currently documented in code rather than fully described by OpenAPI. No SMS, push, or payment provider has been activated by this change.

## Screen coverage

Paths below are relative to `/api/v1/patient-app`. Use the OpenAPI reference for exact HTTP methods and payloads.

| Screen | APIs |
| --- | --- |
| 1. Welcome / login | `GET /config`, `POST /auth/otp/request` |
| 2. OTP | `POST /auth/otp/verify`, `/auth/refresh`, `/auth/logout` |
| 3. Patient profile | `GET/PATCH /me` |
| 4. Family | `GET/POST /family-members`, `PATCH/DELETE /family-members/{id}`, `GET/POST /clinic-links` |
| 5. Home | `GET /home`, `/notifications` |
| 6. Clinic search | `GET /clinics`, `/specialties` |
| 7. Clinic details | `GET /clinics/{id}`, `/clinics/{clinicId}/doctors`, favorites |
| 8. Doctor search | `GET /doctors`, `/specialties` |
| 9. Doctor profile | `GET /doctors/{id}`, `/doctors/{id}/reviews`; `POST /doctors/{id}/reviews` |
| 10. Select appointment | `GET /doctors/{id}/availability`, `POST /booking-holds` |
| 11. Visit details | `PATCH /booking-holds/{id}`, `POST /uploads` |
| 12. Review / payment | `POST /booking-quotes`, `/payment-orders`, `/payments/{id}/verify`, `/payments/{id}/sync` |
| 13. Confirmation | `POST /appointments`, `GET /appointments/{id}/pass` |
| 14. Appointments | `GET /appointments` |
| 15. Appointment details | `GET /appointments/{id}`, `POST /appointments/{id}/reschedule`, `/appointments/{id}/cancel` |
| 16. Check-in | `POST /appointments/{id}/check-in` |
| 17. Live queue | `GET /appointments/{id}/queue`, `/appointments/{id}/events` (SSE) |
| 18. Turn alert | Queue events, notifications, registered devices |
| 19. Medical records | `GET/POST /records`, `GET /records/{id}/download`, `/uploads/{id}/download` |
| 20. Visit / prescription | `GET /visits/{id}`, `/prescriptions/{id}` |
| 21. Lab tests / reports | `GET /lab-tests`, `POST /lab-bookings`, `GET /lab-orders`, `/lab-orders/{id}`; released records/downloads |
| 22. Payments / invoices | `GET /payments`, `/payments/{id}`, `/invoices`, `/invoices/{id}`, `/invoices/{id}/download`, `/refunds/{id}` |
| 23. Notifications | `GET /notifications`, `PATCH /notifications/{id}`, `POST /notifications/read-all`, `POST /devices`, `DELETE /devices/{id}` |
| 24. Account / help | `GET/PATCH /me/preferences`, favorites, support tickets, `POST /account-deletion-requests`, logout |

## Running locally

Use the existing backend installation and Mongo configuration. MongoDB must support transactions (replica set or Atlas). Startup creates the additional indexes; it does not seed patient accounts or publish clinics.

```powershell
npm.cmd --prefix server ci
npm.cmd --prefix server start
```

Keep `PATIENT_APP_OTP_MODE=disabled` until SMS is configured. For an isolated local development environment only, set `NODE_ENV=development` and `PATIENT_APP_OTP_MODE=development`. This returns a randomly generated `development_code` in the OTP request response. Production explicitly rejects development mode. Never enable it on a publicly accessible development server.

Existing authenticated hospital administrators must publish their clinic through `PATCH /api/v1/patient-app-admin/settings` using the schema in OpenAPI. Publication requires the appropriate subscription/module. Public directory responses expose only allowlisted fields and active assigned branches. Configure booking fees, cancellation policy and manual check-in in these settings.

## Authentication and booking flow

1. `POST /auth/otp/request` with `{ "phone": "+919876543210" }`. The code expires in five minutes; resend has a 60-second cooldown and verification has five attempts. Codes are hashed in storage.
2. `POST /auth/otp/verify` with `{ "challenge_id": "<uuid>", "code": "<six digits>" }`. Save the returned patient access and refresh tokens in secure device storage. Send `Authorization: Bearer <access_token>` on private calls. Staff JWTs cannot be used here.
3. Load `/me` and complete the self profile, or create a consented family member. Use its profile UUID for bookings. Exact profile field names are in OpenAPI.
4. Find a published clinic, branch and doctor. Query `/doctors/{id}/availability?clinic_id=<uuid>&branch_id=<uuid>&date=YYYY-MM-DD`.
5. `POST /booking-holds` with `profile_id`, `clinic_id`, `branch_id`, `doctor_id`, `appointment_date`, `appointment_time`; optionally `reason`, `symptoms`, `visit_type` (`New` or `Follow-up`) and `upload_ids`. A hold lasts ten minutes and reserves the slot against reception and other mobile users.
6. Edit the hold for visit details. `POST /booking-quotes` with its `hold_id` returns the server-calculated fee. Never calculate the amount charged from a client-provided price.
7. For an allowed pay-at-clinic booking, `POST /appointments` using the quote and the exact schema from OpenAPI. For online payment, create `/payment-orders` using the quote, finish checkout with the configured provider, then verify the signed payment callback. A captured payment confirms the appointment transactionally. Use `/payments/{id}/sync` to recover a missing callback; do not create a second order to retry status checks.
8. Load appointment details and pass. `GET /appointments/{id}/pass?format=pdf` returns a PDF with a scannable pass. Normal responses return signed QR data.

Send a new UUID `Idempotency-Key` on routes marked with that header in OpenAPI. Retry the same operation using the same key and body; changed input with the same key is rejected. PATCH only changes supplied fields. Rescheduling uses the current `updated_at` value as an optimistic concurrency check; inspect the request schema.

Patient refresh tokens rotate and revoke the old session credentials. Logout revokes access and session devices. Default access lifetime is 15 minutes and refresh lifetime is 30 days. Refresh before reconnecting SSE.

Directory searches support text `q` and paging (`page`, `page_size`); additional clinic/branch/specialty filters are defined in `directory.mjs`. Patient lists support scoped `patient_id` filters (the mobile profile UUID) where appropriate. Dates are `YYYY-MM-DD`, slots `HH:mm`. Payment provider amounts use integer `amount_cents` (paise for INR); clinic consultation fees are rupees. Treat IDs as opaque UUIDs.

## Ownership, medical records and clinic workflows

- Sharing a phone number does not grant access to an existing clinic record. Staff issue a phone-bound, expiring one-time code through `/patient-app-admin/link-codes`; patients redeem it through `/clinic-links`. New registrations create a distinct clinic patient/UHID. Existing record linking checks profile date of birth.
- Removing a family member revokes subsequent access without deleting the clinic's medical record. All private resources are scoped to the active account/profile/clinic links.
- Clinic QR check-in and appointment-pass QR verification use different signed payloads. Staff generate check-in codes and validate passes through the admin APIs. Arrival requires today's valid appointment and the clinic's payment/check-in policy.
- Queue JSON and SSE expose the patient's token, current serving token, people ahead and estimated wait, without other patients' identities. SSE needs an authenticated client supporting headers; events revalidate ownership/session every four seconds, close after eight minutes and have connection limits. Reconnect with backoff and a current token.
- A completed visit or lab report is private until explicitly released by authorized clinic staff through `/patient-app-admin/releases`. Edited documents invalidate the prior release. Labs expose approved reportable results only, enforce payment gates, and reuse the existing report PDF.
- Uploads accept genuine PDF/JPEG/PNG/WebP bytes (base64 request), up to 3 MB each and 50 MB per account. Download endpoints authorize every request. Sharing with an appointment requires consent. There are no public upload URLs.
- Lab catalog entries must explicitly enable `data.patient_app_bookable`; branch prices come from the clinic catalog. Mobile lab booking creates an existing laboratory work item awaiting clinic confirmation. It does not invent a payment or collection event.
- Paid appointment cancellation uses the existing clinic cancellation approval workflow. A pending request blocks check-in/rescheduling. Refund provider events are deduplicated and flagged for reconciliation; the API does not issue a second refund or silently rewrite the clinic ledger. Refunds received outside the clinic workflow require staff reconciliation.
- Reviews require an owned completed appointment and staff moderation. Support tickets are scoped to the clinic/profile. Account deletion requests revoke mobile sessions and devices and queue review; they retain clinic clinical/financial records.

## Providers to configure later

**SMS:** set `PATIENT_APP_OTP_MODE=webhook`, `PATIENT_APP_SMS_WEBHOOK_URL` (HTTPS) and `PATIENT_APP_SMS_WEBHOOK_SECRET` (32+ characters). The adapter receives a JSON POST with `phone`, `code`, `challenge_id`, `expires_in`, and `language`, with Bearer authorization. Return 2xx only after accepting delivery. Production responses never contain the code.

**Push:** set both `PATIENT_APP_PUSH_WEBHOOK_URL` (HTTPS) and `PATIENT_APP_PUSH_WEBHOOK_SECRET`. The adapter receives `notification_id`, generic `title`/`message`, `target` and `devices` containing token/platform; the notification UUID is also `Idempotency-Key`. Return 2xx on accepted delivery. A durable outbox retries failures; inactive sessions, revoked ownership and unpublished documents are suppressed. With no adapter configured, in-app notifications still work and no push request is sent.

**Payments:** the initial adapter reuses clinic `PaymentMethods` settings: `selected_gateway=Razorpay`, and `gateways.Razorpay` containing `api_key`, `password`, `webhook_secret`. Staff settings responses mask secrets. Configure the provider webhook at `POST /api/v1/webhooks/payments/razorpay/{clinicId}` for `payment.captured` and `refund.processed`. Signatures use the exact raw request body. Online checkout is unavailable without clinic credentials; pay-at-clinic follows clinic policy. Additional providers require an adapter once selected.

Capture verification checks provider amount, currency, order and captured status. Duplicate callbacks cannot create duplicate bookings. A capture after a hold expires is recorded for review rather than allocating an unavailable slot. Tests mock provider responses and do not establish live provider readiness.

## Validation

Run `npm.cmd --prefix server run test:mongo` for unit checks. Patient HTTP tests are guarded: use only a local disposable replica set, `NODE_ENV=test`, `PATIENT_APP_INTEGRATION_TEST=true`, `PATIENT_APP_OTP_MODE=development`, a loopback `MONGODB_URI`, and a unique `MONGODB_DB` matching `pushkar_test_patient_*`. Set `ENV_FILE` to an empty test file, a synthetic `JWT_SECRET` and an invalid-domain `FRONTEND_ORIGIN`, then run `npm.cmd --prefix server run test:patient-app`. The suite drops its guarded disposable database and mocks all outbound provider requests. CI runs it alongside the existing clinic integration suite.

Regenerate the checked-in spec with `npm.cmd --prefix server run export:patient-openapi` using a valid backend environment. It only imports route metadata and writes the JSON artifact; it does not connect to MongoDB or call providers.
