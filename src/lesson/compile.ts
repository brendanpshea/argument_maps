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

  file.steps.forEach((stepFile, segment) => {
    const passage = parsePassage(stepFile.passage);
    for (const c of passage.claims) {
      if (claims[c.id]) fail(`claim "${c.id}" is marked more than once`);
      claims[c.id] = {
        id: c.id,
        number: Object.keys(claims).length + 1,
        passageText: c.text,
        modelText: file.modelWording?.[c.id] ?? c.text,
        span: { segment, start: c.start, end: c.end },
      };
    }

    const toAnswer = (a: AnswerFile, label: string): Answer => {
      const check = (id: string) => {
        if (!claims[id]) fail(`step ${segment + 1} ${label} refers to "${id}", which is not marked in this or an earlier step`);
      };
      check(a.conclusion);
      for (const r of a.relations) {
        r.from.forEach(check);
        check(r.to);
      }
      return {
        conclusion: a.conclusion,
        relations: a.relations.map((r) => ({ type: relationType(r.type), from: [...r.from], to: r.to })),
      };
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

  for (const id of Object.keys(file.modelWording ?? {})) {
    if (!claims[id]) fail(`modelWording has "${id}", which is not marked in the passage`);
  }

  return {
    id: file.id,
    title: file.title,
    description: file.description?.trim(),
    claimMode: file.claimMode,
    claims,
    steps,
  };
}
