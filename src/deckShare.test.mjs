// Node self-tests for deckShare. Run: node src/deckShare.test.mjs
import { encodeShare, decodeShare } from "./deckShare.js";

let passed = 0;
const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); passed++; };

// round-trip with name, energies, mixed cards
{
  const deck = {
    name: "Mewtwo ex — control",
    energies: ["psychic", "fighting"],
    cards: [
      { kind: "pokemon", functionalId: 129, quantity: 2 },
      { kind: "trainer", functionalId: 5001, quantity: 2 },
    ],
  };
  const code = encodeShare(deck);
  assert(typeof code === "string" && code.length > 0, "produces a string");
  assert(!/[+/=]/.test(code), "url-safe (no + / =)");
  const back = decodeShare(code);
  assert(back.name === deck.name, "name round-trips");
  assert(JSON.stringify(back.energies) === JSON.stringify(deck.energies), "energies round-trip");
  assert(back.cards.length === 2, "card count");
  assert(back.cards[0].kind === "pokemon" && back.cards[0].functionalId === 129 && back.cards[0].quantity === 2, "pokemon entry");
  assert(back.cards[1].kind === "trainer" && back.cards[1].functionalId === 5001, "trainer entry");
}

// unicode name survives
{
  const code = encodeShare({ name: "デッキ ⚡", energies: [], cards: [] });
  assert(decodeShare(code).name === "デッキ ⚡", "unicode name round-trips");
}

// empty deck
{
  const code = encodeShare({});
  const back = decodeShare(code);
  assert(back.name === "" && back.cards.length === 0 && back.energies.length === 0, "empty deck ok");
}

// garbage input throws
{
  let threw = false;
  try { decodeShare("not-a-valid-code!!!"); } catch { threw = true; }
  assert(threw, "invalid code throws");
}

console.log(`All ${passed} deckShare assertions passed.`);
