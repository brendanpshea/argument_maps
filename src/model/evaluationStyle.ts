import type { Evaluation, InferenceQuality, InferenceType } from './types';

/**
 * How evaluations are shown, without relying on colour: each judgement has a
 * word, a symbol, and (on the link itself) a line style.
 *
 *   deductive  ∴  solid line, filled arrowhead, square-cornered badge
 *   inductive  ≈  dashed line, open arrowhead, rounded badge
 *   valid/strong ✓, invalid/weak ✗
 */
export const TYPE_SYMBOL: Record<InferenceType, string> = { deductive: '∴', inductive: '≈' };
export const QUALITY_SYMBOL: Record<InferenceQuality, string> = { valid: '✓', strong: '✓', invalid: '✗', weak: '✗' };

/** Dash pattern for an inductive link's lines (deductive and unevaluated links are solid). */
export const INDUCTIVE_DASH = '7 5';

/** "∴ deductive · ✓ valid", or just the type if no quality has been chosen. */
export function badgeText(e: Evaluation): string {
  if (!e.type) return '';
  const type = `${TYPE_SYMBOL[e.type]} ${e.type}`;
  return e.quality ? `${type} · ${QUALITY_SYMBOL[e.quality]} ${e.quality}` : type;
}

/** The same choices with their symbols, for buttons. */
export const optionLabel = (o: InferenceType | InferenceQuality) =>
  `${o in TYPE_SYMBOL ? TYPE_SYMBOL[o as InferenceType] : QUALITY_SYMBOL[o as InferenceQuality]} ${o}`;

/** Invalid and weak inferences fail; they're drawn grey and broken by a ✗. */
export const isFailed = (e?: Evaluation) => e?.quality === 'invalid' || e?.quality === 'weak';
export const FAILED_COLOR = '#646a72';
export const FAILED_FILL = '#eeeff1';

/** Once the quality is judged, a link's label is the verdict: "✓ valid", "✗ weak". */
export const verdictLabel = (e?: Evaluation) => (e?.quality ? `${QUALITY_SYMBOL[e.quality]} ${e.quality}` : undefined);

/** The badge under the label: the type, plus the quality only while it isn't already the label. */
export const typeBadge = (e?: Evaluation) => (!e?.type ? '' : e.quality ? `${TYPE_SYMBOL[e.type]} ${e.type}` : badgeText(e));
