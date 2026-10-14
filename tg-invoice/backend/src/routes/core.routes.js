import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as tenants from '../controllers/tenantController.js';
import * as settings from '../controllers/settingsController.js';
import * as customers from '../controllers/customerController.js';
import * as products from '../controllers/productController.js';
import * as team from '../controllers/teamController.js';
import * as audit from '../controllers/auditController.js';
import * as search from '../controllers/searchController.js';
import * as flags from '../controllers/featureFlagController.js';
import { validate } from '../middleware/errorHandler.js';
import { customerSchema, productSchema } from '../validators/documentValidators.js';

/* ── Authenticated, tenant-free routes ────────────────────────────── */

export const tenantRouter = Router();
tenantRouter.use(requireAuth);
tenantRouter.get('/', tenants.listTenants);
tenantRouter.post('/', tenants.createTenant);
tenantRouter.post('/switch', tenants.switchTenant);
tenantRouter.get('/:id', tenants.getTenant);
tenantRouter.put('/:id', tenants.updateTenant);

/* ── Public invitation endpoints (token = credential) ─────────────── */

export const invitationRouter = Router();
invitationRouter.get('/:token', team.getInvitation);
invitationRouter.post('/accept', team.acceptInvitation);

/* ── Settings (active tenant context applied in app.js) ───────────── */

export const settingsRouter = Router();
settingsRouter.get('/', settings.getSettings);
settingsRouter.put('/', requireAdmin, settings.updateSettings);
settingsRouter.post('/logo', requireAdmin, settings.uploadLogo, settings.setLogo);
settingsRouter.delete('/logo', requireAdmin, settings.removeLogo);

/* ── Customer CRUD ────────────────────────────────────────────────── */

export const customerRouter = Router();
customerRouter.get('/', customers.listCustomers);
customerRouter.get('/:id', customers.getCustomer);
customerRouter.post('/', validate(customerSchema), customers.createCustomer);
customerRouter.put('/:id', validate(customerSchema), customers.updateCustomer);
customerRouter.delete('/:id', customers.deleteCustomer);

/* ── Products CRUD ────────────────────────────────────────────────── */

export const productRouter = Router();
productRouter.get('/', products.listProducts);
productRouter.get('/:id', products.getProduct);
productRouter.post('/', validate(productSchema), products.createProduct);
productRouter.put('/:id', validate(productSchema), products.updateProduct);
productRouter.delete('/:id', products.deleteProduct);

/* ── Team ─────────────────────────────────────────────────────────── */

export const teamRouter = Router();
teamRouter.get('/', team.listTeam);
teamRouter.post('/invite', requireAdmin, team.inviteMember);
teamRouter.put('/:id', requireAdmin, team.updateMember);
teamRouter.patch('/:id/expiry', requireAdmin, (req, res, next) => {
  import('../validators/teamValidators.js').then((m) => {
    validate(m.setMemberExpirySchema)(req, res, next);
  });
}, team.setMemberExpiry);
teamRouter.delete('/:id', requireAdmin, team.removeMember);

/* ── Audit & search ───────────────────────────────────────────────── */

export const auditRouter = Router();
auditRouter.get('/', requireAdmin, audit.listAuditLogs);

export const searchRouter = Router();
searchRouter.get('/', search.globalSearch);

/* ── Feature flags (public: login & marketing gate on them too) ──── */

export const flagRouter = Router();
flagRouter.get('/', flags.list);
