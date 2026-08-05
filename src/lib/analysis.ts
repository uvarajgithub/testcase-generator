import { nanoid } from "nanoid";
import type { AcceptanceCriterion, CoverageSummary, DetectedElement, Generation, RequirementInput, TestCase } from "./schemas";

const uiPatterns: Array<[string, string]> = [
  ["button", "Button"],
  ["submit", "Button"],
  ["save", "Button"],
  ["cancel", "Button"],
  ["search", "Search field"],
  ["filter", "Filter"],
  ["dropdown", "Dropdown"],
  ["select", "Dropdown"],
  ["checkbox", "Checkbox"],
  ["radio", "Radio button"],
  ["table", "Table"],
  ["pagination", "Pagination"],
  ["tab", "Tabs"],
  ["modal", "Modal"],
  ["upload", "Uploaded-file control"],
  ["date", "Date field"],
  ["amount", "Numeric field"],
  ["email", "Text field"],
  ["password", "Text field"],
  ["status", "Visible status"],
  ["required", "Mandatory indicator"]
];

export function parseAcceptanceCriteria(text: string): AcceptanceCriterion[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  const gwtBlocks = normalized.match(/given[\s\S]*?(?=(?:\n\s*given\b)|$)/gi) ?? [];
  const candidates = gwtBlocks.length > 1 ? gwtBlocks.map((b) => b.trim()) : lines.length > 1 ? lines : [normalized].filter(Boolean);

  return candidates.map((criterion, index) => {
    const lower = criterion.toLowerCase();
    const parts = criterionParts(criterion);
    const actor = parts.actor || (lower.includes("admin") ? "Admin" : lower.includes("customer") ? "Customer" : "User");
    const inputs = inputTerms(criterion);
    const dependencies = Array.from(new Set((criterion.match(/\b(api|payment|database|email service|gateway|third-party|integration)\b/gi) ?? []).map((v) => v.toLowerCase())));
    const validations = Array.from(new Set((criterion.match(/\b(required|valid|invalid|min(?:imum)?|max(?:imum)?|unique|duplicate|format|authorized|permission)\b/gi) ?? []).map((v) => v.toLowerCase())));
    const outcomes = parts.outcome ? [parts.outcome] : lower.includes("then") ? [criterion.split(/then/i).pop()?.trim() ?? "Expected outcome is satisfied"] : ["Expected outcome is satisfied"];
    const action = parts.action || normalizeAction(criterion.match(/\b(?:can|should|must|when)\s+([^.,;]+)/i)?.[1]?.replace(/\bthen\b[\s\S]*$/i, "") ?? "") || "complete the described behavior";
    const assumptions = criterion.length < 18 ? ["Acceptance criterion is brief; generation uses standard QA assumptions."] : [];
    const warnings = lower.includes("etc") || lower.includes("as needed") ? ["Criterion contains open-ended wording that may need clarification."] : [];
    return {
      id: `AC-${String(index + 1).padStart(3, "0")}`,
      text: criterion,
      actor,
      action,
      inputs,
      conditions: parts.condition ? [parts.condition] : lower.includes("given") ? [criterion.split(/when/i)[0]?.trim()] : [],
      validations,
      outcomes,
      dependencies,
      assumptions,
      warnings
    };
  });
}

function criterionParts(criterion: string) {
  const gwt = criterion.match(/\bgiven\s+([\s\S]*?)\s+\bwhen\s+([\s\S]*?)\s+\bthen\s+([\s\S]*)/i);
  if (!gwt) return { actor: "", condition: "", action: "", outcome: "" };
  const condition = cleanPhrase(gwt[1]);
  const action = normalizeAction(gwt[2]);
  const outcome = cleanPhrase(gwt[3]);
  const actorMatch = `${condition} ${action}`.match(/\b(admin|customer|user|tester|approver|manager|guest|operator)\b/i);
  return {
    actor: actorMatch ? titleCase(actorMatch[1]) : "",
    condition,
    action,
    outcome
  };
}

