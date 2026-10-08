import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLesson } from '../lesson/compile';
import { parsePassage } from '../lesson/passage';
import { mapFromAnswer } from '../model/layout';
import type { ArgumentMap, Lesson, MapNode } from '../model/types';
import { gradeStep } from './grade';

const lessonsDir = join(__dirname, '../../lessons');
const lessonFiles = readdirSync(lessonsDir).filter((f) => /\.ya?ml$/.test(f));
const load = (file: string) => compileLesson(readFileSync(join(lessonsDir, file), 'utf8'), file);

describe('lesson files', () => {
  it.each(lessonFiles)('%s is valid and its model answers earn full marks', (file) => {
    const lesson = load(file);
    lesson.steps.forEach((step, i) => {
      for (const answer of step.answers) {
        const result = gradeStep(lesson, i, mapFromAnswer(lesson, answer));
        expect(result.earned).toBe(result.possible);
      }
    });
  });
});

describe('parsePassage', () => {
  it('strips markup, records offsets, and joins wrapped lines', () => {
    const p = parsePassage('Hello. {{a|Cats are\n  great}}, so {{b|get a cat}}.\n\nNew para.');
    expect(p.text).toBe('Hello. Cats are great, so get a cat.\n\nNew para.');
    expect(p.claims.map((c) => p.text.slice(c.start, c.end))).toEqual(['Cats are great', 'get a cat']);
  });

  it('rejects unbalanced markup', () => {
    expect(() => parsePassage('{{a|oops')).toThrow(/Malformed/);
  });
});

describe('compileLesson', () => {
  it('rejects answers that refer to unmarked claims', () => {
    const yaml = `
id: bad
title: Bad
steps:
  - instructions: x
    passage: "{{a|A}} because {{b|B}}"
    answer: { conclusion: a, relations: [{ type: support, from: [zz], to: a }] }
`;
    expect(() => compileLesson(yaml)).toThrow(/"zz"/);
  });
});

describe('gradeStep', () => {
  const zoos: Lesson = load('zoos.yaml');
  const node = (claimId: string, text?: string): MapNode => {
    const c = zoos.claims[claimId];
    return { id: claimId, text: text ?? c.passageText, source: c.span, position: { x: 0, y: 0 } };
  };

  it('gives partial credit when linked premises are drawn as convergent', () => {
    const map: ArgumentMap = {
      nodes: ['c1', 'c4', 'c5'].map((id) => node(id)),
      relations: [
        { id: 'r1', type: 'support', from: ['c4'], to: 'c1' },
        { id: 'r2', type: 'support', from: ['c5'], to: 'c1' },
      ],
      conclusion: 'c1',
    };
    const result = gradeStep(zoos, 0, map);
    const partial = result.items.filter((i) => i.status === 'partial');
    expect(partial).toHaveLength(1);
    expect(partial[0].message).toMatch(/linked/);
  });

  it('shows the author-written message for a known mistake', () => {
    const map: ArgumentMap = {
      nodes: ['c1', 'c6', 'c7'].map((id) => node(id)),
      relations: [
        { id: 'r1', type: 'objection', from: ['c6'], to: 'c1' },
        { id: 'r2', type: 'support', from: ['c7'], to: 'c1' },
      ],
      conclusion: 'c1',
    };
    const messages = gradeStep(zoos, 0, map).items.map((i) => i.message);
    expect(messages.some((m) => m.includes('rebuttal'))).toBe(true);
  });

  it('matches highlighted text that only roughly matches a claim, and ignores rewording', () => {
    const c1 = zoos.claims.c1;
    const map: ArgumentMap = {
      nodes: [
        {
          id: 'n1',
          text: 'Zoos ought to be closed down.',
          // Student also grabbed the word "But" before the claim.
          source: { ...c1.span, start: c1.span.start - 4 },
          position: { x: 0, y: 0 },
        },
      ],
      relations: [],
      conclusion: 'n1',
    };
    const result = gradeStep(zoos, 0, map);
    expect(result.mapping.n1).toBe('c1');
    expect(result.items[0].status).toBe('correct');
  });

  it('accepts a highlight of just the core of a long claim, but not a stray fragment', () => {
    const c3 = zoos.claims.c3; // "they show stress behaviors like pacing ... in the wild"
    const at = (start: number, end: number): MapNode => ({ id: 'n', text: '', source: { ...c3.span, start, end }, position: { x: 0, y: 0 } });
    const core = at(c3.span.start, c3.span.start + 'they show stress behaviors like pacing and swaying'.length);
    const fragment = at(c3.span.start, c3.span.start + 'they show'.length);
    expect(gradeStep(zoos, 0, { nodes: [core], relations: [] }).mapping.n).toBe('c3');
    expect(gradeStep(zoos, 0, { nodes: [fragment], relations: [] }).mapping.n).toBeUndefined();
  });

  it('notes claims that are not part of the argument', () => {
    const map: ArgumentMap = { nodes: [node('x1')], relations: [] };
    const notes = gradeStep(zoos, 0, map).items.filter((i) => i.status === 'note');
    expect(notes[0].message).toMatch(/isn't part of the argument/);
  });

  it('uses the alternative answer when it scores better', () => {
    const lesson = load('social-media-ban.yaml');
    const alt = lesson.steps[0].answers[1];
    const result = gradeStep(lesson, 0, mapFromAnswer(lesson, alt));
    expect(result.earned).toBe(result.possible);
  });
});
