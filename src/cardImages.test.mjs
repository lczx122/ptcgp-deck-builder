// Node self-tests for cardImages. Run: node src/cardImages.test.mjs
import { imageSourcesFor, LIMITLESS_BASE } from "./cardImages.js";

let passed = 0;
const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); passed++; };

// default: two mirrors then limitless
{
  const s = imageSourcesFor("A1", 1);
  assert(s.length === 3, "3 sources by default");
  assert(s[0].endsWith("/cards-by-set/A1/1.webp"), "mirror 1 uses raw number");
  assert(s[2] === `${LIMITLESS_BASE}/A1/A1_001_EN.webp`, "limitless zero-pads to 3 digits");
}

// zero-padding widths
{
  assert(imageSourcesFor("B4", 7)[2].endsWith("/B4/B4_007_EN.webp"), "pads 7 -> 007");
  assert(imageSourcesFor("B4", 50)[2].endsWith("/B4/B4_050_EN.webp"), "pads 50 -> 050");
  assert(imageSourcesFor("A4b", 364)[2].endsWith("/A4b/A4b_364_EN.webp"), "3-digit stays 364");
}

// self-hosted set: local base first, still ends with limitless
{
  const s = imageSourcesFor("B4", 1, { localBase: "/base/images/cards-by-set", selfHosted: true });
  assert(s.length === 4, "4 sources when self-hosted");
  assert(s[0] === "/base/images/cards-by-set/B4/1.webp", "local base first");
  assert(s[s.length - 1].includes("digitaloceanspaces"), "limitless still last");
}

// selfHosted without a localBase falls back to just mirrors+limitless
{
  const s = imageSourcesFor("A1", 1, { selfHosted: true });
  assert(s.length === 3, "no local base -> 3 sources");
}

console.log(`All ${passed} cardImages assertions passed.`);
