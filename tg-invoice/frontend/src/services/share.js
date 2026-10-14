import api from './api';

/**
 * Document sharing.
 *
 * A WhatsApp "click-to-chat" URL can only pre-fill text — it can never attach a
 * file. To send the document *itself* (not just a link) we use the Web Share
 * API: the PDF is handed to the operating system's share sheet, where the user
 * picks WhatsApp (or Mail, Drive, AirDrop…). Desktop browsers without a share
 * sheet fall back to opening WhatsApp with a message + link and saving the PDF
 * so it can be attached manually.
 */

/** Turn a document reference (e.g. INV-00007) into a safe .pdf file name. */
export function pdfFileName(reference) {
  const base = String(reference || 'document')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-');
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** Fetch an authenticated document PDF as a File object. */
export async function fetchPdfFile(path, fileName) {
  const { data } = await api.get(path, { responseType: 'blob' });
  // A JSON body here means the server sent an error as a blob — surface it as
  // a PDF is impossible, so let the caller fall back.
  const type = data?.type && data.type !== 'application/json' ? data.type : 'application/pdf';
  return new File([data], fileName, { type });
}

/** Save an already-fetched blob straight to the user's downloads. */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canShareFile(file) {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/**
 * Share a document the way people expect: the PDF itself lands in WhatsApp
 * (or any installed app) through the OS share sheet.
 *
 * Strategies, best available first:
 *   1. share sheet WITH the PDF attached   → real document share
 *   2. share sheet with a link to the PDF  → link share
 *   3. WhatsApp click-to-chat fallback     → desktop / no share sheet
 *
 * The PDF is fetched once and the same blob is reused for the fallback download.
 *
 * @returns {Promise<'files' | 'link' | 'whatsapp' | 'cancelled'>}
 */
export async function shareDocument({ pdfPath, fileName, title, text, previewUrl, whatsappUrl }) {
  const hasWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // No share sheet available (older/desktop browsers): open WhatsApp *now*,
  // before any await, so the popup is not treated as blocked. The PDF is then
  // fetched and saved for manual attachment.
  let whatsappWindow = null;
  if (!hasWebShare && whatsappUrl) {
    whatsappWindow = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  }

  let file = null;
  try {
    file = await fetchPdfFile(pdfPath, fileName);
  } catch {
    file = null; // still offer the link / WhatsApp fallbacks
  }

  if (hasWebShare) {
    // 1. Share the actual document.
    if (file && canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title, text });
        return 'files';
      } catch (err) {
        if (err?.name === 'AbortError') return 'cancelled';
        // Payload rejected by this browser — fall through to the next strategy.
      }
    }
    // 2. Share a link through the share sheet.
    try {
      await navigator.share({ title, text, url: previewUrl || undefined });
      return 'link';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  // 3. Desktop fallback: WhatsApp with the message, plus the PDF to attach.
  if (!whatsappWindow && whatsappUrl) window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  if (file) saveBlob(file, fileName);
  return 'whatsapp';
}
