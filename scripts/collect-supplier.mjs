// Builds a local review batch; never edits stock, commits, or publishes.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { download, sourceUrl } from './import-web.mjs';
import { catalogueLinks, supplierOf, supplierProduct, isProduct, CATEGORY_MAP } from './supplier-parsers.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function reviewPage(products, categories, currency) {
  const payload = JSON.stringify(products).replace(/</g, '\\u003c');
  const cards = products.map((product, index) => `<article data-row="${index}"><header><label><input type="checkbox" data-include checked> Include this listing</label><a href="${escapeHtml(product.source)}" target="_blank" rel="noopener noreferrer">View supplier ↗</a></header><label>Listing title<input data-title value="${escapeHtml(product.title)}" required></label><div class="fields"><label>Category<select data-category>${categories.map(({slug,name})=>`<option value="${escapeHtml(slug)}"${product.category===slug?' selected':''}>${escapeHtml(name)}</option>`).join('')}</select></label><label>Your price (${escapeHtml(currency)})<input data-price type="number" min="0" step="0.01" placeholder="Ask for price"></label></div><div class="photos">${product.images.map((src,i)=>`<label><img src="${escapeHtml(product.review.previewImages?.[i] || src)}" alt="Supplier photo ${i+1}" loading="lazy" referrerpolicy="no-referrer"><span><input type="checkbox" data-photo="${i}" checked> Photo ${i+1}</span></label>`).join('')}</div><details><summary>Review notes · ${product.review.availablePhotos} source photos</summary><ul>${product.review.notes.map(note=>`<li>${escapeHtml(note)}</li>`).join('')}</ul>${product.review.variants.map(variant=>`<p>${escapeHtml(variant.name)}: ${escapeHtml(variant.values.join(', '))}</p>`).join('')}</details></article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review supplier batch</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f7f7f2;color:#242620;font:16px/1.5 system-ui}main{max-width:1000px;margin:auto;padding:24px}h1{font-size:2.4rem;letter-spacing:-.05em}p{color:#66695e}article{background:white;border:1px solid #ddded4;padding:24px;border-radius:12px;margin:24px 0}header,.fields{display:flex;gap:20px;flex-wrap:wrap;justify-content:space-between}header{margin-bottom:18px}label{display:block;flex:1}input:not([type=checkbox]),select{display:block;width:100%;min-height:44px;padding:10px;border:1px solid #ccd0c4;border-radius:6px;font:inherit;margin:8px 0 16px}input[type=checkbox]{width:20px;height:20px;vertical-align:middle}header label{padding:10px 0}a{color:inherit;min-height:44px;display:inline-flex;align-items:center}.photos{display:flex;gap:12px;overflow:auto}.photos label{flex:0 0 160px}.photos img{width:160px;height:180px;object-fit:contain;background:#ecece5}.photos span{display:block;padding:12px 0}summary{padding:14px 0;cursor:pointer}button{padding:14px 22px;min-height:48px;border:0;border-radius:6px;background:#2d382b;color:white;font:inherit;cursor:pointer}.bar{position:sticky;bottom:0;padding:16px;background:#f7f7f2;border-top:1px solid #ccd0c4}#result{display:block;margin:8px 0}small{color:#66695e}</style></head><body><main><h1>Review your next additions.</h1><p>${products.length} supplier listings prepared. Edit the titles and selling prices, check the photos and untick anything you do not want. Nothing here has been added to your store.</p><p>Changes on this page are temporary until you download them. A page may contain several variants; review the supplier link before offering an item.</p>${cards}<div class="bar"><button id="download" type="button">Download selected listings</button><span id="result" role="status"></span><small>Save as import/reviewed-products.json, then run: npm run import:web -- --file import/reviewed-products.json --keep-prices</small></div></main><script>
const products=${payload};
document.querySelector('#download').addEventListener('click',()=>{
 const selected=[];const status=document.querySelector('#result');
 for(const row of document.querySelectorAll('[data-row]')){
  if(!row.querySelector('[data-include]').checked)continue;
  const original=products[Number(row.dataset.row)];
  const title=row.querySelector('[data-title]').value.trim();
  const images=[...row.querySelectorAll('[data-photo]:checked')].map(input=>original.images[Number(input.dataset.photo)]);
  const input=row.querySelector('[data-price]');const price=input.value.trim();
  if(!title||!images.length||!input.checkValidity()){status.textContent='Each selected listing needs a title, at least one photo and a valid non-negative price (or leave it blank).';row.scrollIntoView();return;}
  selected.push({source:original.source,title,category:row.querySelector('[data-category]').value,images,status:'available',...(price?{price:Number(price),currency:${JSON.stringify(currency)}}:{})});
 }
 if(!selected.length){status.textContent='Select at least one listing.';return;}
 const blob=new Blob([JSON.stringify(selected,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='reviewed-products.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=selected.length+' listings downloaded. Your live store has not changed.';
});</script></body></html>`;
}

