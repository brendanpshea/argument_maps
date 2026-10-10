/**
 * Where each claim stands in the debate a map records. This is worked out from
 * the map's structure alone; it never judges whether a claim is true.
 *
 * - An objection stands unless one of its own claims is challenged.
 * - A claim is *challenged* if some objection to it stands.
 * - A claim is *answered* if it has objections and none of them stands
 *   (each one has been rebutted).
 *
 * Claims with no objections get no status.
 */
export type ClaimStatus = 'challenged' | 'answered';

interface Link {
  type: string;
  from: string[];
  to: string;
}

export function claimStatuses(links: Link[]): Map<string, ClaimStatus> {
  const objections = links.filter((l) => l.type === 'objection');
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();

  const challenged = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    // A cycle of objections can't be settled from structure; treat it as unsettled (not challenged).
    if (visiting.has(id)) return false;
    visiting.add(id);
    const result = objections.some((o) => o.to === id && !o.from.some(challenged));
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };

  const statuses = new Map<string, ClaimStatus>();
  for (const id of new Set(objections.map((o) => o.to))) statuses.set(id, challenged(id) ? 'challenged' : 'answered');
  return statuses;
}

export const STATUS_LABEL: Record<ClaimStatus, string> = { challenged: '? challenged', answered: '✓ answered' };
export const STATUS_TITLE: Record<ClaimStatus, string> = {
  challenged: 'Challenged: an objection to this claim has not been answered.',
  answered: 'Answered: every objection to this claim has been rebutted.',
};
export const CHALLENGED_COLOR = '#a15c00';
export const CHALLENGED_FILL = '#fff4e0';
