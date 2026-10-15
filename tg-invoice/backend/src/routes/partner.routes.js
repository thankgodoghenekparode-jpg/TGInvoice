import { Router } from 'express';
import { validate } from '../middleware/errorHandler.js';
import { createPartnerSchema, updatePartnerSchema, createPartnerCodeSchema } from '../validators/referralValidators.js';
import * as partner from '../controllers/partnerController.js';

/**
 * Partner management. Mounted under `/api/admin/partners`, so requireAuth +
 * requirePlatformAdmin already ran in the parent admin router.
 */
export const partnerRouter = Router();

partnerRouter.get('/', partner.list);
partnerRouter.post('/', validate(createPartnerSchema), partner.create);
partnerRouter.get('/:id', partner.get);
partnerRouter.patch('/:id', validate(updatePartnerSchema), partner.update);
partnerRouter.delete('/:id', partner.remove);
partnerRouter.post('/:id/codes', validate(createPartnerCodeSchema), partner.createCode);
