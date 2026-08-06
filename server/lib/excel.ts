import ExcelJS from "exceljs";
import type { Generation, TestCase } from "../../src/lib/schemas";
import { calculateCoverage } from "../../src/lib/analysis";
import { azureCaseRows, scrubDocumentHeadingText, stripTitlePrefix, validateAzureTestCases } from "../../src/lib/format";
import { sanitizeFilename } from "./http";

export type AzureExportConfig = {
  areaPath?: string;
  assignedTo?: string;
  state?: string;
};

const testCaseColumns: Array<[keyof TestCase, string, number]> = [
  ["id", "Test Case ID", 16],
  ["requirementId", "Requirement ID", 18],
  ["acceptanceCriteriaId", "Acceptance Criteria ID", 20],
  ["module", "Module", 18],
  ["feature", "Feature", 20],
  ["scenario", "Test Scenario", 36],
  ["title", "Test Case Title", 36],
  ["type", "Test Case Type", 18],
  ["objective", "Test Objective", 36],
  ["preconditions", "Preconditions", 30],
  ["testData", "Test Data", 30],
  ["steps", "Test Steps", 44],
  ["expectedResult", "Expected Result", 42],
  ["postconditions", "Postconditions", 28],
  ["priority", "Priority", 14],
  ["severity", "Severity", 14],
  ["automationCandidate", "Automation Candidate", 22],
  ["automationNotes", "Automation Notes", 32],
  ["screenshotReference", "Screenshot Reference", 24],
  ["detectedUIElement", "Detected UI Element", 28],
  ["assumptions", "Assumptions", 32],
  ["tags", "Tags", 24],
  ["executionStatus", "Execution Status", 18],
  ["actualResult", "Actual Result", 28],
  ["defectId", "Defect ID", 18],
  ["testerComments", "Tester Comments", 32]
];

export function buildFilename(generation: Generation, date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  return `${sanitizeFilename(generation.requirement.projectName)}_${sanitizeFilename(generation.requirement.moduleName)}_Azure_DevOps_Test_Cases_${stamp}.xlsx`;
}

export async function buildWorkbook(generation: Generation, previousGenerations: Generation[] = [], azureConfig: AzureExportConfig = {}) {
  const validationErrors = validateAzureTestCases(generation.testCases);
  if (validationErrors.length) throw new Error(`Azure export validation failed: ${validationErrors.slice(0, 5).join(" ")}`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TestCraft AI";
  workbook.created = new Date();
  addAzureDevOpsImport(workbook, generation, azureConfig);
  addTestCases(workbook, generation);
  addPreviousTestCases(workbook, previousGenerations);
  addTraceability(workbook, generation);
  addCoverage(workbook, generation);
  addTestData(workbook, generation);
  addScreenshotAnalysis(workbook, generation);
  return workbook.xlsx.writeBuffer();
}

export async function buildRefinedWorkbook(input: ArrayBuffer | Uint8Array, originalName = "Existing_Test_Cases.xlsx", azureConfig: AzureExportConfig = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toWorkbookBuffer(input));
  const parsedCases = parseUploadedTestCases(workbook);
  if (!parsedCases.length) throw new Error("No test cases were found in the uploaded workbook. Upload an Excel file with Title, Test Step, Step Action, and Step Expected columns.");
  const generation = refinedGeneration(parsedCases, originalName);
  const buffer = await buildWorkbook(generation, [], azureConfig);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  return {
    buffer,
    filename: `${sanitizeFilename("Refined_" + originalName.replace(/\.[^.]+$/, ""))}_Azure_DevOps_Test_Cases_${stamp}.xlsx`,
    count: generation.testCases.length
  };
}

function toWorkbookBuffer(input: ArrayBuffer | Uint8Array): ExcelJS.Buffer {
  if (input instanceof Uint8Array) return input as unknown as ExcelJS.Buffer;
  if (input instanceof ArrayBuffer) return input as ExcelJS.Buffer;
  return input;
}

export type UploadedCase = {
  title: string;
  steps: string[];
  expectedResults: string[];
  type?: TestCase["type"];
  priority?: TestCase["priority"];
};

