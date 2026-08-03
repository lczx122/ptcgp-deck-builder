import { defineConfig } from "vite";

// base is set for GitHub Pages project hosting (https://<user>.github.io/ptcgp-deck-builder/).
// Local dev and other static hosts are unaffected when served from the domain root.
export default defineConfig(({ command }) => ({
  base: command === "build" && process.env.GITHUB_PAGES ? "/ptcgp-deck-builder/" : "/",
}));
