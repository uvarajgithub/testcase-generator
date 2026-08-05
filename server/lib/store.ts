import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Generation } from "../../src/lib/schemas";

const dataDir = join(process.cwd(), "server", "data");
const dbPath = join(dataDir, "db.json");

type Db = {
  generations: Generation[];
  archivedTestCaseIds: string[];
  templates: Array<{ id: string; name: string; platform: string; selectedTypes: string[]; instructions: string }>;
  settings: Record<string, unknown>;
};

const defaultDb: Db = {
  generations: [],
  archivedTestCaseIds: [],
  templates: [
    { id: "tpl-web", name: "Web application", platform: "Web", selectedTypes: ["Positive", "Negative", "Edge", "UI", "Accessibility", "Responsive"], instructions: "Cover form, navigation, validation, responsive, and browser behavior." },
    { id: "tpl-mobile", name: "Mobile application", platform: "Mobile", selectedTypes: ["Positive", "Negative", "Edge", "UI", "Accessibility", "Responsive"], instructions: "Cover touch input, device sizes, offline/interrupted flows, and mobile accessibility." },
    { id: "tpl-api", name: "API", platform: "API", selectedTypes: ["Positive", "Negative", "Edge", "Validation", "Security", "Integration"], instructions: "Cover payload schemas, status codes, auth, retries, idempotency, and dependency failures." },
    { id: "tpl-form", name: "Form validation", platform: "Web", selectedTypes: ["Positive", "Negative", "Edge", "Validation", "UI", "Accessibility"], instructions: "Cover required, optional, boundary, format, duplicate, and special-character inputs." },
    { id: "tpl-login", name: "Login and authentication", platform: "Web", selectedTypes: ["Positive", "Negative", "Edge", "Validation", "Security", "Accessibility"], instructions: "Cover credentials, lockout, recovery, roles, sessions, unauthorized access, and secure errors." },
    { id: "tpl-ecomm", name: "E-commerce", platform: "Web", selectedTypes: ["Positive", "Negative", "Edge", "Validation", "UI", "Security", "Integration"], instructions: "Cover catalog, cart, checkout, payment dependencies, inventory, discounts, and failure recovery." },
    { id: "tpl-finance", name: "Banking or finance", platform: "Web", selectedTypes: ["Positive", "Negative", "Edge", "Validation", "Security", "Integration"], instructions: "Cover authorization, auditability, limits, masked data, dual control, and transaction reversals." },
    { id: "tpl-regression", name: "Regression testing", platform: "Other", selectedTypes: ["Positive", "Negative", "Edge", "UI", "Integration"], instructions: "Cover critical happy paths, changed areas, affected dependencies, and prior defect patterns." }
  ],
  settings: {
    aiProvider: "manual",
    model: "",
    defaultCategories: ["Positive", "Negative", "Edge"],
    defaultDetailLevel: "Standard",
    organizationName: "",
    dateFormat: "YYYY-MM-DD",
    timeZone: "Asia/Calcutta",
    theme: "Light"
  }
};

export async function readDb(): Promise<Db> {
  await mkdir(dataDir, { recursive: true });
  try {
    return { ...defaultDb, ...JSON.parse(await readFile(dbPath, "utf8")) };
  } catch {
    await writeDb(defaultDb);
    return defaultDb;
  }
}

export async function writeDb(db: Db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export async function upsertGeneration(generation: Generation) {
  const db = await readDb();
  const idx = db.generations.findIndex((item) => item.id === generation.id);
  if (idx >= 0) db.generations[idx] = generation;
  else db.generations.unshift(generation);
  await writeDb(db);
}
