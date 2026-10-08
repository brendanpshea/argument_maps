import type { Answer, ArgumentMap, Lesson, MapRelation, Span, Step } from '../model/types';

export type ItemStatus = 'correct' | 'partial' | 'wrong' | 'missing' | 'note';

export interface GradeItem {
  status: ItemStatus;
  message: string;
  earned: number;
  possible: number;
}

export interface GradeResult {
  earned: number;
  possible: number;
  items: GradeItem[];
  /** Student node id -> lesson claim id (for nodes that match a claim). */
  mapping: Record<string, string>;
}

export const POINTS = { conclusion: 2, claim: 1, relation: 2 } as const;

/**
 * A highlight counts as a claim when most of the highlight lies inside the
 * claim and it covers a fair share of the claim. Students often select just
 * the core clause of a long claim, or grab a stray "But" at the start.
 */
export const SPAN_MATCH = { withinClaim: 0.7, ofClaim: 0.33 } as const;

/** Ignore leading/trailing whitespace and punctuation when comparing highlights. */
function trimSpan(span: Span, text: string): Span {
  let { start, end } = span;
  const junk = /[\s.,;:!?"'“”‘’()-]/;
  while (start < end && junk.test(text[start])) start++;
  while (end > start && junk.test(text[end - 1])) end--;
  return { segment: span.segment, start, end };
}

/** How well a highlight matches a claim: 0 if it doesn't match, else intersection / union (higher is better). */
export function spanMatch(highlight: Span, claim: Span): number {
  if (highlight.segment !== claim.segment) return 0;
  const inter = Math.min(highlight.end, claim.end) - Math.max(highlight.start, claim.start);
  if (inter <= 0) return 0;
  if (inter / (highlight.end - highlight.start) < SPAN_MATCH.withinClaim) return 0;
  if (inter / (claim.end - claim.start) < SPAN_MATCH.ofClaim) return 0;
  return inter / (Math.max(highlight.end, claim.end) - Math.min(highlight.start, claim.start));
}

/** Matches each student node to the lesson claim its passage text came from. */
export function matchNodes(lesson: Lesson, map: ArgumentMap): { mapping: Record<string, string>; duplicates: string[] } {
  const best: Record<string, { nodeId: string; score: number }> = {};
  for (const node of map.nodes) {
    const passage = lesson.steps[node.source.segment]?.passage ?? '';
    const span = trimSpan(node.source, passage);
    let top: { claimId: string; score: number } | undefined;
    for (const claim of Object.values(lesson.claims)) {
      const score = spanMatch(span, trimSpan(claim.span, passage));
      if (score > 0 && (!top || score > top.score)) top = { claimId: claim.id, score };
    }
    if (!top) continue;
    const prev = best[top.claimId];
    if (!prev || top.score > prev.score) best[top.claimId] = { nodeId: node.id, score: top.score };
  }
  const mapping: Record<string, string> = {};
  for (const [claimId, { nodeId }] of Object.entries(best)) mapping[nodeId] = claimId;
  const duplicates = map.nodes
    .filter((n) => !mapping[n.id])
    .filter((n) => Object.values(lesson.claims).some((c) => spanMatch(n.source, c.span) > 0))
    .map((n) => n.id);
  return { mapping, duplicates };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const intersects = (a: string[], b: string[]) => a.some((x) => b.includes(x));

const truncate = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function gradeAgainst(lesson: Lesson, step: Step, map: ArgumentMap, answer: Answer): GradeResult {
  const { mapping, duplicates } = matchNodes(lesson, map);
  const nodeFor = (claimId: string) => map.nodes.find((n) => mapping[n.id] === claimId);
  const name = (claimId: string) => {
    const claim = lesson.claims[claimId];
    if (lesson.claimMode === 'marked') return `(${claim.number})`;
    return `“${truncate(nodeFor(claimId)?.text ?? claim.modelText)}”`;
  };
  const nodeName = (nodeId: string) => {
    const claimId = mapping[nodeId];
    if (claimId) return name(claimId);
    return `“${truncate(map.nodes.find((n) => n.id === nodeId)?.text ?? '?')}”`;
  };
  const verb = (r: { type: string }) => (r.type === 'support' ? 'supports' : 'objects to');

  const items: GradeItem[] = [];

  // Main conclusion
  const studentConclusion = map.conclusion ? mapping[map.conclusion] : undefined;
  if (!map.conclusion) {
    items.push({ status: 'missing', earned: 0, possible: POINTS.conclusion, message: 'Mark the main conclusion (the ★ button on a claim).' });
  } else if (studentConclusion === answer.conclusion) {
    items.push({ status: 'correct', earned: POINTS.conclusion, possible: POINTS.conclusion, message: `Main conclusion: ${name(answer.conclusion)}.` });
  } else {
    items.push({
      status: 'wrong',
      earned: 0,
      possible: POINTS.conclusion,
      message: `${nodeName(map.conclusion)} is not the main conclusion. Ask: what is the author ultimately trying to get you to accept?`,
    });
  }

  // Claims
  const answerClaims = [...new Set([answer.conclusion, ...answer.relations.flatMap((r) => [...r.from, r.to])])];
  const missingClaims = answerClaims.filter((id) => !nodeFor(id));
  for (const id of answerClaims) {
    if (nodeFor(id)) items.push({ status: 'correct', earned: POINTS.claim, possible: POINTS.claim, message: `Included claim ${name(id)}.` });
  }
  if (missingClaims.length) {
    const message =
      lesson.claimMode === 'marked'
        ? `Missing ${missingClaims.length === 1 ? 'claim' : 'claims'} ${joinNames(missingClaims.map(name))}.`
        : `Your map is missing ${missingClaims.length} ${missingClaims.length === 1 ? 'claim' : 'claims'} from the passage.`;
    items.push({ status: 'missing', earned: 0, possible: POINTS.claim * missingClaims.length, message });
  }

  // Relations
  const student = map.relations.map((r) => ({
    raw: r,
    from: r.from.map((id) => mapping[id]).filter(Boolean) as string[],
    to: mapping[r.to] as string | undefined,
  }));
  const accounted = new Set<MapRelation>();

  for (const key of answer.relations) {
    const premises = joinNames(key.from.map(name));
    const plural = key.from.length > 1;
    const exact = student.find((s) => s.raw.type === key.type && s.to === key.to && sameSet(s.from, key.from));
    if (exact) {
      accounted.add(exact.raw);
      const label = key.type === 'support' ? (plural ? 'support' : 'supports') : plural ? 'object to' : 'objects to';
      items.push({ status: 'correct', earned: POINTS.relation, possible: POINTS.relation, message: `${premises} ${label} ${name(key.to)}.` });
      continue;
    }
    const sameTarget = student.filter((s) => s.to === key.to && intersects(s.from, key.from));
    const grouping = sameTarget.filter((s) => s.raw.type === key.type);
    if (grouping.length) {
      grouping.forEach((s) => accounted.add(s.raw));
      const message =
        plural
          ? `${premises} work together (linked) as one reason for ${name(key.to)}. Combine them into a single link.`
          : `${premises} ${verb(key)} ${name(key.to)} on its own; it should not be linked with other premises.`;
      items.push({ status: 'partial', earned: POINTS.relation / 2, possible: POINTS.relation, message });
      continue;
    }
    if (sameTarget.length) {
      sameTarget.forEach((s) => accounted.add(s.raw));
      items.push({
        status: 'wrong',
        earned: 0,
        possible: POINTS.relation,
        message: `Check whether ${premises} ${plural ? 'give' : 'gives'} a reason for ${name(key.to)} or ${plural ? 'raise' : 'raises'} an objection to it.`,
      });
      continue;
    }
    const wrongTarget = student.filter((s) => s.raw.type === key.type && intersects(s.from, key.from) && s.to !== key.to);
    if (wrongTarget.length) {
      wrongTarget.forEach((s) => accounted.add(s.raw));
      items.push({ status: 'wrong', earned: 0, possible: POINTS.relation, message: `${premises} ${plural ? 'are' : 'is'} connected to the wrong claim. Which claim ${plural ? 'do they' : 'does it'} bear on directly?` });
      continue;
    }
    items.push({ status: 'missing', earned: 0, possible: POINTS.relation, message: `What role ${plural ? 'do' : 'does'} ${premises} play? ${plural ? 'They aren’t' : 'It isn’t'} connected the way the model answer has it.` });
  }

  // Notes (no points) on things the model answer doesn't have
  for (const s of student) {
    if (accounted.has(s.raw)) continue;
    const mistake = step.mistakes.find(
      (m) => m.relation.type === s.raw.type && m.relation.to === s.to && sameSet(m.relation.from, s.from),
    );
    const message =
      mistake?.message ??
      `The model answer has no link where ${joinNames(s.raw.from.map(nodeName))} ${verb(s.raw)} ${nodeName(s.raw.to)}.`;
    items.push({ status: 'note', earned: 0, possible: 0, message });
  }
  for (const node of map.nodes) {
    const claimId = mapping[node.id];
    if (duplicates.includes(node.id)) {
      items.push({ status: 'note', earned: 0, possible: 0, message: `${nodeName(node.id)} repeats a claim already in your map.` });
    } else if (!claimId) {
      items.push({ status: 'note', earned: 0, possible: 0, message: `${nodeName(node.id)} doesn't match a claim in the passage. Is it background or commentary rather than part of the argument?` });
    } else if (!answerClaims.includes(claimId)) {
      items.push({ status: 'note', earned: 0, possible: 0, message: `${name(claimId)} isn't part of the argument in the model answer.` });
    }
  }

  const earned = items.reduce((sum, i) => sum + i.earned, 0);
  const possible = items.reduce((sum, i) => sum + i.possible, 0);
  return { earned, possible, items, mapping };
}

/** Grades a student's map for one step against every acceptable answer and returns the best result. */
export function gradeStep(lesson: Lesson, stepIndex: number, map: ArgumentMap): GradeResult {
  const step = lesson.steps[stepIndex];
  const results = step.answers.map((a) => gradeAgainst(lesson, step, map, a));
  return results.reduce((best, r) => (r.earned / r.possible > best.earned / best.possible ? r : best));
}
