import type { Evaluation, LessonKind, RelationType } from '../model/types';

/** A diagram to draw on a slide: claims and links, with build steps for step-by-step reveals. */
export interface DiagramClaim {
  id: string;
  text: string;
  /** Small tag shown above the text, e.g. "unstated". */
  tag?: string;
  /** 1 = shown from the start; 2, 3, … = revealed on later clicks. */
  step: number;
}

export interface DiagramLink {
  type: RelationType;
  from: string[];
  to: string;
  evaluation?: Evaluation;
  step: number;
}

export interface Diagram {
  kind: LessonKind;
  claims: DiagramClaim[];
  links: DiagramLink[];
  conclusion?: string;
}
