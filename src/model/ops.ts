/** Pure editing operations on an ArgumentMap. Each returns a new map. */
import type { ArgumentMap, ClaimSource, Evaluation, MapNode, RelationType } from './types';

let counter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

const sameLink = (a: { from: string[]; to: string }, b: { from: string[]; to: string }) =>
  a.to === b.to && a.from.length === b.from.length && a.from.every((f) => b.from.includes(f));

/** Drops any link that repeats an earlier one exactly (same kind, premises and target). */
const dedupe = (map: ArgumentMap): ArgumentMap => ({
  ...map,
  relations: map.relations.filter((r, i) => !map.relations.slice(0, i).some((o) => o.type === r.type && sameLink(o, r))),
});

export function addNode(map: ArgumentMap, text: string, source: ClaimSource, position?: { x: number; y: number }): ArgumentMap {
  const i = map.nodes.length;
  const node: MapNode = {
    id: newId('n'),
    text,
    source,
    position: position ?? { x: 20 + (i % 3) * 360, y: 20 + Math.floor(i / 3) * 200 },
  };
  return { ...map, nodes: [...map.nodes, node] };
}

/** Removes a claim, along with any relation left without premises or a target. */
export function removeNode(map: ArgumentMap, nodeId: string): ArgumentMap {
  return dedupe({
    nodes: map.nodes.filter((n) => n.id !== nodeId),
    relations: map.relations
      .filter((r) => r.to !== nodeId)
      .map((r) => ({ ...r, from: r.from.filter((f) => f !== nodeId) }))
      .filter((r) => r.from.length > 0),
    conclusion: map.conclusion === nodeId ? undefined : map.conclusion,
  });
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
  from = [...new Set(from)];
  const exists = (id: string) => map.nodes.some((n) => n.id === id);
  if (from.length === 0 || from.includes(to) || !exists(to) || !from.every(exists)) return map;
  if (map.relations.some((r) => sameLink(r, { from, to }))) return map;
  return { ...map, relations: [...map.relations, { id: newId('r'), type, from, to }] };
}

/** Adds a premise to an existing relation, making it (more) linked. */
export function addPremise(map: ArgumentMap, relationId: string, nodeId: string): ArgumentMap {
  if (!map.nodes.some((n) => n.id === nodeId)) return map;
  return dedupe({
    ...map,
    relations: map.relations.map((r) =>
      r.id === relationId && r.to !== nodeId && !r.from.includes(nodeId) ? { ...r, from: [...r.from, nodeId] } : r,
    ),
  });
}

/**
 * Adds a premise to a link as a linked (mutual) premise. If that premise
 * already had its own separate link of the same kind to the same target,
 * that link is merged in rather than left as a duplicate.
 */
export function linkPremise(map: ArgumentMap, relationId: string, nodeId: string): ArgumentMap {
  const rel = map.relations.find((r) => r.id === relationId);
  if (!rel || rel.to === nodeId || rel.from.includes(nodeId)) return map;
  const merged = addPremise(map, relationId, nodeId);
  return {
    ...merged,
    relations: merged.relations
      .filter((r) => !(r.id !== relationId && r.to === rel.to && r.type === rel.type && r.from.length === 1 && r.from[0] === nodeId))
      // Re-centre the label between all its premises and the target.
      .map((r) => (r.id === relationId ? { ...r, position: undefined } : r)),
  };
}

/** Turns a linked link into one independent link per premise, same kind and target. */
export function splitRelation(map: ArgumentMap, relationId: string): ArgumentMap {
  const rel = map.relations.find((r) => r.id === relationId);
  if (!rel || rel.from.length < 2) return map;
  const [first, ...rest] = rel.from;
  return dedupe({
    ...map,
    relations: map.relations.flatMap((r) =>
      r.id === relationId
        ? [{ ...r, from: [first], position: undefined }, ...rest.map((f) => ({ id: newId('r'), type: r.type, from: [f], to: r.to }))]
        : [r],
    ),
  });
}

export function removePremise(map: ArgumentMap, relationId: string, nodeId: string): ArgumentMap {
  return dedupe({
    ...map,
    relations: map.relations
      .map((r) => (r.id === relationId ? { ...r, from: r.from.filter((f) => f !== nodeId) } : r))
      .filter((r) => r.from.length > 0),
  });
}

export const removeRelation = (map: ArgumentMap, relationId: string): ArgumentMap => ({
  ...map,
  relations: map.relations.filter((r) => r.id !== relationId),
});

export const toggleRelationType = (map: ArgumentMap, relationId: string): ArgumentMap => ({
  ...map,
  relations: map.relations.map((r) =>
    // Explanation links have no counterpart to switch to.
    // A judgement of the inference no longer applies once the link's kind changes.
    r.id === relationId && r.type !== 'explanation' ? { ...r, type: r.type === 'support' ? 'objection' : 'support', evaluation: undefined } : r,
  ),
});

export function setPositions(map: ArgumentMap, positions: Record<string, { x: number; y: number }>): ArgumentMap {
  return {
    ...map,
    nodes: map.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
    relations: map.relations.map((r) => (positions[r.id] ? { ...r, position: positions[r.id] } : r)),
  };
}

export const setEvaluation = (map: ArgumentMap, relationId: string, evaluation: Evaluation): ArgumentMap => ({
  ...map,
  relations: map.relations.map((r) => (r.id === relationId ? { ...r, evaluation } : r)),
});

/** Swaps premise and target of a single-premise relation. */
export const reverseRelation = (map: ArgumentMap, relationId: string): ArgumentMap => {
  const rel = map.relations.find((r) => r.id === relationId);
  // Reversing onto a link that already exists would duplicate it.
  if (!rel || rel.from.length !== 1 || map.relations.some((o) => o !== rel && sameLink(o, { from: [rel.to], to: rel.from[0] }))) return map;
  return {
    ...map,
    relations: map.relations.map((r) => (r === rel ? { ...r, from: [r.to], to: r.from[0], evaluation: undefined } : r)),
  };
};

/** "supports", "explains", "objects to", or "rebuts" (an objection aimed at an objection). */
export function relationLabel(map: ArgumentMap, relationId: string): string {
  const r = map.relations.find((x) => x.id === relationId);
  if (!r) return '';
  if (r.type === 'support') return 'supports';
  if (r.type === 'explanation') return 'explains';
  const targetIsObjection = map.relations.some((o) => o.type === 'objection' && o.from.includes(r.to));
  return targetIsObjection ? 'rebuts' : 'objects to';
}
