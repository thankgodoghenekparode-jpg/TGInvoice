import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, RotateCcw, Upload, XCircle } from 'lucide-react';
import { apiMessage } from '../../services/api.js';
import { IMPORT_TYPES, previewImport, runImport, downloadTemplate } from '../../services/imports.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Badge, Button, Card, CardHeader, Tabs } from '../../components/ui.jsx';

/**
 * CSV / Excel importer for customers and products.
 * Preview first (nothing is written), then confirm — bad rows are skipped and
 * explained rather than blocking the whole file.
 */

const STATUS_META = {
  create: { label: 'New', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  update: { label: 'Update', className: 'bg-brand-50 text-brand-700 ring-brand-200' },
  error: { label: 'Skip', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

const cellText = (value) => (value === true ? 'Yes' : value === false ? 'No' : (value ?? '—'));

export default function ImportPage() {
  const toast = useToast();
  const inputRef = useRef(null);

  const [type, setType] = useState('customers');
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const active = IMPORT_TYPES.find((t) => t.value === type);

  const reset = () => {
    setFile(null);
    setPlan(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  /** Pick a file and immediately preview it (no writes). */
  const handlePick = async (picked) => {
    if (!picked) return;
    setFile(picked);
    setPlan(null);
    setResult(null);
    setBusy(true);
    try {
      setPlan(await previewImport(type, picked));
    } catch (err) {
      toast.error(apiMessage(err, 'Could not read that file.'));
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await runImport(type, file);
      setResult(data);
      setPlan(null);
      const saved = data.created + data.updated;
      toast.success(`Imported ${saved} row${saved === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not import this file.'));
    } finally {
      setBusy(false);
    }
  };

  const columns = plan ? plan.fields.filter((f) => plan.mapping[f.key] != null) : [];
  const importable = plan ? plan.summary.create + plan.summary.update : 0;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Import data"
        subtitle="Bring your customers or product list across from a spreadsheet. Nothing is saved until you confirm."
      />

      <Card className="overflow-hidden">
        <Tabs
          tabs={IMPORT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          active={type}
          onChange={(v) => {
            setType(v);
            reset();
          }}
        />

        <div className="space-y-5 p-5">
          <CardHeader
            className="border-0 p-0"
            title={active?.label}
            subtitle={active?.description}
            action={
              <Button size="sm" variant="secondary" onClick={() => downloadTemplate(type)}>
                <Download size={15} /> Template
              </Button>
            }
          />

          {!plan && !result && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handlePick(e.dataTransfer?.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-slate-50/60'
              }`}
            >
              <FileSpreadsheet className="mb-3 text-slate-400" size={30} />
              <p className="text-sm font-medium text-slate-700">Drop a .csv or .xlsx file here</p>
              <p className="mt-1 text-xs text-slate-500">
                Up to 5 MB · download the template above if you&apos;re unsure of the columns
              </p>
              <Button className="mt-4" size="sm" onClick={() => inputRef.current?.click()} loading={busy}>
                <Upload size={15} /> Choose file
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                className="hidden"
                onChange={(e) => handlePick(e.target.files?.[0])}
              />
            </div>
          )}

          {plan?.missingRequired?.length > 0 && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              This file is missing the required column{plan.missingRequired.length > 1 ? 's' : ''}:{' '}
              <span className="font-semibold">{plan.missingRequired.join(', ')}</span>. Download the template to see the
              expected headings.
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={reset}>
                  <RotateCcw size={15} /> Try another file
                </Button>
              </div>
            </div>
          )}

          {plan && plan.missingRequired.length === 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">{plan.summary.total}</span> rows in{' '}
                  <span className="font-medium">{plan.fileName}</span>
                </span>
                {plan.summary.create > 0 && <Badge className={STATUS_META.create.className}>{plan.summary.create} new</Badge>}
                {plan.summary.update > 0 && (
                  <Badge className={STATUS_META.update.className}>{plan.summary.update} to update</Badge>
                )}
                {plan.summary.errors > 0 && (
                  <Badge className={STATUS_META.error.className}>{plan.summary.errors} to skip</Badge>
                )}
              </div>

              {plan.ignoredHeaders?.length > 0 && (
                <p className="text-xs text-slate-500">
                  Ignoring unrecognised column{plan.ignoredHeaders.length > 1 ? 's' : ''}: {plan.ignoredHeaders.join(', ')}
                </p>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      {columns.map((f) => (
                        <th key={f.key} className="px-3 py-2 font-medium">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.rows.map((row) => (
                      <tr key={row.sourceRow} className={row.action === 'error' ? 'bg-rose-50/40' : undefined}>
                        <td className="px-3 py-2 text-slate-400">{row.sourceRow}</td>
                        <td className="px-3 py-2">
                          <Badge className={STATUS_META[row.action].className}>{STATUS_META[row.action].label}</Badge>
                          {row.errors?.length > 0 && <p className="mt-1 text-xs text-rose-600">{row.errors.join(' ')}</p>}
                        </td>
                        {columns.map((f) => (
                          <td key={f.key} className="px-3 py-2 text-slate-700">
                            {cellText(row.values[f.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <Button size="sm" variant="ghost" onClick={reset}>
                  <RotateCcw size={15} /> Choose another file
                </Button>
                <div className="flex items-center gap-3">
                  {plan.summary.errors > 0 && <span className="text-xs text-slate-500">Rows marked “Skip” will be left out.</span>}
                  <Button onClick={handleCommit} loading={busy} disabled={importable === 0}>
                    Import {importable} row{importable === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} />
                <div className="text-sm text-emerald-800">
                  <p className="font-semibold">Import complete</p>
                  <p className="mt-0.5">
                    {result.created} created · {result.updated} updated · {result.skipped} skipped
                  </p>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="rounded-xl border border-slate-200">
                  <p className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-700">Skipped rows</p>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {result.errors.map((e) => (
                      <li key={e.row} className="flex items-start gap-2 px-4 py-2 text-slate-600">
                        <XCircle className="mt-0.5 shrink-0 text-rose-500" size={15} />
                        <span>
                          <span className="font-medium text-slate-700">Row {e.row}:</span> {e.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button variant="secondary" onClick={reset}>
                <Upload size={15} /> Import another file
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
