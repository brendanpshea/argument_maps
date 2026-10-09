/** Pure editing operations on an ArgumentMap. Each returns a new map. */
import type { ArgumentMap, ClaimSource, MapNode, RelationType } from './types';

let counter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function addNode(map: ArgumentMap, text: string, source: ClaimSource, position?: { x: number; y: number }): ArgumentMap {
  const i = map.nodes.length;
  const node: MapNode = {
    id: newId('n'),
    text,
    source,
    position: position ?? { x: 20 + (i % 3) * 270, y: 20 + Math.floor(i / 3) * 150 },
  };
  return { ...map, nodes: [...map.nodes, node] };
}

/** Removes a claim, along with any relation left without premises or a target. */
export function removeNode(map: ArgumentMap, nodeId: string): ArgumentMap {
  return {
    nodes: map.nodes.filter((n) => n.id !== nodeId),
    relations: map.relations
      .filter((r) => r.to !== nodeId)
      .map((r) => ({ ...r, from: r.from.filter((f) => f !== nodeId) }))
      .filter((r) => r.from.length > 0),
    conclusion: map.conclusion === nodeId ? undefined : map.conclusion,
  };
}

export const setText = (map: ArgumentMap, nodeId: string, text: string): ArgumentMap => ({
  ...map,
  nodes: map.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)),
});

export const toggleConclusion = (map: ArgumentMap, nodeId: string): ArgumentMap => ({
  ...map,
  conclusion: map.conclusion === nodeId ? undefined : nodeId,
});

/** Adds a single-premise relation. Ignores self-links and exact duplicates. */
export function addRelation(map: ArgumentMap, type: RelationType, from: string[], to: string): ArgumentMap {
  if (from.length === 0 || from.includes(to)) return map;
  const exists = map.relations.some(
    (r) => r.to === to && r.from.length === from.length && r.from.every((f) => from.includes(f)),
  );
  if (exists) return map;
  return { ...map, relations: [...map.relations, { id: newId('r'), type, from: [...from], to }] };
}

/** Adds a premise to an existing relation, making it (more) linked. */
export function addPremise(map: ArgumentMap, relationId: string, nodeId: string): ArgumentMap {
  return {
    ...map,
    relations: map.relations.map((r) =>
      r.id === relationId && r.to !== nodeId && !r.from.includes(nodeId) ? { ...r, from: [...r.from, nodeId] } : r,
    ),
  };
}

export function removePremise(map: ArgumentMap, relationId: string, nodeId: string): ArgumentMap {
  return {
    ...map,
    relations: map.relations
      .map((r) => (r.id === relationId ? { ...r, from: r.from.filter((f) => f !== nodeId) } : r))
      .filter((r) => r.from.length > 0),
  };
}

export const removeRelation = (map: ArgumentMap, relationId: string): ArgumentMap => ({
  ...map,
  relations: map.relations.filter((r) => r.id !== relationId),
});

export const toggleRelationType = (map: ArgumentMap, relationId: string): ArgumentMap => ({
  ...map,
  relations: map.relations.map((r) =>
    r.id === relationId ? { ...r, type: r.type === 'support' ? 'objection' : 'support' } : r,
  ),
});

export function setPositions(map: ArgumentMap, positions: Record<string, { x: number; y: number }>): ArgumentMap {
  return {
    ...map,
    nodes: map.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
    relations: map.relations.map((r) => (positions[r.id] ? { ...r, position: positions[r.id] } : r)),
  };
}

/** Swaps premise and target of a single-premise relation. */
export const reverseRelation = (map: ArgumentMap, relationId: string): ArgumentMap => ({
  ...map,
  relations: map.relations.map((r) => (r.id === relationId && r.from.length === 1 ? { ...r, from: [r.to], to: r.from[0] } : r)),
});

/** "supports", "objects to", or "rebuts" (an objection aimed at an objection). */
export function relationLabel(map: ArgumentMap, relationId: string): string {
  const r = map.relations.find((x) => x.id === relationId);
  if (!r) return '';
  if (r.type === 'support') return 'supports';
  const targetIsObjection = map.relations.some((o) => o.type === 'objection' && o.from.includes(r.to));
  return targetIsObjection ? 'rebuts' : 'objects to';
}
