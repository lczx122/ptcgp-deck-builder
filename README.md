# Pocket Deck QR Builder

A complete browser-based Pokémon TCG Pocket deck builder that generates valid in-game share QR codes.

## Features

- Live card database from `pokemon-tcg-pocket-database`
- Search by card name
- Filter by Pokémon / Trainer and set
- Alternate-art grouping by functional card ID
- 20-card validation
- Two-copy validation
- One to three selectable energy types
- Valid Version 9 / ECC-H / mask-1 QR generation
- Copy Base64 payload
- Download QR as PNG
- Export and import deck JSON
- Responsive desktop and mobile layout

## Run locally

```bash
npm install
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

## Production build

```bash
npm run build
npm run preview   # serve the production build locally
```

Deploy the resulting `dist/` folder to Netlify, Vercel, GitHub Pages, Cloudflare Pages, or any static host.

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and publishes the app automatically on every push to `main`.

One-time setup:

1. In the GitHub repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).

The app will be live at `https://<your-username>.github.io/ptcgp-deck-builder/`.

## Encoder format

```text
trainer_count
trainer IDs × 3 bytes, big-endian, sorted
pokemon_count
Pokémon IDs × 3 bytes, big-endian, sorted
energy_count
energy codes
```

Trainer payload IDs are `10,000,000 + functionalId`.

The final binary payload is Base64 encoded and placed in a standard QR Code using:

- Version 9
- Error correction H
- Mask pattern 1