function normalizeAction(value: string) {
  return cleanPhrase(value)
    .replace(/^(?:the\s+)?(?:user|customer|admin|tester|approver|manager|guest|operator|they|he|she)\s+/i, "")
    .replace(/^(?:can|should|must|will)\s+/i, "")
    .trim();
}

function inputTerms(criterion: string) {
  const known = (criterion.match(/\b(email|password|name|date|amount|file|status|role|search|filter|quantity|address|account details|profile details|payment details|order details|login details)\b/gi) ?? [])
    .map((value) => value.toLowerCase());
  const phraseMatches = Array.from(criterion.matchAll(/\b(?:enter|enters|provide|provides|select|selects|upload|uploads|search|searches|submit|submits)\s+(?:a|an|the|valid|invalid|required|mandatory|optional|new|existing|\s)*([a-z][a-z0-9 /-]{2,40}?)(?=\s+(?:when|then|and|or|with|to|for)\b|[.,;]|$)/gi))
    .map((match) => cleanInput(match[1]));
  const ruleMatches = Array.from(criterion.matchAll(/\b(?:invalid|required|duplicate|missing|empty|valid)\s+([a-z][a-z0-9 /-]{2,32}?)(?=\s+(?:shows|is|are|should|must|when|then)\b|[.,;]|$)/gi))
    .map((match) => cleanInput(match[1]));
  return Array.from(new Set([...known, ...phraseMatches, ...ruleMatches].filter(Boolean))).slice(0, 5);
}

