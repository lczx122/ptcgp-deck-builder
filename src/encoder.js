
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

export function base64ToBytes(base64) {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodeDeck(bytes) {
  let offset = 0;
  const readByte = label => {
    if (offset >= bytes.length) throw new Error(`Truncated payload while reading ${label}.`);
    return bytes[offset++];
  };
  const readU24 = () => {
    if (offset + 3 > bytes.length) throw new Error("Truncated payload while reading a card ID.");
    const value = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
    offset += 3;
    return value;
  };

  const trainerCount = readByte("the trainer count");
  const trainers = [];
  for (let i = 0; i < trainerCount; i++) {
    const value = readU24();
    if (value < TRAINER_OFFSET) throw new Error(`Invalid trainer card ID: ${value}.`);
    trainers.push(value - TRAINER_OFFSET);
  }

  const pokemonCount = readByte("the Pokémon count");
  const pokemon = [];
  for (let i = 0; i < pokemonCount; i++) pokemon.push(readU24());

  const energyCount = readByte("the energy count");
  const codeToEnergy = Object.fromEntries(
    Object.entries(ENERGY_CODES).map(([name, code]) => [code, name])
  );
  const energies = [];
  for (let i = 0; i < energyCount; i++) {
    const code = readByte("an energy code");
    const name = codeToEnergy[code];
    if (!name) throw new Error(`Unknown energy code: ${code}.`);
    energies.push(name);
  }

  if (offset !== bytes.length) throw new Error("Payload has unexpected trailing bytes.");
  if (trainerCount + pokemonCount !== 20) {
    throw new Error(`Payload contains ${trainerCount + pokemonCount} cards; expected 20.`);
  }
  return { trainers, pokemon, energies };
}
