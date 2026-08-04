
import QRCode from "qrcode";
import "./styles.css";
import { encodeDeck, bytesToBase64, base64ToBytes, decodeDeck, ENERGY_CODES } from "./encoder.js";
import { analyzeDeck } from "./deckStats.js";
import { encodeShare, decodeShare } from "./deckShare.js";
import { imageSourcesFor } from "./cardImages.js";

const STORAGE_KEY = "ptcgp:decks";

const CDN_BASE = "https://cdn.jsdelivr.net/npm/pokemon-tcg-pocket-database/dist";
const LOCAL_BASE = `${import.meta.env.BASE_URL}data`;
// Self-hosted art in the repo, for sets a mirror hasn't published yet.
// public/images/manifest.json lists which set codes are self-hosted.
const LOCAL_IMAGES = `${import.meta.env.BASE_URL}images/cards-by-set`;
const IMAGE_RE = /^c(PK|TR)_(\d+)_(\d+)_(\d+)_(.+)_([A-Z]+)\.webp$/;

const state = {
  cards: [],
  filtered: [],
  deck: [],
  energies: new Set(["water"]),
  query: "",
  type: "all",
  set: "all",
  rarity: "all",
  sort: "set",
  exOnly: false,
  generatedBase64: "",
  setInfo: new Map(),
  elements: new Map(), // image filename -> element, for the type badge
  selfHostedSets: new Set(), // set codes whose art is self-hosted in the repo
  deckName: "",
  variants: new Map(), // functional key -> [{set, number, rarity}] all printings
};

document.querySelector("#app").innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <div class="brand">
      <div class="logo"></div>
      <div><h1>Pocket Deck QR Builder</h1><small>Build a deck and scan it directly into Pokémon TCG Pocket</small></div>
    </div>
    <div class="top-actions">
      <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">🌙</button>
      <button class="btn btn-secondary" id="importBtn">Import deck</button>
      <button class="btn btn-secondary" id="exportBtn">Export deck JSON</button>
      <button class="btn btn-danger" id="clearBtn">Clear deck</button>
    </div>
  </header>

  <main class="main">
    <section class="panel">
      <div class="panel-head">
        <h2>Card database</h2>
        <p>Alternate artworks are grouped by functional card identity.</p>
        <div class="controls">
          <input class="input" id="searchInput" placeholder="Search by card name…" />
          <select class="select" id="typeFilter">
            <option value="all">All card types</option>
            <option value="pokemon">Pokémon</option>
            <option value="trainer">Trainer</option>
          </select>
          <select class="select" id="setFilter"><option value="all">All sets</option></select>
          <select class="select" id="rarityFilter"><option value="all">All rarities</option></select>
          <select class="select" id="sortSelect">
            <option value="set">Sort: Newest set</option>
            <option value="name">Sort: Name (A–Z)</option>
            <option value="number">Sort: Set &amp; number</option>
            <option value="rarity">Sort: Rarity</option>
          </select>
          <button class="pill-toggle" id="exToggle" aria-pressed="false">ex only</button>
        </div>
      </div>
      <div class="results" id="results"></div>
    </section>

    <aside class="panel deck-panel">
      <div class="deck-tools">
        <input class="input" id="deckName" placeholder="Deck name (optional)" maxlength="60" />
        <div class="deck-tools-row">
          <select class="select" id="savedDecks"><option value="">Load saved deck…</option></select>
          <button class="btn btn-secondary" id="saveDeckBtn">Save</button>
          <button class="btn btn-secondary" id="deleteDeckBtn" title="Delete the saved deck with this name">Delete</button>
          <button class="btn btn-secondary" id="shareBtn">Share link</button>
        </div>
      </div>
      <div class="deck-summary">
        <div>
          <strong>Your deck</strong>
          <div class="progress"><div id="progressBar" style="width:0%"></div></div>
        </div>
        <div class="counter"><span id="deckCount">0</span>/20</div>
      </div>
      <div id="deckList" class="deck-list"></div>

      <div class="stats-section" id="statsSection"></div>

      <div class="energy-section">
        <strong>Energy</strong>
        <div class="energy-grid" id="energyGrid"></div>
      </div>

      <div class="output-section">
        <button class="btn btn-primary generate" id="generateBtn">Generate share QR</button>
        <div class="message" id="message"></div>
        <div class="qr-wrap" id="qrWrap">
          <canvas id="qrCanvas"></canvas>
          <div class="payload-box">
            <input class="input" id="payloadInput" readonly />
            <button class="btn btn-secondary" id="copyBtn">Copy</button>
          </div>
          <button class="btn btn-secondary generate" id="downloadBtn">Download QR PNG</button>
        </div>
      </div>
      <div class="footer-note">
        The QR encoder uses the reverse-engineered Pocket deck-share format. Deck names and cosmetic card variants are intentionally not encoded by the game.
      </div>
    </aside>
  </main>
