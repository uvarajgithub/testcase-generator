import type { TestCase } from "./schemas";

export type AzureCaseRow = {
  id: string;
  workItemType: string;
  title: string;
  testStep: string | number;
  stepAction: string;
  stepExpected: string;
  ac: string;
  priority: string;
  actions: string;
};

export function azureCaseRows(testCase: TestCase): AzureCaseRow[] {
  return testCase.steps.map((step, index) => {
    const isFirstStep = index === 0;
    return {
      id: "",
      workItemType: isFirstStep ? "Test Case" : "",
      title: isFirstStep ? stripTitlePrefix(testCase.title) : "",
      testStep: index + 1,
      stepAction: step,
      stepExpected: stepExpected(testCase, index),
      ac: isFirstStep ? testCase.acceptanceCriteriaId : "",
      priority: isFirstStep ? testCase.priority : "",
      actions: ""
    };
  });
}

export function stepExpected(testCase: TestCase, stepIndex: number) {
  const step = testCase.steps[stepIndex] ?? "";
  if (stepIndex === testCase.steps.length - 1) return testCase.expectedResult;
  if (/^open\b/i.test(step)) return `${testCase.feature} page loads successfully and displays the controls named in this test case.`;
  if (/\busername\b|\bemail\b/i.test(step) && /\benter\b/i.test(step)) return "The complete value is displayed in the target field without a validation message.";
  if (/\bpassword\b/i.test(step) && /\benter\b/i.test(step)) return "Every entered password character is masked and the field accepts the input.";
  if (/\bpassword\b/i.test(step) && /\bleave\b/i.test(step)) return "The Password field remains empty and no password value is submitted.";
  if (/\busername\b|\bemail\b/i.test(step) && /\bleave\b/i.test(step)) return "The target field remains empty and is ready to display a required-field validation message.";
  if (/\bleave\b/i.test(step)) return "The named field remains empty and no record is saved from this action.";
  if (/\bclick\b/i.test(step) && /\blogin\b/i.test(step)) return "The login request is submitted and the authentication response is displayed.";
  if (/\bclick\b/i.test(step)) return "The named button submits the current form state for validation.";
  if (/\bmaximum|minimum|256|one additional character|over the allowed limit\b/i.test(step)) return "The field enforces the configured boundary and displays any validation message tied to that boundary.";
  if (/\bnavigate|tab|keyboard\b/i.test(step)) return "Focus moves to the next named control in a logical order with a visible focus indicator.";
  if (/\breview|verify|confirm|inspect\b/i.test(step)) return `${testCase.feature} shows the specific state described in the test objective.`;
  return `${testCase.feature} displays the result tied to this action without saving unintended changes.`;
}

