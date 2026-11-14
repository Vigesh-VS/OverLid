// Fails the build if any source file uses an API that turns strings into
// HTML or code. Everything Overlid shows (scripts, hook messages, media
// titles, file names) must be rendered as plain text.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const FORBIDDEN = [
  [/dangerouslySetInnerHTML/, "dangerouslySetInnerHTML"],
  [/\.(inner|outer)HTML\s*=/, "innerHTML/outerHTML assignment"],
  [/insertAdjacentHTML/, "insertAdjacentHTML"],
  [/document\.write\s*\(/, "document.write"],
  [/(^|[^\w.])eval\s*\(/, "eval"],
  [/new\s+Function\s*\(/, "new Function"],
  [/setTimeout\s*\(\s*["'`]/, "setTimeout with a string"],
  [/setInterval\s*\(\s*["'`]/, "setInterval with a string"],
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

let failures = 0;
for (const file of walk(ROOT)) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const [pattern, name] of FORBIDDEN) {
        if (pattern.test(line)) {
          console.error(`src/${relative(ROOT, file).replaceAll("\\", "/")}:${i + 1}: ${name} is not allowed`);
          failures++;
        }
      }
    });
}
if (failures) {
  console.error(`\n${failures} unsafe DOM/code API use(s). Render text as text.`);
  process.exit(1);
}
console.log("check-unsafe-dom: clean");
