/** Currency + money formatting driven by each tenant's own settings. */

export const CURRENCY_PRESETS = [
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
];

export function formatMoney(value, settings = {}) {
  const symbol = settings.currencySymbol || '₦';
  const position = settings.currencyPosition || 'prefix';
  const decimals = settings.currencyDecimals ?? 2;
  const n = Number(value) || 0;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return position === 'suffix' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
}

/** Compact form for stat cards: ₦1.2M */
export function formatCompact(value, settings = {}) {
  const symbol = settings.currencySymbol || '₦';
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}K`;
  return formatMoney(n, settings);
}

export const toNumber = (v) => Number(v) || 0;

/**
 * Amount in words — mirrors the backend/pdfService implementation so the
 * HTML preview and the generated PDF read identically.
 * e.g. 215000 → "Two hundred and fifteen thousand NGN only"
 */
export function amountInWords(value, settings = {}) {
  const n = Number(value) || 0;
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const words = intToWords(whole);
  const currency = settings.currency || 'NGN';
  const suffix = cents > 0 ? ` and ${cents}/100` : '';
  const capitalized = words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Zero';
  return `${capitalized} ${currency}${suffix} only`;
}

function intToWords(num) {
  if (num === 0) return 'zero';
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const chunk = (x) => {
    let s = '';
    if (x >= 100) {
      s += `${ones[Math.floor(x / 100)]} hundred`;
      x %= 100;
      if (x) s += ' and ';
    }
    if (x >= 20) {
      s += tens[Math.floor(x / 10)];
      if (x % 10) s += `-${ones[x % 10]}`;
    } else {
      s += ones[x];
    }
    return s;
  };
  const scales = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ];
  let rest = num;
  let out = '';
  for (const [value, name] of scales) {
    if (rest >= value) {
      const part = Math.floor(rest / value);
      out += `${chunk(part)} ${name}`;
      rest %= value;
      if (rest > 0) out += ' ';
    }
  }
  if (rest > 0) out += chunk(rest);
  return out.trim();
}
