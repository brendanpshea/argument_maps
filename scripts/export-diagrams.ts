/**
 * Renders every ```argmap diagram in decks/*.md to PNG (and SVG) under
 * dist/diagrams/<deck>/<n>.png, for pasting into other slides, handouts, or an LMS.
 * Fails if any diagram has errors, so a broken diagram never deploys.
 *
 *   npx tsx scripts/export-diagrams.ts [outDir]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { buildDeck } from '../src/diagram/deck';
import { renderDiagramSvg } from '../src/diagram/svg';
import { compileLesson } from '../src/lesson/compile';
import type { Lesson } from '../src/model/types';

const root = join(import.meta.dirname, '..');
const outDir = process.argv[2] ?? join(root, 'dist', 'diagrams');

const lessons = new Map<string, Lesson>();
for (const file of readdirSync(join(root, 'lessons')).filter((f) => /\.ya?ml$/.test(f))) {
  const lesson = compileLesson(readFileSync(join(root, 'lessons', file), 'utf8'), file);
  lessons.set(lesson.id, lesson);
}

let failures = 0;
let count = 0;
for (const file of readdirSync(join(root, 'decks')).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
  const id = file.replace(/\.md$/, '');
  const deck = buildDeck(id, readFileSync(join(root, 'decks', file), 'utf8'), (l) => lessons.get(l));
  const dir = join(outDir, id);
  mkdirSync(dir, { recursive: true });
  for (const d of deck.diagrams) {
    if (!d.svg) {
      failures++;
      console.error(`${file}, diagram ${d.index}:\n  ${d.errors.join('\n  ')}`);
      continue;
    }
    // Fragments are for live reveals; the exported image shows the finished diagram.
    const svg = renderDiagramSvg(d.diagram!, { animate: false });
    const png = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: 2 },
      background: '#ffffff',
      font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    }).render();
    writeFileSync(join(dir, `${d.index}.png`), png.asPng());
    writeFileSync(join(dir, `${d.index}.svg`), svg);
    count++;
  }
}
console.log(`Exported ${count} diagram${count === 1 ? '' : 's'} to ${outDir}`);
if (failures) process.exit(1);
