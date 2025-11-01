// vision/graph.js
// Helper to compute classes for node bubbles (adds red halo on block)

export function nodeClassesFor(result, nodeAddress) {
  const addr = String(nodeAddress || '').toLowerCase();
  const focus = String(result?.address || '').toLowerCase();
  const base = ['node'];

  const blocked = !!(result?.block || result?.risk_score === 100 || result?.sanctionHits);

  // Focused address gets the special halo classes
  if (addr && focus && addr === focus) {
    base.push('halo');
    if (blocked) base.push('halo-red');
  }

  // Score band classes if you use them
  const score = typeof result?.risk_score === 'number' ? result.risk_score :
                (typeof result?.score === 'number' ? result.score : 0);
  base.push(bandClass(score, blocked));

  return base.join(' ');
}

function bandClass(score, blocked){
  if (blocked || score >= 80) return 'band-high';
  if (score >= 60) return 'band-elevated';
  return 'band-moderate';
}
// Export compatibility for existing imports
export const graph = { nodeClassesFor };
