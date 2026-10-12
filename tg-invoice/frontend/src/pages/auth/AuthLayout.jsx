import { Link } from 'react-router-dom';
import heroBg from '../../assets/invoice-bg.jpg';

/** Centred branded shell for all authentication pages. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-50">
      <img src={heroBg} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/85 via-white/55 to-brand-100/30" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(37,99,235,0.12),transparent_55%)]" />
      <header className="relative flex h-16 animate-fade-in items-center justify-between px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            TG
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            TG Invoice <span className="text-xs font-normal text-slate-400">by tgeasy</span>
          </span>
        </Link>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to site
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md animate-fade-up">
          <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/70 via-white to-white p-6 shadow-soft sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </main>

      <footer className="relative py-6 text-center text-xs text-slate-400">
        TG Invoice — invoicing, quotations & receipts by tgeasy
      </footer>
    </div>
  );
}
