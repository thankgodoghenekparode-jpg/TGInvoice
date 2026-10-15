import { Router } from 'express';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import * as admin from '../controllers/adminController.js';
import * as flags from '../controllers/featureFlagController.js';
import * as referral from '../controllers/referralController.js';
import { partnerRouter } from './partner.routes.js';
import {
  createTenantSchema,
  updateTenantSchema,
  grantMemberSchema,
  setPlatformAdminSchema,
  createPlatformUserSchema,
  setMemberExpirySchema,
} from '../validators/adminValidators.js';
import { rewardReferralSchema } from '../validators/referralValidators.js';

/**
 * Platform administration (super-admin) routes.
 *
 * Deliberately NOT tenant-scoped: a platform operator oversees every
 * business without belonging to one. Hard-gated by requirePlatformAdmin,
 * which reads User.isPlatformAdmin — a flag no tenant-facing flow can set
 * (only the db:superadmin script or another platform admin can grant it).
 */
const router = Router();

router.use(requireAuth, requirePlatformAdmin);

/* Overview + directory */
router.get('/overview', admin.overview);
router.get('/tenants', admin.listTenants);
router.get('/users', admin.listUsers);

/* Business lifecycle */
router.post('/tenants', validate(createTenantSchema), admin.createTenant);
router.get('/tenants/:id', admin.getTenant);

router.post('/tenants/:id/suspend', admin.suspendTenant);
router.post('/tenants/:id/activate', admin.activateTenant);


/* Access control */
router.post('/tenants/:id/members', validate(grantMemberSchema), admin.grantMember);
router.patch('/tenants/:id/members/:userId/expiry', validate(setMemberExpirySchema), admin.setMemberExpiry);
router.delete('/tenants/:id/members/:userId', admin.revokeMember);

/* Account lifecycle */
router.post('/users', validate(createPlatformUserSchema), admin.addPlatformUser);
router.post('/users/:id/suspend', admin.suspendUser);
router.post('/users/:id/activate', admin.activateUser);
router.patch('/users/:id/platform-admin', validate(setPlatformAdminSchema), admin.setPlatformAdmin);

/* Feature flags (gradual rollout / kill switches) */
router.get('/flags', flags.adminList);
router.put('/flags', flags.adminUpsert);
router.delete('/flags/:id', flags.adminRemove);

/* Growth: partners (reseller / accountant / affiliate) + referral rewards */
router.use('/partners', partnerRouter);
router.get('/referrals', referral.adminList);
router.post('/referrals/:id/reward', validate(rewardReferralSchema), referral.adminReward);

export default router;