</div>

<div class="lightbox" id="lightbox">
  <div class="lightbox-inner">
    <button class="lightbox-close" id="lightboxClose" aria-label="Close">×</button>
    <div class="lightbox-art"><img id="lightboxImg" alt="" /></div>
    <div class="lightbox-info">
      <h3 id="lightboxName"></h3>
      <div class="meta" id="lightboxMeta"></div>
      <div class="lightbox-badges" id="lightboxBadges"></div>
      <div class="variant-block" id="lightboxVariantBlock" hidden>
        <div class="variant-title">Other prints (cosmetic — same deck code)</div>
        <div class="variant-strip" id="lightboxVariants"></div>
      </div>
      <button class="btn btn-primary" id="lightboxAdd">Add to deck</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="modalBackdrop">
  <div class="modal">
    <h3 id="modalTitle">Import deck JSON</h3>
    <p id="modalHelp">Paste a previously exported deck JSON below.</p>
    <textarea id="modalText"></textarea>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modalCancel">Cancel</button>
      <button class="btn btn-primary" id="modalConfirm">Import</button>
    </div>
  </div>
</div>
`;

const els = Object.fromEntries([
  "results","searchInput","typeFilter","setFilter","deckList","deckCount","progressBar",
  "energyGrid","statsSection","generateBtn","message","qrWrap","qrCanvas","payloadInput","copyBtn",
  "downloadBtn","clearBtn","importBtn","exportBtn","modalBackdrop","modalTitle",
  "modalHelp","modalText","modalCancel","modalConfirm",
  "deckName","savedDecks","saveDeckBtn","deleteDeckBtn","shareBtn",
  "rarityFilter","sortSelect","exToggle","lightbox","lightboxClose","lightboxImg",
  "lightboxName","lightboxMeta","lightboxBadges","lightboxAdd","themeToggle",
  "lightboxVariantBlock","lightboxVariants"
].map(id => [id, document.getElementById(id)]));

function setMessage(text, type = "") {
  els.message.textContent = text;
  els.message.className = `message ${type}`;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function normalizeCard(card) {
  const match = IMAGE_RE.exec(card.image || "");
  if (!match) return null;
  const prefix = match[1];
  return {
    key: `${prefix}-${Number(match[3])}`,
    name: card.name,
    set: card.set,
    number: card.number,
    rarity: card.rarity,
    kind: prefix === "PK" ? "pokemon" : "trainer",
    functionalId: Number(match[3]),
    element: card.element || state.elements.get(card.image) || "",
    subtype: card.type || "",
  };
}

function uniqueFunctionalCards(raw) {
  const map = new Map();          // key -> representative (base) card for the builder
  const variants = new Map();     // key -> [{set, number, rarity}] every printing
  for (const item of raw) {
    const card = normalizeCard(item);
    if (!card) continue;
    if (!map.has(card.key)) map.set(card.key, card);
    if (!variants.has(card.key)) variants.set(card.key, []);
    variants.get(card.key).push({ set: card.set, number: card.number, rarity: card.rarity });
  }
  // Order each card's printings base-rarity first, so the showcase reads low→high.
  for (const list of variants.values()) {
    list.sort((a, b) => (RARITY_RANK[a.rarity] ?? 0) - (RARITY_RANK[b.rarity] ?? 0) || a.number - b.number);
  }
  state.variants = variants;
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function populateSetFilter() {
  const sets = [...new Set(state.cards.map(card => card.set))];
  // Newest sets first, using release dates from sets.json when available.
  sets.sort((a, b) => {
    const dateA = state.setInfo.get(a)?.releaseDate || "0000-00-00";
    const dateB = state.setInfo.get(b)?.releaseDate || "0000-00-00";
    return dateB.localeCompare(dateA) || a.localeCompare(b);
  });
  for (const set of sets) {
    const option = document.createElement("option");
    option.value = set;
    const name = state.setInfo.get(set)?.name?.en;
    option.textContent = name ? `${set} · ${name}` : set;
    els.setFilter.appendChild(option);
  }
}

const RARITY_LABELS = {
  C: "Common", U: "Uncommon", R: "Rare", RR: "Double Rare (ex)",
  AR: "Art Rare", SR: "Super Rare", SAR: "Special Art Rare",
  SSR: "Shiny Super Rare", S: "Shiny", UR: "Crown Rare", IM: "Immersive",
};
const RARITY_RANK = { C: 0, U: 1, R: 2, RR: 3, AR: 4, SR: 5, SAR: 6, SSR: 7, S: 8, IM: 9, UR: 10 };
const isEx = card => /\sex$/i.test(card.name);
const setDate = s => state.setInfo.get(s)?.releaseDate || "0000-00-00";
const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  set: (a, b) => setDate(b.set).localeCompare(setDate(a.set)) || a.set.localeCompare(b.set) || a.number - b.number,
  number: (a, b) => a.set.localeCompare(b.set) || a.number - b.number,
  rarity: (a, b) => (RARITY_RANK[b.rarity] ?? -1) - (RARITY_RANK[a.rarity] ?? -1) || a.name.localeCompare(b.name),
};

function populateRarityFilter() {
  const present = [...new Set(state.cards.map(c => c.rarity).filter(Boolean))]
    .sort((a, b) => (RARITY_RANK[a] ?? 99) - (RARITY_RANK[b] ?? 99));
  for (const r of present) {
    const option = document.createElement("option");
    option.value = r;
    option.textContent = RARITY_LABELS[r] || r;
    els.rarityFilter.appendChild(option);
  }
}

// Ordered art URLs for a set/number (self-hosted → mirrors → Limitless).
function sourcesFor(set, number) {
  return imageSourcesFor(set, number, {
    localBase: LOCAL_IMAGES,
    selfHosted: state.selfHostedSets.has(set),
  });
}
function cardImageSources(card) {
  return sourcesFor(card.set, card.number);
}

// Point an <img> at a list of source URLs, walking the fallback chain, then
// hiding it (revealing the initials placeholder) when every source fails.
function loadImageFromSources(img, sources) {
  const holder = img.parentElement;
  let attempt = 0;
  img.style.display = "";
  if (holder) holder.classList.add("loading");
  img.onload = () => { if (holder) holder.classList.remove("loading"); };
  img.onerror = () => {
    attempt += 1;
    if (attempt < sources.length) {
      img.src = sources[attempt];
    } else {
      img.onerror = null;
      img.style.display = "none";
      if (holder) holder.classList.remove("loading");
    }
  };
  img.src = sources[0];
}
function loadCardImage(img, card) {
  loadImageFromSources(img, cardImageSources(card));
}

function applyFilters() {
  const q = state.query.toLowerCase().trim();
  const list = state.cards.filter(card =>
    (!q || card.name.toLowerCase().includes(q))
    && (state.type === "all" || card.kind === state.type)
    && (state.set === "all" || card.set === state.set)
    && (state.rarity === "all" || card.rarity === state.rarity)
    && (!state.exOnly || isEx(card)));
  list.sort(SORTERS[state.sort] || SORTERS.name);
  state.filtered = list.slice(0, 240);
  renderResults();
}

function cardQuantity(card) {
  return state.deck.find(item => item.key === card.key)?.quantity || 0;
}

function renderResults() {
  els.results.innerHTML = "";
  if (!state.filtered.length) {
    els.results.innerHTML = `<div class="empty">No matching cards found.</div>`;
    return;
  }

  for (const card of state.filtered) {
    const tile = document.createElement("article");
    tile.className = "card-tile";
    const initials = card.name.split(/\s+/).slice(0,2).map(x => x[0]).join("");
    tile.innerHTML = `
      <div class="card-art">
        <span class="card-art-fallback">${initials}</span>
        <img loading="lazy" alt="">
      </div>
      <div class="card-body">
        <div class="card-name">${card.name}</div>
        <div class="meta">${card.set} #${card.number} · ID ${card.functionalId}</div>
        <div class="card-actions">
          <span class="badge">${card.kind === "pokemon" ? "Pokémon" : "Trainer"}${card.element ? ` · ${card.element}` : ""}</span>
          <button class="btn btn-primary">Add${cardQuantity(card) ? ` (${cardQuantity(card)})` : ""}</button>
        </div>
      </div>`;
    loadCardImage(tile.querySelector("img"), card);
    tile.querySelector(".card-art").addEventListener("click", () => openLightbox(card));
    tile.querySelector("button").addEventListener("click", () => addCard(card));
    els.results.appendChild(tile);
  }
}

function deckTotal() {
  return state.deck.reduce((sum, card) => sum + card.quantity, 0);
}

function addCard(card) {
  if (deckTotal() >= 20) return setMessage("The deck already contains 20 cards.", "error");
  const existing = state.deck.find(item => item.key === card.key);
  if (existing) {
    if (existing.quantity >= 2) return setMessage("A functional card can appear at most twice.", "error");
    existing.quantity += 1;
  } else {
    state.deck.push({ ...card, quantity: 1 });
  }
  setMessage("");
  renderDeck();
  renderResults();
}

function adjustQuantity(key, delta) {
  const item = state.deck.find(card => card.key === key);
  if (!item) return;
  if (delta > 0 && deckTotal() >= 20) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.deck = state.deck.filter(card => card.key !== key);
  if (item.quantity > 2) item.quantity = 2;
  renderDeck();
  renderResults();
}

function renderDeck() {
  const total = deckTotal();
  els.deckCount.textContent = total;
  els.progressBar.style.width = `${Math.min(100, total / 20 * 100)}%`;
  els.deckList.innerHTML = "";

  if (!state.deck.length) {
    els.deckList.innerHTML = `<div class="empty">Add cards from the database to begin.</div>`;
  } else {
    for (const card of [...state.deck].sort((a,b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))) {
      const row = document.createElement("div");
      row.className = "deck-row";
      row.innerHTML = `
        <div class="deck-thumb"><img loading="lazy" alt=""></div>
        <div><strong>${escapeHtml(card.name)}</strong><div class="meta">${card.kind} · ${card.set} #${card.number}</div></div>
        <div class="qty-controls">
          <button class="qty-btn minus">−</button>
          <strong>${card.quantity}</strong>
          <button class="qty-btn plus">+</button>
        </div>`;
      loadCardImage(row.querySelector(".deck-thumb img"), card);
      row.querySelector(".deck-thumb").onclick = () => openLightbox(card);
      row.querySelector(".minus").onclick = () => adjustQuantity(card.key, -1);
      row.querySelector(".plus").onclick = () => adjustQuantity(card.key, 1);
      els.deckList.appendChild(row);
    }
  }
  els.qrWrap.classList.remove("visible");
  renderStats();
}

const ENERGY_LABELS = {
  grass: "Grass", fire: "Fire", water: "Water", lightning: "Lightning",
  psychic: "Psychic", fighting: "Fighting", darkness: "Darkness", metal: "Metal",
  colorless: "Colorless",
};

function renderStats() {
  const stats = analyzeDeck(state.deck, [...state.energies]);
  const elementChips = Object.entries(stats.elementCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([el, n]) => `<span class="type-chip type-${el}"><i></i>${ENERGY_LABELS[el] || el} ${n}</span>`)
    .join("");
  const unknownChip = stats.unknownElement
    ? `<span class="type-chip type-unknown"><i></i>Unknown ${stats.unknownElement}</span>` : "";
  const chips = elementChips || unknownChip
    ? `<div class="type-chips">${elementChips}${unknownChip}</div>` : "";

  const status = stats.legal
    ? `<div class="legal-ok">✓ Legal deck — ready to share</div>` : "";
  const warnList = stats.warnings.length
    ? `<ul class="warn-list">${stats.warnings.map(w =>
        `<li class="warn-${w.level}">${w.level === "error" ? "⛔" : "⚠️"} ${w.text}</li>`).join("")}</ul>` : "";

  els.statsSection.innerHTML = `
    <div class="stats-head">
      <strong>Deck analysis</strong>
      <span class="split">${stats.pokemonCount} Pokémon · ${stats.trainerCount} Trainer</span>
    </div>
    ${chips}
    ${status}
    ${warnList}`;
}

function renderEnergies() {
  els.energyGrid.innerHTML = "";
  for (const name of Object.keys(ENERGY_CODES)) {
    const button = document.createElement("button");
    button.className = `energy-pill ${state.energies.has(name) ? "active" : ""}`;
    button.textContent = name[0].toUpperCase() + name.slice(1);
    button.onclick = () => {
      if (state.energies.has(name)) state.energies.delete(name);
      else if (state.energies.size < 3) state.energies.add(name);
      else return setMessage("A deck can use at most three energy types.", "error");
      renderEnergies();
      els.qrWrap.classList.remove("visible");
      setMessage("");
    };
    els.energyGrid.appendChild(button);
  }
  renderStats();
}

async function generateQR() {
  try {
    const payload = encodeDeck(state.deck, [...state.energies]);
    const base64 = bytesToBase64(payload);
    state.generatedBase64 = base64;
    await QRCode.toCanvas(els.qrCanvas, base64, {
      version: 9,
      errorCorrectionLevel: "H",
      maskPattern: 1,
      margin: 4,
      width: 720,
      color: { dark: "#0077c8", light: "#ffffff" },
    });
    els.payloadInput.value = base64;
    els.qrWrap.classList.add("visible");
    setMessage(`Valid ${payload.length}-byte deck payload generated.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function exportDeck() {
  const data = {
    version: 1,
    name: state.deckName || "",
    cards: state.deck.map(({key,name,set,number,kind,functionalId,quantity}) => ({
      key,name,set,number,kind,functionalId,quantity
    })),
    energies: [...state.energies],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pocket-deck.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function openImportModal() {
  els.modalTitle.textContent = "Import deck";
  els.modalHelp.textContent = "Paste a previously exported deck JSON, or the Base64 payload from a share QR code.";
  els.modalText.value = "";
  els.modalBackdrop.classList.add("visible");
}

function importDeckJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.cards) || !Array.isArray(data.energies)) throw new Error("Invalid deck JSON.");
  const total = data.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0);
  if (total > 20) throw new Error("Imported deck contains more than 20 cards.");
  state.deck = data.cards.map(card => ({...card, quantity: Number(card.quantity)}));
  state.energies = new Set(data.energies);
  state.deckName = typeof data.name === "string" ? data.name : "";
  els.deckName.value = state.deckName;
  setMessage("Deck imported.", "success");
}