function cleanInput(value: string) {
  return cleanPhrase(value)
    .replace(/\b(details|values|data|information)\s*$/i, "$1")
    .replace(/\b(the|a|an|valid|invalid|required|mandatory|optional|new|existing)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanPhrase(value: string) {
  return value.replace(/\s+/g, " ").replace(/[.;]+$/g, "").trim();
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function sentenceCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function inferElementsFromRequirement(requirement: RequirementInput, screenshots: Array<{ id: string; filename: string }>): DetectedElement[] {
  const source = `${requirement.requirementTitle} ${requirement.requirementDescription} ${requirement.acceptanceCriteria} ${requirement.businessRules}`;
  const matches = uiPatterns.filter(([needle]) => source.toLowerCase().includes(needle));
  const baseScreenshot = screenshots[0] ?? { id: "manual", filename: "Manually reviewed input" };
  const elements = matches.map(([, type], index) => ({
    id: `UI-${String(index + 1).padStart(3, "0")}`,
    screenshotId: baseScreenshot.id,
    screenshotName: baseScreenshot.filename,
    type,
    label: type.replace("Uploaded-file", "File upload"),
    visibleText: type,
    relatedAcceptanceCriterionId: undefined,
    confidence: screenshots.length ? 0.42 : 0.25,
    userCorrection: "",
    notes: screenshots.length ? "Detected by filename and requirement correlation. Review before generation." : "Manual fallback: add screenshot details before generation.",
    assumption: "AI vision is unavailable locally; this finding must be reviewed by the user."
  }));
  return elements.length ? elements : [{
    id: "UI-001",
    screenshotId: baseScreenshot.id,
    screenshotName: baseScreenshot.filename,
    type: "Reviewed screen",
    label: requirement.featureName,
    visibleText: requirement.requirementTitle,
    relatedAcceptanceCriterionId: undefined,
    confidence: 0.2,
    userCorrection: "",
    notes: "No specific UI element was confidently detected. Add or correct elements before generation.",
    assumption: "Specific screenshot details are unknown until user review."
  }];
}

const prefixes: Record<TestCase["type"], string> = {
  Positive: "POS",
  Negative: "NEG",
  Edge: "EDGE",
  Validation: "VAL",
  UI: "UI",
  Accessibility: "A11Y",
  Security: "SEC",
  Responsive: "RESP",
  Integration: "INT"
};

export function generateCases(generation: Pick<Generation, "requirement" | "criteria" | "detectedElements" | "config">): TestCase[] {
  const counts: Partial<Record<TestCase["type"], number>> = {};
  const cases: TestCase[] = [];
  const selected = generation.config.selectedTypes;
  for (const criterion of generation.criteria) {
    for (const type of selected) {
      if (cases.length >= generation.config.maxCases) break;
      if (type === "Integration" && criterion.dependencies.length === 0) continue;
      if (type === "Responsive" && !["Web", "Mobile"].includes(generation.requirement.platform)) continue;
      const relatedElement = generation.detectedElements.find((el) => el.relatedAcceptanceCriterionId === criterion.id) ?? generation.detectedElements[0];
      for (const variant of variantsFor(type, criterion, generation.requirement.platform)) {
        if (cases.length >= generation.config.maxCases) break;
        counts[type] = (counts[type] ?? 0) + 1;
        cases.push(buildCase(generation, criterion, type, counts[type] ?? 1, relatedElement, variant));
      }
    }
  }
  return removeDuplicates(cases);
}

type CaseVariant = {
  name: string;
  title: string;
  data: string;
  steps: string[];
  expected: string;
  tags: string[];
};

function variantsFor(type: TestCase["type"], criterion: AcceptanceCriterion, platform: RequirementInput["platform"]): CaseVariant[] {
  const data = criterion.inputs.length ? criterion.inputs.join(", ") : "required data";
  const primaryData = criterion.inputs[0] ?? data;
  if (type === "Positive") {
    return [
      {
        name: "happy-path",
        title: `${sentenceCase(criterion.action)} with valid ${primaryData}`,
        data: `Valid ${data}`,
        steps: ["Open the feature under test.", `Enter valid values for ${primaryData}.`, "Submit or continue the flow.", "Review the final confirmation, status, or saved record."],
        expected: criterion.outcomes[0] || "The user completes the flow successfully and the expected state is visible.",
        tags: ["happy-path", "valid-data"]
      },
      {
        name: "optional-data",
        title: `${sentenceCase(criterion.action)} with only mandatory ${primaryData}`,
        data: `Mandatory ${data} only`,
        steps: ["Open the feature under test.", "Complete only the mandatory fields required by the acceptance criterion.", "Submit or continue the flow.", "Review whether optional omissions are handled correctly."],
        expected: "The system completes the flow using mandatory data only and does not require optional information.",
        tags: ["mandatory-only"]
      },
      {
        name: "save-state",
        title: `Confirm saved state after ${criterion.action}`,
        data: `Valid ${data} with traceable reference value`,
        steps: ["Complete the acceptance-criterion flow with valid data.", "Navigate away from the feature or refresh the view.", "Return to the feature or related record.", "Review the persisted values and visible status."],
        expected: "The saved state persists accurately and remains traceable after navigation or refresh.",
        tags: ["persistence", "state"]
      }
    ];
  }
  if (type === "Negative") {
    return [
      {
        name: "empty-required",
        title: `Reject empty required ${data}`,
        data: `Empty ${data}`,
        steps: ["Open the feature under test.", `Leave ${data} empty.`, "Attempt to submit or continue.", "Review the validation message and saved state."],
        expected: "The system prevents submission, identifies the required field, and preserves any previously entered valid values.",
        tags: ["empty", "required"]
      },
      {
        name: "null-input",
        title: `Reject null or missing ${data}`,
        data: `Null or omitted ${data}`,
        steps: ["Open the feature under test.", `Submit the request with ${data} omitted or null.`, "Observe system handling.", "Review whether any record or state change was created."],
        expected: "The system rejects the null or missing value with a clear validation response and no unintended state change.",
        tags: ["null", "missing"]
      },
      {
        name: "invalid-format",
        title: `Reject invalid format for ${data}`,
        data: `Malformed ${data}, including invalid format and special characters`,
        steps: ["Open the feature under test.", `Enter malformed or special-character values for ${data}.`, "Attempt to submit or continue.", "Review validation and recovery guidance."],
        expected: "The system rejects malformed data, explains the accepted format, and allows correction without data loss.",
        tags: ["invalid-format", "special-characters"]
      },
      {
        name: "duplicate-data",
        title: `Prevent duplicate submission for ${data}`,
        data: `Existing or duplicate ${data}`,
        steps: ["Create or identify an existing valid record.", `Enter duplicate ${data}.`, "Submit the flow again.", "Review duplicate prevention and visible status."],
        expected: "The system prevents duplicate records or duplicate processing and shows a measurable duplicate-handling message.",
        tags: ["duplicate"]
      },
      {
        name: "permission-denied",
        title: `Block unauthorized access to ${criterion.action}`,
        data: "Lower-privilege or unauthorized user",
        steps: ["Sign in or act as a user without the required permission.", "Open the protected feature or action.", "Attempt to complete the action.", "Review the response and visible messaging."],
        expected: "The system blocks the action, avoids exposing sensitive data, and records no unauthorized change.",
        tags: ["permission", "unauthorized"]
      }
    ];
  }
  if (type === "Edge") {
    return [
      {
        name: "minimum-boundary",
        title: `Handle minimum boundary for ${data}`,
        data: `Minimum accepted ${data}`,
        steps: ["Open the feature under test.", `Enter the minimum accepted value for ${data}.`, "Submit or continue.", "Review the resulting state."],
        expected: "The system accepts the minimum valid boundary and produces the same measurable outcome as the acceptance criterion.",
        tags: ["minimum", "boundary"]
      },
      {
        name: "maximum-boundary",
        title: `Handle maximum boundary for ${data}`,
        data: `Maximum accepted ${data}`,
        steps: ["Open the feature under test.", `Enter the maximum accepted value for ${data}.`, "Submit or continue.", "Review the resulting state and layout."],
        expected: "The system accepts the maximum valid boundary without truncation, layout breakage, or data loss.",
        tags: ["maximum", "boundary"]
      },
      {
        name: "over-limit",
        title: `Reject over-limit ${data}`,
        data: `Value exceeding maximum allowed ${data}`,
        steps: ["Open the feature under test.", `Enter a value over the allowed limit for ${data}.`, "Attempt to submit or continue.", "Review validation and saved state."],
        expected: "The system rejects the over-limit value and keeps the user in a recoverable state.",
        tags: ["over-limit", "boundary"]
      },
      {
        name: "interrupted-retry",
        title: `Recover from interrupted ${criterion.action}`,
        data: "Interrupted network, refresh, or retry condition",
        steps: ["Start the user flow with otherwise valid data.", "Interrupt the flow before completion or simulate a retry condition.", "Resume or retry the action.", "Review final state and duplicate handling."],
        expected: "The system recovers without duplicate processing, stale status, or lost user-entered data.",
        tags: ["interruption", "retry"]
      }
    ];
  }
  if (type === "Validation") {
    return [
      {
        name: "field-validation",
        title: `Validate field rules for ${data}`,
        data: `Valid, empty, malformed, and boundary ${data}`,
        steps: [`Focus each relevant field for ${criterion.id}.`, "Leave required values empty and then enter malformed values.", "Correct the values.", "Confirm validation clears only when rules are satisfied."],
        expected: "Field-level validation appears at the right time, uses measurable rules, and clears after valid correction.",
        tags: ["validation"]
      },
      {
        name: "inline-error-clearance",
        title: `Clear validation messages after correcting ${data}`,
        data: `Invalid then corrected ${data}`,
        steps: ["Open the feature under test.", `Enter invalid values for ${data} and trigger validation.`, "Correct the values using valid test data.", "Submit or continue the flow."],
        expected: "Validation messages clear after correction, and the system allows progress only with valid values.",
        tags: ["validation", "error-clearance"]
      },
      {
        name: "cross-field-validation",
        title: `Validate dependent field rules for ${criterion.action}`,
        data: "Conflicting dependent field values",
        steps: ["Open the feature under test.", "Enter individually valid values that conflict when combined.", "Attempt to submit or continue.", "Review the field-level and form-level validation messages."],
        expected: "The system detects conflicting values and identifies the fields or rule that must be corrected.",
        tags: ["validation", "cross-field"]
      }
    ];
  }
  if (type === "UI") {
    return [
      {
        name: "visible-controls",
        title: `Verify visible controls for ${criterion.action}`,
        data: "Screen labels, controls, and visible states",
        steps: ["Open the feature under test.", "Inspect visible labels, buttons, fields, links, tables, statuses, and required indicators.", "Compare the visible controls to the acceptance criterion.", "Review enabled, disabled, default, and selected states."],
        expected: "All required controls and statuses are visible, correctly labelled, and in the expected default state.",
        tags: ["ui", "visible-controls"]
      },
      {
        name: "error-state-ui",
        title: `Verify error-state UI for ${criterion.action}`,
        data: `Invalid ${data}`,
        steps: ["Open the feature under test.", "Trigger an error or validation state.", "Inspect error placement, message clarity, field highlighting, and recovery controls.", "Correct the error and review the updated UI state."],
        expected: "Error states are visually clear, associated with the relevant control, and recoverable.",
        tags: ["ui", "error-state"]
      },
      {
        name: "navigation-flow",
        title: `Verify navigation and return path for ${criterion.action}`,
        data: "Primary and secondary navigation controls",
        steps: ["Open the feature under test.", "Use primary navigation into the flow.", "Use cancel, back, close, or return controls where available.", "Review whether state and destination are correct."],
        expected: "Navigation controls move the user to predictable destinations without losing committed data.",
        tags: ["ui", "navigation"]
      }
    ];
  }
  if (type === "Accessibility") {
    return [
      {
        name: "keyboard",
        title: `Operate ${criterion.action} using keyboard only`,
        data: "Keyboard navigation",
        steps: ["Open the feature under test.", "Navigate all controls using Tab, Shift+Tab, Enter, Space, and Escape where relevant.", "Complete or attempt the user flow without pointer input.", "Review focus order and focus visibility."],
        expected: "The flow is fully operable by keyboard with logical focus order and visible focus indicators.",
        tags: ["accessibility", "keyboard"]
      },
      {
        name: "screen-reader-labels",
        title: `Verify accessible names and messages for ${criterion.action}`,
        data: "Accessible labels, descriptions, and error messages",
        steps: ["Open the feature under test with assistive-technology inspection enabled.", "Review accessible names for fields, buttons, links, and status messages.", "Trigger validation or status updates.", "Confirm messages are programmatically associated with the relevant controls."],
        expected: "Controls and dynamic messages have clear accessible names or descriptions and can be understood without visual context.",
        tags: ["accessibility", "labels"]
      },
      {
        name: "contrast-and-targets",
        title: `Verify contrast and target sizing for ${criterion.action}`,
        data: "Normal, hover, focus, disabled, and error states",
        steps: ["Open the feature under test.", "Inspect text, icons, borders, focus indicators, and error states.", "Review touch target size and spacing for actionable controls.", "Confirm content remains readable at common zoom levels."],
        expected: "Text contrast, focus contrast, and touch targets meet accessibility expectations for the configured platform.",
        tags: ["accessibility", "contrast", "touch-targets"]
      }
    ];
  }
  if (type === "Security") {
    return [
      {
        name: "unauthorized",
        title: `Prevent unauthorized ${criterion.action}`,
        data: "Unauthenticated or unauthorized user",
        steps: ["Access the feature without the required authorization.", "Attempt the protected action.", "Inspect visible and network responses.", "Review whether any protected data or state changed."],
        expected: "The system denies the action, exposes no sensitive data, and creates no unauthorized change.",
        tags: ["security", "unauthorized"]
      },
      {
        name: "tampered-input",
        title: `Reject tampered input for ${criterion.action}`,
        data: "Manipulated request values, identifiers, or role fields",
        steps: ["Complete the flow until submission is possible.", "Tamper with request values, identifiers, or role-related fields.", "Submit the modified request.", "Review server response and persisted data."],
        expected: "The backend rejects unauthorized or tampered values and does not trust client-side state.",
        tags: ["security", "tampering"]
      },
      {
        name: "sensitive-errors",
        title: `Avoid sensitive information disclosure during ${criterion.action}`,
        data: "Invalid input and failure conditions",
        steps: ["Trigger validation, authorization, or processing failures.", "Review all visible error messages and response details.", "Check that internal identifiers, stack traces, secrets, and sensitive values are not shown.", "Confirm user guidance remains actionable."],
        expected: "Failure messages are safe, non-sensitive, and actionable.",
        tags: ["security", "information-disclosure"]
      }
    ];
  }
  if (type === "Responsive" && ["Web", "Mobile"].includes(platform)) {
    return [
      {
        name: "desktop-layout",
        title: `Verify desktop layout for ${criterion.action}`,
        data: "Desktop viewport",
        steps: ["Open the feature on a desktop viewport.", "Inspect layout, alignment, table or form sizing, and sticky or fixed controls.", "Trigger long text and validation states.", "Review whether all content remains visible and usable."],
        expected: "Desktop layout remains readable, complete, and free of overlapping controls.",
        tags: ["responsive", "desktop"]
      },
      {
        name: "mobile-layout",
        title: `Verify mobile layout for ${criterion.action}`,
        data: "Desktop, tablet, and mobile viewport sizes",
        steps: ["Open the feature on a mobile viewport.", "Use primary controls with touch-style interaction.", "Trigger validation and long content states.", "Confirm there is no unusable horizontal scrolling or content overlap."],
        expected: "Mobile layout remains usable with readable content and reachable touch targets.",
        tags: ["responsive", "mobile"]
      },
      {
        name: "orientation-resize",
        title: `Preserve state when resizing ${criterion.action}`,
        data: "Viewport resize or orientation change",
        steps: ["Start the feature flow with partially entered valid data.", "Resize the viewport or change orientation.", "Continue the flow after layout changes.", "Review entered values, focus, validation, and final state."],
        expected: "The system preserves entered data and usability across resize or orientation changes.",
        tags: ["responsive", "resize", "state"]
      }
    ];
  }
  if (type === "Integration") {
    return [
      {
        name: "dependency-success",
        title: `Verify successful dependency flow for ${criterion.dependencies.join(", ")}`,
        data: "Available dependency with valid response",
        steps: [`Prepare the dependent service condition: ${criterion.dependencies.join(", ")}.`, "Run the user flow through the integration point.", "Review returned data, status, and persisted state.", "Confirm the user-visible outcome matches the acceptance criterion."],
        expected: "The integrated dependency returns successfully and the system maps the response into the correct visible and persisted state.",
        tags: ["integration", "success"]
      },
      {
        name: "dependency-timeout",
        title: `Handle timeout from ${criterion.dependencies.join(", ")}`,
        data: "Dependency timeout",
        steps: ["Start the user flow with valid data.", `Simulate timeout from ${criterion.dependencies.join(", ")}.`, "Attempt retry or recovery.", "Review visible status and persisted state."],
        expected: "The system shows retry guidance, avoids duplicate processing, and records no misleading success state.",
        tags: ["integration", "timeout", "retry"]
      },
      {
        name: "dependency-failure",
        title: `Recover from failed ${criterion.dependencies.join(", ")} response`,
        data: "Dependency error response",
        steps: ["Start the user flow with valid data.", `Return an error response from ${criterion.dependencies.join(", ")}.`, "Review error handling and recovery path.", "Retry after the dependency recovers."],
        expected: "The system handles the failure safely, keeps data consistent, and succeeds when retried after recovery.",
        tags: ["integration", "failure", "recovery"]
      }
    ];
  }
  return [{
    name: type.toLowerCase(),
    title: "",
    data: "",
    steps: [],
    expected: "",
    tags: [type.toLowerCase()]
  }];
}

function buildCase(generation: Pick<Generation, "requirement" | "config">, criterion: AcceptanceCriterion, type: TestCase["type"], number: number, element?: DetectedElement, variant?: CaseVariant): TestCase {
  const prefix = prefixes[type];
  const data = criterion.inputs.length ? criterion.inputs.join(", ") : generation.requirement.featureName;
  const titleByType: Record<TestCase["type"], string> = {
    Positive: `Verify ${criterion.action}`,
    Negative: `Reject invalid attempt to ${criterion.action}`,
    Edge: `Handle boundary conditions for ${criterion.action}`,
    Validation: `Validate field rules for ${data}`,
    UI: `Verify visible UI behavior for ${element?.label ?? generation.requirement.featureName}`,
    Accessibility: `Verify accessible operation of ${generation.requirement.featureName}`,
    Security: `Prevent unauthorized or unsafe access for ${generation.requirement.featureName}`,
    Responsive: `Verify responsive behavior for ${generation.requirement.featureName}`,
    Integration: `Verify dependency behavior for ${criterion.dependencies.join(", ")}`
  };
  const stepsByType: Record<TestCase["type"], string[]> = {
    Positive: [`Open ${generation.requirement.moduleName} > ${generation.requirement.featureName}.`, `Complete the flow using valid ${data}.`, "Submit or save the change.", "Review the resulting state."],
    Negative: [`Open ${generation.requirement.featureName}.`, `Enter invalid, empty, or unauthorized ${data}.`, "Attempt to continue.", "Review validation and recovery guidance."],
    Edge: [`Open ${generation.requirement.featureName}.`, `Enter minimum, maximum, duplicate, special-character, or interrupted values for ${data}.`, "Complete the action.", "Review state consistency after the edge condition."],
    Validation: [`Focus each relevant field for ${criterion.id}.`, "Leave required values empty and then enter malformed values.", "Correct the values.", "Confirm validation clears only when rules are satisfied."],
    UI: [`Open the screen containing ${element?.label ?? "the reviewed element"}.`, "Inspect labels, enabled states, help text, and ordering.", "Use the control with keyboard and pointer input.", "Confirm visual state matches the requirement."],
    Accessibility: [`Open ${generation.requirement.featureName} with keyboard navigation.`, "Navigate controls in logical order.", "Check labels, focus visibility, error announcement, and contrast.", "Complete the scenario without pointer-only actions."],
    Security: [`Access ${generation.requirement.featureName} as an unauthorized or lower-privilege role.`, "Attempt the protected action.", "Inspect the error response and visible messaging.", "Confirm sensitive data is not disclosed."],
    Responsive: [`Open ${generation.requirement.featureName} on configured desktop and mobile widths.`, "Use the primary controls without horizontal scrolling.", "Trigger validation and long content states.", "Confirm layout, touch targets, and content remain usable."],
    Integration: [`Prepare the dependent service condition: ${criterion.dependencies.join(", ")}.`, "Run the user flow through the integration point.", "Simulate timeout, retry, and failure response.", "Confirm recovery behavior and audit state."]
  };
  return {
    id: `${prefix}-${String(number).padStart(3, "0")}`,
    requirementId: generation.requirement.requirementId,
    acceptanceCriteriaId: criterion.id,
    module: generation.requirement.moduleName,
    feature: generation.requirement.featureName,
    scenario: criterion.text,
    title: variant?.title || titleByType[type],
    type,
    objective: `Prove that ${criterion.text}`,
    preconditions: generation.requirement.preconditions || "User can access the feature under test.",
    testData: generation.config.includeTestData ? (variant?.data || testDataFor(type, data)) : "",
        steps: enhanceSteps(variant?.steps.length ? variant.steps : stepsByType[type], generation, criterion, data),
    expectedResult: generation.config.includeExpectedResults ? (variant?.expected || expectedFor(type, criterion)) : "",
    postconditions: generation.config.includePostconditions ? "System state remains consistent and traceable after execution." : "",
    priority: generation.requirement.priority,
    severity: type === "Security" ? "Critical" : generation.requirement.priority,
    automationCandidate: ["Positive", "Negative", "Validation", "Security", "Integration"].includes(type) ? "Yes" : type === "Accessibility" ? "Partial" : "Partial",
    automationNotes: generation.config.includeAutomationCandidates ? "Candidate should be automated after selectors and stable data are confirmed." : "",
    screenshotReference: element ? `${element.screenshotName} / ${element.id}` : "",
    detectedUIElement: element ? `${element.type}: ${element.label}` : "",
    assumptions: [criterion.assumptions.join("; "), element?.assumption].filter(Boolean).join("; "),
    tags: [type.toLowerCase(), criterion.id, generation.requirement.platform.toLowerCase(), ...(variant?.tags ?? [])],
    executionStatus: "Not Run",
    actualResult: "",
    defectId: "",
    testerComments: "",
    inferred: type !== "Positive"
  };
}

function enhanceSteps(steps: string[], generation: Pick<Generation, "requirement">, criterion: AcceptanceCriterion, data: string) {
  const location = `${generation.requirement.moduleName} > ${generation.requirement.featureName}`;
  return steps.map((step) => step
    .replace(/^Open the feature under test\.$/i, `Open ${location}.`)
    .replace(/^Open the feature under test\./i, `Open ${location}.`)
    .replace(/^Open the feature\.$/i, `Open ${location}.`)
    .replace(/^Complete the acceptance-criterion flow with valid data\.$/i, `Perform "${criterion.action}" in ${generation.requirement.featureName} using valid ${data}.`)
    .replace(/^Start the user flow with otherwise valid data\.$/i, `Start "${criterion.action}" in ${generation.requirement.featureName} with otherwise valid ${data}.`)
    .replace(/^Submit or continue the flow\.$/i, `Submit or continue the ${generation.requirement.featureName} flow.`)
    .replace(/^Attempt to submit or continue\.$/i, `Attempt to submit or continue the ${generation.requirement.featureName} flow.`)
    .replace(/^Review the final confirmation, status, or saved record\.$/i, `Review the final confirmation, status, or saved ${generation.requirement.featureName} record.`)
  );
}

function testDataFor(type: TestCase["type"], data: string) {
  if (type === "Negative") return `Invalid values for ${data}: empty, malformed, duplicate, unauthorized.`;
  if (type === "Edge") return `Boundary values for ${data}: minimum, maximum, null, special characters, long strings.`;
  return `Valid values for ${data}.`;
}

function expectedFor(type: TestCase["type"], criterion: AcceptanceCriterion) {
  if (type === "Negative") return "The system blocks the invalid action, shows a clear non-sensitive error, and preserves prior valid data.";
  if (type === "Edge") return "The system handles the boundary condition without data loss, duplicate records, broken layout, or unclear status.";
  return criterion.outcomes[0] || "The expected outcome is completed and visible to the user.";
}

export function removeDuplicates(cases: TestCase[]) {
  const seen = new Set<string>();
  return cases.filter((item) => {
    const key = `${item.acceptanceCriteriaId}:${item.type}:${item.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function calculateCoverage(generation: Pick<Generation, "criteria" | "testCases" | "detectedElements" | "assumptions" | "ambiguities">): CoverageSummary {
  const coveredCriteria = generation.criteria.filter((ac) => generation.testCases.some((tc) => tc.acceptanceCriteriaId === ac.id)).map((ac) => ac.id);
  const uncoveredCriteria = generation.criteria.filter((ac) => !coveredCriteria.includes(ac.id)).map((ac) => ac.id);
  const coveredElements = generation.detectedElements.filter((el) => generation.testCases.some((tc) => tc.detectedUIElement.includes(el.label))).map((el) => el.id);
  const uncoveredElements = generation.detectedElements.filter((el) => !coveredElements.includes(el.id)).map((el) => el.id);
  const byType = countBy(generation.testCases.map((tc) => tc.type));
  const byPriority = countBy(generation.testCases.map((tc) => tc.priority));
  const byAutomation = countBy(generation.testCases.map((tc) => tc.automationCandidate));
  return {
    totalCriteria: generation.criteria.length,
    totalTestCases: generation.testCases.length,
    byType,
    byPriority,
    byAutomation,
    coveredCriteria,
    uncoveredCriteria,
    coveredElements,
    uncoveredElements,
    assumptionsCount: generation.assumptions.length + generation.testCases.filter((tc) => tc.assumptions).length,
    ambiguitiesCount: generation.ambiguities.length,
    automationCandidateCount: generation.testCases.filter((tc) => tc.automationCandidate === "Yes").length,
    coveragePercent: generation.criteria.length ? Math.round((coveredCriteria.length / generation.criteria.length) * 100) : 0
  };
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

export function newGenerationId() {
  return `GEN-${nanoid(8).toUpperCase()}`;
}
