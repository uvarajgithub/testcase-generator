import { describe, expect, it } from "vitest";
import { calculateCoverage, generateCases, inferElementsFromRequirement, inferRequirementModel, parseAcceptanceCriteria, removeDuplicates } from "../src/lib/analysis";
import { azureCaseRows, validateAzureTestCases } from "../src/lib/format";
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

  it("uses acceptance criteria instead of requirement headings for TNA Supervisor generation", () => {
    const tnaRequirement: RequirementInput = {
      projectName: "Elixir-Hropal",
      moduleName: "Business Objective",
      featureName: "Business Objective",
      requirementId: "REQ-TNA",
      requirementTitle: "Business Objective",
      requirementDescription: "Description\nAdministrators can designate a user group as a TNA Supervisor group.",
      acceptanceCriteria: `Business Objective
Administrators can designate a user group as a TNA Supervisor group.

Acceptance Criteria
The New User Group page displays a TNA Supervisor radio button with Yes and No options.
No is selected by default.
Administrators can save a user group with TNA Supervisor set to Yes or No.
Users belonging to a TNA Supervisor group can be selected as supervisors in Employee Profile > Time & Attendance.
Users belonging to a non-TNA Supervisor group are excluded from the supervisor lookup.

Business Rules
Employees assigned to a supervisor become that supervisor's direct reports.`,
      businessRules: "",
      preconditions: "",
      userRole: "Administrator",
      platform: "Web",
      priority: "High",
      additionalNotes: ""
    };
    const model = inferRequirementModel(tnaRequirement);
    expect(model.feature).toBe("TNA Supervisor");
    expect(model.navigation).toEqual(["User Groups", "New User Group"]);
    expect(model.defaultValue).toBe("No");

    const criteria = parseAcceptanceCriteria(tnaRequirement.acceptanceCriteria);
    expect(criteria.some((criterion) => /Business Objective/i.test(criterion.text))).toBe(false);

    const draft = {
      ...generation(),
      requirement: tnaRequirement,
      criteria,
      detectedElements: inferElementsFromRequirement(tnaRequirement, [])
    };
    const cases = generateCases(draft);
    const cells = cases.flatMap((testCase) => [
      testCase.title,
      testCase.feature,
      ...azureCaseRows(testCase).flatMap((row) => [row.stepAction, row.stepExpected])
    ]).join("\n");
    expect(cases[0].title).toBe("Verify the TNA Supervisor field displays Yes and No options with No selected by default on the New User Group page");
    expect(cells).not.toMatch(/Open Business Objective|Sample Business Objective|Business Objective displays/i);
    expect(cells).toContain("Open User Groups and select New User Group.");
    expect(cells).toContain("The TNA Supervisor field displays Yes and No radio-button options.");
    expect(cases.length).toBeGreaterThan(9);
    expect(validateAzureTestCases(cases)).toEqual([]);
  });

  it("generates broad request-type workflow coverage without being limited by screenshot count", () => {
    const requestTypeRequirement: RequirementInput = {
      projectName: "ESS",
      moduleName: "Request Management",
      featureName: "Request Type Configuration",
      requirementId: "REQ-RT",
      requirementTitle: "Configure request types and workflows",
      requirementDescription: "Administrators configure request types such as Leave, Loan, Expense, Travel, and Document and link each request type to the correct workflow.",
      acceptanceCriteria: `Administrators can create request types and link each request type to an active workflow.
Employees can see only active request types when creating a request.
Inactive request types must not be available for new employee requests.
Each request type must route through its own linked workflow.
Only users with request type configuration permission can create or update request types.
Workflow Engine and ESS Request Module failures must be handled without creating incomplete records.`,
      businessRules: "Request type name and workflow are mandatory. Duplicate request type names are not allowed.",
      preconditions: "Administrator and employee users exist.",
      userRole: "Administrator",
      platform: "Web",
      priority: "High",
      additionalNotes: ""
    };
    const criteria = parseAcceptanceCriteria(requestTypeRequirement.acceptanceCriteria);
    const detectedElements = inferElementsFromRequirement(requestTypeRequirement, [
      { id: "SS-001", filename: "request-type-configuration.png" },
      { id: "SS-002", filename: "employee-request-list.png" },
      { id: "SS-003", filename: "workflow-engine-error.png" }
    ]);
    const draft = {
      ...generation(),
      requirement: requestTypeRequirement,
      criteria,
      detectedElements
    };

    const cases = generateCases(draft);
    const titles = cases.map((testCase) => testCase.title).join("\n");

    expect(cases.length).toBeGreaterThan(15);
    expect(titles).toContain("Verify active request types appear when an employee opens the request list");
    expect(titles).toContain("Verify inactive request types are hidden when an employee opens the request list");
    expect(titles).toContain("Verify Workflow Engine unavailability prevents orphaned request type records");
    expect(titles).toContain("Verify a user without configuration rights cannot create a request type");
    expect(validateAzureTestCases(cases)).toEqual([]);
  });
});
