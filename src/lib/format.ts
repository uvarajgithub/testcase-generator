import type { TestCase } from "./schemas";

export type AzureCaseRow = {
  id: string;
  workItemType: string;
  title: string;
  testStep: string | number;
  stepAction: string;
  stepExpected: string;
};

export function azureCaseRows(testCase: TestCase): AzureCaseRow[] {
  return [
    {
      id: "",
      workItemType: "Test Case",
      title: `${testCase.id}: ${testCase.title}`,
      testStep: "",
      stepAction: "",
      stepExpected: ""
    },
    ...testCase.steps.map((step, index) => ({
      id: "",
      workItemType: "",
      title: "",
      testStep: index + 1,
      stepAction: step,
      stepExpected: stepExpected(testCase, index)
    }))
  ];
}

export function stepExpected(testCase: TestCase, stepIndex: number) {
  if (stepIndex === testCase.steps.length - 1) return testCase.expectedResult;
  if (stepIndex === 0) return "The target screen or feature is available for testing.";
  if (stepIndex === 1) return "The entered data or selected action is accepted for validation.";
  return "The system remains stable and the tester can continue to the next step.";
}
