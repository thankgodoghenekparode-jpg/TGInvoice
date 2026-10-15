import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import { createReferralCodeSchema, updateReferralCodeSchema } from '../validators/referralValidators.js';
import * as referral from '../controllers/referralController.js';

/**
 * A business's referral programme. Owner/admin only — it exposes the other
 * businesses you brought in and the rewards you have earned.
 */
export const referralRouter = Router();

referralRouter.use(requireAdmin);

referralRouter.get('/', referral.overview);
referralRouter.post('/codes', validate(createReferralCodeSchema), referral.createCode);
referralRouter.patch('/codes/:id', validate(updateReferralCodeSchema), referral.updateCode);
referralRouter.delete('/codes/:id', referral.deleteCode);