function importDeckPayload(text) {
  let bytes;
  try {
    bytes = base64ToBytes(text);
  } catch {
    throw new Error("That doesn't look like valid deck JSON or a Base64 QR payload.");
  }
  const { trainers, pokemon, energies } = decodeDeck(bytes);

  const byId = new Map(state.cards.map(card => [`${card.kind}-${card.functionalId}`, card]));
  const counts = new Map();
  for (const id of trainers) counts.set(`trainer-${id}`, (counts.get(`trainer-${id}`) || 0) + 1);
  for (const id of pokemon) counts.set(`pokemon-${id}`, (counts.get(`pokemon-${id}`) || 0) + 1);

  const missing = [];
  const deck = [];
  for (const [key, quantity] of counts) {
    const card = byId.get(key);
    if (!card) {
      missing.push(key.replace("-", " ID "));
      continue;
    }
    deck.push({ ...card, quantity: Math.min(2, quantity) });
  }
  if (missing.length) {
    throw new Error(`Unknown cards in payload (${missing.join(", ")}). The card database may not include them yet.`);
  }
  state.deck = deck;
  state.energies = new Set(energies);
  setMessage("Deck imported from QR payload.", "success");
}

function importDeck() {
  const text = els.modalText.value.trim();
  try {
    if (!text) throw new Error("Paste a deck JSON or QR payload first.");
    if (text.startsWith("{")) importDeckJson(text);
    else importDeckPayload(text);
    els.modalBackdrop.classList.remove("visible");
    renderDeck();
    renderEnergies();
    renderResults();
  } catch (error) {
    alert(error.message);
  }
}