export function parseUploadedTestCases(workbook: ExcelJS.Workbook): UploadedCase[] {
  const sheet = workbook.getWorksheet("Sheet2") ?? workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers = headerRow.values as ExcelJS.CellValue[];
  const columnByHeader = new Map<string, number>();
  headers.forEach((value, index) => {
    const key = normalizeHeader(cellText(value));
    if (key) columnByHeader.set(key, index);
  });
  const titleColumn = findColumn(columnByHeader, ["title", "test case title", "test title", "scenario"]);
  const stepColumn = findColumn(columnByHeader, ["test step", "step", "step no", "step number"]);
  const actionColumn = findColumn(columnByHeader, ["step action", "action", "test steps", "steps"]);
  const expectedColumn = findColumn(columnByHeader, ["step expected", "expected result", "expected results", "expected"]);
  const typeColumn = findColumn(columnByHeader, ["test type", "test case type", "type"]);
  const priorityColumn = findColumn(columnByHeader, ["priority"]);
  if (!titleColumn && !actionColumn && !expectedColumn) return [];

  const cases: UploadedCase[] = [];
  let current: UploadedCase | undefined;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const title = cleanUploadedText(rowValue(row, titleColumn));
    const stepAction = cleanUploadedText(rowValue(row, actionColumn));
    const stepExpected = cleanUploadedText(rowValue(row, expectedColumn));
    const stepValue = cleanUploadedText(rowValue(row, stepColumn));
    const type = parseType(rowValue(row, typeColumn));
    const priority = parsePriority(rowValue(row, priorityColumn));
    const hasMetadata = Boolean(title);
    const hasStep = Boolean(stepAction || stepExpected || /^\d+$/.test(stepValue));
    if (hasMetadata) {
      current = { title, steps: [], expectedResults: [], type, priority };
      cases.push(current);
    }
    if (!current && hasStep) {
      current = { title: `Imported test case ${cases.length + 1}`, steps: [], expectedResults: [], type, priority };
      cases.push(current);
    }
    if (current && hasStep) {
      splitStepText(stepAction || title || `Review imported test case ${cases.length}`).forEach((step) => current?.steps.push(step));
      if (stepExpected) current.expectedResults.push(stepExpected);
    }
  });
  return cases.filter((item) => item.title || item.steps.length);
}

export function refinedGeneration(uploadedCases: UploadedCase[], originalName: string): Generation {
  const now = new Date().toISOString();
  const usedTitles = new Set<string>();
  const testCases = uploadedCases.map((item, index) => refineUploadedCase(item, index, usedTitles));
  const criteria = testCases.map((testCase, index) => ({
    id: `IMP-${String(index + 1).padStart(3, "0")}`,
    text: testCase.scenario,
    actor: "QA user",
    action: testCase.objective,
    inputs: [],
    conditions: [],
    validations: [testCase.expectedResult],
    outcomes: [testCase.expectedResult],
    dependencies: [],
    assumptions: ["Refined from an uploaded existing test-case workbook."],
    warnings: []
  }));
  return {
    id: `REF-${Date.now().toString().slice(-8)}`,
    requirement: {
      projectName: "Refined Existing Test Cases",
      moduleName: "Uploaded Workbook",
      featureName: "Existing test case optimization",
      requirementId: "UPLOAD-REFINE",
      requirementTitle: "Refine existing test cases",
      requirementDescription: `Uploaded workbook: ${originalName}`,
      acceptanceCriteria: testCases.map((testCase) => testCase.scenario).join("\n"),
      businessRules: "",
      preconditions: "",
      userRole: "QA user",
      platform: "Web",
      priority: "High",
      additionalNotes: "Acceptance criteria were not required for this refinement workflow."
    },
    criteria,
    screenshots: [],
    detectedElements: [],
    config: {
      selectedTypes: ["Positive", "Negative", "Validation", "Edge", "Security"],
      detailLevel: "Standard",
      priorityDistribution: "Risk based",
      includeTestData: true,
      includeExpectedResults: true,
      includePostconditions: true,
      includeAutomationCandidates: true,
      includeScreenshotReferences: true,
      maxCases: 250,
      preferredLanguage: "English",
      browserDeviceCoverage: "Chrome, Edge"
    },
    testCases,
    assumptions: ["Existing test cases were refined from the uploaded workbook without requiring acceptance criteria."],
    ambiguities: [],
    warnings: [],
    createdAt: now,
    updatedAt: now,
    exportHistory: []
  };
}

