const assert = require("assert");
const CStoreGreenValleyTemplate = require(
  "../../backend/parsing/templates/cstore_green_valley"
);

function testDailyRowsUseCreditCardAsNet() {
  const lines = [
    "06/01/26",
    "Mon \t8,582.95 \t6,439.52 \t2,091.58 \t(700.00) \t700.00 \t24.71 \t8,555.81 (27.14)",
    "06/15/26",
    "Mon \t8,847.17 \t6,689.18 \t40.00 2,111.52 \t(700.00) \t700.00 \t36.07 \t8,876.77 29.60",
    "TOTAL",
    "M.T.D: \t260,029.58 201,878.99 62.00 57,298.23",
  ];

  const { records, warnings } = CStoreGreenValleyTemplate.extractFromLines(lines, {
    siteId: "12345",
  });

  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(records.length, 2);
  assert.deepStrictEqual(
    records.map((record) => ({
      siteId: record.site_id,
      batchNumber: record.batch_number,
      gross: record.gross_amount,
      fee: record.total_fee,
      net: record.net_amount,
    })),
    [
      { siteId: "12345", batchNumber: "0602", gross: 0, fee: 0, net: 6439.52 },
      { siteId: "12345", batchNumber: "0616", gross: 0, fee: 0, net: 6689.18 },
    ]
  );
}

function testBatchNumberRollsIntoNextMonthAndYear() {
  const { records } = CStoreGreenValleyTemplate.extractFromLines([
    "12/31/2026",
    "Thu 1,000.00 900.00 100.00",
  ]);

  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].batch_number, "0101");
  assert.strictEqual(records[0].batch_date.getFullYear(), 2026);
  assert.strictEqual(records[0].batch_date.getMonth(), 11);
  assert.strictEqual(records[0].batch_date.getDate(), 31);
}

function testBatchNumberUsesCalendarDateRollover() {
  const batchNumber = CStoreGreenValleyTemplate.nextDayBatchNumber;

  assert.strictEqual(batchNumber(new Date(2026, 0, 31)), "0201");
  assert.strictEqual(batchNumber(new Date(2026, 3, 30)), "0501");
  assert.strictEqual(batchNumber(new Date(2026, 1, 28)), "0301");
  assert.strictEqual(batchNumber(new Date(2028, 1, 28)), "0229");
  assert.strictEqual(batchNumber(new Date(2028, 1, 29)), "0301");
}

function run() {
  testDailyRowsUseCreditCardAsNet();
  testBatchNumberRollsIntoNextMonthAndYear();
  testBatchNumberUsesCalendarDateRollover();
  console.log("PASS CStore Green Valley parser tests");
}

run();
