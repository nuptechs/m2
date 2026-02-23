# PermaCat - Code-to-Permission Catalog Generator

## Overview
PermaCat is an enterprise-grade static code intelligence tool designed to analyze frontend (Vue/React/Angular) and Spring Boot backend source code. Its primary purpose is to automatically generate a Technical Action Catalog for Identity and Access Management (IAM) systems. This tool aims to streamline the process of understanding and managing permissions by providing a comprehensive overview of technical operations derived directly from the codebase. The project envisions creating a comprehensive, editable catalog that bridges the gap between code implementation and IAM requirements, facilitating better security and compliance.

## User Preferences
I want iterative development. I expect you to ask clarifying questions about the implementation details and decisions. I prefer detailed explanations for complex parts of the code.

## System Architecture
The application features a frontend built with React, TypeScript, Shadcn UI, and TailwindCSS. The backend is powered by Express, TypeScript, Drizzle ORM, and PostgreSQL. A standalone JVM service, utilizing the JavaParser AST library, handles Spring Boot code analysis. Frontend analysis is performed using the TypeScript compiler API (React/JS/TS), `@vue/compiler-sfc` (Vue SFCs), and `@angular/compiler` (Angular templates). A Semantic Engine, powered by OpenAI LLM (via Replit AI Integrations), is used for classifying technical operations and assigning criticality scores.

Key features include ZIP repository upload for automatic scanning, individual file uploads, AST-based parsing of frontend interaction points and Java backend components (controllers, services, repositories, entities), and building a graph connecting frontend interactions to backend endpoints with full method tracing. The system supports backend-only catalog generation, an editable catalog with human classification support, and first-class manifest output generation.

A **Manifest Generation System** (`server/generators/`) produces four pipeline-ready output formats from catalog entries via `GET /api/manifest/:projectId?format=<format>`:
- **MANIFEST.json** (`manifest-generator.ts`): Structured, versionable catalog with endpoints, screens, roles, entities, and a security matrix. Schema-versioned with `$schema` field.
- **AGENTS.md** (`agents-md-generator.ts`): Auto-generated AI agent instructions file in the CLAUDE.md/AGENTS.md format adopted by 60k+ repositories. Contains roles/permissions tables, endpoint inventory, security gaps, high-criticality operations, and screen interaction maps.
- **OpenAPI 3.0.3 Spec** (`openapi-generator.ts`): API specification derived from code analysis, with `x-permacat` extensions for criticality, entities touched, and call chains. Includes entity schemas from JPA metadata.
- **Policy Matrix** (`policy-matrix-generator.ts`): Universal policy matrix plus provider-specific policies for Keycloak (realm/client/resources/permissions), Okta (groups/rules with assurance levels), and AWS IAM (per-role policy documents with ARN resources).

The Java Backend Analyzer uses JavaParser with JavaSymbolSolver for semantic AST analysis. The Frontend Analyzer, built in Node.js, uses framework-specific AST parsers to resolve handlers, trace HTTP calls, and identify HTTP client identifiers. It implements a multi-pass architecture for robust cross-file HTTP service resolution, local variable URL tracing, and global function call graph analysis, including an eight-tier HTTP resolution system (local, serviceMap, globalCallGraph, eventGraph, stateFlowGraph, architecturalLayerGraph, contextHook, dynamicImport). An Architectural Layer Graph provides symbol-first traversal for architectural climbing. The contextHook tier (confidence 0.90) traces React hook patterns like `const { login } = useAuth()` back through hook source files to find HTTP calls. The dynamicImport tier (confidence 0.88) resolves `await import()` patterns and traces method calls through the service map.

The system includes a `BaseURLRegistry` for resolving partial or relative URLs and a `Graph-Connector` architecture that relies solely on `resolutionPath` for deterministic controller resolution, avoiding heuristics. Endpoint matching uses a scoring system based on path segment similarity.

The enriched catalog model captures extensive metadata for each entry, including `resolutionPath` (structural truth of code path), `architectureType`, `interactionCategory`, `confidence`, `requiredRoles` (from Spring Security annotations), `securityAnnotations` (raw annotation data), `entityFieldsMetadata` (JPA entity field enrichment including validation and sensitivity), `sensitiveFieldsAccessed`, `frontendRoute`, and `routeGuards` (frontend and router-level security). Resolution metadata is propagated through the analysis chain and persisted.

Spring Security annotations (`@PreAuthorize`, `@Secured`, `@RolesAllowed`, etc.) are extracted from Java backend code, including SpEL expression parsing for role extraction. JPA entity fields are enriched with validation annotations and sensitivity detection. Frontend router definitions (Vue Router, React Router, Angular Router) are parsed to extract routes, components, and guards. The call graph resolution handles Promise `.then()` chains and inline arrow functions. URL resolution supports string concatenation, constant variable tracing, and property access tracing for dynamic URLs. Frontend security guard patterns (e.g., `hasRole` checks, `isAdmin` flags) are detected within handler functions.

A Gateway/Command Bus Resolution system extracts operation identifiers from HTTP call payloads to match against backend controllers, tagging entries as `WS_OPERATION_BASED` and storing `operationHint`. Programmatic security checks in Java method bodies are also detected. Deduplication uses a composite key to merge identical entries while preserving multiplicity. A development insights panel provides statistics on catalog generation.

