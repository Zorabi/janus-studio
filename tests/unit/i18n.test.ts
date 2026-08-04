import assert from "node:assert/strict";
import test from "node:test";
import generatedLocales from "../../apps/desktop/src/renderer/lib/generated-locales.json" with { type: "json" };

test("every non-English locale covers the complete UI message catalog", () => {
  const dictionaries = Object.entries(generatedLocales);
  assert.equal(dictionaries.length, 12);
  const reference = new Set(Object.keys(generatedLocales["zh-TW"]));
  assert.ok(reference.size >= 390);
  for (const [locale, dictionary] of dictionaries) {
    const keys = Object.keys(dictionary);
    assert.equal(keys.length, reference.size, `${locale} has incomplete coverage`);
    assert.deepEqual(new Set(keys), reference, `${locale} contains a mismatched key set`);
    assert.equal(Object.values(dictionary).some((value) => !String(value).trim()), false, `${locale} has blank messages`);
  }
});
