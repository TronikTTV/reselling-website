import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalProduct, catalogueLinks, supplierProduct } from './supplier-parsers.mjs';
import { prepareBatch, reviewPage } from './collect-supplier.mjs';
import { normaliseProduct } from './import-web.mjs';

const husky = 'https://huskyreps.x.yupoo.com/';
const album = `${husky}albums/123?uid=1`;
const categories = [{name:'Clothing',slug:'clothing'},{name:'Fragrances',slug:'fragrances'}];
const albumHtml = `<h1><span class="showalbumheader__gallerytitle" data-name="Blue &amp; white jacket">title</span></h1>${Array.from({length:12},(_,i)=>`<img class="image__img" data-type="photo" data-src="https://photo.yupoo.com/test/${i}/big.jpg"><noscript><img src="https://photo.yupoo.com/duplicate.jpg"></noscript>`).join('')}<img src="https://photo.yupoo.com/qr.png">`;
const catalogue = `<a class="album__main" href="/albums/123?uid=1"><div class="album__title">￥120 JACKET</div><div class="album__photonumber">12</div></a><a class="album__main" href="/albums/456"><div class="album__title">Discord</div><div class="album__photonumber">1</div></a><a title="next page" href="/albums/?page&#x3D;2&amp;uid&#x3D;1">next</a>`;

test('Husky discovery decodes links, skips information albums and canonicalises identities',()=>{
  const result=catalogueLinks(catalogue,husky);
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].url,album);
  assert.equal(result.skipped.length,1);
  assert.equal(result.next,`${husky}albums/?page=2&uid=1`);
  assert.equal(canonicalProduct(`${husky}albums/123?uid=1#images`),album);
});

test('Husky selects a bounded photo set with review notes and no inferred price',()=>{
  const product=supplierProduct(albumHtml,album,{photos:4});
  assert.equal(product.title,'Blue & white jacket');
  assert.equal(product.images.length,4);
  assert.equal(product.review.availablePhotos,12);
  assert.equal(product.price,undefined);
  assert.throws(()=>supplierProduct(albumHtml,album,{photos:11}),/1–10/);
  assert.throws(()=>normaliseProduct(product,{categories:['clothing']}),/Review/);
});

test('Luxury product images are gallery-only; variants and category are retained for review',()=>{
  const html=`<h1 class="product_title">Perfume &amp; Cologne</h1><nav class="woocommerce-breadcrumb"><a href="/product-category/perfume-cologne/">Perfume</a></nav><div class="woocommerce-product-gallery"><img data-large_image="https://luxurybrand.top/main.jpg"></div><img src="https://luxurybrand.top/recommendation.jpg"><form class="variations_form"><select name="attribute_type"><option value="">Choose</option><option value="EDP">EDP</option><option value="EDT">EDT</option></select></form>`;
  const p=supplierProduct(html,'https://luxurybrand.top/product/example/');
  assert.equal(p.category,'fragrances');
  assert.equal(p.title,'Perfume & Cologne');
  assert.deepEqual(p.images,['https://luxurybrand.top/main.jpg']);
  assert.deepEqual(p.review.variants[0].values,['EDP','EDT']);
  assert.equal(p.price,undefined);
});

test('discovery stays on the supplier and follows category pagination without query duplicates',()=>{
  const html=`<aside><a href="/product/recommended/">Unrelated recommendation</a></aside><div class="product-grid-item"><a href="/product/example/?foo=1">One</a><a href="/product/example/">Duplicate</a><a href="https://another.example/product/other/">Other</a></div><a class="next page-numbers" href="/product-category/bag/page/2/">Next</a><a href="/product-category/bag/">Bag</a><a href="/product-category/peptide/">Other category</a>`;
  const result=catalogueLinks(html,'https://luxurybrand.top/product-category/bag/');
  assert.equal(result.products.length,1);
  assert.equal(result.next,'https://luxurybrand.top/product-category/bag/page/2/');
  assert.deepEqual(result.categories,[{url:'https://luxurybrand.top/product-category/bag/',category:'bags'}]);
});

test('review HTML treats supplier titles as text, not executable markup',()=>{
  const product=supplierProduct(albumHtml,album);
  product.title='</script><img src=x onerror=alert(1)>';
  const html=reviewPage([product],categories,'GBP');
  assert.ok(!html.includes(product.title));
  assert.match(html,/&lt;\/script&gt;/);
  assert.match(html,/\\u003c\/script>/);
});

test('limited collection resumes, deduplicates and retries failures without editing stock',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'supplier-batch-test-'));
  const calls=[];
  let failSecond=true;
  const fetchPage=async(url)=>{
    calls.push(url);
    if(url===husky)return Buffer.from(catalogue);
    if(url===album)return Buffer.from(albumHtml);
    if(url.includes('?page=2'))return Buffer.from('<a class="album__main" href="/albums/789"><div class="album__title">￥100 SHIRT</div><div class="album__photonumber">12</div></a>');
    if(url.includes('/789?uid=1')){if(failSecond)throw new Error('Temporary failure');return Buffer.from(albumHtml);}
    throw new Error('Unexpected URL');
  };
  try{
    const options={source:husky,directory,categories,limit:1,delay:0};
    assert.equal((await prepareBatch(options,{fetchPage,makePreviews:false})).prepared,1);
    assert.equal(calls.length,2);
    const second=await prepareBatch({...options,limit:2},{fetchPage,makePreviews:false,resume:true});
    assert.equal(second.failed,1);
    failSecond=false;
    const third=await prepareBatch({...options,limit:2},{fetchPage,makePreviews:false,resume:true});
    assert.equal(third.prepared,2);
    assert.equal(third.failed,0);
    assert.equal(calls.filter(url=>url===husky).length,1);
    assert.equal(JSON.parse(await readFile(path.join(directory,'products.json'),'utf8')).length,2);
    assert.match(await readFile(path.join(directory,'review.html'),'utf8'),/Download selected listings/);
  }finally{
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('supplier-batch-test-'));
    await rm(directory,{recursive:true,force:true});
  }
});
