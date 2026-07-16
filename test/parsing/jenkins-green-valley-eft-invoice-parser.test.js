const assert = require("assert");
const JenkinsGreenValleyEftInvoiceTemplate = require("../../backend/parsing/templates/jenkins_green_valley_eft_invoice");

function testLetterPrefixedLinesUseInvDateBatch() {
  const lines = [
    "Invoice # Inv Date Due Date Amount Disc Avail Balance",
    "--------- -------- -------- ------ ---------- -------",
    "BBB8622 06/14/26 06/14/26 -130.63 .00 -130.63",
    "BBB8623 06/14/26 06/14/26 -8,002.29 .00 -8,002.29",
    "BBB8604 06/15/26 06/15/26 -5,216.75 .00 -5,216.75",
    "0615318 06/19/26 06/29/26 29,975.45 .00 29,975.45",
    "-51,012.12 .00 -51,012.12",
    "*** End Of EFT Prenotification ***",
  ];

  const { batchLines, summary, warnings } =
    JenkinsGreenValleyEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(batchLines.length, 3);

  assert.strictEqual(batchLines[0].invoiceId, "BBB8622");
  assert.strictEqual(batchLines[0].batchNumber, "0614");
  assert.strictEqual(batchLines[0].amount, -130.63);
  assert.strictEqual(batchLines[0].invDate.getFullYear(), 2026);
  assert.strictEqual(batchLines[0].invDate.getMonth(), 5);
  assert.strictEqual(batchLines[0].invDate.getDate(), 14);

  assert.strictEqual(batchLines[1].invoiceId, "BBB8623");
  assert.strictEqual(batchLines[1].batchNumber, "0614");
  assert.strictEqual(batchLines[1].amount, -8002.29);

  assert.strictEqual(batchLines[2].invoiceId, "BBB8604");
  assert.strictEqual(batchLines[2].batchNumber, "0615");
  assert.strictEqual(batchLines[2].amount, -5216.75);

  assert.ok(summary);
  assert.strictEqual(summary.invoiceNumber, "0615318");
  assert.strictEqual(summary.amount, 29975.45);
  assert.strictEqual(summary.balance, -51012.12);
}

function testSkipsNumericInvoiceRowsAsBatchLines() {
  const lines = [
    "0085636 06/15/26 06/25/26 -114.21 .00 -114.21",
    "0619631 06/28/26 07/08/26 28,801.59 .00 28,801.59",
    "-51,012.12 .00 -51,012.12",
  ];

  const { batchLines, summary, warnings } =
    JenkinsGreenValleyEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 0);
  assert.ok(warnings.some((w) => /No letter-prefixed batch lines/i.test(w.message)));
  assert.ok(summary);
  assert.strictEqual(summary.invoiceNumber, "0619631");
  assert.strictEqual(summary.amount, 28687.38);
  assert.strictEqual(summary.balance, -51012.12);
}

function testBatchNumberFromInvDatePreservesLeadingZeros() {
  assert.strictEqual(
    JenkinsGreenValleyEftInvoiceTemplate.extractBatchNumber("06/14/26"),
    "0614"
  );
  assert.strictEqual(
    JenkinsGreenValleyEftInvoiceTemplate.extractBatchNumber("01/05/26"),
    "0105"
  );
  assert.strictEqual(
    JenkinsGreenValleyEftInvoiceTemplate.extractBatchNumber("12/01/26"),
    "1201"
  );
}

function testKeepsSignedAmounts() {
  const lines = [
    "BBB9002 06/24/26 06/24/26 -297.45 .00 -297.45",
    "BBB9018 06/27/26 06/27/26 150.31 .00 150.31",
  ];

  const { batchLines } = JenkinsGreenValleyEftInvoiceTemplate.extractFromLines(lines);

  assert.strictEqual(batchLines.length, 2);
  assert.strictEqual(batchLines[0].amount, -297.45);
  assert.strictEqual(batchLines[1].amount, 150.31);
}

async function testRealGreenValleyFixturePdf() {
  const fs = require("fs");
  const path = require("path");
  const { parseJenkinsGreenValleyEftPdf } = require("../../backend/parsing/eft-pipeline");
  const fixture = path.join(__dirname, "../fixtures/sample-jenkins-green-valley-eft.pdf");
  if (!fs.existsSync(fixture)) return;

  const result = await parseJenkinsGreenValleyEftPdf(fs.readFileSync(fixture));

  assert.ok(result.summary);
  assert.strictEqual(result.summary.invoiceNumber, "0619631");
  assert.strictEqual(result.summary.amount, 58604.07);
  assert.strictEqual(result.summary.balance, -51012.12);

  assert.strictEqual(result.batchLines.length, 49);
  assert.strictEqual(result.batchLines[0].invoiceId, "BBB8622");
  assert.strictEqual(result.batchLines[0].batchNumber, "0614");
  assert.strictEqual(result.batchLines[0].amount, -130.63);
  assert.strictEqual(result.batchLines[0].invDate, "2026-06-14");

  assert.ok(result.batchLines.every((line) => /^[A-Za-z]/.test(line.invoiceId)));
  assert.ok(result.batchLines.every((line) => /^\d{4}$/.test(line.batchNumber)));
  assert.ok(result.batchLines.some((line) => line.batchNumber === "0615"));
  assert.ok(result.batchLines.some((line) => line.batchNumber === "0630"));
}

async function run() {
  testLetterPrefixedLinesUseInvDateBatch();
  testSkipsNumericInvoiceRowsAsBatchLines();
  testBatchNumberFromInvDatePreservesLeadingZeros();
  testKeepsSignedAmounts();
  await testRealGreenValleyFixturePdf();
  console.log("PASS jenkins green valley eft invoice parser tests");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
