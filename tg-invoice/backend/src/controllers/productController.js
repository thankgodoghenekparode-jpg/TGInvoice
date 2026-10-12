import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, paged, parseListQuery, searchFilter } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';

const SORTABLE = ['name', 'unitPrice', 'category', 'createdAt', 'updatedAt'];

const serialize = (p) => ({ ...p, unitPrice: Number(p.unitPrice), taxRate: Number(p.taxRate) });

/* ── GET /api/products ────────────────────────────────────────────── */

export const listProducts = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-createdAt' });
  const where = {
    tenantId: req.tenant.id,
    ...(req.query.active === 'true' ? { active: true } : {}),
    ...searchFilter(req.query.search, ['name', 'description', 'category']),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.product.count({ where }),
  ]);

  ok(res, rows.map(serialize), { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!product) throw errors.notFound('Product not found.');
  ok(res, serialize(product));
});

export const createProduct = asyncHandler(async (req, res) => {
  const b = req.body;
  const product = await prisma.product.create({
    data: {
      tenantId: req.tenant.id,
      name: b.name,
      description: b.description || null,
      category: b.category || 'OTHER',
      unit: b.unit || 'unit',
      unitPrice: b.unitPrice ?? 0,
      taxRate: b.taxRate ?? 0,
      active: b.active ?? true,
    },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_PRODUCT', 'product', {
    entityId: product.id,
    entityLabel: product.name,
    description: `${req.user.name} added product/service ${product.name}`,
  });

  created(res, serialize(product));
});

export const updateProduct = asyncHandler(async (req, res) => {
  const existing = await prisma.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Product not found.');

  const b = req.body;
  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      name: b.name,
      description: b.description || null,
      category: b.category || 'OTHER',
      unit: b.unit || 'unit',
      unitPrice: b.unitPrice ?? 0,
      taxRate: b.taxRate ?? 0,
      active: b.active ?? true,
    },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_PRODUCT', 'product', {
    entityId: product.id,
    entityLabel: product.name,
    description: `${req.user.name} edited ${product.name}`,
  });

  ok(res, serialize(product));
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const existing = await prisma.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Product not found.');

  // Products referenced by historical documents are archived, not deleted.
  const used = await prisma.invoiceItem.count({ where: { productId: existing.id } });
  const quoted = await prisma.quotationItem.count({ where: { productId: existing.id } });

  if (used > 0 || quoted > 0) {
    await prisma.product.update({ where: { id: existing.id }, data: { active: false } });
    await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'ARCHIVE_PRODUCT', 'product', {
      entityId: existing.id,
      entityLabel: existing.name,
      description: `${req.user.name} archived ${existing.name} (used on documents)`,
    });
    return ok(res, { message: 'Product is used on documents, so it was archived instead of deleted.', archived: true });
  }

  await prisma.product.delete({ where: { id: existing.id } });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_PRODUCT', 'product', {
    entityId: existing.id,
    entityLabel: existing.name,
    description: `${req.user.name} deleted ${existing.name}`,
  });
  return ok(res, { message: 'Product deleted.' });
});
