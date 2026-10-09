/** Shared runtime types for lessons and student maps. */

export type RelationType = 'support' | 'objection' | 'explanation';

/** Argument lessons map reasons for a conclusion; explanation lessons map what explains an explanandum. */
export type LessonKind = 'argument' | 'explanation';

/** A character range within one step's passage text. */
export interface Span {
  segment: number;
  start: number;
  end: number;
}

/** A claim from the lesson's claim bank (not in the passage). */
export interface BankRef {
  bank: string;
}

/** Where a claim comes from: a stretch of passage text, or the claim bank. */
export type ClaimSource = Span | BankRef;

export const isBank = (s: ClaimSource): s is BankRef => 'bank' in s;

export interface WordingChoice {
  text: string;
  /** Why this wording is not the best one (shown in feedback). */
  why?: string;
}

export interface Claim {
  id: string;
  /** 1-based number in order of appearance in the passage, shown in marked mode (0 for bank claims). */
  number: number;
  /** The claim as written: the passage text, or the bank claim's text. */
  passageText: string;
  /** The author's preferred statement of the claim (defaults to passageText). */
  modelText: string;
  source: ClaimSource;
  /** For bank claims: the first step (0-based) in which the claim is offered. */
  bankStep?: number;
  /** For rewording "choose": wordings the student picks from (best one first, unshuffled). */
  wordingChoices?: WordingChoice[];
}

export type RewordingMode = 'none' | 'free' | 'choose';

export interface Relation {
  type: RelationType;
  from: string[];
  to: string;
}

/** A link in a model answer, with the leeway the author allows. */
export interface AnswerRelation {
  type: RelationType;
  from: string[];
  /** Acceptable targets: any one of these is correct. */
  to: string[];
  /** `either`: the premises may be grouped any way (linked, convergent, or a mix). */
  grouping: 'exact' | 'either';
  /** Accepted if present, but not required. */
  optional: boolean;
}

export interface Answer {
  conclusion: string;
  relations: AnswerRelation[];
}

export interface Mistake {
  relation: Relation;
  message: string;
}

export type StepTask = 'conclusion' | 'structure' | 'reword' | 'evaluate';

export type InferenceType = 'deductive' | 'inductive';
export type InferenceQuality = 'valid' | 'invalid' | 'strong' | 'weak';
export const QUALITIES: Record<InferenceType, [InferenceQuality, InferenceQuality]> = {
  deductive: ['valid', 'invalid'],
  inductive: ['strong', 'weak'],
};

/** A student's (or the key's) judgement of one support link. */
export interface Evaluation {
  type?: InferenceType;
  quality?: InferenceQuality;
}

/** The expected evaluation of one support link in an evaluate step. */
export interface EvaluationKey {
  from: string[];
  to: string;
  type: InferenceType;
  /** Acceptable qualities; empty means quality isn't graded. */
  quality: InferenceQuality[];
  hint?: string;
}

export interface Step {
  title?: string;
  task: StepTask;
  instructions: string;
  /** Plain passage text for this step, with claim markup removed. */
  passage: string;
  /** For conclusion and reword steps, these come from the neighbouring structure step. */
  answers: Answer[];
  mistakes: Mistake[];
  /** Conclusion steps: per-claim hints that override the automatic ones. */
  conclusionHints: Record<string, string>;
  /** Evaluate steps: what to ask, and the expected evaluations. */
  ask: 'type' | 'full';
  evaluations: EvaluationKey[];
}

export interface Lesson {
  id: string;
  title: string;
  description?: string;
  kind: LessonKind;
  claimMode: 'marked' | 'highlight';
  rewording: RewordingMode;
  claims: Record<string, Claim>;
  /** Claim id -> representative of its `equivalent` set (only claims in a set appear). */
  equivalent: Record<string, string>;
  steps: Step[];
}

/* ---- Student work ---- */

export interface MapNode {
  id: string;
  /** The student's (possibly reworded) statement of the claim. */
  text: string;
  /** Where the claim came from: the passage or the claim bank. */
  source: ClaimSource;
  position: { x: number; y: number };
}

export interface MapRelation {
  id: string;
  type: RelationType;
  /** Evaluate steps: the student's judgement of this (support) link. */
  evaluation?: Evaluation;
  /** Node ids. More than one = linked premises. */
  from: string[];
  to: string;
  position?: { x: number; y: number };
}

export interface ArgumentMap {
  nodes: MapNode[];
  relations: MapRelation[];
  /** Node id the student marked as the main conclusion. */
  conclusion?: string;
}

export const emptyMap = (): ArgumentMap => ({ nodes: [], relations: [] });
