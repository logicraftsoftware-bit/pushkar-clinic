import { z } from 'zod';
const short = (max) => z.string().trim().min(1).max(max);
export const patientAppSettingsInput = z
  .object({
    enabled: z.boolean().optional(),
    pay_at_clinic: z.boolean().optional(),
    manual_check_in: z.boolean().optional(),
    booking_fee: z
      .number()
      .finite()
      .min(0)
      .max(99999)
      .multipleOf(0.01)
      .optional(),
    lab_reports_require_payment: z.boolean().optional(),
    public_profile: z
      .object({
        type: z.enum(['Clinic', 'Hospital', 'Diagnostic']).optional(),
        description: z.string().max(4000).optional(),
        photos: z
          .array(
            z
              .string()
              .url()
              .regex(/^https:\/\//)
          )
          .max(12)
          .optional(),
        phone: z.string().max(30).optional(),
        address: z.string().max(500).optional(),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        opening_hours: z
          .array(
            z
              .object({
                day: z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
                opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
              })
              .strict()
          )
          .max(7)
          .optional(),
        facilities: z.array(short(100)).max(30).optional(),
        services: z.array(short(100)).max(50).optional(),
        announcements: z.array(short(500)).max(10).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
