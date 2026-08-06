import { AlertCircle, BarChart3, Check, ClipboardCheck, Copy, Edit3, ExternalLink, FilePenLine, FileSpreadsheet, FileText, Filter, Image, Loader2, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Shell } from "./components/Shell";
import { Field } from "./components/Field";
import { api, type CoverageReviewResult, type ScreenshotAnalysisReport, type VisionSummary } from "./lib/api";
import { calculateCoverage, inferRequirementModel, isDocumentHeading, normalizeRequirementText } from "./lib/analysis";
import { azureCaseRows, validateAzureTestCases } from "./lib/format";
import { generationConfigSchema, priorities, testTypes, type CoverageSummary, type Generation, type GenerationConfig, type RequirementInput, type TestCase } from "./lib/schemas";

const emptyRequirement: RequirementInput = {
  projectName: "",
  moduleName: "",
  featureName: "",
  requirementId: "",
  requirementTitle: "",
  requirementDescription: "",
  acceptanceCriteria: "",
  businessRules: "",
  preconditions: "",
  userRole: "QA user",
  platform: "Web",
  priority: "High",
  additionalNotes: ""
};

const defaultConfig: GenerationConfig = generationConfigSchema.parse({
  selectedTypes: testTypes,
  detailLevel: "Standard",
  includeTestData: true,
  includeExpectedResults: true,
  includePostconditions: true,
  includeAutomationCandidates: true,
  includeScreenshotReferences: true,
  maxCases: 250
});

type ReqFile = { name: string; size: number; type: string };
type AzureConfig = { areaPath: string; assignedTo: string; state: string };
type TestCaseWorkflow = "Generate New" | "Review & Refine" | "Review Coverage";

const workflowCopy: Record<TestCaseWorkflow, { title: string; subtitle: string }> = {
  "Generate New": {
    title: "Generate Test Cases",
    subtitle: "Create detailed test cases from requirements and screenshots."
  },
  "Review & Refine": {
    title: "Review and Refine Test Cases",
    subtitle: "Improve the quality and consistency of an existing test-case workbook."
  },
  "Review Coverage": {
    title: "Review Test Coverage",
    subtitle: "Compare requirements with existing tests and identify missing coverage."
  }
};

