import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { generateCases, inferElementsFromRequirement, parseAcceptanceCriteria } from "../src/lib/analysis";
import type { Generation } from "../src/lib/schemas";
import { buildFilename, buildRefinedWorkbook, buildWorkbook } from "../server/lib/excel";

function sampleGeneration(): Generation {
  const requirement = {
    projectName: "Billing:Portal",
    moduleName: "Invoices",
    featureName: "Pay invoice",
    requirementId: "REQ-77",
    requirementTitle: "Invoice payment",
    requirementDescription: "User pays invoice with amount field and submit button.",
    acceptanceCriteria: "User can pay an invoice with valid card details\nInvalid card details show a validation error",
    businessRules: "Payment gateway failures allow retry.",
    preconditions: "Invoice is unpaid.",
    userRole: "User",
    platform: "Web" as const,
    priority: "Critical" as const,
    additionalNotes: ""
  };
  const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
  const detectedElements = inferElementsFromRequirement(requirement, [{ id: "SS-1", filename: "invoice.png" }]);
  const generation: Generation = {
    id: "GEN-X",
    requirement,
    criteria,
    screenshots: [{ id: "SS-1", filename: "invoice.png", mimeType: "image/png", size: 1, reference: "Screenshot 1" }],
    detectedElements,
    config: {
      selectedTypes: ["Positive", "Negative", "Edge", "Validation", "Integration"],
      detailLevel: "Detailed",
      priorityDistribution: "Risk based",
      includeTestData: true,
      includeExpectedResults: true,
      includePostconditions: true,
      includeAutomationCandidates: true,
      includeScreenshotReferences: true,
      maxCases: 20,
      preferredLanguage: "English",
      browserDeviceCoverage: "Chrome"
    },
    testCases: [],
    assumptions: [],
    ambiguities: [],
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exportHistory: []
  };
  generation.testCases = generateCases(generation);
  return generation;
}

describe("Excel workbook", () => {
  it("builds required sheets and dropdown validations", async () => {
    const buffer = await buildWorkbook(sampleGeneration(), [], { areaPath: "Billing\\Invoices", assignedTo: "qa@example.com", state: "Design" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Sheet2",
      "Test Cases",
      "Previous Test Cases",
      "Requirements Traceability",
      "Coverage Summary",
      "Test Data",
      "Screenshot Analysis"
    ]);
    const adoSheet = workbook.getWorksheet("Sheet2")!;
    expect(adoSheet.getRow(1).values).toEqual([
      undefined,
      "ID",
      "Work Item Type",
      "Title",
      "Test Step",
      "Step Action",
      "Step Expected",
      "Area Path",
      "Assigned To",
      "State"
    ]);
    expect(adoSheet.getCell("A2").value).toBe("");
    expect(adoSheet.getCell("B2").value).toBe("Test Case");
    expect(String(adoSheet.getCell("C2").value)).not.toMatch(/^POS-\d{3}:/);
    expect(adoSheet.getCell("D2").value).toBe("");
    expect(adoSheet.getCell("E2").value).toBe("");
    expect(adoSheet.getCell("F2").value).toBe("");
    expect(adoSheet.getCell("G2").value).toBe("Billing\\Invoices");
    expect(adoSheet.getCell("H2").value).toBe("qa@example.com");
    expect(adoSheet.getCell("I2").value).toBe("Design");
    expect(adoSheet.columnCount).toBe(9);
    expect(adoSheet.getCell("A3").value).toBe("");
    expect(adoSheet.getCell("B3").value).toBe("");
    expect(adoSheet.getCell("C3").value).toBe("");
    expect(adoSheet.getCell("D3").value).toBe(1);
    expect(adoSheet.getCell("E3").value).toBeTruthy();
    expect(adoSheet.getCell("F3").value).toBeTruthy();
    expect(adoSheet.getCell("G3").value).toBe("");
    const sheet = workbook.getWorksheet("Test Cases")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Test Case ID");
    expect(sheet.getCell("Q2").dataValidation?.type).toBe("list");
    expect(sheet.getCell("W2").dataValidation?.type).toBe("list");
  });

  it("sanitizes Excel filenames", () => {
    expect(buildFilename(sampleGeneration(), new Date("2026-08-05T10:30:00Z"))).toBe("Billing_Portal_Invoices_Azure_DevOps_Test_Cases_2026-08-05_10-30.xlsx");
  });

  it("restarts step numbering and protects Azure values", async () => {
    const gen = sampleGeneration();
    gen.testCases[0].steps[0] = "=Open the Billing invoice payment page.";
    const buffer = await buildWorkbook(gen, [], { areaPath: "+Area", assignedTo: "@qa@example.com" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Sheet2")!;
    expect(String(sheet.getCell("E3").value)).toMatch(/^'/);
    expect(String(sheet.getCell("G2").value)).toBe("'+Area");
    expect(String(sheet.getCell("H2").value)).toBe("'@qa@example.com");
    const nextMetadataRow = gen.testCases[0].steps.length + 3;
    expect(sheet.getCell(`B${nextMetadataRow}`).value).toBe("Test Case");
    expect(sheet.getCell(`D${nextMetadataRow}`).value).toBe("");
    expect(sheet.getCell(`D${nextMetadataRow + 1}`).value).toBe(1);
  });

  it("refines an uploaded existing test-case workbook without acceptance criteria", async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("Sheet2");
    sheet.columns = [
      { header: "ID", key: "id" },
      { header: "Work Item Type", key: "workItemType" },
      { header: "Title", key: "title" },
      { header: "Test Step", key: "testStep" },
      { header: "Step Action", key: "stepAction" },
      { header: "Step Expected", key: "stepExpected" }
    ];
    sheet.addRow({ workItemType: "Test Case", title: "POS-002: Login user" });
    sheet.addRow({ testStep: 1, stepAction: "Open login page", stepExpected: "Login page is displayed" });
    sheet.addRow({ testStep: 2, stepAction: "Enter username field", stepExpected: "Username value is displayed" });
    sheet.addRow({ testStep: 3, stepAction: "Click login button", stepExpected: "Dashboard page is displayed" });
    const sourceBuffer = await source.xlsx.writeBuffer();
    const result = await buildRefinedWorkbook(sourceBuffer, "existing-cases.xlsx");
    const refined = new ExcelJS.Workbook();
    await refined.xlsx.load(result.buffer);
    const adoSheet = refined.getWorksheet("Sheet2")!;
    expect(adoSheet.getRow(1).values).toEqual([undefined, "ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected", "Area Path", "Assigned To", "State"]);
    expect(String(adoSheet.getCell("C2").value)).toMatch(/^Verify /);
    expect(String(adoSheet.getCell("C2").value)).not.toMatch(/^POS-\d{3}:/);
    expect(adoSheet.getCell("D2").value).toBe("");
    expect(adoSheet.getCell("D3").value).toBe(1);
    expect(adoSheet.columnCount).toBe(9);
  });
});
