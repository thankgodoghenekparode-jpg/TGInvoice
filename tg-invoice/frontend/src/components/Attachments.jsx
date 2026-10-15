import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, Download, Trash2, FileText } from 'lucide-react';
import clsx from 'clsx';
import { apiMessage } from '../services/api.js';
import { attachmentApi } from '../services/attachments.js';
import { downloadPdf } from '../services/files.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, ConfirmDialog, LoadingBlock } from './ui.jsx';
import { formatDateTime } from '../utils/dates.js';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip';
const MAX_MB = 10;

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Attachments panel — list, upload, download and remove files for one document.
 * Works for any DocumentKind (CUSTOMER / QUOTATION / INVOICE / RECEIPT / CREDIT_NOTE).
 */
export default function Attachments({ documentKind, documentId, title = 'Attachments' }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    if (!documentKind || !documentId) return;
    setLoading(true);
    attachmentApi
      .list(documentKind, documentId)
      .then((data) => {
        setRows(data || []);
        setError('');
      })
      .catch((err) => setError(apiMessage(err, 'Could not load attachments.')))
      .finally(() => setLoading(false));
  }, [documentKind, documentId]);

  useEffect(() => { load(); }, [load]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`That file is too large — the maximum is ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      await attachmentApi.upload(documentKind, documentId, file);
      toast.success(`${file.name} attached.`);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not upload the file.'));
    } finally {
      setUploading(false);
    }
  };

  const download = async (row) => {
    try {
      await downloadPdf(row.url, row.fileName);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not download the file.'));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await attachmentApi.remove(toDelete.id);
      toast.success('Attachment deleted.');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the attachment.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Paperclip size={16} className="text-slate-400" /> {title}
          {rows.length > 0 && <span className="text-slate-400">({rows.length})</span>}
        </h2>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
        <Button variant="secondary" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
          <Upload size={15} /> Attach file
        </Button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <LoadingBlock label="Loading attachments…" />
        ) : error ? (
          <p className="px-4 py-6 text-sm text-rose-600">{error}</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <FileText size={22} className="text-slate-300" />
            <p className="text-sm text-slate-500">No files attached yet.</p>
            <p className="text-xs text-slate-400">
              Attach contracts, purchase orders, receipts or photos (up to {MAX_MB} MB each).
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <FileText size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{row.fileName}</p>
                  <p className="text-xs text-slate-400">
                    {formatBytes(row.size)}
                    {row.uploadedBy?.name ? ` · ${row.uploadedBy.name}` : ''} · {formatDateTime(row.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  title="Download"
                  onClick={() => download(row)}
                  className={clsx('rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-700')}
                >
                  <Download size={16} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => setToDelete(row)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        danger
        title="Delete attachment"
        confirmLabel="Delete file"
        message={`Delete “${toDelete?.fileName}”? This removes the file permanently.`}
      />
    </section>
  );
}
