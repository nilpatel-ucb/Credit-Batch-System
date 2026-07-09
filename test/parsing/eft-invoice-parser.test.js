const assert = require("assert");
const EftInvoiceTemplate = require("../../backend/parsing/templates/eft_invoice");

function testAaBatchLinesExtracted() {
  const lines = [
    "Invoice # Inv Date Due Date Amount",
    "--------- --------- --------- ---------",
    "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
    "AAU9086 03/29/26 03/29/26 -1,500.00 .00 -1,500.00",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
    "-4,267.80 .00 -4,267.80",
    "*** End Of EFT Prenotification ***",
  ];

  const { batchLines, summary, warnings } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(batchLines.length, 2);

  assert.strictEqual(batchLines[0].invoiceId, "AAE0319");
  assert.strictEqual(batchLines[0].batchNumber, "0319");
  assert.strictEqual(batchLines[0].amount, -2817.73);
  assert.strictEqual(batchLines[0].invDate.getFullYear(), 2026);
  assert.strictEqual(batchLines[0].invDate.getMonth(), 2);
  assert.strictEqual(batchLines[0].invDate.getDate(), 30);

  assert.strictEqual(batchLines[1].invoiceId, "AAU9086");
  assert.strictEqual(batchLines[1].batchNumber, "9086");
  assert.strictEqual(batchLines[1].amount, -1500);

  assert.ok(summary);
  assert.strictEqual(summary.invoiceNumber, "0600658");
  assert.strictEqual(summary.amount, 35381.95);
  assert.strictEqual(summary.balance, -4267.8);
}

function testLastNonAaLineWinsForSummary() {
  const lines = [
    "0100001 03/01/26 03/08/26 10,000.00 .00 10,000.00",
    "AAE0100 03/02/26 03/02/26 -100.00 .00 -100.00",
    "0200002 03/15/26 03/22/26 20,000.00 .00 20,000.00",
    "-100.00 .00 -100.00",
  ];

  const { summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.invoiceNumber, "0200002");
  assert.strictEqual(summary.amount, 20000);
  assert.strictEqual(summary.balance, -100);
}

function testNoiseLinesSkipped() {
  const lines = [
    "",
    "Invoice # Inv Date Due Date Amount",
    "--------- --------- --------- ---------",
    "Electronic Funds Transfer",
    "-4,267.80 .00 -4,267.80",
    "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
  ];

  const { batchLines, summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 1);
  assert.strictEqual(summary.invoiceNumber, "0600658");
  assert.strictEqual(summary.balance, -4267.8);
}

function testNoAaLinesEmitsWarning() {
  const lines = ["0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95"];

  const { batchLines, warnings } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 0);
  assert.strictEqual(warnings.length, 2);
  assert.ok(warnings.some((w) => /No AA-prefixed batch lines/i.test(w.message)));
  assert.ok(warnings.some((w) => /footer balance/i.test(w.message)));
}

function testBadAaIdEmitsWarning() {
  const lines = [
    "AA 03/30/26 03/30/26 -100.00 .00 -100.00",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
  ];

  const { batchLines, warnings } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 0);
  assert.strictEqual(warnings.length, 3);
  assert.ok(warnings.some((w) => /Could not extract batch number/i.test(w.message)));
}

function testFooterBalanceExtracted() {
  const lines = [
    "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
    "--------- --------- --------- ---------",
    "-4,267.80 .00 -4,267.80",
  ];

  const { summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.balance, -4267.8);
}

function testFooterMergedWithDashes() {
  const lines = [
    "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
    "--------- --------- --------- -4,267.80 .00 -4,267.80",
  ];

  const { summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.balance, -4267.8);
}

function testFooterWithoutThousandsSeparator() {
  const lines = [
    "AAE0319 03/30/26 03/30/26 -2817.73 .00 -2817.73",
    "0600658 03/24/26 04/01/26 35381.95 .00 35381.95",
    "-4267.80 .00 -4267.80",
  ];

  const { summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.balance, -4267.8);
}

function testFooterSingleAmountLine() {
  const lines = [
    "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
    "--------- --------- --------- ---------",
    "-4,267.80",
  ];

  const { summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.balance, -4267.8);
}

function testFooterRunTogetherColumns() {
  const lines = [
    "AAE0319 03/30/26 03/30/26 -2,817.73 .00 -2,817.73",
    "0600658 03/24/26 04/01/26 35,381.95 .00 35,381.95",
    "-4,267.80.00-4,267.80",
  ];

  const { summary } = EftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.balance, -4267.8);
}

async function testRealEftFixturePdf() {
  const fs = require("fs");
  const path = require("path");
  const { parseEftPdf } = require("../../backend/parsing/eft-pipeline");
  const fixture = path.join(__dirname, "../fixtures/sample-eft.pdf");
  if (!fs.existsSync(fixture)) return;

  const result = await parseEftPdf(fs.readFileSync(fixture));
  assert.strictEqual(result.summary.invoiceNumber, "0600658");
  assert.strictEqual(result.summary.amount, 35381.95);
  assert.strictEqual(result.summary.balance, -4267.8);
  assert.strictEqual(result.batchLines.length, 24);
}

async function run() {
  testAaBatchLinesExtracted();
  testLastNonAaLineWinsForSummary();
  testNoiseLinesSkipped();
  testNoAaLinesEmitsWarning();
  testBadAaIdEmitsWarning();
  testFooterBalanceExtracted();
  testFooterMergedWithDashes();
  testFooterWithoutThousandsSeparator();
  testFooterSingleAmountLine();
  testFooterRunTogetherColumns();
  await testRealEftFixturePdf();
  console.log("PASS eft invoice parser tests");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
