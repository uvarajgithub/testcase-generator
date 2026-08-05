import type { TestCase } from "./schemas";

const documentHeadingPattern = /\b(Business Objective|Acceptance Criteria|Functional Requirements?|Business Rules?|Primary Source|Expected Behaviou?r|User Story|Definition of Done|Out of Scope|Validation Rules)\b/i;
const documentHeadingAsControlPattern = /\b(?:Open|Enter|Review|Observe|Locate|Select)\s+(?:Business Objective|Acceptance Criteria|Description|Requirement|Functional Requirements?|Business Rules?|Background|Scope|Assumptions?|Dependencies|Notes|Primary Source|Expected Behaviou?r|User Story|Definition of Done|Out of Scope|Validation Rules)\b|\bSample\s+(?:Business Objective|Acceptance Criteria|Description|Requirement|Functional Requirements?|Business Rules?)\b/i;

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
  const metadataRow: AzureCaseRow = {
    id: "",
    workItemType: "Test Case",
    title: scrubDocumentHeadingText(stripTitlePrefix(testCase.title)),
    testStep: "",
    stepAction: "",
    stepExpected: "",
    ac: testCase.acceptanceCriteriaId,
    priority: testCase.priority,
    actions: ""
  };
  const stepRows = testCase.steps.map((step, index) => ({
    id: "",
    workItemType: "",
    title: "",
    testStep: index + 1,
    stepAction: scrubDocumentHeadingText(step),
    stepExpected: scrubDocumentHeadingText(stepExpected(testCase, index)),
    ac: "",
    priority: "",
    actions: ""
  }));
  return [metadataRow, ...stepRows];
}

