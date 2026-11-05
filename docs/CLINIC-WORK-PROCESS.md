# Pushkar Clinic ERP — Staff Work Process

Updated: 6 November 2026. This guide describes the current MongoDB application. Menu availability depends on the account's role, permissions and enabled clinic modules.

**Live OPD update:** use [Live OPD setup](LIVE-OPD-SETUP.md) for secure patient passes, separate queue serials, doctor timing and TV displays. Booking numbers are unchanged.

## 1. Daily workflow at a glance

**Register or find patient → Book doctor appointment → Collect/record payment → Check in patient → Doctor opens session queue → Mark patient Present → Consult → Complete / Sign → Print prescription → Process tests/medicines and their bills as applicable.**

Booking reserves an appointment. Check-in records arrival. The doctor's **Present** action begins consultation. These are separate steps.

| Staff member | Main responsibility |
| --- | --- |
| Super Admin | Create plans and clinics, enable modules, manage platform branding and CRM connections |
| Clinic / Hospital Admin | Configure branches, departments, staff, doctor schedules, charges and permissions |
| Reception | Register patients, book appointments, record payments, check in patients and coordinate the queue |
| Doctor | Review assigned patients, start consultations, document treatment, place orders and complete visits |
| Laboratory staff | Process test orders, billing, samples, results and approval using their assigned permissions |
| Pharmacy staff | Review prescriptions, process sales and manage medicine stock |
| Accounts | Review collections, balances, receipts and approved cancellation/refund workflows |

## 2. Setup before taking appointments

1. In Super Admin, create the clinic's plan and clinic record. Confirm the plan includes the modules the clinic needs and has a suitable expiry date.
2. Create the clinic administrator. Sign in at `https://erp.pushkarpharmaceutical.com/login` using that administrator's email/phone and password. Complete the temporary-password change if prompted.
3. Under the clinic administration workspace, configure the branch and departments.
4. Create doctor/staff records and their login accounts. Assign the correct branch, department, role and permissions. A staff record alone is not a substitute for a usable login account.
5. Configure each doctor's appointment availability: dates or recurring schedule, start/end times and capacity. Configure consultation, registration and maintenance fees as applicable.
6. Configure patient registration charges, additional appointment charges, payment methods and print templates as required.
7. Configure laboratory tests/prices and pharmacy catalog/opening stock if those modules will be used.
8. Run a clearly labelled test patient through booking, check-in, consultation and receipt printing before starting routine work.

## 3. Sign in to the correct workspace

Open `https://erp.pushkarpharmaceutical.com/login`.

- Clinic administrator: select **Admin / Super Admin**, then enter the clinic administrator's email/phone and password.
- Doctor, reception and other staff: select **Staff Login**. The assigned role determines which workspace opens.
- Platform owner: use **Super Admin access**, or open `/superadmin` directly.

If prompted to change a temporary password, enter the temporary password, a new password of at least **12 characters**, and the same new password again. Choose **Save password & continue**.

## 4. Register or find a patient

**Responsible: Reception or another authorized registration user.**

1. Search existing patients by name, phone or UHID before creating a new record.
2. Confirm the patient's identity and contact details.
3. For a new patient, choose **New Patient Registration**, complete the required fields and review registration charges and discounts.
4. Use **Register & Continue to Appointment** when registering from the appointment form.
5. Confirm that the saved patient is selected in the appointment form.

The **UHID** identifies the patient across visits. Each appointment has its own appointment number and token. A follow-up normally uses the existing patient/UHID with a new appointment.

## 5. Book an appointment

**Responsible: Reception / authorized Clinic Admin.**

1. Open **Appointments & Queue** and choose the new-appointment action.
2. Find and select the patient, or register a new patient as described above.
3. Select **Branch → Department → Doctor**.
4. Select the appointment date and an available time.
5. Select the visit type, such as **New** or **Follow-Up**, as appropriate.
6. Review consultation fees, optional doctor registration/maintenance fees, additional charges and discounts. Distinguish the patient's registration charges from this appointment's charges.
7. Enter the actual amount collected and payment method. Review the payment summary before saving.
8. Select the source, such as Reception, Phone, Walk-In or Online. Enter the reason and notes if needed.
9. Choose **Save Appointment** once and wait for confirmation.
10. Check the saved appointment number, token, doctor, date, time and payment balance. Print the registration slip/receipt as needed; the browser print dialog can save a PDF.

