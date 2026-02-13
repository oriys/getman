# Getman Architecture - Core Capability Model

This document describes the 5 atomic capability layers that form Getman's core architecture, abstracting the essential features of API testing tools like Postman.

## Overview

Getman's architecture is designed around 5 core capability layers:

1. **Request Construction Engine** - Building and sending requests
2. **Response Inspector** - Parsing and visualizing responses  
3. **Test & Script Engine** - Automation and validation
4. **Collection System** - Organization and workflows
5. **Collaboration Layer** - Sharing and documentation

## 1️⃣ Request Construction Engine

The foundation layer for constructing and sending API requests.

### Protocol Support
- ✅ HTTP/HTTPS (implemented)
- 🚧 GraphQL (planned)
- 🚧 gRPC (planned)
- 🚧 WebSocket (planned)
- 🚧 Server-Sent Events (SSE) (planned)

### Request Elements
- ✅ Method (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)
- ✅ URL with path parameters
- ✅ Query parameters (key-value editor)
- ✅ Headers (key-value editor)
- 🚧 Cookies
- ✅ Request Body:
  - ✅ JSON
  - ✅ Form data (multipart/form-data)
  - ✅ URL-encoded (x-www-form-urlencoded)
  - ✅ Raw text
  - 🚧 Binary/file upload
  - 🚧 GraphQL query + variables
  - 🚧 gRPC proto + message

### Advanced Capabilities
- ✅ Environment variable substitution (`{{variable}}`)
- 🚧 Dynamic variables (timestamp, uuid, random)
- 🚧 File upload support
- 🚧 TLS certificate configuration
- 🚧 Proxy support
- 🚧 Timeout configuration
- 🚧 Redirect policies

**Implementation:**
- TypeScript types: `lib/getman-store.ts` (RequestTab interface)
- Rust backend: `src-tauri/src/main.rs` (send_http_request)

## 2️⃣ Response Inspector

Parses and visualizes API responses with multiple view modes.

### Basic Information
- ✅ Status code
- ✅ Status text
- ✅ Response headers
- ✅ Response body
- ✅ Response time (ms)
- ✅ Response size (bytes)
- ✅ Content type detection

### Rendering Modes
- ✅ JSON formatting with syntax highlighting
- 🚧 Pretty view with collapsible nodes
- ✅ Raw view
- 🚧 XML formatting
- 🚧 HTML preview
- 🚧 Image preview
- 🚧 PDF preview

### Advanced Features
- 🚧 Response search (text/JSONPath)
- 🚧 Auto JSON schema display
- 🚧 GraphQL response visualization
- 🚧 Response export (save to file)
- 🚧 Response comparison (diff tool)

**Implementation:**
- TypeScript types: `lib/getman-store.ts` (ResponseData interface)
- UI component: `components/getman/response-viewer.tsx`
- Rust backend: `src-tauri/src/main.rs` (SendResponsePayload)

## 3️⃣ Test & Script Engine

Enables automation, testing, and data manipulation through scripts.

### Pre-request Scripts
- 🚧 JavaScript/TypeScript execution sandbox
- 🚧 Modify request parameters dynamically
- 🚧 Generate signatures (HMAC, JWT)
- 🚧 Token generation and refresh
- 🚧 Dynamic variable generation
- 🚧 Access to environment variables
- 🚧 Cryptographic functions (hash, encrypt)

### Test Scripts  
- 🚧 JavaScript/TypeScript execution sandbox
- 🚧 Assertions API:
  - Status code validation
  - Header validation
  - Body content validation
  - JSONPath queries
  - Response time validation
- 🚧 Extract data to variables
- 🚧 Conditional test execution
- 🚧 Test result aggregation

### Script API
```typescript
// Pre-request script API
pm.environment.set(key, value)
pm.environment.get(key)
pm.variables.set(key, value)
pm.request.headers.add(key, value)
pm.request.body.update(data)

// Test script API
pm.test(name, function)
pm.response.to.have.status(code)
pm.response.to.have.header(key, value)
pm.response.to.have.jsonBody(path, value)
pm.expect(value).to.equal(expected)
```

**Implementation:**
- 🚧 Script execution: New `ScriptEngine` module
- 🚧 Integration: Update request flow to execute scripts
- 🚧 UI: Add script editors to request tabs

## 4️⃣ Collection System

Organizes requests, manages environments, and enables workflow automation.

### Collections
- ✅ Create/rename/delete collections
- ✅ Save requests to collections
- ✅ Organize requests in folders
- 🚧 Folder hierarchy (nested folders)
- 🚧 Collection-level variables
- 🚧 Collection-level scripts (setup/teardown)
- 🚧 Sequential execution (Runner)
- 🚧 Parallel execution
- 🚧 Version control integration

