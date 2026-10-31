import {z} from 'zod';
const id = z.string().trim().min(1).max(200);
const optionalId = id.nullish();
const recordBase = z.object({ externalId: id, updatedAt: z.string().datetime().optional() });
export const payloadSchema = z.object({
  branches: z.array(recordBase.extend({ name: z.string().trim().min(1), code: z.string().trim().min(1), phone: z.string().optional(), address: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional() })).prefault([]),
  departments: z.array(recordBase.extend({ branchExternalId: optionalId, name: z.string().trim().min(1), code: z.string().trim().min(1), active: z.boolean().optional() })).prefault([]),
  doctors: z.array(recordBase.extend({ branchExternalId: id, departmentExternalId: optionalId, name: z.string().trim().min(1), email: z.string().email().optional(), mobile: z.string().optional(), qualification: z.string().optional(), specialization: z.string().optional(), registrationNumber: z.string().optional(), consultationFee: z.coerce.number().nonnegative().optional(), active: z.boolean().optional(), schedules: z.array(z.object({ date: z.string().date(), from: z.string(), to: z.string(), maxSlots: z.coerce.number().int().positive().max(500).optional() })).optional() })).prefault([]),
  patients: z.array(recordBase.extend({ branchExternalId: id, medicalRecordNumber: z.string().optional(), name: z.string().trim().min(1), mobile: z.string().optional(), email: z.string().email().optional(), dateOfBirth: z.string().date().optional(), gender: z.enum(["male", "female", "other", "unknown"]).optional(), bloodGroup: z.string().optional(), address: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional() })).prefault([]),
  appointments: z.array(recordBase.extend({ appointmentNumber: z.string().trim().min(1), branchExternalId: id, departmentExternalId: optionalId, doctorExternalId: optionalId, patientExternalId: id, startsAt: z.string().datetime({ offset: true }), status: z.string().optional(), visitType: z.string().optional(), reason: z.string().optional(), tokenNumber: z.string().optional() })).prefault([]),
});
