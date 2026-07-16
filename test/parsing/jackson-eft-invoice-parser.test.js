const assert = require("assert");
const JacksonEftInvoiceTemplate = require("../../backend/parsing/templates/jackson_eft_invoice");

function testChevronCreditCardLinesExtracted() {
  const lines = [
    "Reference No.: D-289363-060526",
    "Date: 06/05/2026",
    "05/28/2026 Riverside Texaco 05577347-I GRAV293457 49,852.20 49,852.20",
    "05/26/2026 Riverside Texaco 1663395-Loyalty0526 5/28/2026 12:00:00 AM 2.00 2.00",
    "05/29/2026 JEC Utah Dustin Lunt3048190001-5/29/20-6/1/2026Chevron Credit Cards 32.85- 32.85-",
    "05/29/2026 JEC Utah Dustin Lunt3048190001-5/29/20-6/1/2026 FChev CC Fees 0.77 0.77",
    "05/26/2026 JEC Utah Dustin Lunt3048190487-5/26/20-5/27/2026Chevron Credit Cards 3,443.39- 3,443.39-",
    "05/26/2026 JEC Utah Dustin Lunt3048190487-5/26/20-5/27/2026FChev CC Fees 73.99 73.99",
    "Chevron Credit Cards 3,476.24-",
    "Total Draft Amount: 523.83-",
  ];

  const { batchLines, summary, warnings } = JacksonEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(batchLines.length, 2);

  assert.strictEqual(batchLines[0].invoiceId, "3048190001-5/29/20-6/1/2026");
  assert.strictEqual(batchLines[0].batchNumber, "0001");
  assert.strictEqual(batchLines[0].amount, -32.85);
  assert.strictEqual(batchLines[0].invDate.getFullYear(), 2026);
  assert.strictEqual(batchLines[0].invDate.getMonth(), 4);
  assert.strictEqual(batchLines[0].invDate.getDate(), 29);

  assert.strictEqual(batchLines[1].invoiceId, "3048190487-5/26/20-5/27/2026");
  assert.strictEqual(batchLines[1].batchNumber, "0487");
  assert.strictEqual(batchLines[1].amount, -3443.39);
  assert.strictEqual(batchLines[1].invDate.getDate(), 26);

  assert.ok(summary);
  assert.strictEqual(summary.invoiceNumber, "D-289363-060526");
  assert.strictEqual(summary.amount, -3476.24);
  assert.strictEqual(summary.balance, -523.83);
}

function testSkipsNonCreditCardRows() {
  const lines = [
    "Reference No.: D-111111-010126",
    "05/26/2026 Riverside Texaco 1663397-Loyalty0526 5/28/2026 12:00:00 AM 20.86- 20.86-",
    "05/29/2026 JEC Utah Dustin Lunt3048190002-5/29/20-6/1/2026 FChev CC Fees 1.35 1.35",
    "04/01/2026 Riverside Texaco 666796072-NAF 666796072-NAF 171.00 171.00",
    "Total Draft Amount: 10.00-",
  ];

  const { batchLines, warnings } = JacksonEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 0);
  assert.ok(warnings.some((w) => /No "Chevron Credit Cards" rows/i.test(w.message)));
}

function testBatchNumberPreservesLeadingZeros() {
  const lines = [
    "Reference No.: D-222222-020226",
    "05/27/2026 JEC Utah Dustin Lunt3048190981-5/27/20-5/29/2026Chevron Credit Cards 216.40- 216.40-",
    "Total Draft Amount: 1.00-",
  ];

  const { batchLines } = JacksonEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 1);
  assert.strictEqual(batchLines[0].batchNumber, "0981");
}

function testAmountFallbackSumsLines() {
  const lines = [
    "Reference No.: D-333333-030326",
    "05/29/2026 JEC Utah Dustin Lunt3048190001-5/29/20-6/1/2026Chevron Credit Cards 32.85- 32.85-",
    "05/29/2026 JEC Utah Dustin Lunt3048190002-5/29/20-6/1/2026Chevron Credit Cards 130.26- 130.26-",
    "Total Draft Amount: 50.00-",
  ];

  const { summary } = JacksonEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary.amount, -163.11);
  assert.strictEqual(summary.balance, -50);
}

function testMissingReferenceEmitsWarning() {
  const lines = [
    "05/29/2026 JEC Utah Dustin Lunt3048190001-5/29/20-6/1/2026Chevron Credit Cards 32.85- 32.85-",
    "Total Draft Amount: 1.00-",
  ];

  const { summary, warnings } = JacksonEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(summary, null);
  assert.ok(warnings.some((w) => /No Reference No/i.test(w.message)));
}

function testTrailingMinusAmountParsing() {
  assert.strictEqual(JacksonEftInvoiceTemplate.parseAmount("3,443.39-"), -3443.39);
  assert.strictEqual(JacksonEftInvoiceTemplate.parseAmount("73.99"), 73.99);
  assert.strictEqual(JacksonEftInvoiceTemplate.parseAmount("-10.50"), -10.5);
}

async function testRealJacksonFixturePdf() {
  const fs = require("fs");
  const path = require("path");
  const { parseJacksonEftPdf } = require("../../backend/parsing/eft-pipeline");
  const fixture = path.join(__dirname, "../fixtures/sample-jackson-eft.pdf");
  if (!fs.existsSync(fixture)) return;

  const result = await parseJacksonEftPdf(fs.readFileSync(fixture));
  assert.strictEqual(result.summary.invoiceNumber, "D-289363-060526");
  assert.strictEqual(result.summary.amount, -51675.71);
  assert.strictEqual(result.summary.balance, -523.83);
  assert.strictEqual(result.batchLines.length, 29);
  assert.strictEqual(result.batchLines[0].batchNumber, "0001");
  assert.strictEqual(result.batchLines[0].amount, -32.85);
  assert.strictEqual(result.batchLines[0].invDate, "2026-05-29");
  assert.ok(result.batchLines.every((line) => /^\d{4}$/.test(line.batchNumber)));
}

async function run() {
  testChevronCreditCardLinesExtracted();
  testSkipsNonCreditCardRows();
  testBatchNumberPreservesLeadingZeros();
  testAmountFallbackSumsLines();
  testMissingReferenceEmitsWarning();
  testTrailingMinusAmountParsing();
  await testRealJacksonFixturePdf();
  console.log("PASS jackson eft invoice parser tests");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
