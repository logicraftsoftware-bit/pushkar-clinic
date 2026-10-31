import {z} from 'zod';
const optionalId=z.union([z.string().uuid(),z.literal(''),z.null()]).optional().transform(value=>value||null);
export const admissionInput = z.object({
  branch_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  admitted_at: z.string(),
  admission_type: z.string(),
  department_id: optionalId,
  consultant_doctor_id: optionalId,
  reason_diagnosis: z.string().prefault(""),
  ward_id: optionalId,
  room_id: optionalId,
  bed_id: optionalId,
  attendant_name: z.string().prefault(""),
  attendant_phone: z.string().trim().regex(/^\d{10}$/, "Attendant phone number must contain exactly 10 digits").or(z.literal("")).prefault(""),
  attendant_relationship: z.string().prefault(""),
  insurance_tpa: z.string().prefault(""),
  advance: z.coerce.number().prefault(0),
  deposit_amount: z.coerce.number().min(0).prefault(0),
  charges: z.array(z.unknown()).optional().prefault([]),
  paid_amount: z.coerce.number().min(0).prefault(0),
  consultation_fee: z.coerce.number().min(0).prefault(0),
  bed_daily_charge: z.coerce.number().min(0).prefault(0),
  patient_documents: z.record(z.string(),z.object({name:z.string().max(255),type:z.string().max(100),data:z.string().max(4000000)})).optional().prefault({}),
  payment_mode: z.string().prefault(""),
  payment_reference: z.string().prefault(""),
  discount: z.coerce.number().min(0).prefault(0),
  discount_remarks: z.string().prefault(""),
  admission_payment_status: z.enum(["Paid", "Unpaid"]).prefault("Unpaid"),
  payment_status_remarks: z.string().prefault(""),
  registration_amount: z.coerce.number().min(0).prefault(0),
  registration_fee_amount: z.coerce.number().min(0).prefault(0),
  registration_addon_amount: z.coerce.number().min(0).prefault(0),
  registration_deposit_amount: z.coerce.number().min(0).prefault(0),
  registration_discount_amount: z.coerce.number().min(0).prefault(0),
  total_amount: z.coerce.number().min(0).prefault(0),
  has_insurance: z
    .union([z.boolean(), z.enum(["Yes", "No"])])
    .transform((v) => v === true || v === "Yes"),
  insurance_company: z.string().prefault(""),
  policy_number: z.string().prefault(""),
  insurance_document: z.string().max(7000000).prefault(""),
  expected_discharge: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => v || null),
  status: z.string().prefault("Admitted"),
});
