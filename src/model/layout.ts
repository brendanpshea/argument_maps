import dagre from '@dagrejs/dagre';
import type { Answer, ArgumentMap, Lesson } from './types';

export const CLAIM_SIZE = { width: 240, height: 90 };
export const JUNCTION_SIZE = { width: 96, height: 28 };

/**
 * Lays the map out top-down with the main conclusion at the top and
 * premises/objections below. Returns a new map with updated positions.
 */
export function autoLayout(map: ArgumentMap): ArgumentMap {
  // Claims with no links yet go in a grid below the rest; dagre would put them all in one long row.
  const linked = new Set(map.relations.flatMap((r) => [...r.from, r.to]));
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'BT', nodesep: 40, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of map.nodes) if (linked.has(n.id)) g.setNode(n.id, { ...CLAIM_SIZE });
  for (const r of map.relations) {
    g.setNode(r.id, { ...JUNCTION_SIZE });
    for (const f of r.from) g.setEdge(f, r.id);
    g.setEdge(r.id, r.to);
  }
  dagre.layout(g);
  const at = (id: string, size: { width: number; height: number }) => {
    const p = g.node(id);
    return { x: p.x - size.width / 2, y: p.y - size.height / 2 };
  };
  const bottom = Math.max(0, ...map.nodes.filter((n) => linked.has(n.id)).map((n) => at(n.id, CLAIM_SIZE).y + CLAIM_SIZE.height));
  const top = linked.size ? bottom + 80 : 0;
  let k = 0;
  const gridSpot = () => {
    const i = k++;
    return { x: (i % 3) * (CLAIM_SIZE.width + 40), y: top + Math.floor(i / 3) * (CLAIM_SIZE.height + 60) };
  };
  return {
    ...map,
    nodes: map.nodes.map((n) => ({ ...n, position: linked.has(n.id) ? at(n.id, CLAIM_SIZE) : gridSpot() })),
    relations: map.relations.map((r) => ({ ...r, position: at(r.id, JUNCTION_SIZE) })),
  };
}

/** Builds a map from a lesson answer, using the model wording for each claim. */
export function mapFromAnswer(lesson: Lesson, answer: Answer): ArgumentMap {
  // Use the first acceptable target of each link.
  const ids = [...new Set([answer.conclusion, ...answer.relations.flatMap((r) => [...r.from, r.to[0]])])];
  return autoLayout({
    nodes: ids.map((id) => ({
      id: `n-${id}`,
      text: lesson.claims[id].modelText,
      source: lesson.claims[id].source,
      position: { x: 0, y: 0 },
    })),
    relations: answer.relations.map((r, i) => ({
      id: `r-${i}`,
      type: r.type,
      from: r.from.map((f) => `n-${f}`),
      to: `n-${r.to[0]}`,
    })),
    conclusion: `n-${answer.conclusion}`,
  });
}
