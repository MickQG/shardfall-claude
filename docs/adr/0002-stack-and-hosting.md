# ADR 0002: Stack and hosting

**Status:** accepted

**Decision.** TypeScript, Vite, PixiJS v8, Vitest, Playwright. Static bundle hosted on Azure Static Web Apps (Free). Installable PWA first; a Tauri wrapper is a possible later milestone.

**Why.** GPU 2D rendering with shaders and filters gives strong visuals; the same static bundle runs on the web and in a desktop wrapper; free hosting with PR previews fits the spec-driven workflow.
