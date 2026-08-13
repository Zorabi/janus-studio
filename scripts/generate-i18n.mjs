import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "../apps/desktop/node_modules/typescript/lib/typescript.js";

const execFileAsync = promisify(execFile);

const rendererRoot = new URL("../apps/desktop/src/renderer/", import.meta.url);
const output = new URL("../apps/desktop/src/renderer/lib/generated-locales.json", import.meta.url);
const separator = "\n__JANUS_STUDIO_SPLIT__\n";
const targets = {
  "zh-TW": "zh-TW",
  "ja-JP": "ja",
  "ko-KR": "ko",
  "de-DE": "de",
  "fr-FR": "fr",
  "es-ES": "es",
  "pt-BR": "pt",
  "it-IT": "it",
  "ru-RU": "ru",
  "pl-PL": "pl",
  "tr-TR": "tr",
  "vi-VN": "vi",
};

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) result.push(...await sourceFiles(location));
    else if (/\.tsx?$/.test(entry.name)) result.push(location);
  }
  return result;
}

const phrases = new Map();
for (const file of await sourceFiles(rendererRoot)) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const english = node.arguments[1] && ts.isStringLiteralLike(node.arguments[1])
        ? node.arguments[1].text
        : undefined;
      phrases.set(node.arguments[0].text, english ?? phrases.get(node.arguments[0].text));
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "EN" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.name)) {
          phrases.set(
            property.name.text,
            ts.isStringLiteralLike(property.initializer) ? property.initializer.text : phrases.get(property.name.text),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

async function translateBatch(values, language) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "zh-CN");
  url.searchParams.set("tl", language);
  url.searchParams.set("dt", "t");
  const { stdout } = await execFileAsync("curl", [
    "--silent",
    "--show-error",
    "--fail",
    "--max-time",
    "30",
    "--data-urlencode",
    `q=${values.join(separator)}`,
    url.toString(),
  ], { maxBuffer: 2_000_000 });
  const body = JSON.parse(stdout);
  const translated = body[0].map((part) => part[0]).join("");
  const parts = translated.split(/\n__JANUS_STUDIO_SPLIT__\n/);
  if (parts.length !== values.length) {
    throw new Error(`Translation boundary mismatch: expected ${values.length}, received ${parts.length}`);
  }
  return parts;
}

const keys = [...phrases.keys()].sort((left, right) => left.localeCompare(right, "zh-CN"));
let dictionaries = {};
let sourceFallbacks = {};
let translationServiceAvailable = true;
try {
  dictionaries = JSON.parse(await readFile(output, "utf8"));
  sourceFallbacks = dictionaries.__sourceFallbacks ?? {};
  delete dictionaries.__sourceFallbacks;
} catch {
  dictionaries = {};
}
for (const [locale, language] of Object.entries(targets)) {
  const existingDictionary = dictionaries[locale] ?? {};
  const dictionary = Object.fromEntries(
    keys.flatMap((key) =>
      Object.hasOwn(existingDictionary, key) && !sourceFallbacks[key]
        ? [[key, existingDictionary[key]]]
        : [],
    ),
  );
  const missingKeys = keys.filter((key) => !dictionary[key]);
  const batches = Array.from(
    { length: Math.ceil(missingKeys.length / 20) },
    (_, index) => missingKeys.slice(index * 20, index * 20 + 20),
  );
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
    let translated;
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (!translationServiceAvailable) throw new Error("Translation service unavailable");
        translated = await translateBatch(batch, language);
        break;
      } catch (error) {
        if (attempt >= 3 || !translationServiceAvailable) {
          translationServiceAvailable = false;
          translated = batch.map((key) => phrases.get(key) ?? key);
          for (const key of batch) sourceFallbacks[key] = true;
          process.stderr.write(`Translation service unavailable; using source English fallbacks for ${locale}.\n`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
    batch.forEach((key, index) => {
      dictionary[key] = translated[index];
      if (translationServiceAvailable) delete sourceFallbacks[key];
    });
    }
  }
  await Promise.all(Array.from({ length: 2 }, () => worker()));
  dictionaries[locale] = dictionary;
  process.stdout.write(`${locale}: ${Object.keys(dictionary).length} messages\n`);
}

await mkdir(path.dirname(output.pathname), { recursive: true });
await writeFile(output, `${JSON.stringify(dictionaries, null, 2)}\n`, "utf8");
