import type { AcceptanceCriterion, CoverageSummary, DetectedElement, Generation, GenerationConfig, RequirementInput } from "./schemas";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers } });
  if (response.headers.get("content-type")?.includes("json")) {
    const body = (await response.json()) as ApiResponse<T>;
    if (!body.ok) throw new Error(body.error.message);
    return body.data;
  }
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response as T;
}

export const api = {
  health: () => request<{ status: string; aiConfigured: boolean }>("/api/health"),
  uploadScreenshots: async (files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append("screenshots", file));
    return request<{ screenshots: Generation["screenshots"] }>("/api/screenshots", { method: "POST", body: form });
  },
  analyze: (requirement: RequirementInput, screenshots: Generation["screenshots"]) =>
    request<{ criteria: AcceptanceCriterion[]; detectedElements: DetectedElement[]; warnings: string[]; assumptions: string[]; ambiguities: string[] }>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ requirement, screenshots })
    }),
  saveGeneration: (payload: Partial<Generation> & { requirement: RequirementInput; config: GenerationConfig }) =>
    request<{ generation: Generation; coverage: CoverageSummary }>("/api/generations", { method: "POST", body: JSON.stringify(payload) }),
  updateGeneration: (generation: Generation) =>
    request<{ generation: Generation; coverage: CoverageSummary }>(`/api/generations/${generation.id}`, { method: "PUT", body: JSON.stringify(generation) }),
  generations: () => request<{ generations: Generation[] }>("/api/generations"),
  templates: () => request<{ templates: Array<{ id: string; name: string; platform: string; selectedTypes: string[]; instructions: string }> }>("/api/templates"),
  settings: () => request<{ settings: Record<string, unknown>; aiConfigured: boolean }>("/api/settings"),
  exportExcel: async (generationId: string, config?: { areaPath?: string; assignedTo?: string; state?: string }) => {
    const response = await fetch(`/api/generations/${generationId}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(config ?? {}) });
    if (!response.ok) throw new Error("Excel export failed.");
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "TestCraft_Test_Cases.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    return filename;
  },
  refineExistingExcel: async (file: File) => {
    const form = new FormData();
    form.append("workbook", file);
    const response = await fetch("/api/refine-existing-excel", { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiResponse<unknown> | null;
      throw new Error(body && !body.ok ? body.error.message : "Existing test-case refinement failed.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "Refined_Azure_DevOps_Test_Cases.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    return filename;
  },
  openHtml: async (generationId: string) => {
    const response = await fetch(`/api/generations/${generationId}/html`, { method: "POST" });
    if (!response.ok) throw new Error("HTML report export failed.");
    const html = await response.text();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};
