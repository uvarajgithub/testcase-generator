# TestCraft AI

TestCraft AI is a local-first QA engineering workspace that turns acceptance criteria, screenshot findings, and business rules into traceable editable test cases and a formatted Excel workbook.

## Run locally

```powershell
npm.cmd install
npm.cmd run server
npm.cmd run dev
```

The browser app runs on `http://127.0.0.1:5174` and proxies API calls to `http://127.0.0.1:8787`.

## Validation

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run lint
npm.cmd run test:e2e
```

AI credentials are optional. Without `AI_API_KEY`, the app uses the provider-independent manual/fallback generator and clearly labels assumptions.
