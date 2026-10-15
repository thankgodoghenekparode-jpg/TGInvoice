import { useEffect, useState } from 'react';
import { RotateCcw, Palette } from 'lucide-react';
import { apiMessage } from '../../services/api.js';
import { templateApi, TEMPLATE_KINDS } from '../../services/customization.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Button, Card, CardHeader, Field, LoadingBlock, Tabs } from '../../components/ui.jsx';

const DEFAULT_ACCENT = '#2563EB';

const formFrom = (t) => ({
  name: t?.name || '',
  accentColor: t?.accentColor || '',
  showLogo: t?.showLogo ?? true,
  showBankDetails: t?.showBankDetails ?? true,
  headerNote: t?.headerNote || '',
  footerNote: t?.footerNote || '',
});

export default function TemplatesPage() {
  const { role } = useAuth();
  const toast = useToast();
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [kind, setKind] = useState('INVOICE');
  const [byKind, setByKind] = useState({});
  const [form, setForm] = useState(formFrom(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await templateApi.list();
      const map = Object.fromEntries(list.map((t) => [t.kind, t]));
      setByKind(map);
      setForm(formFrom(map.INVOICE));
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load document templates.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchKind = (value) => {
    setKind(value);
    setForm(formFrom(byKind[value]));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await templateApi.save(kind, {
        name: form.name || undefined,
        accentColor: form.accentColor || null,
        showLogo: form.showLogo,
        showBankDetails: form.showBankDetails,
        headerNote: form.headerNote || null,
        footerNote: form.footerNote || null,
      });
      setByKind((m) => ({ ...m, [kind]: saved }));
      setForm(formFrom(saved));
      toast.success('Template saved.');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the template.'));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      const fresh = await templateApi.reset(kind);
      setByKind((m) => ({ ...m, [kind]: fresh }));
      setForm(formFrom(fresh));
      toast.success('Template reset to the default look.');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not reset the template.'));
    } finally {
      setResetting(false);
    }
  };

  const isCustom = Boolean(byKind[kind]?.id);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Document templates"
        subtitle="Control the accent colour, branding and notes on the PDFs you send."
        actions={
          canEdit && isCustom && (
            <Button size="sm" variant="secondary" onClick={reset} loading={resetting}>
              <RotateCcw size={15} /> Reset to default
            </Button>
          )
        }
      />

      {!canEdit && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Only owners and admins can change document templates.
        </div>
      )}

      <Card className="overflow-hidden">
        <Tabs
          tabs={TEMPLATE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          active={kind}
          onChange={switchKind}
        />

        {loading ? (
          <LoadingBlock label="Loading templates…" />
        ) : (
          <div className="space-y-5 p-5">
            <CardHeader
              className="border-0 p-0"
              title={`${TEMPLATE_KINDS.find((k) => k.value === kind)?.label} template`}
              subtitle={isCustom ? 'A saved template is applied to every new PDF.' : 'Using the built-in look — change anything below to save your own.'}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Accent colour" hint="Used for the header bar, title and totals.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Accent colour picker"
                    className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                    value={form.accentColor || DEFAULT_ACCENT}
                    onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                    disabled={!canEdit}
                  />
                  <input
                    className="input font-mono"
                    value={form.accentColor}
                    placeholder="Built-in blue"
                    onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                    disabled={!canEdit}
                  />
                  {form.accentColor && canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, accentColor: '' })}>Clear</Button>
                  )}
                </div>
              </Field>

              <div className="flex flex-col justify-end gap-3 pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="size-4 rounded border-slate-300" checked={form.showLogo} onChange={(e) => setForm({ ...form, showLogo: e.target.checked })} disabled={!canEdit} />
                  Show the company logo
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="size-4 rounded border-slate-300" checked={form.showBankDetails} onChange={(e) => setForm({ ...form, showBankDetails: e.target.checked })} disabled={!canEdit} />
                  Show bank details
                </label>
              </div>
            </div>

            <Field label="Header note" hint="Appears just under the document header.">
              <textarea rows={2} className="input" value={form.headerNote} onChange={(e) => setForm({ ...form, headerNote: e.target.value })} placeholder="e.g. Thank you for your business." disabled={!canEdit} />
            </Field>

            <Field label="Footer note" hint="Replaces the default “thank you” line at the bottom of every page.">
              <textarea rows={2} className="input" value={form.footerNote} onChange={(e) => setForm({ ...form, footerNote: e.target.value })} placeholder="e.g. Payment due within 14 days." disabled={!canEdit} />
            </Field>

            {canEdit && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Palette size={13} /> Saved templates only affect documents generated after saving.
                </p>
                <Button onClick={save} loading={saving}>Save template</Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
