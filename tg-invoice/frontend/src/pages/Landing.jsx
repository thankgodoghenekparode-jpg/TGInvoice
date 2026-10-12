import { Link } from 'react-router-dom';
import {
  FileText,
  Receipt,
  Users,
  BarChart3,
  Shield,
  Smartphone,
  Check,
  ArrowRight,
  Layers,
} from 'lucide-react';
// Bundled background photo — Unsplash (free for commercial use, no attribution
// required): "person using a calculator over finance documents". Swap this file
// to rebrand the marketing pages.
import heroBg from '../assets/invoice-bg.jpg';
import { Reveal } from '../components/ui.jsx';

const features = [
  {
    icon: FileText,
    title: 'Quotations → Invoices',
    text: 'Send a polished quotation, win the job, and convert it to an invoice in one click — no re-typing.',
  },
  {
    icon: Receipt,
    title: 'Payments & receipts',
    text: 'Record partial or full payments and automatically generate numbered receipts your clients trust.',
  },
  {
    icon: Shield,
    title: 'Server-calculated money',
    text: 'Every total, balance and status is recalculated on the backend in integer cents. No rounding bugs.',
  },
  {
    icon: Layers,
    title: 'Multi-business switcher',
    text: 'Run several businesses from one account. Each has its own customers, documents, numbering and team.',
  },
  {
    icon: BarChart3,
    title: 'Reports that answer questions',
    text: 'Revenue, outstanding balances, top customers and paid-vs-unpaid breakdowns over any date range.',
  },
  {
    icon: Smartphone,
    title: 'Share on WhatsApp or email',
    text: 'Send documents straight to WhatsApp or email with a beautiful web preview and a real PDF attached.',
  },
];

const steps = [
  { n: '01', title: 'Create your business', text: 'Sign up, name your company, set currency and logo.' },
  { n: '02', title: 'Add customers & products', text: 'Import the basics you bill for, once.' },
  { n: '03', title: 'Quote, invoice, get paid', text: 'Send documents, record payments, watch reports.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
              TG
            </span>
            <span className="text-lg font-semibold tracking-tight">
              TG Invoice <span className="text-xs font-normal text-muted">by tgeasy</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-muted hover:text-ink">
              Sign in
            </Link>
            <Link to="/register" className="btn btn-primary btn-sm">
              Get started free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <img
          src={heroBg}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/55 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white/70 via-transparent to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.12),transparent_55%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-3xl animate-fade-up">
            <span className="badge badge-info mb-5">Invoicing for modern businesses</span>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
              Quotations, invoices and payments — <span className="text-gradient-brand">without the spreadsheet chaos.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              TG Invoice helps you send professional quotations, convert them to invoices, record payments and
              issue receipts automatically — with bank-grade accuracy and per-business numbering.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/register" className="btn btn-primary">
                Start free <ArrowRight size={16} />
              </Link>
              <Link to="/login" className="btn btn-secondary">
                Sign in to your dashboard
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted">No credit card required · Your data stays in your own workspace</p>
          </div>

          {/* Preview */}
          <div className="relative mt-14 animate-fade-up card-blue p-4 sm:p-6" style={{ animationDelay: '120ms' }}>
            <div className="pointer-events-none absolute -right-4 -top-5 hidden animate-float rounded-xl border border-emerald-100 bg-white px-3 py-2 shadow-soft sm:block">
              <p className="text-[11px] font-medium text-slate-500">Payment received</p>
              <p className="text-sm font-semibold text-emerald-600">+₦415,000.00</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Invoiced this month', value: '₦2,450,000' },
                { label: 'Collected', value: '₦1,830,000' },
                { label: 'Outstanding', value: '₦620,000' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-line bg-canvas p-4">
                  <p className="text-xs uppercase tracking-wider text-muted">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{s.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-canvas text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Document</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    ['INV-00004', 'Northwind Retail', '₦415,000', 'PAID'],
                    ['INV-00003', 'Acme Studios', '₦120,000', 'PARTIALLY_PAID'],
                    ['QT-00005', 'Bella Foods', '₦86,500', 'SENT'],
                  ].map((r) => (
                    <tr key={r[0]}>
                      <td className="px-4 py-2.5 font-medium">{r[0]}</td>
                      <td className="px-4 py-2.5 text-muted">{r[1]}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{r[2]}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`badge ${r[3] === 'PAID' ? 'badge-success' : r[3] === 'SENT' ? 'badge-info' : 'badge-warning'}`}>
                          {r[3].replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-line bg-canvas/60 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything you need to bill clients</h2>
            <p className="mt-3 text-muted">Built for accuracy first: the server owns the math, you own the business.</p>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 90}>
                <div className="card group h-full p-6 transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand transition-transform duration-300 group-hover:scale-110 group-hover:bg-brand/15">
                    <f.icon size={20} />
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="h2" className="text-3xl font-bold tracking-tight sm:text-4xl">Up and running in minutes</Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <div className="card h-full p-6">
                  <p className="text-sm font-bold text-brand">{s.n}</p>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted">{s.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-line bg-canvas/60 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple pricing</h2>
            <p className="mt-3 text-muted">Start free. Upgrade when your volume grows.</p>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                name: 'Starter',
                price: 'Free',
                points: ['Unlimited customers', 'Quotations & invoices', 'Payments & receipts', 'PDF & WhatsApp sharing'],
                cta: 'Start free',
              },
              {
                name: 'Business',
                price: '$12/mo',
                highlight: true,
                points: ['Everything in Starter', 'Multiple businesses', 'Team members & roles', 'Reports & audit log'],
                cta: 'Start free trial',
              },
              {
                name: 'Enterprise',
                price: 'Custom',
                points: ['Everything in Business', 'Custom integrations', 'Priority support', 'SLA & onboarding'],
                cta: 'Talk to us',
              },
            ].map((p, i) => (
              <Reveal key={p.name} delay={i * 100}>
              <div className={`h-full rounded-2xl border p-6 shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-soft ${p.highlight ? 'border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white ring-1 ring-brand-200' : 'border-line bg-white'}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.highlight && <span className="badge badge-info">Popular</span>}
                </div>
                <p className="mt-3 text-3xl font-bold">{p.price}</p>
                <ul className="mt-4 space-y-2 text-sm text-muted">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-success" /> {pt}
                    </li>
                  ))}
                </ul>
                <Link to="/register" className={`btn mt-6 w-full ${p.highlight ? 'btn-primary' : 'btn-secondary'}`}>
                  {p.cta}
                </Link>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="relative overflow-hidden rounded-2xl bg-brand px-6 py-12 text-center text-white shadow-soft sm:px-12">
            <img src={heroBg} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-brand/55" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-brand-900/60 via-brand/25 to-sky-500/20" />
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight">Ready to send your next invoice?</h2>
              <p className="mx-auto mt-3 max-w-xl text-brand-100">
                Create your account, set up your first business, and send a professional quotation today.
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <Link to="/register" className="btn btn-secondary">
                  Create free account
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted sm:flex-row sm:px-6">
          <p className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-brand text-[10px] font-bold text-white">
              TG
            </span>
            TG Invoice by tgeasy · © {new Date().getFullYear()}
          </p>
          <div className="flex gap-5">
            <Link to="/login" className="hover:text-ink">Sign in</Link>
            <Link to="/register" className="hover:text-ink">Get started</Link>
            <span className="flex items-center gap-1.5"><Users size={14} /> Multi-tenant ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
