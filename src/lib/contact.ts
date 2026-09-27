import { copy } from './copy';
import { settings } from './site';

export interface ContactLink {
  key: 'instagram' | 'whatsapp' | 'snapchat' | 'tiktok' | 'email';
  label: string;
  href: string;
  /** Opens another site/app (so the link should open in a new tab). */
  external: boolean;
}

/** "@name", "name" or "https://instagram.com/name/" → "name". */
const handle = (value: string) =>
  (value.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '').replace(/^@/, '');

/** "+44 7700 900123", "07700 900123" (UK store) or "0044…" → "447700900123". */
function phoneDigits(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0') && settings.currency === 'GBP') digits = `44${digits.slice(1)}`;
  return digits;
}

/**
 * Links for contacting the seller, built from Settings → "How people can contact you".
 * Pass a product to pre-fill the message (WhatsApp and email) with its name and link.
 */
export function contactLinks(product?: { title: string; url: string }): ContactLink[] {
  const { instagram, whatsapp, snapchat, tiktok, email } = settings.contact;
  const message = product ? `Hi! Is this still available? ${product.title} ${product.url}` : '';
  const links: ContactLink[] = [];

  if (instagram) {
    const name = handle(instagram);
    links.push({
      key: 'instagram',
      label: product ? copy('product.instagramButton') : 'Instagram',
      href: product ? `https://ig.me/m/${name}` : `https://www.instagram.com/${name}/`,
      external: true,
    });
  }
  if (whatsapp && phoneDigits(whatsapp)) {
    links.push({
      key: 'whatsapp',
      label: product ? 'Message on WhatsApp' : 'WhatsApp',
      href: `https://wa.me/${phoneDigits(whatsapp)}${message ? `?text=${encodeURIComponent(message)}` : ''}`,
      external: true,
    });
  }
  if (snapchat) {
    links.push({ key: 'snapchat', label: 'Snapchat', href: `https://www.snapchat.com/add/${handle(snapchat)}`, external: true });
  }
  if (tiktok) {
    links.push({ key: 'tiktok', label: 'TikTok', href: `https://www.tiktok.com/@${handle(tiktok)}`, external: true });
  }
  if (email) {
    const query = product
      ? `?subject=${encodeURIComponent(product.title)}&body=${encodeURIComponent(message)}`
      : '';
    links.push({ key: 'email', label: product ? 'Email me' : 'Email', href: `mailto:${email}${query}`, external: false });
  }
  return links;
}

/**
 * The quickest way to message the seller about anything (for "DM to cop" buttons): an Instagram
 * DM if there is one, otherwise the first other contact method.
 */
export function primaryContact(): ContactLink | undefined {
  const { instagram } = settings.contact;
  if (instagram) {
    return { key: 'instagram', label: copy('common.dmButton'), href: `https://ig.me/m/${handle(instagram)}`, external: true };
  }
  return contactLinks()[0];
}

/** "@centralsupply.uk" style label for the Instagram account, if there is one. */
export const instagramHandle = () => (settings.contact.instagram ? `@${handle(settings.contact.instagram)}` : undefined);
