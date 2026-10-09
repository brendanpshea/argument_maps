import { parse as parseYaml } from 'yaml';
import { lessonFileSchema, type AnswerFile, type RelationTypeFile } from './schema';
import { parsePassage } from './passage';
import { isBank, QUALITIES, type Answer, type Claim, type Lesson, type RelationType, type Step } from '../model/types';

const relationType = (t: RelationTypeFile): RelationType => (t === 'support' ? 'support' : 'objection');

/** Parses and validates a lesson YAML file. Throws with a readable message on any problem. */
export function compileLesson(yamlSource: string, fileName = 'lesson'): Lesson {
  const parsed = lessonFileSchema.safeParse(parseYaml(yamlSource));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`${fileName}: invalid lesson\n${issues}`);
  }
  const file = parsed.data;
  const claims: Record<string, Claim> = {};
  const steps: Step[] = [];
  const fail = (msg: string): never => {
    throw new Error(`${fileName}: ${msg}`);
  };

  let passageClaims = 0;
  for (const b of file.bank ?? []) {
    if ((b.step ?? 1) > file.steps.length) fail(`bank claim "${b.id}" is offered at step ${b.step}, but there are only ${file.steps.length} steps`);
  }

  file.steps.forEach((stepFile, segment) => {
    const passage = parsePassage(stepFile.passage);
    for (const c of passage.claims) {
      if (claims[c.id]) fail(`claim "${c.id}" is marked more than once`);
      const choices = file.wordingChoices?.[c.id];
      claims[c.id] = {
        id: c.id,
        number: ++passageClaims,
        passageText: c.text,
        modelText: choices?.best ?? file.modelWording?.[c.id] ?? c.text,
        source: { segment, start: c.start, end: c.end },
        wordingChoices: choices && [{ text: choices.best }, ...choices.others],
      };
    }
    for (const b of (file.bank ?? []).filter((b) => (b.step ?? 1) - 1 === segment)) {
      if (claims[b.id]) fail(`claim "${b.id}" is defined more than once`);
      claims[b.id] = {
        id: b.id,
        number: 0,
        passageText: b.text.trim(),
        modelText: b.text.trim(),
        source: { bank: b.id },
        bankStep: segment,
      };
    }

    const toAnswer = (a: AnswerFile, label: string): Answer => {
      const check = (id: string) => {
        if (!claims[id]) fail(`step ${segment + 1} ${label} refers to "${id}", which is not marked in this or an earlier step`);
      };
      check(a.conclusion);
      const relations = a.relations.map((r) => ({
        type: relationType(r.type),
        from: [...r.from],
        to: Array.isArray(r.to) ? [...r.to] : [r.to],
        grouping: r.grouping,
        optional: r.optional,
      }));
      for (const r of relations) {
        r.from.forEach(check);
        r.to.forEach(check);
        if (r.from.some((f) => r.to.includes(f))) fail(`step ${segment + 1} ${label}: a claim can't bear on itself`);
      }
      return { conclusion: a.conclusion, relations };
    };

    const structure = stepFile.task === 'structure';
    if (structure && !stepFile.answer) fail(`step ${segment + 1} needs an answer`);
    if (!structure && (stepFile.answer || stepFile.alternatives || stepFile.mistakes)) {
      fail(`step ${segment + 1} is a ${stepFile.task} step, which takes its answer from a structure step; remove answer/alternatives/mistakes`);
    }
    if (stepFile.conclusionHints && stepFile.task !== 'conclusion') fail(`step ${segment + 1}: conclusionHints only apply to conclusion steps`);
    const evaluate = stepFile.task === 'evaluate';
    if (!evaluate && (stepFile.evaluations || stepFile.ask)) fail(`step ${segment + 1}: evaluations and ask only apply to evaluate steps`);
    if (evaluate && !stepFile.evaluations?.length) fail(`step ${segment + 1} is an evaluate step but lists no evaluations`);
    const evaluations = (stepFile.evaluations ?? []).map((e, k) => {
      const quality = e.quality === undefined ? [] : Array.isArray(e.quality) ? e.quality : [e.quality];
      const allowed = QUALITIES[e.type];
      for (const q of quality) {
        if (!allowed.includes(q)) fail(`step ${segment + 1} evaluation ${k + 1}: a ${e.type} link is ${allowed.join(' or ')}, not ${q}`);
      }
      return { from: e.link.from, to: e.link.to, type: e.type, quality, hint: e.hint };
    });
    for (const id of Object.keys(stepFile.conclusionHints ?? {})) {
      if (!claims[id]) fail(`step ${segment + 1} conclusionHints has "${id}", which is not a claim in this or an earlier step`);
    }
    steps.push({
      title: stepFile.title,
      task: stepFile.task,
      instructions: stepFile.instructions.trim(),
      passage: passage.text,
      answers: structure
        ? [toAnswer(stepFile.answer!, 'answer'), ...(stepFile.alternatives ?? []).map((a, i) => toAnswer(a, `alternative ${i + 1}`))]
        : [],
      conclusionHints: stepFile.conclusionHints ?? {},
      ask: stepFile.ask ?? 'full',
      evaluations,
      mistakes: (stepFile.mistakes ?? []).map((m) => ({
        message: m.message,
        relation: { type: relationType(m.relation.type), from: m.relation.from, to: m.relation.to },
      })),
    });
  });

  // Conclusion steps grade against the next structure step; reword and evaluate steps against the previous one.
  steps.forEach((step, i) => {
    if (step.task === 'structure') return;
    const source =
      step.task === 'conclusion'
        ? steps.slice(i + 1).find((s) => s.task === 'structure')
        : steps.slice(0, i).reverse().find((s) => s.task === 'structure');
    if (!source) {
      fail(`step ${i + 1} is a ${step.task} step but has no structure step ${step.task === 'conclusion' ? 'after' : 'before'} it`);
    }
    step.answers = source!.answers;
  });
  steps.forEach((step, i) => {
    if (step.task !== 'conclusion') return;
    for (const a of step.answers) {
      const c = claims[a.conclusion];
      const introduced = isBank(c.source) ? c.bankStep! : c.source.segment;
      if (introduced > i) fail(`step ${i + 1} asks for the main conclusion, but "${a.conclusion}" only appears in step ${introduced + 1}`);
    }
  });
  // Each evaluated link must be a fixed-grouping support link in the answer being evaluated.
  steps.forEach((step, i) => {
    for (const e of step.evaluations) {
      const label = `step ${i + 1}: evaluated link ${e.from.join(' + ')} → ${e.to}`;
      [...e.from, e.to].forEach((id) => claims[id] || fail(`${label} refers to "${id}", which is not a claim in this lesson`));
      for (const a of step.answers) {
        const rel = a.relations.find((r) => r.to.includes(e.to) && r.from.length === e.from.length && r.from.every((f) => e.from.includes(f)));
        if (!rel) fail(`${label} is not a link in the answer being evaluated`);
        if (rel!.type !== 'support') fail(`${label} is an objection; only support links are evaluated`);
        if (rel!.grouping === 'either') fail(`${label} has \`grouping: either\`; evaluated links need a fixed grouping`);
      }
    }
  });
  if (file.rewording === 'none' && steps.some((s) => s.task === 'reword')) {
    fail('a reword step needs `rewording: free` or `rewording: choose`');
  }

  for (const [field, ids] of [
    ['modelWording', Object.keys(file.modelWording ?? {})],
    ['wordingChoices', Object.keys(file.wordingChoices ?? {})],
  ] as const) {
    for (const id of ids) {
      if (!claims[id] || claims[id].bankStep !== undefined) fail(`${field} has "${id}", which is not marked in the passage`);
    }
  }
  const equivalent: Record<string, string> = {};
  for (const group of file.equivalent ?? []) {
    for (const id of group) {
      if (!claims[id]) fail(`equivalent lists "${id}", which is not a claim in this lesson`);
      if (equivalent[id]) fail(`claim "${id}" appears in more than one equivalent set`);
      equivalent[id] = group[0];
    }
  }
  if (file.wordingChoices && file.rewording !== 'choose') {
    fail('wordingChoices are only used with `rewording: choose`');
  }

  return {
    id: file.id,
    title: file.title,
    description: file.description?.trim(),
    claimMode: file.claimMode,
    rewording: file.rewording,
    claims,
    equivalent,
    steps,
  };
}