### What the system does

- Validates the selected doctor, department, branch, patient and available slot.
- Rejects a slot that is no longer available, including a booking conflict from another user. Choose another available slot and retry.
- Creates the appointment with status **Booked**.
- Preserves the existing booking/token reference format and allocates a separate queue serial (1, 2, 3...) per doctor, branch and date. The saved confirmation provides a secure patient appointment pass to copy/share.
- Derives the payment status from the appointment total and amount collected; the saved result is authoritative.

**Queue serial:** 1, 2, 3... is allocated in booking order within the doctor/branch/date, separately from the unchanged booking number. Existing visits without a new serial display their legacy slot serial. This is not an arrival-order counter.

Normal booking uses the doctor's configured appointment schedule. The **OPD Queue** booking path requests five-minute slots and can preselect an available time; this does not mean every consultation must last five minutes.

## 6. When the patient arrives: check in

**Responsible: Reception.**

1. Open the appointment calendar/list and select the correct date and doctor.
2. Search by patient name, UHID or phone and verify the appointment details.
3. Click **Check In**.
4. If the appointment is already **Paid** or **Payment not required**, no extra payment collection is needed.
5. Otherwise, enter the payment amount and method requested by the check-in dialog. Confirm the amount actually received.
6. Confirm that the appointment becomes **Checked In** and give the patient their token details.

For a positive outstanding balance, check-in requires a positive collection and rejects an amount above the balance. **Partial payment is currently allowed**; check-in does not require every appointment to be fully paid. A remaining balance must still be reconciled.

Do not collect a second payment when payment has already been recorded. Booking alone does not check the patient in.

## 7. Doctor's patient queue

**Responsible: Doctor, with reception coordinating arrivals.**

1. Sign in through **Staff Login** using the doctor's account.
2. Open **Doctor Dashboard**.
3. Find the scheduled date/time session and click **Open**.
4. The **Doctor OPD queue** shows serial, booking number, scheduled time, estimated time and status. It updates automatically. Configure **Consultation time & room** before starting OPD.
5. Confirm with reception that the next patient has checked in and is available.
6. Use **Notify reception** if needed. Present updates the live patient pass and assigned waiting screens. The call action can repeat the current patient's announcement.
7. Click **Present** for the patient being seen. The server changes the appointment to **In Consultation**, and the consultation workspace opens.
8. Review the patient's identity and history before entering clinical information.

**Reception must check in the appointment first.** The doctor cannot begin a booked-only encounter through the attendance action; the server rejects it.

The queue can show booked appointments alongside checked-in patients. A patient's position in the list is not proof that they have arrived.

### If a patient is absent or late

- **Absent** changes an eligible checked-in queue encounter to **No Show** and removes it from the doctor's active list after reload.
- A booked patient who never arrives can be marked **No Show** through the authorized appointment-status workflow.
- Use **Skip** to defer a checked-in patient. The appointment remains under Skipped; Return or Present makes it available again. This is separate from Absent/No Show. Reception and the doctor coordinate late arrivals.

### Current queue behaviour and limits

| Question | Current behaviour |
| --- | --- |
| Is the queue ordered by arrival time? | No. It uses the queue serial; skipped patients are held outside active waiting until returned. |
| Does the next patient open automatically? | No. The doctor chooses a patient and clicks Present. |
| Does the system allow only one active consultation per doctor? | Complete or Skip the current visit before starting another for the same doctor/branch/day. |
| Does the list update continuously? | Staff queues update every five seconds. Patient passes and waiting screens use SSE with polling fallback. |
| Does Call patient send WhatsApp/SMS or play an announcement? | Present/call updates the patient pass and can speak on the assigned doctor display after audio is enabled. WhatsApp/SMS are not configured. |
| Does selecting a token complete a visit? | No. The doctor must finish and use Complete / Sign. |

## 8. Consult and complete the visit

1. Confirm patient, UHID, doctor and visit details.
2. Review the available medical history, allergies and prior visit records.
3. Enter symptoms, history, observations/vitals and diagnosis as appropriate.
4. Enter medicines, instructions, investigations, tests, advice and follow-up information as needed.
5. Choose **Save Draft** to save work in progress. The appointment remains **In Consultation**.
6. Review the final clinical information and resolve any validation or allergy-conflict messages.
7. Choose **Complete / Sign** when the consultation is finished. The appointment becomes **Completed**, and the current consultation workspace closes.
8. Print the completed prescription/encounter as needed.

