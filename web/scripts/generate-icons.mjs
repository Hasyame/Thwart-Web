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

/*
 * The link preview, 1200 by 630 as Open Graph and Twitter want it.
 *
 * The mark on the app's own dark ground with the name beside it, drawn as an
 * SVG and rasterised the same way as the icons. Unlike them it is **checked
 * in, not rebuilt**: the text renders in whatever font the machine has, and
 * a CI runner without Arial drew it in a serif nobody chose. So it is made
 * here on request — `node scripts/generate-icons.mjs --og` — looked at, and
 * committed; the build leaves it alone.
 */
if (!process.argv.includes('--og')) {
  process.exit(0);
}
const icon = svg.toString('utf8').replace(/<\?xml[^>]*>/, '');
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0D0B0C"/>
  <g transform="translate(120 185) scale(2.4)">${icon.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g>
  <text x="440" y="300" fill="#F4F1EF" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-weight="700" font-size="112">Thwart</text>
  <text x="444" y="372" fill="#C9C2BE" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-size="40">A Marvel Champions companion</text>
  <text x="444" y="430" fill="#8E8783" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-size="30">Cards · collection · decks · campaigns · statistics</text>
</svg>`;
await sharp(Buffer.from(preview))
  .png({ compressionLevel: 9 })
  .toFile(join(PUBLIC, 'og-image.png'));
console.log('icons: wrote og-image.png (1200x630)');
