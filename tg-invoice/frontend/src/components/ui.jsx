import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X, Loader2, Inbox, AlertCircle, CheckCircle2, Info, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { statusMeta } from '../utils/status.js';

/* ── Button ───────────────────────────────────────────────────────── */

const BTN_VARIANTS = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 hover:shadow-md hover:shadow-brand-600/25 focus-visible:ring-brand-500/30 border border-transparent',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400/60 focus-visible:ring-slate-400/20',
  ghost: 'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 focus-visible:ring-slate-400/20',
  danger: 'bg-rose-600 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-700 focus-visible:ring-rose-500/30 border border-transparent',
  subtle: 'bg-brand-50 text-brand-700 border border-brand-100 hover:bg-brand-100 focus-visible:ring-brand-500/20',
};

const BTN_SIZES = {
  sm: 'px-2.5 py-1.5 text-[13px] gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

export function Button({ variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 outline-none focus-visible:ring-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55',
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/* ── Badge ────────────────────────────────────────────────────────── */

export function Badge({ className, children }) {
  return (
    <span className={clsx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', className)}>
      {children}
    </span>
  );
}

/** Coloured status pill; kind picks the label/colour map ('invoice' default). */
export function StatusBadge({ status, kind = 'invoice' }) {
  const sm = statusMeta(status, kind);
  return <Badge className={sm.className}>{sm.label}</Badge>;
}

/* ── Form fields ──────────────────────────────────────────────────── */

export function Field({ label, error, hint, required, children, className }) {
  return (
    <div className={clsx('min-w-0', className)}>
      {label && (
        <label className="label">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export const input = (className) => clsx('input', className);

export function Select({ className, children, ...props }) {
  return (
    <select className={clsx('input appearance-none bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E\")", backgroundPosition: 'right 0.6rem center', backgroundSize: '1.1em' }} {...props}>
      {children}
    </select>
  );
}

/* ── Card ─────────────────────────────────────────────────────────── */

const CARD_TONES = {
  default: 'card',
  blue: 'card-blue',
  sky: 'card-sky',
  brand: 'card-blue',
  green: 'card-emerald',
  amber: 'card-amber',
  rose: 'card-rose',
};

export function Card({ tone = 'default', className, children, ...props }) {
  return (
    <div className={clsx(CARD_TONES[tone] || 'card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────── */

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-[2px] sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className={clsx('relative my-8 w-full animate-scale-in rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5', sizes[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="-m-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Confirmation dialog — the single source for destructive prompts. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', loading = false, danger = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
    </Modal>
  );
}

/* ── Spinner / loading ────────────────────────────────────────────── */

export function Spinner({ className }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-600', className)} />;
}

export function LoadingBlock({ label = 'Loading…', className }) {
  return (
    <div className={clsx('space-y-3 py-8', className)} role="status" aria-live="polite">
      <div className="shimmer h-5 w-1/3 rounded-full" />
      <div className="shimmer h-3.5 w-2/3 rounded-full" />
      <div className="shimmer h-3.5 w-1/2 rounded-full" />
      <div className="shimmer h-24 w-full rounded-xl" />
      <p className="pt-1 text-center text-[13px] text-slate-400">{label}</p>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────────── */

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
        <Icon className="size-6" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ── Table helpers ────────────────────────────────────────────────── */

export const th = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500';
export const td = 'px-4 py-3 text-sm text-slate-700 align-middle';
export const trHover = 'border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors';

/* ── Pagination ───────────────────────────────────────────────────── */

export function Pagination({ page, totalPages, total, onPage, label = 'results' }) {
  if (!total) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
      <p className="text-[13px] text-slate-500">
        {total.toLocaleString()} {label} · Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4" /> Prev
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────── */

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={clsx(
            'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors',
            active === t.value ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors">{t.count}</span>}
          {active === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 animate-pop rounded-full bg-brand-600" />}
        </button>
      ))}
    </div>
  );
}

/* ── Toasts ───────────────────────────────────────────────────────── */

const TOAST_STYLES = {
  success: { icon: CheckCircle2, cls: 'text-emerald-600' },
  error: { icon: AlertCircle, cls: 'text-rose-600' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600' },
  info: { icon: Info, cls: 'text-sky-600' },
};

export function Toaster({ toasts, onDismiss }) {
  return createPortal(
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
      {toasts.map((t) => {
        const meta = TOAST_STYLES[t.type] || TOAST_STYLES.info;
        const Icon = meta.icon;
        return (
          <div key={t.id} className="pointer-events-auto flex w-full animate-slide-in-right items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg shadow-slate-900/10">
            <Icon className={clsx('mt-0.5 size-5 shrink-0', meta.cls)} />
            <div className="min-w-0 flex-1">
              {t.title && <p className="text-[13px] font-semibold text-slate-900">{t.title}</p>}
              <p className="text-[13px] leading-snug text-slate-600">{t.message}</p>
            </div>
            <button type="button" onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

/* ── Scroll reveal ────────────────────────────────────────────────── */

/**
 * Fades + lifts its children into view the first time they enter the
 * viewport. Falls back to visible when IntersectionObserver is absent.
 */
export function Reveal({ children, className, delay = 0, as: Tag = 'div' }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      className={clsx(shown ? 'animate-fade-up' : 'opacity-0', className)}
    >
      {children}
    </Tag>
  );
}

/* ── Misc ─────────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'default' }) {
  const tones = {
    default: { card: 'card', icon: 'text-slate-600 bg-slate-100' },
    brand: { card: 'card-blue', icon: 'text-brand-700 bg-white ring-1 ring-brand-100' },
    sky: { card: 'card-sky', icon: 'text-sky-700 bg-white ring-1 ring-sky-100' },
    green: { card: 'card-emerald', icon: 'text-emerald-700 bg-white ring-1 ring-emerald-100' },
    amber: { card: 'card-amber', icon: 'text-amber-700 bg-white ring-1 ring-amber-100' },
    rose: { card: 'card-rose', icon: 'text-rose-700 bg-white ring-1 ring-rose-100' },
  };
  const t = tones[tone] || tones.default;
  return (
    <div className={clsx(t.card, 'p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-soft')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1.5 truncate text-xl font-semibold tracking-tight text-slate-900">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {Icon && (
          <div className={clsx('flex size-9 shrink-0 items-center justify-center rounded-xl', t.icon)}>
            <Icon className="size-5" />
          </div>
        )}
      </div>
    </div>
  );
}