// ---- Save & share decks ----

function renderAll() {
  renderDeck();
  renderEnergies();
  renderResults();
}

function readSavedDecks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function writeSavedDecks(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}
function refreshSavedDecks() {
  const decks = readSavedDecks();
  const names = Object.keys(decks).sort((a, b) => a.localeCompare(b));
  els.savedDecks.innerHTML = `<option value="">Load saved deck…</option>` + names.map(n => {
    const count = (decks[n].cards || []).reduce((s, c) => s + (c.quantity || 0), 0);
    return `<option value="${escapeHtml(n)}">${escapeHtml(n)} (${count})</option>`;
  }).join("");
}
function saveCurrentDeck() {
  const name = els.deckName.value.trim();
  if (!name) return setMessage("Enter a deck name to save.", "error");
  if (!state.deck.length) return setMessage("Add some cards before saving.", "error");
  const decks = readSavedDecks();
  decks[name] = { name, energies: [...state.energies], cards: state.deck };
  writeSavedDecks(decks);
  state.deckName = name;
  refreshSavedDecks();
  setMessage(`Saved “${name}”.`, "success");
}
function deleteSavedDeck() {
  const name = els.deckName.value.trim();
  const decks = readSavedDecks();
  if (!name || !decks[name]) return setMessage("No saved deck with that name.", "error");
  delete decks[name];
  writeSavedDecks(decks);
  refreshSavedDecks();
  setMessage(`Deleted “${name}”.`, "success");
}
function loadSavedDeck(name) {
  const d = readSavedDecks()[name];
  if (!d) return;
  state.deck = (d.cards || []).map(c => ({ ...c, quantity: Number(c.quantity) }));
  state.energies = new Set(d.energies || []);
  state.deckName = d.name || name;
  els.deckName.value = state.deckName;
  renderAll();
  setMessage(`Loaded “${name}”.`, "success");
}

