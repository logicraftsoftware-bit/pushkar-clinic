import {z} from 'zod';
import {patientAgeFields} from './patient-age.mjs';
const validPhone = z.string().trim().regex(/^\d{10}$/, "Mobile number must contain exactly 10 digits");
const optionalPhone = z.string().trim().refine((value) => !value || /^\d{10}$/.test(value), "Mobile number must contain exactly 10 digits");
const validName = z.string().trim().min(1).max(80).regex(/^[\p{L}][\p{L} '\-]*$/u, "Use letters, spaces, hyphens or apostrophes only");
export const publicRegistrationInput = z.object({
  first_name: validName,
  last_name: validName,
  date_of_birth: z.string().nullable().optional().refine((value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).getTime() <= Date.now()), "Date of birth cannot be in the future"),
  sex: z.enum(["male", "female", "other", "unknown"]).prefault("unknown"),
  blood_group: z.string().trim().max(20).optional().prefault(""),
  phone: validPhone,
  email: z.string().trim().email().or(z.literal("")).optional().prefault(""),
  address: z.object({
    ...patientAgeFields,
    line: z.string().trim().max(300).optional().prefault(""),
    city: z.string().trim().max(100).optional().prefault(""),
    state: z.string().trim().max(100).optional().prefault(""),
    pin: z.string().trim().refine((value) => !value || /^\d{6}$/.test(value), "PIN code must contain exactly 6 digits").optional().prefault(""),
  }),
  emergency_contact: z.object({
    name: z.union([validName, z.literal("")]).optional().prefault(""),
    phone: optionalPhone.optional().prefault(""),
    relationship: z.enum(["Parent","Spouse","Child","Sibling","Guardian","Friend","Other",""]).optional().prefault(""),
  }),
  allergies: z.string().trim().max(1000).optional().prefault(""),
  existing_conditions: z.string().trim().max(1000).optional().prefault(""),
  current_medication: z.string().trim().max(1000).optional().prefault(""),
  registration_type: z.enum(["OPD", "IPD"]),
  department_id: z.string().uuid().optional(),
  doctor_id: z.string().uuid().optional(),
  appointment_date: z.string().optional(),
  appointment_time: z.string().optional(),
  reason: z.string().trim().max(1000).optional().prefault(""),
  razorpay_order_id: z.string().optional(),
  razorpay_payment_id: z.string().optional(),
  razorpay_signature: z.string().optional(),
});

