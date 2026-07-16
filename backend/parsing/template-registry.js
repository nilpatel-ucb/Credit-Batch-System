const DEFAULT_BATCH_TEMPLATE = "chevron";
const DEFAULT_EFT_TEMPLATE = "jenkins_eft";

const BATCH_TEMPLATES = {
  chevron: {
    id: "chevron",
    label: "Chevron",
    getParse: () => require("./chevron-pipeline").parseChevronPdf,
  },
};

const EFT_TEMPLATES = {
  jenkins_eft: {
    id: "jenkins_eft",
    label: "Jenkins EFT",
    getParse: () => require("./eft-pipeline").parseEftPdf,
  },
  jackson_eft: {
    id: "jackson_eft",
    label: "Jackson EFT",
    getParse: () => require("./eft-pipeline").parseJacksonEftPdf,
  },
};

function listBatchTemplates() {
  return Object.values(BATCH_TEMPLATES).map(({ id, label }) => ({ id, label }));
}

function listEftTemplates() {
  return Object.values(EFT_TEMPLATES).map(({ id, label }) => ({ id, label }));
}

function normalizeBatchTemplateId(templateId) {
  const id = String(templateId || "").trim() || DEFAULT_BATCH_TEMPLATE;
  if (!BATCH_TEMPLATES[id]) {
    throw new Error(`Unknown credit batch template "${id}".`);
  }
  return id;
}

function normalizeEftTemplateId(templateId) {
  const id = String(templateId || "").trim() || DEFAULT_EFT_TEMPLATE;
  if (!EFT_TEMPLATES[id]) {
    throw new Error(`Unknown EFT invoice template "${id}".`);
  }
  return id;
}

function getBatchPipeline(templateId) {
  return BATCH_TEMPLATES[normalizeBatchTemplateId(templateId)].getParse();
}

function getEftPipeline(templateId) {
  return EFT_TEMPLATES[normalizeEftTemplateId(templateId)].getParse();
}

module.exports = {
  DEFAULT_BATCH_TEMPLATE,
  DEFAULT_EFT_TEMPLATE,
  BATCH_TEMPLATES,
  EFT_TEMPLATES,
  listBatchTemplates,
  listEftTemplates,
  normalizeBatchTemplateId,
  normalizeEftTemplateId,
  getBatchPipeline,
  getEftPipeline,
};
