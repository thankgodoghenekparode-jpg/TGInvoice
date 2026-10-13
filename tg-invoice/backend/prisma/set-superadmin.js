/**
 * Grant (or revoke) TG Invoice platform-administrator access.
 *
 *   npm run db:superadmin -- super@tginvoice.com
 *   npm run db:superadmin -- super@tginvoice.com 'MyStrongPass!'
 *   npm run db:superadmin -- super@tginvoice.com --name="Super Admin"
 *   npm run db:superadmin -- super@tginvoice.com --revoke
 *
 * This is the break-glass way to grant `User.isPlatformAdmin`: no tenant-facing
 * flow can set it (an existing platform admin can also grant it from /admin).
 * If the account does not exist it is created; if it does it is promoted in
 * place (its password is left untouched unless one is given).
 *
 * Running this also forces the account back to ACTIVE, so a suspended
 * super-admin can always be recovered from the server.
 *
 * SECURITY: change the password immediately after first login in production.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';

const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'ChangeMe123!';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usage(message) {
  if (message) console.error(`\n  ✗ ${message}`);
  console.log(`
  Usage:
    npm run db:superadmin -- <email> [password] [--name="Full Name"] [--revoke]

  Examples:
    npm run db:superadmin -- super@tginvoice.com
    npm run db:superadmin -- super@tginvoice.com 'MyStrongPass!'
    npm run db:superadmin -- super@tginvoice.com --revoke
`);
}

function nameFromEmail(email) {
  const local = email.split('@')[0] || 'admin';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Platform Admin';
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const positional = argv.filter((a) => !a.startsWith('--'));

  const email = (positional[0] || '').toLowerCase().trim();
  const password = positional[1] || null;
  const revoke = flags.includes('--revoke');
  const nameFlag = flags.find((a) => a.startsWith('--name='));
  const name = nameFlag ? nameFlag.slice('--name='.length).replace(/^["']|["']$/g, '') : null;

  if (!email) {
    usage('An email address is required.');
    process.exitCode = 1;
    return;
  }
  if (!EMAIL_RE.test(email)) {
    usage(`"${email}" is not a valid email address.`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (revoke) {
    if (!existing) {
      console.log(`\n  No account found for ${email} — nothing to revoke.\n`);
      return;
    }
    await prisma.user.update({ where: { id: existing.id }, data: { isPlatformAdmin: false } });
    console.log(`\n  ✓ Platform-admin access revoked for ${email}\n`);
    return;
  }

  if (existing) {
    const data = { isPlatformAdmin: true, emailVerified: true, status: 'ACTIVE' };
    if (name) data.name = name;
    if (password) data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await prisma.user.update({ where: { id: existing.id }, data });

    console.log(`\n  ✓ ${email} is now a platform administrator (super-admin).`);
    if (name) console.log(`    Name updated to "${name}".`);
    if (password) console.log('    Password was reset to the one you provided.');
    else console.log('    Existing password left unchanged.');
    console.log('    Account set to ACTIVE (recovered if it was suspended).');
    console.log('\n    Sign in at the normal login page — you will land in /admin.\n');
    return;
  }

  const passwordHash = await bcrypt.hash(password || DEFAULT_PASSWORD, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      name: name || nameFromEmail(email),
      email,
      passwordHash,
      emailVerified: true,
      isPlatformAdmin: true,
    },
  });

  console.log(`\n  ✓ Created platform administrator: ${email}`);
  console.log(`    Name:     ${name || nameFromEmail(email)}`);
  if (!password) {
    console.log(`    Password: ${DEFAULT_PASSWORD}   ← CHANGE THIS AFTER FIRST SIGN-IN`);
  } else {
    console.log('    Password: (the one you provided)');
  }
  console.log('\n    Sign in at the normal login page — you will land in /admin.');
  console.log('    This account has NO business (tenant) membership by design.\n');
}

main()
  .catch((err) => {
    console.error('Failed to configure platform administrator:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
