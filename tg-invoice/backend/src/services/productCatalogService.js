const MAX_NAME = 160;

/** Collapse whitespace and cap a free-typed line description for use as a name. */
function deriveName(description) {
  return String(description || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

/**
 * Auto-save manually typed line items into the tenant's product catalogue.
 *
 * When a business types an item inline (no linked product) while creating a
 * quotation or invoice, we persist it as a reusable Product so it shows up in
 * Products & services for every future document. Existing products are matched
 * case-insensitively by name so the catalogue never fills with duplicates, and
 * the line's own price/tax is left untouched.
 *
 * Runs inside the caller's transaction (`tx`). Mutates `items`, filling in
 * `productId` for each saved row, and returns the products it created.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tenantId
 * @param {Array<object>} items
 * @returns {Promise<Array<{ id: string, name: string }>>} newly created products
 */
export async function saveCustomItemsAsProducts(tx, tenantId, items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const custom = items.filter((it) => !it.productId && deriveName(it.description));
  if (custom.length === 0) return [];

  const names = [...new Set(custom.map((it) => deriveName(it.description)))];
  const existing = await tx.product.findMany({
    where: { tenantId, name: { in: names, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  const idByName = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));

  const created = [];
  const createdByName = new Map();

  for (const it of custom) {
    const name = deriveName(it.description);
    const key = name.toLowerCase();

    let productId = idByName.get(key) || createdByName.get(key);
    if (!productId) {
      const product = await tx.product.create({
        data: {
          tenantId,
          name,
          description: null,
          category: 'Other',
          unit: 'unit',
          unitPrice: Number(it.unitPrice) || 0,
          taxRate: Number(it.taxRate) || 0,
          active: true,
        },
        select: { id: true, name: true },
      });
      productId = product.id;
      createdByName.set(key, productId);
      created.push(product);
    }
    it.productId = productId;
  }

  return created;
}
