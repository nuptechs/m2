# PermaCat - Code-to-Permission Catalog Generator

## Overview
PermaCat is an enterprise-grade static code intelligence tool designed to analyze frontend (Vue/React/Angular) and Spring Boot backend source code. Its primary purpose is to automatically generate a Technical Action Catalog for Identity and Access Management (IAM) systems. This tool aims to streamline the process of understanding and managing permissions by providing a comprehensive overview of technical operations derived directly from the codebase.

## User Preferences
I want iterative development. I expect you to ask clarifying questions about the implementation details and decisions. I prefer detailed explanations for complex parts of the code.

## System Architecture
The application features a frontend built with React, TypeScript, Shadcn UI, and TailwindCSS. The backend is powered by Express, TypeScript, Drizzle ORM, and PostgreSQL. A standalone JVM service, utilizing the JavaParser AST library, handles Spring Boot code analysis. Frontend analysis is performed using the TypeScript compiler API (React/JS/TS), `@vue/compiler-sfc` (Vue SFCs), and `@angular/compiler` (Angular templates). A Semantic Engine, powered by OpenAI LLM (via Replit AI Integrations), is used for classifying technical operations and assigning criticality scores.

Key features include ZIP repository upload for automatic scanning, individual file uploads, AST-based parsing of frontend interaction points and Java backend components (controllers, services, repositories, entities), and building a graph connecting frontend interactions to backend endpoints with full method tracing. The system supports backend-only catalog generation, an editable catalog with human classification support, and JSON export.

The Java Backend Analyzer uses JavaParser with JavaSymbolSolver for semantic AST analysis, resolving method calls, and tracing repository-to-entity relationships via generics. It runs as an HTTP service, auto-started by the Node.js client. The Frontend Analyzer, built in Node.js, uses framework-specific AST parsers to resolve handlers, trace HTTP calls, and identify HTTP client identifiers. It implements a two-pass architecture for cross-file HTTP service resolution, handling imported functions and local variable URL tracing.

The system constructs an in-memory Application Graph model to represent the backend, with `GraphNode` and `GraphEdge` objects, allowing for detailed traversal and impact analysis per controller endpoint. The data flow involves storing uploaded source files, analyzing them with both Java and Node.js engines, reconstructing the Application Graph, generating `EndpointImpact` objects, and then converting `FrontendInteractions` into catalog entries. A deterministic classifier assigns `technicalOperation`, `criticalityScore`, and `suggestedMeaning` based on predefined rules, with an optional LLM enrichment step for refinement. The system also includes a robust repository scanner for ZIP file processing, handling large files efficiently by ignoring irrelevant directories and supporting chunked uploads to bypass size limitations.

## Frontend Analyzer Details

### Cross-File HTTP Service Resolution (Two-Pass Architecture)
- **Pass 1 — HttpServiceMap**: Pre-scan ALL source files to build a global map of exported functions/methods that contain HTTP calls
  - `HttpServiceMap`: `Map<filePath, Map<exportName, HttpServiceEntry>>` where entry = `{url, method, functionName}`
  - Scans function declarations, arrow functions, class methods for HTTP call expressions
  - Tracks class inheritance: `extends` clauses merge parent HTTP methods into child classes
  - Handles default exports, named exports, and class method exports with multiple key prefixes (`className.method`, `default.method`, `exportName.method`)
- **Pass 2 — Import Resolution**: When single-file `traceHttpCalls` returns no results, resolves via cross-file imports
  - `resolveImportedServiceMap(fileImports, httpServiceMap)` maps import specifiers to service entries
  - Supports `@/` alias resolution (maps to `src/` directory) and relative path resolution
  - `resolveBindingsViaNodes(bindings, resolvedImports)` performs transitive call graph traversal: traces handler → imported function → HTTP call
  - Depth-limited to 5 levels to prevent cycles
- **Local Variable URL Tracing**: `resolveUrlFromExpression` recursively resolves identifiers in template literals, binary expressions, and call expressions
  - Template expressions: resolves each span identifier via `varMap` before substituting `{param}`
  - `buildEndpoint()` / `buildUrl()` pattern: extracts string arguments → `{base}/operation`
  - BaseApiService pattern: `buildEndpoint('create', true)` → `{base}/create`, enabling 100% match rate to WS operation controllers
- **Architecture detection** (`architecture-detector.ts`): Classifies backend as REST_CONTROLLER (standard `/api/` paths) or WS_OPERATION_BASED (WebSocket-like controllers using className matching); affects URL-to-controller matching strategy
- **Validated on large production codebase** (easynup): URL extraction 6.3x improvement (146→918), controller matching 4.4x improvement (146→636), {base} URLs 100% matched (304/304)

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
