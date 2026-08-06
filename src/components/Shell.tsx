import {
  Archive,
  BarChart3,
  ChevronDown,
  ClipboardCheck,
  FilePenLine,
  FlaskConical,
  LayoutDashboard,
  Settings
} from "lucide-react";
import type { ReactNode } from "react";

const navItems = [
  { label: "Dashboard", value: "Dashboard", icon: LayoutDashboard },
  { label: "Generate Tests", value: "Generate", icon: FilePenLine },
  { label: "Review Test Cases", value: "Review Test Cases", icon: ClipboardCheck },
  { label: "Coverage", value: "Coverage", icon: BarChart3 },
  { label: "Export History", value: "Export History", icon: Archive },
  { label: "Settings", value: "Settings", icon: Settings }
];

const pageCopy: Record<string, { title: string; subtitle: string }> = {
  Dashboard: {
    title: "Dashboard",
    subtitle: "Monitor workspace activity, AI readiness, and recent test generation output."
  },
  Generate: {
    title: "Generate Test Cases",
    subtitle: "Create high-quality test cases from requirements and screenshots."
  },
  "Review Test Cases": {
    title: "Review Test Cases",
    subtitle: "Edit, validate, and prepare generated cases for Azure DevOps export."
  },
  Coverage: {
    title: "Coverage",
    subtitle: "Trace acceptance criteria, visual evidence, and generated test coverage."
  },
  "Export History": {
    title: "Export History",
    subtitle: "Track Azure DevOps Excel workbooks created from saved generations."
  },
  Settings: {
    title: "Settings",
    subtitle: "Review server-side provider settings and application configuration."
  }
};

type ShellHealth = {
  aiConfigured?: boolean;
  visionConfigured?: boolean;
  visionEnabled?: boolean;
  ocrFallbackEnabled?: boolean;
  model?: string;
} | null;

export function Shell({
  active,
  setActive,
  health,
  children
}: {
  active: string;
  setActive: (tab: string) => void;
  health?: ShellHealth;
  children: ReactNode;
}) {
  const copy = pageCopy[active] ?? pageCopy.Generate;
  const geminiReady = Boolean(health?.visionConfigured ?? health?.aiConfigured);
  const ocrReady = health?.ocrFallbackEnabled !== false;

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <div className="logo-mark"><FlaskConical size={34} aria-hidden /></div>
          <div>
            <strong>TestCraft AI</strong>
            <span>AI Test Case Generator</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(({ label, value, icon: Icon }) => (
            <button key={value} className={active === value ? "active" : ""} onClick={() => setActive(value)}>
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <section className="ai-card" aria-label="AI status">
          <strong>AI Status</strong>
          <span><i className={geminiReady ? "status-dot ready" : "status-dot warn"} />Gemini Vision <b>{geminiReady ? "Connected" : "Setup needed"}</b></span>
          <span><i className={ocrReady ? "status-dot ready" : "status-dot warn"} />OCR Fallback <b>{ocrReady ? "Enabled" : "Disabled"}</b></span>
          <span><FlaskConical size={14} aria-hidden />Mode <b>Vision-assisted</b></span>
        </section>

        <button className="user-card" type="button" aria-label="User menu">
          <span>AA</span>
          <div>
            <strong>Elixir-Hropal</strong>
            <small>Admin</small>
          </div>
          <ChevronDown size={17} aria-hidden />
        </button>
      </aside>

      <div className="app-main">
        <header className="workspace-header">
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
          <div className="workspace-actions">
            <button className="workspace-pill" type="button">
              <span>Workspace</span>
              <strong>Elixir-Hropal</strong>
              <ChevronDown size={16} aria-hidden />
            </button>
            <div className="connection-pill">
              <span>Gemini Vision</span>
              <strong><i className={geminiReady ? "status-dot ready" : "status-dot warn"} />{geminiReady ? "Connected" : "Unavailable"}</strong>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
