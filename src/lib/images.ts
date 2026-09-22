import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

// Every product photo is resized to these widths (as WebP). Cards, galleries and
// category tiles all ask for the same sizes, so each size is only made once and
// cached between builds. Each extra size makes builds slower and the published
// site bigger (GitHub Pages allows 1 GB), so think twice before adding one.
const WIDTHS = [400, 800, 1200];

export interface ProductPhoto {
  /** 800px version, used as the <img src>. */
  src: string;
  /** Every size, for <img srcset>. */
  srcset: string;
  width: number;
  height: number;
  /** Smallest size, for thumbnails. */
  small: string;
  /** Largest size, for the full-screen viewer. */
  large: string;
}

export async function productPhoto(image: ImageMetadata): Promise<ProductPhoto> {
  const max = Math.min(image.width, WIDTHS[WIDTHS.length - 1]);
  const widths = [...WIDTHS.filter((width) => width < max), max];
  const result = await getImage({ src: image, widths, width: Math.min(800, max) });
  const sizes = result.srcSet.values
    .map((value) => ({ url: value.url, width: Number.parseInt(value.descriptor ?? '', 10) || 0 }))
    .sort((a, b) => a.width - b.width);

  return {
    src: result.src,
    srcset: result.srcSet.attribute,
    width: Number(result.attributes.width),
    height: Number(result.attributes.height),
    small: sizes[0]?.url ?? result.src,
    large: sizes[sizes.length - 1]?.url ?? result.src,
  };
}

/** A JPEG for link previews (WhatsApp, iMessage, Instagram…), since not all of them show WebP. */
export async function sharePreview(image: ImageMetadata): Promise<string> {
  const result = await getImage({ src: image, width: Math.min(800, image.width), format: 'jpeg', quality: 75 });
  return result.src;
}
