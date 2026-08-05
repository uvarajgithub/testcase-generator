import ExcelJS from "exceljs";
import type { Generation, TestCase } from "../../src/lib/schemas";
import { calculateCoverage } from "../../src/lib/analysis";
import { azureCaseRows } from "../../src/lib/format";
import { sanitizeFilename } from "./http";

export type AzureExportConfig = {
  areaPath?: string;
  assignedTo?: string;
  state?: string;
  testType?: string;
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

function addAzureDevOpsImport(workbook: ExcelJS.Workbook, generation: Generation, azureConfig: AzureExportConfig) {
  const sheet = workbook.addWorksheet("Sheet2");
  sheet.columns = [
    { key: "id", header: "ID", width: 8 },
    { key: "workItemType", header: "Work Item Type", width: 18 },
    { key: "title", header: "Title", width: 48 },
    { key: "testStep", header: "Test Step", width: 11 },
    { key: "stepAction", header: "Step Action", width: 52 },
    { key: "stepExpected", header: "Step Expected", width: 52 },
    { key: "areaPath", header: "Area Path", width: 28 },
    { key: "assignedTo", header: "Assigned To", width: 28 },
    { key: "state", header: "State", width: 12 },
    { key: "testType", header: "Test Type", width: 16 }
  ];

  const state = sanitizeExcelValue(azureConfig.state || "Design");
  const testType = sanitizeExcelValue(azureConfig.testType || "Functional");
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
        state: isMetadata ? state : "",
        testType: isMetadata ? testType : ""
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
