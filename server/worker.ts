import { calculateCoverage, generateCases, inferElementsFromRequirement, newGenerationId, parseAcceptanceCriteria } from "../src/lib/analysis";
import { generationConfigSchema, generationSchema, requirementSchema, type Generation } from "../src/lib/schemas";
import { buildFilename, buildRefinedWorkbook, buildWorkbook, type AzureExportConfig } from "./lib/excel";
import { buildHtmlFilename, buildHtmlReport } from "./lib/html";
import { STATIC_ASSETS } from "./generated-assets";
import { analyseScreenshots, publicVisionStatus } from "./lib/vision";
import { buildCoverageReviewWorkbook, reviewExistingCoverage } from "./lib/coverageReview";

type Env = Record<string, unknown>;
type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };

const generations: Generation[] = [];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return json({ ok: true, data: null }, 204);
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({ ok: true, data: { status: "ok", aiConfigured: false, ...publicVisionStatus(env) } });
      }

      if (request.method === "POST" && url.pathname === "/api/screenshots") {
        const form = await request.formData();
        const files = form.getAll("screenshots").filter((item): item is File => item instanceof File);
        return json({
          ok: true,
          data: {
            screenshots: files.map((file, index) => ({
              id: `SS-${String(index + 1).padStart(3, "0")}-${Date.now()}`,
              filename: file.name,
              mimeType: file.type || "image/png",
              size: file.size,
              reference: `Screenshot ${index + 1}`
            }))
          }
        });
      }

      if (request.method === "POST" && url.pathname === "/api/screenshots/analyse") {
        const form = await request.formData();
        const requirement = requirementSchema.parse(JSON.parse(String(form.get("requirement") ?? "{}")));
        const files = form.getAll("screenshots").filter((item): item is File => item instanceof File);
        const screenshots = await Promise.all(files.map(async (file, index) => ({
          id: `SS-${String(index + 1).padStart(3, "0")}-${Date.now()}`,
          filename: file.name,
          mimeType: file.type || "image/png",
          data: new Uint8Array(await file.arrayBuffer())
        })));
        const data = await analyseScreenshots({
          requirement,
          screenshots,
          userStory: String(form.get("userStory") ?? ""),
          additionalContext: String(form.get("additionalContext") ?? ""),
          userCorrections: String(form.get("userCorrections") ?? ""),
          env
        });
        return json({ ok: true, data });
      }

      if (request.method === "POST" && url.pathname === "/api/refine-existing-excel") {
        const form = await request.formData();
        const file = form.get("workbook");
        if (!(file instanceof File)) return json(fail("UPLOAD_VALIDATION", "Upload an existing test-case Excel file."), 400);
        if (!/\.(xlsx|xls)$/i.test(file.name)) return json(fail("UPLOAD_VALIDATION", "Upload an Excel workbook as .xlsx or .xls."), 400);
        const result = await buildRefinedWorkbook(await file.arrayBuffer(), file.name);
        return new Response(result.buffer, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${result.filename}"`
          }
        });
      }

      if (request.method === "POST" && url.pathname === "/api/review-existing-coverage") {
        const form = await request.formData();
        const file = form.get("workbook");
        if (!(file instanceof File)) return json(fail("UPLOAD_VALIDATION", "Upload an existing test-case Excel file."), 400);
        if (!/\.(xlsx|xls)$/i.test(file.name)) return json(fail("UPLOAD_VALIDATION", "Upload an Excel workbook as .xlsx or .xls."), 400);
        const requirement = requirementSchema.parse(JSON.parse(String(form.get("requirement") ?? "{}")));
        const review = await reviewExistingCoverage(await file.arrayBuffer(), requirement, file.name);
        return json({ ok: true, data: { review } });
      }

      if (request.method === "POST" && url.pathname === "/api/review-existing-coverage/export") {
        const form = await request.formData();
        const file = form.get("workbook");
        if (!(file instanceof File)) return json(fail("UPLOAD_VALIDATION", "Upload an existing test-case Excel file."), 400);
        if (!/\.(xlsx|xls)$/i.test(file.name)) return json(fail("UPLOAD_VALIDATION", "Upload an Excel workbook as .xlsx or .xls."), 400);
        const requirement = requirementSchema.parse(JSON.parse(String(form.get("requirement") ?? "{}")));
        const mode = String(form.get("mode") ?? "suggested-only") === "merge-with-existing" ? "merge-with-existing" : "suggested-only";
        const result = await buildCoverageReviewWorkbook(await file.arrayBuffer(), requirement, mode, file.name);
        return new Response(result.buffer, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${result.filename}"`
          }
        });
      }

      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const body = await request.json() as { requirement: unknown; screenshots?: Array<{ id: string; filename: string }> };
        const requirement = requirementSchema.parse(body.requirement);
        const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
        const detectedElements = inferElementsFromRequirement(requirement, body.screenshots ?? []);
        const warnings = criteria.flatMap((criterion) => criterion.warnings);
        const assumptions = [...criteria.flatMap((criterion) => criterion.assumptions), ...detectedElements.map((el) => el.assumption).filter(Boolean)];
        return json({ ok: true, data: { criteria, detectedElements, warnings, assumptions, ambiguities: warnings } });
      }

      if (request.method === "POST" && url.pathname === "/api/generations") {
        const body = await request.json() as Partial<Generation>;
        const requirement = requirementSchema.parse(body.requirement);
        const config = generationConfigSchema.parse(body.config);
        const criteria = body.criteria?.length ? body.criteria : parseAcceptanceCriteria(requirement.acceptanceCriteria);
        const now = new Date().toISOString();
        const draft = generationSchema.parse({
          id: body.id ?? newGenerationId(),
          requirement,
          criteria,
          screenshots: body.screenshots ?? [],
          detectedElements: body.detectedElements ?? [],
          config,
          testCases: [],
          assumptions: body.assumptions ?? ["AI provider not configured; deterministic fallback generation was used."],
          ambiguities: body.ambiguities ?? [],
          warnings: body.warnings ?? [],
          createdAt: body.createdAt ?? now,
          updatedAt: now,
          exportHistory: body.exportHistory ?? []
        });
        draft.testCases = body.testCases?.length ? body.testCases : generateCases(draft);
        upsertGeneration(draft);
        return json({ ok: true, data: { generation: draft, coverage: calculateCoverage(draft) } });
      }

      if (request.method === "GET" && url.pathname === "/api/generations") {
        return json({ ok: true, data: { generations } });
      }

      if (request.method === "PUT" && url.pathname.startsWith("/api/generations/")) {
        const id = url.pathname.split("/")[3];
        const body = await request.json() as Generation;
        const generation = generationSchema.parse({ ...body, id, updatedAt: new Date().toISOString() });
        upsertGeneration(generation);
        return json({ ok: true, data: { generation, coverage: calculateCoverage(generation) } });
      }

      if (request.method === "POST" && url.pathname.match(/^\/api\/generations\/[^/]+\/export$/)) {
        const id = url.pathname.split("/")[3];
        const generation = generations.find((item) => item.id === id);
        if (!generation) return json(fail("NOT_FOUND", "Generation was not found."), 404);
        const exportConfig = await request.json().catch(() => ({})) as AzureExportConfig;
        const filename = buildFilename(generation);
        const buffer = await buildWorkbook(generation, generations.filter((item) => item.id !== id), exportConfig);
        generation.exportHistory.push({ filename, exportedAt: new Date().toISOString() });
        upsertGeneration(generation);
        return new Response(buffer, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${filename}"`
          }
        });
      }

      if (request.method === "POST" && url.pathname.match(/^\/api\/generations\/[^/]+\/html$/)) {
        const id = url.pathname.split("/")[3];
        const generation = generations.find((item) => item.id === id);
        if (!generation) return json(fail("NOT_FOUND", "Generation was not found."), 404);
        const filename = buildHtmlFilename(generation);
        return new Response(buildHtmlReport(generation, generations.filter((item) => item.id !== id)), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-disposition": `inline; filename="${filename}"`
          }
        });
      }

      if (url.pathname.startsWith("/api/")) return json(fail("NOT_FOUND", "The requested API route does not exist."), 404);
      return serveAsset(request);
    } catch (error) {
      return json(fail("REQUEST_FAILED", error instanceof Error ? error.message : "Unexpected server error."), 400);
    }
  }
};

async function serveAsset(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const asset = STATIC_ASSETS[path] ?? (!path.includes(".") ? STATIC_ASSETS["/index.html"] : undefined);
  if (!asset) return new Response("Not found", { status: 404 });
  const isAppShell = path === "/index.html" || !path.includes(".");
  return new Response(asset.content, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": isAppShell ? "no-store, no-cache, must-revalidate" : "public, max-age=31536000, immutable"
    }
  });
}

function upsertGeneration(generation: Generation) {
  const index = generations.findIndex((item) => item.id === generation.id);
  if (index >= 0) generations[index] = generation;
  else generations.unshift(generation);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function fail(code: string, message: string, details?: unknown): ApiFailure {
  return { ok: false, error: { code, message, details } };
}
