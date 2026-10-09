import type { Answer, Relation } from '../model/types';

/** A concrete model map: one target per link, a fixed grouping, optional links in or out. */
export interface ConcreteAnswer {
  conclusion: string;
  relations: Relation[];
}

/**
 * Every concrete map an answer accepts, following its leeway annotations:
 * each alternative target, linked or fully convergent for `grouping: either`,
 * and optional links included or left out. (Mixed groupings and equivalent
 * claims are accepted by the grader too, but aren't enumerated here.)
 */
export function expandVariants(answer: Answer, limit = 256): ConcreteAnswer[] {
  let variants: Relation[][] = [[]];
  for (const r of answer.relations) {
    const options: Relation[][] = [];
    for (const to of r.to) {
      options.push([{ type: r.type, from: r.from, to }]);
      if (r.grouping === 'either' && r.from.length > 1) options.push(r.from.map((f) => ({ type: r.type, from: [f], to })));
    }
    if (r.optional) options.push([]);
    variants = variants.flatMap((v) => options.map((o) => [...v, ...o])).slice(0, limit);
  }
  return variants.map((relations) => ({ conclusion: answer.conclusion, relations }));
}

/** Turns a concrete answer back into an Answer (no leeway) for building a map from it. */
export const asAnswer = (c: ConcreteAnswer): Answer => ({
  conclusion: c.conclusion,
  relations: c.relations.map((r) => ({ ...r, to: [r.to], grouping: 'exact', optional: false })),
});
