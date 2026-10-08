import dagre from '@dagrejs/dagre';
import type { Answer, ArgumentMap, Lesson } from './types';

export const CLAIM_SIZE = { width: 240, height: 90 };
export const JUNCTION_SIZE = { width: 96, height: 28 };

/**
 * Lays the map out top-down with the main conclusion at the top and
 * premises/objections below. Returns a new map with updated positions.
 */
export function autoLayout(map: ArgumentMap): ArgumentMap {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'BT', nodesep: 40, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of map.nodes) g.setNode(n.id, { ...CLAIM_SIZE });
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
  return {
    ...map,
    nodes: map.nodes.map((n) => ({ ...n, position: at(n.id, CLAIM_SIZE) })),
    relations: map.relations.map((r) => ({ ...r, position: at(r.id, JUNCTION_SIZE) })),
  };
}

/** Builds a map from a lesson answer, using the model wording for each claim. */
export function mapFromAnswer(lesson: Lesson, answer: Answer): ArgumentMap {
  const ids = [...new Set([answer.conclusion, ...answer.relations.flatMap((r) => [...r.from, r.to])])];
  return autoLayout({
    nodes: ids.map((id) => ({
      id: `n-${id}`,
      text: lesson.claims[id].modelText,
      source: lesson.claims[id].span,
      position: { x: 0, y: 0 },
    })),
    relations: answer.relations.map((r, i) => ({
      id: `r-${i}`,
      type: r.type,
      from: r.from.map((f) => `n-${f}`),
      to: `n-${r.to}`,
    })),
    conclusion: `n-${answer.conclusion}`,
  });
}
