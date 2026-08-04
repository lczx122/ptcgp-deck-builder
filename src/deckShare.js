// Compact, URL-safe serialization of a deck for shareable links.
// Independent of the QR game format (encoder.js): this handles partial decks
// and a deck name, and stores only what's needed to rebuild against the card
// database (kind + functionalId + quantity, plus energies and name).

function base64urlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Serialize {name, energies, cards:[{kind, functionalId, quantity}]} -> URL-safe string. */
export function encodeShare({ name = "", energies = [], cards = [] } = {}) {
  const payload = {
    n: name || undefined,
    e: energies,
    // [0|1 (pokemon|trainer), functionalId, quantity]
    c: cards.map(c => [c.kind === "pokemon" ? 0 : 1, c.functionalId, c.quantity]),
  };
  const json = JSON.stringify(payload);
  return base64urlEncode(new TextEncoder().encode(json));
}

/** Parse a share string back to {name, energies, cards:[{kind, functionalId, quantity}]}. */
export function decodeShare(str) {
  const json = new TextDecoder().decode(base64urlDecode(String(str).trim()));
  const p = JSON.parse(json);
  if (!p || !Array.isArray(p.c)) throw new Error("Invalid share code.");
  return {
    name: typeof p.n === "string" ? p.n : "",
    energies: Array.isArray(p.e) ? p.e : [],
    cards: p.c.map(([k, id, q]) => ({
      kind: k === 0 ? "pokemon" : "trainer",
      functionalId: Number(id),
      quantity: Number(q),
    })),
  };
}