### Environments
- ✅ Create/edit/delete environments
- ✅ Environment variables (key-value pairs)
- ✅ Switch active environment
- ✅ Variable substitution in requests
- 🚧 Variable scopes:
  - Global variables
  - ✅ Environment variables
  - Collection variables
  - Local/temporary variables
- 🚧 Variable inheritance and priority
- 🚧 Encrypted/secret variables

### Data-Driven Testing
- 🚧 CSV data file import
- 🚧 JSON data file import
- 🚧 Iterate requests with data rows
- 🚧 Variable binding from data
- 🚧 Batch execution reports

### Collection Runner
- 🚧 Run entire collections
- 🚧 Run specific folders
- 🚧 Configurable delay between requests
- 🚧 Iteration count
- 🚧 Stop on failure option
- 🚧 Execution report (pass/fail statistics)
- 🚧 Export results (HTML/JSON)

**Implementation:**
- TypeScript types: `lib/getman-store.ts` (Collection, Environment interfaces)
- UI components: `components/getman/getman-sidebar.tsx`
- 🚧 Runner: New `CollectionRunner` module

## 5️⃣ Collaboration Layer

Facilitates team collaboration, documentation, and CI/CD integration.

### Documentation
- 🚧 Auto-generate API documentation from collections
- 🚧 Markdown support in descriptions
- 🚧 Request/response examples
- 🚧 Export to HTML/PDF
- 🚧 Public documentation URL

### Mock Server
- 🚧 Create mock endpoints from examples
- 🚧 Dynamic response rules
- 🚧 Delay simulation
- 🚧 Error simulation

### Sharing & Collaboration
- 🚧 Export collections to JSON (Postman v2.1 format)
- 🚧 Import Postman collections
- 🚧 Share collections via file/URL
- 🚧 Team workspaces (cloud sync)
- 🚧 Version history and diffs
- 🚧 Branching and merging

### CI/CD Integration
- 🚧 CLI tool (`getman-cli`)
- 🚧 Run collections from command line
- 🚧 Exit codes for CI pipelines
- 🚧 Multiple output formats (JSON, JUnit XML, TAP)
- 🚧 Integration with popular CI systems
- 🚧 Docker image

**Implementation:**
- 🚧 CLI: New `getman-cli` Rust binary
- 🚧 Documentation generator: New module
- 🚧 Import/export: Extend collection format
- 🚧 Mock server: Optional embedded HTTP server

## Architecture Principles

### 1. Protocol Abstraction Layer
All protocol-specific code is abstracted behind common interfaces, making it easy to add new protocols without changing the core application.

### 2. Modular Design
Each capability layer is independent and can be enhanced without affecting others. Clear interfaces between layers.

### 3. Persistence Strategy
- **Client State**: Collections, environments, tabs (SQLite via Tauri)
- **Runtime State**: Active request/response, UI state (React state)
- **Export Format**: JSON for interoperability

### 4. Security
- Sensitive data (tokens, passwords) encrypted at rest
- Script sandbox with limited API surface
- TLS certificate validation
- Proxy credential protection

### 5. Performance
- Lazy loading of large responses
- Streaming for file uploads/downloads
- Background execution for runners
- Efficient JSON parsing and rendering

## Technology Stack

### Frontend
- **Framework**: Next.js 16 + React 19
- **UI Library**: Radix UI + Tailwind CSS
- **State Management**: Custom store with external sync
- **Desktop**: Tauri 2.0 (WebView)

### Backend
- **Runtime**: Rust (Tauri)
- **HTTP Client**: reqwest
- **Database**: SQLite (rusqlite)
- **Script Engine**: (planned) QuickJS or Deno core

### Testing
- 🚧 Unit tests: Vitest (TypeScript), cargo test (Rust)
- 🚧 Integration tests: Playwright
- 🚧 E2E tests: Full workflow scenarios

## Roadmap Alignment

This architecture supports the roadmap defined in `ROADMAP.md`:

- **Phase 1 (v0.1-0.3)**: Layers 1 & 2 (Request + Response)
- **Phase 2 (v0.4-0.6)**: Layer 4 (Collections + Environments)
- **Phase 3 (v0.7-0.9)**: Layer 3 (Scripts + Tests)
- **Phase 4 (v1.0)**: Layer 5 (Collaboration)

## Future Enhancements

- WebSocket connection management
- gRPC service introspection
- GraphQL schema introspection
- Plugin system for custom protocols
- Real-time collaboration features
- Cloud synchronization
- AI-powered test generation
- Performance profiling tools
- API versioning support
- OpenAPI/Swagger import

---

**Legend:**
- ✅ Implemented
- 🚧 Planned/In Progress
- ❌ Not planned for v1.0
