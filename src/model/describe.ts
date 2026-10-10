import { relationLabel } from './ops';
import type { ArgumentMap, MapRelation } from './types';

const PLURAL: Record<string, string> = { supports: 'support', explains: 'explain', 'objects to': 'object to', rebuts: 'rebut' };

/** A link as a sentence, e.g. "(3) and (4) support (2)", naming claims with `name`. */
export function linkSentence(map: ArgumentMap, r: MapRelation, name: (nodeId: string) => string): string {
  const label = relationLabel(map, r.id);
  const premises = r.from.map(name);
  const joined = premises.length > 1 ? `${premises.slice(0, -1).join(', ')} and ${premises[premises.length - 1]}` : premises[0];
  return `${joined} ${premises.length > 1 ? (PLURAL[label] ?? label) : label} ${name(r.to)}`;
}

/** A student's evaluation of a link in words, e.g. "inductive, strong". */
export const evaluationWords = (r: MapRelation) => [r.evaluation?.type, r.evaluation?.quality].filter(Boolean).join(', ');

/**
 * What changed between two versions of a map, as short sentences for a screen reader
 * (claims added or removed, links, the conclusion, wording, evaluations). Moving things
 * around says nothing.
 */
export function describeChanges(
  prev: ArgumentMap,
  next: ArgumentMap,
  name: { prev: (id: string) => string; next: (id: string) => string },
  conclusionWord: string,
): string[] {
  const out: string[] = [];
  const had = new Map(prev.nodes.map((n) => [n.id, n]));
  const has = new Map(next.nodes.map((n) => [n.id, n]));
  for (const n of next.nodes) if (!had.has(n.id)) out.push(`Added ${name.next(n.id)} to your map.`);
  for (const n of prev.nodes) if (!has.has(n.id)) out.push(`Removed ${name.prev(n.id)} from your map.`);
  for (const n of next.nodes) {
    const old = had.get(n.id);
    if (old && old.text !== n.text) out.push(`Reworded: ${name.next(n.id)}.`);
  }
  if (prev.conclusion !== next.conclusion && has.has(next.conclusion ?? '')) out.push(`${name.next(next.conclusion!)} is now the ${conclusionWord}.`);
  else if (prev.conclusion && !next.conclusion && has.has(prev.conclusion)) out.push(`No claim is marked as the ${conclusionWord}.`);
  const oldRels = new Map(prev.relations.map((r) => [r.id, r]));
  const newRels = new Map(next.relations.map((r) => [r.id, r]));
  for (const r of next.relations) {
    const old = oldRels.get(r.id);
    const sentence = linkSentence(next, r, name.next);
    if (!old) out.push(`Link added: ${sentence}.`);
    else if (old.type !== r.type || old.to !== r.to || old.from.join() !== r.from.join()) out.push(`Link changed: ${sentence}.`);
    else if (evaluationWords(old) !== evaluationWords(r) && evaluationWords(r)) out.push(`${sentence}: ${evaluationWords(r)}.`);
  }
  // Links that went with a removed claim aren't worth a sentence of their own.
  for (const r of prev.relations) {
    if (!newRels.has(r.id) && has.has(r.to) && r.from.every((f) => has.has(f))) out.push(`Link removed: ${linkSentence(prev, r, name.prev)}.`);
  }
  return out;
}
