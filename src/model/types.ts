/** Shared runtime types for lessons and student maps. */

export type RelationType = 'support' | 'objection';

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

export interface Answer {
  conclusion: string;
  relations: Relation[];
}

export interface Mistake {
  relation: Relation;
  message: string;
}

export interface Step {
  title?: string;
  instructions: string;
  /** Plain passage text for this step, with claim markup removed. */
  passage: string;
  answers: Answer[];
  mistakes: Mistake[];
}

export interface Lesson {
  id: string;
  title: string;
  description?: string;
  claimMode: 'marked' | 'highlight';
  rewording: RewordingMode;
  claims: Record<string, Claim>;
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
