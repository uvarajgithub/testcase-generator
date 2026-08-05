import { z } from "zod";

export const testTypes = [
  "Positive",
  "Negative",
  "Edge",
  "Validation",
  "UI",
  "Accessibility",
  "Security",
  "Responsive",
  "Integration"
] as const;

export const priorities = ["Low", "Medium", "High", "Critical"] as const;
export const platforms = ["Web", "Mobile", "Desktop", "API", "Other"] as const;
export const automation = ["Yes", "No", "Partial"] as const;
export const statuses = ["Not Run", "Passed", "Failed", "Blocked", "Deferred"] as const;

export const requirementSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  moduleName: z.string().min(1, "Module name is required"),
  featureName: z.string().min(1, "Feature name is required"),
  requirementId: z.string().min(1, "Requirement ID is required"),
  requirementTitle: z.string().min(1, "Requirement title is required"),
  requirementDescription: z.string().default(""),
  acceptanceCriteria: z.string().min(1, "Acceptance criteria are required"),
  businessRules: z.string().default(""),
  preconditions: z.string().default(""),
  userRole: z.string().default("QA user"),
  platform: z.enum(platforms).default("Web"),
  priority: z.enum(priorities).default("High"),
  additionalNotes: z.string().default("")
});

export const detectedElementSchema = z.object({
  id: z.string(),
  screenshotId: z.string(),
  screenshotName: z.string(),
  type: z.string(),
  label: z.string(),
  visibleText: z.string(),
  relatedAcceptanceCriterionId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  userCorrection: z.string().default(""),
  notes: z.string().default(""),
  assumption: z.string().default("")
});

export const acceptanceCriterionSchema = z.object({
  id: z.string(),
  text: z.string(),
  actor: z.string().default("User"),
  action: z.string().default(""),
  inputs: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  validations: z.array(z.string()).default([]),
  outcomes: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});

export const generationConfigSchema = z.object({
  selectedTypes: z.array(z.enum(testTypes)).min(1),
  detailLevel: z.enum(["Concise", "Standard", "Detailed"]).default("Standard"),
  priorityDistribution: z.string().default("Risk based"),
  includeTestData: z.boolean().default(true),
  includeExpectedResults: z.boolean().default(true),
  includePostconditions: z.boolean().default(true),
  includeAutomationCandidates: z.boolean().default(true),
  includeScreenshotReferences: z.boolean().default(true),
  maxCases: z.number().int().min(1).max(250).default(60),
  preferredLanguage: z.string().default("English"),
  browserDeviceCoverage: z.string().default("Chrome, Edge, Safari, iPhone, Android")
});

export const testCaseSchema = z.object({
  id: z.string(),
  requirementId: z.string(),
  acceptanceCriteriaId: z.string(),
  module: z.string(),
  feature: z.string(),
  scenario: z.string(),
  title: z.string(),
  type: z.enum(testTypes),
  objective: z.string(),
  preconditions: z.string(),
  testData: z.string(),
  steps: z.array(z.string()),
  expectedResult: z.string(),
  postconditions: z.string(),
  priority: z.enum(priorities),
  severity: z.enum(priorities),
  automationCandidate: z.enum(automation),
  automationNotes: z.string(),
  screenshotReference: z.string(),
  detectedUIElement: z.string(),
  assumptions: z.string(),
  tags: z.array(z.string()),
  executionStatus: z.enum(statuses).default("Not Run"),
  actualResult: z.string().default(""),
  defectId: z.string().default(""),
  testerComments: z.string().default(""),
  inferred: z.boolean().default(false)
});

export const generationSchema = z.object({
  id: z.string(),
  requirement: requirementSchema,
  criteria: z.array(acceptanceCriterionSchema),
  screenshots: z.array(z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    reference: z.string(),
    dataUrl: z.string().optional()
  })),
  detectedElements: z.array(detectedElementSchema),
  config: generationConfigSchema,
  testCases: z.array(testCaseSchema),
  assumptions: z.array(z.string()),
  ambiguities: z.array(z.string()),
  warnings: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  exportHistory: z.array(z.object({ filename: z.string(), exportedAt: z.string() })).default([])
});

export type RequirementInput = z.infer<typeof requirementSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type DetectedElement = z.infer<typeof detectedElementSchema>;
export type GenerationConfig = z.infer<typeof generationConfigSchema>;
export type TestCase = z.infer<typeof testCaseSchema>;
export type Generation = z.infer<typeof generationSchema>;

export type CoverageSummary = {
  totalCriteria: number;
  totalTestCases: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  byAutomation: Record<string, number>;
  coveredCriteria: string[];
  uncoveredCriteria: string[];
  coveredElements: string[];
  uncoveredElements: string[];
  assumptionsCount: number;
  ambiguitiesCount: number;
  automationCandidateCount: number;
  coveragePercent: number;
};
