
import QRCode from "qrcode";
import "./styles.css";
import { encodeDeck, bytesToBase64, ENERGY_CODES } from "./encoder.js";

const DATA_URL = "https://cdn.jsdelivr.net/npm/pokemon-tcg-pocket-database/dist/cards.extra.json";
const IMAGE_RE = /^c(PK|TR)_(\d+)_(\d+)_(\d+)_(.+)_([A-Z]+)\.webp$/;

const state = {
  cards: [],
  filtered: [],
  deck: [],
  energies: new Set(["water"]),
  query: "",
  type: "all",
  set: "all",
  generatedBase64: "",
};

document.querySelector("#app").innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <div class="brand">
      <div class="logo"></div>
      <div><h1>Pocket Deck QR Builder</h1><small>Build a deck and scan it directly into Pokémon TCG Pocket</small></div>
    </div>
    <div class="top-actions">
      <button class="btn btn-secondary" id="importBtn">Import deck JSON</button>
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
        </div>
      </div>
      <div class="results" id="results"></div>
    </section>

    <aside class="panel deck-panel">
      <div class="deck-summary">
        <div>
          <strong>Your deck</strong>
          <div class="progress"><div id="progressBar" style="width:0%"></div></div>
        </div>
        <div class="counter"><span id="deckCount">0</span>/20</div>
      </div>
      <div id="deckList" class="deck-list"></div>

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
  "energyGrid","generateBtn","message","qrWrap","qrCanvas","payloadInput","copyBtn",
  "downloadBtn","clearBtn","importBtn","exportBtn","modalBackdrop","modalTitle",
  "modalHelp","modalText","modalCancel","modalConfirm"
].map(id => [id, document.getElementById(id)]));

function setMessage(text, type = "") {
  els.message.textContent = text;
  els.message.className = `message ${type}`;
}

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
    element: card.element || "",
    subtype: card.type || "",
  };
}

function uniqueFunctionalCards(raw) {
  const map = new Map();
  for (const item of raw) {
    const card = normalizeCard(item);
    if (!card) continue;
    if (!map.has(card.key)) map.set(card.key, card);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function populateSetFilter() {
  const sets = [...new Set(state.cards.map(card => card.set))].sort();
  for (const set of sets) {
    const option = document.createElement("option");
    option.value = set;
    option.textContent = set;
    els.setFilter.appendChild(option);
  }
}

function applyFilters() {
  const q = state.query.toLowerCase().trim();
  state.filtered = state.cards.filter(card => {
    return (!q || card.name.toLowerCase().includes(q))
      && (state.type === "all" || card.kind === state.type)
      && (state.set === "all" || card.set === state.set);
  }).slice(0, 240);
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
      <div class="card-art">${initials}</div>
      <div class="card-body">
        <div class="card-name">${card.name}</div>
        <div class="meta">${card.set} #${card.number} · ID ${card.functionalId}</div>
        <div class="card-actions">
          <span class="badge">${card.kind === "pokemon" ? "Pokémon" : "Trainer"}${card.element ? ` · ${card.element}` : ""}</span>
          <button class="btn btn-primary">Add${cardQuantity(card) ? ` (${cardQuantity(card)})` : ""}</button>
        </div>
      </div>`;
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
        <div><strong>${card.name}</strong><div class="meta">${card.kind} · ID ${card.functionalId}</div></div>
        <div class="qty-controls">
          <button class="qty-btn minus">−</button>
          <strong>${card.quantity}</strong>
          <button class="qty-btn plus">+</button>
        </div>`;
      row.querySelector(".minus").onclick = () => adjustQuantity(card.key, -1);
      row.querySelector(".plus").onclick = () => adjustQuantity(card.key, 1);
      els.deckList.appendChild(row);
    }
  }
  els.qrWrap.classList.remove("visible");
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
  els.modalTitle.textContent = "Import deck JSON";
  els.modalHelp.textContent = "Paste the contents of a previously exported deck JSON file.";
  els.modalText.value = "";
  els.modalBackdrop.classList.add("visible");
}

function importDeck() {
  try {
    const data = JSON.parse(els.modalText.value);
    if (!Array.isArray(data.cards) || !Array.isArray(data.energies)) throw new Error("Invalid deck JSON.");
    const total = data.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0);
    if (total > 20) throw new Error("Imported deck contains more than 20 cards.");
    state.deck = data.cards.map(card => ({...card, quantity: Number(card.quantity)}));
    state.energies = new Set(data.energies);
    els.modalBackdrop.classList.remove("visible");
    renderDeck();
    renderEnergies();
    setMessage("Deck imported.", "success");
  } catch (error) {
    alert(error.message);
  }
}

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

async function bootstrap() {
  setMessage("Loading card database…");
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Card database request failed (${response.status}).`);
    const raw = await response.json();
    state.cards = uniqueFunctionalCards(raw);
    populateSetFilter();
    applyFilters();
    renderDeck();
    renderEnergies();
    setMessage(`Loaded ${state.cards.length} functional cards.`, "success");
  } catch (error) {
    setMessage(`${error.message} Check your connection and reload.`, "error");
  }
}

bootstrap();
