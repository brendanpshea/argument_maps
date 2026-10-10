import dagre from '@dagrejs/dagre';
import {
  FAILED_COLOR,
  FAILED_FILL,
  INDUCTIVE_DASH,
  isFailed,
  QUALITY_SYMBOL,
  TYPE_SYMBOL,
  typeBadge,
  verdictLabel,
} from '../model/evaluationStyle';
import { vocab } from '../model/vocab';
import { CHALLENGED_COLOR, CHALLENGED_FILL, claimStatuses, STATUS_LABEL, type ClaimStatus } from '../model/dialectic';
import type { Diagram, DiagramLink } from './model';

/** Colours match the interactive map. Failed inferences (invalid or weak) are drawn in neutral grey. */
const COLOR = { support: '#2f7d32', objection: '#c62828', explanation: '#5b3fa8', failed: FAILED_COLOR } as const;
const PILL_FILL = { support: '#e8f3e8', objection: '#fbe9e9', explanation: '#efeafa', failed: FAILED_FILL } as const;

const failed = (l: DiagramLink) => isFailed(l.evaluation);

/** Once a link's quality is judged, its label is the verdict ("✓ VALID", "✗ WEAK"); otherwise "SUPPORTS" etc. */
const pillText = (d: Diagram, l: DiagramLink) => (verdictLabel(l.evaluation) ?? linkLabel(d, l)).toUpperCase();

const badgeFor = (l: DiagramLink) => typeBadge(l.evaluation);

/** The point halfway along a path through dagre's edge points (matching pathThrough's curve). */
function midpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 3) {
    const [a, b, c] = points;
    return { x: 0.25 * a.x + 0.5 * b.x + 0.25 * c.x, y: 0.25 * a.y + 0.5 * b.y + 0.25 * c.y };
  }
  const i = Math.floor((points.length - 1) / 2);
  return { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
}
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

/** Shown from step `from` until step `until` (exclusive), when it fades out. */
const during = (from: number, until: number | undefined, body: string) =>
  until === undefined ? fragment(from, body) : `<g class="fragment fade-out" data-fragment-index="${until}">${fragment(from, body)}</g>`;

/**
 * Each claim's status (challenged or answered) over the build steps, as
 * [from step, until step, status] spans. A static image shows only the final state.
 */
function statusSpans(d: Diagram, animate: boolean): Map<string, [number, number | undefined, ClaimStatus][]> {
  const steps = animate ? [...new Set(d.links.map((l) => l.step))].sort((a, b) => a - b) : [Infinity];
  const spans = new Map<string, [number, number | undefined, ClaimStatus][]>();
  for (const step of steps) {
    const statuses = claimStatuses(d.links.filter((l) => l.step <= step));
    for (const c of d.claims) {
      const list = spans.get(c.id) ?? [];
      const last = list[list.length - 1];
      const now = statuses.get(c.id);
      if (last && last[1] === undefined && last[2] !== now) last[1] = step;
      if (now && (!last || last[1] !== undefined)) list.push([animate ? step : 1, undefined, now]);
      spans.set(c.id, list);
    }
  }
  return spans;
}

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

// Marker ids are global to the page, and a slide deck shows many diagrams on one page.
// If two diagrams shared ids, every arrow would point at the first diagram's markers,
// which don't render while that diagram's slide is hidden. So each diagram gets its own.
let diagramCount = 0;

/**
 * Renders a diagram as a standalone SVG string (usable in the browser and in Node).
 * With `animate` (the default), later steps are reveal.js fragments; without it, the
 * SVG shows the finished diagram (for PNG export).
 */
