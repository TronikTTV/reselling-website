import { settings } from './site';

// Which number format each currency uses (e.g. £1,200 vs 1.200 €).
const LOCALES: Record<string, string> = {
  GBP: 'en-GB',
  EUR: 'en-IE',
  USD: 'en-US',
  CAD: 'en-CA',
  AUD: 'en-AU',
  NZD: 'en-NZ',
};

/** "£120", "£89.99", or undefined when there's no price. */
export function formatPrice(amount: number | undefined): string | undefined {
  if (amount === undefined) return undefined;
  const currency = settings.currency;
  try {
    return new Intl.NumberFormat(LOCALES[currency] ?? 'en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export type Status = 'available' | 'reserved' | 'sold';

export const STATUS_LABELS: Record<Status, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
};

export const pluralise = (count: number, word: string, plural = `${word}s`) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? word : plural}`;
