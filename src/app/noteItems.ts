// Sorting of a model's notes for the details dialog (no DOM: also used by the scripts).

export type Section = 'simulated' | 'assumed' | 'missing';

/** A list of what is not simulated: it starts or ends with the words. */
const NOT_SIMULATED = /^(non simulé|not simulated)|(non simulée?s?|pas simulée?s?|(are|is) not simulated)$/i;
/** Splits at the semicolons outside brackets. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const ASSUMED = /suppos|assum|non indiqu|not given|déduit|deduc|non vérifié|not verified|fictive|fictitious/i;

/**
 * Splits the model's notes into short items and sorts them: what is simulated, what is assumed or
 * deduced (the manual is silent), what is not simulated. Long sentences are split at their semicolons.
 */
export function noteItems(notes: string): Record<Section, string[]> {
  const out: Record<Section, string[]> = { simulated: [], assumed: [], missing: [] };
  const sentences = notes.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"(§])/);
  for (const sentence of sentences) {
    const parts = sentence.length > 160 ? splitTopLevel(sentence) : [sentence];
    for (const raw of parts) {
      const trimmed = raw.trim().replace(/[.;]$/, '');
      const item = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      if (!item) continue;
      const section: Section = NOT_SIMULATED.test(item) ? 'missing' : ASSUMED.test(item) ? 'assumed' : 'simulated';
      // Under the "Not simulated" title, a leading "Not simulated:" is redundant.
      const text = section === 'missing' ? item.replace(/^(non simulée?s?|not simulated)\s*:\s*/i, '') : item;
      out[section].push(text.charAt(0).toUpperCase() + text.slice(1));
    }
  }
  return out;
}
