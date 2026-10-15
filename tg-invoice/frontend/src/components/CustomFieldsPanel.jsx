import { useEffect, useState } from 'react';
import { apiMessage } from '../services/api.js';
import { customFieldApi } from '../services/customization.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Select } from './ui.jsx';

/**
 * Tenant-defined extra fields for one record (customer/invoice/…).
 * Renders nothing when the business hasn't defined any fields for that entity,
 * so it can be dropped onto every detail page unconditionally.
 */

function FieldInput({ field, value, onChange }) {
  if (field.type === 'BOOLEAN') {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    );
  }
  if (field.type === 'SELECT') {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options || []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    );
  }
  if (field.type === 'DATE') {
    return <input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'NUMBER') {
    return <input type="number" step="any" className="input" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export default function CustomFieldsPanel({ entity, entityId, title = 'Additional information' }) {
  const toast = useToast();
  const [fields, setFields] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!entity || !entityId) return undefined;
    let active = true;
    setFields(null);
    customFieldApi
      .values(entity, entityId)
      .then((data) => {
        if (!active) return;
        const list = data?.fields || [];
        setFields(list);
        setValues(Object.fromEntries(list.map((f) => [f.key, f.value ?? ''])));
        setDirty(false);
      })
      .catch(() => {
        if (active) setFields([]);
      });
    return () => {
      active = false;
    };
  }, [entity, entityId]);

  if (!fields || fields.length === 0) return null;

  const setValue = (key, v) => {
    setValues((s) => ({ ...s, [key]: v }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await customFieldApi.saveValues({ entity, entityId, values });
      const list = data?.fields || [];
      setFields(list);
      setValues(Object.fromEntries(list.map((f) => [f.key, f.value ?? ''])));
      setDirty(false);
      toast.success('Details saved.');
    } catch (err) {
      setError(apiMessage(err, 'Could not save these details.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <Button size="sm" variant="secondary" onClick={save} loading={saving} disabled={!dirty}>
          Save details
        </Button>
      </div>
      <Card className="p-5">
        {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              <FieldInput field={f} value={values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} />
            </Field>
          ))}
        </div>
      </Card>
    </section>
  );
}