function refineUploadedCase(item: UploadedCase, index: number, usedTitles: Set<string>): TestCase {
  const type = item.type ?? inferType(item.title, item.steps.join(" "));
  const prefix = typePrefix(type);
  const feature = featureFromTitle(item.title || item.steps[0] || `Imported test case ${index + 1}`, index);
  const title = uniqueTitle(refinedTitle(item.title || feature, feature, index), usedTitles);
  const expectedResult = measurableExpected(item.expectedResults.at(-1), feature);
  return {
    id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    requirementId: "UPLOAD-REFINE",
    acceptanceCriteriaId: `IMP-${String(index + 1).padStart(3, "0")}`,
    module: "Uploaded Workbook",
    feature,
    scenario: stripTitlePrefix(scrubDocumentHeadingText(item.title || title)),
    title,
    type,
    objective: `Refine and execute the imported scenario for ${feature}.`,
    preconditions: "The tester has access to the application area named in the imported test case.",
    testData: "Use existing uploaded test data or create reviewer-approved values for the named fields.",
    steps: refinedSteps(item.steps, feature),
    expectedResult,
    postconditions: "The application state remains ready for the next test case.",
    priority: item.priority ?? "High",
    severity: item.priority ?? "High",
    automationCandidate: "Partial",
    automationNotes: "Review selectors and environment data before automation.",
    screenshotReference: "",
    detectedUIElement: feature,
    assumptions: "Refined from uploaded Excel content.",
    tags: ["refined", "uploaded"],
    executionStatus: "Not Run",
    actualResult: "",
    defectId: "",
    testerComments: "",
    inferred: true
  };
}

function refinedSteps(steps: string[], feature: string) {
  const cleaned = steps
    .map((step) => concreteStep(step, feature))
    .filter(Boolean);
  const padded = cleaned.length ? cleaned : [`Open the ${feature} page.`];
  while (padded.length < 3) {
    if (padded.length === 1) padded.push(`Review the ${feature} page controls required for the imported scenario.`);
    else padded.push(`Click the ${feature} submit or save button for the imported scenario.`);
  }
  return padded.slice(0, 12);
}

function concreteStep(value: string, feature: string) {
  const cleaned = stripListPrefix(scrubDocumentHeadingText(value)).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/^(open|click|select|enter|review|verify|confirm|inspect|navigate|search|choose|leave|focus|replace|submit|save)\b/i.test(cleaned)) {
    return cleaned.toLowerCase().includes(feature.toLowerCase()) ? cleaned : `${cleaned.replace(/[. ]+$/, "")} on the ${feature} page.`;
  }
  return `Review the ${feature} page control for ${cleaned}.`;
}

function refinedTitle(value: string, feature: string, index: number) {
  const cleaned = stripTitlePrefix(scrubDocumentHeadingText(value)).replace(/\s+/g, " ").trim();
  const withoutVerify = cleaned.replace(/^verify\s+/i, "");
  const base = withoutVerify && withoutVerify.split(/\s+/).length >= 5 ? withoutVerify : `${feature} imported scenario ${index + 1} shows the correct application response`;
  const title = `Verify ${base}`;
  return title.split(/\s+/).length >= 8 ? title : `${title} in the application workflow`;
}

function uniqueTitle(title: string, used: Set<string>) {
  let next = title;
  let copy = 2;
  while (used.has(next.toLowerCase())) {
    next = `${title} ${copy}`;
    copy += 1;
  }
  used.add(next.toLowerCase());
  return next;
}

function measurableExpected(value: string | undefined, feature: string) {
  const cleaned = cleanUploadedText(value ?? "");
  if (cleaned && !/^(pass|passed|ok|success|successful)$/i.test(cleaned)) {
    return cleaned.split(/\s+/).length >= 6 ? scrubDocumentHeadingText(cleaned) : `${feature} displays "${scrubDocumentHeadingText(cleaned)}" as a visible status after the action.`;
  }
  return `The ${feature} page displays the expected status, message, or saved value for the performed action.`;
}

