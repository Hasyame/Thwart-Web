/**
 * Rasterises the app mark into the PNG sizes a progressive web app needs.
 *
 * `icon.svg` stays the source; these are build products and are gitignored,
 * like the theme and the card data. Regenerating from the SVG means the
 * installed icon can never drift from the one on the page.
 *
 * Two sizes, and no more:
 *
 * - **512** is what a manifest needs, and what Android scales down from. It is
 *   declared `maskable` as well as `any`, which is safe here because the mark
 *   was drawn for an adaptive icon: its comment in the Android repository notes
 *   the letter sits inside the middle 66dp of 108, so a circular mask cannot
 *   bite into it.
 * - **180** is the apple-touch-icon. iOS will not read an SVG for this, and
 *   without a PNG it puts a screenshot of the page on the home screen instead,
 *   which is exactly what somebody installing this does not want.
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

const svg = readFileSync(join(PUBLIC, 'icon.svg'));

const SIZES = [
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

mkdirSync(PUBLIC, { recursive: true });

for (const { size, name } of SIZES) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC, name));
  console.log(`icons: wrote ${name} (${size}x${size})`);
}
