const assert = require("assert");
const ChevronTemplate = require("../js/templates/chevron.js");

function testSplitBatchTotalAcrossLines() {
  const lines = [
    "309359 03-31-2026 0341 CC 94 2,405.22 30.72 18.63 13.64 62.99 2,342.23",
    "Batch",
    "Total",
    "104 2,643.80 31.02 19.34 15.08 65.44 2,578.36",
  ];

  const { records, warnings } = ChevronTemplate.extractFromLines(lines);

  assert.strictEqual(warnings.length, 0, "Expected no parser warnings");
  assert.strictEqual(records.length, 1, "Expected one parsed batch record");

  const [row] = records;
  assert.strictEqual(row.site_id, "309359");
  assert.strictEqual(row.batch_number, "0341");
  assert.strictEqual(row.gross_amount, 2643.8);
  assert.strictEqual(row.total_fee, 65.44);
  assert.strictEqual(row.net_amount, 2578.36);
}

function testSingleLineBatchTotalStillParses() {
  const lines = [
    "30935 03-31-2026 857 CC 96 2,781.16 40.83 13.35 14.44 68.62 2,712.54",
    "Batch Total 96 2,781.16 40.83 13.35 14.44 68.62 2,712.54",
  ];

  const { records, warnings } = ChevronTemplate.extractFromLines(lines);

  assert.strictEqual(warnings.length, 0, "Expected no parser warnings");
  assert.strictEqual(records.length, 1, "Expected one parsed batch record");

  const [row] = records;
  assert.strictEqual(row.site_id, "30935");
  assert.strictEqual(row.batch_number, "857");
  assert.strictEqual(row.gross_amount, 2781.16);
  assert.strictEqual(row.total_fee, 68.62);
  assert.strictEqual(row.net_amount, 2712.54);
}

function run() {
  testSplitBatchTotalAcrossLines();
  testSingleLineBatchTotalStillParses();
  console.log("PASS chevron parser regression tests");
}

run();
