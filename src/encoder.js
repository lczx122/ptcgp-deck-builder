
export const ENERGY_CODES = {
  grass: 1,
  fire: 2,
  water: 3,
  lightning: 4,
  psychic: 5,
  fighting: 6,
  darkness: 7,
  metal: 8,
};

const TRAINER_OFFSET = 10_000_000;

function pushU24(bytes, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new Error(`Invalid card ID: ${value}`);
  }
  bytes.push((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function expand(cards) {
  return cards.flatMap(card => Array.from({ length: card.quantity }, () => card));
}

export function encodeDeck(cards, energies) {
  const total = cards.reduce((sum, card) => sum + card.quantity, 0);
  if (total !== 20) throw new Error(`Deck must contain exactly 20 cards. Current total: ${total}.`);
  if (energies.length < 1 || energies.length > 3) {
    throw new Error("Select between one and three energy types.");
  }

  const trainers = expand(cards.filter(card => card.kind === "trainer"))
    .sort((a, b) => a.functionalId - b.functionalId);
  const pokemon = expand(cards.filter(card => card.kind === "pokemon"))
    .sort((a, b) => a.functionalId - b.functionalId);

  const bytes = [trainers.length];
  for (const card of trainers) pushU24(bytes, TRAINER_OFFSET + card.functionalId);

  bytes.push(pokemon.length);
  for (const card of pokemon) pushU24(bytes, card.functionalId);

  bytes.push(energies.length);
  for (const energy of energies.sort((a, b) => ENERGY_CODES[a] - ENERGY_CODES[b])) {
    bytes.push(ENERGY_CODES[energy]);
  }

  return new Uint8Array(bytes);
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}
