const MAXIMUM_NODES = 50000;
const opens = (character: string) => character === "[" || character === "{";
const closes = (character: string) => character === "]" || character === "}";
const startsNode = (character: string) =>
  character === "," || character === ":" || opens(character);

/** Refuse deeply nested JSON before allocating a host object graph or recursing in serializers. */
export function codeJsonDepth(text: string, maximum = 64): boolean {
  let depth = 0;
  let nodes = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      // Inside a string only an unescaped quote ends it; a backslash escapes the next character.
      if (escaped) escaped = false;
      else {
        escaped = character === "\\";
        quoted = character !== '"';
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (opens(character) && ++depth > maximum) return false;
    if (closes(character)) depth -= 1;
    if (startsNode(character) && ++nodes > MAXIMUM_NODES) return false;
  }
  return true;
}
