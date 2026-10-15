import { useEffect, useMemo, useState } from 'react';
import { ListChecks, Plus, Trash2, PencilLine } from 'lucide-react';
import { apiMessage } from '../../services/api.js';
import {
  customFieldApi,
  ENTITY_LABELS,
  ENTITIES,
  FIELD_TYPES,
  TYPE_LABELS,
} from '../../services/customization.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Badge, Button, Card, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, Select, Tabs,
} from '../../components/ui.jsx';

const blankField = (entity) => ({
  entity,
  label: '',
  type: 'TEXT',
  optionsText: '',
  required: false,
  showOnDocument: false,
  position: 0,
});

export default function CustomFieldsPage() {
  const { role } = useAuth();
  const toast = useToast();
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [entity, setEntity] = useState('INVOICE');
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setFields(await customFieldApi.list());
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load custom fields.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(
    () => Object.fromEntries(ENTITIES.map((e) => [e, fields.filter((f) => f.entity === e).length])),
    [fields]
  );

  const shown = fields.filter((f) => f.entity === entity);

  const openEdit = (field) =>
    setEditing({
      id: field.id,
      entity: field.entity,
      label: field.label,
      type: field.type,
      optionsText: (field.options || []).join('\n'),
      required: field.required,
      showOnDocument: field.showOnDocument,
      position: field.position,
    });

  const save = async () => {
    if (!editing) return;
    if (!editing.label.trim()) return toast.error('Give the field a label.');
    if (editing.type === 'SELECT' && !editing.optionsText.split('\n').map((s) => s.trim()).filter(Boolean).length) {
      return toast.error('Add at least one option for a choice list.');
    }

    setSaving(true);
    const payload = {
      entity: editing.entity,
      label: editing.label.trim(),
      type: editing.type,
      options: editing.type === 'SELECT' ? editing.optionsText.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      required: editing.required,
      showOnDocument: editing.showOnDocument,
      position: Number(editing.position) || 0,
    };
    try {
      if (editing.id) await customFieldApi.update(editing.id, payload);
      else await customFieldApi.create(payload);
      toast.success(editing.id ? 'Field updated.' : 'Field added.');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the field.'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await customFieldApi.remove(toDelete.id);
      toast.success(`“${toDelete.label}” removed.`);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not remove the field.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Custom fields"
        subtitle="Add your own details to customers and documents — then choose whether they print on the PDF."
        actions={
          canEdit && (
            <Button size="sm" onClick={() => setEditing(blankField(entity))}>
              <Plus size={15} /> New field
            </Button>
          )
        }
      />

      {!canEdit && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Only owners and admins can add or change custom fields.
        </div>
      )}

      <Card className="overflow-hidden">
        <Tabs
          tabs={ENTITIES.map((e) => ({ value: e, label: ENTITY_LABELS[e], count: counts[e] }))}
          active={entity}
          onChange={setEntity}
        />

        {loading ? (
          <LoadingBlock label="Loading custom fields…" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={`No fields for ${ENTITY_LABELS[entity].toLowerCase()} yet`}
            description="Custom fields are perfect for project codes, PO numbers, delivery notes and anything else your business tracks."
            action={canEdit ? <Button size="sm" onClick={() => setEditing(blankField(entity))}><Plus size={15} /> New field</Button> : null}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((field) => (
              <li key={field.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    {field.label}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{field.key}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{TYPE_LABELS[field.type] || field.type}</Badge>
                    {field.required && <Badge className="bg-rose-50 text-rose-700 ring-rose-200">required</Badge>}
                    {field.showOnDocument && <Badge className="bg-brand-50 text-brand-700 ring-brand-200">prints on PDF</Badge>}
                    {field.type === 'SELECT' && field.options?.length > 0 && (
                      <span className="truncate">{field.options.join(' · ')}</span>
                    )}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <button type="button" title="Edit" onClick={() => openEdit(field)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <PencilLine size={15} />
                    </button>
                    <button type="button" title="Delete" onClick={() => setToDelete(field)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        Fields marked “prints on PDF” appear under Additional information on generated documents. Values are set on each
        customer or document.
      </p>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit custom field' : 'New custom field'}
        description={editing ? `Applies to ${ENTITY_LABELS[editing.entity].toLowerCase()}.` : ''}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing?.id ? 'Save field' : 'Add field'}</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Label" required>
                <input
                  className="input"
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="e.g. Project reference"
                  autoFocus
                />
              </Field>
              <Field label="Type">
                <Select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {editing.type === 'SELECT' && (
              <Field label="Options" hint="One option per line." required>
                <textarea
                  rows={4}
                  className="input"
                  value={editing.optionsText}
                  onChange={(e) => setEditing({ ...editing, optionsText: e.target.value })}
                  placeholder={'Courier\nPickup\nWalk-in'}
                />
              </Field>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Sort order" hint="Lower numbers appear first.">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={editing.position}
                  onChange={(e) => setEditing({ ...editing, position: e.target.value })}
                />
              </Field>
              <div className="flex flex-col justify-end gap-3 pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="size-4 rounded border-slate-300" checked={editing.required} onChange={(e) => setEditing({ ...editing, required: e.target.checked })} />
                  Required
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="size-4 rounded border-slate-300" checked={editing.showOnDocument} onChange={(e) => setEditing({ ...editing, showOnDocument: e.target.checked })} />
                  Print on the PDF
                </label>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        danger
        title="Delete custom field"
        confirmLabel="Delete field"
        message={`Delete “${toDelete?.label}”? Values already saved on records are removed too.`}
      />
    </div>
  );
}
