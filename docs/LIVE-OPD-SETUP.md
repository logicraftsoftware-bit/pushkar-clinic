# Live OPD queue and digital appointment passes

Implementation: 6 November 2026. Extends the existing native MongoDB appointment and consultation workflows.

## Existing architecture and changes

- React/Vite frontend; Express API; MongoDB transactions and existing role/branch permissions.
- `clinical_appointments` remains the appointment and queue source. `doctor_clinical_records` remains the clinical record source. No duplicate appointment or consultation models are introduced.
- Existing booking numbers, token references, payments and receipts are preserved. A separate `queue_serial` displays **1, 2, 3…** within each doctor/branch/date. Serials are allocated transactionally and are not reused after cancellation. Moving a booking to another doctor/branch/date allocates a serial in the new scope; its booking number stays unchanged.
- Existing appointments without the new field display their legacy slot serial. Their receipt references are not rewritten.
- Existing Present, check-in, No Show and Complete / Sign actions are retained. Skip is represented by `queue_skipped` on Waiting, rather than a second clinical status enum. Return clears the skipped marker.
- A doctor's actual OPD start and consultation timestamps drive estimates. Configured average consultation time is independent of appointment slot duration.
- `queue-engine.mjs` is the shared projection; patient, staff and physical displays use it. `queue-service.mjs` handles timing, serial allocation and secure tokens; `queue-router.mjs` exposes authorized staff and capability-limited public views.
- New indexed collections: `opd_queue_sessions` for durable session timing and `waiting_screens` for device assignment/heartbeat. Appointment pass hashes and serial fields have partial unique indexes. No production data reset is required.

## Configure a doctor

1. Open the doctor's session on **Doctor Dashboard → Open**.
2. Choose **Consultation time & room**. Reception/Admin can also open a doctor under **Live Queue** and use this settings button.
3. Enter scheduled OPD start, average consultation minutes and room.
4. Choose whether the patient live queue is enabled.
5. Configure announcements: enabled, language (English/Bengali/Hindi), patient name (off by default), doctor name, room and repeat interval.
6. Save. Doctor availability still comes from the existing appointment calendar; these settings do not create booking slots.

Actual start is recorded by the first Present/consultation-start action. Estimates are labelled approximate. Re-presenting a skipped patient records a new consultation start while preserving the session's original actual start.

## Book and share an appointment

Book using the existing appointment form. The confirmation includes a **Digital appointment pass** with Copy link, Share and Open patient view.

The pass opens `/p/{opaque-token}` without login. It shows the patient's appointment details, original booking number, separate serial, collection/payment details, receipt printing and live queue. Use the browser's print dialog to save the existing OPD bill format as PDF; this does not create another payment.

The token has 256 bits of randomness; only its SHA-256 hash is stored. The plaintext link is returned once at booking or replacement. If it was not saved, use **Generate / replace private link** in an existing appointment's edit form. Replacement immediately invalidates the old link. Revoke disables the current link. Passes expire seven days after the later of issuance and the appointment date.

Public views never return other patients' names/phones/internal IDs or the holder's diagnosis, notes, prescription or medical history. Clinical documents remain behind existing authenticated workflows. Future WhatsApp integrations can use the pass-creation response and queue call identifier; no WhatsApp API is configured by this update.

## Doctor and reception process

1. Reception books the appointment and checks the patient in using the existing payment/check-in flow.
2. Doctor opens the session queue. It updates every five seconds and shows serial, unchanged booking number, scheduled time, estimated time and status.
3. **Present** opens the existing full consultation workspace and changes the visit to In Consultation. It creates a durable call identifier consumed by displays and the patient page.
4. **Skip** moves the visit out of the active waiting order without deleting it. Select the Skipped tab and **Return** or Present when appropriate.
5. **Absent** saves No Show and removes the visit from active waiting counts.
6. **Complete / Sign** uses the existing clinical validation/finalization. Saving a draft does not complete the appointment.
7. Complete or skip the current consultation before starting another one for that doctor/branch/day. Existing clinical sections and downstream laboratory/pharmacy processing remain in place.

Reception/Admin have **Live Queue** and **Waiting Screens** navigation entries. Filter queues by branch, department, doctor, date and session time range. Open a doctor for its detailed queue and configuration.

## Register a waiting-room TV

1. Open **Waiting Screens → Add screen**.
2. Enter screen name, assigned branch, type and doctor (required for single-doctor/announcement views). Department screens can be filtered to a department.
3. Enter a room where appropriate. A saved doctor-specific room is shared with that branch/doctor's patient pass and queue.
4. Save, then open the once-displayed private link on the physical TV/browser. Bookmark it on that device.
5. Click **Full screen** and **Enable announcements** on the device. Select an installed voice if desired.
6. Check screen Online/Offline status in reception. A connected screen sends a heartbeat; after 45 seconds without one it shows Offline.

Screen types: single doctor; all-doctor reception; branch/department; single-doctor announcement. All-doctor screens remain silent to prevent overlapping announcements. Patient names are not displayed or spoken by default. A single-doctor screen may include a name only when that doctor's announcement setting explicitly enables it; medical details never appear.

Edit screen assignments to change the doctor/room/type, disable a screen to revoke live access, or delete its registration. The monitor action creates a replacement screen link and invalidates the old one. Secret screen tokens are not returned in the management list.

## Live updates and sound

Public passes and screens use SSE snapshots every four seconds, with automatic reconnection and a 12-second polling fallback for hosting proxies. Staff queue pages refresh every five seconds. State is read from MongoDB, so it survives server restarts and works across server instances without Redis. Invalid/revoked/expired access is rechecked during each public snapshot.

Speech uses the browser/device speech synthesis service. It needs an operator gesture to enable audio and suitable installed voices. Language preference does not install a missing device voice. Repeat is optional and bounded to at least 20 seconds. Reconnect updates the visual state; network errors suppress new audio until connection recovers. The patient phone page offers an optional audible turn alert and remains fully usable without sound. Mobile background tabs may pause updates/audio until reopened.

No paid voice API or new infrastructure credentials are required. HTTPS and the existing Hostinger deployment configuration are sufficient. The new indexes are created by normal application initialization.

## Verification

- Unit scenarios: scheduled estimates, 5/7-minute averages, late start, overdue consultation, skip, no show and completion.
- Mongo integration scenarios: original booking number retained; separate serial allocation; opaque capability projection; no clinical/other-patient identifiers; late live start; check-in prerequisite; one active consultation; skip/return path; screen branch authorization and heartbeat; token rotation/revocation.
- The existing build, MongoDB workflows, payment/clinical compatibility and managed-hosting startup checks remain required before production promotion.
- On each actual TV/phone: check audio permission, installed language/voice, reconnect and full-screen behaviour. Browser/device audio cannot be guaranteed by server tests.

## Research references

- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events): stream format and reconnect behaviour.
- [MDN: SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis): device voices and speech lifecycle.
- [OWASP: URL token handling guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): random, protected tokens, enumeration resistance and referrer protection. Applied here to appointment capability links; these are not password-reset tokens.
