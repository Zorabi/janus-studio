import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../../apps/desktop/src/renderer/features/quality/QualityPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../apps/desktop/src/renderer/styles/quality.css", import.meta.url), "utf8");

test("keeps issue samples collapsed and limits summaries to cp1 and cp2", () => {
  assert.match(page, /const \[showSamples, setShowSamples\] = useState\(false\)/);
  assert.match(page, /aria-expanded=\{showSamples\}/);
  assert.match(page, /const preview=\["cp1","cp2"\]/);
});

test("paginates retained quality history and exposes deletion as a named action", () => {
  assert.match(page, /const QUALITY_HISTORY_RETENTION = 200/);
  assert.match(page, /const QUALITY_HISTORY_PAGE_SIZE = 20/);
  assert.match(page, /pagedRuns\.map/);
  assert.match(page, /t\("删除记录", "Delete record"\)/);
});

test("paginates quality rule sets and requires their exact name before deletion", () => {
  assert.match(page, /const QUALITY_RULE_SET_PAGE_SIZE = 20/);
  assert.match(page, /pagedRuleSets\.map/);
  assert.match(page, /confirmationText=\{removingRuleSet\.name\}/);
});

test("highlights only the hovered Schema token remove button", () => {
  assert.match(styles, /\.schema-suggestion-chip > button \{[^}]*color: var\(--muted\)/s);
  assert.match(styles, /\.schema-suggestion-chip > button:hover,/);
  assert.doesNotMatch(styles, /\.schema-suggestion-input:hover[^}]*button/s);
});
