// Every piece of editable text on the site: its default wording, and how the admin Studio labels it.
//
// Keys look like "copy:home.shopButton" (stored in src/data/content.json) or "site:heroHeading"
// (stored in src/data/settings.json). The same keys are put on the page as data-edit="…" so the
// Studio's live editor knows what was clicked. This file has no imports, so the Studio can use it too.

/** Default wording for the texts in src/data/content.json. A blank or missing value uses these. */
export const COPY_DEFAULTS = {
  'common.dmButton': 'DM to cop',
  'common.askPrice': 'Ask for price',

  'home.shopButton': 'Shop the drop',
  'home.comingSoon': 'New pieces landing soon',
  'home.droppedEyebrow': 'Fresh in',
  'home.droppedTitle': 'Just *dropped*',
  'home.droppedLink': 'See all',
  'home.categoriesEyebrow': 'Find your thing',
  'home.categoriesTitle': 'Shop by *vibe*',
  'home.moreEyebrow': 'Keep scrolling',
  'home.moreTitle': 'More *heat*',
  'home.moreLink': 'Shop all',
  'home.allButton': 'See everything',
  'home.stepsEyebrow': 'How it works',
  'home.stepsTitle': 'Three taps to *cop.*',
  'home.step1Title': 'Find your piece',
  'home.step1Text': 'Browse the drops, or search by brand, style code or size.',
  'home.step2Title': 'Slide into the DMs',
  'home.step2Text': 'Tap DM to cop on any item. It opens a chat with the listing, so we know exactly what you want.',
  'home.step3Title': 'Lock it in',
  'home.step3Text': "We confirm it's yours and sort out the rest with you.",
  'reel.shopButton': 'Shop now',

  'nav.shopAll': 'Shop all',
  'nav.categories': 'Categories',
  'nav.howItWorks': 'How it works',
  'nav.all': 'All',
  'search.placeholder': 'Search brands, styles, sizes…',
  'search.jumpTo': 'Jump to',

  'product.ctaLabel': 'Want it? Slide into the DMs:',
  'product.reservedLabel': 'Reserved right now. DM to join the queue:',
  'product.instagramButton': 'DM to cop on Instagram',
  'product.soldNotice': 'This one has sold.',
  'product.relatedEyebrow': 'Keep scrolling',
  'product.relatedTitle': 'You might also *like*',

  'shop.title': 'Shop *everything*',
  'shop.description': 'Every piece, hand-picked. Search, filter and find your next favourite.',
  'shop.searchPlaceholder': 'Search brand, style code, size…',
  'shop.noMatches': 'No pieces match that. Try another search.',
  'shop.empty': 'Nothing here yet. Fresh pieces are on the way.',

  'footer.eyebrow': 'Seen something you like?',
  'footer.title': 'Slide into *the DMs.*',
  'footer.text': "Send us a message and it's as good as yours.",
  'footer.shopHeading': 'Shop',
  'footer.everything': 'Everything',
  'footer.contactHeading': 'Say hi',

  'notFound.title': 'Gone *missing.*',
  'notFound.text': "That page doesn't exist, or the piece has moved on. There's plenty more where it came from.",
  'notFound.shopButton': 'Shop everything',
  'notFound.homeButton': 'Back home',
} as const;

export type CopyKey = keyof typeof COPY_DEFAULTS;

/** Defaults for the texts kept in settings.json. */
export const SITE_TEXT_DEFAULTS = {
  siteName: 'My Store',
  heroHeading: 'Rare finds.',
  heroAccent: 'Real ones only.',
  tagline: '',
  announcement: '',
} as const;

export interface TextField {
  /** "copy:<key>" or "site:<key>". */
  key: string;
  label: string;
  hint?: string;
  /** Words wrapped in *stars* are shown in italics. */
  accent?: boolean;
  /** Longer text (a paragraph). */
  long?: boolean;
  /** A list of short phrases (the ticker). */
  list?: boolean;
}

export interface TextGroup {
  id: string;
  label: string;
  description: string;
  /** Page to show it on in the live editor ("product" and "category" mean the first one). */
  page: string;
  fields: TextField[];
}

const ACCENT_HINT = 'Wrap words in *stars* to make them italic. Without stars, the last word is italic.';

