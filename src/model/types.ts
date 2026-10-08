/** Shared runtime types for lessons and student maps. */

export type RelationType = 'support' | 'objection';

/** A character range within one step's passage text. */
export interface Span {
  segment: number;
  start: number;
  end: number;
}

export interface Claim {
  id: string;
  /** 1-based number in order of appearance, shown in marked mode. */
  number: number;
  /** The claim exactly as it appears in the passage. */
  passageText: string;
  /** The author's preferred statement of the claim (defaults to passageText). */
  modelText: string;
  span: Span;
}

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
  claims: Record<string, Claim>;
  steps: Step[];
}

/* ---- Student work ---- */

export interface MapNode {
  id: string;
  /** The student's (possibly reworded) statement of the claim. */
  text: string;
  /** Where in the passage the claim came from. */
  source: Span;
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