export function validateAzureTestCases(testCases: TestCase[]) {
  const errors: string[] = [];
  const titles = new Set<string>();
  testCases.forEach((testCase) => {
    const title = stripTitlePrefix(testCase.title);
    if (/^\s*(?:POS|NEG|EDGE|VAL|TC|SEC|UI|A11Y|RESP|INT)-\d+/i.test(testCase.title)) errors.push(`${testCase.id}: remove the test-case prefix from the title.`);
    if (!/^Verify\b/.test(title)) errors.push(`${testCase.id}: title must start with "Verify".`);
    if (title.split(/\s+/).length < 8) errors.push(`${testCase.id}: title must be descriptive.`);
    if (titles.has(title.toLowerCase())) errors.push(`${testCase.id}: title duplicates another test case.`);
    titles.add(title.toLowerCase());
    if (!testCase.steps.length) errors.push(`${testCase.id}: add at least one executable test step.`);
    azureCaseRows(testCase).forEach((row, index) => {
      if (row.id !== "") errors.push(`${testCase.id}: Azure ID column must be blank.`);
      if (typeof row.testStep !== "number") errors.push(`${testCase.id}: Test Step must be numeric.`);
      if (row.testStep !== index + 1) errors.push(`${testCase.id}: test steps must be sequential from 1.`);
      if (!row.stepAction.trim()) errors.push(`${testCase.id}: Step Action is required for step ${index + 1}.`);
      if (!row.stepExpected.trim()) errors.push(`${testCase.id}: Step Expected is required for step ${index + 1}.`);
      if (index > 0 && [row.workItemType, row.title, row.ac, row.priority, row.actions].some(Boolean)) errors.push(`${testCase.id}: continuation row ${index + 1} contains test-case-level data.`);
      if (index === 0 && (!row.workItemType || !row.title || !testCase.type || !row.ac || !row.priority)) errors.push(`${testCase.id}: first row is missing required test-case metadata.`);
      if (!isSpecificAction(row.stepAction)) errors.push(`${testCase.id}: step ${index + 1} must identify one concrete control, page, field, button, link, menu, or data condition.`);
      if (hasMultipleActions(row.stepAction)) errors.push(`${testCase.id}: step ${index + 1} combines multiple tester actions.`);
      if (hasVagueData(row.stepAction)) errors.push(`${testCase.id}: step ${index + 1} uses vague test data.`);
      if (isGenericExpected(row.stepExpected)) errors.push(`${testCase.id}: step ${index + 1} expected result must be measurable and tied to the action.`);
    });
    const scores = scoreTestCase(testCase);
    Object.entries(scores).forEach(([name, value]) => {
      if (value < 8) errors.push(`${testCase.id}: ${name} quality score is ${value}/10; regenerate or edit this test case.`);
    });
  });
  return errors;
}

function stripTitlePrefix(value: string) {
  return value.replace(/^\s*(?:POS|NEG|EDGE|VAL|TC|SEC|UI|A11Y|RESP|INT)-\d+\s*:\s*/i, "").trim();
}

function isSpecificAction(value: string) {
  const action = value.replace(/^[=+\-@']+/, "");
  return /^open\s+.+/i.test(action) || /\b(pages?|urls?|fields?|buttons?|menus?|links?|dropdowns?|checkboxes?|tables?|tabs?|dashboard|forms?|records?|messages?|username|password|email|amount|date|status|controls?|viewports?|data|values?|duplicate|request|response|validation|state|condition|permission|authorization|service)\b/i.test(action);
}

function hasMultipleActions(value: string) {
  const action = value.replace(/^[=+\-@']+/, "");
  return /\benter\b.+\bclick\b|\bselect\b.+\bsubmit\b|\btype\b.+\bpress\b|\band\s+(?:click|submit|save|navigate|open)\b/i.test(action);
}

function hasVagueData(value: string) {
  return /\b(valid value|invalid value|required data|correct input|wrong input|suitable credentials|valid values|required values)\b/i.test(value);
}

function isGenericExpected(value: string) {
  return /\b(system works correctly|input is accepted|application remains stable|tester can proceed|expected result is satisfied|observable response|behaves as expected|expected state is visible)\b/i.test(value);
}

function scoreTestCase(testCase: TestCase) {
  const rows = azureCaseRows(testCase);
  const title = stripTitlePrefix(testCase.title);
  const weakActions = rows.filter((row) => !isSpecificAction(row.stepAction) || hasMultipleActions(row.stepAction) || hasVagueData(row.stepAction)).length;
  const weakExpected = rows.filter((row) => isGenericExpected(row.stepExpected) || row.stepExpected.split(/\s+/).length < 6).length;
  const featureHits = rows.filter((row) => `${row.stepAction} ${row.stepExpected}`.toLowerCase().includes(testCase.feature.toLowerCase())).length;
  return {
    "Title clarity": /^Verify\b/.test(title) && title.split(/\s+/).length >= 8 ? 9 : 6,
    "Step specificity": Math.max(0, 10 - weakActions * 2),
    "Expected-result measurability": Math.max(0, 10 - weakExpected * 2),
    "Scenario relevance": featureHits || rows.length <= 2 ? 9 : 7,
    Executability: rows.length >= 3 && weakActions === 0 && weakExpected === 0 ? 9 : 7
  };
}
