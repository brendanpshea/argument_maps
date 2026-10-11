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
  const SLIDE_HEIGHT = 800 * (1 - 0.06);
  /**
   * Lets a slide's diagram grow into (or shrink to) the slide's free height. A slide whose
   * text would squeeze its only diagram to under 3/4 of its size puts the diagram and the
   * text side by side instead, to use the slide's width.
   */
  const fitDiagram = (slide: Element) => {
    const svgs = [...slide.querySelectorAll<SVGSVGElement>('figure.argmap svg')];
    if (!svgs.length) return;
    const fit = () => {
      for (const svg of svgs) svg.style.maxHeight = '';
      const spare = SLIDE_HEIGHT - (slide as HTMLElement).offsetHeight;
      // Share the spare (or missing) height among the slide's diagrams.
      const sizes = svgs.map((svg) => svg.clientHeight);
      svgs.forEach((svg, i) => (svg.style.maxHeight = `${Math.max(160, sizes[i] + spare / svgs.length)}px`));
      return { spare, natural: sizes[0] };
    };
    const { spare, natural } = fit();
    const figure = svgs[0].closest('figure')!;
    const split = svgs.length === 1 && !slide.querySelector('.argmap-split') && spare < -natural / 4;
    if (!split || !figure.parentElement) return;
    // Side by side: the diagram on the left, everything after the heading on the right.
    const container = figure.parentElement === slide ? figure : figure.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'argmap-split';
    const text = document.createElement('div');
    text.className = 'argmap-split-text';
    const rest = [...slide.children].filter((el) => el !== container && !/^H[1-3]$/.test(el.tagName) && !el.matches('aside.notes'));
    container.replaceWith(wrap);
    wrap.append(figure, text);
    text.append(...rest);
    fit();
  };

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
    // Size each diagram to the room its slide has left: bigger when the slide is mostly
    // diagram, smaller when text crowds it. (Printing lays out every slide at once.)
    const all = () => document.querySelectorAll('.reveal .slides section');
    const fitAll = () => {
      (new URLSearchParams(location.search).has('print-pdf') ? [...all()] : [Reveal.getCurrentSlide()]).forEach((s) => s && fitDiagram(s));
      Reveal.layout();
    };
    Reveal.on('slidechanged', fitAll);
    void document.fonts.ready.then(fitAll);
    fitAll();
  });
}
