const assert = require("assert");
const EftInvoiceTemplate = require("../js/templates/eft_invoice.js");

const SAMPLE_LINES = [
  "Electronic Funds Transfer Notice",
  "Invoice # Inv Date Due Date Amount Disc Avail Balance",
  "--------- -------- -------- ------ ---------- -------",
  "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
  "AAE0320 03/30/26 03/30/26 -384.09 .00 -384.09",
  "AAM9087 03/30/26 03/30/26 -56.23 .00 -56.23",
  "AAN9087 03/30/26 03/30/26 -337.06 .00 -337.06",
  "AAU9086 03/30/26 03/30/26 -89.99 .00 -89.99",
  "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
  "-------- ------ --------",
  "-4,267.80 .00 -4,267.80",
  "*** End Of EFT Prenotification ***",
];

function testParsesBatchLines() {
  const { batchLines, warnings } = EftInvoiceTemplate.extractFromLines(SAMPLE_LINES);

  assert.strictEqual(warnings.length, 0, "Expected no parser warnings");
  assert.strictEqual(batchLines.length, 5, "Expected five AA batch lines");

  const batch319 = batchLines.find((line) => line.invoiceId === "AAE0319");
  assert.ok(batch319, "Expected AAE0319 line");
  assert.strictEqual(batch319.batchNumber, "0319");
  assert.strictEqual(batch319.amount, -2817.73);
}

function testParsesSummaryLine() {
  const { summary } = EftInvoiceTemplate.extractFromLines(SAMPLE_LINES);

  assert.ok(summary, "Expected summary line");
  assert.strictEqual(summary.invoiceNumber, "0600658");
  assert.strictEqual(summary.amount, 35381.95);
}

function testHandlesDual9087Lines() {
  const { batchLines } = EftInvoiceTemplate.extractFromLines(SAMPLE_LINES);
  const lines9087 = batchLines.filter((line) => line.batchNumber === "9087");

  assert.strictEqual(lines9087.length, 2, "Expected two invoice lines for batch 9087");
  assert.deepStrictEqual(
    lines9087.map((line) => line.amount).sort((a, b) => a - b),
    [-337.06, -56.23]
  );
}

function testIgnoresFooterSubtotal() {
  const { batchLines, summary } = EftInvoiceTemplate.extractFromLines(SAMPLE_LINES);

  assert.ok(
    !batchLines.some((line) => line.invoiceId === "-4,267.80"),
    "Footer subtotal should not be parsed as a batch line"
  );
  assert.notStrictEqual(summary.invoiceNumber, "-4,267.80");
}

function testExtractsDigitsAfterLetters() {
  assert.strictEqual(EftInvoiceTemplate.extractBatchNumber("AAE0319"), "0319");
  assert.strictEqual(EftInvoiceTemplate.extractBatchNumber("AAA0330"), "0330");
  assert.strictEqual(EftInvoiceTemplate.extractBatchNumber("AAU9086"), "9086");
}

function run() {
  testParsesBatchLines();
  testParsesSummaryLine();
  testHandlesDual9087Lines();
  testIgnoresFooterSubtotal();
  testExtractsDigitsAfterLetters();
  console.log("PASS eft invoice parser tests");
}

run();
