import type { LessonKind } from './types';

/** Student-facing words that differ between argument and explanation lessons. */
export interface Vocab {
  /** "main conclusion" / "explanandum" */
  conclusion: string;
  /** Capitalised, for tags and labels. */
  Conclusion: string;
  /** Short gloss used after the term on first mention. */
  conclusionGloss: string;
  /** The question students should ask to find it. */
  conclusionQuestion: string;
  /** What the supporting claims are called. */
  premises: string;
  /** Label on a support/explanation link. */
  supports: string;
  /** "argument" / "explanation" */
  whole: string;
  /** Hint when passage claims are missing (marked mode). */
  findClaims: string;
  /** "every reason for it" */
  everyReason: string;
  /** Linked vs. independent question. */
  groupingQuestion: string;
  /** Hints for a wrong pick in a conclusion step, by the picked claim's role. */
  pickedPremise: (subject: string) => string;
  pickedIntermediate: (subject: string) => string;
  pickedBackground: (subject: string) => string;
  /** Note for a claim on the map that isn't part of the argument/explanation. */
  notPart: (subject: string) => string;
  /** Link-menu and outline wording for grouping claims. */
  linkWith: string;
  linkWithQuestion: (several: boolean) => string;
  split: string;
  removeFromLink: string;
  chooseSources: string;
}

const VOCAB: Record<LessonKind, Vocab> = {
  argument: {
    conclusion: 'main conclusion',
    Conclusion: 'Main conclusion',
    conclusionGloss: '',
    conclusionQuestion: 'What is the author ultimately trying to get you to accept?',
    premises: 'premises',
    supports: 'supports',
    whole: 'argument',
    findClaims: 'Reread it: which numbered claims give reasons, raise objections, or reply to them?',
    everyReason: 'every reason for it',
    groupingQuestion: 'does each premise give a reason on its own, or do some only work together with another premise?',
    pickedPremise: (s) => `${s} is offered as a reason. What is it a reason for?`,
    pickedIntermediate: (s) => `Something supports ${s}, but it in turn supports another claim. Keep going: what is the author's final point?`,
    pickedBackground: (s) => `Does the author argue for ${s}, or is it just setting the scene?`,
    notPart: (s) => `${s} isn't part of the argument. Does it give a reason for anything, or is it background?`,
    linkWith: 'Link with another premise…',
    linkWithQuestion: (several) => `Which premise works together with ${several ? 'these' : 'this one'}?`,
    split: 'Split into independent reasons',
    removeFromLink: 'Remove this premise from the link',
    chooseSources: 'Premise(s) — choose more than one for a linked argument:',
  },
  explanation: {
    conclusion: 'explanandum',
    Conclusion: 'Explanandum',
    conclusionGloss: ' (what is being explained)',
    conclusionQuestion: 'What fact or event is the passage trying to explain?',
    premises: 'parts of the explanation (the explanans)',
    supports: 'explains',
    whole: 'explanation',
    findClaims: 'Reread it: which numbered claims help explain something?',
    everyReason: 'everything that helps explain it',
    groupingQuestion: 'does each one explain it on its own, or do some only explain it together with another?',
    pickedPremise: (s) => `${s} is part of the explanation. What does it help explain?`,
    pickedIntermediate: (s) => `Something explains ${s}, but it in turn helps explain another claim. Keep going: what is the passage ultimately explaining?`,
    pickedBackground: (s) => `Is ${s} being explained, or is it just background?`,
    notPart: (s) => `${s} isn't part of the explanation. Does it help explain anything, or is it background?`,
    linkWith: 'Link with another explaining claim…',
    linkWithQuestion: (several) => `Which claim explains it together with ${several ? 'these' : 'this one'}?`,
    split: 'Split into separate explanations',
    removeFromLink: 'Remove this claim from the link',
    chooseSources: 'Explaining claim(s) — choose more than one if they only explain it together:',
  },
};

export const vocab = (kind: LessonKind): Vocab => VOCAB[kind];
