// Shared by the build (to prepare each product card's search text) and by the
// browser (to match what people type), so both sides normalise text the same way.

/** Lower-case, strip accents and collapse punctuation: "Café Crème!" → "cafe creme". */
export function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9£$€.]+/g, ' ')
    .trim();
}
