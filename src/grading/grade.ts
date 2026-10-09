import { vocab } from '../model/vocab';
import { isBank, type Answer, type ArgumentMap, type ClaimSource, type EvaluationKey, type Lesson, type MapRelation, type Span, type Step } from '../model/types';

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

export const POINTS = { conclusion: 2, claim: 1, relation: 2, wording: 1 } as const;

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

/** The claim a node came from, with a match score (higher is better). */
function candidateClaim(lesson: Lesson, source: ClaimSource): { claimId: string; score: number } | undefined {
  if (isBank(source)) return lesson.claims[source.bank] ? { claimId: source.bank, score: 1 } : undefined;
  const passage = lesson.steps[source.segment]?.passage ?? '';
  const span = trimSpan(source, passage);
  let top: { claimId: string; score: number } | undefined;
  for (const claim of Object.values(lesson.claims)) {
    if (isBank(claim.source)) continue;
    const score = spanMatch(span, trimSpan(claim.source, passage));
    if (score > 0 && (!top || score > top.score)) top = { claimId: claim.id, score };
  }
  return top;
}

/** The representative of a claim's `equivalent` set (or the claim itself). */
export const canonical = (lesson: Lesson, claimId: string) => lesson.equivalent[claimId] ?? claimId;

/**
 * Matches each student node to the lesson claim it came from (passage text or claim bank).
 * At most one node is matched per claim, counting equivalent claims as the same claim;
 * any others are reported as duplicates.
 */
