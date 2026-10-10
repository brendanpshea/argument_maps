import type { Lesson } from '../model/types';
import { diagramFromLesson } from './fromLesson';
import type { Diagram } from './model';
import { parseArgmap } from './parse';
import { describe, renderDiagramSvg } from './svg';

/** One ```argmap block in a deck, numbered from 1 in the order it appears. */
export interface DeckDiagram {
  index: number;
  /** The rendered SVG, or undefined if the block has errors. */
  svg?: string;
  diagram?: Diagram;
  errors: string[];
}

export interface Deck {
  id: string;
  title: string;
  /** The deck's Markdown, with each argmap block replaced by its rendered HTML. */
  markdown: string;
  diagrams: DeckDiagram[];
}

const FENCE = /^```argmap[ \t]*([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;

/** Options after `argmap`, e.g. `lesson=zoos step=2 kind=explanation`. */
function parseOptions(info: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const m of info.matchAll(/([\w-]+)=("[^"]*"|\S+)/g)) options[m[1]] = m[2].replace(/^"|"$/g, '');
  return options;
}

/**
 * Renders every ```argmap block in a deck. `findLesson` resolves `lesson=` references.
 * `pngPath` gives each diagram's exported PNG (for the download link), if any.
 */
export function buildDeck(
  id: string,
  source: string,
  findLesson: (id: string) => Lesson | undefined,
  pngPath?: (index: number) => string,
): Deck {
  const diagrams: DeckDiagram[] = [];
  const markdown = source.replace(FENCE, (_, info: string, body: string) => {
    const index = diagrams.length + 1;
    const options = parseOptions(info);
    let result: { diagram?: Diagram; errors: string[] };
    if (options.lesson) {
      const lesson = findLesson(options.lesson);
      if (!lesson) result = { errors: [`no lesson with id "${options.lesson}"`] };
      else {
        const { diagram, error } = diagramFromLesson(lesson, options.step ? Number(options.step) : undefined);
        result = { diagram, errors: error ? [error] : [] };
      }
    } else {
      result = parseArgmap(body, { kind: options.kind });
    }
    const svg = result.diagram && !result.errors.length ? renderDiagramSvg(result.diagram) : undefined;
    diagrams.push({ index, svg, diagram: result.diagram, errors: result.errors });
    if (!svg) {
      const list = result.errors.map((e) => `<li>${e.replace(/</g, '&lt;')}</li>`).join('');
      return `\n<div class="argmap-error"><strong>Diagram ${index} has errors:</strong><ul>${list}</ul></div>\n`;
    }
    // One line of HTML, surrounded by blank lines, so Markdown passes it through untouched.
    const download = pngPath
      ? `<a class="argmap-download" href="${pngPath(index)}" download title="Download as PNG">PNG<span class="visually-hidden"> image of diagram ${index}</span></a>`
      : '';
    // Screen readers get the description once, as text; the drawing itself is hidden from them
    // (otherwise its labels are read out as a jumble, and the description twice).
    const description = describe(result.diagram!).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const hidden = svg.replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"');
    return `\n<figure class="argmap">${hidden}<figcaption class="visually-hidden">Diagram: ${description}</figcaption>${download}</figure>\n`;
  });
  // From the Markdown after the diagrams are replaced, so a `# comment` in a diagram isn't the title.
  const title = markdown.match(/^#[ \t]+(.+)$/m)?.[1].trim() ?? id;
  return { id, title, markdown, diagrams };
}