// Resolve minimal entries [{kind, functionalId, quantity}] to full deck cards.
function resolveEntries(entries) {
  const byId = new Map(state.cards.map(c => [`${c.kind}-${c.functionalId}`, c]));
  const deck = [];
  const missing = [];
  for (const e of entries) {
    const card = byId.get(`${e.kind}-${e.functionalId}`);
    if (card) deck.push({ ...card, quantity: Math.min(2, Number(e.quantity) || 1) });
    else missing.push(`${e.kind} ID ${e.functionalId}`);
  }
  return { deck, missing };
}

function shareLink() {
  const code = encodeShare({ name: els.deckName.value.trim(), energies: [...state.energies], cards: state.deck });
  const url = `${location.origin}${location.pathname}#deck=${code}`;
  navigator.clipboard.writeText(url)
    .then(() => setMessage("Share link copied to clipboard.", "success"))
    .catch(() => window.prompt("Copy this share link:", url));
}

function loadFromHash() {
  const match = location.hash.match(/[#&]deck=([^&]+)/);
  if (!match) return;
  try {
    const { name, energies, cards } = decodeShare(match[1]);
    const { deck, missing } = resolveEntries(cards);
    state.deck = deck;
    state.energies = new Set(energies);
    state.deckName = name;
    els.deckName.value = name;
    history.replaceState(null, "", location.pathname + location.search);
    renderAll();
    setMessage(missing.length
      ? `Loaded shared deck — ${missing.length} unknown card(s) skipped.`
      : `Loaded shared deck${name ? ` “${name}”` : ""}.`, missing.length ? "error" : "success");
  } catch {
    setMessage("That shared deck link is invalid.", "error");
  }
}

els.deckName.oninput = event => { state.deckName = event.target.value; };
els.saveDeckBtn.onclick = saveCurrentDeck;
els.deleteDeckBtn.onclick = deleteSavedDeck;
els.shareBtn.onclick = shareLink;
els.savedDecks.onchange = event => {
  const name = event.target.value;
  event.target.value = "";
  if (name) loadSavedDeck(name);
};

// ---- Card detail lightbox ----

function updateLightboxAdd(card) {
  const q = cardQuantity(card);
  els.lightboxAdd.textContent = q ? `Add to deck (${q}/2)` : "Add to deck";
  els.lightboxAdd.disabled = q >= 2 || deckTotal() >= 20;
}

function setLightboxArt(card, variant) {
  loadImageFromSources(els.lightboxImg, sourcesFor(variant.set, variant.number));
  const rar = RARITY_LABELS[variant.rarity] || variant.rarity || "";
  els.lightboxMeta.textContent =
    `${variant.set} #${variant.number} · ID ${card.functionalId}${rar ? ` · ${rar}` : ""}`;
}

function renderVariants(card) {
  const list = state.variants.get(card.key) || [];
  if (list.length <= 1) { els.lightboxVariantBlock.hidden = true; return; }
  els.lightboxVariantBlock.hidden = false;
  els.lightboxVariants.innerHTML = list.map((v, i) => `
    <button class="variant" data-i="${i}" title="${escapeHtml(v.set)} #${v.number} · ${escapeHtml(RARITY_LABELS[v.rarity] || v.rarity || "")}">
      <span class="variant-thumb"><img loading="lazy" alt=""></span>
      <span class="variant-rar">${escapeHtml(v.rarity || "?")}</span>
    </button>`).join("");
  [...els.lightboxVariants.querySelectorAll(".variant")].forEach((btn, i) => {
    loadImageFromSources(btn.querySelector("img"), sourcesFor(list[i].set, list[i].number));
    btn.onclick = () => {
      els.lightboxVariants.querySelectorAll(".variant").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setLightboxArt(card, list[i]);
    };
  });
}

function openLightbox(card) {
  els.lightboxName.textContent = card.name;
  const badges = [`<span class="badge">${card.kind === "pokemon" ? "Pokémon" : "Trainer"}</span>`];
  if (card.element) {
    badges.push(`<span class="type-chip type-${card.element}"><i></i>${ENERGY_LABELS[card.element] || card.element}</span>`);
  }
  if (isEx(card)) badges.push(`<span class="badge badge-ex">ex</span>`);
  els.lightboxBadges.innerHTML = badges.join("");
  setLightboxArt(card, { set: card.set, number: card.number, rarity: card.rarity });
  renderVariants(card);
  els.lightboxAdd.onclick = () => { addCard(card); updateLightboxAdd(card); };
  updateLightboxAdd(card);
  els.lightbox.classList.add("visible");
}
function closeLightbox() { els.lightbox.classList.remove("visible"); }

// ---- Theme ----
const THEME_KEY = "ptcgp:theme";
function effectiveTheme() {
  return document.documentElement.getAttribute("data-theme")
    || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function setThemeIcon() {
  els.themeToggle.textContent = effectiveTheme() === "dark" ? "☀️" : "🌙";
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
  setThemeIcon();
}
els.themeToggle.onclick = () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  setThemeIcon();
};
initTheme();

els.rarityFilter.onchange = event => { state.rarity = event.target.value; applyFilters(); };
els.sortSelect.onchange = event => { state.sort = event.target.value; applyFilters(); };
els.exToggle.onclick = () => {
  state.exOnly = !state.exOnly;
  els.exToggle.setAttribute("aria-pressed", String(state.exOnly));
  els.exToggle.classList.toggle("active", state.exOnly);
  applyFilters();
};
els.lightboxClose.onclick = closeLightbox;
els.lightbox.onclick = event => { if (event.target === els.lightbox) closeLightbox(); };
document.addEventListener("keydown", event => {
  if (event.key === "Escape") { closeLightbox(); els.modalBackdrop.classList.remove("visible"); }
});

els.searchInput.oninput = event => { state.query = event.target.value; applyFilters(); };
els.typeFilter.onchange = event => { state.type = event.target.value; applyFilters(); };
els.setFilter.onchange = event => { state.set = event.target.value; applyFilters(); };
els.generateBtn.onclick = generateQR;
els.copyBtn.onclick = async () => {
  await navigator.clipboard.writeText(state.generatedBase64);
  setMessage("Payload copied to clipboard.", "success");
};
els.downloadBtn.onclick = () => {
  const anchor = document.createElement("a");
  anchor.href = els.qrCanvas.toDataURL("image/png");
  anchor.download = "pocket-deck-qr.png";
  anchor.click();
};
els.clearBtn.onclick = () => {
  state.deck = [];
  renderDeck();
  renderResults();
  setMessage("");
};
els.exportBtn.onclick = exportDeck;
els.importBtn.onclick = openImportModal;
els.modalCancel.onclick = () => els.modalBackdrop.classList.remove("visible");
els.modalConfirm.onclick = importDeck;
els.modalBackdrop.onclick = event => {
  if (event.target === els.modalBackdrop) els.modalBackdrop.classList.remove("visible");
};

async function fetchJsonWithFallback(paths) {
  let lastError;
  for (const path of paths) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Request failed (${response.status}) for ${path}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function bootstrap() {
  setMessage("Loading card database…");
  try {
    // Prefer the live CDN (always the newest published set), fall back to the
    // snapshot bundled with the site. cards.json is the maintained, current file
    // (cards.extra.json is an enriched variant that upstream froze at set B1a).
    const [raw, sets, elements, selfHosted] = await Promise.all([
      fetchJsonWithFallback([`${CDN_BASE}/cards.json`, `${LOCAL_BASE}/cards.json`]),
      fetchJsonWithFallback([`${CDN_BASE}/sets.json`, `${LOCAL_BASE}/sets.json`]).catch(() => null),
      // Element/type badge lookup for cards.json, which omits the element field.
      // Bundled-only (derived once from the frozen enriched file).
      fetchJsonWithFallback([`${LOCAL_BASE}/elements.json`]).catch(() => null),
      // Which set codes have self-hosted art in this repo (optional).
      fetchJsonWithFallback([`${import.meta.env.BASE_URL}images/manifest.json`]).catch(() => null),
    ]);
    if (sets) {
      for (const entry of Object.values(sets).flat()) state.setInfo.set(entry.code, entry);
    }
    if (elements) {
      for (const [image, element] of Object.entries(elements)) state.elements.set(image, element);
    }
    if (Array.isArray(selfHosted)) {
      for (const code of selfHosted) state.selfHostedSets.add(code);
    }
    state.cards = uniqueFunctionalCards(raw);
    populateSetFilter();
    populateRarityFilter();
    els.sortSelect.value = state.sort;
    applyFilters();
    renderDeck();
    renderEnergies();
    refreshSavedDecks();
    setMessage(`Loaded ${state.cards.length} functional cards.`, "success");
    loadFromHash(); // a shared-deck link overrides the empty starting deck

  } catch (error) {
    setMessage(`${error.message} Check your connection and reload.`, "error");
  }
}

bootstrap();
