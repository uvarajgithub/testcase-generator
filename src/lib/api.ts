import type { AcceptanceCriterion, CoverageSummary, DetectedElement, Generation, GenerationConfig, RequirementInput, TestCase } from "./schemas";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type VisionSummary = {
  requirementTextAnalysed: boolean;
  screenshotsUploaded: number;
  geminiVisionAnalysed: number;
  ocrAnalysed: number;
  failedScreenshots: number;
  screenshotFindingsDetected: number;
  screenshotFindingsUsed: number;
  screenshotFindingsIgnored: number;
  duplicateFindingsRemoved: number;
  uniqueCoverageBehaviours: number;
  plannedTestCases: number;
  generationMode: "Gemini Vision-assisted" | "OCR-assisted" | "Requirement text only";
  averageConfidence: number;
  warnings: string[];
};
export type ScreenshotAnalysisReport = {
  screenshotId: string;
  filename: string;
  status: string;
  mode: string;
  screenshotType: string;
  confidence: number;
  rawExtractedText: string[];
  detectedSections: string[];
  detectedRoles: string[];
  detectedEntities: string[];
  detectedStates: string[];
  detectedFields: string[];
  detectedButtons: string[];
  detectedBusinessRules: string[];
  detectedUiRequirements: string[];
  detectedDependencies: string[];
  warnings: string[];
  findings: Array<{ value: string; source: string; mode: string; confidence: number; usedInCoverage: boolean }>;
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
  items: Array<{
    acId: string;
    acceptanceCriterion: string;
    status: "Covered" | "Partial" | "Missing";
    score: number;
    matchedTestCases: string[];
    evidence: string;
    recommendation: string;
    reviewComments: Array<{
      severity: "Info" | "Warning" | "Required";
      title: string;
      comment: string;
      suggestedAction: string;
    }>;
  }>;
  duplicateTitles: string[];
  weakCases: Array<{ title: string; issue: string }>;
  suggestedTestCases: TestCase[];
  warnings: string[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers } });
  if (response.headers.get("content-type")?.includes("json")) {
    const body = (await response.json()) as ApiResponse<T>;
    if (!body.ok) throw new Error(body.error.message);
    return body.data;
  }
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response as T;
}

export const api = {
  health: () => request<{ status: string; aiConfigured: boolean; visionConfigured: boolean; visionEnabled: boolean; ocrFallbackEnabled: boolean; model: string }>("/api/health"),
  uploadScreenshots: async (files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append("screenshots", file));
    return request<{ screenshots: Generation["screenshots"] }>("/api/screenshots", { method: "POST", body: form });
  },
  analyze: (requirement: RequirementInput, screenshots: Generation["screenshots"]) =>
    request<{ criteria: AcceptanceCriterion[]; detectedElements: DetectedElement[]; warnings: string[]; assumptions: string[]; ambiguities: string[] }>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ requirement, screenshots })
    }),
  analyzeScreenshots: (requirement: RequirementInput, screenshots: File[], options?: { userStory?: string; additionalContext?: string; userCorrections?: string }) => {
    const form = new FormData();
    form.append("requirement", JSON.stringify(requirement));
    form.append("userStory", options?.userStory ?? requirement.requirementTitle);
    form.append("additionalContext", options?.additionalContext ?? requirement.businessRules);
    form.append("userCorrections", options?.userCorrections ?? "");
    screenshots.forEach((file) => form.append("screenshots", file));
    return request<{ criteria: AcceptanceCriterion[]; detectedElements: DetectedElement[]; warnings: string[]; assumptions: string[]; ambiguities: string[]; summary: VisionSummary; reports: ScreenshotAnalysisReport[] }>("/api/screenshots/analyse", {
      method: "POST",
      body: form
    });
  },
  saveGeneration: (payload: Partial<Generation> & { requirement: RequirementInput; config: GenerationConfig }) =>
    request<{ generation: Generation; coverage: CoverageSummary }>("/api/generations", { method: "POST", body: JSON.stringify(payload) }),
  updateGeneration: (generation: Generation) =>
    request<{ generation: Generation; coverage: CoverageSummary }>(`/api/generations/${generation.id}`, { method: "PUT", body: JSON.stringify(generation) }),
  generations: () => request<{ generations: Generation[] }>("/api/generations"),
  templates: () => request<{ templates: Array<{ id: string; name: string; platform: string; selectedTypes: string[]; instructions: string }> }>("/api/templates"),
  settings: () => request<{ settings: Record<string, unknown>; aiConfigured: boolean }>("/api/settings"),
  exportExcel: async (generationId: string, config?: { areaPath?: string; assignedTo?: string; state?: string }) => {
    const response = await fetch(`/api/generations/${generationId}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(config ?? {}) });
    if (!response.ok) throw new Error("Excel export failed.");
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "TestCraft_Test_Cases.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    return filename;
  },
  refineExistingExcel: async (file: File) => {
    const form = new FormData();
    form.append("workbook", file);
    const response = await fetch("/api/refine-existing-excel", { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiResponse<unknown> | null;
      throw new Error(body && !body.ok ? body.error.message : "Existing test-case refinement failed.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "Refined_Azure_DevOps_Test_Cases.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    return filename;
  },
  reviewExistingCoverage: (requirement: RequirementInput, file: File) => {
    const form = new FormData();
    form.append("requirement", JSON.stringify(requirement));
    form.append("workbook", file);
    return request<{ review: CoverageReviewResult }>("/api/review-existing-coverage", { method: "POST", body: form });
  },
  exportCoverageReviewExcel: async (requirement: RequirementInput, file: File, mode: "suggested-only" | "merge-with-existing") => {
    const form = new FormData();
    form.append("requirement", JSON.stringify(requirement));
    form.append("workbook", file);
    form.append("mode", mode);
    const response = await fetch("/api/review-existing-coverage/export", { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiResponse<unknown> | null;
      throw new Error(body && !body.ok ? body.error.message : "Coverage review Excel export failed.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "Coverage_Review_Suggestions.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);
    return filename;
  },
  openHtml: async (generationId: string) => {
    const response = await fetch(`/api/generations/${generationId}/html`, { method: "POST" });
    if (!response.ok) throw new Error("HTML report export failed.");
    const html = await response.text();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};