export function matchNodes(lesson: Lesson, map: ArgumentMap): { mapping: Record<string, string>; duplicates: string[] } {
  const best: Record<string, { nodeId: string; claimId: string; score: number }> = {};
  const matched = new Set<string>();
  for (const node of map.nodes) {
    const top = candidateClaim(lesson, node.source);
    if (!top) continue;
    matched.add(node.id);
    const key = canonical(lesson, top.claimId);
    const prev = best[key];
    if (!prev || top.score > prev.score) best[key] = { nodeId: node.id, claimId: top.claimId, score: top.score };
  }
  const mapping: Record<string, string> = {};
  for (const { nodeId, claimId } of Object.values(best)) mapping[nodeId] = claimId;
  const duplicates = map.nodes.filter((n) => matched.has(n.id) && !mapping[n.id]).map((n) => n.id);
  return { mapping, duplicates };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const intersects = (a: string[], b: string[]) => a.some((x) => b.includes(x));

const truncate = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** An answer with every claim id replaced by its canonical id, so equivalent claims are interchangeable. */
function canonicalAnswer(lesson: Lesson, raw: Answer) {
  const canon = (id: string) => canonical(lesson, id);
  return {
    conclusion: canon(raw.conclusion),
    relations: raw.relations.map((r) => ({ ...r, from: uniq(r.from.map(canon)), to: uniq(r.to.map(canon)) })),
  };
}

/** The claims a student must have for this answer (canonical ids). */
function requiredClaims(answer: ReturnType<typeof canonicalAnswer>) {
  return uniq([
    answer.conclusion,
    ...answer.relations.filter((r) => !r.optional).flatMap((r) => [...r.from, ...(r.to.length === 1 ? r.to : [])]),
  ]);
}

/** Helpers for finding a claim's node and naming it in feedback. */
function namer(lesson: Lesson, map: ArgumentMap, mapping: Record<string, string>) {
  const canon = (id: string) => canonical(lesson, id);
  const nodeFor = (claimId: string) => map.nodes.find((n) => mapping[n.id] && canon(mapping[n.id]) === claimId);
  const name = (claimId: string) => {
    const node = nodeFor(claimId);
    const claim = lesson.claims[node ? mapping[node.id] : claimId];
    if (lesson.claimMode === 'marked' && !isBank(claim.source)) return `(${claim.number})`;
    return `“${truncate(node?.text ?? claim.modelText)}”`;
  };
  const nodeName = (nodeId: string) => {
    const claimId = mapping[nodeId];
    if (claimId) return name(claimId);
    return `“${truncate(map.nodes.find((n) => n.id === nodeId)?.text ?? '?')}”`;
  };
  return { canon, nodeFor, name, nodeName };
}

/** Wording is scored in reword steps if the lesson has any; otherwise alongside the structure. */
export const hasRewordStep = (lesson: Lesson) => lesson.steps.some((s) => s.task === 'reword');

/** For each link in the map that this (evaluate) step asks about, its expected evaluation. */
export function evaluationKeys(lesson: Lesson, step: Step, map: ArgumentMap): Map<string, EvaluationKey> {
  const { mapping } = matchNodes(lesson, map);
  const canon = (id: string) => canonical(lesson, id);
  const keys = new Map<string, EvaluationKey>();
  for (const r of map.relations) {
    if (r.type !== 'support' || !mapping[r.to]) continue;
    const from = uniq(r.from.filter((f) => mapping[f]).map((f) => canon(mapping[f])));
    const key = step.evaluations.find((k) => canon(mapping[r.to]) === canon(k.to) && sameSet(from, uniq(k.from.map(canon))));
    if (key) keys.set(r.id, key);
  }
  return keys;
}

/** The step's expected evaluations applied to a map (first acceptable quality), e.g. for the model answer. */
export function withKeyEvaluations(lesson: Lesson, step: Step, map: ArgumentMap): ArgumentMap {
  const keys = evaluationKeys(lesson, step, map);
  return {
    ...map,
    relations: map.relations.map((r) => {
      const key = keys.get(r.id);
      return key ? { ...r, evaluation: { type: key.type, quality: key.quality[0] } } : r;
    }),
  };
}

function wordingItems(lesson: Lesson, map: ArgumentMap, mapping: Record<string, string>, claimIds: string[]): GradeItem[] {
  const { nodeFor, name } = namer(lesson, map, mapping);
  const items: GradeItem[] = [];
  for (const id of claimIds) {
    const node = nodeFor(id);
    const choices = node && lesson.claims[mapping[node.id]].wordingChoices;
    if (!node || !choices) continue;
    const chosen = choices.find((c) => c.text === node.text);
    if (chosen === choices[0]) {
      items.push({ status: 'correct', earned: POINTS.wording, possible: POINTS.wording, message: `Clear wording for ${name(id)}.` });
    } else if (chosen) {
      items.push({ status: 'wrong', earned: 0, possible: POINTS.wording, message: `Wording of ${name(id)}: ${chosen.why ?? 'there is a clearer, more accurate wording.'}` });
    } else {
      items.push({ status: 'missing', earned: 0, possible: POINTS.wording, message: `Choose the clearest wording for ${name(id)} (the ✎ button).` });
    }
  }
  return items;
}

const total = (items: GradeItem[], mapping: Record<string, string>): GradeResult => ({
  earned: items.reduce((sum, i) => sum + i.earned, 0),
  possible: items.reduce((sum, i) => sum + i.possible, 0),
  items,
  mapping,
});

/** A reword step: the map is fixed, so only wording counts. */
function gradeWording(lesson: Lesson, map: ArgumentMap, raw: Answer): GradeResult {
  const { mapping } = matchNodes(lesson, map);
  if (lesson.rewording === 'free') {
    // Free wording can't be scored; checking reveals the model wording to compare against.
    return total([{ status: 'correct', earned: 1, possible: 1, message: 'Compare your wording with the model wording below.' }], mapping);
  }
  const items = wordingItems(lesson, map, mapping, requiredClaims(canonicalAnswer(lesson, raw)));
  if (!items.length) items.push({ status: 'correct', earned: 1, possible: 1, message: 'No claims to reword here.' });
  return total(items, mapping);
}

/** A conclusion step: did the student pick the main conclusion? Wrong picks get a hint based on the claim's role. */
function gradeConclusion(lesson: Lesson, step: Step, map: ArgumentMap): GradeResult {
  const { mapping } = matchNodes(lesson, map);
  const { canon, nodeName } = namer(lesson, map, mapping);
  const one = (status: ItemStatus, earned: number, message: string) => total([{ status, earned, possible: 1, message }], mapping);
  const V = vocab(lesson.kind);
  if (!map.conclusion) return one('missing', 0, `Pick the claim you think is the ${V.conclusion}${V.conclusionGloss}.`);
  const claimId = mapping[map.conclusion];
  if (!claimId) return one('wrong', 0, `${nodeName(map.conclusion)} doesn't match a claim in the passage. Select the whole claim.`);
  const picked = canon(claimId);
  if (step.answers.some((a) => canon(a.conclusion) === picked)) return one('correct', 1, `Yes: ${nodeName(map.conclusion)} is the ${V.conclusion}.`);

  const custom = step.conclusionHints[claimId] ?? step.conclusionHints[picked];
  if (custom) return one('wrong', 0, custom);
  const answer = canonicalAnswer(lesson, step.answers[0]);
  // Explanation links play the same role as support links here.
  const premiseOf = (type: 'support' | 'objection') =>
    answer.relations.filter((r) => (type === 'objection' ? r.type === 'objection' : r.type !== 'objection') && r.from.includes(picked));
  const objectionPremises = answer.relations.filter((r) => r.type === 'objection').flatMap((r) => r.from);
  const objections = premiseOf('objection');
  const supported = answer.relations.some((r) => r.to.includes(picked));
  const subject = nodeName(map.conclusion);
  let hint: string;
  if (objections.some((r) => r.to.some((t) => objectionPremises.includes(t)))) {
    hint = `${subject} answers an objection. What is the author's overall point?`;
  } else if (objections.length) {
    hint = `Is ${subject} the author's view, or a view the author is responding to?`;
  } else if (premiseOf('support').length && supported) {
    hint = V.pickedIntermediate(subject);
  } else if (premiseOf('support').length) {
    hint = V.pickedPremise(subject);
  } else {
    hint = V.pickedBackground(subject);
  }
  return one('wrong', 0, hint);
}

/** An evaluate step: is each evaluated support link classified (and judged) correctly? */
function gradeEvaluation(lesson: Lesson, step: Step, map: ArgumentMap): GradeResult {
  const { mapping } = matchNodes(lesson, map);
  const { nodeName } = namer(lesson, map, mapping);
  const items: GradeItem[] = [];
  const keys = evaluationKeys(lesson, step, map);
  for (const key of step.evaluations) {
    const rel = map.relations.find((r) => keys.get(r.id) === key);
    if (!rel) continue; // e.g. an optional link the student left out
    const link = `${joinNames(rel.from.map(nodeName))} → ${nodeName(rel.to)}`;
    const premises = rel.from.length > 1 ? 'the premises' : 'the premise';
    const given = rel.evaluation ?? {};
    const gradeQuality = step.ask === 'full' && key.quality.length > 0;
    if (!given.type) {
      items.push({ status: 'missing', earned: 0, possible: 1 + (gradeQuality ? 1 : 0), message: `Evaluate the link ${link}.` });
      continue;
    }
    if (given.type !== key.type) {
      items.push({
        status: 'wrong',
        earned: 0,
        possible: 1 + (gradeQuality ? 1 : 0),
        message:
          key.hint ??
          `${link}: is the arguer claiming that ${premises} guarantee the conclusion, or only that they make it likely? Look at the words that introduce it.`,
      });
      continue;
    }
    items.push({ status: 'correct', earned: 1, possible: 1, message: `${link}: ${key.type}.` });
    if (!gradeQuality) continue;
    if (!given.quality) {
      items.push({ status: 'missing', earned: 0, possible: 1, message: `${link}: you classified it; now judge how good the reasoning is.` });
    } else if (key.quality.includes(given.quality)) {
      items.push({ status: 'correct', earned: 1, possible: 1, message: `${link}: ${given.quality}.` });
    } else {
      const auto =
        key.type === 'deductive'
          ? `${link}: imagine ${premises} true. Could the conclusion still be false? If not, it's valid; if so, it's invalid.`
          : `${link}: if ${premises} were true, how likely would the conclusion be? Could something else easily explain ${rel.from.length > 1 ? 'them' : 'it'}?`;
      items.push({ status: 'wrong', earned: 0, possible: 1, message: key.hint ?? auto });
    }
  }
  if (!items.length) items.push({ status: 'correct', earned: 1, possible: 1, message: 'No links to evaluate here.' });
  return total(items, mapping);
}

function gradeAgainst(lesson: Lesson, step: Step, map: ArgumentMap, rawAnswer: Answer): GradeResult {
  const { mapping, duplicates } = matchNodes(lesson, map);
  const { canon, nodeFor, name, nodeName } = namer(lesson, map, mapping);
  const answer = canonicalAnswer(lesson, rawAnswer);
  const V = vocab(lesson.kind);
  const verb = (r: { type: string }) => (r.type === 'support' ? 'supports' : r.type === 'explanation' ? 'explains' : 'objects to');

  const items: GradeItem[] = [];

  // Main conclusion
  const studentConclusion = map.conclusion && mapping[map.conclusion] ? canon(mapping[map.conclusion]) : undefined;
  if (!map.conclusion) {
    items.push({ status: 'missing', earned: 0, possible: POINTS.conclusion, message: `Mark the ${V.conclusion}${V.conclusionGloss} (the ★ button on a claim).` });
  } else if (studentConclusion === answer.conclusion) {
    items.push({ status: 'correct', earned: POINTS.conclusion, possible: POINTS.conclusion, message: `${V.Conclusion}: ${name(answer.conclusion)}.` });
  } else {
    items.push({
      status: 'wrong',
      earned: 0,
      possible: POINTS.conclusion,
      message: `${nodeName(map.conclusion)} is not the ${V.conclusion}. Ask: ${V.conclusionQuestion}`,
    });
  }

  // Claims
  // Required: the conclusion, the premises of required links, and targets that have no alternative.
  const answerClaims = requiredClaims(answer);
  // Anything the answer mentions at all (optional links, alternative targets) is part of the argument.
  const argumentClaims = uniq([answer.conclusion, ...answer.relations.flatMap((r) => [...r.from, ...r.to])]);
  const missing = answerClaims.filter((id) => !nodeFor(id));
  const missingBank = missing.filter((id) => isBank(lesson.claims[id].source));
  const missingPassage = missing.filter((id) => !missingBank.includes(id));
  const claims = (n: number) => `${n} ${n === 1 ? 'claim' : 'claims'}`;
  for (const id of answerClaims) {
    if (nodeFor(id)) items.push({ status: 'correct', earned: POINTS.claim, possible: POINTS.claim, message: `Included claim ${name(id)}.` });
  }
  if (missingPassage.length) {
    const message =
      lesson.claimMode === 'marked'
        ? `Your map is missing ${claims(missingPassage.length)} from the passage. ${V.findClaims}`
        : `Your map is missing ${claims(missingPassage.length)} from the passage.`;
    items.push({ status: 'missing', earned: 0, possible: POINTS.claim * missingPassage.length, message });
  }
  if (missingBank.length) {
    items.push({
      status: 'missing',
      earned: 0,
      possible: POINTS.claim * missingBank.length,
      message: `The argument relies on ${claims(missingBank.length)} the author didn't state. Look in the claim bank.`,
    });
  }

  // Wording (only when students choose from the author's wordings, and the lesson has no reword step)
  if (lesson.rewording === 'choose' && !hasRewordStep(lesson)) items.push(...wordingItems(lesson, map, mapping, answerClaims));

  // Relations
  const student = map.relations.map((r) => ({
    raw: r,
    from: uniq(r.from.filter((id) => mapping[id]).map((id) => canon(mapping[id]))),
    to: mapping[r.to] ? canon(mapping[r.to]) : undefined,
  }));
  const accounted = new Set<MapRelation>();

  // Feedback names only claims the student already has on their map, and never
  // says what the correct link is: it points at where to look again.
  const studentNames = (ids: string[]) => {
    const present = ids.filter((id) => nodeFor(id));
    return { names: joinNames(present.map(name)), plural: present.length > 1, count: present.length };
  };
  let unseenLinks = 0;
  const unconnected = { ids: new Set<string>(), points: 0 };

  /** Student links that express `key` with target `t`, or null if they don't (yet). */
  const expresses = (key: (typeof answer.relations)[number], t: string) => {
    const exact = student.find((x) => x.raw.type === key.type && x.to === t && sameSet(x.from, key.from));
    if (exact) return [exact];
    if (key.grouping !== 'either') return null;
    // Any grouping: the student's links to t must split the premises into disjoint groups covering them all.
    const parts = student.filter((x) => x.raw.type === key.type && x.to === t && x.from.length && x.from.every((f) => key.from.includes(f)));
    const covered = parts.flatMap((x) => x.from);
    return covered.length === key.from.length && sameSet(covered, key.from) ? parts : null;
  };

  for (const key of answer.relations) {
    const match = key.to.map((t) => expresses(key, t)).find(Boolean);
    if (match) {
      match.forEach((x) => accounted.add(x.raw));
      const points = key.optional ? 0 : POINTS.relation;
      items.push({ status: 'correct', earned: points, possible: points, message: `Correct link to ${name(match[0].to!)}.` });
      continue;
    }
    // Optional links are never required, and a wrong version of one is noted below like any other extra link.
    if (key.optional) continue;
    const touched = (rels: typeof student) => studentNames(key.from.filter((id) => rels.some((s) => s.from.includes(id))));
    const sameTarget = student.filter((s) => s.to !== undefined && key.to.includes(s.to) && intersects(s.from, key.from));
    const grouping = sameTarget.filter((s) => s.raw.type === key.type);
    if (grouping.length && key.grouping === 'either') {
      // Any grouping is fine here, so what's wrong is a premise that's missing or extra.
      grouping.forEach((s) => accounted.add(s.raw));
      items.push({
        status: 'partial',
        earned: POINTS.relation / 2,
        possible: POINTS.relation,
        message: `Your links to ${name(grouping[0].to!)} are on the right track. Check that ${V.everyReason} is connected, and nothing that isn't.`,
      });
      continue;
    }
    if (grouping.length) {
      grouping.forEach((s) => accounted.add(s.raw));
      const { names, plural } = touched(grouping);
      items.push({
        status: 'partial',
        earned: POINTS.relation / 2,
        possible: POINTS.relation,
        message: `Look again at how ${names} ${plural ? 'connect' : 'connects'} to ${name(grouping[0].to!)}: ${V.groupingQuestion}`,
      });
      continue;
    }
    if (sameTarget.length) {
      sameTarget.forEach((s) => accounted.add(s.raw));
      const { names, plural } = touched(sameTarget);
      items.push({
        status: 'wrong',
        earned: 0,
        possible: POINTS.relation,
        message: `Check whether ${names} ${plural ? 'give' : 'gives'} a reason for ${name(sameTarget[0].to!)} or ${plural ? 'raise' : 'raises'} an objection to it.`,
      });
      continue;
    }
    const wrongTarget = student.filter((s) => s.raw.type === key.type && intersects(s.from, key.from) && !(s.to && key.to.includes(s.to)));
    if (wrongTarget.length) {
      wrongTarget.forEach((s) => accounted.add(s.raw));
      const { names, plural } = touched(wrongTarget);
      items.push({
        status: 'wrong',
        earned: 0,
        possible: POINTS.relation,
        message: `${names} ${plural ? 'are' : 'is'} connected to the wrong claim. Which claim ${plural ? 'do they' : 'does it'} bear on most directly?`,
      });
      continue;
    }
    const present = key.from.filter((id) => nodeFor(id));
    if (!present.length) unseenLinks++;
    else {
      unconnected.points += POINTS.relation;
      present.forEach((id) => unconnected.ids.add(id));
    }
  }
  // One combined message, so the grouping of premises isn't given away.
  if (unconnected.ids.size) {
    const { names, plural } = studentNames([...unconnected.ids]);
    items.push({
      status: 'missing',
      earned: 0,
      possible: unconnected.points,
      message: `What role ${plural ? 'do' : 'does'} ${names} play in the argument? Check ${plural ? 'their' : 'its'} links.`,
    });
  }
  if (unseenLinks) {
    items.push({
      status: 'missing',
      earned: 0,
      possible: POINTS.relation * unseenLinks,
      message: `${unseenLinks === 1 ? 'A link involves a claim' : `${unseenLinks} links involve claims`} that ${unseenLinks === 1 ? "isn't" : "aren't"} on your map yet.`,
    });
  }

  // Notes (no points) on things the model answer doesn't have
  const explained = new Set<string>();
  for (const s of student) {
    if (accounted.has(s.raw)) continue;
    const mistake = step.mistakes.find(
      (m) => m.relation.type === s.raw.type && canon(m.relation.to) === s.to && sameSet(m.relation.from.map(canon), s.from),
    );
    const message =
      mistake?.message ??
      `Reconsider the link where ${joinNames(s.raw.from.map(nodeName))} ${verb(s.raw)} ${nodeName(s.raw.to)}. It doesn't fit the argument.`;
    if (mistake) s.from.forEach((id) => explained.add(id));
    items.push({ status: 'note', earned: 0, possible: 0, message });
  }
  for (const node of map.nodes) {
    const claimId = mapping[node.id];
    if (duplicates.includes(node.id)) {
      items.push({ status: 'note', earned: 0, possible: 0, message: `${nodeName(node.id)} repeats a claim already in your map.` });
    } else if (!claimId) {
      items.push({ status: 'note', earned: 0, possible: 0, message: `${nodeName(node.id)} doesn't match a claim in the passage. Is it background or commentary rather than part of the argument?` });
    } else if (!argumentClaims.includes(canon(claimId)) && !explained.has(canon(claimId))) {
      items.push({ status: 'note', earned: 0, possible: 0, message: V.notPart(name(claimId)) });
    }
  }

  return total(items, mapping);
}

/** Grades a student's map for one step against every acceptable answer and returns the best result. */
export function gradeStep(lesson: Lesson, stepIndex: number, map: ArgumentMap): GradeResult {
  const step = lesson.steps[stepIndex];
  if (step.task === 'conclusion') return gradeConclusion(lesson, step, map);
  if (step.task === 'evaluate') return gradeEvaluation(lesson, step, map);
  const grade = step.task === 'reword' ? (a: Answer) => gradeWording(lesson, map, a) : (a: Answer) => gradeAgainst(lesson, step, map, a);
  const fraction = (r: GradeResult) => (r.possible ? r.earned / r.possible : 0);
  return step.answers.map(grade).reduce((best, r) => (fraction(r) > fraction(best) ? r : best));
}