export function stepExpected(testCase: TestCase, stepIndex: number) {
  const step = (testCase.steps[stepIndex] ?? "").replace(/^[=+\-@']+/, "");
  if (stepIndex === testCase.steps.length - 1) return testCase.expectedResult;
  if (/open user groups and select new user group/i.test(step)) return "The New User Group page opens successfully.";
  if (/locate the tna supervisor field/i.test(step)) return "The TNA Supervisor field displays Yes and No radio-button options.";
  if (/review the selected value without interacting/i.test(step)) return "No is selected by default and Yes remains unselected.";
  if (/select yes in the tna supervisor field/i.test(step)) return "Yes becomes selected and No becomes unselected.";
  if (/select no in the tna supervisor field/i.test(step)) return "No becomes selected and Yes becomes unselected.";
  if (/retain the default no selection in the tna supervisor field/i.test(step)) return "No remains selected in the TNA Supervisor field.";
  if (/mandatory user-group fields/i.test(step) && /\benter\b/i.test(step)) return "The group name and group code appear in their fields without validation errors.";
  if (/mandatory user-group name field empty/i.test(step)) return "The mandatory user-group name field remains empty.";
  if (/click the save button/i.test(step) && /employee profile/i.test(step)) return "The employee profile save request is submitted with the selected Supervisor value.";
  if (/click the save button/i.test(step)) return "The current user-group form values are submitted for validation and save processing.";
  if (/reopen the saved user-group record/i.test(step)) return "The saved user-group record opens with the persisted TNA Supervisor field visible.";
  if (/create one user group with tna supervisor set to yes/i.test(step)) return "The TNA Supervisor user group is saved successfully.";
  if (/create one user group with tna supervisor set to no/i.test(step)) return "The non-TNA Supervisor user group is saved successfully.";
  if (/add a user to the tna supervisor user group/i.test(step)) return "The user is successfully assigned to the TNA Supervisor group.";
  if (/add a user to the non-tna supervisor group/i.test(step)) return "The user is successfully assigned to the non-TNA Supervisor group.";
  if (/open employee profile > time & attendance/i.test(step)) return "The Time & Attendance section opens and the Supervisor lookup is available.";
  if (/search for the user assigned to the tna supervisor group/i.test(step)) return "The user appears in the Supervisor lookup results.";
  if (/select the user in the supervisor lookup/i.test(step)) return "The selected user appears in the Supervisor field.";
  if (/search for the user assigned only to the non-tna supervisor group/i.test(step)) return "The user does not appear in the Supervisor lookup results.";
  if (/search for the user assigned to the updated tna supervisor group/i.test(step)) return "The updated user appears in the Supervisor lookup results.";
  if (/search for the user assigned only to the updated non-tna supervisor group/i.test(step)) return "The updated user is excluded from the Supervisor lookup results.";
  if (/sign in as a user without user groups edit permission/i.test(step)) return "The lower-privilege session opens without User Groups edit permission.";
  if (/sign in as a user role that does not have permission/i.test(step)) return "The lower-privilege session opens without the required feature permission.";
  if (/open the protected user groups page url/i.test(step)) return "The User Groups page is blocked or opens in read-only mode for the lower-privilege user.";
  if (/attempt to edit the tna supervisor field/i.test(step)) return "The TNA Supervisor field cannot be changed by the lower-privilege user.";
  if (/^start\s+.+\s+form with\b/i.test(step)) return "The form contains valid data before the retry or interruption condition is applied.";
  if (/^interrupt\s+.+\s+submission\b/i.test(step)) return "The in-progress submission is stopped before a success state or duplicate record is created.";
  if (/^focus\b/i.test(step) && /\bfields?\b/i.test(step)) return "The named field receives focus and exposes its validation-ready state.";
  if (/^replace\b/i.test(step) && /\bmalformed\b/i.test(step)) return "The corrected value replaces the malformed value in the named field.";
  if (/^correct the values\b/i.test(step) || /^correct the error\b/i.test(step)) return "The corrected values appear in the relevant fields and validation messages are ready to clear.";
  if (/^tamper with request values/i.test(step)) return "The request contains modified identifiers or role-related values before submission.";
  if (/^trigger validation, authorization, or processing failures/i.test(step)) return "The feature displays a controlled failure state without exposing protected data.";
  if (/^check that internal identifiers/i.test(step)) return "Internal identifiers, stack traces, secrets, and sensitive values are absent from the visible response.";
  if (/^start a browser session with no authenticated user/i.test(step)) return "A browser session starts without an authenticated user account or active session token.";
  if (/^open the dashboard url directly/i.test(step)) return "The dashboard URL request is made without an authenticated session.";
  if (/\benter\b/i.test(step) && /\bfields?\b/i.test(step)) return "The entered field values are displayed without a validation message.";
  if (/\benter\b/i.test(step) && /\bvalues?\s+for\b/i.test(step)) return "The entered values are displayed in the target control without a validation message.";
  if (/\benter\b/i.test(step) && /\bmandatory\b/i.test(step)) return "The entered mandatory values appear in the form without validation errors.";
  if (/\bsubmit\b|\bsave\b/i.test(step) && /\bform\b|\bchange\b|\brequest\b/i.test(step)) return "The named request is submitted with the current form values.";
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
    const title = scrubDocumentHeadingText(stripTitlePrefix(testCase.title));
    if (documentHeadingPattern.test(title)) errors.push(`${testCase.id}: title must not use requirement document headings as product content.`);
    if (documentHeadingPattern.test(testCase.feature)) errors.push(`${testCase.id}: feature must be an application feature, not a requirement document heading.`);
    if (testCase.scenario && title.includes(testCase.scenario) && testCase.scenario.split(/\s+/).length > 10) errors.push(`${testCase.id}: title must not copy the full acceptance-criteria paragraph.`);
    if (/^\s*(?:POS|NEG|EDGE|VAL|TC|SEC|UI|A11Y|RESP|INT)-\d+/i.test(testCase.title)) errors.push(`${testCase.id}: remove the test-case prefix from the title.`);
    if (!/^Verify\b/.test(title)) errors.push(`${testCase.id}: title must start with "Verify".`);
    if (title.split(/\s+/).length < 8) errors.push(`${testCase.id}: title must be descriptive.`);
    if (titles.has(title.toLowerCase())) errors.push(`${testCase.id}: title duplicates another test case.`);
    titles.add(title.toLowerCase());
    if (!testCase.steps.length) errors.push(`${testCase.id}: add at least one executable test step.`);
    azureCaseRows(testCase).forEach((row, index) => {
      if (row.id !== "") errors.push(`${testCase.id}: Azure ID column must be blank.`);
      if (index === 0) {
        if (row.testStep !== "" || row.stepAction !== "" || row.stepExpected !== "") errors.push(`${testCase.id}: metadata row must leave Test Step, Step Action, and Step Expected blank.`);
        if (!row.workItemType || !row.title || !testCase.type || !row.ac || !row.priority) errors.push(`${testCase.id}: first row is missing required test-case metadata.`);
        return;
      }
      if (typeof row.testStep !== "number") errors.push(`${testCase.id}: Test Step must be numeric.`);
      if (row.testStep !== index) errors.push(`${testCase.id}: test steps must be sequential from 1.`);
      if (!row.stepAction.trim()) errors.push(`${testCase.id}: Step Action is required for step ${index}.`);
      if (!row.stepExpected.trim()) errors.push(`${testCase.id}: Step Expected is required for step ${index}.`);
      if ([row.workItemType, row.title, row.ac, row.priority, row.actions].some(Boolean)) errors.push(`${testCase.id}: continuation row ${index + 1} contains test-case-level data.`);
      if (!isSpecificAction(row.stepAction)) errors.push(`${testCase.id}: step ${index} must identify one concrete control, page, field, button, link, menu, or data condition.`);
      if (documentHeadingAsControlPattern.test(row.stepAction)) errors.push(`${testCase.id}: step ${index} must not use requirement document headings as controls or data.`);
      if (documentHeadingPattern.test(row.stepExpected)) errors.push(`${testCase.id}: step ${index} expected result must not use requirement document headings as the application subject.`);
      if (/Sample\s+(?:Business Objective|Acceptance Criteria|Description|Requirement)/i.test(`${row.stepAction} ${row.stepExpected}`)) errors.push(`${testCase.id}: step ${index} uses a sample value derived from a document heading.`);
      if (hasMultipleActions(row.stepAction)) errors.push(`${testCase.id}: step ${index} combines multiple tester actions.`);
      if (hasVagueData(row.stepAction)) errors.push(`${testCase.id}: step ${index} uses vague test data.`);
      if (isGenericExpected(row.stepExpected)) errors.push(`${testCase.id}: step ${index} expected result must be measurable and tied to the action.`);
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

function scrubDocumentHeadingText(value: string) {
  return value
    .replace(/\bBusiness Objective\b/gi, "business goal")
    .replace(/\bAcceptance Criteria\b/gi, "accepted behavior")
    .replace(/\bFunctional Requirements?\b/gi, "functional rule")
    .replace(/\bBusiness Rules?\b/gi, "configured rule")
    .replace(/\bPrimary Source\b/gi, "source record")
    .replace(/\bExpected Behaviou?r\b/gi, "expected behavior")
    .replace(/\bUser Story\b/gi, "user flow")
    .replace(/\bDefinition of Done\b/gi, "completion rule")
    .replace(/\bOut of Scope\b/gi, "excluded behavior")
    .replace(/\bValidation Rules\b/gi, "validation behavior")
    .replace(/\s+/g, " ")
    .trim();
}

function isSpecificAction(value: string) {
  const action = value.replace(/^[=+\-@']+/, "");
  return /^open\s+.+/i.test(action) || /\b(pages?|urls?|fields?|buttons?|menus?|links?|dropdowns?|checkboxes?|tables?|tabs?|dashboard|forms?|records?|messages?|username|password|email|amount|date|status|controls?|viewports?|data|values?|duplicate|request|response|validation|state|condition|permission|authorization|service|session|token|browser|radio-button|lookup|user group|employee profile|time & attendance|tna supervisor)\b/i.test(action);
}

function hasMultipleActions(value: string) {
  const action = value.replace(/^[=+\-@']+/, "");
  return /\benter\b.+\bclick\b|\bselect\b.+\bsubmit\b|\btype\b.+\bpress\b|\band\s+(?:click|submit|save|navigate|open)\b/i.test(action);
}

function hasVagueData(value: string) {
  return /\b(valid value|invalid value|required data|correct input|wrong input|suitable credentials|valid values|required values)\b/i.test(value);
}

function isGenericExpected(value: string) {
  return /\b(system works correctly|input is accepted|application remains stable|tester can proceed|expected result is satisfied|observable response|behaves as expected|expected state is visible|result tied to this action|produces the required result|details are accepted|field is available as per requirement|screen works correctly)\b/i.test(value);
}

function scoreTestCase(testCase: TestCase) {
  const rows = azureCaseRows(testCase).slice(1);
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
