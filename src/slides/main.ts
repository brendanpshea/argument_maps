import Reveal from 'reveal.js';
import Markdown from 'reveal.js/plugin/markdown';
import Notes from 'reveal.js/plugin/notes';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/white.css';
import './slides.css';
import { buildDeck } from '../diagram/deck';
import { findLesson } from '../lesson/registry';

// Decks are Markdown files in decks/, bundled at build time like lessons.
// (decks/README.md is the authoring guide, not a deck.)
const sources = import.meta.glob(['../../decks/*.md', '!../../decks/README.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const decks = Object.entries(sources)
  .map(([path, src]) => {
    const id = path.split('/').pop()!.replace(/\.md$/, '');
    // Exported PNGs live next to this page (see scripts/export-diagrams.ts).
    return buildDeck(id, src, findLesson, (n) => `diagrams/${id}/${n}.png`);
  })
  .sort((a, b) => a.title.localeCompare(b.title));

const root = document.getElementById('root')!;
const deckId = new URLSearchParams(location.search).get('deck');
const deck = decks.find((d) => d.id === deckId);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

if (!deck) {
  // No deck chosen (or an unknown one): list the decks.
  document.body.classList.add('deck-index');
  root.innerHTML = `
    <main class="deck-list">
      <h1>Slide decks</h1>
      ${deckId ? `<p class="message">There is no deck called “${escapeHtml(deckId)}”.</p>` : ''}
      <ul>
        ${decks
          .map(
            (d) =>
              `<li><a href="?deck=${encodeURIComponent(d.id)}"><h2>${escapeHtml(d.title)}</h2><span>${d.diagrams.length} diagram${d.diagrams.length === 1 ? '' : 's'}</span></a></li>`,
          )
          .join('')}
      </ul>
      <p><a href="./">← Practice lessons</a></p>
      <p class="hint">Press <kbd>S</kbd> during a presentation for speaker notes, <kbd>F</kbd> for full screen, and <kbd>Esc</kbd> for an overview.
      To save as PDF, add <code>&amp;print-pdf</code> to the address and print.</p>
    </main>`;
} else {
  document.title = deck.title;
  // The whole deck goes through reveal.js's Markdown plugin: --- separates slides, Note: starts speaker notes.
  root.innerHTML = `
    <div class="reveal">
      <div class="slides">
        <section data-markdown data-separator="^---$" data-separator-notes="^Note:">
          <textarea data-template></textarea>
        </section>
      </div>
    </div>`;
  // Set the Markdown as text, not HTML: inside a textarea, innerHTML would decode the
  // entities in the rendered diagrams (&quot;, &lt;, &amp;) back into raw characters.
  root.querySelector('textarea')!.textContent = deck.markdown;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  void Reveal.initialize({ hash: true, slideNumber: 'c/t', plugins: [Markdown, Notes], width: 1280, height: 800, margin: 0.06,
    // No sliding between slides for people who ask their system for less motion.
    transition: reduceMotion ? 'none' : 'slide',
    backgroundTransition: reduceMotion ? 'none' : 'fade',
    // PDF handouts: one page per slide, showing every step.
    pdfSeparateFragments: false,
  }).then(() => {
    // reveal.js puts its arrows in an <aside>, a landmark nested inside the page; they're just controls.
    const controls = document.querySelector('.reveal .controls');
    controls?.setAttribute('role', 'none');
  });
}
