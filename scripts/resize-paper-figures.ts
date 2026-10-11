/**
 * Shrink the paper figures that are actually too big, in place.
 *
 * public/paper-figures/ is a local staging directory now, not a committed or
 * served location -- figures live in the `paper-figures` Storage bucket
 * (supabase/migrations/20260925130000_paper_figures_bucket.sql). Resize here,
 * then npm run generate-figure-dimensions, then upload, then delete the local
 * copies -- same order the 2026-09-25 Maths batch used.
 *
 * RUN THIS LOCALLY, NEVER IN THE BUILD. It is deliberately not wired into
 * prebuild or postbuild. sharp is a native dependency, and a native dependency
 * that fails to install on Vercel produces a failed deploy that nobody here can
 * diagnose, because the live build logs are not readable from this team. The
 * figures are committed assets, so resizing them once and committing the result
 * gets the same bytes to the reader with none of that risk. Re-run it after
 * importing a new batch of papers.
 *
 *   npm install -D sharp --no-save                   # not a project dependency
 *   npx tsx scripts/resize-paper-figures.ts          # report only
 *   npx tsx scripts/resize-paper-figures.ts --write  # rewrite the files
 *
 * SHARP IS DELIBERATELY NOT IN package.json. Vercel runs `npm install`
 * including devDependencies -- vite and typescript are devDependencies here,
 * so it has to -- which means a `devDependencies: { sharp }` entry would put a
 * native build into the deploy path of a site whose build logs nobody on this
 * team can read. The script is worth keeping; the dependency is not. Install it
 * when you need it, run this, and let it go.
 *
 * WHY IT ONLY TOUCHES A FEW FILES. The headline number was "25 MB across 1,023
 * figures", which sounds like a library-wide problem and is not one. A reader
 * opens ONE paper, and the median paper carries 58 kB of figures. The real
 * finding is the distribution: one paper ships 4.3 MB on its own, a fifth of
 * the whole directory, because 21 of its figures are 250-312 kB scans.
 *
 * So this processes only files above THRESHOLD_KB. Measured across the whole
 * directory: touching 87 files captures 20% of the total bytes, while touching
 * all 1,023 captures 25%. The extra 5% costs a lossy re-encode of 936 images
 * that are already small and already fine, and every lossy re-encode throws
 * away a little more of a diagram a student is trying to read. Not worth it.
 *
 * WHY 600px TALL. The reader renders figures at `max-h-[300px]`, so 600 is two
 * device pixels per CSS pixel -- sharp on a retina phone, and nothing beyond
 * that reaches the eye. Width needs no cap: the extraction pipeline already
 * caps it at 900px.
 *
 * WHY NOT LOSSLESS. Tried it. These are photographic scans of exam papers, not
 * line art, and lossless WebP made the largest file BIGGER (312 kB -> 345 kB).
 *
 * AFTER RUNNING THIS, REGENERATE THE DIMENSIONS:
 *   npm run generate-figure-dimensions
 * src/content/figure-dimensions.ts stores each figure's intrinsic size so the
 * reader can reserve correctly shaped space before the bytes arrive. Resizing
 * without regenerating leaves those numbers describing images that no longer
 * exist, and the layout shift they were written to prevent comes straight back.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

const DIR = 'public/paper-figures';
const MAX_HEIGHT = 600;
const QUALITY = 82;
const THRESHOLD_KB = 40;
const CONCURRENCY = 8;

const write = process.argv.includes('--write');

const kb = (bytes: number) => (bytes / 1024).toFixed(0);
const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.webp'));

  let before = 0;
  let after = 0;
  let rewritten = 0;
  let skippedSmall = 0;
  /* A re-encode that comes out LARGER means the original was already better
     compressed than anything we would produce. Keep the original: the point is
     fewer bytes, and there is no prize for having run the tool. */
  let skippedNoGain = 0;
  const biggest: Array<{ file: string; from: number; to: number }> = [];

  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];
      const path = join(DIR, file);
      const original = readFileSync(path);
      before += original.length;

      if (original.length < THRESHOLD_KB * 1024) {
        after += original.length;
        skippedSmall++;
        continue;
      }

      const meta = await sharp(original).metadata();
      let pipeline = sharp(original);
      if ((meta.height ?? 0) > MAX_HEIGHT) {
        pipeline = pipeline.resize({ height: MAX_HEIGHT, withoutEnlargement: true });
      }
      const out = await pipeline.webp({ quality: QUALITY, effort: 6 }).toBuffer();

      if (out.length >= original.length) {
        after += original.length;
        skippedNoGain++;
        continue;
      }

      after += out.length;
      rewritten++;
      biggest.push({ file, from: original.length, to: out.length });
      if (write) writeFileSync(path, out);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  biggest.sort((a, b) => b.from - b.to - (a.from - a.to));

  console.log(`\n  ${write ? 'REWROTE' : 'Would rewrite'} ${rewritten} of ${files.length} figures`);
  console.log(`  left alone: ${skippedSmall} under ${THRESHOLD_KB} kB, ${skippedNoGain} already better compressed`);
  console.log(`  ${mb(before)} MB -> ${mb(after)} MB  (${(((before - after) / before) * 100).toFixed(0)}% smaller)\n`);
  for (const b of biggest.slice(0, 5)) {
    console.log(`    ${b.file.slice(0, 44).padEnd(46)} ${kb(b.from).padStart(4)} kB -> ${kb(b.to).padStart(4)} kB`);
  }
  if (!write) console.log('\n  Nothing was changed. Pass --write to apply.\n');
  else console.log('\n  Now run: npm run generate-figure-dimensions\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
