// Getting photos and videos ready to upload, in the browser.
//
// Photos are resized to at most 1600px and saved as WebP (JPEG where the browser can't make WebP),
// like the classic editor does. Re-drawing them also strips hidden details such as the location a
// photo was taken. Videos are uploaded as they are, up to Cloudflare's size limit.
import { slugify } from './product-file.ts';

export const MAX_PHOTO_SIZE = 1600;
/** Cloudflare Pages refuses files over 25 MiB, which would stop the whole site updating. */
export const MAX_VIDEO_BYTES = 24_000_000;
const VIDEO_TYPES = ['mp4', 'webm', 'mov', 'm4v'];

const suffix = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 5);

/** "IMG_2041 (1).HEIC" → "img-2041-1-3fa9c". */
export function fileBase(name: string, fallback: string) {
  return `${slugify(name.replace(/\.[^.]+$/, '')).slice(0, 40).replace(/-+$/, '') || fallback}-${suffix()}`;
}

export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Some browsers can show formats createImageBitmap can't open.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(
        /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test((file as File).name ?? '')
          ? "This browser can't open iPhone HEIC photos. Upload from Safari on the iPhone, or set Settings → Camera → Formats → Most Compatible."
          : "That file couldn't be opened as a photo.",
      );
    }
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export interface PreparedPhoto {
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const image = await decode(file);
  try {
    const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error("This browser can't resize photos.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, 0, 0, width, height);

    let blob = await toBlob(canvas, 'image/webp', 0.8);
    let extension = 'webp';
    if (!blob || blob.type !== 'image/webp') {
      // Safari can't make WebP: use JPEG (on white, as JPEG has no transparency).
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      blob = await toBlob(canvas, 'image/jpeg', 0.85);
      extension = 'jpg';
    }
    if (!blob) throw new Error("That photo couldn't be saved.");
    return { name: `${fileBase(file.name, 'photo')}.${extension}`, blob, width, height };
  } finally {
    image.close();
  }
}

export interface PreparedVideo {
  name: string;
  blob: Blob;
  /** Something worth knowing, e.g. that iPhone .mov files may not play on Android. */
  warning?: string;
}

export function prepareVideo(file: File): PreparedVideo {
  const extension = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase();
  if (!file.type.startsWith('video/') && !VIDEO_TYPES.includes(extension)) {
    throw new Error('Choose a video file (MP4 works everywhere).');
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `That video is ${megabytes(file.size)}. Videos can be up to 24 MB: export it at 720p (CapCut or TikTok "Save video") and try again.`,
    );
  }
  const type = VIDEO_TYPES.includes(extension) ? extension : 'mp4';
  const warning =
    type === 'mov'
      ? "iPhone .mov videos don't play on some Android phones. If you can, export it as MP4 (CapCut → Export)."
      : undefined;
  return { name: `${fileBase(file.name, 'video')}.${type}`, blob: file, warning };
}

/** A still from a video, for its preview tile. */
export async function videoPoster(url: string): Promise<string | undefined> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('video')), { once: true });
      setTimeout(() => reject(new Error('timeout')), 8000);
    });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    await new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }));
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}
