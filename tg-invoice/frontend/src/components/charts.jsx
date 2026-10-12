import { useState } from 'react';

/* ------------------------------------------------------------------ */
/* Revenue / collections bar chart (pure SVG, no chart library)        */
/* ------------------------------------------------------------------ */
export function RevenueChart({ data = [], height = 220, currency = 'NGN' }) {
  const [hover, setHover] = useState(null);

  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted">
        No activity in this period.
      </div>
    );
  }

  const pad = { top: 16, right: 8, bottom: 28, left: 44 };
  const width = 720; // viewBox width, scales responsively
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => Math.max(d.issued, d.paid)), 1);
  const step = innerW / data.length;
  const barW = Math.max(6, Math.min(28, step * 0.34));
  const fmt = (v) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(v % 1_000 ? 1 : 0)}k`;
    return String(v);
  };
  const y = (v) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Issued vs collected by period">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeDasharray="3 4" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted" style={{ fontSize: 10 }}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.left + i * step + step / 2;
          return (
            <g
              key={d.label + i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={pad.left + i * step} y={pad.top} width={step} height={innerH} fill="transparent" />
              <rect
                x={cx - barW - 2}
                y={y(d.issued)}
                width={barW}
                height={Math.max(1, pad.top + innerH - y(d.issued))}
                rx={3}
                className={hover === i ? 'fill-brand' : 'fill-brand/70'}
              />
              <rect
                x={cx + 2}
                y={y(d.paid)}
                width={barW}
                height={Math.max(1, pad.top + innerH - y(d.paid))}
                rx={3}
                className="fill-success"
              />
              {data.length <= 16 && (
                <text x={cx} y={height - 8} textAnchor="middle" className="fill-muted" style={{ fontSize: 10 }}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Issued</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> Collected</span>
        {hover != null && data[hover] && (
          <span className="ml-auto text-ink">
            {data[hover].label}: issued {currency} {data[hover].issued.toLocaleString()} · collected {currency}{' '}
            {data[hover].paid.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status donut                                                        */
/* ------------------------------------------------------------------ */
const STATUS_COLORS = {
  PAID: '#16A34A',
  SENT: '#2563EB',
  DRAFT: '#64748B',
  OVERDUE: '#DC2626',
  PARTIALLY_PAID: '#D97706',
  UNPAID: '#0F172A',
  CANCELLED: '#94A3B8',
  VOID: '#94A3B8',
  ACCEPTED: '#16A34A',
  EXPIRED: '#DC2626',
  PENDING: '#D97706',
  COMPLETED: '#16A34A',
  REFUNDED: '#64748B',
};

export function StatusDonut({ data = [], total = 0, size = 180, centerLabel = 'Total' }) {
  const r = 60;
  const c = 2 * Math.PI * r;
  const sum = data.reduce((acc, d) => acc + d.value, 0) || 1;
  let offset = 0;

  if (!data.length) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-muted">No data yet.</div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg width={size} height={size} viewBox="0 0 160 160" role="img" aria-label={centerLabel}>
        <circle cx="80" cy="80" r={r} fill="none" className="stroke-line" strokeWidth="22" />
        {data.map((d) => {
          const frac = d.value / sum;
          const dash = frac * c;
          const el = (
            <circle
              key={d.label}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={STATUS_COLORS[d.label] || '#94A3B8'}
              strokeWidth="22"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += dash;
          return el;
        })}
        <text x="80" y="76" textAnchor="middle" style={{ fontSize: 20, fontWeight: 700 }} className="fill-ink">
          {(total || sum).toLocaleString()}
        </text>
        <text x="80" y="94" textAnchor="middle" style={{ fontSize: 10 }} className="fill-muted">
          {centerLabel}
        </text>
      </svg>
      <ul className="space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLORS[d.label] || '#94A3B8' }} />
            <span className="text-muted">{d.label.replace(/_/g, ' ').toLowerCase()}</span>
            <span className="ml-auto font-medium text-ink">{d.value.toLocaleString()}</span>
            <span className="w-10 text-right text-xs text-muted">{Math.round((d.value / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
