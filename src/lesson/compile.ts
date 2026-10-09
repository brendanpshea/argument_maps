import { parse as parseYaml } from 'yaml';
import { lessonFileSchema, type AnswerFile, type RelationTypeFile } from './schema';
import { parsePassage } from './passage';
import type { Answer, Claim, Lesson, RelationType, Step } from '../model/types';

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

    steps.push({
      title: stepFile.title,
      instructions: stepFile.instructions.trim(),
      passage: passage.text,
      answers: [
        toAnswer(stepFile.answer, 'answer'),
        ...(stepFile.alternatives ?? []).map((a, i) => toAnswer(a, `alternative ${i + 1}`)),
      ],
      mistakes: (stepFile.mistakes ?? []).map((m) => ({
        message: m.message,
        relation: { type: relationType(m.relation.type), from: m.relation.from, to: m.relation.to },
      })),
    });
  });

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
