import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLesson } from '../lesson/compile';
import { parsePassage } from '../lesson/passage';
import { mapFromAnswer } from '../model/layout';
import { asAnswer, expandVariants } from '../lesson/variants';
import { isBank, type ArgumentMap, type Claim, type Lesson, type MapNode, type Span } from '../model/types';
import { gradeStep } from './grade';

const lessonsDir = join(__dirname, '../../lessons');
const lessonFiles = readdirSync(lessonsDir).filter((f) => /\.ya?ml$/.test(f));
const load = (file: string) => compileLesson(readFileSync(join(lessonsDir, file), 'utf8'), file);

describe('lesson files', () => {
  it.each(lessonFiles)('%s is valid and every accepted variant earns full marks', (file) => {
    const lesson = load(file);
    lesson.steps.forEach((step, i) => {
      for (const answer of step.answers) {
        for (const variant of expandVariants(answer)) {
          const result = gradeStep(lesson, i, mapFromAnswer(lesson, asAnswer(variant)));
          expect(result.earned, `step ${i + 1}: ${JSON.stringify(variant)}`).toBe(result.possible);
        }
      }
    });
  });

  // A student who got step N right carries their map into step N+1. Every map accepted at
  // step N, extended with the new material from step N+1's answer, must be accepted there too;
  // otherwise that student would be told a correct earlier choice is now wrong.
  it.each(lessonFiles)('%s never strands a student between steps', (file) => {
    const lesson = load(file);
    for (let i = 0; i + 1 < lesson.steps.length; i++) {
      const isNew = (id: string) => {
        const c = lesson.claims[id];
        return isBank(c.source) ? c.bankStep === i + 1 : c.source.segment === i + 1;
      };
      const next = expandVariants(lesson.steps[i + 1].answers[0])[0];
      const added = next.relations.filter((r) => [...r.from, r.to].some(isNew));
      for (const answer of lesson.steps[i].answers) {
        for (const variant of expandVariants(answer)) {
          const extended = {
            conclusion: isNew(next.conclusion) ? next.conclusion : variant.conclusion,
            relations: [...variant.relations, ...added],
          };
          const result = gradeStep(lesson, i + 1, mapFromAnswer(lesson, asAnswer(extended)));
          expect(result.earned, `step ${i + 1} → ${i + 2}: ${JSON.stringify(variant)}`).toBe(result.possible);
        }
      }
    }
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

  it('uses an alternative answer when it scores better', () => {
    const yaml = `
id: alt
title: Alt
steps:
  - instructions: x
    passage: "{{a|A}} so {{b|B}} so {{c|C}}"
    answer: { conclusion: c, relations: [{ type: support, from: [a], to: b }, { type: support, from: [b], to: c }] }
    alternatives:
      - { conclusion: c, relations: [{ type: support, from: [a], to: c }, { type: support, from: [b], to: c }] }
`;
    const lesson = compileLesson(yaml);
    const result = gradeStep(lesson, 0, mapFromAnswer(lesson, lesson.steps[0].answers[1]));
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

describe('linking and splitting premises', () => {
  const base: ArgumentMap = {
    nodes: [],
    relations: [
      { id: 'r1', type: 'support', from: ['a'], to: 'c' },
      { id: 'r2', type: 'support', from: ['b'], to: 'c' },
      { id: 'r3', type: 'objection', from: ['b'], to: 'c' },
    ],
  };

  it('links a premise and merges its separate link of the same kind', async () => {
    const ops = await import('../model/ops');
    const next = ops.linkPremise(base, 'r1', 'b');
    expect(next.relations.find((r) => r.id === 'r1')?.from).toEqual(['a', 'b']);
    expect(next.relations.map((r) => r.id)).toEqual(['r1', 'r3']); // the objection is a different link, so it stays
  });

  it('splits a linked link back into independent ones', async () => {
    const ops = await import('../model/ops');
    const split = ops.splitRelation(ops.linkPremise(base, 'r1', 'b'), 'r1');
    const supports = split.relations.filter((r) => r.type === 'support');
    expect(supports.map((r) => r.from)).toEqual([['a'], ['b']]);
    expect(supports.every((r) => r.to === 'c')).toBe(true);
  });
});

describe('answer leeway', () => {
  const yaml = `
id: leeway
title: Leeway
equivalent: [[c, c2]]
steps:
  - instructions: x
    passage: "{{c|We should act}}. {{p1|P1}}. {{p2|P2}}. {{p3|P3}}. {{o|O}}. {{x|X}}. In short, {{c2|we must act}}."
    answer:
      conclusion: c
      relations:
        - { type: support, from: [p1, p2, p3], to: c, grouping: either }
        - { type: objection, from: [o], to: [c, p1] }
        - { type: support, from: [x], to: c, optional: true }
`;
  const lesson = compileLesson(yaml);
  const node = (id: string, nodeId = id): MapNode => ({ id: nodeId, text: id, source: lesson.claims[id].source, position: { x: 0, y: 0 } });
  const base = (relations: ArgumentMap['relations'], conclusion = 'c', extra: MapNode[] = []): ArgumentMap => ({
    nodes: [node(conclusion), ...['p1', 'p2', 'p3', 'o'].map((id) => node(id)), ...extra],
    relations,
    conclusion,
  });
  const score = (m: ArgumentMap) => {
    const r = gradeStep(lesson, 0, m);
    return r.earned / r.possible;
  };
  const objection = { id: 'ro', type: 'objection' as const, from: ['o'], to: 'c' };

  it('grouping: either accepts linked, convergent, and mixed groupings', () => {
    const linked = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c' }, objection]);
    const convergent = base([
      { id: 'r1', type: 'support', from: ['p1'], to: 'c' },
      { id: 'r2', type: 'support', from: ['p2'], to: 'c' },
      { id: 'r3', type: 'support', from: ['p3'], to: 'c' },
      objection,
    ]);
    const mixed = base([
      { id: 'r1', type: 'support', from: ['p1', 'p2'], to: 'c' },
      { id: 'r3', type: 'support', from: ['p3'], to: 'c' },
      objection,
    ]);
    expect([score(linked), score(convergent), score(mixed)]).toEqual([1, 1, 1]);
  });

  it('grouping: either still notices a premise left out', () => {
    const partial = base([{ id: 'r', type: 'support', from: ['p1', 'p2'], to: 'c' }, objection]);
    expect(score(partial)).toBeLessThan(1);
  });

  it('accepts any listed target', () => {
    const toPremise = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c' }, { ...objection, to: 'p1' }]);
    expect(score(toPremise)).toBe(1);
    const toOther = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c' }, { ...objection, to: 'p2' }]);
    expect(score(toOther)).toBeLessThan(1);
  });

  it('optional links are neither required nor flagged when present', () => {
    const without = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c' }, objection]);
    const withX = base(
      [{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c' }, objection, { id: 'rx', type: 'support', from: ['x'], to: 'c' }],
      'c',
      [node('x')],
    );
    expect(score(without)).toBe(1);
    const result = gradeStep(lesson, 0, withX);
    expect(result.earned).toBe(result.possible);
    expect(result.items.filter((i) => i.status === 'note')).toEqual([]);
  });

  it('equivalent claims are interchangeable, and adding both is a duplicate', () => {
    const restated = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c2' }, { ...objection, to: 'c2' }], 'c2');
    expect(score(restated)).toBe(1);
    const both = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c' }, objection], 'c', [node('c2')]);
    expect(gradeStep(lesson, 0, both).items.some((i) => /repeats a claim/.test(i.message))).toBe(true);
  });

  it('expands variants for the CI checks', () => {
    // 2 groupings × 2 targets × (optional in/out) = 8
    expect(expandVariants(lesson.steps[0].answers[0])).toHaveLength(8);
  });

  it('rejects bad equivalent sets', () => {
    const bad = (eq: string) => `
id: bad
title: Bad
equivalent: ${eq}
steps:
  - instructions: x
    passage: "{{a|A}} {{b|B}} {{c|C}}"
    answer: { conclusion: a, relations: [] }
`;
    expect(() => compileLesson(bad('[[a, zz]]'))).toThrow(/"zz"/);
    expect(() => compileLesson(bad('[[a, b], [b, c]]'))).toThrow(/more than one equivalent set/);
  });
});
