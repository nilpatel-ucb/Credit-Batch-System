/**
 * Ingestion layer — PDF bytes → text lines via pdf.js (Node/Electron main process).
 */
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { toUint8Array } = require("./buffer-utils");

pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
  "pdfjs-dist/legacy/build/pdf.worker.js"
);

const GAP_THRESHOLD = 4;
//text content is the text content of the pdf
//gap threshold is the threshold for the gap between lines
//line map is a map of lines by y coordinate
//line map is a map of lines by y coordinate

//function extractLinesFromPdf extracts the lines from the pdf outputs an object with the following properties:
//lines: array of strings
//pageCount: number of pages in the pdf
function extractLinesFromTextContent(textContent, gapThreshold = GAP_THRESHOLD) {
  const lineMap = new Map();

  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    const width = item.width || item.str.length * 4;
    if (!lineMap.has(y)) lineMap.set(y, []);
    lineMap.get(y).push({ x, str: item.str, width });
  }

  return [...lineMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => {
      const sorted = parts.sort((a, b) => a.x - b.x);
      let line = sorted[0].str;
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const gap = curr.x - (prev.x + prev.width);
        line += (gap > gapThreshold ? " " : "") + curr.str;
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

//function extractLinesFromPDF outputs an array of strings
// ["309359 03-31-2026 0341 CC 94 2,405.22 ...", "Batch", "Total", "104 2,643.80 ...", ...]
async function extractLinesFromPdf(buffer) {
  const data = toUint8Array(buffer);

  const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const lines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    lines.push(...extractLinesFromTextContent(textContent));
  }

  return {
    lines,
    pageCount: pdf.numPages,
  };
}

module.exports = {
  extractLinesFromTextContent,
  extractLinesFromPdf,
};