An **Analysis Pipeline** (`server/pipeline/analysis-pipeline.ts`) encapsulates the full analysis workflow as a reusable class: graph construction → architecture detection → endpoint analysis → frontend interaction scanning → graph connection → deterministic classification → persistence → finalization. All three upload/analyze routes delegate to `AnalysisPipeline`, eliminating code duplication. The pipeline accepts a `ProgressCallback` for SSE streaming or console logging.

The pipeline includes **Hybrid Incremental Analysis** with in-memory caching per project. When a project is re-analyzed, the change detector computes SHA-256 hashes and compares them against cached hashes. If only frontend files changed, the backend graph is reused from cache (skipping the Java engine entirely). If only backend files changed, frontend interactions are reused. Both caches have a 30-minute TTL. Cache status is reported in the analysis result. Utility functions `clearProjectCache()` and `getCacheStats()` are exported for management.

The system constructs an in-memory Application Graph model, facilitating detailed traversal and impact analysis. Source file analysis, graph reconstruction, and catalog conversion lead to deterministic classification of `technicalOperation`, `criticalityScore`, and `suggestedMeaning`, with optional LLM enrichment. The deterministic classifier uses context-aware inference: HTTP method-based classification for entries with endpoints, and handler name pattern analysis for frontend-only entries (CLIENT_STATE for set*/toggle*/show*/hide* patterns, AUTHENTICATION for login/register/auth patterns, NAVIGATION for routing patterns, FILE_IO for upload/download patterns).

A **Manifest Diff Engine** (`server/diff/manifest-diff-engine.ts`) compares two analysis snapshots to produce structured diffs covering endpoints (added/removed/modified), screens, roles, entities, and security impact. The engine computes security impact levels (none/low/medium/high/critical) based on new unprotected endpoints, removed protections, and criticality increases. Analysis snapshots are auto-saved after each pipeline run in the `analysis_snapshots` table, storing the full MANIFEST.json for each run. API endpoints: `GET /api/projects/:projectId/diff?runA=<id>&runB=<id>` for specific run comparison, `GET /api/projects/:projectId/diff/latest` for last-two-runs comparison, and `GET /api/projects/:projectId/snapshots` for listing available snapshots. A **Diff Viewer** page (`/diff`) provides a visual interface for selecting projects and runs to compare, with color-coded change summaries and security impact panels.

A **Change Detector** (`server/pipeline/change-detector.ts`) computes SHA-256 hashes of file content and categorizes changes as backend-only, frontend-only, or both. The `source_files` table includes a `contentHash` column for tracking file changes across analysis runs. This supports the hybrid incremental analysis strategy: if only frontend files changed, the backend graph is reused from cache, and vice-versa.

A **Git Integration System** (`server/git/`) provides first-class support for GitHub and GitLab repositories:
- **Git Provider Abstraction** (`git-provider.ts`): Common interface (`IGitProvider`) for fetching branches, file trees, file content, pull requests, and PR diffs. Factory function `createGitProvider()` dynamically loads the correct provider. Includes URL parsing for both HTTPS and SSH repo URLs.
- **GitHub Provider** (`github-provider.ts`): Full GitHub REST API v3 implementation with batch file fetching (20 concurrent), recursive tree listing, and PR diff analysis.
- **GitLab Provider** (`gitlab-provider.ts`): Full GitLab API v4 implementation with pagination support, self-hosted instance detection, and merge request diff parsing.
- **API Endpoints**: `POST /api/projects/:id/git/connect` (connect repo with token validation), `GET /api/projects/:id/git/branches`, `GET /api/projects/:id/git/pull-requests`, `GET /api/projects/:id/git/status`, `DELETE /api/projects/:id/git/disconnect`, `POST /api/projects/:id/analyze-branch` (fetch + analyze via SSE), `POST /api/projects/:id/analyze-pr` (dual-branch analysis with automatic manifest diff).
- **PR Analysis Workflow**: Fetches both base and head branch files, runs full analysis on each, then computes manifest diff to produce a security-focused PR report showing added/removed endpoints, role changes, and security impact.
- Project schema extended with `gitProvider`, `gitRepoUrl`, `gitDefaultBranch`, `gitTokenRef` columns. Tokens stored in-memory map (server-scoped).

A **System Explorer** page (`/insights`) provides a visual map of the analyzed system, separate from the Action Catalog. It groups catalog entries by screen (component/route), displaying each screen as a card with categorized interaction blocks (forms, actions, data loading, navigation, links, API calls). Each interaction block is clickable, opening a slide-out Trace Panel that shows the full resolution path step-by-step: Frontend Interaction → HTTP Call → Controller → Service Layer → Repository/Persistence → Entities Touched, with metadata at each step (security annotations, required roles, sensitive fields, entity field details, route guards, criticality score). Filters by operation type, backend/frontend scope, and search across screens/interactions/endpoints are supported. Summary statistics show total screens, interactions, endpoints, backend coverage, and average criticality.

## External Dependencies
- PostgreSQL
- OpenAI LLM (via Replit AI Integrations)
- Java JDK 17
- Maven
- Node.js 20
- `JavaParser` library with `JavaSymbolSolver`
- `@vue/compiler-sfc`
- `@angular/compiler`
- `adm-zip`
- `multer`