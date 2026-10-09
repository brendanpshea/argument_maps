import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLesson } from '../lesson/compile';
import type { Lesson } from '../model/types';
import { buildDeck } from './deck';
import { parseArgmap } from './parse';
import { renderDiagramSvg } from './svg';

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
    expect(deck.diagrams[0].svg).toContain('∴ deductive · ✗ invalid');
    expect(deck.diagrams[0].svg).toContain('stroke-dasharray'); // inductive links are dashed
    expect(deck.diagrams[0].svg).toContain('argmap-legend');
    expect(deck.diagrams[0].svg).toContain('The butler is the thief'); // capitalised for display
    expect(deck.diagrams[1].svg).toContain('EXPLAINS');
    expect(deck.diagrams[1].svg).toContain('EXPLANANDUM');
    expect(deck.diagrams[2].errors[0]).toMatch(/no lesson with id "nope"/);
    expect(deck.markdown).toContain('argmap-error');
  });
});
