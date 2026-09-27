// Labels shared by the site and the admin Studio (this file has no imports, so both can use it).

export type Status = 'available' | 'reserved' | 'sold';

export const STATUS_LABELS: Record<Status, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
};

// Where an item was bought, chosen in the admin (the "Where it's from" field).
export const AUTHENTICITY_LABELS: Record<string, string> = {
  stockx: 'Bought on StockX',
  goat: 'Bought on GOAT',
  retailer: 'Bought from an official retailer',
  brand: 'Bought direct from the brand',
};

/** The sentence shown for a product's "Where it's from" value (unknown values are shown as typed). */
export const authenticityLabel = (value: string | undefined) =>
  value ? (AUTHENTICITY_LABELS[value.toLowerCase()] ?? value) : undefined;
