const steps = ["Requirements", "Screenshots", "Analysis", "Configuration", "Generated Cases", "Coverage & Export"];

export function Stepper({ step, setStep }: { step: number; setStep: (step: number) => void }) {
  return (
    <ol className="stepper" aria-label="Generation steps">
      {steps.map((label, index) => (
        <li key={label}>
          <button className={index === step ? "current" : index < step ? "done" : ""} onClick={() => setStep(index)}>
            <span>{index + 1}</span>{label}
          </button>
        </li>
      ))}
    </ol>
  );
}
