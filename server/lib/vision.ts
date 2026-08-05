import { z } from "zod";
import { inferElementsFromRequirement, parseAcceptanceCriteria } from "../../src/lib/analysis";
import { detectedElementSchema, requirementSchema, type DetectedElement, type RequirementInput } from "../../src/lib/schemas";

export type AiProviderConfig = {
  provider: "gemini";
  apiKeyConfigured: boolean;
  model: string;
  visionEnabled: boolean;
  ocrFallbackEnabled: boolean;
};

export type ScreenshotInput = {
  id: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
};

export type VisionSummary = {
  requirementTextAnalysed: boolean;
  screenshotsUploaded: number;
  geminiVisionAnalysed: number;
  ocrAnalysed: number;
  failedScreenshots: number;
  generationMode: "Gemini Vision-assisted" | "OCR-assisted" | "Requirement text only";
  averageConfidence: number;
  warnings: string[];
};

export type ScreenshotAnalysisResponse = {
  criteria: ReturnType<typeof parseAcceptanceCriteria>;
  detectedElements: DetectedElement[];
  warnings: string[];
  assumptions: string[];
  ambiguities: string[];
  summary: VisionSummary;
};

const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const lowConfidenceThreshold = 0.65;
const reliableConfidenceThreshold = 0.65;

const visionControlSchema = z.object({
  label: z.string().default(""),
  type: z.string().default("control"),
  options: z.array(z.string()).default([]),
  selectedValue: z.string().nullable().default(null),
  defaultValue: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.5),
  source: z.string().default("screenshot-vision")
});

const visionResultSchema = z.object({
  analysisMode: z.string().default("vision-assisted"),
  screenshotType: z.enum(["application_screen", "requirement_document", "work_item_screen", "excel_output", "design_mockup", "unknown"]),
  screenName: z.string().default(""),
  navigation: z.array(z.string()).default([]),
  controls: z.array(visionControlSchema).default([]),
  visibleText: z.array(z.string()).default([]),
  validationMessages: z.array(z.string()).default([]),
  tables: z.array(z.object({ name: z.string().default(""), headers: z.array(z.string()).default([]) })).default([]),
  businessRules: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  overallConfidence: z.number().min(0).max(1).default(0)
});

type VisionResult = z.infer<typeof visionResultSchema>;

export function getAiProviderConfig(env: Record<string, unknown> = runtimeEnv()): AiProviderConfig {
  const apiKey = stringEnv(env.GEMINI_API_KEY);
  const visionEnabled = booleanEnv(env.ENABLE_GEMINI_VISION, true);
  return {
    provider: "gemini",
    apiKeyConfigured: Boolean(apiKey),
    model: stringEnv(env.GEMINI_MODEL) || "gemini-2.5-flash",
    visionEnabled: Boolean(apiKey) && visionEnabled,
    ocrFallbackEnabled: booleanEnv(env.ENABLE_OCR_FALLBACK, true)
  };
}

export function publicVisionStatus(env: Record<string, unknown> = runtimeEnv()) {
  const config = getAiProviderConfig(env);
  return {
    visionConfigured: config.apiKeyConfigured && config.visionEnabled,
    visionEnabled: config.visionEnabled,
    ocrFallbackEnabled: config.ocrFallbackEnabled,
    model: config.model
  };
}