function featureFromTitle(value: string, index: number) {
  const words = stripTitlePrefix(scrubDocumentHeadingText(value))
    .replace(/^verify\s+/i, "")
    .replace(/[^a-z0-9\s/&-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
  return words ? `${words} page` : `Imported test case ${index + 1} page`;
}

function splitStepText(value: string) {
  return value
    .split(/\r?\n|(?:^|\s)(?=\d+[.)]\s+)/)
    .map(stripListPrefix)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripListPrefix(value: string) {
  return value.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "");
}

function rowValue(row: ExcelJS.Row, column: number | undefined) {
  return column ? cellText(row.getCell(column).value) : "";
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text ?? "");
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("formula" in value) return String(value.result ?? value.formula ?? "");
  }
  return String(value);
}

function cleanUploadedText(value: string) {
  return scrubDocumentHeadingText(value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim());
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findColumn(headers: Map<string, number>, names: string[]) {
  for (const name of names) {
    const direct = headers.get(normalizeHeader(name));
    if (direct) return direct;
  }
  for (const [header, index] of headers) {
    if (names.some((name) => header.includes(normalizeHeader(name)))) return index;
  }
  return undefined;
}

function parseType(value: string): TestCase["type"] | undefined {
  const lower = value.toLowerCase();
  if (lower.includes("negative")) return "Negative";
  if (lower.includes("edge")) return "Edge";
  if (lower.includes("validation")) return "Validation";
  if (lower.includes("security")) return "Security";
  if (lower.includes("accessibility")) return "Accessibility";
  if (lower.includes("responsive")) return "Responsive";
  if (lower.includes("integration")) return "Integration";
  if (lower.includes("ui")) return "UI";
  if (lower.includes("positive")) return "Positive";
  return undefined;
}

function inferType(title: string, steps: string): TestCase["type"] {
  const text = `${title} ${steps}`.toLowerCase();
  if (/\bunauthori[sz]ed|permission|token|session|security\b/.test(text)) return "Security";
  if (/\binvalid|empty|required|validation|error\b/.test(text)) return "Validation";
  if (/\bboundary|max|min|edge|limit\b/.test(text)) return "Edge";
  if (/\bapi|integration|service\b/.test(text)) return "Integration";
  return "Positive";
}

function parsePriority(value: string): TestCase["priority"] | undefined {
  const lower = value.toLowerCase();
  if (lower.includes("critical")) return "Critical";
  if (lower.includes("high")) return "High";
  if (lower.includes("medium")) return "Medium";
  if (lower.includes("low")) return "Low";
  return undefined;
}

function typePrefix(type: TestCase["type"]) {
  return {
    Positive: "POS",
    Negative: "NEG",
    Edge: "EDGE",
    Validation: "VAL",
    UI: "UI",
    Accessibility: "A11Y",
    Security: "SEC",
    Responsive: "RESP",
    Integration: "INT"
  }[type];
}

function addAzureDevOpsImport(workbook: ExcelJS.Workbook, generation: Generation, azureConfig: AzureExportConfig) {
  const sheet = workbook.addWorksheet("Sheet2");
  sheet.columns = [
    { key: "id", header: "ID", width: 10 },
    { key: "workItemType", header: "Work Item Type", width: 18 },
    { key: "title", header: "Title", width: 60 },
    { key: "testStep", header: "Test Step", width: 12 },
    { key: "stepAction", header: "Step Action", width: 55 },
    { key: "stepExpected", header: "Step Expected", width: 60 },
    { key: "areaPath", header: "Area Path", width: 30 },
    { key: "assignedTo", header: "Assigned To", width: 25 },
    { key: "state", header: "State", width: 15 }
  ];

  const state = sanitizeExcelValue(azureConfig.state || "Design");
  const areaPath = sanitizeExcelValue(azureConfig.areaPath || `${generation.requirement.projectName}\\${generation.requirement.moduleName}`);
  const assignedTo = sanitizeExcelValue(azureConfig.assignedTo || "");

  generation.testCases.forEach((testCase) => {
    azureCaseRows(testCase).forEach((row, index) => {
      const isMetadata = index === 0;
      sheet.addRow({
        id: row.id,
        workItemType: row.workItemType,
        title: sanitizeExcelValue(truncateTitle(row.title)),
        testStep: row.testStep,
        stepAction: sanitizeExcelValue(row.stepAction),
        stepExpected: sanitizeExcelValue(row.stepExpected),
        areaPath: isMetadata ? areaPath : "",
        assignedTo: isMetadata ? assignedTo : "",
        state: isMetadata ? state : ""
      });
    });
  });

  styleAzureSheet(sheet);
}

function truncateTitle(value: string) {
  return value.length > 128 ? `${value.slice(0, 125)}...` : value;
}

function sanitizeExcelValue(value: unknown) {
  const text = String(value ?? "").replace(/\u0000/g, "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function styleAzureSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
  sheet.eachRow((row, rowNumber) => {
    row.font = { name: "Segoe UI", size: 11 };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } }
      };
      if (rowNumber === 1) {
        cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FF000000" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      }
    });
    if (rowNumber === 1) row.height = 22;
    else row.height = Math.max(28, Math.min(90, row.actualCellCount * 4));
  });
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  });
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } }
      };
      if (rowNumber > 1 && rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
  });
}

