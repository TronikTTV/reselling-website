BULK IMPORT: add lots of products at once from photos on this PC
==================================================================

1. Make one folder here per category, then put your photos inside it:

     import\watches\Rolex Submariner £8500\1.jpg     <- a folder = one product with several photos
     import\watches\Rolex Submariner £8500\2.jpg
     import\hats\Black Fitted Cap £25.jpg            <- a single photo = one product

   - The category folder can be the category's name or web address ("Hats & Caps" or "hats").
     A folder that doesn't match an existing category becomes a new category.
   - Adding a price at the end of the name with a £/$/€ sign is optional.
   - Photos are used in name order (1.jpg, 2.jpg, 3.jpg...). The first one is the cover.

2. In the project folder, run:   npm run import
   (To preview without changing anything:   npm run import -- --dry-run)

3. Check the result with   npm run dev   and then push the changes to GitHub.
   Add brands, sizes and descriptions later on the admin page.

Photos are shrunk and converted automatically. The originals are moved to import\_done\
and never uploaded. Nothing in this folder is uploaded to GitHub.
