import { FlaskConical, Settings, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

const tabs = ["Generate", "Review Test Cases", "Coverage", "Export History"] as const;

export function Shell({ active, setActive, aiConfigured, children }: { active: string; setActive: (tab: string) => void; aiConfigured?: boolean; children: ReactNode }) {
  const [showGuidance, setShowGuidance] = useState(true);
  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="brand-lockup">
          <div className="logo-mark"><FlaskConical size={19} aria-hidden /></div>
          <div>
            <strong>TestCraft AI</strong>
            <span>AI Test Case Generator</span>
          </div>
        </div>
        <div className="header-actions">
          {aiConfigured === false && <span className="ai-status">AI not configured — Manual mode active.</span>}
          <button className="icon-button" onClick={() => setActive("Settings")} aria-label="Settings">
            <Settings size={18} />
          </button>
        </div>
      </header>
      <div className="tab-shell">
        <nav className="workflow-tabs" aria-label="Workflow tabs">
          {tabs.map((tab) => (
            <button key={tab} className={active === tab ? "active" : ""} onClick={() => setActive(tab)}>
              {tab}
            </button>
          ))}
        </nav>
        {showGuidance && (
          <div className="guidance">
            <span>Start with acceptance criteria, optionally add screenshots, review generated cases, export to Azure DevOps.</span>
            <button onClick={() => setShowGuidance(false)} aria-label="Dismiss guidance"><X size={16} /></button>
          </div>
        )}
      </div>
      <main>{children}</main>
    </div>
  );
}
