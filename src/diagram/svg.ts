import dagre from '@dagrejs/dagre';
import { vocab } from '../model/vocab';
import type { Diagram, DiagramLink } from './model';

/** Colours match the interactive map. */
const COLOR = { support: '#2f7d32', objection: '#c62828', explanation: '#5b3fa8' } as const;
const PILL_FILL = { support: '#e8f3e8', objection: '#fbe9e9', explanation: '#efeafa' } as const;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', 'Liberation Sans', sans-serif";

const CLAIM_WIDTH = 250;
const PAD = 12;
const FONT_SIZE = 15;
const LINE = 20;
const TAG_LINE = 16;
/** Characters per line for wrapping (no DOM to measure text in Node); conservative for wide fonts. */
const CHARS_PER_LINE = 25;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text: string, max = CHARS_PER_LINE): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const linkLabel = (d: Diagram, l: DiagramLink) => {
  if (l.type === 'support') return 'supports';
  if (l.type === 'explanation') return 'explains';
  const targetIsObjection = d.links.some((o) => o.type === 'objection' && o.from.includes(l.to));
  return targetIsObjection ? 'rebuts' : 'objects to';
};

/**
 * Wraps an element in a reveal.js fragment if it appears after the first step. `@n` becomes
 * data-fragment-index n, so text marked with the same index appears on the same click.
 */
const fragment = (step: number, body: string) =>
  step > 1 ? `<g class="fragment" data-fragment-index="${step}">${body}</g>` : `<g>${body}</g>`;

/** A smooth path through dagre's edge points. */
function pathThrough(points: { x: number; y: number }[]): string {
  if (points.length < 3) return `M${points.map((p) => `${p.x},${p.y}`).join(' L')}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    d += ` Q${points[i].x},${points[i].y} ${i === points.length - 2 ? `${points[i + 1].x},${points[i + 1].y}` : `${mid.x},${mid.y}`}`;
  }
  return d;
}

/** Renders a diagram as a standalone SVG string (usable in the browser and in Node). */
export function renderDiagramSvg(d: Diagram): string {
  const V = vocab(d.kind);
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'BT', nodesep: 34, ranksep: 46, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));

  const claimLines = new Map(d.claims.map((c) => [c.id, wrap(c.text)]));
  const hasTag = (id: string) => id === d.conclusion || !!d.claims.find((c) => c.id === id)?.tag;
  for (const c of d.claims) {
    const height = PAD * 2 + claimLines.get(c.id)!.length * LINE + (hasTag(c.id) ? TAG_LINE : 0);
    g.setNode(c.id, { width: CLAIM_WIDTH, height });
  }
  d.links.forEach((l, i) => {
    const label = linkLabel(d, l).toUpperCase();
    const badge = l.evaluation?.type ? [l.evaluation.type, l.evaluation.quality].filter(Boolean).join(' · ') : '';
    const width = Math.max(label.length * 8 + 26, badge.length * 6.5 + 18);
    g.setNode(`link${i}`, { width, height: badge ? 46 : 26 });
    for (const f of l.from) g.setEdge(f, `link${i}`);
    g.setEdge(`link${i}`, l.to);
  });
  dagre.layout(g);

  const markers = (['support', 'objection', 'explanation'] as const)
    .map(
      (t) =>
        `<marker id="arrow-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${COLOR[t]}"/></marker>`,
    )
    .join('');

  // Each link: its lines, label, and badge. Drawn after the claim boxes so arrowheads stay visible.
  const linkEls = d.links.map((l, i) => {
    const id = `link${i}`;
    const n = g.node(id);
    const color = COLOR[l.type];
    const lines = [
      ...l.from.map((f) => `<path d="${pathThrough(g.edge(f, id).points)}" fill="none" stroke="${color}" stroke-width="2.5"/>`),
      `<path d="${pathThrough(g.edge(id, l.to).points)}" fill="none" stroke="${color}" stroke-width="2.5" marker-end="url(#arrow-${l.type})"/>`,
    ];
    const label = linkLabel(d, l).toUpperCase();
    const badge = l.evaluation?.type ? [l.evaluation.type, l.evaluation.quality].filter(Boolean).join(' · ') : '';
    const pillW = label.length * 8 + 26;
    const pillY = n.y - n.height / 2;
    const pill =
      `<rect x="${n.x - pillW / 2}" y="${pillY}" width="${pillW}" height="26" rx="13" fill="${PILL_FILL[l.type]}" stroke="${color}" stroke-width="2"/>` +
      `<text x="${n.x}" y="${pillY + 17.5}" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="0.5" fill="${color}">${esc(label)}</text>`;
    const badgeEl = badge
      ? `<rect x="${n.x - (badge.length * 6.5 + 14) / 2}" y="${pillY + 29}" width="${badge.length * 6.5 + 14}" height="17" rx="8.5" fill="#fff" stroke="#c9c6bf"/>` +
        `<text x="${n.x}" y="${pillY + 41.5}" text-anchor="middle" font-size="11" font-weight="600" fill="#1f2328">${esc(badge)}</text>`
      : '';
    return fragment(l.step, lines.join('') + pill + badgeEl);
  });

  const claimEls = d.claims.map((c) => {
    const n = g.node(c.id);
    const x = n.x - n.width / 2;
    const y = n.y - n.height / 2;
    const isConclusion = c.id === d.conclusion;
    const tag = isConclusion ? V.Conclusion.toUpperCase() : c.tag?.toUpperCase();
    const tagColor = isConclusion ? '#b7791f' : '#6b4fa0';
    let ty = y + PAD + 13;
    const parts = [
      `<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="8" fill="${isConclusion ? '#fdf6e7' : '#ffffff'}" stroke="${isConclusion ? '#b7791f' : '#8a8f98'}" stroke-width="${isConclusion ? 3 : 2}"/>`,
    ];
    if (tag) {
      parts.push(`<text x="${x + PAD}" y="${ty}" font-size="11" font-weight="700" letter-spacing="0.5" fill="${tagColor}">${esc(tag)}</text>`);
      ty += TAG_LINE;
    }
    for (const line of claimLines.get(c.id)!) {
      parts.push(`<text x="${x + PAD}" y="${ty}" font-size="${FONT_SIZE}" fill="#1f2328">${esc(line)}</text>`);
      ty += LINE;
    }
    return fragment(c.step, parts.join(''));
  });

  const { width, height } = g.graph() as { width: number; height: number };
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="--w:${w}" font-family="${esc(FONT)}" role="img" aria-label="${esc(describe(d))}">` +
    `<defs>${markers}</defs>${claimEls.join('')}${linkEls.join('')}</svg>`
  );
}

/** A plain-text description of the diagram for screen readers. */
export function describe(d: Diagram): string {
  const text = (id: string) => d.claims.find((c) => c.id === id)?.text ?? id;
  const V = vocab(d.kind);
  const parts = d.conclusion ? [`${V.Conclusion}: ${text(d.conclusion)}.`] : [];
  for (const l of d.links) parts.push(`${l.from.map(text).join(' and ')} ${linkLabel(d, l)} ${text(l.to)}.`);
  return parts.join(' ');
}
