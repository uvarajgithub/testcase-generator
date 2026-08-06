import ExcelJS from "exceljs";
import { generateCases, parseAcceptanceCriteria } from "../../src/lib/analysis";
import { validateAzureTestCases } from "../../src/lib/format";
import type { AcceptanceCriterion, Generation, RequirementInput, TestCase } from "../../src/lib/schemas";
import { parseUploadedTestCases, refinedGeneration } from "./excel";

export type CoverageReviewStatus = "Covered" | "Partial" | "Missing";

export type CoverageReviewItem = {
  acId: string;
  acceptanceCriterion: string;
  status: CoverageReviewStatus;
  score: number;
  matchedTestCases: string[];
  evidence: string;
  recommendation: string;
};

export type CoverageReviewResult = {
  summary: {
    totalAcceptanceCriteria: number;
    existingTestCases: number;
    covered: number;
    partial: number;
    missing: number;
    coveragePercent: number;
    duplicateCount: number;
    weakCaseCount: number;
    suggestedMissingCases: number;
  };
  items: CoverageReviewItem[];
  duplicateTitles: string[];
  weakCases: Array<{ title: string; issue: string }>;
  suggestedTestCases: TestCase[];
  warnings: string[];
};

export async function reviewExistingCoverage(input: ArrayBuffer | Uint8Array, requirement: RequirementInput, originalName = "Existing_Test_Cases.xlsx"): Promise<CoverageReviewResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toWorkbookBuffer(input));
  const uploadedCases = parseUploadedTestCases(workbook);
  if (!uploadedCases.length) throw new Error("No test cases were found in the uploaded workbook. Upload an Excel file with Title, Test Step, Step Action, and Step Expected columns.");

  const existingGeneration = refinedGeneration(uploadedCases, originalName);
  const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
  const reviewItems = criteria.map((criterion) => reviewCriterion(criterion, existingGeneration.testCases));
  const missingCriteria = new Set(reviewItems.filter((item) => item.status !== "Covered").map((item) => item.acId));
  const suggestedTestCases = generateMissingSuggestions(requirement, criteria, missingCriteria);
  const duplicateTitles = duplicateCaseTitles(existingGeneration.testCases);
  const weakCases = weakExistingCases(existingGeneration.testCases);
  const covered = reviewItems.filter((item) => item.status === "Covered").length;
  const partial = reviewItems.filter((item) => item.status === "Partial").length;
  const missing = reviewItems.filter((item) => item.status === "Missing").length;

  return {
    summary: {
      totalAcceptanceCriteria: criteria.length,
      existingTestCases: existingGeneration.testCases.length,
      covered,
      partial,
      missing,
      coveragePercent: criteria.length ? Math.round(((covered + partial * 0.5) / criteria.length) * 100) : 0,
      duplicateCount: duplicateTitles.length,
      weakCaseCount: weakCases.length,
      suggestedMissingCases: suggestedTestCases.length
    },
    items: reviewItems,
    duplicateTitles,
    weakCases,
    suggestedTestCases,
    warnings: [
      "Coverage review compares uploaded test-case intent against acceptance criteria. Review partial matches before adding suggested cases.",
      "Suggested missing test cases use the same Azure title, step, and export validation rules as generated test cases."
    ]
  };
}

function reviewCriterion(criterion: AcceptanceCriterion, testCases: TestCase[]): CoverageReviewItem {
  const ranked = testCases
    .map((testCase) => ({ testCase, score: similarity(criterionText(criterion), caseText(testCase)) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const matches = ranked.filter((item) => item.score >= 0.28).slice(0, 3);
  const status: CoverageReviewStatus = best && best.score >= 0.58 ? "Covered" : best && best.score >= 0.28 ? "Partial" : "Missing";
  return {
    acId: criterion.id,
    acceptanceCriterion: criterion.text,
    status,
    score: best ? Math.round(best.score * 100) : 0,
    matchedTestCases: matches.map((item) => item.testCase.title),
    evidence: best ? `Best match: ${best.testCase.title} (${Math.round(best.score * 100)}%).` : "No related existing test case was found.",
    recommendation: status === "Covered"
      ? "No additional test case is required for this acceptance criterion."
      : status === "Partial"
        ? "Add or update test steps so the exact action, validation, and expected result from this acceptance criterion are measurable."
        : "Add new positive, negative, validation, edge, and security coverage for this acceptance criterion."
  };
}

function generateMissingSuggestions(requirement: RequirementInput, criteria: AcceptanceCriterion[], missingCriteria: Set<string>) {
  if (!missingCriteria.size) return [];
  const generation: Pick<Generation, "requirement" | "criteria" | "detectedElements" | "config"> = {
    requirement,
    criteria,
    detectedElements: [],
    config: {
      selectedTypes: ["Positive", "Negative", "Validation", "Edge", "Security"],
      detailLevel: "Standard",
      priorityDistribution: "Risk based",
      includeTestData: true,
      includeExpectedResults: true,
      includePostconditions: true,
      includeAutomationCandidates: true,
      includeScreenshotReferences: false,
      maxCases: 80,
      preferredLanguage: "English",
      browserDeviceCoverage: "Chrome, Edge"
    }
  };
  return generateCases(generation)
    .filter((testCase) => missingCriteria.has(testCase.acceptanceCriteriaId))
    .filter((testCase) => validateAzureTestCases([testCase]).length === 0)
    .slice(0, Math.max(10, missingCriteria.size * 5));
}

function duplicateCaseTitles(testCases: TestCase[]) {
  const seen = new Map<string, number>();
  testCases.forEach((testCase) => {
    const key = testCase.title.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  return Array.from(seen.entries()).filter(([, count]) => count > 1).map(([title]) => title);
}

function weakExistingCases(testCases: TestCase[]) {
  return testCases.flatMap((testCase) => {
    const issues: string[] = [];
    if (testCase.steps.length < 3) issues.push("Fewer than three executable steps.");
    if (/^(verify|check|validate|test)$/i.test(testCase.title.trim()) || testCase.title.split(/\s+/).length < 6) issues.push("Title is too short or generic.");
    if (testCase.steps.some((step) => /\b(valid value|invalid value|required data|as expected|properly)\b/i.test(step))) issues.push("Steps contain vague data or generic wording.");
    if (/\b(system works correctly|as expected|success|pass)\b/i.test(testCase.expectedResult)) issues.push("Expected result is not measurable.");
    return issues.map((issue) => ({ title: testCase.title, issue }));
  });
}

function similarity(left: string, right: string) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, 1);
}

function tokens(value: string) {
  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "when", "then", "given", "user", "system", "shall", "should", "must", "can", "will", "able", "into", "onto", "page"]);
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stop.has(token)));
}

function criterionText(criterion: AcceptanceCriterion) {
  return [criterion.text, criterion.action, ...criterion.inputs, ...criterion.conditions, ...criterion.validations, ...criterion.outcomes, ...criterion.dependencies].join(" ");
}

function caseText(testCase: TestCase) {
  return [testCase.title, testCase.scenario, testCase.objective, testCase.testData, ...testCase.steps, testCase.expectedResult, testCase.detectedUIElement, ...testCase.tags].join(" ");
}

function toWorkbookBuffer(input: ArrayBuffer | Uint8Array): ExcelJS.Buffer {
  if (input instanceof Uint8Array) return input as unknown as ExcelJS.Buffer;
  if (input instanceof ArrayBuffer) return input as ExcelJS.Buffer;
  return input;
}
