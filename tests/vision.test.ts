import { describe, expect, it } from "vitest";
import { analyseScreenshots, publicVisionStatus } from "../server/lib/vision";
import { generateCases, parseAcceptanceCriteria } from "../src/lib/analysis";
import type { Generation, RequirementInput } from "../src/lib/schemas";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const requirement: RequirementInput = {
  projectName: "HR",
  moduleName: "User Groups",
  featureName: "TNA Supervisor",
  requirementId: "REQ-1",
  requirementTitle: "New User Group TNA Supervisor",
  requirementDescription: "Employee Profile Time & Attendance Supervisor lookup uses the TNA Supervisor group.",
  acceptanceCriteria: "User Groups New User Group contains TNA Supervisor radio buttons Yes and No with No selected by default. Users in TNA Supervisor groups appear in Employee Profile Time & Attendance Supervisor lookup.",
  businessRules: "Save persists the selected TNA Supervisor value.",
  preconditions: "",
  userRole: "Administrator",
  platform: "Web",
  priority: "High",
  additionalNotes: ""
};

describe("Gemini Vision analysis", () => {
  it("reports configuration without exposing the key", () => {
    const status = publicVisionStatus({ GEMINI_API_KEY: "secret", GEMINI_MODEL: "gemini-2.5-flash", ENABLE_GEMINI_VISION: "true" });
    expect(status).toEqual({ visionConfigured: true, visionEnabled: true, ocrFallbackEnabled: true, model: "gemini-2.5-flash" });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("parses valid Gemini JSON and filters document headings as controls", async () => {
    let requestBody: unknown;
    const fetchImpl = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        analysis_mode: "vision-assisted",
        screenshot_type: "application screen",
        screen_name: "New User Group",
        navigation: ["User Groups", "New User Group"],
        controls: [
          { label: "TNA Supervisor", type: "radio-group", options: ["Yes", "No"], selected_value: "No", default_value: "No", enabled: true, confidence: 96, source: "screenshot-vision" },
          { label: "Save", type: "button", options: [], selected_value: null, default_value: null, enabled: true, confidence: "94%", source: "screenshot-vision" },
          { label: "Business Objective", type: "field", options: [], selected_value: null, default_value: null, enabled: true, confidence: 99, source: "screenshot-vision" }
        ],
        visibleText: [],
        validationMessages: [],
        tables: [],
        businessRules: [],
        warnings: [],
        overall_confidence: 94
      }) }] } }]
    }));
    const fetchImplWithCapture: typeof fetch = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return fetchImpl();
    };
    const result = await analyseScreenshots({
      requirement,
      screenshots: [{ id: "SS-1", filename: "new-user-group.png", mimeType: "image/png", data: png }],
      env: { GEMINI_API_KEY: "secret", ENABLE_GEMINI_VISION: "true" },
      fetchImpl: fetchImplWithCapture
    });
    expect(JSON.stringify(requestBody)).toContain("inline_data");
    expect(JSON.stringify(requestBody)).toContain("mime_type");
    expect(result.summary.generationMode).toBe("Gemini Vision-assisted");
    expect(result.reports[0].status).toBe("Vision analysed");
    expect(result.reports[0].findings.some((finding) => finding.value.includes("TNA Supervisor") && finding.usedInCoverage)).toBe(true);
    expect(result.detectedElements.map((item) => item.label)).toContain("TNA Supervisor");
    expect(result.detectedElements.map((item) => item.label)).toContain("Save");
    expect(result.detectedElements.map((item) => item.label)).not.toContain("Business Objective");
  });

  it("falls back when Gemini is missing and does not let screenshot count reduce suite size", async () => {
    const one = await analyseScreenshots({
      requirement,
      screenshots: [{ id: "SS-1", filename: "new-user-group-tna-supervisor-save.png", mimeType: "image/png", data: png }],
      env: { ENABLE_GEMINI_VISION: "true", ENABLE_OCR_FALLBACK: "true" }
    });
    const three = await analyseScreenshots({
      requirement,
      screenshots: [1, 2, 3].map((i) => ({ id: `SS-${i}`, filename: `new-user-group-tna-supervisor-save-${i}.png`, mimeType: "image/png", data: png })),
      env: { ENABLE_GEMINI_VISION: "true", ENABLE_OCR_FALLBACK: "true" }
    });
    expect(one.summary.generationMode).toBe("OCR-assisted");
    expect(three.summary.generationMode).toBe("OCR-assisted");
    expect(caseCount(one)).toBe(caseCount(three));
  });
});

function caseCount(analysis: Awaited<ReturnType<typeof analyseScreenshots>>) {
  const generation: Pick<Generation, "requirement" | "criteria" | "detectedElements" | "config"> = {
    requirement,
    criteria: parseAcceptanceCriteria(requirement.acceptanceCriteria),
    detectedElements: analysis.detectedElements,
    config: {
      selectedTypes: ["Positive", "Negative", "Validation", "Edge", "Security"],
      detailLevel: "Standard",
      priorityDistribution: "Risk based",
      includeTestData: true,
      includeExpectedResults: true,
      includePostconditions: true,
      includeAutomationCandidates: true,
      includeScreenshotReferences: true,
      maxCases: 50,
      preferredLanguage: "English",
      browserDeviceCoverage: "Chrome"
    }
  };
  return generateCases(generation).length;
}
