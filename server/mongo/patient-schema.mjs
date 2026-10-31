import { z } from 'zod';
const patientAgeFields={age_years:z.coerce.number().int().min(0).max(150).optional(),age_months:z.coerce.number().int().min(0).max(11).optional(),age_days:z.coerce.number().int().min(0).max(30).optional(),age_recorded_at:z.string().datetime().optional()};
const nameField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[\p{L}][\p{L} '\-]*$/u,
    "Use letters, spaces, hyphens or apostrophes only",
  );
const optionalPhone = z
  .string()
  .trim()
  .max(10)
  .refine(
    (value) => !value || /^\d{10}$/.test(value),
    "Mobile number must contain exactly 10 digits",
  );
const meaningfulText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !value || /[\p{L}\p{N}]/u.test(value),
      "Enter meaningful text, not symbols only",
    );
export const patientInput = z
  .object({
    branch_id: z.string().uuid("Select an authorized branch"),
    first_name: nameField,
    last_name: nameField,
    photo_url: z
      .string()
      .trim()
      .max(2_850_000, "Photo must be 2 MB or smaller")
      .refine(
        (value) =>
          !value ||
          /^data:image\/(jpeg|png|webp);base64,/i.test(value) ||
          /^https?:\/\//i.test(value),
        "Photo must be JPEG, PNG or WebP",
      )
      .optional()
      .default(""),
    date_of_birth: z
      .string()
      .nullable()
      .optional()
      .refine(
        (value) =>
          !value ||
          (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
            new Date(`${value}T00:00:00Z`).getTime() <= Date.now()),
        "Date of birth cannot be in the future",
      )
      .refine(
        (value) => {
          if (!value) return true;
          const dob = new Date(`${value}T00:00:00Z`);
          const oldest = new Date();
          oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
          oldest.setUTCHours(0, 0, 0, 0);
          return dob.getTime() >= oldest.getTime();
        },
        "Date of birth cannot be more than 120 years ago",
      ),
    sex: z.enum(["male", "female", "other", "unknown"]).default("unknown"),
    blood_group: z
      .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown", ""])
      .optional()
      .default(""),
    phone: optionalPhone.default(""),
    email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (value) =>
          !value ||
          /^[^\s@]+@[A-Za-z0-9][A-Za-z0-9-]{1,62}(?:\.[A-Za-z0-9][A-Za-z0-9-]{1,62})+$/.test(value),
        "Enter a complete email address",
      )
      .default(""),
    address: z
      .object({
        ...patientAgeFields,
        title: z.enum(["Mr.","Mrs.","Ms.","Miss","Master","Baby","Dr.",""]).optional(),
        father_name:z.string().trim().max(150).optional(),
        mother_name:z.string().trim().max(150).optional(),
        district:z.string().trim().max(150).optional(),
        line: meaningfulText(500).default(""),
        city: meaningfulText(100).default(""),
        state: z.string().trim().max(100).default(""),
        pin: z
          .string()
          .trim()
          .refine(
            (value) => !value || /^\d{6}$/.test(value),
            "PIN code must contain exactly 6 digits",
          )
          .default(""),
      })
      .default({ line: "", city: "", state: "", pin: "" }),
    emergency_contact: z
      .object({
        name: z.union([nameField, z.literal("")]).default(""),
        phone: optionalPhone.default(""),
        relationship: z
          .enum([
            "Parent",
            "Spouse",
            "Child",
            "Sibling",
            "Guardian",
            "Friend",
            "Other",
            "",
          ])
          .default(""),
      })
      .superRefine((value, ctx) => {
        if (
          (value.name || value.phone || value.relationship) &&
          (!value.name || !value.phone || !value.relationship)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Complete the emergency contact name, number and relationship",
          });
      })
      .default({ name: "", phone: "", relationship: "" }),
    allergies: meaningfulText(2000).default(""),
    existing_conditions: meaningfulText(2000).default(""),
    current_medication: meaningfulText(2000).default(""),
    registration_fee: z.coerce.number().min(0).default(0),
    maintenance_fee: z.coerce.number().min(0).default(0),
    registration_addons: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().min(1),
          price: z.coerce.number().min(0),
        }),
      )
      .default([]),
    payment_mode: z.string().default(""),
    payment_reference: z.string().default(""),
    discount: z.coerce.number().min(0).default(0),
    discount_remarks: z.string().default(""),
    registration_payment_status: z.enum(["Paid", "Unpaid"]).default("Unpaid"),
    payment_status_remarks: z.string().default(""),
    total_amount: z.coerce.number().min(0).default(0),
    status: z.string().default("Active"),
    referral_partner_id: z
      .union([z.string().uuid(), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
    referral_consent: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .default(false),
    duplicate_override: z.boolean().default(false),
    duplicate_override_reason: z.string().trim().max(500).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.referral_partner_id && !value.referral_consent)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referral_partner_id"],
        message:
          "Referral consent is required before selecting a referral partner",
      });
    if (value.duplicate_override && value.duplicate_override_reason.length < 10)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duplicate_override_reason"],
        message:
          "A duplicate override reason of at least 10 characters is required",
      });
  });
