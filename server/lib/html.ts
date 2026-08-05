import type { Generation } from "../../src/lib/schemas";
import { calculateCoverage } from "../../src/lib/analysis";
import { azureCaseRows } from "../../src/lib/format";
import { sanitizeFilename } from "./http";

export function buildHtmlFilename(generation: Generation, date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  return `${sanitizeFilename(generation.requirement.projectName)}_${sanitizeFilename(generation.requirement.moduleName)}_Test_Cases_${stamp}.html`;
}

export function buildHtmlReport(generation: Generation, previousGenerations: Generation[]) {
  const coverage = calculateCoverage(generation);
  const previousCases = previousGenerations.flatMap((item) => item.testCases.map((testCase) => ({ generation: item, testCase })));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(generation.requirement.projectName)} Test Cases</title>
  <style>
    body { margin: 0; font-family: Inter, Arial, sans-serif; color: #111827; background: #f5f6f8; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
    header, section { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(17,24,39,.04); }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    p { color: #6b7280; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .chip { border: 1px solid #e5e7eb; border-radius: 999px; padding: 7px 10px; background: #fafafa; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; vertical-align: top; text-align: left; }
    th { background: #f9fafb; }
    .metadata-row td { background: #fbfaff; font-weight: 600; }
    .step-row td:nth-child(5), .step-row td:nth-child(6) { white-space: pre-line; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>TestCraft AI Test Case Report</h1>
    <p>${escapeHtml(generation.requirement.projectName)} / ${escapeHtml(generation.requirement.moduleName)} / ${escapeHtml(generation.requirement.featureName)}</p>
    <div class="chips">
      <span class="chip">Total: ${generation.testCases.length}</span>
      <span class="chip">Coverage: ${coverage.coveragePercent}%</span>
      <span class="chip">Acceptance criteria: ${generation.criteria.length}</span>
      <span class="chip">Automation candidates: ${coverage.automationCandidateCount}</span>
    </div>
  </header>
  <section>
    <h2>Current Test Cases</h2>
    ${renderCases(generation.testCases.map((testCase) => ({ generation, testCase })))}
  </section>
  <section>
    <h2>Coverage</h2>
    <p>Covered ACs: ${escapeHtml(coverage.coveredCriteria.join(", ") || "None")}</p>
    <p>Uncovered ACs: ${escapeHtml(coverage.uncoveredCriteria.join(", ") || "None")}</p>
    <p>Screenshot elements covered: ${escapeHtml(coverage.coveredElements.join(", ") || "None")}</p>
  </section>
  <section>
    <h2>Previous Test Cases</h2>
    ${previousCases.length ? renderCases(previousCases) : "<p>No previous saved test cases were found.</p>"}
  </section>
</main>
</body>
</html>`;
}

function renderCases(items: Array<{ generation: Generation; testCase: Generation["testCases"][number] }>) {
  return `<table>
    <thead><tr><th>ID</th><th>Work Item Type</th><th>Title</th><th>Test Step</th><th>Step Action</th><th>Step Expected</th><th>Area Path</th><th>State</th><th>Test Type</th><th>AC</th><th>Priority</th></tr></thead>
    <tbody>${items.map(({ generation, testCase }) => azureCaseRows(testCase).map((row, index) => {
      const isMetadata = index === 0;
      return `<tr class="${isMetadata ? "metadata-row" : "step-row"}">
        <td>${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.workItemType)}</td>
        <td>${escapeHtml(row.title)}</td>
        <td>${escapeHtml(row.testStep)}</td>
        <td>${escapeHtml(row.stepAction)}</td>
        <td>${escapeHtml(row.stepExpected)}</td>
        <td>${escapeHtml(isMetadata ? `${generation.requirement.projectName}\\${generation.requirement.moduleName}` : "")}</td>
        <td>${escapeHtml(isMetadata ? "Design" : "")}</td>
        <td>${escapeHtml(isMetadata ? "Functional" : "")}</td>
        <td>${escapeHtml(isMetadata ? testCase.acceptanceCriteriaId : "")}</td>
        <td>${escapeHtml(isMetadata ? testCase.priority : "")}</td>
      </tr>`;
    }).join("")).join("")}</tbody>
  </table>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
