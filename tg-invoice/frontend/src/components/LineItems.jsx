import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api.js';
import { useSettings } from '../hooks/useSettings.js';
import { formatMoney } from '../utils/currency.js';
import { calcLine, calcTotals } from '../utils/lineMath.js';

const blankRow = (defaults = {}) => ({
  productId: null,
  description: '',
  quantity: 1,
  unitPrice: '',
  discountType: null,
  discountValue: '',
  taxRate: '',
  ...defaults,
});

/**
 * Line-items editor with a live totals preview.
 * Server re-computes everything on save — this is UX only.
 */
export default function LineItems({ items, onChange, defaultTaxRate = 0, showErrors = false }) {
  const { settings } = useSettings();
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api
      .get('/products', { params: { limit: 100, active: 'true' } })
      .then(({ data }) => setProducts(data.data || []))
      .catch(() => setProducts([]));
  }, []);

  const money = (v) => formatMoney(v, settings);

  const update = (index, patch) => {
    onChange(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const pickProduct = (index, productId) => {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      update(index, { productId: null });
      return;
    }
    update(index, {
      productId: p.id,
      description: p.description ? `${p.name} — ${p.description}`.slice(0, 500) : p.name,
      unitPrice: p.unitPrice,
      taxRate: p.taxRate,
    });
  };

  const addRow = () => onChange([...items, blankRow({ taxRate: defaultTaxRate || 0 })]);
  const removeRow = (index) => onChange(items.filter((_, i) => i !== index));

  const totals = useMemo(() => calcTotals(items), [items]);

  return (
    <div className="space-y-3">
      <div className="hidden rounded-t-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid md:grid-cols-[minmax(0,1fr)_80px_120px_100px_80px_120px_36px] md:gap-2">
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span className="text-right">Discount</span>
        <span className="text-right">Tax %</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      <div className="space-y-2">
        {items.map((row, i) => {
          const line = calcLine(row);
          const missingDesc = showErrors && !row.description.trim();
          const missingQty = showErrors && !(Number(row.quantity) > 0);
          const missingPrice = showErrors && (row.unitPrice === '' || Number.isNaN(Number(row.unitPrice)));
          const rowFlagged = missingDesc || missingQty || missingPrice;
          return (
            <div
              key={i}
              className={clsx(
                'rounded-lg border bg-white p-3 md:grid md:grid-cols-[minmax(0,1fr)_80px_120px_100px_80px_120px_36px] md:items-start md:gap-2',
                rowFlagged ? 'border-rose-300' : 'border-slate-200'
              )}
            >
              <div className="mb-2 space-y-1.5 md:mb-0">
                <input
                  className={clsx('input', missingDesc && 'border-rose-400')}
                  placeholder="Type a new item or service…"
                  value={row.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
                <select
                  className="input text-xs"
                  value={row.productId || ''}
                  onChange={(e) => pickProduct(i, e.target.value)}
                >
                  <option value="">New / custom item — just type the description above</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.unitPrice, settings)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-2 md:mb-0">
                <label className="mb-1 block text-[10px] uppercase text-slate-400 md:hidden">Qty</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={clsx('input text-right', missingQty && 'border-rose-400')}
                  value={row.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                />
              </div>

              <div className="mb-2 md:mb-0">
                <label className="mb-1 block text-[10px] uppercase text-slate-400 md:hidden">Unit price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={clsx('input text-right', missingPrice && 'border-rose-400')}
                  value={row.unitPrice}
                  onChange={(e) => update(i, { unitPrice: e.target.value })}
                />
              </div>

              <div className="mb-2 md:mb-0">
                <label className="mb-1 block text-[10px] uppercase text-slate-400 md:hidden">Discount</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input min-w-0 text-right"
                    value={row.discountValue}
                    onChange={(e) =>
                      update(i, {
                        discountValue: e.target.value,
                        discountType: e.target.value === '' ? null : row.discountType || 'FIXED',
                      })
                    }
                    placeholder="0"
                  />
                  <button
                    type="button"
                    title={row.discountType === 'PERCENT' ? 'Percent' : 'Fixed amount'}
                    onClick={() =>
                      update(i, {
                        discountType: row.discountType === 'PERCENT' ? 'FIXED' : 'PERCENT',
                        discountValue: row.discountValue || 0,
                      })
                    }
                    className="w-9 shrink-0 rounded-md border border-slate-300 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    {row.discountType === 'PERCENT' ? '%' : settings.currencySymbol || '₦'}
                  </button>
                </div>
              </div>

              <div className="mb-2 md:mb-0">
                <label className="mb-1 block text-[10px] uppercase text-slate-400 md:hidden">Tax %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="input text-right"
                  value={row.taxRate}
                  onChange={(e) => update(i, { taxRate: e.target.value })}
                  placeholder="0"
                />
              </div>

              <div className="flex items-center justify-between md:justify-end">
                <span className="text-sm font-semibold text-slate-900 md:hidden">{money(line.amount)}</span>
                <span className="hidden text-sm font-semibold text-slate-900 md:block">{money(line.amount)}</span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={items.length === 1}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  title="Remove line"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
          <Plus size={15} /> Add line
        </button>

        <div className="w-full max-w-xs rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white p-3 text-sm">
          <div className="flex justify-between py-0.5 text-slate-500">
            <span>Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          {totals.discountAmount > 0 && (
            <div className="flex justify-between py-0.5 text-slate-500">
              <span>Discount</span>
              <span>− {money(totals.discountAmount)}</span>
            </div>
          )}
          {totals.taxAmount > 0 && (
            <div className="flex justify-between py-0.5 text-slate-500">
              <span>Tax</span>
              <span>{money(totals.taxAmount)}</span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-900">Total</span>
            <span className="text-lg font-bold text-brand-600">{money(totals.total)}</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">Preview — final totals are calculated by the server.</p>
        </div>
      </div>
    </div>
  );
}

export { blankRow };
