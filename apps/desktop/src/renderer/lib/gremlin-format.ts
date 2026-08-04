type LexicalState = "normal" | "single" | "double" | "line-comment" | "block-comment";

function previousVisible(source: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(source[cursor]!)) return source[cursor]!;
  }
  return "";
}

function nextVisible(source: string, index: number): string {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (!/\s/.test(source[cursor]!)) return source[cursor]!;
  }
  return "";
}

/**
 * Formats Gremlin-Groovy without evaluating it. The formatter is deliberately
 * lexical: quoted values and comments are preserved byte-for-byte while
 * top-level traversal steps are arranged as a readable vertical pipeline.
 */
export function formatGremlin(source: string): string {
  const input = source.trim();
  if (!input) return "";

  let output = "";
  let state: LexicalState = "normal";
  let escaped = false;
  let pendingSpace = false;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;

  const atTopLevel = () => parentheses === 0 && brackets === 0 && braces === 0;
  const appendPendingSpace = (next: string) => {
    if (!pendingSpace) return;
    pendingSpace = false;
    const previous = output.at(-1) ?? "";
    if (
      output &&
      !/\s/.test(previous) &&
      !"([{.".includes(previous) &&
      !")]}.,;".includes(next)
    ) {
      output += " ";
    }
  };
  const appendNewline = () => {
    output = output.trimEnd();
    if (output && !output.endsWith("\n")) output += "\n";
    pendingSpace = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    const following = input[index + 1] ?? "";

    if (state === "single" || state === "double") {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single" && character === "'") ||
        (state === "double" && character === '"')
      ) {
        state = "normal";
      }
      continue;
    }

    if (state === "line-comment") {
      if (character === "\n") {
        appendNewline();
        state = "normal";
      } else if (character !== "\r") {
        output += character;
      }
      continue;
    }

    if (state === "block-comment") {
      output += character;
      if (character === "*" && following === "/") {
        output += following;
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (character === "/" && following === "/") {
      appendPendingSpace(character);
      output += "//";
      index += 1;
      state = "line-comment";
      continue;
    }
    if (character === "/" && following === "*") {
      appendPendingSpace(character);
      output += "/*";
      index += 1;
      state = "block-comment";
      continue;
    }
    if (character === "'" || character === '"') {
      appendPendingSpace(character);
      output += character;
      state = character === "'" ? "single" : "double";
      continue;
    }
    if (character === "\r") continue;
    if (character === "\n") {
      if (atTopLevel()) appendNewline();
      else pendingSpace = true;
      continue;
    }
    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }

    const previous = previousVisible(input, index);
    const next = nextVisible(input, index);
    const dotStartsLine = character === "." && /(?:^|\n)\s*$/.test(output);
    const traversalStepDot =
      character === "." &&
      atTopLevel() &&
      ([")", "]", "}"].includes(previous) || dotStartsLine) &&
      !/\d/.test(previous + next);
    if (traversalStepDot) {
      appendNewline();
      output += "  .";
      continue;
    }

    if (character === ",") {
      output = output.trimEnd();
      output += ", ";
      pendingSpace = false;
      continue;
    }
    if (character === ";" && atTopLevel()) {
      output = output.trimEnd();
      output += ";";
      appendNewline();
      continue;
    }

    if (character === ")") parentheses = Math.max(0, parentheses - 1);
    if (character === "]") brackets = Math.max(0, brackets - 1);
    if (character === "}") braces = Math.max(0, braces - 1);
    appendPendingSpace(character);
    output += character;
    if (character === "(") parentheses += 1;
    if (character === "[") brackets += 1;
    if (character === "{") braces += 1;
  }

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
