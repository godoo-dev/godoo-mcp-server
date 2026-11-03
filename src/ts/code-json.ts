/** Refuse deeply nested JSON before allocating a host object graph or recursing in serializers. */
export function codeJsonDepth(text: string, maximum = 64): boolean {
  let depth = 0;
  let nodes = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "[" || character === "{") {
      if (++depth > maximum) return false;
    } else if (character === "]" || character === "}") depth -= 1;
    if (
      !quoted &&
      (character === "," || character === ":" || character === "[" || character === "{")
    ) {
      if (++nodes > 50000) return false;
    }
  }
  return true;
}
