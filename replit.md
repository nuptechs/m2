# PermaCat - Code-to-Permission Catalog Generator

## Overview
Enterprise-grade static code intelligence tool that analyzes frontend (Vue/React/Angular) and Spring Boot backend source code to automatically generate a Technical Action Catalog for IAM (Identity and Access Management) systems.

## Architecture
- **Frontend**: React + TypeScript + Shadcn UI + TailwindCSS
- **Backend**: Express + TypeScript + Drizzle ORM + PostgreSQL
- **Analysis Engine**: Custom AST-like analyzers for frontend interactions and Java Spring Boot code
- **Semantic Engine**: OpenAI LLM (via Replit AI Integrations) for classifying technical operations and criticality scores

## Key Features
1. Upload project source files (Vue/React/Angular frontend + Java Spring Boot backend)
2. Analyze frontend for interaction points (buttons, forms, HTTP calls, navigation)
3. Parse Java controllers, services, repositories, and entities
4. Build a graph connecting frontend interactions to backend endpoints with full method tracing
5. LLM-powered semantic classification of technical operations and criticality scores
6. Editable catalog with human classification support
7. JSON export of the full catalog

## Project Structure
```
client/src/
  App.tsx              - Main app with sidebar layout
  pages/
    dashboard.tsx      - Overview stats and recent activity
    upload.tsx         - Project file upload (paste or file upload)
    catalog.tsx        - Catalog viewer with filters, search, detail dialog
  components/
    app-sidebar.tsx    - Navigation sidebar
    theme-toggle.tsx   - Dark/light mode toggle
  lib/
    theme-provider.tsx - Theme context provider

server/
  index.ts            - Express server entry point
  routes.ts           - API endpoints
  storage.ts          - Database storage layer (IStorage interface)
  db.ts               - Database connection
  seed.ts             - Sample project seed data
  analyzers/
    frontend-analyzer.ts  - Detects interactions in Vue/React/Angular code
    java-analyzer.ts      - Parses Spring Boot controllers/services/entities
    graph-connector.ts    - Connects frontend interactions to backend endpoints
    semantic-engine.ts    - LLM classification of operations

shared/
  schema.ts           - Drizzle ORM schema (projects, source_files, analysis_runs, catalog_entries)
```

## Data Flow
1. User uploads source files → stored in `source_files` table
2. Analysis triggered → frontend analyzer + java analyzer run
3. Graph connector maps interactions to endpoints with method tracing
4. Semantic engine classifies operations via LLM
5. Catalog entries stored in database
6. UI displays with filtering, search, editing, and JSON export

## API Endpoints
- GET /api/stats - Dashboard statistics
- GET /api/projects - List all projects
- POST /api/projects - Create project with source files
- POST /api/projects/:id/analyze - Run analysis pipeline
- GET /api/catalog-entries/:projectId - Get catalog entries
- PATCH /api/catalog-entries/:id - Update human classification
- GET /api/catalog-entries/:projectId/export - Export catalog as JSON
- GET /api/analysis-runs/recent - Recent analysis runs
