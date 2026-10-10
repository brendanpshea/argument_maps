import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLesson } from '../lesson/compile';
import { parsePassage } from '../lesson/passage';
import { mapFromAnswer } from '../model/layout';
import { asAnswer, expandVariants } from '../lesson/variants';
import { isBank, type ArgumentMap, type Claim, type Evaluation, type Lesson, type MapNode, type Span } from '../model/types';
import { gradeStep, withKeyEvaluations } from './grade';

const lessonsDir = join(__dirname, '../../lessons');
const lessonFiles = readdirSync(lessonsDir).filter((f) => /\.ya?ml$/.test(f));
const load = (file: string) => compileLesson(readFileSync(join(lessonsDir, file), 'utf8'), file);

describe('lesson files', () => {
  it('have distinct ids (progress is saved by id)', () => {
    const ids = lessonFiles.map((f) => load(f).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignore saved progress in an unexpected shape', async () => {
    const { validProgress } = await import('../storage/progress');
    for (const bad of [{}, [], 1, 'x', null, { stepIndex: 1.5, maps: [], scores: [] }, { stepIndex: 0, maps: [{}], scores: [] }]) {
      expect(validProgress(bad)).toBeNull();
    }
    expect(validProgress({ stepIndex: 0, maps: [{ nodes: [], relations: [] }], scores: [null] })).toMatchObject({ completed: false });
  });

  it.each(lessonFiles)('%s is valid and every accepted variant earns full marks', (file) => {
    const lesson = load(file);
    lesson.steps.forEach((step, i) => {
      for (const answer of step.answers) {
        for (const variant of expandVariants(answer)) {
          const model = mapFromAnswer(lesson, asAnswer(variant));
          const result = gradeStep(lesson, i, step.task === 'evaluate' ? withKeyEvaluations(lesson, step, model) : model);
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
      // Only structure steps can reject a carried-forward map; the other tasks grade something else.
      if (lesson.steps[i + 1].task !== 'structure') continue;
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
    const butler = load('butler.yaml');
    const bnode = (id: string): MapNode => ({ id, text: butler.claims[id].passageText, source: butler.claims[id].source, position: { x: 0, y: 0 } });
    const map: ArgumentMap = {
      nodes: ['c', 'p1', 'p2'].map(bnode),
      relations: [
        { id: 'r1', type: 'support', from: ['p1'], to: 'c' },
        { id: 'r2', type: 'support', from: ['p2'], to: 'c' },
      ],
      conclusion: 'c',
    };
    const result = gradeStep(butler, 1, map);
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
    const messages = gradeStep(zoos, 1, map).items.map((i) => i.message);
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
    const result = gradeStep(zoos, 1, map);
    expect(result.mapping.n1).toBe('c1');
    expect(result.items[0].status).toBe('correct');
  });

  it('accepts a highlight of just the core of a long claim, but not a stray fragment', () => {
    const c3 = zoos.claims.c3 as Claim & { source: Span }; // "they show stress behaviors like pacing ... in the wild"
    const at = (start: number, end: number): MapNode => ({ id: 'n', text: '', source: { ...c3.source, start, end }, position: { x: 0, y: 0 } });
    const core = at(c3.source.start, c3.source.start + 'they show stress behaviors like pacing and swaying'.length);
    const fragment = at(c3.source.start, c3.source.start + 'they show'.length);
    expect(gradeStep(zoos, 1, { nodes: [core], relations: [] }).mapping.n).toBe('c3');
    expect(gradeStep(zoos, 1, { nodes: [fragment], relations: [] }).mapping.n).toBeUndefined();
  });

  it('notes claims that are not part of the argument', () => {
    const map: ArgumentMap = { nodes: [node('x1')], relations: [] };
    const notes = gradeStep(zoos, 1, map).items.filter((i) => i.status === 'note');
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
  const node = (id: string) => ({ id, text: id, source: { bank: id }, position: { x: 0, y: 0 } });
  const base: ArgumentMap = {
    nodes: ['a', 'b', 'c', 'd'].map(node),
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

  it('never leaves duplicate links or stale evaluations', async () => {
    const ops = await import('../model/ops');
    const m: ArgumentMap = {
      nodes: ['a', 'b', 'c', 'd'].map(node),
      relations: [
        { id: 'r1', type: 'support', from: ['a', 'b'], to: 'c' },
        { id: 'r2', type: 'support', from: ['b'], to: 'c' },
        { id: 'r3', type: 'support', from: ['c'], to: 'd', evaluation: { type: 'deductive', quality: 'valid' } },
        { id: 'r4', type: 'support', from: ['d'], to: 'c' },
      ],
    };
    // Splitting a+b would recreate b → c.
    expect(ops.splitRelation(m, 'r1').relations.filter((r) => r.to === 'c' && r.from.join() === 'b')).toHaveLength(1);
    // Reversing c → d onto the existing d → c does nothing.
    expect(ops.reverseRelation(m, 'r3')).toBe(m);
    // Switching a link's kind drops its evaluation.
    expect(ops.toggleRelationType(m, 'r3').relations.find((r) => r.id === 'r3')?.evaluation).toBeUndefined();
    // Repeated premises and missing claims are ignored.
    expect(ops.addRelation(m, 'support', ['a', 'a'], 'd').relations.at(-1)?.from).toEqual(['a']);
    expect(ops.addPremise(m, 'r2', 'ghost')).toBe(m);
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

  it('extra wrong links cost points, including a wrong version of an optional link', () => {
    const right = [{ id: 'r', type: 'support' as const, from: ['p1', 'p2', 'p3'], to: 'c' }, objection];
    expect(score(base([...right, { id: 'bad', type: 'support', from: ['o'], to: 'p2' }]))).toBeLessThan(1);
    expect(score(base([...right, { id: 'rx', type: 'objection', from: ['x'], to: 'c' }], 'c', [node('x')]))).toBeLessThan(1);
  });

  it('grouping: either does not let a premise linked twice stand in for a missing one', () => {
    const overlap = base([
      { id: 'r1', type: 'support', from: ['p1', 'p2'], to: 'c' },
      { id: 'r2', type: 'support', from: ['p2'], to: 'c' },
      objection,
    ]);
    expect(score(overlap)).toBeLessThan(1);
  });

  it('grades the copy of a repeated claim that the student actually used', () => {
    // A stray copy of the conclusion first, then its restatement starred and linked.
    const m = base([{ id: 'r', type: 'support', from: ['p1', 'p2', 'p3'], to: 'c2' }, { ...objection, to: 'c2' }], 'c2', [node('c', 'stray')]);
    m.nodes.unshift(m.nodes.pop()!);
    const result = gradeStep(lesson, 0, m);
    expect(result.earned).toBe(result.possible);
    expect(result.items.some((i) => /repeats a claim/.test(i.message))).toBe(true);
  });

  it("doesn't call a correct link a near miss for another key", () => {
    const yaml2 = `
id: two
title: Two
steps:
  - instructions: x
    passage: "{{c|C}}. {{p|P}}. {{o|O}}."
    answer:
      conclusion: c
      relations:
        - { type: support, from: [p], to: c }
        - { type: objection, from: [o], to: c }
        - { type: objection, from: [o], to: p }
`;
    const two = compileLesson(yaml2);
    const n = (id: string): MapNode => ({ id, text: id, source: two.claims[id].source, position: { x: 0, y: 0 } });
    const result = gradeStep(two, 0, {
      nodes: ['c', 'p', 'o'].map(n),
      relations: [
        { id: 'r1', type: 'support', from: ['p'], to: 'c' },
        { id: 'r2', type: 'objection', from: ['o'], to: 'c' },
      ],
      conclusion: 'c',
    });
    expect(result.items.some((i) => /wrong claim/.test(i.message))).toBe(false);
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

  it('rejects lesson mistakes that would make a lesson impossible or misleading', () => {
    const lesson = (body: string, extra = '') => `
id: bad
title: Bad
${extra}
steps:
  - instructions: x
    passage: "{{a|A}} {{b|B}} {{c|C}}"
${body}
`;
    const ok = '    answer: { conclusion: a, relations: [{ type: support, from: [b], to: a }] }';
    expect(() => compileLesson(lesson(ok + '\n    mistakes: [{ relation: { type: support, from: [typo], to: a }, message: m }]'))).toThrow(/"typo"/);
    expect(() => compileLesson(lesson(ok.replace('{{c|C}}', '')).replace('{{c|C}}', '{{c| }}'))).toThrow(/empty/);
    expect(() => compileLesson(lesson('    answer: { conclusion: a, relations: [{ type: support, from: [b], to: a }] }', 'equivalent: [[a, b]]'))).toThrow(/equivalent/);
    expect(() =>
      compileLesson(lesson('    answer: { conclusion: a, relations: [{ type: support, from: [b], to: a }, { type: objection, from: [b], to: a }] }')),
    ).toThrow(/both supports and objects/);
    const choose = (best: string, others: string) =>
      lesson(ok, `rewording: choose\nwordingChoices:\n  b:\n    best: ${best}\n    others: [${others}]`);
    expect(() => compileLesson(choose('B', '{ text: Other, why: w }'))).toThrow(/passage wording/);
    expect(() => compileLesson(choose('Better', '{ text: Better, why: w }'))).toThrow(/same wording twice/);
  });
});

describe('step tasks', () => {
  const zoos = load('zoos.yaml');
  const pick = (claimId: string): ArgumentMap => {
    const c = zoos.claims[claimId];
    return { nodes: [{ id: 'n', text: c.passageText, source: c.source, position: { x: 0, y: 0 } }], relations: [], conclusion: 'n' };
  };
  const conclusionFeedback = (claimId: string) => {
    const r = gradeStep(zoos, 0, pick(claimId));
    return { score: r.earned / r.possible, message: r.items[0].message };
  };

  it('conclusion steps accept the main conclusion', () => {
    expect(conclusionFeedback('c1').score).toBe(1);
  });

  it('conclusion steps give a hint matched to the role of a wrong pick', () => {
    expect(conclusionFeedback('c3').message).toMatch(/offered as a reason/); // plain premise
    expect(conclusionFeedback('c2').message).toMatch(/in turn supports another claim/); // intermediate conclusion
    expect(conclusionFeedback('c6').message).toMatch(/view the author is responding to/); // objection
    expect(conclusionFeedback('c7').message).toMatch(/answers an objection/); // rebuttal
    expect(conclusionFeedback('x1').message).toMatch(/setting the scene/); // author's custom hint
    for (const id of ['c2', 'c3', 'c6', 'c7', 'x1']) expect(conclusionFeedback(id).score).toBe(0);
  });

  it('structure steps do not score wording when the lesson has a reword step', () => {
    const model = mapFromAnswer(zoos, zoos.steps[1].answers[0]);
    const asWritten = { ...model, nodes: model.nodes.map((n) => ({ ...n, text: zoos.claims[n.id.slice(2)].passageText })) };
    const r = gradeStep(zoos, 1, asWritten);
    expect(r.earned).toBe(r.possible);
  });

  it('reword steps score only wording', () => {
    const model = mapFromAnswer(zoos, zoos.steps[2].answers[0]);
    const withText = (claimId: string, text: string) => ({ ...model, nodes: model.nodes.map((n) => (n.id === `n-${claimId}` ? { ...n, text } : n)) });
    expect(gradeStep(zoos, 2, model).earned).toBe(3);
    const flawed = zoos.claims.c3.wordingChoices![1];
    const r = gradeStep(zoos, 2, withText('c3', flawed.text));
    expect(r.items.find((i) => i.status === 'wrong')?.message).toContain(flawed.why);
    expect(r.items.every((i) => !/link|conclusion/i.test(i.message))).toBe(true);
  });

  it('rejects misplaced or incomplete task steps', () => {
    const lesson = (steps: string, extra = '') => `
id: t
title: T
${extra}
steps:
${steps}
`;
    const structure = `  - instructions: s
    passage: "{{a|A}} so {{b|B}}"
    answer: { conclusion: b, relations: [{ type: support, from: [a], to: b }] }`;
    expect(() => compileLesson(lesson(`  - task: conclusion\n    instructions: c\n    passage: "{{a|A}}"`))).toThrow(/no structure step after/);
    expect(() => compileLesson(lesson(`  - task: reword\n    instructions: r\n${structure}`))).toThrow(/no structure step before/);
    expect(() =>
      compileLesson(lesson(`  - task: conclusion\n    instructions: c\n    answer: { conclusion: b, relations: [] }\n${structure}`)),
    ).toThrow(/takes its answer from a structure step/);
    expect(() => compileLesson(lesson(`${structure}\n  - task: reword\n    instructions: r`, 'rewording: none'))).toThrow(/reword step needs/);
    expect(() => compileLesson(lesson(`  - task: conclusion\n    instructions: c\n${structure}`))).toThrow(/only appears in step 2/);
  });
});

describe('evaluate steps', () => {
  const butler = load('butler.yaml');
  const step = 2;
  const model = mapFromAnswer(butler, butler.steps[1].answers[0]);
  // Relations in the model map are r-0..r-3 in answer order: [p1,p2] valid, [p3] strong, [p4,p5] invalid, [p6] weak.
  const withEvals = (evals: Record<string, Evaluation>): ArgumentMap => ({
    ...model,
    relations: model.relations.map((r) => (evals[r.id] ? { ...r, evaluation: evals[r.id] } : r)),
  });
  const all: Record<string, Evaluation> = {
    'r-0': { type: 'deductive', quality: 'valid' },
    'r-1': { type: 'inductive', quality: 'strong' },
    'r-2': { type: 'deductive', quality: 'invalid' },
    'r-3': { type: 'inductive', quality: 'weak' },
  };
  const grade = (m: ArgumentMap) => gradeStep(butler, step, m);

  it('full marks for correct type and quality on every link', () => {
    const r = grade(withEvals(all));
    expect([r.earned, r.possible]).toEqual([8, 8]);
  });

  it('asks for missing evaluations', () => {
    const r = grade(model);
    expect(r.earned).toBe(0);
    expect(r.items.filter((i) => i.status === 'missing')).toHaveLength(4);
  });

  it('a wrong type gets the type hint and no quality credit', () => {
    const r = grade(withEvals({ ...all, 'r-1': { type: 'deductive', quality: 'valid' } }));
    expect([r.earned, r.possible]).toEqual([6, 8]);
    expect(r.items.find((i) => i.status === 'wrong')?.message).toMatch(/guarantee the conclusion, or only that they make it likely/);
  });

  it('a wrong quality gets the author hint when there is one, otherwise the automatic one', () => {
    const custom = grade(withEvals({ ...all, 'r-2': { type: 'deductive', quality: 'valid' } }));
    expect(custom.items.find((i) => i.status === 'wrong')?.message).toMatch(/What else might make someone nervous/);
    const auto = grade(withEvals({ ...all, 'r-3': { type: 'inductive', quality: 'strong' } }));
    expect(auto.items.find((i) => i.status === 'wrong')?.message).toMatch(/given everything on your map, how likely is the conclusion/);
  });

  const yaml = (evaluations: string, extra = '') => `
id: ev
title: Ev
steps:
  - instructions: s
    passage: "{{a|A}} and {{b|B}}, so {{c|C}}. But {{o|O}}."
    answer:
      conclusion: c
      relations:
        - { type: support, from: [a], to: c }
        - { type: support, from: [b], to: c, grouping: either }
        - { type: objection, from: [o], to: c }
  - task: evaluate
    instructions: e
${extra}
    evaluations:
${evaluations}
`;

  it('accepts a list of qualities, and ask: type grades only the type', () => {
    const lesson = compileLesson(yaml(`      - { link: { from: [a], to: c }, type: inductive, quality: [strong, weak] }`));
    const m = mapFromAnswer(lesson, lesson.steps[0].answers[0]);
    const set = (e: Evaluation) => ({ ...m, relations: m.relations.map((r) => (r.from[0] === 'n-a' ? { ...r, evaluation: e } : r)) });
    const strong = gradeStep(lesson, 1, set({ type: 'inductive', quality: 'strong' }));
    const weak = gradeStep(lesson, 1, set({ type: 'inductive', quality: 'weak' }));
    expect([strong.earned / strong.possible, weak.earned / weak.possible]).toEqual([1, 1]);
    const typeOnly = compileLesson(yaml(`      - { link: { from: [a], to: c }, type: inductive, quality: strong }`, '    ask: type'));
    const r = gradeStep(typeOnly, 1, set({ type: 'inductive' }));
    expect([r.earned, r.possible]).toEqual([1, 1]);
  });

  it('rejects evaluations that cannot be graded', () => {
    expect(() => compileLesson(yaml(`      - { link: { from: [a], to: c }, type: inductive, quality: valid }`))).toThrow(/inductive link is strong or weak/);
    expect(() => compileLesson(yaml(`      - { link: { from: [b], to: a }, type: inductive }`))).toThrow(/not a link in the answer/);
    expect(() => compileLesson(yaml(`      - { link: { from: [o], to: c }, type: inductive }`))).toThrow(/only support links are evaluated/);
    expect(() => compileLesson(yaml(`      - { link: { from: [b], to: c }, type: inductive }`))).toThrow(/needs a fixed grouping|evaluated links need a fixed grouping/);
  });
});

describe('explanation lessons', () => {
  const leaves = load('autumn-leaves.yaml');

  it('compiles with explains links and an explanandum', () => {
    expect(leaves.kind).toBe('explanation');
    expect(leaves.steps[1].answers[0].conclusion).toBe('e');
    expect(leaves.steps[1].answers[0].relations.every((r) => r.type === 'explanation')).toBe(true);
  });

  it('uses explanation wording in feedback', () => {
    const pickBackground = gradeStep(leaves, 0, {
      nodes: [{ id: 'n', text: '', source: leaves.claims.x1.source, position: { x: 0, y: 0 } }],
      relations: [],
      conclusion: 'n',
    });
    expect(pickBackground.items[0].message).toMatch(/part of the explanation. What does it help explain/);
    const empty = gradeStep(leaves, 1, { nodes: [], relations: [] });
    expect(empty.items[0].message).toMatch(/explanandum \(what is being explained\)/);
  });

  it('rejects mixing argument and explanation links', () => {
    const lesson = (kind: string, type: string) => `
id: k
title: K
kind: ${kind}
steps:
  - instructions: s
    passage: "{{a|A}} so {{b|B}}"
    answer: { conclusion: b, relations: [{ type: ${type}, from: [a], to: b }] }
`;
    expect(() => compileLesson(lesson('explanation', 'support'))).toThrow(/explanation lessons use/);
    expect(() => compileLesson(lesson('argument', 'explains'))).toThrow(/need `kind: explanation`/);
    expect(() =>
      compileLesson(
        lesson('explanation', 'explains') +
          `  - task: evaluate\n    instructions: e\n    evaluations: [{ link: { from: [a], to: b }, type: inductive }]\n`,
      ),
    ).toThrow(/apply to arguments, not explanations/);
  });
});

describe('authored mistakes', () => {
  const survey = load('survey.yaml');
  const withRelations = (stepIndex: number, relations: { type: string; from: string[]; to: string }[]) => {
    const answer = survey.steps[stepIndex].answers[0];
    return mapFromAnswer(survey, {
      ...answer,
      relations: relations.map((r) => ({ ...r, to: [r.to], grouping: 'exact', optional: false })),
    } as typeof answer);
  };

  it('shows the author’s note for a near-miss instead of the generic hint', () => {
    // The sample premise alone, without the unstated premise linked in.
    const alone = gradeStep(survey, 0, withRelations(0, [{ type: 'support', from: ['s'], to: 'c' }]));
    expect(alone.items.map((i) => i.message).join(' ')).toMatch(/would have to be true of them/);
    // The objection aimed at the conclusion rather than the premise it doubts.
    const atConclusion = gradeStep(
      survey,
      1,
      withRelations(1, [
        { type: 'support', from: ['s', 'r'], to: 'c' },
        { type: 'objection', from: ['o'], to: 'c' },
      ]),
    );
    expect(atConclusion.items.map((i) => i.message).join(' ')).toMatch(/isn't saying anything about how many students/);
  });
});
