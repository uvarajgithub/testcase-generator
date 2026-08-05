import { describe, expect, it } from "vitest";
import { calculateCoverage, generateCases, inferElementsFromRequirement, parseAcceptanceCriteria, removeDuplicates } from "../src/lib/analysis";
import type { Generation, RequirementInput } from "../src/lib/schemas";

const requirement: RequirementInput = {
  projectName: "Claims Portal",
  moduleName: "Claims",
  featureName: "Claim submission",
  requirementId: "REQ-101",
  requirementTitle: "Submit a claim",
  requirementDescription: "Users submit a claim form with amount, date, upload, and status.",
  acceptanceCriteria: "1. Given a customer enters valid claim details When they submit Then the claim is saved\n2. The amount is required and must reject duplicate submissions\n3. Payment gateway timeout should show retry guidance",
  businessRules: "Only authorized users can submit claims.",
  preconditions: "Customer is signed in.",
  userRole: "Customer",
  platform: "Web",
  priority: "High",
  additionalNotes: ""
};

function generation(): Generation {
  const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
  const detectedElements = inferElementsFromRequirement(requirement, [{ id: "SS-001", filename: "claim-form.png" }]);
  return {
    id: "GEN-1",
    requirement,
    criteria,
    screenshots: [{ id: "SS-001", filename: "claim-form.png", mimeType: "image/png", size: 1024, reference: "Screenshot 1" }],
    detectedElements,
    config: {
      selectedTypes: ["Positive", "Negative", "Edge", "Validation", "Security", "Responsive", "Integration"],
      detailLevel: "Standard",
      priorityDistribution: "Risk based",
      includeTestData: true,
      includeExpectedResults: true,
      includePostconditions: true,
      includeAutomationCandidates: true,
      includeScreenshotReferences: true,
      maxCases: 100,
      preferredLanguage: "English",
      browserDeviceCoverage: "Chrome, iPhone"
    },
    testCases: [],
    assumptions: [],
    ambiguities: [],
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exportHistory: []
  };
}

describe("analysis and generation", () => {
  it("parses numbered and Given/When/Then acceptance criteria into stable IDs", () => {
    const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
    expect(criteria.map((item) => item.id)).toEqual(["AC-001", "AC-002", "AC-003"]);
    expect(criteria[0].outcomes[0]).toContain("the claim is saved");
  });

  it("generates traceable stable test case IDs without duplicates", () => {
    const draft = generation();
    const cases = generateCases(draft);
    expect(cases.some((tc) => tc.id === "POS-001")).toBe(true);
    expect(cases.length).toBeGreaterThan(20);
    expect(cases.every((tc) => tc.requirementId === "REQ-101")).toBe(true);
    expect(removeDuplicates([...cases, cases[0]])).toHaveLength(cases.length);
  });

  it("calculates coverage from actual traceability", () => {
    const draft = generation();
    draft.testCases = generateCases(draft);
    const coverage = calculateCoverage(draft);
    expect(coverage.totalCriteria).toBe(3);
    expect(coverage.coveragePercent).toBe(100);
    expect(coverage.byType.Positive).toBeGreaterThan(0);
  });
});
