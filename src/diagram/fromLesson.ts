import { isBank, type Lesson } from '../model/types';
import type { Diagram } from './model';

/**
 * The model map of a lesson as a diagram. `stepNumber` (1-based) picks a step;
 * by default, the last structure or evaluate step. Evaluate steps include their
 * expected evaluations as badges.
 */
export function diagramFromLesson(lesson: Lesson, stepNumber?: number): { diagram?: Diagram; error?: string } {
  const index =
    stepNumber !== undefined
      ? stepNumber - 1
      : lesson.steps.map((s, i) => (s.task === 'structure' || s.task === 'evaluate' ? i : -1)).filter((i) => i >= 0).pop()!;
  const step = lesson.steps[index];
  if (!step) return { error: `lesson "${lesson.id}" has no step ${stepNumber}` };
  const answer = step.answers[0];
  const ids = [...new Set([answer.conclusion, ...answer.relations.flatMap((r) => [...r.from, r.to[0]])])];
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return {
    diagram: {
      kind: lesson.kind,
      conclusion: answer.conclusion,
      claims: ids.map((id) => {
        const claim = lesson.claims[id];
        // Passage claims are often quoted mid-sentence ("the butler is the thief"); capitalise for display.
        const text = claim.modelText.charAt(0).toUpperCase() + claim.modelText.slice(1);
        return { id, text, tag: isBank(claim.source) ? 'unstated' : undefined, step: 1 };
      }),
      links: answer.relations.map((r) => {
        const key = step.evaluations.find((e) => e.to === r.to[0] && sameSet(e.from, r.from));
        return {
          type: r.type,
          from: r.from,
          to: r.to[0],
          evaluation: key ? { type: key.type, quality: key.quality[0] } : undefined,
          step: 1,
        };
      }),
    },
  };
}