export function App() {
  const [active, setActive] = useState("Generate");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [testCaseWorkflow, setTestCaseWorkflow] = useState<TestCaseWorkflow>("Generate New");
  const [health, setHealth] = useState<{ aiConfigured: boolean; visionConfigured?: boolean; visionEnabled?: boolean; ocrFallbackEnabled?: boolean; model?: string } | null>(null);
  const [message, setMessage] = useState("");
  const [requirement, setRequirement] = useState<RequirementInput>(emptyRequirement);
  const [requirementFiles, setRequirementFiles] = useState<ReqFile[]>([]);
  const [screenshots, setScreenshots] = useState<Generation["screenshots"]>([]);
  const [config, setConfig] = useState<GenerationConfig>(defaultConfig);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string[]>([]);
  const [azureConfig, setAzureConfig] = useState<AzureConfig>({ areaPath: "", assignedTo: "", state: "Design" });
  const [screenshotFiles, setScreenshotFiles] = useState<Record<string, File>>({});
  const [detectedElements, setDetectedElements] = useState<Generation["detectedElements"]>([]);
  const [visionSummary, setVisionSummary] = useState<VisionSummary | null>(null);
  const [screenshotReports, setScreenshotReports] = useState<ScreenshotAnalysisReport[]>([]);
  const [ignoreScreenshotData, setIgnoreScreenshotData] = useState(false);
  const [coverageReview, setCoverageReview] = useState<CoverageReviewResult | null>(null);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const generatingRef = useRef(false);

  useEffect(() => {
    void refresh();
    api.health().then(setHealth).catch(() => setHealth({ aiConfigured: false, visionConfigured: false }));
  }, []);

  async function refresh() {
    const data = await api.generations().catch(() => ({ generations: [] }));
    setGenerations(data.generations);
  }

  function resetWorkspace() {
    generatingRef.current = false;
    setRequirement(emptyRequirement);
    setRequirementFiles([]);
    setScreenshots([]);
    setConfig(defaultConfig);
    setGeneration(null);
    setCoverage(null);
    setBusy("");
    setError("");
    setProgress([]);
    setDetectedElements([]);
    setVisionSummary(null);
    setScreenshotReports([]);
    setIgnoreScreenshotData(false);
    setCoverageReview(null);
    setActive("Generate");
    setMessage("Page reset.");
    setWorkspaceVersion((version) => version + 1);
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function uploadRequirementFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    const allowed = [".txt", ".docx", ".pdf"];
    const invalid = selected.find((file) => !allowed.some((ext) => file.name.toLowerCase().endsWith(ext)));
    if (invalid) {
      setError("Upload requirement files as .txt, .docx, or .pdf.");
      return;
    }
    setRequirementFiles(selected.map((file) => ({ name: file.name, size: file.size, type: file.type || "document" })));
    const textFile = selected.find((file) => file.name.toLowerCase().endsWith(".txt"));
    if (textFile && !requirement.acceptanceCriteria.trim()) {
      setRequirement({ ...requirement, acceptanceCriteria: await textFile.text() });
    }
  }

  async function uploadScreenshots(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    setBusy("Uploading");
    setError("");
    try {
      const invalid = selected.find((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024);
      if (invalid) throw new Error("Upload PNG, JPG/JPEG, or WebP screenshots under 8 MB.");
      const data = await api.uploadScreenshots(selected);
      const withPreviews = data.screenshots.map((shot, index) => ({ ...shot, dataUrl: URL.createObjectURL(selected[index]) }));
      setScreenshots((prev) => [...prev, ...withPreviews]);
      setScreenshotFiles((prev) => ({ ...prev, ...Object.fromEntries(data.screenshots.map((shot, index) => [shot.id, selected[index]])) }));
      setDetectedElements([]);
      setVisionSummary(null);
      setScreenshotReports([]);
      setIgnoreScreenshotData(false);
      if (requirement.acceptanceCriteria.trim()) {
        await analyseUploadedScreenshots(withDefaults(requirement, requirementFiles), selected);
      } else {
        setMessage("Screenshot uploaded. Add acceptance criteria to auto-analyse and match visual evidence.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screenshot upload failed. Check file type and size.");
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    if (generatingRef.current || !requirement.acceptanceCriteria.trim()) return;
    generatingRef.current = true;
    const prepared = withDefaults(requirement, requirementFiles);
    setRequirement(prepared);
    setBusy("Generating");
    setError("");
    setProgress(["Analysing acceptance criteria"]);
    try {
      let analysis = await api.analyze(prepared, screenshots).catch((err) => {
        setError(err instanceof Error ? `Screenshot or input analysis warning: ${err.message}. Continuing with acceptance criteria.` : "Analysis warning. Continuing with acceptance criteria.");
        return { criteria: [], detectedElements: [], warnings: ["Analysis fallback used."], assumptions: ["Analysis could not complete; generation continued with available requirement text."], ambiguities: [] };
      });
      const files = screenshots.map((shot) => screenshotFiles[shot.id]).filter((file): file is File => Boolean(file));
      if (files.length && !ignoreScreenshotData) {
        setProgress((items) => [...items, detectedElements.length ? "Using confirmed screenshot elements" : "Analysing screenshots with Gemini Vision"]);
        if (!detectedElements.length) {
          const visual = await analyseUploadedScreenshots(prepared, files);
          analysis = visual;
        } else {
          analysis = { ...analysis, detectedElements, assumptions: [...analysis.assumptions, "User-confirmed screenshot elements were used for generation."] };
        }
      } else if (screenshots.length) {
        setProgress((items) => [...items, "Generating from requirement text only"]);
      }
      setProgress((items) => [...items, "Generating positive, negative and edge cases"]);
      const data = await api.saveGeneration({
        id: generation?.id,
        createdAt: generation?.createdAt,
        exportHistory: generation?.exportHistory,
        requirement: prepared,
        criteria: analysis.criteria,
        screenshots,
        detectedElements: ignoreScreenshotData ? [] : analysis.detectedElements,
        config,
        assumptions: [...analysis.assumptions, ...(health?.aiConfigured ? [] : ["AI unavailable or not configured; deterministic fallback generation used."])],
        warnings: analysis.warnings,
        ambiguities: analysis.ambiguities
      });
      setProgress((items) => [...items, "Removing duplicate scenarios", "Checking acceptance-criteria coverage"]);
      setGeneration(data.generation);
      setCoverage(data.coverage);
      setGenerations((prev) => [data.generation, ...prev.filter((item) => item.id !== data.generation.id)]);
      setMessage("Test cases generated.");
      setActive("Review Test Cases");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed. You can retry or add manual test cases after creating a draft.");
    } finally {
      generatingRef.current = false;
      setBusy("");
    }
  }

  async function analyseUploadedScreenshots(sourceRequirement = requirement, files = screenshots.map((shot) => screenshotFiles[shot.id]).filter((file): file is File => Boolean(file))) {
    if (!files.length) throw new Error("Upload screenshots before analysing them.");
    setBusy("Analysing screenshots");
    setError("");
    try {
      const prepared = sourceRequirement.acceptanceCriteria.trim() ? withDefaults(sourceRequirement, requirementFiles) : sourceRequirement;
      const analysis = await api.analyzeScreenshots(prepared, files);
      setDetectedElements(analysis.detectedElements);
      setVisionSummary(analysis.summary);
      setScreenshotReports(analysis.reports);
      setMessage(`${analysis.summary.generationMode}: ${analysis.detectedElements.length} detected elements ready for review.`);
      return analysis;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screenshot analysis failed.");
      throw err;
    } finally {
      setBusy("");
    }
  }

  async function refineExistingExcel(file: File) {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setBusy("Refining");
    setError("");
    setProgress(["Reading uploaded Excel workbook", "Refining existing test cases", "Preparing Azure-ready download"]);
    try {
      const filename = await api.refineExistingExcel(file);
      setMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed. Upload an existing test-case Excel file and try again.");
    } finally {
      generatingRef.current = false;
      setBusy("");
    }
  }

  async function reviewExistingCoverage(file: File) {
    if (generatingRef.current || !requirement.acceptanceCriteria.trim()) return;
    generatingRef.current = true;
    setBusy("Reviewing coverage");
    setError("");
    setCoverageReview(null);
    setProgress(["Reading uploaded test-case workbook", "Comparing existing tests with acceptance criteria", "Preparing missing coverage suggestions"]);
    try {
      const prepared = withDefaults(requirement, requirementFiles);
      setRequirement(prepared);
      const data = await api.reviewExistingCoverage(prepared, file);
      setCoverageReview(data.review);
      setMessage(`Coverage review complete: ${data.review.summary.coveragePercent}% covered.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coverage review failed. Upload acceptance criteria and an existing test-case Excel file.");
    } finally {
      generatingRef.current = false;
      setBusy("");
    }
  }

  async function exportCoverageReviewExcel(file: File, mode: "suggested-only" | "merge-with-existing") {
    if (!coverageReview || !requirement.acceptanceCriteria.trim()) {
      setError("Review coverage first, then download the missing coverage Excel.");
      return;
    }
    setBusy(mode === "merge-with-existing" ? "Preparing merged coverage Excel" : "Preparing missing coverage Excel");
    setError("");
    setProgress([
      mode === "merge-with-existing" ? "Combining existing test cases with missing suggestions" : "Preparing suggested missing test cases",
      "Applying Azure DevOps Excel column format",
      "Starting workbook download"
    ]);
    try {
      const filename = await api.exportCoverageReviewExcel(withDefaults(requirement, requirementFiles), file, mode);
      setMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coverage review Excel export failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveGeneration(next: Generation, toast = "Draft saved.") {
    const data = await api.updateGeneration(next);
    setGeneration(data.generation);
    setCoverage(data.coverage);
    setGenerations((prev) => [data.generation, ...prev.filter((item) => item.id !== data.generation.id)]);
    setMessage(toast);
  }

  async function exportExcel() {
    if (!generation) return;
    const validationErrors = validateAzureTestCases(generation.testCases);
    if (validationErrors.length) {
      setError(`Fix these Azure export issues before downloading: ${validationErrors.slice(0, 4).join(" ")}`);
      return;
    }
    setBusy("Exporting");
    setError("");
    try {
      const saved = await api.updateGeneration(generation);
      setGeneration(saved.generation);
      setCoverage(saved.coverage);
      const filename = await api.exportExcel(saved.generation.id, {
        ...azureConfig,
        areaPath: azureConfig.areaPath || `${saved.generation.requirement.projectName}\\${saved.generation.requirement.moduleName}`
      });
      setMessage(`Downloaded ${filename}.`);
      setActive("Export History");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Excel export failed. Try saving and exporting again.");
    } finally {
      setBusy("");
    }
  }

  async function openHtml() {
    if (!generation) return;
    setBusy("Opening HTML");
    setError("");
    try {
      await api.openHtml(generation.id);
      setMessage("HTML report opened in a new browser tab.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "HTML report could not be opened. Try again after saving the generation.");
    } finally {
      setBusy("");
    }
  }

  return (
    <Shell active={active} setActive={setActive} health={health} titleOverride={active === "Generate" ? workflowCopy[testCaseWorkflow].title : undefined} subtitleOverride={active === "Generate" ? workflowCopy[testCaseWorkflow].subtitle : undefined}>
      {message && <div className="toast" role="status">{message}</div>}
      {error && <div className="toast error-toast" role="alert">{error}</div>}
      {busy && <BusyOverlay label={busy} items={progress} />}
      <section className={`page ${["Review Test Cases", "Coverage", "Export History"].includes(active) ? "page-wide" : ""}`}>
        {error && <Notice type="error" text={error} />}
        {active === "Dashboard" && (
          <DashboardTab generations={generations} generation={generation} coverage={coverage} health={health} setActive={setActive} />
        )}
        {active === "Generate" && (
          <GenerateTab
            key={workspaceVersion}
            workMode={testCaseWorkflow}
            setWorkMode={setTestCaseWorkflow}
            requirement={requirement}
            setRequirement={setRequirement}
            requirementFiles={requirementFiles}
            setRequirementFiles={setRequirementFiles}
            uploadRequirementFiles={uploadRequirementFiles}
            screenshots={screenshots}
            setScreenshots={setScreenshots}
            uploadScreenshots={uploadScreenshots}
            analyseUploadedScreenshots={() => void analyseUploadedScreenshots()}
            detectedElements={detectedElements}
            setDetectedElements={setDetectedElements}
            visionSummary={visionSummary}
            reports={screenshotReports}
            ignoreScreenshotData={ignoreScreenshotData}
            setIgnoreScreenshotData={setIgnoreScreenshotData}
            config={config}
            setConfig={setConfig}
            generate={generate}
            refineExistingExcel={refineExistingExcel}
            reviewExistingCoverage={reviewExistingCoverage}
            exportCoverageReviewExcel={exportCoverageReviewExcel}
            coverageReview={coverageReview}
            resetWorkspace={resetWorkspace}
            busy={busy}
            progress={progress}
          />
        )}
        {active === "Review Test Cases" && (
          <ReviewTab generation={generation} coverage={coverage} setGeneration={setGeneration} save={saveGeneration} exportExcel={exportExcel} openHtml={openHtml} azureConfig={azureConfig} setAzureConfig={setAzureConfig} />
        )}
        {active === "Coverage" && (
          <CoverageTab generation={generation} coverage={coverage ?? (generation ? calculateCoverage(generation) : null)} exportExcel={exportExcel} openHtml={openHtml} azureConfig={azureConfig} setAzureConfig={setAzureConfig} />
        )}
        {active === "Export History" && <ExportHistory generations={generations} />}
        {active === "Settings" && <Settings />}
      </section>
    </Shell>
  );
}

function DashboardTab({ generations, generation, coverage, health, setActive }: {
  generations: Generation[];
  generation: Generation | null;
  coverage: CoverageSummary | null;
  health: { aiConfigured: boolean; visionConfigured?: boolean; visionEnabled?: boolean; ocrFallbackEnabled?: boolean; model?: string } | null;
  setActive: (tab: string) => void;
}) {
  const exports = generations.reduce((count, item) => count + item.exportHistory.length, 0);
  return (
    <article className="dashboard-grid">
      <section className="dashboard-panel">
        <div className="card-heading">
          <div>
            <h2>Workspace Overview</h2>
            <p>Current generation health and output readiness.</p>
          </div>
          <button className="primary" onClick={() => setActive("Generate")}><Plus size={17} />Generate Tests</button>
        </div>
        <div className="metrics">
          <Metric label="Saved generations" value={generations.length} />
          <Metric label="Current test cases" value={generation?.testCases.length ?? 0} />
          <Metric label="Coverage" value={coverage ? `${coverage.coveragePercent}%` : "--"} />
          <Metric label="Excel exports" value={exports} />
        </div>
      </section>
      <section className="dashboard-panel">
        <div className="card-heading">
          <div>
            <h2>AI Readiness</h2>
            <p>Vision analysis supports the existing acceptance-criteria rules.</p>
          </div>
        </div>
        <div className="status-list">
          <span><i className={health?.visionConfigured ? "status-dot ready" : "status-dot warn"} />Gemini Vision <strong>{health?.visionConfigured ? "Connected" : "Unavailable"}</strong></span>
          <span><i className={health?.ocrFallbackEnabled !== false ? "status-dot ready" : "status-dot warn"} />OCR Fallback <strong>{health?.ocrFallbackEnabled !== false ? "Enabled" : "Disabled"}</strong></span>
          <span><i className="status-dot ready" />Azure Format Rules <strong>Preserved</strong></span>
        </div>
      </section>
    </article>
  );
}

function GenerateTab(props: {
  workMode: TestCaseWorkflow;
  setWorkMode: (mode: TestCaseWorkflow) => void;
  requirement: RequirementInput;
  setRequirement: (r: RequirementInput) => void;
  requirementFiles: ReqFile[];
  setRequirementFiles: (files: ReqFile[]) => void;
  uploadRequirementFiles: (files: FileList | null) => void;
  screenshots: Generation["screenshots"];
  setScreenshots: (s: Generation["screenshots"]) => void;
  uploadScreenshots: (files: FileList | null) => void;
  analyseUploadedScreenshots: () => void;
  detectedElements: Generation["detectedElements"];
  setDetectedElements: (items: Generation["detectedElements"]) => void;
  visionSummary: VisionSummary | null;
  reports: ScreenshotAnalysisReport[];
  ignoreScreenshotData: boolean;
  setIgnoreScreenshotData: (value: boolean) => void;
  config: GenerationConfig;
  setConfig: (c: GenerationConfig) => void;
  generate: () => void;
  refineExistingExcel: (file: File) => void;
  reviewExistingCoverage: (file: File) => void;
  exportCoverageReviewExcel: (file: File, mode: "suggested-only" | "merge-with-existing") => void;
  coverageReview: CoverageReviewResult | null;
  resetWorkspace: () => void;
  busy: string;
  progress: string[];
}) {
  const { workMode, setWorkMode, requirement, setRequirement, requirementFiles, setRequirementFiles, uploadRequirementFiles, screenshots, setScreenshots, uploadScreenshots, analyseUploadedScreenshots, detectedElements, setDetectedElements, visionSummary, reports, ignoreScreenshotData, setIgnoreScreenshotData, config, setConfig, generate, refineExistingExcel, reviewExistingCoverage, exportCoverageReviewExcel, coverageReview, resetWorkspace, busy, progress } = props;
  const [sourceMode, setSourceMode] = useState<"Manual Entry" | "Upload Requirement">("Manual Entry");
  const [refineCaseFile, setRefineCaseFile] = useState<File | null>(null);
  const [coverageCaseFile, setCoverageCaseFile] = useState<File | null>(null);
  const [coverageExportMode, setCoverageExportMode] = useState<"suggested-only" | "merge-with-existing">("suggested-only");
  const update = (key: keyof RequirementInput, value: string) => setRequirement({ ...requirement, [key]: value });
  const canGenerate = Boolean(requirement.acceptanceCriteria.trim());
  const setCount = (value: string) => setConfig({ ...config, maxCases: value === "Auto" ? 250 : Number(value) });

  const readyText = canGenerate ? "Ready" : "Missing";
  const screenshotText = screenshots.length ? `${screenshots.length} added` : "Not added";
  const uniqueBehaviors = visionSummary?.uniqueCoverageBehaviours ?? (detectedElements.length || "--");
  const estimatedCases = visionSummary?.plannedTestCases ?? (config.maxCases === 250 ? "--" : config.maxCases);
  const disabledReason = !canGenerate ? "Add acceptance criteria to enable generation." : !config.detailLevel ? "Select a coverage level to continue." : "";
  const saveDraft = () => window.localStorage.setItem("testcraft-generate-draft", JSON.stringify({ requirement, requirementFiles, screenshots, config }));
  const coverageLevels = [
    { label: "Standard", value: "Standard", detail: "Positive, negative, validation, edge, state & permission" },
    { label: "Basic", value: "Concise", detail: "Explicit acceptance criteria only" },
    { label: "Comprehensive", value: "Detailed", detail: "All standard + security, integration, accessibility and more" }
  ] as const;
  const standardIncluded = ["Positive", "Negative", "Validation", "Edge Cases", "State Transition", "Permission", "Integration", "UI", "Responsive"];
  const resetActiveWorkflow = () => {
    if (workMode === "Generate New") {
      resetWorkspace();
      return;
    }
    if (workMode === "Review & Refine") {
      setRefineCaseFile(null);
      return;
    }
    setCoverageCaseFile(null);
    setRequirement({ ...requirement, acceptanceCriteria: "" });
  };

  return (
    <article className={workMode === "Generate New" ? "generate-workspace" : "primary-card"}>
      <div className="workflow-switcher-row">
        <div className="segmented workflow-switcher" role="radiogroup" aria-label="Test case workflow">
          {(["Generate New", "Review & Refine", "Review Coverage"] as const).map((mode) => (
            <button key={mode} className={workMode === mode ? "active" : ""} onClick={() => setWorkMode(mode)} role="radio" aria-checked={workMode === mode}>
              {mode}
            </button>
          ))}
        </div>
        <button className="text-button" onClick={resetActiveWorkflow}><RefreshCw size={16} />Reset {workMode}</button>
      </div>

      {workMode === "Generate New" && (
        <div className="generate-layout">
          <div className="generate-main">
            <section className="generate-stepper" aria-label="Generation steps">
              {[
                ["1", "Requirements", "Add your requirement details"],
                ["2", "Screenshots", "Add interface screenshots"],
                ["3", "Coverage", "Choose coverage options"]
              ].map(([number, title, detail]) => (
                <div className="step-item" key={number}>
                  <span>{number}</span>
                  <div><strong>{title}</strong><small>{detail}</small></div>
                </div>
              ))}
            </section>

            <section className="workspace-card">
              <div className="source-row">
                <div className="numbered-title">
                  <span><FileText size={20} /></span>
                  <div><h2>1. Add Requirements</h2><p className="muted">Paste acceptance criteria, user story, or functional requirements.</p></div>
                </div>
                <div className="segmented">
                  {(["Manual Entry", "Upload Requirement"] as const).map((item) => <button key={item} className={sourceMode === item ? "active" : ""} onClick={() => setSourceMode(item)}>{item === "Manual Entry" ? "Paste Text" : "Upload Document"}</button>)}
                </div>
              </div>
              {sourceMode === "Upload Requirement" && (
                <label className="file-strip">
                  <UploadCloud size={18} />
                  <span>Upload requirement</span>
                  <small>TXT, DOCX, PDF</small>
                  <input type="file" accept=".txt,.docx,.pdf" multiple onChange={(e) => void uploadRequirementFiles(e.target.files)} />
                </label>
              )}
              {requirementFiles.length > 0 && <FileList files={requirementFiles} remove={(name) => setRequirementFiles(requirementFiles.filter((file) => file.name !== name))} />}
              <Field label="Acceptance Criteria"><textarea className="hero-textarea" value={requirement.acceptanceCriteria} onChange={(e) => update("acceptanceCriteria", e.target.value)} placeholder="Paste acceptance criteria, user story, Given/When/Then scenarios, business rules, or functional requirements..." /></Field>
              <details className="requirement-details">
                <summary>+ Additional context</summary>
                <div className="grid three">
                  <Field label="Project Name"><input value={requirement.projectName} onChange={(e) => update("projectName", e.target.value)} placeholder="Optional" /></Field>
                  <Field label="Module/Feature Name"><input value={requirement.featureName} onChange={(e) => update("featureName", e.target.value)} placeholder="Optional" /></Field>
                  <Field label="Requirement ID"><input value={requirement.requirementId} onChange={(e) => update("requirementId", e.target.value)} placeholder="Optional" /></Field>
                </div>
                <div className="grid three">
                  <Field label="User Role"><input value={requirement.userRole} onChange={(e) => update("userRole", e.target.value)} /></Field>
                  <Field label="Platform"><select value={requirement.platform} onChange={(e) => update("platform", e.target.value)}>{["Web", "Mobile", "Desktop", "API", "Other"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Browser/Device"><input value={config.browserDeviceCoverage} onChange={(e) => setConfig({ ...config, browserDeviceCoverage: e.target.value })} placeholder="Chrome, Edge, iPhone" /></Field>
                </div>
                <div className="grid two">
                  <Field label="Preconditions"><textarea value={requirement.preconditions} onChange={(e) => update("preconditions", e.target.value)} /></Field>
                  <Field label="Business Rules"><textarea value={requirement.businessRules} onChange={(e) => update("businessRules", e.target.value)} /></Field>
                </div>
                <div className="grid two">
                  <Field label="Dependencies"><textarea value={requirement.requirementDescription} onChange={(e) => update("requirementDescription", e.target.value)} placeholder="APIs, services, gateways, queues" /></Field>
                  <Field label="Additional Notes"><textarea value={requirement.additionalNotes} onChange={(e) => update("additionalNotes", e.target.value)} /></Field>
                </div>
              </details>
            </section>

            <section className="workspace-card compact-upload-section">
              <div className="source-row">
                <div className="numbered-title">
                  <span><Image size={20} /></span>
                  <div><h2>2. Add Screenshots</h2><p className="muted">Upload application screens, requirement docs, or mockups.</p></div>
                </div>
                <div className="screenshot-title-actions">
                  <span className="badge">Optional</span>
                  <label className="upload-inline-button">
                    <UploadCloud size={17} />Upload Screenshots
                    <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadScreenshots(e.target.files)} />
                  </label>
                </div>
              </div>
              <label className="dropzone">
                <UploadCloud size={28} />
                <strong>Drag and drop screenshots here or click to browse</strong>
                <span>PNG, JPG, WebP - Max 8 MB each</span>
                <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadScreenshots(e.target.files)} />
              </label>
              <div className="screenshot-grid">
                {screenshots.map((shot) => (
                  <article className="screenshot-card" key={shot.id}>
                    {shot.dataUrl ? <img src={shot.dataUrl} alt={`Preview of ${shot.filename}`} /> : <div className="image-fallback">Preview unavailable</div>}
                    <div>
                      <strong>{shot.filename}</strong>
                      <span>{reports.find((report) => report.screenshotId === shot.id)?.status ?? "Uploaded"} · {reports.find((report) => report.screenshotId === shot.id)?.mode ?? "Pending analysis"} · {reports.find((report) => report.screenshotId === shot.id)?.confidence ?? "--"}%</span>
                    </div>
                    <div className="row-actions">
                      <button onClick={analyseUploadedScreenshots} disabled={Boolean(busy)}><Search size={16} />Review Findings</button>
                      <label className="tiny-file">Replace<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadScreenshots(e.target.files)} /></label>
                      <button onClick={() => setScreenshots(screenshots.filter((item) => item.id !== shot.id))}><Trash2 size={16} />Remove</button>
                    </div>
                  </article>
                ))}
              </div>
              {screenshots.length > 0 && (
                <DetectedElementsReview
                  elements={detectedElements}
                  setElements={setDetectedElements}
                  summary={visionSummary}
                  reports={reports}
                  onAnalyse={analyseUploadedScreenshots}
                  busy={busy}
                  ignore={ignoreScreenshotData}
                  setIgnore={setIgnoreScreenshotData}
                />
              )}
            </section>

            <section className="workspace-card">
              <div className="numbered-title">
                <span><ShieldCheck size={21} /></span>
                <div><h2>3. Configure Coverage</h2><p className="muted">Choose coverage level and additional options for test generation.</p></div>
              </div>
              <div className="coverage-config-grid">
                <div>
                  <h3>Coverage Level</h3>
                  <div className="coverage-level-grid">
                    {coverageLevels.map((level) => (
                      <button
                        key={level.label}
                        className={config.detailLevel === level.value ? "coverage-level active" : "coverage-level"}
                        onClick={() => setConfig({ ...config, detailLevel: level.value as GenerationConfig["detailLevel"] })}
                      >
                        <strong>{level.label}</strong>
                        <span>{level.detail}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>Included in Standard</h3>
                  <div className="included-standard-grid">
                    {standardIncluded.map((item) => <span key={item}><Check size={14} />{item}</span>)}
                  </div>
                </div>
              </div>
              <details className="advanced-options">
                <summary>Show advanced options</summary>
                <div className="generation-row">
                  <div className="control-panel test-types-panel">
                    <h2>Included coverage</h2>
                    <div className="option-grid compact">
                      {testTypes.map((type) => (
                        <label className="check" key={type}>
                          <input type="checkbox" checked={config.selectedTypes.includes(type)} onChange={() => toggleType(type, config, setConfig)} />
                          {type}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="control-panel">
                    <Field label="Count"><select value={config.maxCases === 250 ? "Auto" : String(config.maxCases)} onChange={(e) => setCount(e.target.value)}>{["Auto", "10", "20", "30", "50"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  </div>
                  <div className="control-panel">
                    <div className="compact-toggles">
                      <label><input type="checkbox" checked={config.includeTestData} onChange={(e) => setConfig({ ...config, includeTestData: e.target.checked })} />Test data</label>
                      <label><input type="checkbox" checked={Boolean(requirement.preconditions || config.includePostconditions)} onChange={(e) => setConfig({ ...config, includePostconditions: e.target.checked })} />Preconditions</label>
                      <label><input type="checkbox" checked={config.includeAutomationCandidates} onChange={(e) => setConfig({ ...config, includeAutomationCandidates: e.target.checked })} />Automation</label>
                      <label><input type="checkbox" defaultChecked />Group by AC</label>
                    </div>
                  </div>
                </div>
              </details>
            </section>
            {busy && <ProgressList items={progress} />}
          </div>

          <aside className="generation-summary">
            <h2>Generation Summary</h2>
            <div className="summary-list">
              <span><Check size={17} />Requirements <strong className={canGenerate ? "ready-text" : ""}>{readyText}</strong></span>
              <span><FileSpreadsheet size={17} />Screenshots <strong>{screenshotText}</strong></span>
              <span><ClipboardCheck size={17} />Coverage Level <strong>{config.detailLevel}</strong></span>
              <span><BarChart3 size={17} />Unique Behaviors <strong>{uniqueBehaviors}</strong></span>
              <span><FilePenLine size={17} />Estimated Test Cases <strong>{estimatedCases}</strong></span>
            </div>
            <div className="summary-mode">
              <small>Generation Mode</small>
              <strong>{visionSummary?.generationMode ?? "Gemini Vision-assisted"}</strong>
            </div>
            <section className="summary-help-card">
              <strong>How it works</strong>
              <p>We analyze your requirements and screenshots to identify unique behaviors and generate detailed test cases.</p>
            </section>
            {disabledReason && <p className="disabled-reason">{disabledReason}</p>}
            <button className="primary big generate-button" onClick={generate} disabled={!canGenerate || Boolean(busy)}>
              <RefreshCw size={18} />{busy ? "Generating Test Cases..." : "Generate Test Cases"}
            </button>
            <button onClick={saveDraft}>Save Draft</button>
            <button onClick={resetWorkspace}>Reset Page</button>
          </aside>
        </div>
      )}

      {workMode === "Review Coverage" && <section className="form-section">
        <div className="source-row">
          <h2>Acceptance Criteria</h2>
        </div>
        <Field label="Acceptance Criteria"><textarea className="hero-textarea" value={requirement.acceptanceCriteria} onChange={(e) => update("acceptanceCriteria", e.target.value)} placeholder="Paste acceptance criteria to compare against the uploaded existing test cases..." /></Field>
      </section>}

      {workMode === "Review & Refine" && (
        <section className="review-shell">
          <div className="review-intro">
            <h2>1. Upload Existing Test Cases</h2>
            <p className="muted">Upload an Excel workbook and TestCraft will analyse quality, preserve valid data, and prepare refined Azure-ready output.</p>
          </div>
          <div className="generate-stepper compact-workflow-stepper">
            {["Upload Existing Test Cases", "Analyse Quality", "Review Suggested Improvements", "Export Refined Workbook"].map((step, index) => (
              <div className="step-item" key={step}><span>{index + 1}</span><div><strong>{step}</strong></div></div>
            ))}
          </div>
          <label className="file-strip enterprise-upload">
            <UploadCloud size={18} />
            <span>{refineCaseFile ? refineCaseFile.name : "Upload existing test case Excel"}</span>
            <small>XLSX, XLS</small>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setRefineCaseFile(e.target.files?.[0] ?? null)} />
          </label>
          <section className="workflow-summary-panel">
            <h2>Analysis Summary</h2>
            <div className="summary-chips">
              {["Test cases detected", "Duplicate titles", "Generic titles", "Missing expected results", "Misaligned columns", "Non-sequential steps", "Generic placeholders", "Missing AC mappings", "Suggested improvements"].map((item) => <Chip key={item} label={item} value="--" />)}
            </div>
          </section>
        </section>
      )}

      {workMode === "Review Coverage" && (
        <section className="review-shell">
          <div className="review-intro">
            <h2>Review Existing Coverage</h2>
            <p className="muted">Upload existing test cases and compare them against the acceptance criteria. Missing coverage is suggested in the same clean Azure-ready format.</p>
          </div>
          <div className="generate-stepper compact-workflow-stepper">
            {["Add Acceptance Criteria", "Upload Existing Tests", "Analyse Coverage", "Review Gaps", "Generate Missing Tests"].map((step, index) => (
              <div className="step-item" key={step}><span>{index + 1}</span><div><strong>{step}</strong></div></div>
            ))}
          </div>
          <label className="file-strip enterprise-upload">
            <UploadCloud size={18} />
            <span>{coverageCaseFile ? coverageCaseFile.name : "Upload existing test case Excel"}</span>
            <small>XLSX, XLS</small>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setCoverageCaseFile(e.target.files?.[0] ?? null)} />
          </label>
          {coverageReview && (
            <CoverageReviewPanel
              review={coverageReview}
              exportMode={coverageExportMode}
              setExportMode={setCoverageExportMode}
              onExport={(mode) => coverageCaseFile && exportCoverageReviewExcel(coverageCaseFile, mode)}
              busy={busy}
            />
          )}
        </section>
      )}

      {busy && workMode !== "Generate New" && <ProgressList items={progress} />}
      <div className="actions">
        {workMode === "Review & Refine" && <button className="primary big" onClick={() => refineCaseFile && refineExistingExcel(refineCaseFile)} disabled={Boolean(busy) || !refineCaseFile}>
          <Check size={18} />{busy === "Refining" ? "Refining Existing Cases..." : "Refine Existing Test Cases"}
        </button>}
        {workMode === "Review Coverage" && <button className="primary big" onClick={() => coverageCaseFile && reviewExistingCoverage(coverageCaseFile)} disabled={Boolean(busy) || !coverageCaseFile || !canGenerate}>
          <Search size={18} />{busy === "Reviewing coverage" ? "Reviewing Coverage..." : "Review Coverage"}
        </button>}
      </div>
    </article>
  );
}

function CoverageReviewPanel({ review, exportMode, setExportMode, onExport, busy }: {
  review: CoverageReviewResult;
  exportMode: "suggested-only" | "merge-with-existing";
  setExportMode: (mode: "suggested-only" | "merge-with-existing") => void;
  onExport: (mode: "suggested-only" | "merge-with-existing") => void;
  busy: string;
}) {
  const reviewComments = review.items.flatMap((item) => item.reviewComments.map((comment) => ({ ...comment, acId: item.acId, status: item.status, score: item.score })));
  const actionableComments = reviewComments.filter((comment) => comment.status !== "Covered");
  return (
    <div className="coverage-review">
      <div className="metrics compact-metrics">
        <Metric label="Coverage" value={`${review.summary.coveragePercent}%`} />
        <Metric label="Acceptance Criteria" value={review.summary.totalAcceptanceCriteria} />
        <Metric label="Existing Cases" value={review.summary.existingTestCases} />
        <Metric label="Missing" value={review.summary.missing} />
        <Metric label="Partial" value={review.summary.partial} />
        <Metric label="Suggested Cases" value={review.summary.suggestedMissingCases} />
      </div>
      {review.warnings.map((warning) => <Notice key={warning} type="info" text={warning} />)}
      <div className="review-list">
        <div className="section-title">
          <div>
            <h2>Coverage Review Comments</h2>
            <p className="muted">Review these gaps before generating or exporting new test cases.</p>
          </div>
        </div>
        <div className="review-comment-list">
          {(actionableComments.length ? actionableComments : reviewComments).map((comment) => (
            <article className={`review-comment ${comment.severity.toLowerCase()}`} key={`${comment.acId}-${comment.title}`}>
              <div className="coverage-line">
                <strong>{comment.acId}</strong>
                <span>{comment.severity}</span>
                <small>{comment.score}% match</small>
              </div>
              <h3>{comment.title}</h3>
              <p>{comment.comment}</p>
              <p className="muted"><strong>Suggested action:</strong> {comment.suggestedAction}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="review-grid">
        <div className="review-list">
          <h2>Acceptance Criteria Coverage</h2>
          {review.items.map((item) => (
            <article className={`coverage-item ${item.status.toLowerCase()}`} key={item.acId}>
              <div className="coverage-line">
                <strong>{item.acId}</strong>
                <span>{item.status}</span>
                <small>{item.score}% match</small>
              </div>
              <p>{item.acceptanceCriterion}</p>
              <small>{item.evidence}</small>
              <TraceList title="Matched test cases" items={item.matchedTestCases.length ? item.matchedTestCases : ["None"]} />
              <p className="muted">{item.recommendation}</p>
            </article>
          ))}
        </div>
        <div className="review-list">
          <h2>Quality Signals</h2>
          <TraceList title="Duplicate titles" items={review.duplicateTitles.length ? review.duplicateTitles : ["No duplicate titles found"]} />
          <TraceList title="Weak existing cases" items={review.weakCases.length ? review.weakCases.map((item) => `${item.title}: ${item.issue}`) : ["No weak cases found"]} />
        </div>
      </div>
      <div className="review-list">
        <h2>Suggested Missing Test Cases</h2>
        {review.suggestedTestCases.length > 0 && (
          <section className="export-choice-panel">
            <div>
              <h3>Download reviewed coverage output</h3>
              <p className="muted">Stay on this page and download the Excel file that matches your review decision.</p>
            </div>
            <div className="segmented">
              <button className={exportMode === "suggested-only" ? "active" : ""} onClick={() => setExportMode("suggested-only")} disabled={Boolean(busy)}>Missing test cases only</button>
              <button className={exportMode === "merge-with-existing" ? "active" : ""} onClick={() => setExportMode("merge-with-existing")} disabled={Boolean(busy)}>Existing plus missing</button>
            </div>
            <div className="actions">
              <button onClick={() => onExport("suggested-only")} disabled={Boolean(busy)}><FileSpreadsheet size={16} />Download Missing Cases Excel</button>
              <button className="primary" onClick={() => onExport("merge-with-existing")} disabled={Boolean(busy)}><FileSpreadsheet size={16} />Download Existing + Missing Excel</button>
            </div>
          </section>
        )}
        {review.suggestedTestCases.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Work Item Type</th><th>Title</th><th>Test Step</th><th>Step Action</th><th>Step Expected</th></tr></thead>
              <tbody>{review.suggestedTestCases.flatMap((tc) => azureCaseRows(tc).map((row, index) => (
                <tr key={`${tc.id}-${index}`} className={index === 0 ? "metadata-row" : "step-row"}>
                  <td>{row.id}</td>
                  <td>{row.workItemType}</td>
                  <td>{row.title}</td>
                  <td>{row.testStep}</td>
                  <td>{row.stepAction}</td>
                  <td>{row.stepExpected}</td>
                </tr>
              )))}</tbody>
            </table>
          </div>
        ) : <Empty text="No missing test cases are suggested because the uploaded workbook covers the acceptance criteria." />}
      </div>
    </div>
  );
}

function ReviewTab({ generation, coverage, setGeneration, save, exportExcel, openHtml, azureConfig, setAzureConfig }: { generation: Generation | null; coverage: CoverageSummary | null; setGeneration: (g: Generation) => void; save: (g: Generation) => Promise<void>; exportExcel: () => void; openHtml: () => void; azureConfig: AzureConfig; setAzureConfig: (config: AzureConfig) => void }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [acFilter, setAcFilter] = useState("");
  const [editing, setEditing] = useState<TestCase | null>(null);
  if (!generation) return <EmptyState title="No test cases yet" text="Generate test cases first. Screenshots are optional." />;

  const summary = coverage ?? calculateCoverage(generation);
  const filtered = generation.testCases.filter((tc) =>
    (!query || JSON.stringify(tc).toLowerCase().includes(query.toLowerCase())) &&
    (!typeFilter || tc.type === typeFilter) &&
    (!priorityFilter || tc.priority === priorityFilter) &&
    (!acFilter || tc.acceptanceCriteriaId === acFilter)
  );
  const replaceCase = (next: TestCase) => setGeneration({ ...generation, testCases: generation.testCases.map((tc) => tc.id === next.id ? next : tc) });

  return (
    <article className="primary-card">
      <div className="summary-chips">
        <Chip label="Total" value={generation.testCases.length} />
        <Chip label="Positive" value={summary.byType.Positive ?? 0} />
        <Chip label="Negative" value={summary.byType.Negative ?? 0} />
        <Chip label="Edge" value={summary.byType.Edge ?? 0} />
        <Chip label="Other" value={generation.testCases.filter((tc) => !["Positive", "Negative", "Edge"].includes(tc.type)).length} />
        <Chip label="Automation candidates" value={summary.automationCandidateCount} />
        <Chip label="Coverage" value={`${summary.coveragePercent}%`} />
      </div>
      <div className="toolbar">
        <label><Search size={16} /><input placeholder="Search cases" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label><Filter size={16} /><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">All types</option>{testTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}><option value="">All priorities</option>{priorities.map((p) => <option key={p}>{p}</option>)}</select>
        <select value={acFilter} onChange={(e) => setAcFilter(e.target.value)}><option value="">All ACs</option>{generation.criteria.map((ac) => <option key={ac.id}>{ac.id}</option>)}</select>
        <button onClick={() => setGeneration({ ...generation, testCases: [...generation.testCases, manualCase(generation)] })}><Plus size={17} />Add test case</button>
        <button onClick={() => void save(generation)}><Save size={17} />Save</button>
        <button onClick={openHtml}><ExternalLink size={17} />Open HTML</button>
      </div>
      <AzureExportPanel config={azureConfig} setConfig={setAzureConfig} defaultArea={`${generation.requirement.projectName}\\${generation.requirement.moduleName}`} onExport={exportExcel} />
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>ID</th><th>Work Item Type</th><th>Title</th><th>Test Step</th><th>Step Action</th><th>Step Expected</th><th>Area Path</th><th>Assigned To</th><th>State</th></tr></thead>
          <tbody>{filtered.flatMap((tc) => azureCaseRows(tc).map((row, rowIndex) => {
            const isMetadata = rowIndex === 0;
            return (
              <tr key={`${tc.id}-${rowIndex}`} className={isMetadata ? "metadata-row" : "step-row"}>
                <td>{isMetadata && <div className="row-actions"><input className="row-check" type="checkbox" aria-label={`Select ${tc.id}`} /><button aria-label={`Edit ${tc.id}`} onClick={() => setEditing(tc)}><Edit3 size={16} /></button><button aria-label={`Duplicate ${tc.id}`} onClick={() => setGeneration({ ...generation, testCases: [...generation.testCases, { ...tc, id: `${tc.id}-COPY`, title: `${tc.title} copy` }] })}><Copy size={16} /></button><button aria-label={`Regenerate ${tc.id}`} onClick={() => replaceCase({ ...tc, testerComments: "Regeneration requested; preserved existing user edits." })}><RefreshCw size={16} /></button><button aria-label={`Delete ${tc.id}`} onClick={() => setGeneration({ ...generation, testCases: generation.testCases.filter((item) => item.id !== tc.id) })}><Trash2 size={16} /></button></div>}</td>
                <td>{row.id}</td>
                <td>{row.workItemType}</td>
                <td>{row.title}</td>
                <td>{row.testStep}</td>
                <td>{row.stepAction}</td>
                <td>{row.stepExpected}</td>
                <td>{isMetadata ? (azureConfig.areaPath || `${generation.requirement.projectName}\\${generation.requirement.moduleName}`) : ""}</td>
                <td>{isMetadata ? azureConfig.assignedTo : ""}</td>
                <td>{isMetadata ? azureConfig.state : ""}</td>
              </tr>
            );
          }))}</tbody>
        </table>
      </div>
      {!filtered.length && <Empty text="No search results match the current filters." />}
      {editing && <CaseDrawer testCase={editing} onClose={() => setEditing(null)} onSave={(next) => { replaceCase(next); setEditing(null); }} />}
    </article>
  );
}

function CoverageTab({ generation, coverage, exportExcel, openHtml, azureConfig, setAzureConfig }: { generation: Generation | null; coverage: CoverageSummary | null; exportExcel: () => void; openHtml: () => void; azureConfig: AzureConfig; setAzureConfig: (config: AzureConfig) => void }) {
  if (!generation || !coverage) return <EmptyState title="No coverage yet" text="Generate test cases to calculate traceability-based coverage." />;
  return (
    <article className="primary-card">
      <div className="card-heading">
        <div><h1>Coverage</h1><p>Coverage is calculated from acceptance criteria, detected elements, and related test cases.</p></div>
        <div className="actions"><button onClick={openHtml}><ExternalLink size={17} />Open HTML</button></div>
      </div>
      <AzureExportPanel config={azureConfig} setConfig={setAzureConfig} defaultArea={`${generation.requirement.projectName}\\${generation.requirement.moduleName}`} onExport={exportExcel} />
      <div className="metrics compact-metrics">
        <Metric label="Acceptance criteria" value={coverage.totalCriteria} />
        <Metric label="Total test cases" value={coverage.totalTestCases} />
        <Metric label="Screenshot elements" value={generation.detectedElements.length} />
        <Metric label="Elements covered" value={coverage.coveredElements.length} />
        <Metric label="Assumptions" value={coverage.assumptionsCount} />
        <Metric label="Coverage" value={`${coverage.coveragePercent}%`} />
      </div>
      <div className="split">
        <TraceList title="Covered acceptance criteria" items={coverage.coveredCriteria} />
        <TraceList title="Uncovered acceptance criteria" items={coverage.uncoveredCriteria} />
      </div>
      <div className="split">
        <TraceList title="Test cases by type" items={Object.entries(coverage.byType).map(([type, count]) => `${type}: ${count}`)} />
        <TraceList title="Screenshot elements covered" items={coverage.coveredElements.length ? coverage.coveredElements : ["No screenshot-derived elements covered yet"]} />
      </div>
    </article>
  );
}

function DetectedElementsReview({ elements, setElements, summary, reports, onAnalyse, busy, ignore, setIgnore }: {
  elements: Generation["detectedElements"];
  setElements: (items: Generation["detectedElements"]) => void;
  summary: VisionSummary | null;
  reports: ScreenshotAnalysisReport[];
  onAnalyse: () => void;
  busy: string;
  ignore: boolean;
  setIgnore: (value: boolean) => void;
}) {
  const updateElement = (id: string, patch: Partial<Generation["detectedElements"][number]>) => setElements(elements.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addElement = () => setElements([...elements, {
    id: `UI-MAN-${String(elements.length + 1).padStart(3, "0")}`,
    screenshotId: "manual",
    screenshotName: "User correction",
    type: "field",
    label: "New control",
    visibleText: "",
    relatedAcceptanceCriterionId: undefined,
    confidence: 0.9,
    userCorrection: "Added by user",
    notes: "User-confirmed screenshot element.",
    assumption: ""
  }]);
  return (
    <section className="detected-panel">
      <div className="section-title">
        <div>
          <h2>Detected screenshot elements</h2>
          <p className="muted">Review and confirm visual evidence before generation. Acceptance criteria still remain the primary source.</p>
        </div>
        <div className="actions">
          <label className="check"><input type="checkbox" checked={ignore} onChange={(e) => setIgnore(e.target.checked)} />Generate from requirement only</label>
          <button onClick={onAnalyse} disabled={Boolean(busy)}><Search size={16} />Analyse screenshots</button>
          <button onClick={addElement}><Plus size={16} />Add control</button>
        </div>
      </div>
      {summary && (
        <div className="summary-chips">
          <Chip label="Mode" value={summary.generationMode} />
          <Chip label="Screenshots" value={summary.screenshotsUploaded} />
          <Chip label="Gemini" value={summary.geminiVisionAnalysed} />
          <Chip label="OCR" value={summary.ocrAnalysed} />
          <Chip label="Failed" value={summary.failedScreenshots} />
          <Chip label="Confidence" value={`${summary.averageConfidence}%`} />
          <Chip label="Findings used" value={summary.screenshotFindingsUsed} />
          <Chip label="Findings ignored" value={summary.screenshotFindingsIgnored} />
          <Chip label="Unique behaviours" value={summary.uniqueCoverageBehaviours} />
          <Chip label="Planned cases" value={summary.plannedTestCases} />
        </div>
      )}
      {summary?.warnings.map((warning) => <Notice key={warning} type={summary.generationMode === "Gemini Vision-assisted" ? "info" : "warn"} text={warning} />)}
      {reports.length > 0 && (
        <details className="screenshot-report">
          <summary>View extracted screenshot data</summary>
          <div className="detected-grid">
            {reports.map((report) => (
              <article className="mini-card detected-card" key={report.screenshotId}>
                <strong>{report.filename}</strong>
                <div className="summary-chips">
                  <span className="summary-chip"><strong>{report.status}</strong>Status</span>
                  <span className="summary-chip"><strong>{report.mode}</strong>Mode</span>
                  <span className="summary-chip"><strong>{report.screenshotType}</strong>Type</span>
                  <span className="summary-chip"><strong>{report.confidence}%</strong>Confidence</span>
                </div>
                <TraceList title="Raw extracted text" items={report.rawExtractedText.length ? report.rawExtractedText : ["None"]} />
                <TraceList title="Fields" items={report.detectedFields.length ? report.detectedFields : ["None"]} />
                <TraceList title="Buttons" items={report.detectedButtons.length ? report.detectedButtons : ["None"]} />
                <TraceList title="Roles, states, dependencies" items={[...report.detectedRoles, ...report.detectedStates, ...report.detectedDependencies].length ? [...report.detectedRoles, ...report.detectedStates, ...report.detectedDependencies] : ["None"]} />
                <TraceList title="Findings used in coverage" items={report.findings.length ? report.findings.map((finding) => `${finding.value} (${finding.confidence}%, ${finding.usedInCoverage ? "used" : "not used"})`) : ["None"]} />
                {report.warnings.map((warning) => <Notice key={warning} type="warn" text={warning} />)}
              </article>
            ))}
          </div>
        </details>
      )}
      {elements.length ? (
        <div className="detected-grid">
          {elements.map((element) => (
            <article className="mini-card detected-card" key={element.id}>
              <div className="grid two">
                <Field label="Label"><input value={element.label} onChange={(e) => updateElement(element.id, { label: e.target.value, userCorrection: "Edited by user" })} /></Field>
                <Field label="Control type"><input value={element.type} onChange={(e) => updateElement(element.id, { type: e.target.value, userCorrection: "Edited by user" })} /></Field>
              </div>
              <Field label="Visible details"><input value={element.visibleText} onChange={(e) => updateElement(element.id, { visibleText: e.target.value, userCorrection: "Edited by user" })} /></Field>
              <div className="summary-chips">
                <span className="summary-chip"><strong>{Math.round(element.confidence * 100)}%</strong>Confidence</span>
                <span className="summary-chip"><strong>{element.screenshotName}</strong>Source</span>
                <span className="summary-chip"><strong>{element.relatedAcceptanceCriterionId ?? "Unmatched"}</strong>AC match</span>
              </div>
              <div className="actions"><button onClick={() => setElements(elements.filter((item) => item.id !== element.id))}><Trash2 size={16} />Remove</button></div>
            </article>
          ))}
        </div>
      ) : <Empty text="No detected elements yet. Analyse screenshots or generate from requirement text only." />}
    </section>
  );
}

function AzureExportPanel({ config, setConfig, defaultArea, onExport }: { config: AzureConfig; setConfig: (config: AzureConfig) => void; defaultArea: string; onExport: () => void }) {
  return (
    <section className="export-panel">
      <div>
        <h2>Azure DevOps Export</h2>
        <p className="muted">Configure the metadata row values before downloading the import workbook.</p>
      </div>
      <div className="grid three">
        <Field label="Area Path"><input value={config.areaPath} onChange={(e) => setConfig({ ...config, areaPath: e.target.value })} placeholder={defaultArea} /></Field>
        <Field label="Assigned To"><input value={config.assignedTo} onChange={(e) => setConfig({ ...config, assignedTo: e.target.value })} placeholder="user@company.com" /></Field>
        <Field label="State"><select value={config.state} onChange={(e) => setConfig({ ...config, state: e.target.value })}><option>Design</option><option>Ready</option><option>Closed</option></select></Field>
      </div>
      <div className="actions"><button className="primary" onClick={onExport}><FileSpreadsheet size={17} />Download Azure DevOps Excel</button></div>
    </section>
  );
}

function ExportHistory({ generations }: { generations: Generation[] }) {
  const exports = generations.flatMap((gen) => gen.exportHistory.map((item) => ({ ...item, project: gen.requirement.projectName, feature: gen.requirement.featureName })));
  return (
    <article className="primary-card">
      <div className="card-heading"><div><h1>Export History</h1><p>Real workbook downloads from saved generations.</p></div></div>
      {exports.length ? <div className="cards">{exports.map((item) => <article className="mini-card" key={`${item.filename}-${item.exportedAt}`}><strong>{item.filename}</strong><span>{item.project} · {item.feature}</span><p>{new Date(item.exportedAt).toLocaleString()}</p></article>)}</div> : <Empty text="No Excel exports yet." />}
    </article>
  );
}

function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => { void api.settings().then((data) => { setSettings(data.settings); setAiConfigured(data.aiConfigured); }); }, []);
  return (
    <article className="primary-card">
      <div className="card-heading"><div><h1>Settings</h1><p>Provider configuration is server-side. API keys are read from environment variables and never displayed.</p></div></div>
      <Notice type={aiConfigured ? "info" : "warn"} text={aiConfigured ? "AI provider environment appears configured." : "No AI API key is configured. Manual fallback remains enabled."} />
      <div className="grid two">
        {Object.entries(settings).filter(([key]) => key !== "apiKey").map(([key, value]) => <Field key={key} label={key}><input value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} readOnly /></Field>)}
      </div>
    </article>
  );
}

function CaseDrawer({ testCase, onSave, onClose }: { testCase: TestCase; onSave: (tc: TestCase) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(testCase);
  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div>
        <h2>Edit Test Case</h2>
        <Field label="Title"><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
        <Field label="Objective"><textarea value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })} /></Field>
        <Field label="Steps"><textarea className="hero-textarea" value={draft.steps.join("\n")} onChange={(e) => setDraft({ ...draft, steps: e.target.value.split("\n").filter(Boolean) })} /></Field>
        <Field label="Expected result"><textarea value={draft.expectedResult} onChange={(e) => setDraft({ ...draft, expectedResult: e.target.value })} /></Field>
        <div className="grid two">
          <Field label="Priority"><select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TestCase["priority"] })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Execution status"><select value={draft.executionStatus} onChange={(e) => setDraft({ ...draft, executionStatus: e.target.value as TestCase["executionStatus"] })}>{["Not Run", "Passed", "Failed", "Blocked", "Deferred"].map((p) => <option key={p}>{p}</option>)}</select></Field>
        </div>
        <div className="actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave(draft)}><Check size={17} />Apply edit</button></div>
      </div>
    </div>
  );
}

function toggleType(type: GenerationConfig["selectedTypes"][number], config: GenerationConfig, setConfig: (c: GenerationConfig) => void) {
  const selectedTypes = config.selectedTypes.includes(type) ? config.selectedTypes.filter((item) => item !== type) : [...config.selectedTypes, type];
  setConfig({ ...config, selectedTypes });
}

function withDefaults(requirement: RequirementInput, files: ReqFile[]) {
  const text = normalizeRequirementText(requirement.acceptanceCriteria.trim() || `Requirement uploaded: ${files.map((file) => file.name).join(", ")}. Please add requirement details before generating a full suite.`);
  const model = inferRequirementModel({ ...requirement, acceptanceCriteria: text });
  const firstLine = firstMeaningfulLine(text);
  const title = (requirement.requirementTitle.trim() && !isDocumentHeading(requirement.requirementTitle) ? requirement.requirementTitle.trim() : "") || (firstLine && !isDocumentHeading(firstLine) ? firstLine : "") || model.feature || "Imported requirement";
  return {
    ...requirement,
    acceptanceCriteria: text,
    projectName: requirement.projectName.trim() || "Untitled Project",
    moduleName: requirement.moduleName.trim() || "General",
    featureName: requirement.featureName.trim() && !isDocumentHeading(requirement.featureName) ? requirement.featureName.trim() : model.feature || title,
    requirementId: requirement.requirementId.trim() || `REQ-${Date.now().toString().slice(-6)}`,
    requirementTitle: title,
    userRole: requirement.userRole.trim() || "QA user"
  };
}

function firstMeaningfulLine(text: string) {
  return text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).find((line) => line && !isDocumentHeading(line));
}

function FileList({ files, remove }: { files: ReqFile[]; remove: (name: string) => void }) {
  return <div className="file-list">{files.map((file) => <span key={file.name}>{file.name} ({Math.round(file.size / 1024)} KB)<button onClick={() => remove(file.name)} aria-label={`Remove ${file.name}`}><Trash2 size={14} /></button></span>)}</div>;
}

function ProgressList({ items }: { items: string[] }) {
  return <div className="progress-list">{items.map((item) => <span key={item}><Check size={15} />{item}</span>)}</div>;
}

function BusyOverlay({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="busy-card">
        <Loader2 size={28} className="spin" />
        <div>
          <h2>{label}</h2>
          <p className="muted">Please wait while TestCraft AI completes this action.</p>
        </div>
        {items.length > 0 && <ProgressList items={items} />}
      </div>
    </div>
  );
}

function Notice({ type, text }: { type: "info" | "warn" | "error"; text: string }) {
  return <div className={`notice ${type}`}><AlertCircle size={18} />{text}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <article className="primary-card empty-state"><h1>{title}</h1><p>{text}</p></article>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return <span className="summary-chip"><strong>{value}</strong>{label}</span>;
}

function TraceList({ title, items }: { title: string; items: string[] }) {
  return <div className="trace-list"><h3>{title}</h3>{items.length ? items.map((item) => <span key={item}>{item}</span>) : <p className="muted">None</p>}</div>;
}

function manualCase(generation: Generation): TestCase {
  const base = generation.testCases[0];
  return {
    ...(base ?? {
      requirementId: generation.requirement.requirementId,
      acceptanceCriteriaId: generation.criteria[0]?.id ?? "AC-001",
      module: generation.requirement.moduleName,
      feature: generation.requirement.featureName,
      scenario: generation.criteria[0]?.text ?? generation.requirement.requirementTitle,
      objective: "",
      preconditions: generation.requirement.preconditions,
      testData: "",
      postconditions: "",
      priority: generation.requirement.priority,
      severity: generation.requirement.priority,
      automationCandidate: "Partial",
      automationNotes: "",
      screenshotReference: "",
      detectedUIElement: "",
      tags: ["manual"],
      executionStatus: "Not Run",
      actualResult: "",
      defectId: "",
      testerComments: ""
    }),
    id: `MAN-${String(generation.testCases.length + 1).padStart(3, "0")}`,
    title: "Manual test case",
    type: "Positive",
    steps: ["Describe the first executable action."],
    expectedResult: "Describe the measurable expected result.",
    assumptions: "Added manually by user.",
    inferred: true
  };
}