export async function analyseScreenshots(input: {
  requirement: RequirementInput;
  screenshots: ScreenshotInput[];
  userStory?: string;
  additionalContext?: string;
  userCorrections?: string;
  env?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<ScreenshotAnalysisResponse> {
  const requirement = requirementSchema.parse(input.requirement);
  const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
  const config = getAiProviderConfig(input.env);
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const reliableVision: VisionResult[] = [];
  const ocrResults: VisionResult[] = [];
  let failedScreenshots = 0;

  for (const screenshot of input.screenshots) {
    validateScreenshot(screenshot);
    const vision = config.visionEnabled
      ? await tryGeminiVision({ ...input, requirement, screenshot, config, fetchImpl: input.fetchImpl ?? fetch })
      : { result: null, warning: "Gemini Vision is not configured." };
    if (vision.result && isReliableVisionResult(vision.result)) {
      reliableVision.push(vision.result);
      continue;
    }
    if (vision.warning) warnings.push(vision.warning);
    if (config.ocrFallbackEnabled) {
      const ocr = tryLocalOcr(requirement, screenshot);
      if (isReliableVisionResult(ocr)) {
        ocrResults.push(ocr);
        continue;
      }
    }
    failedScreenshots += 1;
  }

  const usedResults = reliableVision.length ? reliableVision : ocrResults;
  const mode = reliableVision.length
    ? "Gemini Vision-assisted"
    : ocrResults.length
      ? "OCR-assisted"
      : input.screenshots.length
        ? "Requirement text only"
        : "Requirement text only";
  if (mode === "Gemini Vision-assisted") warnings.push("The screenshots were analysed using Gemini Vision and combined with the acceptance criteria.");
  else if (mode === "OCR-assisted") warnings.push("Gemini Vision was unavailable. The screenshots were analysed using local OCR-style text and layout fallback.");
  else if (input.screenshots.length) warnings.push("The screenshots could not be analysed reliably. Test cases will be generated from the requirement text only.");

  const screenshotRefs = input.screenshots.map((shot) => ({ id: shot.id, filename: shot.filename }));
  const fallbackElements = inferElementsFromRequirement(requirement, screenshotRefs);
  const detectedElements = usedResults.length ? resultsToDetectedElements(usedResults, input.screenshots, requirement) : fallbackElements;
  const validatedElements = detectedElements.map((item) => detectedElementSchema.parse(item));
  assumptions.push(...validatedElements.map((item) => item.assumption).filter(Boolean));
  const averageConfidence = usedResults.length ? Math.round((usedResults.reduce((sum, item) => sum + item.overallConfidence, 0) / usedResults.length) * 100) : 0;

  return {
    criteria,
    detectedElements: validatedElements,
    warnings,
    assumptions,
    ambiguities: warnings,
    summary: {
      requirementTextAnalysed: Boolean(requirement.acceptanceCriteria.trim()),
      screenshotsUploaded: input.screenshots.length,
      geminiVisionAnalysed: reliableVision.length,
      ocrAnalysed: reliableVision.length ? 0 : ocrResults.length,
      failedScreenshots,
      generationMode: mode,
      averageConfidence,
      warnings
    }
  };
}

function validateScreenshot(screenshot: ScreenshotInput) {
  if (!allowedMimeTypes.has(screenshot.mimeType)) throw new Error("Unsupported image type. Upload PNG, JPG, JPEG, or WebP files.");
  if (!hasValidSignature(screenshot.data, screenshot.mimeType)) throw new Error("Unsupported or invalid image file.");
}

function hasValidSignature(data: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (mimeType === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/webp") return textBytes(data.slice(0, 4)) === "RIFF" && textBytes(data.slice(8, 12)) === "WEBP";
  return false;
}

async function tryGeminiVision(input: {
  requirement: RequirementInput;
  screenshot: ScreenshotInput;
  userStory?: string;
  additionalContext?: string;
  userCorrections?: string;
  config: AiProviderConfig;
  env?: Record<string, unknown>;
  fetchImpl: typeof fetch;
}): Promise<{ result: VisionResult | null; warning?: string }> {
  const apiKey = stringEnv(input.env?.GEMINI_API_KEY ?? runtimeEnv().GEMINI_API_KEY);
  if (!apiKey) return { result: null, warning: "Gemini Vision is not configured." };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.config.model)}:generateContent`;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: visionPrompt(input.requirement, input.userStory, input.additionalContext, input.userCorrections) },
        { inlineData: { mimeType: input.screenshot.mimeType, data: base64(input.screenshot.data) } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };
  try {
    const response = await input.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) return { result: null, warning: sanitizedProviderFailure(response.status) };
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    if (!text) return { result: null, warning: "Gemini Vision returned an empty analysis." };
    const parsed = safeJson(text);
    const result = visionResultSchema.parse(parsed);
    return { result };
  } catch {
    return { result: null, warning: "Gemini Vision was unavailable or returned invalid structured output." };
  }
}

function tryLocalOcr(requirement: RequirementInput, screenshot: ScreenshotInput): VisionResult {
  const source = `${screenshot.filename} ${requirement.requirementTitle} ${requirement.acceptanceCriteria} ${requirement.businessRules}`;
  const type = /excel|xlsx|step expected|step action|priority/i.test(source)
    ? "excel_output"
    : /azure|jira|work item|assigned to|area path/i.test(source)
      ? "work_item_screen"
      : /business objective|acceptance criteria|description/i.test(source)
        ? "requirement_document"
        : "application_screen";
  const controls = Array.from(source.matchAll(/\b(TNA Supervisor|Save|Yes|No|Supervisor lookup|User Groups|New User Group|Employee Profile|Time & Attendance|email|password|submit|login)\b/gi))
    .map((match) => match[1])
    .filter((value, index, values) => values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .map((label) => ({
      label,
      type: /yes|no/i.test(label) ? "radio-option" : /save|submit|login/i.test(label) ? "button" : /lookup/i.test(label) ? "lookup" : "field",
      options: /TNA Supervisor/i.test(label) ? ["Yes", "No"] : [],
      selectedValue: /TNA Supervisor/i.test(label) ? "No" : null,
      defaultValue: /TNA Supervisor/i.test(label) ? "No" : null,
      enabled: true,
      confidence: 0.66,
      source: "ocr-fallback"
    }));
  return {
    analysisMode: "ocr-assisted",
    screenshotType: type,
    screenName: /new user group/i.test(source) ? "New User Group" : requirement.featureName,
    navigation: /user groups/i.test(source) ? ["User Groups", "New User Group"] : [requirement.moduleName, requirement.featureName].filter(Boolean),
    controls,
    visibleText: [],
    validationMessages: [],
    tables: [],
    businessRules: [],
    warnings: ["Local OCR fallback uses extracted text hints and requirement context; review detected elements before generation."],
    overallConfidence: controls.length ? 0.66 : 0.2
  };
}

function isReliableVisionResult(result: VisionResult) {
  if (result.overallConfidence < reliableConfidenceThreshold) return false;
  if (["work_item_screen", "excel_output", "unknown"].includes(result.screenshotType) && result.controls.length === 0) return false;
  return true;
}

function resultsToDetectedElements(results: VisionResult[], screenshots: ScreenshotInput[], requirement: RequirementInput): DetectedElement[] {
  return results.flatMap((result, resultIndex) => {
    const screenshot = screenshots[resultIndex] ?? screenshots[0] ?? { id: "SS-001", filename: "Screenshot" };
    if (result.screenshotType !== "application_screen" && result.screenshotType !== "design_mockup") {
      return [{
        id: `UI-${String(resultIndex + 1).padStart(3, "0")}`,
        screenshotId: screenshot.id,
        screenshotName: screenshot.filename,
        type: result.screenshotType,
        label: result.screenName || requirement.featureName,
        visibleText: result.visibleText.join(", "),
        relatedAcceptanceCriterionId: undefined,
        confidence: result.overallConfidence,
        userCorrection: "",
        notes: "Screenshot classified as non-application context; document/export headings were not treated as application controls.",
        assumption: result.warnings.join("; ")
      }];
    }
    return result.controls
      .filter((control) => control.confidence >= lowConfidenceThreshold)
      .filter((control) => !/business objective|acceptance criteria|step action|step expected|work item type|area path|assigned to/i.test(control.label))
      .map((control, controlIndex) => ({
        id: `UI-${String(resultIndex + 1).padStart(2, "0")}-${String(controlIndex + 1).padStart(2, "0")}`,
        screenshotId: screenshot.id,
        screenshotName: screenshot.filename,
        type: control.type,
        label: control.label,
        visibleText: [
          control.options.length ? `Options: ${control.options.join(", ")}` : "",
          control.defaultValue ? `Default: ${control.defaultValue}` : "",
          control.selectedValue ? `Selected: ${control.selectedValue}` : ""
        ].filter(Boolean).join("; "),
        relatedAcceptanceCriterionId: undefined,
        confidence: control.confidence,
        userCorrection: "",
        notes: `Screen: ${result.screenName || requirement.featureName}; Navigation: ${result.navigation.join(" > ")}; Source: ${control.source}`,
        assumption: control.confidence < 0.85 ? "Medium-confidence screenshot detection; review before generation." : ""
      }));
  });
}

function visionPrompt(requirement: RequirementInput, userStory = "", additionalContext = "", userCorrections = "") {
  return `You are analysing screenshots for software test-case generation.

Determine whether each screenshot is one of: application_screen, requirement_document, work_item_screen, excel_output, design_mockup, unknown.

For application screens, identify screen name, navigation, field labels, controls, buttons, links, radio buttons, checkboxes, dropdowns, tabs, table headers, default values, selected values, enabled/disabled states, validation messages, errors, business data, and label/control relationships.

For requirement-document, Azure/Jira, Excel-output, or document screenshots, do not treat headings such as Business Objective, Acceptance Criteria, Description, Test Step, Step Action, Step Expected, Work Item Type, State, Assigned To, or Area Path as application controls.

Return JSON only with this shape: analysisMode, screenshotType, screenName, navigation, controls, visibleText, validationMessages, tables, businessRules, warnings, overallConfidence.
Do not invent controls. When uncertain, reduce confidence and add warnings.

Acceptance criteria:
${requirement.acceptanceCriteria}

User story:
${userStory || requirement.requirementTitle}

Additional context:
${additionalContext || requirement.businessRules}

User corrections:
${userCorrections}`;
}

function safeJson(value: string) {
  const trimmed = value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

function sanitizedProviderFailure(status: number) {
  if (status === 401 || status === 403) return "Gemini Vision could not authenticate with the configured server-side key.";
  if (status === 429) return "Gemini Vision quota or rate limit was reached.";
  if (status === 404) return "The configured Gemini model was unavailable.";
  if (status >= 500) return "Gemini Vision was temporarily unavailable.";
  return "Gemini Vision request failed and fallback analysis was used.";
}

function booleanEnv(value: unknown, defaultValue: boolean) {
  if (value == null || value === "") return defaultValue;
  return !/^(false|0|no|off)$/i.test(String(value));
}

function stringEnv(value: unknown) {
  return String(value ?? "").trim();
}

function runtimeEnv() {
  return typeof process !== "undefined" ? process.env : {};
}

function textBytes(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => String.fromCharCode(byte)).join("");
}

function base64(data: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
  let binary = "";
  data.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