export const TEXT_GROUPS: TextGroup[] = [
  {
    id: 'home',
    label: 'Home page',
    description: 'The headline, section titles and "How it works" on the front page.',
    page: '/',
    fields: [
      { key: 'site:heroHeading', label: 'Headline', hint: 'The big heading under the ads.' },
      { key: 'site:heroAccent', label: 'Headline, second line', hint: 'Shown in italics with the gradient.' },
      { key: 'site:tagline', label: 'Tagline', long: true, hint: 'Under the headline, in the footer and in link previews.' },
      { key: 'site:ticker', label: 'Scrolling ticker', list: true, hint: 'Short phrases that scroll across the page.' },
      { key: 'copy:home.shopButton', label: 'Main button' },
      { key: 'copy:home.comingSoon', label: 'Label when nothing is in stock' },
      { key: 'copy:reel.shopButton', label: 'Ads: button' },
      { key: 'copy:home.droppedEyebrow', label: 'Newest pieces: small heading' },
      { key: 'copy:home.droppedTitle', label: 'Newest pieces: title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:home.droppedLink', label: 'Newest pieces: link' },
      { key: 'copy:home.categoriesEyebrow', label: 'Categories: small heading' },
      { key: 'copy:home.categoriesTitle', label: 'Categories: title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:home.moreEyebrow', label: 'More pieces: small heading' },
      { key: 'copy:home.moreTitle', label: 'More pieces: title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:home.moreLink', label: 'More pieces: link' },
      { key: 'copy:home.allButton', label: 'Button under the products' },
      { key: 'copy:home.stepsEyebrow', label: 'How it works: small heading' },
      { key: 'copy:home.stepsTitle', label: 'How it works: title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:home.step1Title', label: 'Step 1' },
      { key: 'copy:home.step1Text', label: 'Step 1 text', long: true },
      { key: 'copy:home.step2Title', label: 'Step 2' },
      { key: 'copy:home.step2Text', label: 'Step 2 text', long: true },
      { key: 'copy:home.step3Title', label: 'Step 3' },
      { key: 'copy:home.step3Text', label: 'Step 3 text', long: true },
    ],
  },
  {
    id: 'header',
    label: 'Header & menu',
    description: 'Store name, the announcement bar, menu links and the search box.',
    page: '/',
    fields: [
      { key: 'site:siteName', label: 'Store name', hint: 'In the header, footer, browser tab and link previews.' },
      { key: 'site:announcement', label: 'Announcement bar', hint: 'A message across the top of every page, e.g. "New drops every Friday". Leave empty to hide it.' },
      { key: 'copy:nav.shopAll', label: 'Menu: shop link' },
      { key: 'copy:nav.categories', label: 'Menu: categories link' },
      { key: 'copy:nav.howItWorks', label: 'Menu: how it works link' },
      { key: 'copy:nav.all', label: 'Category bar: first chip' },
      { key: 'copy:search.placeholder', label: 'Search box hint' },
      { key: 'copy:search.jumpTo', label: 'Search: categories heading' },
    ],
  },
  {
    id: 'buttons',
    label: 'Buttons',
    description: 'Wording used all over the site.',
    page: '/',
    fields: [
      { key: 'copy:common.dmButton', label: 'DM button', hint: 'In the header, on the home page, on the ads and on the bar that follows you down product pages.' },
      { key: 'copy:common.askPrice', label: 'When there is no price' },
    ],
  },
  {
    id: 'product',
    label: 'Product pages',
    description: 'Around the DM buttons and the "You might also like" row.',
    page: 'product',
    fields: [
      { key: 'copy:product.ctaLabel', label: 'Above the DM buttons' },
      { key: 'copy:product.reservedLabel', label: 'Above the DM buttons (reserved pieces)' },
      { key: 'copy:product.instagramButton', label: 'Instagram button' },
      { key: 'copy:product.soldNotice', label: 'On sold pieces' },
      { key: 'copy:product.relatedEyebrow', label: 'Related: small heading' },
      { key: 'copy:product.relatedTitle', label: 'Related: title', accent: true, hint: ACCENT_HINT },
    ],
  },
  {
    id: 'shop',
    label: 'Shop & categories',
    description: 'The Shop all page, search and category pages.',
    page: '/shop/',
    fields: [
      { key: 'copy:shop.title', label: 'Shop page title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:shop.description', label: 'Shop page intro', long: true },
      { key: 'copy:shop.searchPlaceholder', label: 'Search box hint' },
      { key: 'copy:shop.noMatches', label: 'When a search finds nothing' },
      { key: 'copy:shop.empty', label: 'When a category is empty' },
    ],
  },
  {
    id: 'footer',
    label: 'Footer',
    description: 'The big "Slide into the DMs" section and the links at the bottom of every page.',
    page: '/',
    fields: [
      { key: 'copy:footer.eyebrow', label: 'Small heading' },
      { key: 'copy:footer.title', label: 'Title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:footer.text', label: 'Text', long: true },
      { key: 'copy:footer.shopHeading', label: 'Shop column heading' },
      { key: 'copy:footer.everything', label: 'Shop column: first link' },
      { key: 'copy:footer.contactHeading', label: 'Contact column heading' },
    ],
  },
  {
    id: 'notFound',
    label: 'Page not found',
    description: 'Shown when a link is broken or a piece has been deleted.',
    page: '/404/',
    fields: [
      { key: 'copy:notFound.title', label: 'Title', accent: true, hint: ACCENT_HINT },
      { key: 'copy:notFound.text', label: 'Text', long: true },
      { key: 'copy:notFound.shopButton', label: 'Shop button' },
      { key: 'copy:notFound.homeButton', label: 'Home button' },
    ],
  },
];

export interface AccentPart {
  text: string;
  accent: boolean;
}

/**
 * Splits a title into plain and italic parts: "Shop by *vibe*" → "Shop by " + *vibe*.
 * Without any *stars*, the last word gets the accent, which is the site's house style.
 */
export function accentParts(value: string): AccentPart[] {
  const text = value.trim();
  if (!text) return [];
  if (/\*[^*]+\*/.test(text)) {
    return text
      .split(/(\*[^*]+\*)/)
      .filter(Boolean)
      .map((part) => (/^\*[^*]+\*$/.test(part) ? { text: part.slice(1, -1), accent: true } : { text: part.replace(/\*/g, ''), accent: false }))
      .filter((part) => part.text);
  }
  const lastSpace = text.lastIndexOf(' ');
  if (lastSpace < 0) return [{ text, accent: true }];
  return [
    { text: text.slice(0, lastSpace + 1), accent: false },
    { text: text.slice(lastSpace + 1), accent: true },
  ];
}
