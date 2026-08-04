// Pure deck analysis + validation. No DOM here so it can be unit-tested.

// The eight deck energy types (colorless is a Pokémon element but never a
// selectable deck energy, matching ENERGY_CODES in encoder.js).
export const ENERGY_TYPES = [
  "grass", "fire", "water", "lightning", "psychic", "fighting", "darkness", "metal",
];

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Analyze a deck (array of {kind, element, rarity, quantity, ...}) plus the
 * selected energy types. Returns counts, distributions, and a list of
 * warnings ({level:"error"|"warn", text}). `legal` is true when there are no
 * error-level warnings (i.e. the deck can be shared into the game).
 */
export function analyzeDeck(deck = [], selectedEnergies = []) {
  const total = deck.reduce((s, c) => s + (c.quantity || 0), 0);
  const pokemon = deck.filter(c => c.kind === "pokemon");
  const pokemonCount = pokemon.reduce((s, c) => s + (c.quantity || 0), 0);
  const trainerCount = deck.filter(c => c.kind === "trainer").reduce((s, c) => s + (c.quantity || 0), 0);

  const elementCounts = {};
  let unknownElement = 0;
  for (const c of pokemon) {
    if (c.element) elementCounts[c.element] = (elementCounts[c.element] || 0) + c.quantity;
    else unknownElement += c.quantity;
  }

  const rarityCounts = {};
  for (const c of deck) {
    const r = c.rarity || "?";
    rarityCounts[r] = (rarityCounts[r] || 0) + c.quantity;
  }

  const sel = new Set(selectedEnergies);
  const warnings = [];

  if (total > 20) warnings.push({ level: "error", text: `Deck has ${total} cards — remove ${total - 20}.` });
  else if (total < 20) warnings.push({ level: "error", text: `Deck has ${total}/20 cards — add ${20 - total} more.` });

  if (selectedEnergies.length < 1) warnings.push({ level: "error", text: "Select at least one energy type." });
  if (selectedEnergies.length > 3) warnings.push({ level: "error", text: "At most three energy types allowed." });

  if (pokemonCount === 0) {
    warnings.push({ level: "error", text: "A legal deck needs at least one Basic Pokémon." });
  }

  // Soft hint: a Pokémon element present with no matching energy selected.
  for (const el of Object.keys(elementCounts)) {
    if (ENERGY_TYPES.includes(el) && !sel.has(el)) {
      warnings.push({ level: "warn", text: `${elementCounts[el]}× ${cap(el)} Pokémon but no ${cap(el)} Energy selected.` });
    }
  }
  // Soft hint: a selected energy with no matching Pokémon (only when all
  // Pokémon elements are known, else it may be a false positive).
  if (unknownElement === 0) {
    for (const el of selectedEnergies) {
      if (!elementCounts[el]) {
        warnings.push({ level: "warn", text: `${cap(el)} Energy selected but no ${cap(el)} Pokémon in the deck.` });
      }
    }
  }

  const legal = !warnings.some(w => w.level === "error");
  return {
    total, pokemonCount, trainerCount,
    elementCounts, unknownElement, rarityCounts,
    warnings, legal,
  };
}