export function renderDiagramSvg(d: Diagram, { animate = true }: { animate?: boolean } = {}): string {
  const V = vocab(d.kind);
  const arrowId = `argmap${++diagramCount}-arrow`;
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
    const label = pillText(d, l);
    const badge = badgeFor(l);
    const width = Math.max(label.length * 8 + 26, badgeWidth(badge) + 4);
    g.setNode(`link${i}`, { width, height: badge ? 46 : 26 });
    for (const f of l.from) g.setEdge(f, `link${i}`);
    g.setEdge(`link${i}`, l.to);
  });
  dagre.layout(g);

  // Filled arrowheads for most links; open ones for inductive links.
  const markers = (['support', 'objection', 'explanation', 'failed'] as const)
    .map(
      (t) =>
        `<marker id="${arrowId}-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${COLOR[t]}"/></marker>` +
        `<marker id="${arrowId}-${t}-open" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1,1 L10,6 L1,11 z" fill="#ffffff" stroke="${COLOR[t]}" stroke-width="1.6" stroke-linejoin="round"/></marker>`,
    )
    .join('');

  // Each link: its lines, label, and badge. Drawn after the claim boxes so arrowheads stay visible.
  const linkEls = d.links.map((l, i) => {
    const id = `link${i}`;
    const n = g.node(id);
    const fail = failed(l);
    const tone = fail ? 'failed' : l.type;
    const color = COLOR[tone];
    // Inductive links are dashed with an open arrowhead; everything else is solid with a filled one.
    const inductive = l.evaluation?.type === 'inductive';
    const dash = inductive ? ` stroke-dasharray="${INDUCTIVE_DASH}"` : '';
    const marker = `url(#${arrowId}-${tone}${inductive ? '-open' : ''})`;
    const outPoints = g.edge(id, l.to).points;
    const lines = [
      ...l.from.map((f) => `<path d="${pathThrough(g.edge(f, id).points)}" fill="none" stroke="${color}" stroke-width="2.5"${dash}/>`),
      `<path d="${pathThrough(outPoints)}" fill="none" stroke="${color}" stroke-width="2.5"${dash} marker-end="${marker}"/>`,
    ];
    if (fail) {
      // A failed inference "doesn't get through": a circled ✗ breaks the line into the conclusion.
      const m = midpoint(outPoints);
      lines.push(
        `<circle cx="${m.x}" cy="${m.y}" r="10" fill="#fff" stroke="${color}" stroke-width="2"/>` +
          `<text x="${m.x}" y="${m.y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="${color}">✗</text>`,
      );
    }
    const label = pillText(d, l);
    const badge = badgeFor(l);
    const pillW = label.length * 8 + 26;
    const pillY = n.y - n.height / 2;
    const pill =
      `<rect x="${n.x - pillW / 2}" y="${pillY}" width="${pillW}" height="26" rx="13" fill="${PILL_FILL[tone]}" stroke="${color}" stroke-width="2"/>` +
      `<text x="${n.x}" y="${pillY + 17.5}" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="0.5" fill="${color}">${esc(label)}</text>`;
    // Badge shape echoes the type: square corners for deductive, rounded for inductive.
    const bw = badgeWidth(badge);
    const badgeEl = badge
      ? `<rect x="${n.x - bw / 2}" y="${pillY + 29}" width="${bw}" height="18" rx="${inductive ? 9 : 1.5}" fill="#fff" stroke="#6f747c" stroke-width="1.2"${inductive ? ` stroke-dasharray="3 2"` : ''}/>` +
        `<text x="${n.x}" y="${pillY + 42}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#1f2328">${esc(badge)}</text>`
      : '';
    return fragment(l.step, lines.join('') + pill + badgeEl);
  });

  const spans = statusSpans(d, animate);
  const claimEls = d.claims.map((c) => {
    const n = g.node(c.id);
    const x = n.x - n.width / 2;
    const y = n.y - n.height / 2;
    const isConclusion = c.id === d.conclusion;
    const tag = isConclusion ? V.Conclusion.toUpperCase() : c.tag?.toUpperCase();
    const tagColor = isConclusion ? '#b7791f' : '#6b4fa0';
    let ty = y + PAD + 13;
    const parts = [
      `<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="8" fill="${isConclusion ? '#fdf6e7' : '#ffffff'}" stroke="${isConclusion ? '#b7791f' : '#8a8f98'}" stroke-width="${isConclusion ? 3 : 2}"${dashFor(c.tag)}/>`,
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

  // Each claim's status in the debate: a pill on its top edge, and an amber border while challenged.
  const statusEls = d.claims.flatMap((c) => {
    const n = g.node(c.id);
    const x = n.x - n.width / 2;
    const y = n.y - n.height / 2;
    return (spans.get(c.id) ?? []).map(([from, until, status]) => {
      const label = STATUS_LABEL[status].toUpperCase();
      const w = label.length * 7 + 16;
      const px = x + n.width - w - 8;
      const challenged = status === 'challenged';
      const border = challenged
        ? `<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="8" fill="none" stroke="${CHALLENGED_COLOR}" stroke-width="${c.id === d.conclusion ? 3 : 2.5}"${dashFor(c.tag)}/>`
        : '';
      const pill =
        `<rect x="${px}" y="${y - 10}" width="${w}" height="20" rx="10" fill="${challenged ? CHALLENGED_FILL : '#ffffff'}" stroke="${challenged ? CHALLENGED_COLOR : '#8a8f98'}" stroke-width="2"/>` +
        `<text x="${px + w / 2}" y="${y + 3.5}" text-anchor="middle" font-size="10" font-weight="700" letter-spacing="0.3" fill="${challenged ? CHALLENGED_COLOR : '#4f545b'}">${esc(label)}</text>`;
      return during(Math.max(from, c.step), until, `<g class="argmap-status ${status}">${border}${pill}</g>`);
    });
  });

  const { width, height } = g.graph() as { width: number; height: number };
  // Diagrams with evaluated links get a key along the bottom.
  const key = d.links.some((l) => l.evaluation?.type) ? legend(Math.ceil(height) + 6) : null;
  const w = Math.ceil(Math.max(width, key?.width ?? 0));
  const h = Math.ceil(height) + (key ? 40 : 0);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="--w:${w}" font-family="${esc(FONT)}" role="img" aria-label="${esc(describe(d))}">` +
    `<defs>${markers}</defs>${claimEls.join('')}${linkEls.join('')}${statusEls.join('')}${key?.svg ?? ''}</svg>`
  );
}

/** Unstated premises have a dashed border. */
const dashFor = (tag?: string) => (tag === 'unstated' ? ' stroke-dasharray="6 4"' : '');

const badgeWidth = (text: string) => (text ? text.length * 6.9 + 16 : 0);

/** The key for evaluated links: line styles for the types, symbols for the qualities. */
function legend(y: number): { svg: string; width: number } {
  const ink = '#3d434b';
  const items: string[] = [];
  let x = 12;
  const sample = (dash: boolean, open: boolean, label: string) => {
    const line = `<line x1="${x}" y1="${y + 14}" x2="${x + 38}" y2="${y + 14}" stroke="${ink}" stroke-width="2.5"${dash ? ` stroke-dasharray="${INDUCTIVE_DASH}"` : ''}/>`;
    const head = open
      ? `<path d="M${x + 38},${y + 8} L${x + 48},${y + 14} L${x + 38},${y + 20} z" fill="#fff" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`
      : `<path d="M${x + 38},${y + 9} L${x + 48},${y + 14} L${x + 38},${y + 19} z" fill="${ink}"/>`;
    items.push(line + head + `<text x="${x + 56}" y="${y + 18}" font-size="13" fill="${ink}">${esc(label)}</text>`);
    x += 56 + label.length * 7.4 + 26;
  };
  const text = (label: string) => {
    items.push(`<text x="${x}" y="${y + 18}" font-size="13" fill="${ink}">${esc(label)}</text>`);
    x += label.length * 7.4 + 26;
  };
  sample(false, false, `${TYPE_SYMBOL.deductive} deductive`);
  sample(true, true, `${TYPE_SYMBOL.inductive} inductive`);
  // A grey line broken by a circled ✗: the inference fails (invalid or weak).
  const grey = COLOR.failed;
  items.push(
    `<line x1="${x}" y1="${y + 14}" x2="${x + 38}" y2="${y + 14}" stroke="${grey}" stroke-width="2.5"/>` +
      `<path d="M${x + 38},${y + 9} L${x + 48},${y + 14} L${x + 38},${y + 19} z" fill="${grey}"/>` +
      `<circle cx="${x + 19}" cy="${y + 14}" r="8" fill="#fff" stroke="${grey}" stroke-width="1.8"/>` +
      `<text x="${x + 19}" y="${y + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="${grey}">✗</text>`,
  );
  x += 56;
  text(`fails (${QUALITY_SYMBOL.invalid} invalid / ${QUALITY_SYMBOL.weak} weak)`);
  return { svg: `<g class="argmap-legend" aria-hidden="true">${items.join('')}</g>`, width: x };
}

/** A plain-text description of the diagram for screen readers. */
export function describe(d: Diagram): string {
  const text = (id: string) => d.claims.find((c) => c.id === id)?.text ?? id;
  const V = vocab(d.kind);
  const parts = d.conclusion ? [`${V.Conclusion}: ${text(d.conclusion)}.`] : [];
  for (const l of d.links) {
    const judged = l.evaluation?.type ? ` (${[l.evaluation.type, l.evaluation.quality].filter(Boolean).join(', ')})` : '';
    parts.push(`${l.from.map(text).join(' and ')} ${linkLabel(d, l)} ${text(l.to)}${judged}.`);
  }
  for (const [id, status] of claimStatuses(d.links)) parts.push(`${text(id)}: ${status}.`);
  return parts.join(' ');
}
