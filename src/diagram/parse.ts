import type { Evaluation, InferenceQuality, InferenceType, RelationType } from '../model/types';
import type { Diagram, DiagramClaim, DiagramLink } from './model';

/**
 * Parses the `argmap` code-block syntax:
 *
 *   C*: The butler is the thief        a claim (`*` marks the main conclusion)
 *   P1: Only the butler had a key
 *   P1 + P2 -> C  [deductive, valid]   supports (linked premises joined with +)
 *   O -x C                             objects to (an objection to an objection reads "rebuts")
 *   E1 => X                            explains (makes the diagram an explanation)
 *   R -x O  @3                         appears on the 3rd click (1 = from the start)
 *
 * Blank lines and lines starting with # or // are ignored.
 */
export function parseArgmap(source: string, options: { kind?: string } = {}): { diagram: Diagram; errors: string[] } {
  const errors: string[] = [];
  const claims: DiagramClaim[] = [];
  const links: DiagramLink[] = [];
  let starred: string | undefined;
  const ARROWS: Record<string, RelationType> = { '->': 'support', '-x': 'objection', '=>': 'explanation' };

  source.split('\n').forEach((raw, i) => {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const where = `line ${i + 1}`;
    let step: number | undefined;
    const stepMatch = line.match(/\s@(\d+)\s*$/);
    if (stepMatch) {
      step = Number(stepMatch[1]);
      line = line.slice(0, stepMatch.index).trim();
    }

    const claim = line.match(/^([A-Za-z][\w-]*)(\*)?\s*:\s*(.+)$/);
    if (claim) {
      const [, id, star, text] = claim;
      if (claims.some((c) => c.id === id)) errors.push(`${where}: claim ${id} is defined twice`);
      claims.push({ id, text: text.trim(), step: step ?? 1 });
      if (star) {
        if (starred) errors.push(`${where}: only one claim can be starred as the conclusion`);
        starred = id;
      }
      return;
    }

    let evaluation: Evaluation | undefined;
    const evalMatch = line.match(/\[([^\]]*)\]\s*$/);
    if (evalMatch) {
      line = line.slice(0, evalMatch.index).trim();
      evaluation = {};
      for (const word of evalMatch[1].split(/[\s,]+/).filter(Boolean)) {
        if (word === 'deductive' || word === 'inductive') evaluation.type = word as InferenceType;
        else if (['valid', 'invalid', 'strong', 'weak'].includes(word)) evaluation.quality = word as InferenceQuality;
        else errors.push(`${where}: unknown evaluation "${word}" (use deductive/inductive and valid/invalid/strong/weak)`);
      }
    }
    const link = line.match(/^(.+?)\s*(->|-x|=>)\s*([A-Za-z][\w-]*)$/);
    if (!link) {
      errors.push(`${where}: expected "ID: text" or a link like "A + B -> C", got "${raw.trim()}"`);
      return;
    }
    const from = link[1].split('+').map((s) => s.trim());
    if (from.some((f) => !/^[A-Za-z][\w-]*$/.test(f))) {
      errors.push(`${where}: premises must be claim IDs joined with +`);
      return;
    }
    links.push({ type: ARROWS[link[2]], from, to: link[3], evaluation, step: step ?? 0 });
  });

  const ids = new Set(claims.map((c) => c.id));
  for (const l of links) {
    for (const id of [...l.from, l.to]) if (!ids.has(id)) errors.push(`link ${l.from.join(' + ')} → ${l.to}: no claim with ID ${id}`);
    if (l.from.includes(l.to)) errors.push(`link ${l.from.join(' + ')} → ${l.to}: a claim can't bear on itself`);
    // A link appears no earlier than its claims.
    const claimStep = Math.max(...[...l.from, l.to].map((id) => claims.find((c) => c.id === id)?.step ?? 1));
    l.step = Math.max(l.step, claimStep);
  }

  const explains = links.some((l) => l.type === 'explanation');
  if (explains && links.some((l) => l.type !== 'explanation')) errors.push('a diagram can use => (explains) or ->/-x, but not both');
  const kind = options.kind === 'explanation' || explains ? 'explanation' : 'argument';

  // Without a star, the conclusion is the claim that is supported (or explained) but supports nothing.
  const positive = links.filter((l) => l.type !== 'objection');
  const conclusion =
    starred ?? claims.find((c) => positive.some((l) => l.to === c.id) && !positive.some((l) => l.from.includes(c.id)))?.id;

  return { diagram: { kind, claims, links, conclusion }, errors };
}