export async function prepareBatch({ source, directory, limit = 20, maxPages = 5, photos = 4, category, categories, currency = 'GBP', delay = 700 }, { fetchPage = download, fetchImage = download, makePreviews = true, resume = false } = {}) {
  source = sourceUrl(source);
  supplierOf(source);
  for (const [name,value,max] of [['limit',limit,10000],['pages',maxPages,1000],['photos',photos,10]]) if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be between 1 and ${max}.`);
  if (category && !categories.some(item=>item.slug===category)) throw new Error('Choose a category already in your store.');
  await mkdir(directory, { recursive: true });
  const stateFile = path.join(directory, 'progress.json');
  let state = { source, photos, category, queue: [{ url: source, category }], visited: [], products: [], skipped: [], errors: [] };
  if (resume) {
    state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (state.source !== source || state.photos !== photos || state.category !== category) throw new Error('Resume with the original source, photo count and category.');
    // Retry failed pages on a resumed run; processed pages are not fetched again.
    state.queue.push(...state.errors.map(({url,category})=>({url,category})));
    state.errors = [];
  } else if (existsSync(stateFile)) throw new Error('Batch already exists. Use --resume to continue it.');
  let pageCount = 0;
  let consecutiveFailures = 0;
  const seen = new Set(state.visited);
  const products = new Set(state.products.map(product=>product.source));
  const persist = async (includePreview = false) => {
    await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
    await rename(`${stateFile}.tmp`, stateFile);
    if (includePreview) {
      await writeFile(path.join(directory, 'products.json'), JSON.stringify(state.products, null, 2));
      await writeFile(path.join(directory, 'review.html'), reviewPage(state.products, categories, currency));
    }
  };
  await persist();
  while (state.queue.length && state.products.length < limit) {
    const job = state.queue[0];
    if (seen.has(job.url)) { state.queue.shift(); continue; }
    const isDetail = isProduct(job.url);
    if (!isDetail && pageCount >= maxPages) break;
    try {
      if (new URL(job.url).origin !== new URL(source).origin) throw new Error('Out-of-scope supplier link.');
      const html = (await fetchPage(job.url)).toString('utf8');
      if (isDetail) {
        const product = supplierProduct(html, job.url, { photos, category: category || job.category });
        if (!categories.some(item=>item.slug===product.category)) throw new Error(`Add the category "${product.category}" in your store first.`);
        if (makePreviews && !products.has(product.source)) {
          const key = createHash('sha256').update(product.source).digest('hex').slice(0,20);
          await mkdir(path.join(directory,'photos'),{recursive:true});
          product.review.previewImages = [];
          for (const [index,image] of product.images.entries()) {
            const relative = `photos/${key}-${index}.webp`;
            const bytes = await fetchImage(image,true,{referer:product.source});
            await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:400,height:400,fit:'inside',withoutEnlargement:true}).webp({quality:65}).toFile(path.join(directory,relative));
            product.review.previewImages.push(relative);
          }
        }
        if (!products.has(product.source)) { state.products.push(product); products.add(product.source); }
        console.log(`[prepared ${state.products.length}] ${product.title}`);
      } else {
        pageCount++;
        const links = catalogueLinks(html, job.url);
        state.skipped.push(...links.skipped);
        if (!links.products.length && !links.categories.length) throw new Error('No catalogue items found. The page may be protected or its layout may have changed.');
        const inferred = CATEGORY_MAP[new URL(job.url).pathname.match(/^\/product-category\/([^/]+)/)?.[1]];
        state.queue.splice(1,0,...links.products.map(item=>({...item,category:category || job.category || inferred || item.category})));
        if (links.next) state.queue.push({ url: links.next, category: job.category || inferred });
        if (new URL(job.url).pathname === '/' && supplierOf(source) === 'luxury') state.queue.push(...links.categories);
      }
      seen.add(job.url);
      state.visited.push(job.url);
      consecutiveFailures = 0;
    } catch (error) {
      state.errors.push({ url: job.url, category: job.category, error: error.message });
      consecutiveFailures++;
      console.warn(`[failed] ${job.url}: ${error.message}`);
    }
    state.queue.shift();
    await persist();
    if (consecutiveFailures >= 3) { console.warn('Stopped after three consecutive failures. Check the source before resuming.'); break; }
    if (state.queue.length && state.products.length < limit && delay) await pause(delay);
  }
  await persist(true);
  return { prepared: state.products.length, pending: state.queue.length, failed: state.errors.length, skipped: state.skipped.length, directory };
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if (['--help','--interactive','--resume'].includes(key)) options[key.slice(2)]=true;
    else if (['--source','--out','--limit','--pages','--photos','--category'].includes(key) && args[i+1] && !args[i+1].startsWith('--')) options[key.slice(2)]=args[++i];
    else throw new Error(`Unknown option or missing value: ${key}`);
  }
  if (options.interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('Prepare a supplier batch for review. Your store will not be changed.');
      options.source = (await rl.question('Paste a Husky album/category or Luxury Brand category/product URL: ')).trim();
      options.limit = (await rl.question('Number of listings to prepare [20]: ')).trim() || '20';
      options.photos = (await rl.question('Photos per listing, 1–10 [4]: ')).trim() || '4';
    } finally { rl.close(); }
  }
  if (options.help || !options.source) {
    console.log('npm run import:catalog -- --source https://huskyreps.x.yupoo.com --limit 20\nOptions: --photos 4 --pages 5 --category clothing --out import/my-batch --resume\nCreates progress.json, products.json and review.html. No product files are changed.');
    return;
  }
  const source = sourceUrl(options.source);
  const label = supplierOf(source);
  const directory = path.resolve(options.out || path.join(ROOT,'import',`${label}-batch-${new Date().toISOString().replace(/[:.]/g,'-')}`));
  const importRoot = path.join(ROOT,'import') + path.sep;
  if (!directory.startsWith(importRoot)) throw new Error('Batch output must be a folder inside import/.');
  const { categories } = JSON.parse(await readFile(path.join(ROOT,'src/data/categories.json'),'utf8'));
  const { currency = 'GBP' } = JSON.parse(await readFile(path.join(ROOT,'src/data/settings.json'),'utf8'));
  const report = await prepareBatch({source,directory,categories,currency,category:options.category,limit:Number(options.limit || 20),photos:Number(options.photos || 4),maxPages:Number(options.pages || 5)}, {resume:options.resume});
  console.log(JSON.stringify(report,null,2));
  console.log(`Open ${path.join(directory,'review.html')} to check the listings. No stock has been added or published.`);
  if (report.failed) process.exitCode=1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
