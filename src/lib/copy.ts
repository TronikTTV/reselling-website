// The site's wording, editable in the admin Studio (Site text) or on the page in its live editor.
// Stored in src/data/content.json as groups, e.g. { "home": { "shopButton": "Shop the drop" } }.
// Anything missing or blank falls back to the default in src/lib/copy-fields.ts.
import rawContent from '../data/content.json';
import { COPY_DEFAULTS, type CopyKey } from './copy-fields';

export { accentParts, type CopyKey } from './copy-fields';

const content = rawContent as Record<string, Record<string, unknown> | undefined>;

/** The text for a key, e.g. copy('home.shopButton') → "Shop the drop". */
export function copy(key: CopyKey): string {
  const [group, name] = key.split('.');
  const value = content?.[group]?.[name];
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || COPY_DEFAULTS[key];
}
