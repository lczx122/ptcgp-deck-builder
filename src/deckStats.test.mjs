// Node self-tests for deckStats. Run: node src/deckStats.test.mjs
import { analyzeDeck } from "./deckStats.js";

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
}

// helper to build a deck entry
const pk = (element, quantity, rarity = "C") => ({ kind: "pokemon", element, rarity, quantity });
const tr = (quantity, rarity = "C") => ({ kind: "trainer", element: "", rarity, quantity });

// --- a legal 20-card deck ---
{
  const deck = [pk("fire", 2), pk("fire", 2), tr(2)];
  // 4 pokemon + 2 trainers = 6; pad with trainers to 20
  deck.push(tr(2), tr(2), tr(2), tr(2), tr(2), tr(2)); // +12 => 18
  deck.push(tr(2)); // 20
  const r = analyzeDeck(deck, ["fire"]);
  assert(r.total === 20, "total 20");
  assert(r.pokemonCount === 4, "pokemon count");
  assert(r.trainerCount === 16, "trainer count");
  assert(r.legal === true, "legal when 20 + energy + has pokemon");
  assert(r.elementCounts.fire === 4, "fire element count");
}

// --- under 20 is an error ---
{
  const r = analyzeDeck([pk("water", 2)], ["water"]);
  assert(r.legal === false, "under 20 illegal");
  assert(r.warnings.some(w => w.level === "error" && /18 more/.test(w.text)), "reports add 18 more");
}

// --- no pokemon is an error even at 20 cards ---
{
  const deck = Array.from({ length: 10 }, () => tr(2));
  const r = analyzeDeck(deck, ["water"]);
  assert(r.total === 20, "20 trainers");
  assert(r.pokemonCount === 0, "zero pokemon");
  assert(r.warnings.some(w => w.level === "error" && /Basic Pok/.test(w.text)), "warns needs basic pokemon");
  assert(r.legal === false, "illegal without pokemon");
}

// --- energy selection bounds ---
{
  const deck = [pk("fire", 2)];
  assert(analyzeDeck(deck, []).warnings.some(w => /at least one energy/i.test(w.text)), "no energy error");
  assert(analyzeDeck(deck, ["fire", "water", "grass", "metal"]).warnings.some(w => /three energy/i.test(w.text)), "too many energy error");
}

// --- soft hint: pokemon element without matching energy ---
{
  const deck = [pk("fire", 2), pk("water", 2)];
  const r = analyzeDeck(deck, ["fire"]);
  assert(r.warnings.some(w => w.level === "warn" && /Water Pok/.test(w.text)), "warns water pokemon no water energy");
}

// --- soft hint: energy with no matching pokemon (only when elements known) ---
{
  const known = analyzeDeck([pk("fire", 2)], ["fire", "water"]);
  assert(known.warnings.some(w => w.level === "warn" && /Water Energy selected but no Water/.test(w.text)), "warns unused water energy");
  const unknown = analyzeDeck([pk("", 2)], ["water"]); // element unknown -> suppress false positive
  assert(!unknown.warnings.some(w => /no Water Pok/.test(w.text)), "suppresses unused-energy hint when elements unknown");
  assert(unknown.unknownElement === 2, "counts unknown element");
}

console.log(`All ${passed} deckStats assertions passed.`);
