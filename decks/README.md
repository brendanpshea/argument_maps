# Writing slide decks

Each `.md` file in this folder is a reveal.js slide deck. Decks are bundled
into the site and listed at `slides.html`; a deck's address is
`slides.html?deck=<file name without .md>`.

## Slides

- `---` on a line by itself starts a new slide.
- `Note:` starts the speaker notes for that slide (press **S** while presenting).
- The first `# Heading` is the deck's title.
- Ordinary Markdown works: headings, lists, tables, **bold**, links, images.
- Link to a practice lesson with `[Try it →](./#/lesson/zoos)`.
- To reveal a paragraph or list item on a click, end it with
  `<!-- .element: class="fragment" -->` (add `data-fragment-index="2"` to
  time it with a diagram's `@2`).

While presenting: arrow keys move through slides, **F** is full screen,
**Esc** shows an overview. For a PDF (one page per slide), add
`&print-pdf` to the address and print to PDF.

## Diagrams

Write a diagram in an `argmap` code block:

````markdown
```argmap
C*: The butler is the thief
P1: Whoever stole the jewels had to open the safe with its key
P2: Only the butler had a key
O: The butler has an alibi          @2
P1 + P2 -> C  [deductive, valid]
O -x C
```
````

| Line | Meaning |
|---|---|
| `ID: text` | A claim. IDs are short names you choose (letters, digits, `-`, `_`). |
| `ID*: text` | The main conclusion (or explanandum). Without a `*`, it's the claim that is supported but supports nothing. |
| `A -> B` | A supports B. |
| `A + B -> C` | A and B together (linked) support C. |
| `A -x B` | A objects to B. An objection to an objection is labelled *rebuts* automatically. |
| `A => B` | A explains B. Using `=>` makes the diagram an explanation (the conclusion becomes the **explanandum**). |
| `… [deductive, valid]` | An evaluation badge on a link: `deductive`/`inductive` and `valid`/`invalid`/`strong`/`weak`. |
| | Evaluated links are styled so nothing depends on colour alone. The **type** shows in the line and badge: deductive links are solid with a filled arrowhead and a square-cornered "∴ deductive" badge; inductive links are dashed with an open arrowhead and a rounded "≈ inductive" badge. The **verdict** becomes the link's label ("✓ VALID", "✓ STRONG", "✗ INVALID", "✗ WEAK"), and failed links (invalid or weak) are grey and broken by a circled ✗. Diagrams with evaluated links get a key along the bottom. |
| `… @2` | Appear on the 2nd click (on a claim or a link). Links appear no earlier than their claims. |
| `# …` or `// …` | A comment. |

### Diagrams from lessons

Show a lesson's model map instead of writing it out:

````markdown
```argmap lesson=butler
```
````

Add `step=2` to show a particular step (by default, the last mapping or
evaluation step). Evaluation steps include their badges. Because the diagram
comes from the lesson file, the slide and the practice exercise can't drift
apart.

## PNG images

`npm run build` renders every diagram to `diagrams/<deck>/<n>.png` (and
`.svg`) on the site, numbered in the order they appear in the deck. On a
slide, hover over a diagram for a **PNG** download link, to paste into
other slides, handouts, or an LMS. The build fails if any diagram has an
error, and `npm test` checks every deck too.