function addTestCases(workbook: ExcelJS.Workbook, generation: Generation) {
  const sheet = workbook.addWorksheet("Test Cases");
  sheet.columns = testCaseColumns.map(([key, header, width]) => ({ key, header, width }));
  generation.testCases.forEach((testCase) => {
    sheet.addRow({ ...testCase, steps: testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"), tags: testCase.tags.join(", ") });
  });
  sheet.getColumn("executionStatus").eachCell((cell, row) => {
    if (row > 1) cell.dataValidation = { type: "list", allowBlank: true, formulae: ['"Not Run,Passed,Failed,Blocked,Deferred"'] };
  });
  sheet.getColumn("automationCandidate").eachCell((cell, row) => {
    if (row > 1) cell.dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No,Partial"'] };
  });
  styleSheet(sheet);
}

function addPreviousTestCases(workbook: ExcelJS.Workbook, previousGenerations: Generation[]) {
  const sheet = workbook.addWorksheet("Previous Test Cases");
  sheet.columns = [
    { key: "generationId", header: "Generation ID", width: 18 },
    { key: "project", header: "Project", width: 22 },
    { key: "sourceModule", header: "Source Module", width: 18 },
    { key: "sourceFeature", header: "Source Feature", width: 22 },
    ...testCaseColumns.map(([key, header, width]) => ({ key, header, width }))
  ];
  const rows = previousGenerations.flatMap((generation) => generation.testCases.map((testCase) => ({ generation, testCase })));
  if (!rows.length) {
    sheet.addRow({ generationId: "No previous test cases were found." });
  }
  rows.forEach(({ generation, testCase }) => {
    sheet.addRow({
      generationId: generation.id,
      project: generation.requirement.projectName,
      sourceModule: generation.requirement.moduleName,
      sourceFeature: generation.requirement.featureName,
      ...testCase,
      steps: testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      tags: testCase.tags.join(", ")
    });
  });
  styleSheet(sheet);
}

function addTraceability(workbook: ExcelJS.Workbook, generation: Generation) {
  const sheet = workbook.addWorksheet("Requirements Traceability");
  sheet.columns = [
    { header: "Requirement ID", key: "requirementId", width: 18 },
    { header: "Acceptance Criteria ID", key: "acId", width: 22 },
    { header: "Acceptance Criterion", key: "criterion", width: 48 },
    { header: "Screenshot Reference", key: "screenshot", width: 24 },
    { header: "Related Test Case IDs", key: "cases", width: 30 },
    { header: "Test Types Covered", key: "types", width: 28 },
    { header: "Coverage Status", key: "status", width: 18 },
    { header: "Assumptions", key: "assumptions", width: 32 },
    { header: "Comments", key: "comments", width: 24 }
  ];
  generation.criteria.forEach((ac) => {
    const related = generation.testCases.filter((tc) => tc.acceptanceCriteriaId === ac.id);
    sheet.addRow({
      requirementId: generation.requirement.requirementId,
      acId: ac.id,
      criterion: ac.text,
      screenshot: generation.detectedElements.find((el) => el.relatedAcceptanceCriterionId === ac.id)?.screenshotName ?? "",
      cases: related.map((tc) => tc.id).join(", "),
      types: Array.from(new Set(related.map((tc) => tc.type))).join(", "),
      status: related.length ? "Covered" : "Uncovered",
      assumptions: ac.assumptions.join("; "),
      comments: ""
    });
  });
  styleSheet(sheet);
}

function addCoverage(workbook: ExcelJS.Workbook, generation: Generation) {
  const coverage = calculateCoverage(generation);
  const sheet = workbook.addWorksheet("Coverage Summary");
  sheet.columns = [{ header: "Metric", key: "metric", width: 34 }, { header: "Value", key: "value", width: 48 }];
  [
    ["Project", generation.requirement.projectName],
    ["Module", generation.requirement.moduleName],
    ["Feature", generation.requirement.featureName],
    ["Generation date and time", new Date().toISOString()],
    ["Total test cases", coverage.totalTestCases],
    ["Count by test type", JSON.stringify(coverage.byType)],
    ["Count by priority", JSON.stringify(coverage.byPriority)],
    ["Count by automation suitability", JSON.stringify(coverage.byAutomation)],
    ["Covered acceptance criteria", coverage.coveredCriteria.join(", ")],
    ["Uncovered acceptance criteria", coverage.uncoveredCriteria.join(", ")],
    ["Coverage percentage", `${coverage.coveragePercent}%`],
    ["Assumptions and warnings", [...generation.assumptions, ...generation.warnings].join("; ")]
  ].forEach(([metric, value]) => sheet.addRow({ metric, value }));
  styleSheet(sheet);
}

function addTestData(workbook: ExcelJS.Workbook, generation: Generation) {
  const sheet = workbook.addWorksheet("Test Data");
  sheet.columns = [
    { header: "Data ID", key: "id", width: 14 },
    { header: "Field", key: "field", width: 24 },
    { header: "Valid Value", key: "valid", width: 24 },
    { header: "Invalid Value", key: "invalid", width: 28 },
    { header: "Boundary Value", key: "boundary", width: 28 },
    { header: "Description", key: "description", width: 36 },
    { header: "Related Test Case IDs", key: "cases", width: 30 }
  ];
  const fields = Array.from(new Set(generation.criteria.flatMap((ac) => ac.inputs.length ? ac.inputs : [generation.requirement.featureName])));
  fields.forEach((field, index) => sheet.addRow({
    id: `TD-${String(index + 1).padStart(3, "0")}`,
    field,
    valid: `Valid ${field}`,
    invalid: `Invalid or empty ${field}`,
    boundary: `Min/max/null ${field}`,
    description: "Reusable generated data set. Review before execution.",
    cases: generation.testCases.filter((tc) => tc.testData.toLowerCase().includes(field.toLowerCase())).map((tc) => tc.id).join(", ")
  }));
  styleSheet(sheet);
}

function addScreenshotAnalysis(workbook: ExcelJS.Workbook, generation: Generation) {
  const sheet = workbook.addWorksheet("Screenshot Analysis");
  sheet.columns = [
    { header: "Screenshot filename", key: "filename", width: 28 },
    { header: "Screenshot reference ID", key: "reference", width: 22 },
    { header: "Detected element", key: "element", width: 28 },
    { header: "Element type", key: "type", width: 22 },
    { header: "Visible text", key: "text", width: 30 },
    { header: "Related acceptance criterion", key: "ac", width: 26 },
    { header: "Related test cases", key: "cases", width: 28 },
    { header: "Confidence", key: "confidence", width: 14 },
    { header: "User correction", key: "correction", width: 28 },
    { header: "Notes", key: "notes", width: 34 }
  ];
  if (!generation.screenshots.length) {
    sheet.addRow({
      filename: "No screenshots were provided for this generation.",
      reference: "",
      element: "",
      type: "",
      text: "",
      ac: "",
      cases: "",
      confidence: "",
      correction: "",
      notes: "Generated from acceptance criteria only."
    });
  }
  generation.detectedElements.forEach((element) => sheet.addRow({
    filename: element.screenshotName,
    reference: element.screenshotId,
    element: element.label,
    type: element.type,
    text: element.visibleText,
    ac: element.relatedAcceptanceCriterionId ?? "",
    cases: generation.testCases.filter((tc) => tc.detectedUIElement.includes(element.label)).map((tc) => tc.id).join(", "),
    confidence: element.confidence,
    correction: element.userCorrection,
    notes: element.notes
  }));
  styleSheet(sheet);
}
