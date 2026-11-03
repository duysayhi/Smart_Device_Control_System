import {z} from 'zod';
import {OwnerOperationSchema} from '../owner-auth/operation';
export const ContinuationAuditSchema=z.object({binding:OwnerOperationSchema.refine(b=>b.purpose==='G3_CONTINUATION'),authenticationSha256:z.string().regex(/^[a-f0-9]{64}$/),inspectionSha256:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number().int().positive()}).strict();
export type ContinuationAudit=z.infer<typeof ContinuationAuditSchema>;
