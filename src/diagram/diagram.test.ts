import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLesson } from '../lesson/compile';
import type { Lesson } from '../model/types';
import { buildDeck } from './deck';
import { parseArgmap } from './parse';
import { renderDiagramSvg } from './svg';
import { claimStatuses } from '../model/dialectic';
import { diagramFromLesson } from './fromLesson';

const root = join(__dirname, '../..');
const lessons = new Map<string, Lesson>(
  readdirSync(join(root, 'lessons'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      const l = compileLesson(readFileSync(join(root, 'lessons', f), 'utf8'), f);
      return [l.id, l];
    }),
);

describe('argmap syntax', () => {
  it('parses claims, linked premises, objections, evaluations, and steps', () => {
    const { diagram, errors } = parseArgmap(`
      # a comment
      C*: The butler is the thief
      P1: Only the butler had a key
      P2: Whoever stole had to use the key
      O: The butler has an alibi   @2
      P1 + P2 -> C  [deductive, valid]
      O -x C
    `);
    expect(errors).toEqual([]);
    expect(diagram.conclusion).toBe('C');
    expect(diagram.links[0]).toMatchObject({ type: 'support', from: ['P1', 'P2'], to: 'C', evaluation: { type: 'deductive', quality: 'valid' }, step: 1 });
    // A link appears no earlier than its claims.
    expect(diagram.links[1]).toMatchObject({ type: 'objection', step: 2 });
  });

  it('finds the conclusion without a star, and treats => as an explanation', () => {
    const { diagram } = parseArgmap('X: The streets are wet\nE: It rained\nE => X');
    expect(diagram).toMatchObject({ kind: 'explanation', conclusion: 'X' });
  });

  it('reports mistakes clearly', () => {
    const { errors } = parseArgmap('A: a\nA: again\nA -> B\nB => A\nnonsense here\nA -> A [deductive, soggy]');
    expect(errors.join('\n')).toMatch(/defined twice/);
    expect(errors.join('\n')).toMatch(/no claim with ID B/);
    expect(errors.join('\n')).toMatch(/expected "ID: text"/);
    expect(errors.join('\n')).toMatch(/unknown evaluation "soggy"/);
    expect(errors.join('\n')).toMatch(/can't bear on itself/);
    expect(errors.join('\n')).toMatch(/not both/);
  });

  it('renders SVG with fragments for later steps and escaped text', () => {
    const { diagram } = parseArgmap('C*: Cats & dogs <are> pets\nP: Reason\nP -> C @2');
    const svg = renderDiagramSvg(diagram);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('Cats &amp; dogs &lt;are&gt; pets');
    expect(svg).toContain('class="fragment" data-fragment-index="2"');
    expect(svg).toContain('SUPPORTS');
    expect(svg).toContain('MAIN CONCLUSION');
    // No evaluations, no key and no dashes.
    expect(svg).not.toContain('argmap-legend');
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('gives each diagram its own arrowhead ids, so arrows survive many diagrams on one page', () => {
    const { diagram } = parseArgmap('C*: C\nP: P\nP -> C');
    const ids = (svg: string) => [...svg.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]);
    const [a, b] = [renderDiagramSvg(diagram), renderDiagramSvg(diagram)];
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
    // Every arrow points at a marker in its own diagram.
    for (const svg of [a, b]) {
      for (const [, ref] of svg.matchAll(/marker-end="url\(#([^)]+)\)"/g)) expect(ids(svg)).toContain(ref);
    }
  });
});

describe('challenged and answered claims', () => {
  const obj = (from: string, to: string) => ({ type: 'objection', from: [from], to });

  it("works out each claim's status from the objections alone", () => {
    const support = { type: 'support', from: ['S', 'R'], to: 'C' };
    expect([...claimStatuses([support])]).toEqual([]);
    // An unanswered objection challenges its target.
    expect(claimStatuses([support, obj('O', 'R')]).get('R')).toBe('challenged');
    // A rebuttal answers the objection: the target is answered, the objection challenged.
    const answered = claimStatuses([support, obj('O', 'R'), obj('Q', 'O')]);
    expect(answered.get('R')).toBe('answered');
    expect(answered.get('O')).toBe('challenged');
    // A rebuttal that is itself rebutted no longer answers anything.
    const back = claimStatuses([support, obj('O', 'R'), obj('Q', 'O'), obj('X', 'Q')]);
    expect([back.get('R'), back.get('O'), back.get('Q')]).toEqual(['challenged', 'answered', 'challenged']);
    // One unanswered objection is enough, even if another is answered.
    expect(claimStatuses([obj('O', 'R'), obj('Q', 'O'), obj('P', 'R')]).get('R')).toBe('challenged');
    // A linked objection falls if any of its claims is challenged.
    expect(claimStatuses([{ type: 'objection', from: ['A', 'B'], to: 'R' }, obj('Q', 'B')]).get('R')).toBe('answered');
    // Cycles don't hang.
    expect(claimStatuses([obj('A', 'B'), obj('B', 'A')]).size).toBe(2);
  });

  it('parses unstated premises and draws them dashed', () => {
    const { diagram, errors } = parseArgmap('C*: C\nR (unstated): R\nS: S\nS + R -> C');
    expect(errors).toEqual([]);
    expect(diagram.claims.find((c) => c.id === 'R')?.tag).toBe('unstated');
    expect(renderDiagramSvg(diagram)).toContain('stroke-dasharray="6 4"');
    expect(parseArgmap('R (hidden): R').errors.join()).toMatch(/unknown note/);
  });

  it('shows status changes on the click they happen, and only the final state when static', () => {
    const { diagram } = parseArgmap('C*: C\nR: R\nO: O @2\nQ: Q @3\nR -> C\nO -x R\nQ -x O');
    const svg = renderDiagramSvg(diagram);
    // R is challenged from click 2 until click 3, then answered.
    expect(svg).toMatch(/<g class="fragment fade-out" data-fragment-index="3"><g class="fragment" data-fragment-index="2"><g class="argmap-status challenged">/);
    expect(svg).toMatch(/<g class="fragment" data-fragment-index="3"><g class="argmap-status answered">/);
    expect(svg).toContain('? CHALLENGED');
    expect(svg).toContain('✓ ANSWERED');
    const still = renderDiagramSvg(diagram, { animate: false });
    expect(still).not.toContain('fade-out');
    expect(still.match(/argmap-status/g)).toHaveLength(2); // R answered, O challenged
  });

  it("marks the survey lesson's unstated premise and its challenge", () => {
    const { diagram } = diagramFromLesson(lessons.get('survey')!, 2);
    expect(diagram!.claims.find((c) => c.id === 'r')?.tag).toBe('unstated');
    expect(renderDiagramSvg(diagram!, { animate: false })).toContain('? CHALLENGED');
  });
});

describe('decks', () => {
  const decks = readdirSync(join(root, 'decks')).filter((f) => f.endsWith('.md') && f !== 'README.md');

  it.each(decks)('%s: every diagram renders', (file) => {
    const deck = buildDeck(file, readFileSync(join(root, 'decks', file), 'utf8'), (id) => lessons.get(id));
    for (const d of deck.diagrams) expect(d.errors, `diagram ${d.index}`).toEqual([]);
    expect(deck.markdown).not.toMatch(/```argmap/);
  });

  it('renders lesson references, including evaluation badges and explanations', () => {
    const deck = buildDeck('t', '```argmap lesson=butler\n```\n\n```argmap lesson=autumn-leaves step=2\n```\n\n```argmap lesson=nope\n```', (id) => lessons.get(id));
    // Judged links show the verdict as the label and the type in the badge; failed ones are broken by a ✗.
    expect(deck.diagrams[0].svg).toContain('✗ INVALID');
    expect(deck.diagrams[0].svg).toContain('✓ VALID');
    expect(deck.diagrams[0].svg).toContain('∴ deductive');
    expect(deck.diagrams[0].svg).toContain('#646a72'); // failed links are grey
    expect(deck.diagrams[0].svg).toContain('stroke-dasharray'); // inductive links are dashed
    expect(deck.diagrams[0].svg).toContain('argmap-legend');
    expect(deck.diagrams[0].svg).toContain('The butler is the thief'); // capitalised for display
    expect(deck.diagrams[1].svg).toContain('EXPLAINS');
    expect(deck.diagrams[1].svg).toContain('EXPLANANDUM');
    expect(deck.diagrams[2].errors[0]).toMatch(/no lesson with id "nope"/);
    expect(deck.markdown).toContain('argmap-error');
  });
});
