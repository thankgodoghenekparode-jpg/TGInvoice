import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const shell = path.join(dist, 'index.html');

const routes = [
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
  'accept-invitation',
  'onboarding',
  'admin',
  'dashboard',
  'customers',
  'customers/new',
  'products',
  'products/new',
  'quotations',
  'quotations/new',
  'invoices',
  'invoices/new',
  'receipts',
  'reports',
  'team',
  'settings',
  'settings/company',
  'settings/documents',
  'settings/profile',
  '404',
];

await copyFile(shell, path.join(dist, '404.html'));

await Promise.all(
  routes.map(async (route) => {
    const target = path.join(dist, ...route.split('/'));
    await mkdir(target, { recursive: true });
    await copyFile(shell, path.join(target, 'index.html'));
  })
);

console.log(`Generated SPA fallbacks for ${routes.length} routes.`);
