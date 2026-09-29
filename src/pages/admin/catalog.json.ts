// /admin/catalog.json: a copy of the files the site was built from, for the admin Studio. With it the
// Studio can list products and show their (already resized) photos straight away instead of
// downloading every file from GitHub. Each file comes with its git id, so the Studio can tell which
// ones have changed since and fetch only those.
//
// Only published products are included: drafts must never appear on the public site, so the Studio
// fetches them from GitHub after signing in.
import type { APIRoute } from 'astro';
import { root as rootUrl } from 'astro:config/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfo, gitBlobSha } from '../../lib/build-info';
import { getAllProducts } from '../../lib/catalog';
import { productPhoto } from '../../lib/images';
import { productVideo } from '../../lib/videos';

interface CatalogFile {
  sha: string;
  /** Web address of the resized photo (or the video) on this site. */
  url: string;
  /** Small version of a photo, for thumbnails. */
  thumb?: string;
}

const DATA_FILES = ['src/data/settings.json', 'src/data/categories.json', 'src/data/content.json'];
const slash = (value: string) => value.replace(/\\/g, '/');

export const GET: APIRoute = async () => {
  // The project folder (product paths are relative to it), wherever the build was started from.
  const root = fileURLToPath(rootUrl);
  const products = await Promise.all(
    (await getAllProducts()).map(async (product) => {
      const entryFile = path.resolve(root, product.filePath ?? '');
      const folder = path.dirname(entryFile);
      const text = readFileSync(entryFile);
      const files: Record<string, CatalogFile> = {};

      for (const image of product.data.images) {
        // Astro keeps the original file's location on each image (not enumerable, so not in the types).
        const source = (image as { fsPath?: string }).fsPath?.split('?')[0];
        if (!source) continue;
        const photo = await productPhoto(image);
        files[slash(path.relative(folder, source))] = { sha: gitBlobSha(readFileSync(source)), url: photo.src, thumb: photo.small };
      }

      const videoUrl = productVideo(product);
      const videoName = product.data.video?.replace(/^\.\//, '');
      if (videoUrl && videoName) {
        try {
          files[videoName] = { sha: gitBlobSha(readFileSync(path.join(folder, videoName))), url: videoUrl };
        } catch {
          // The video was listed but can't be read: the Studio falls back to GitHub.
        }
      }

      return {
        path: slash(path.relative(root, entryFile)),
        sha: gitBlobSha(text),
        text: text.toString('utf8'),
        files,
      };
    }),
  );

  const data = DATA_FILES.flatMap((file) => {
    try {
      const bytes = readFileSync(path.resolve(root, file));
      return [{ path: file, sha: gitBlobSha(bytes), text: bytes.toString('utf8') }];
    } catch {
      return [];
    }
  });

  return new Response(JSON.stringify({ ...buildInfo(root), products, data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
