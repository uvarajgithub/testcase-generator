import { AlertCircle, Check, Copy, Edit3, ExternalLink, FileSpreadsheet, Filter, Plus, RefreshCw, Save, Search, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Shell } from "./components/Shell";
import { Field } from "./components/Field";
import { api } from "./lib/api";
import { calculateCoverage, normalizeRequirementText } from "./lib/analysis";
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
  selectedTypes: ["Positive", "Negative", "Validation", "Edge", "Security"],
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

export function App() {
  const [active, setActive] = useState("Generate");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [health, setHealth] = useState<{ aiConfigured: boolean } | null>(null);
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
  const generatingRef = useRef(false);

  useEffect(() => {
    void refresh();
    api.health().then(setHealth).catch(() => setHealth({ aiConfigured: false }));
  }, []);

  async function refresh() {
    const data = await api.generations().catch(() => ({ generations: [] }));
    setGenerations(data.generations);
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
      const analysis = await api.analyze(prepared, screenshots).catch((err) => {
        setError(err instanceof Error ? `Screenshot or input analysis warning: ${err.message}. Continuing with acceptance criteria.` : "Analysis warning. Continuing with acceptance criteria.");
        return { criteria: [], detectedElements: [], warnings: ["Analysis fallback used."], assumptions: ["Analysis could not complete; generation continued with available requirement text."], ambiguities: [] };
      });
      if (screenshots.length) setProgress((items) => [...items, "Reviewing screenshots"]);
      setProgress((items) => [...items, "Generating positive, negative and edge cases"]);
      const data = await api.saveGeneration({
        id: generation?.id,
        createdAt: generation?.createdAt,
        exportHistory: generation?.exportHistory,
        requirement: prepared,
        criteria: analysis.criteria,
        screenshots,
        detectedElements: analysis.detectedElements,
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
    <Shell active={active} setActive={setActive} aiConfigured={health?.aiConfigured}>
      {message && <div className="toast" role="status">{message}</div>}
      <section className={`page ${["Review Test Cases", "Coverage", "Export History"].includes(active) ? "page-wide" : ""}`}>
        {error && <Notice type="error" text={error} />}
        {active === "Generate" && (
          <GenerateTab
            requirement={requirement}
            setRequirement={setRequirement}
            requirementFiles={requirementFiles}
            setRequirementFiles={setRequirementFiles}
            uploadRequirementFiles={uploadRequirementFiles}
            screenshots={screenshots}
            setScreenshots={setScreenshots}
            uploadScreenshots={uploadScreenshots}
            config={config}
            setConfig={setConfig}
            generate={generate}
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

function GenerateTab(props: {
  requirement: RequirementInput;
  setRequirement: (r: RequirementInput) => void;
  requirementFiles: ReqFile[];
  setRequirementFiles: (files: ReqFile[]) => void;
  uploadRequirementFiles: (files: FileList | null) => void;
  screenshots: Generation["screenshots"];
  setScreenshots: (s: Generation["screenshots"]) => void;
  uploadScreenshots: (files: FileList | null) => void;
  config: GenerationConfig;
  setConfig: (c: GenerationConfig) => void;
  generate: () => void;
  busy: string;
  progress: string[];
}) {
  const { requirement, setRequirement, requirementFiles, setRequirementFiles, uploadRequirementFiles, screenshots, setScreenshots, uploadScreenshots, config, setConfig, generate, busy, progress } = props;
  const [sourceMode, setSourceMode] = useState<"Manual Entry" | "Upload Requirement">("Manual Entry");
  const update = (key: keyof RequirementInput, value: string) => setRequirement({ ...requirement, [key]: value });
  const canGenerate = Boolean(requirement.acceptanceCriteria.trim());
  const setCount = (value: string) => setConfig({ ...config, maxCases: value === "Auto" ? 250 : Number(value) });

  return (
    <article className="primary-card">
      <div className="card-heading">
        <div>
          <h1>Generate Test Cases</h1>
          <p>Enter acceptance criteria and configure how your test cases should be generated.</p>
        </div>
      </div>

      <section className="form-section">
        <div className="source-row">
          <h2>Requirement Source</h2>
          <div className="segmented">
            {(["Manual Entry", "Upload Requirement"] as const).map((item) => <button key={item} className={sourceMode === item ? "active" : ""} onClick={() => setSourceMode(item)}>{item}</button>)}
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
          <summary>+ Add additional context</summary>
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

      <section className="form-section compact-upload-section">
        <div className="compact-title">
          <h2>Interface Screenshots</h2>
          <span className="badge">Optional</span>
        </div>
        <label className="dropzone compact-dropzone">
          <UploadCloud size={20} />
          <strong>Drop screenshots here or browse</strong>
          <span>PNG, JPG or WebP</span>
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadScreenshots(e.target.files)} />
        </label>
        <div className="screenshot-grid">
          {screenshots.map((shot) => (
            <article className="screenshot-card" key={shot.id}>
              {shot.dataUrl ? <img src={shot.dataUrl} alt={`Preview of ${shot.filename}`} /> : <div className="image-fallback">Preview unavailable</div>}
              <div>
                <strong>{shot.filename}</strong>
                <span>{Math.round(shot.size / 1024)} KB</span>
              </div>
              <div className="row-actions">
                <label className="tiny-file">Replace<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadScreenshots(e.target.files)} /></label>
                <button onClick={() => setScreenshots(screenshots.filter((item) => item.id !== shot.id))}><Trash2 size={16} />Remove</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="form-section generation-row">
        <div className="control-panel test-types-panel">
          <h2>Test Types</h2>
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
          <Field label="Format"><select value={config.detailLevel} onChange={(e) => setConfig({ ...config, detailLevel: e.target.value as GenerationConfig["detailLevel"] })}><option>Concise</option><option>Standard</option><option>Detailed</option></select></Field>
          <div className="compact-toggles">
            <label><input type="checkbox" checked={config.includeTestData} onChange={(e) => setConfig({ ...config, includeTestData: e.target.checked })} />Test data</label>
            <label><input type="checkbox" checked={Boolean(requirement.preconditions || config.includePostconditions)} onChange={(e) => setConfig({ ...config, includePostconditions: e.target.checked })} />Preconditions</label>
            <label><input type="checkbox" checked={config.includeAutomationCandidates} onChange={(e) => setConfig({ ...config, includeAutomationCandidates: e.target.checked })} />Automation</label>
            <label><input type="checkbox" defaultChecked />Group by AC</label>
          </div>
        </div>
      </section>

      {busy && <ProgressList items={progress} />}
      <div className="actions">
        <button className="primary big generate-button" onClick={generate} disabled={!canGenerate || Boolean(busy)}>
          <RefreshCw size={18} />{busy ? "Generating Test Cases…" : "Generate Test Cases"}
        </button>
      </div>
    </article>
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
          <thead><tr><th></th><th>ID</th><th>Work Item Type</th><th>Title</th><th>Test Step</th><th>Step Action</th><th>Step Expected</th><th>Area Path</th><th>Assigned To</th><th>State</th><th>Test Type</th><th>AC</th><th>Priority</th><th>Actions</th></tr></thead>
          <tbody>{filtered.flatMap((tc) => azureCaseRows(tc).map((row, rowIndex) => {
            const isMetadata = rowIndex === 0;
            return (
              <tr key={`${tc.id}-${rowIndex}`} className={isMetadata ? "metadata-row" : "step-row"}>
                <td>{isMetadata && <input className="row-check" type="checkbox" aria-label={`Select ${tc.id}`} />}</td>
                <td>{row.id}</td>
                <td>{row.workItemType}</td>
                <td>{row.title}</td>
                <td>{row.testStep}</td>
                <td>{row.stepAction}</td>
                <td>{row.stepExpected}</td>
                <td>{isMetadata ? (azureConfig.areaPath || `${generation.requirement.projectName}\\${generation.requirement.moduleName}`) : ""}</td>
                <td>{isMetadata ? azureConfig.assignedTo : ""}</td>
                <td>{isMetadata ? azureConfig.state : ""}</td>
                <td>{isMetadata ? tc.type : ""}</td>
                <td>{row.ac}</td>
                <td>{row.priority}</td>
                <td className="row-actions">{isMetadata && <><button aria-label={`Edit ${tc.id}`} onClick={() => setEditing(tc)}><Edit3 size={16} /></button><button aria-label={`Duplicate ${tc.id}`} onClick={() => setGeneration({ ...generation, testCases: [...generation.testCases, { ...tc, id: `${tc.id}-COPY`, title: `${tc.title} copy` }] })}><Copy size={16} /></button><button aria-label={`Regenerate ${tc.id}`} onClick={() => replaceCase({ ...tc, testerComments: "Regeneration requested; preserved existing user edits." })}><RefreshCw size={16} /></button><button aria-label={`Delete ${tc.id}`} onClick={() => setGeneration({ ...generation, testCases: generation.testCases.filter((item) => item.id !== tc.id) })}><Trash2 size={16} /></button></>}</td>
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
  const title = requirement.requirementTitle.trim() || firstMeaningfulLine(text) || "Imported requirement";
  return {
    ...requirement,
    acceptanceCriteria: text,
    projectName: requirement.projectName.trim() || "Untitled Project",
    moduleName: requirement.moduleName.trim() || "General",
    featureName: requirement.featureName.trim() || title,
    requirementId: requirement.requirementId.trim() || `REQ-${Date.now().toString().slice(-6)}`,
    requirementTitle: title,
    userRole: requirement.userRole.trim() || "QA user"
  };
}

function firstMeaningfulLine(text: string) {
  return text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()).find(Boolean);
}

function FileList({ files, remove }: { files: ReqFile[]; remove: (name: string) => void }) {
  return <div className="file-list">{files.map((file) => <span key={file.name}>{file.name} ({Math.round(file.size / 1024)} KB)<button onClick={() => remove(file.name)} aria-label={`Remove ${file.name}`}><Trash2 size={14} /></button></span>)}</div>;
}

function ProgressList({ items }: { items: string[] }) {
  return <div className="progress-list">{items.map((item) => <span key={item}><Check size={15} />{item}</span>)}</div>;
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
