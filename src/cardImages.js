// Card-art URL construction and fallback ordering (pure, unit-tested).

// Community mirrors host art as cards-by-set/{set}/{number}.webp.
export const IMAGE_MIRRORS = [
  "https://cdn.jsdelivr.net/gh/flibustier/pokemon-tcg-exchange@main/public/images/cards-by-set",
  "https://raw.githubusercontent.com/flibustier/pokemon-tcg-exchange/main/public/images/cards-by-set",
];
// LimitlessTCG's CDN — comprehensive, current, no hotlink protection. Different
// shape: pocket/{SET}/{SET}_{NNN}_EN.webp with a zero-padded 3-digit number.
export const LIMITLESS_BASE = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket";

/**
 * Ordered list of URLs to try for a given set/number, most-preferred first:
 * self-hosted (if provided) → community mirrors → Limitless.
 * opts: { localBase?: string, selfHosted?: boolean }
 */
export function imageSourcesFor(set, number, opts = {}) {
  const { localBase = null, selfHosted = false } = opts;
  const mirrors = selfHosted && localBase ? [localBase, ...IMAGE_MIRRORS] : IMAGE_MIRRORS;
  const n3 = String(number).padStart(3, "0");
  return [
    ...mirrors.map(base => `${base}/${set}/${number}.webp`),
    `${LIMITLESS_BASE}/${set}/${set}_${n3}_EN.webp`,
  ];
}
