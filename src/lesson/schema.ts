import { z } from 'zod';

/**
 * The on-disk lesson format (YAML in `lessons/`). See `lessons/README.md`
 * for an author-facing description.
 */

const claimId = z.string().regex(/^[A-Za-z][\w-]*$/, 'claim ids must start with a letter');

/** `objection` and `rebuttal` are the same relation (an attack); authors may use either word. */
export const relationTypeSchema = z.enum(['support', 'objection', 'rebuttal']);

export const answerRelationSchema = z.object({
  type: relationTypeSchema,
  /** Several premises = a linked argument; separate relations = convergent. */
  from: z.array(claimId).min(1),
  to: claimId,
});

export const answerSchema = z.object({
  conclusion: claimId,
  relations: z.array(answerRelationSchema),
});

export const mistakeSchema = z.object({
  /** Shown when the student's map contains exactly this relation. */
  relation: answerRelationSchema,
  message: z.string(),
});

export const stepSchema = z.object({
  title: z.string().optional(),
  instructions: z.string(),
  /** Text added to the passage at this step. Claims are marked `{{id|text}}`. */
  passage: z.string(),
  /** The full model map after this step (cumulative, not a diff). */
  answer: answerSchema,
  /** Other maps that also earn full credit; the best-scoring one is used. */
  alternatives: z.array(answerSchema).optional(),
  mistakes: z.array(mistakeSchema).optional(),
});

export const lessonFileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'lesson ids must be lowercase-with-dashes'),
  title: z.string(),
  description: z.string().optional(),
  /**
   * `marked`: claims are numbered in the passage and students click them.
   * `highlight`: the passage is plain text; students select the claims themselves.
   */
  claimMode: z.enum(['marked', 'highlight']).default('marked'),
  /**
   * How students may restate claims on their map:
   * `none` (passage wording only), `free` (type freely; not scored),
   * `choose` (pick from `wordingChoices`; scored).
   */
  rewording: z.enum(['none', 'free', 'choose']).default('free'),
  /** For `rewording: choose`: the best wording of a claim plus plausible but flawed alternatives. */
  wordingChoices: z
    .record(
      z.string(),
      z.object({
        best: z.string(),
        others: z.array(z.object({ text: z.string(), why: z.string().optional() })).min(1),
      }),
    )
    .optional(),
  /**
   * Claims that are not in the passage: unstated premises the argument
   * needs, and decoys it doesn't. Students add them from the claim bank.
   */
  bank: z
    .array(
      z.object({
        id: claimId,
        text: z.string(),
        /** First step (1-based) in which the claim is offered. Defaults to 1. */
        step: z.number().int().min(1).optional(),
      }),
    )
    .optional(),
  /**
   * Clearer or stronger statements of claims, keyed by claim id. Shown next
   * to the student's own wording when they check their work.
   */
  modelWording: z.record(z.string(), z.string()).optional(),
  steps: z.array(stepSchema).min(1),
});

export type LessonFile = z.infer<typeof lessonFileSchema>;
export type AnswerFile = z.infer<typeof answerSchema>;
export type RelationTypeFile = z.infer<typeof relationTypeSchema>;
