import { createServer } from "node:http";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import multer, { type MulterError } from "multer";
import { requirementSchema, generationConfigSchema, detectedElementSchema, testCaseSchema, generationSchema, type Generation } from "../src/lib/schemas";
import { calculateCoverage, generateCases, inferElementsFromRequirement, newGenerationId, parseAcceptanceCriteria } from "../src/lib/analysis";
import { ApiFailure, readJson, sanitizeFilename, sendJson } from "./lib/http";
import { readDb, upsertGeneration, writeDb } from "./lib/store";
import { buildFilename, buildRefinedWorkbook, buildWorkbook, type AzureExportConfig } from "./lib/excel";
import { buildHtmlFilename, buildHtmlReport } from "./lib/html";
import { analyseScreenshots, publicVisionStatus } from "./lib/vision";
import { buildCoverageReviewWorkbook, reviewExistingCoverage } from "./lib/coverageReview";

const port = Number(process.env.PORT ?? 8787);
const uploadDir = join(process.cwd(), "server", "data", "uploads");
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB ?? 8) * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`)
  }),
  limits: { fileSize: maxUploadBytes, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) cb(new Error("Unsupported image type. Upload PNG, JPG, JPEG, or WebP files."));
    else cb(null, true);
  }
});

const workbookUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) cb(new Error("Upload an Excel workbook as .xlsx or .xls."));
    else cb(null, true);
  }
});

const analysisUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) cb(new Error("Unsupported image type. Upload PNG, JPG, JPEG, or WebP files."));
    else cb(null, true);
  }
});

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, 204, { ok: true, data: null });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, data: { status: "ok", aiConfigured: Boolean(process.env.AI_API_KEY), ...publicVisionStatus() } });
    }

    if (req.method === "POST" && url.pathname === "/api/screenshots") {
      return upload.array("screenshots")(req as never, res as never, (err: unknown) => {
        if (err) return sendJson(res, 400, fail("UPLOAD_VALIDATION", (err as MulterError).message));
        const files = ((req as unknown as { files?: Array<{ originalname: string; mimetype: string; size: number; path: string }> }).files ?? []).map((file, index) => ({
          id: `SS-${String(index + 1).padStart(3, "0")}-${Date.now()}`,
          filename: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
          reference: `Screenshot ${index + 1}`
        }));
        sendJson(res, 200, { ok: true, data: { screenshots: files } });
      });
    }

    if (req.method === "POST" && url.pathname === "/api/screenshots/analyse") {
      return analysisUpload.array("screenshots")(req as never, res as never, async (err: unknown) => {
        if (err) return sendJson(res, 400, fail("UPLOAD_VALIDATION", (err as MulterError).message));
        try {
          const body = (req as unknown as { body?: Record<string, string>; files?: Array<{ originalname: string; mimetype: string; buffer: Buffer }> }).body ?? {};
          const requirement = requirementSchema.parse(JSON.parse(body.requirement || "{}"));
          const files = ((req as unknown as { files?: Array<{ originalname: string; mimetype: string; buffer: Buffer }> }).files ?? []).map((file, index) => ({
            id: `SS-${String(index + 1).padStart(3, "0")}-${Date.now()}`,
            filename: file.originalname,
            mimeType: file.mimetype,
            data: new Uint8Array(file.buffer)
          }));
          const data = await analyseScreenshots({
            requirement,
            screenshots: files,
            userStory: body.userStory,
            additionalContext: body.additionalContext,
            userCorrections: body.userCorrections
          });
          return sendJson(res, 200, { ok: true, data });
        } catch (error) {
          return sendJson(res, 400, fail("SCREENSHOT_ANALYSIS_FAILED", error instanceof Error ? error.message : "Screenshot analysis failed."));
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/refine-existing-excel") {
      return workbookUpload.single("workbook")(req as never, res as never, async (err: unknown) => {
        if (err) return sendJson(res, 400, fail("UPLOAD_VALIDATION", (err as MulterError).message));
        const file = (req as unknown as { file?: { originalname: string; path: string } }).file;
        if (!file) return sendJson(res, 400, fail("UPLOAD_VALIDATION", "Upload an existing test-case Excel file."));
        try {
          const source = await readFile(file.path);
          const result = await buildRefinedWorkbook(source, file.originalname);
          await unlink(file.path).catch(() => undefined);
          res.writeHead(200, {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${result.filename}"`,
            "access-control-allow-origin": "*"
          });
          return res.end(Buffer.from(result.buffer));
        } catch (error) {
          await unlink(file.path).catch(() => undefined);
          return sendJson(res, 400, fail("REFINE_FAILED", error instanceof Error ? error.message : "Existing test-case refinement failed."));
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/review-existing-coverage") {
      return workbookUpload.single("workbook")(req as never, res as never, async (err: unknown) => {
        if (err) return sendJson(res, 400, fail("UPLOAD_VALIDATION", (err as MulterError).message));
        const file = (req as unknown as { file?: { originalname: string; path: string }; body?: Record<string, string> }).file;
        const body = (req as unknown as { body?: Record<string, string> }).body ?? {};
        if (!file) return sendJson(res, 400, fail("UPLOAD_VALIDATION", "Upload an existing test-case Excel file."));
        try {
          const requirement = requirementSchema.parse(JSON.parse(body.requirement || "{}"));
          const source = await readFile(file.path);
          const review = await reviewExistingCoverage(source, requirement, file.originalname);
          await unlink(file.path).catch(() => undefined);
          return sendJson(res, 200, { ok: true, data: { review } });
        } catch (error) {
          await unlink(file.path).catch(() => undefined);
          return sendJson(res, 400, fail("REVIEW_FAILED", error instanceof Error ? error.message : "Coverage review failed."));
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/review-existing-coverage/export") {
      return workbookUpload.single("workbook")(req as never, res as never, async (err: unknown) => {
        if (err) return sendJson(res, 400, fail("UPLOAD_VALIDATION", (err as MulterError).message));
        const file = (req as unknown as { file?: { originalname: string; path: string }; body?: Record<string, string> }).file;
        const body = (req as unknown as { body?: Record<string, string> }).body ?? {};
        if (!file) return sendJson(res, 400, fail("UPLOAD_VALIDATION", "Upload an existing test-case Excel file."));
        try {
          const requirement = requirementSchema.parse(JSON.parse(body.requirement || "{}"));
          const mode = body.mode === "merge-with-existing" ? "merge-with-existing" : "suggested-only";
          const source = await readFile(file.path);
          const result = await buildCoverageReviewWorkbook(source, requirement, mode, file.originalname);
          await unlink(file.path).catch(() => undefined);
          res.writeHead(200, {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${result.filename}"`
          });
          return res.end(Buffer.from(result.buffer));
        } catch (error) {
          await unlink(file.path).catch(() => undefined);
          return sendJson(res, 400, fail("COVERAGE_EXPORT_FAILED", error instanceof Error ? error.message : "Coverage review Excel export failed."));
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJson<{ requirement: unknown; screenshots?: Array<{ id: string; filename: string; mimeType: string; size: number; reference: string }> }>(req);
      const requirement = requirementSchema.parse(body.requirement);
      const criteria = parseAcceptanceCriteria(requirement.acceptanceCriteria);
      const detectedElements = inferElementsFromRequirement(requirement, body.screenshots ?? []);
      const warnings = criteria.flatMap((criterion) => criterion.warnings);
      const assumptions = [...criteria.flatMap((criterion) => criterion.assumptions), ...detectedElements.map((el) => el.assumption).filter(Boolean)];
      return sendJson(res, 200, { ok: true, data: { criteria, detectedElements, warnings, assumptions, ambiguities: warnings } });
    }

    if (req.method === "POST" && url.pathname === "/api/generations") {
      const body = await readJson<Partial<Generation>>(req);
      const requirement = requirementSchema.parse(body.requirement);
      const config = generationConfigSchema.parse(body.config);
      const criteria = body.criteria?.length ? body.criteria : parseAcceptanceCriteria(requirement.acceptanceCriteria);
      const detectedElements = (body.detectedElements ?? []).map((item) => detectedElementSchema.parse(item));
      const now = new Date().toISOString();
      const draft: Generation = generationSchema.parse({
        id: body.id ?? newGenerationId(),
        requirement,
        criteria,
        screenshots: body.screenshots ?? [],
        detectedElements,
        config,
        testCases: [],
        assumptions: body.assumptions ?? ["AI provider not configured; deterministic fallback generation was used."],
        ambiguities: body.ambiguities ?? [],
        warnings: body.warnings ?? [],
        createdAt: body.createdAt ?? now,
        updatedAt: now,
        exportHistory: body.exportHistory ?? []
      });
      draft.testCases = body.testCases?.length ? body.testCases.map((tc) => testCaseSchema.parse(tc)) : generateCases(draft);
      await upsertGeneration(draft);
      return sendJson(res, 200, { ok: true, data: { generation: draft, coverage: calculateCoverage(draft) } });
    }

    if (req.method === "POST" && url.pathname === "/api/generations/export") {
      const body = await readJson<{ generation?: Generation; config?: AzureExportConfig }>(req);
      if (!body.generation) return sendJson(res, 400, fail("UPLOAD_VALIDATION", "Generation payload is required for Excel export."));
      const generation = generationSchema.parse(body.generation);
      const filename = buildFilename(generation);
      const buffer = await buildWorkbook(generation, [], body.config ?? {});
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`
      });
      return res.end(Buffer.from(buffer));
    }

    if (req.method === "POST" && url.pathname === "/api/generations/html") {
      const body = await readJson<{ generation?: Generation; previousGenerations?: Generation[] }>(req);
      if (!body.generation) return sendJson(res, 400, fail("UPLOAD_VALIDATION", "Generation payload is required for HTML export."));
      const generation = generationSchema.parse(body.generation);
      const previousGenerations = (body.previousGenerations ?? []).map((item) => generationSchema.parse(item));
      const filename = buildHtmlFilename(generation);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${filename}"`
      });
      return res.end(buildHtmlReport(generation, previousGenerations));
    }

    if (req.method === "GET" && url.pathname === "/api/generations") {
      const db = await readDb();
      return sendJson(res, 200, { ok: true, data: { generations: db.generations } });
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/generations/")) {
      const id = url.pathname.split("/")[3];
      const body = await readJson<Generation>(req);
      const generation = generationSchema.parse({ ...body, id, updatedAt: new Date().toISOString() });
      await upsertGeneration(generation);
      return sendJson(res, 200, { ok: true, data: { generation, coverage: calculateCoverage(generation) } });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/generations\/[^/]+\/export$/)) {
      const id = url.pathname.split("/")[3];
      const exportConfig = await readJson<AzureExportConfig>(req).catch(() => ({}));
      const db = await readDb();
      const generation = db.generations.find((item) => item.id === id);
      if (!generation) return sendJson(res, 404, fail("NOT_FOUND", "Generation was not found."));
      const filename = buildFilename(generation);
      const previousGenerations = db.generations.filter((item) => item.id !== id);
      const buffer = await buildWorkbook(generation, previousGenerations, exportConfig);
      generation.exportHistory.push({ filename, exportedAt: new Date().toISOString() });
      await upsertGeneration(generation);
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "access-control-allow-origin": "*"
      });
      return res.end(Buffer.from(buffer));
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/generations\/[^/]+\/html$/)) {
      const id = url.pathname.split("/")[3];
      const db = await readDb();
      const generation = db.generations.find((item) => item.id === id);
      if (!generation) return sendJson(res, 404, fail("NOT_FOUND", "Generation was not found."));
      const filename = buildHtmlFilename(generation);
      const html = buildHtmlReport(generation, db.generations.filter((item) => item.id !== id));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${filename}"`,
        "access-control-allow-origin": "*"
      });
      return res.end(html);
    }

    if (req.method === "GET" && url.pathname === "/api/coverage") {
      const db = await readDb();
      const generation = db.generations.find((item) => item.id === url.searchParams.get("generationId"));
      if (!generation) return sendJson(res, 404, fail("NOT_FOUND", "Generation was not found."));
      return sendJson(res, 200, { ok: true, data: { coverage: calculateCoverage(generation) } });
    }

    if (req.method === "GET" && url.pathname === "/api/templates") {
      const db = await readDb();
      return sendJson(res, 200, { ok: true, data: { templates: db.templates } });
    }

    if (req.method === "PUT" && url.pathname === "/api/templates") {
      const body = await readJson<{ templates: Awaited<ReturnType<typeof readDb>>["templates"] }>(req);
      const db = await readDb();
      db.templates = body.templates;
      await writeDb(db);
      return sendJson(res, 200, { ok: true, data: { templates: db.templates } });
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      const db = await readDb();
      return sendJson(res, 200, { ok: true, data: { settings: db.settings, aiConfigured: Boolean(process.env.AI_API_KEY), ...publicVisionStatus() } });
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readJson<Record<string, unknown>>(req);
      const db = await readDb();
      db.settings = { ...db.settings, ...body, apiKey: undefined };
      await writeDb(db);
      return sendJson(res, 200, { ok: true, data: { settings: db.settings } });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/screenshots/")) {
      const filePath = url.searchParams.get("path");
      if (filePath?.startsWith(uploadDir)) await unlink(filePath).catch(() => undefined);
      return sendJson(res, 200, { ok: true, data: { removed: true } });
    }

    return sendJson(res, 404, fail("NOT_FOUND", "The requested API route does not exist."));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(res, 400, fail("REQUEST_FAILED", message));
  }
});

function fail(code: string, message: string, details?: unknown): ApiFailure {
  return { ok: false, error: { code, message, details } };
}

server.listen(port, "127.0.0.1", () => {
  console.log(`TestCraft AI API listening on http://127.0.0.1:${port}`);
});
