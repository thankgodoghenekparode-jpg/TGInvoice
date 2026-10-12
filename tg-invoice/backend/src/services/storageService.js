import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Storage abstraction — business logic never touches disk paths directly.
 *
 * swapFileUpload / getPublicUrl / deleteFile are the whole contract, so a
 * cloud driver (S3 / Cloudinary / Render Disk + CDN) can replace the local
 * driver without touching any controller:
 *
 *   class S3Driver { async save(buffer, key, contentType) { … } async remove(key) {…} }
 */

class LocalDriver {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  async save(buffer, key) {
    const fullPath = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return key; // stored key — never a server filesystem path
  }

  async remove(key) {
    try {
      await fs.unlink(path.join(this.baseDir, key));
    } catch {
      /* already gone */
    }
  }
}

const drivers = {
  local: () => new LocalDriver(path.resolve(process.cwd(), config.storage.localDir)),
  // s3: () => new S3Driver({ bucket: process.env.S3_BUCKET, … }),
};

const driver = (drivers[config.storage.driver] || drivers.local)();

/** Public URL for a stored key (used in <img src> and PDF embedding). */
export function getPublicUrl(key) {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key; // already a full URL (cloud driver)
  return `/uploads/${key}`;
}

/**
 * Persist an uploaded file.
 * @param {Buffer} buffer
 * @param {{ folder: string, ext: string }} opts
 * @returns {Promise<string>} storage key
 */
export async function saveFile(buffer, { folder = 'misc', ext = 'bin' } = {}) {
  const name = `${crypto.randomUUID()}.${ext.replace(/^\./, '')}`;
  const key = `${folder}/${name}`;
  await driver.save(buffer, key);
  return key;
}

export async function deleteFile(key) {
  if (!key || /^https?:\/\//.test(key)) return;
  await driver.remove(key);
}

export default { saveFile, deleteFile, getPublicUrl };
