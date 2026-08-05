import { describe, expect, it } from "vitest";
import { buildHtmlReport } from "../server/lib/html";
import { generateCases, inferElementsFromRequirement, parseAcceptanceCriteria } from "../src/lib/analysis";
import type { Generation } from "../src/lib/schemas";

function generation(id: string, projectName: string): Generation {
  const requirement = {
    projectName,
    moduleName: "Accounts",
    featureName: "Account creation",
    requirementId: "REQ-HTML",
    requirementTitle: "Create account",
    requirementDescription: "",
    acceptanceCriteria: "User can create an account with valid details",
    businessRules: "",
    preconditions: "",
    userRole: "QA user",
    platform: "Web" as const,
    priority: "High" as const,
    additionalNotes: ""
  };
  const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
  const draft: Generation = {
    id,
    requirement,
    criteria,
    screenshots: [],
    detectedElements: inferElementsFromRequirement(requirement, []),
    config: {
      selectedTypes: ["Positive", "Negative", "Edge"],
      detailLevel: "Standard",
      priorityDistribution: "Risk based",
      includeTestData: true,
      includeExpectedResults: true,
      includePostconditions: true,
      includeAutomationCandidates: true,
      includeScreenshotReferences: true,
      maxCases: 250,
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
  draft.testCases = generateCases(draft);
  return draft;
}

describe("HTML report", () => {
  it("renders current and previous test cases safely", () => {
    const html = buildHtmlReport(generation("GEN-1", "<Current>"), [generation("GEN-0", "Previous")]);
    expect(html).toContain("TestCraft AI Test Case Report");
    expect(html).toContain("Previous Test Cases");
    expect(html).toContain("&lt;Current&gt;");
    expect(html).toContain("Previous");
    expect(html).not.toMatch(/<td>POS-\d{3}:/);
  });
});
