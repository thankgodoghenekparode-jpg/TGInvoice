import api, { getAccessToken, getStoredTenantId } from './api';

/**
 * Document file helpers — PDFs require the Authorization header, so they are
 * fetched as blobs rather than linked directly.
 */

async function fetchPdf(path) {
  const res = await api.get(path, { responseType: 'blob' });
  return res.data;
}

export async function downloadPdf(path, fileName) {
  const blob = await fetchPdf(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || path.split('/').pop() || 'document.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Open the PDF in a new tab and trigger the browser print dialog. */
export async function printPdf(path) {
  const blob = await fetchPdf(path);
  const url = URL.createObjectURL(blob);
  const win = window.open('', '_blank');
  if (!win) {
    // Popup blocked → fall back to downloading.
    return downloadPdf(path);
  }
  win.document.write(`
    <html><head><title>${path.split('/').pop()}</title>
    <style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style>
    </head><body><iframe src="${url}"></iframe></body></html>`);
  win.document.close();
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      /* user can print from the viewer */
    }
  }, 600);
}

/** Alternative for authenticated files that must be shown inline (logos etc.). */
export async function authenticatedFileUrl(path) {
  const blob = await fetchPdf(path);
  return URL.createObjectURL(blob);
}

export { getAccessToken, getStoredTenantId };