Clinical saves create or update downstream orders for the selected services. Saving or completing a consultation does not, by itself, mean that laboratory tests were performed, medicines were dispensed or all bills were paid.

## 9. Status reference

| Stage / label | Meaning | Main action |
| --- | --- | --- |
| Booked | Appointment saved; arrival not recorded | Reception checks in on arrival |
| Confirmed | Appointment confirmed; arrival still not recorded | Reception checks in on arrival |
| Awaiting | Calendar display label for Booked / Confirmed | Check appointment and arrival |
| Checked In | Reception recorded arrival and the required payment action | Doctor may start consultation |
| Waiting | An explicit waiting status where used | Doctor selects the patient |
| Present | Doctor's action label | Saves In Consultation on the server |
| In Consultation | Doctor has started the visit or saved a consultation draft | Save Draft or Complete / Sign |
| Completed | Consultation finalized | Print/review the completed encounter |
| Absent / No Show | Patient unavailable / missed visit | Coordinate further action with reception |
| Cancelled | Appointment cancelled through the approved workflow | Preserve billing and cancellation history |

**Typical path:** Booked → Checked In → In Consultation → Completed. Confirmed and Waiting are optional intermediate statuses, not compulsory steps.

## 10. Tests, pharmacy, billing and follow-up

- **Laboratory:** authorized staff review the doctor's test order, confirm billing, collect samples, enter results and complete the applicable review/approval steps before issuing reports.
- **Pharmacy:** authorized staff review the prescription, check stock and process the sale/dispensing workflow. Creating a prescription alone does not reduce stock or collect money.
- **Accounts / reception:** verify collections, receipts, additional service bills and any remaining balance. Appointment payment and separate laboratory/pharmacy payments must be reconciled individually.
- **Follow-up:** select the existing patient and create a new Follow-Up appointment with the appropriate doctor/date/slot. Completing today's visit does not automatically reserve a future appointment.
- **Cancellation:** use the cancellation-request and approval workflow to preserve billing history. Do not delete the patient or overwrite payment amounts to represent a refund.

## 11. Example working day

Assume a doctor has three booked tokens in a morning session:

| Token serial | Reception state | Doctor action | Result |
| --- | --- | --- | --- |
| 001 | Checked In | Present → document → Complete / Sign | Completed |
| 002 | Still Booked; patient has not arrived | Reception follows up; doctor does not start this visit yet | Remains awaiting arrival |
| 003 | Checked In | Doctor may manually choose Present after coordinating with reception | In Consultation, then Completed |

If serial 2 later arrives, reception must check it in before the doctor starts it. The application does not silently reorder it behind serial 3. Use Skip/Return when deferring a visit. Estimates update to reflect actual consultation progress.

## 12. Common problems and what staff should do

| Problem | Action |
| --- | --- |
| No available appointment time | Verify doctor login/staff status, branch/department assignment, schedule, date and existing bookings. Past slots are unavailable. |
| Slot became unavailable while saving | Reload the available times and select a different slot. |
| Doctor cannot mark Present | Confirm reception has checked in the correct appointment. |
| New arrival is missing from the doctor's screen | Reload/reopen the doctor session and verify its date/time and assigned doctor. |
| Patient is under the wrong doctor/date | Reception reviews the editable booking or uses the appropriate rescheduling/cancellation process. |
| Payment balance remains after check-in | Review recorded partial payment and reconcile the outstanding balance. |
| Patient/doctor login fails | Confirm the correct account type, active login, branch/role assignment and password. |
| Consultation fails validation | Read the displayed message, correct the highlighted clinical data and save again. |

## 13. End-of-day handover

1. Reconcile today's booked, checked-in, in-consultation, completed and no-show appointments.
2. Ask doctors to review unfinished drafts and visits that remain In Consultation.
3. Reconcile receipts, payment methods and outstanding balances.
4. Review pending test reports, pharmacy orders and cancellation requests.
5. Confirm the next day's doctors, schedules and staffing.

This guide documents application behaviour; clinical decisions, patient priority and exceptions remain the responsibility of the clinic team.
