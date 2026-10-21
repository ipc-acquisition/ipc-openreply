import { foldDiacritics, stripSpecialCharacters } from "@/lib/utils/keyword-matcher";

// Leetspeak and symbol swaps spammers use to slip past word lists. Applied to
// the comment and to the rule words alike, so a rule written as "fake" also
// covers "f4ke" and "fak3".
const SWAPS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "€": "e",
};

/**
 * Normalises text for moderation matching: lower case, no accents, symbol
 * swaps undone, repeated letters collapsed ("fakeee" → "fake"). Moderation
 * deliberately errs on the side of matching too much, unlike campaign
 * keywords, which stay exact.
 */
export function normalizeForModeration(text: string): string {
  const swapped = text
    .toLowerCase()
    .replace(/[0134578@$€]/g, (c) => SWAPS[c] ?? c);
  return foldDiacritics(stripSpecialCharacters(swapped))
    .toLowerCase()
    .replace(/(\p{L})\1+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
