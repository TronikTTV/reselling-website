// Tests for reading product folders ("Add from folders" in the Studio). Run with `npm run test:studio`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromFolderName, groupFolders, guessBrand, matchCategory, parseDetails, parsePrice } from '../src/studio/lib/folder-import.ts';

const CATEGORIES = [
  { slug: 'shoes', name: 'Trainers & Shoes' },
  { slug: 'clothing', name: 'Clothing' },
  { slug: 'hats', name: 'Hats & Caps' },
  { slug: 'watches', name: 'Watches' },
];

const entry = (path) => ({ path, file: new File(['x'], path.split('/').pop()) });

test('each folder with photos is one product, photos in name order with "cover" first', () => {
  const folders = groupFolders([
    entry('Stock/Trainers/Nike Dunk Low Panda/2.jpg'),
    entry('Stock/Trainers/Nike Dunk Low Panda/10.jpg'),
    entry('Stock/Trainers/Nike Dunk Low Panda/1.jpg'),
    entry('Stock/Trainers/Nike Dunk Low Panda/details.txt'),
    entry('Stock/Clothing/Corteiz Hoodie £90/b.webp'),
    entry('Stock/Clothing/Corteiz Hoodie £90/cover.PNG'),
    entry('Stock/Clothing/Corteiz Hoodie £90/Thumbs.db'),
    entry('Stock/notes-for-me.txt'),
    entry('Stock/__MACOSX/Clothing/._b.webp'),
    entry('Stock/Clothing/.DS_Store'),
  ]);
  assert.equal(folders.length, 2);
  const [hoodie, dunk] = folders;
  assert.equal(hoodie.name, 'Corteiz Hoodie £90');
  assert.equal(hoodie.parent, 'Clothing');
  assert.deepEqual(hoodie.photos.map((photo) => photo.path.split('/').pop()), ['cover.PNG', 'b.webp']);
  assert.equal(hoodie.text, undefined);
  assert.equal(dunk.parent, 'Trainers');
  assert.deepEqual(dunk.photos.map((photo) => photo.path.split('/').pop()), ['1.jpg', '2.jpg', '10.jpg']);
  assert.equal(dunk.text.path, 'Stock/Trainers/Nike Dunk Low Panda/details.txt');
});

test('a single chosen product folder works too (Windows paths as well)', () => {
  const folders = groupFolders([entry('Nike Dunk\\a.jpg'), entry('Nike Dunk\\info.txt')]);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, 'Nike Dunk');
  assert.ok(folders[0].text);
});

test('labelled text files, in any order, with an optional bio over several lines', () => {
  const details = parseDetails(`﻿Price: £120.00
Name:  Nike Dunk Low Retro   Panda
Colourway: White/Black
Style code: DD1391-100
Size: UK 9
Bio: Brand new in the box.
Bought on StockX, tags still on.

Ships next day.`);
  assert.deepEqual(details, {
    name: 'Nike Dunk Low Retro Panda',
    price: 120,
    colourway: 'White/Black',
    code: 'DD1391-100',
    bio: 'Brand new in the box.\nBought on StockX, tags still on.\n\nShips next day.',
    size: 'UK 9',
    brand: '',
    condition: '',
    category: '',
  });
  const noBio = parseDetails('Name: Corteiz Alcatraz Hoodie\r\nPrice: 90\r\nColor: Black\r\nSKU: CRTZ-01');
  assert.equal(noBio.bio, '');
  assert.equal(noBio.colourway, 'Black');
  assert.equal(noBio.code, 'CRTZ-01');
});

test('plain lines in order: name, price, colourway, code, then the bio', () => {
  assert.deepEqual(parseDetails('Jordan 4 Retro Military Black\n£180\nWhite/Black-Neutral Grey\nDH6927-111\nWorn once. Comes with the box.'), {
    name: 'Jordan 4 Retro Military Black',
    price: 180,
    colourway: 'White/Black-Neutral Grey',
    code: 'DH6927-111',
    bio: 'Worn once. Comes with the box.',
    size: '',
    brand: '',
    condition: '',
    category: '',
  });
  // Missing lines don't shift everything along.
  const partial = parseDetails('Stone Island Crewneck\n95\nGreat condition, barely worn.');
  assert.equal(partial.price, 95);
  assert.equal(partial.colourway, '');
  assert.equal(partial.code, '');
  assert.equal(partial.bio, 'Great condition, barely worn.');
  assert.equal(parseDetails('New Balance 550\nIE0421').code, 'IE0421');
});

test('prices, folder names, categories and brands', () => {
  assert.equal(parsePrice('£1,250'), 1250);
  assert.equal(parsePrice('89.99 GBP'), 89.99);
  assert.equal(parsePrice('ask'), null);
  assert.deepEqual(fromFolderName('Nike Dunk Low Panda £120'), { name: 'Nike Dunk Low Panda', price: 120 });
  assert.deepEqual(fromFolderName('Supreme_Box_Logo_Tee'), { name: 'Supreme Box Logo Tee', price: null });
  assert.equal(matchCategory('Trainers', CATEGORIES), 'shoes');
  assert.equal(matchCategory('hoodies', CATEGORIES), 'clothing');
  assert.equal(matchCategory('Caps', CATEGORIES), 'hats');
  assert.equal(matchCategory('Trainers & Shoes', CATEGORIES), 'shoes');
  assert.equal(matchCategory('Spaceships', CATEGORIES), '');
  assert.equal(guessBrand('Nike Dunk Low Panda'), 'Nike');
  assert.equal(guessBrand('Air Jordan 1 High'), 'Jordan');
  assert.equal(guessBrand('Nike SB Dunk'), 'Nike');
  assert.equal(guessBrand('New Balance 550'), 'New Balance');
  assert.equal(guessBrand('Nikon camera'), '');
});
