import { z } from 'zod';

export const setMemberExpirySchema = z.object({
  accessExpiresAt: z.coerce.date().optional().nullable(),
});

export default { setMemberExpirySchema };
