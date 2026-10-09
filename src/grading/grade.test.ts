import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLesson } from '../lesson/compile';
import { parsePassage } from '../lesson/passage';
import { mapFromAnswer } from '../model/layout';
import type { ArgumentMap, Claim, Lesson, MapNode, Span } from '../model/types';
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

describe('feedback never reveals the answer', () => {
  // For every step of every lesson, remove each answer claim in turn from the
  // model map and check that no feedback message mentions the removed claim.
  it.each(lessonFiles)('%s', (file) => {
    const lesson = load(file);
    lesson.steps.forEach((step, i) => {
      const model = mapFromAnswer(lesson, step.answers[0]);
      for (const removed of model.nodes) {
        const claim = lesson.claims[removed.id.slice(2)];
        const map = { ...model, nodes: model.nodes.filter((n) => n !== removed), conclusion: model.conclusion === removed.id ? undefined : model.conclusion };
        const messages = gradeStep(lesson, i, map).items.map((m) => m.message).join('\n');
        if (lesson.claimMode === 'marked' && claim.number) expect(messages).not.toContain(`(${claim.number})`);
        expect(messages).not.toContain(claim.passageText.slice(0, 30));
        expect(messages).not.toContain(claim.modelText.slice(0, 30));
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
    return { id: claimId, text: text ?? c.passageText, source: c.source, position: { x: 0, y: 0 } };
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
    expect(partial[0].message).toMatch(/work together/);
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
    expect(messages.some((m) => m.includes('responding to something else'))).toBe(true);
  });

  it('matches highlighted text that only roughly matches a claim, and ignores rewording', () => {
    const c1 = zoos.claims.c1 as Claim & { source: Span };
    const map: ArgumentMap = {
      nodes: [
        {
          id: 'n1',
          text: 'Zoos ought to be closed down.',
          // Student also grabbed the word "But" before the claim.
          source: { ...c1.source, start: c1.source.start - 4 },
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
    const c3 = zoos.claims.c3 as Claim & { source: Span }; // "they show stress behaviors like pacing ... in the wild"
    const at = (start: number, end: number): MapNode => ({ id: 'n', text: '', source: { ...c3.source, start, end }, position: { x: 0, y: 0 } });
    const core = at(c3.source.start, c3.source.start + 'they show stress behaviors like pacing and swaying'.length);
    const fragment = at(c3.source.start, c3.source.start + 'they show'.length);
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

describe('claim bank and wording choices', () => {
  const lesson: Lesson = load('drug-testing.yaml');
  const model = mapFromAnswer(lesson, lesson.steps[0].answers[0]);
  const withText = (map: ArgumentMap, claimId: string, text: string): ArgumentMap => ({
    ...map,
    nodes: map.nodes.map((n) => (n.id === `n-${claimId}` ? { ...n, text } : n)),
  });

  it('matches bank claims by id', () => {
    const result = gradeStep(lesson, 0, model);
    expect(result.mapping['n-b1']).toBe('b1');
  });

  it('asks for unstated claims without naming them', () => {
    const map = { ...model, nodes: model.nodes.filter((n) => n.id !== 'n-b1') };
    const items = gradeStep(lesson, 0, map).items.filter((i) => i.status === 'missing');
    expect(items.some((i) => /claim bank/.test(i.message) && !i.message.includes(lesson.claims.b1.passageText))).toBe(true);
  });

  it('notes decoy bank claims', () => {
    const map: ArgumentMap = { ...model, nodes: [...model.nodes, { id: 'x', text: '', source: { bank: 'b2' }, position: { x: 0, y: 0 } }] };
    const notes = gradeStep(lesson, 0, map).items.filter((i) => i.status === 'note');
    expect(notes.some((n) => /isn't part of the argument/.test(n.message))).toBe(true);
  });

  it('scores wording choices and explains wrong ones', () => {
    const flawed = lesson.claims.d1.wordingChoices![1];
    const wrong = gradeStep(lesson, 0, withText(model, 'd1', flawed.text)).items.find((i) => i.status === 'wrong');
    expect(wrong?.message).toContain(flawed.why);

    const unchanged = withText(model, 'd1', lesson.claims.d1.passageText);
    const missing = gradeStep(lesson, 0, unchanged).items.find((i) => i.status === 'missing');
    expect(missing?.message).toMatch(/Choose the clearest wording/);
  });

  it('rejects wording choices unless rewording is "choose"', () => {
    const yaml = `
id: bad
title: Bad
wordingChoices: { a: { best: A, others: [{ text: B }] } }
steps:
  - instructions: x
    passage: "{{a|A}}"
    answer: { conclusion: a, relations: [] }
`;
    expect(() => compileLesson(yaml)).toThrow(/rewording: choose/);
  });
});

describe('map editing', () => {
  it('reverses single-premise links only', async () => {
    const ops = await import('../model/ops');
    const map: ArgumentMap = {
      nodes: [],
      relations: [
        { id: 'r1', type: 'support', from: ['a'], to: 'b' },
        { id: 'r2', type: 'support', from: ['c', 'd'], to: 'b' },
      ],
    };
    const next = ops.reverseRelation(ops.reverseRelation(map, 'r1'), 'r2');
    expect(next.relations[0]).toMatchObject({ from: ['b'], to: 'a' });
    expect(next.relations[1]).toMatchObject({ from: ['c', 'd'], to: 'b' });
  });
});
