# Getman

A lightweight, fast, and modern API testing tool - an alternative to Postman built with Tauri and Next.js.

## Overview

Getman is designed around 5 core capability layers that abstract the essential features of API testing tools:

1. **Request Construction Engine** - Building and sending HTTP/HTTPS requests
2. **Response Inspector** - Parsing and visualizing responses
3. **Test & Script Engine** - Automation and validation through scripts
4. **Collection System** - Organization, workflows, and data-driven testing
5. **Collaboration Layer** - Sharing, documentation, and import/export

## Features

### ✅ Implemented

#### Layer 1: Request Construction
- HTTP/HTTPS requests with all major methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- URL construction with path and query parameters
- Request headers with key-value editor
- Multiple body types:
  - JSON
  - Form data (multipart/form-data)
  - URL-encoded (x-www-form-urlencoded)
  - Raw text
- Authentication support:
  - Bearer Token
  - Basic Auth
  - API Key (header or query parameter)
- Environment variable substitution (`{{variable}}`)
- Dynamic variables (`{{$timestamp}}`, `{{$guid}}`, etc.)

#### Layer 2: Response Inspector
- Status code, headers, and body display
- Response time and size tracking
- Content type detection
- JSON formatting and validation
- JSONPath queries for data extraction
- Response validation utilities
- Cookie parsing

#### Layer 3: Test & Script Engine
- Pre-request scripts (JavaScript)
- Test scripts (JavaScript)
- Chai-style assertion API (`pm.expect()`)
- Assertion types:
  - Status code validation
  - Header validation
  - Body content validation
  - JSONPath queries
  - Response time checks
- Variable extraction from responses
- Script execution sandbox

#### Layer 4: Collection System
- Create and organize collections
- Nested folder support
- Save and manage requests
- Multiple environments
- Environment variable management with scopes
- Collection-level variables
- Collection-level scripts
- Collection Runner:
  - Sequential execution
  - Multiple iterations
  - Data-driven testing (CSV/JSON)
  - Stop on failure option
  - Progress reporting
- Export results (JSON, HTML, JUnit XML)

#### Layer 5: Collaboration
- Postman Collection v2.1 import/export
- OpenAPI 3.0 export
- API documentation generation (HTML/Markdown)
- Collection sharing utilities

### 🚧 Planned

- GraphQL support
- gRPC support
- WebSocket connections
- Server-Sent Events (SSE)
- File upload support
- TLS certificate configuration
- Proxy support
- Mock server
- CLI tool for CI/CD integration
- Cloud synchronization
- Team workspaces

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation of the core capability model and implementation.

## Technology Stack

### Frontend
- **Framework**: Next.js 16 with React 19
- **UI**: Radix UI components + Tailwind CSS
- **State**: Custom store with external sync
- **Desktop**: Tauri 2.0

### Backend
- **Runtime**: Rust (Tauri)
- **HTTP Client**: reqwest
- **Database**: SQLite for state persistence

## Project Structure

```
getman/
├── app/                    # Next.js app router
├── components/
│   ├── getman/            # Main application components
│   └── ui/                # Reusable UI components
├── lib/
│   ├── capability-types.ts      # Core type definitions
│   ├── getman-store.ts          # State management
│   ├── request-builder.ts       # Layer 1: Request construction
│   ├── response-inspector.ts    # Layer 2: Response parsing
│   ├── script-engine.ts         # Layer 3: Script execution
│   ├── collection-runner.ts     # Layer 4: Collection running
│   └── collaboration.ts         # Layer 5: Import/export/docs
├── src-tauri/             # Rust backend
│   └── src/
│       └── main.rs        # HTTP client and state persistence
├── ARCHITECTURE.md        # Architecture documentation
└── ROADMAP.md            # Development roadmap
```

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Tauri CLI

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

### Running Tests

```bash
# Frontend tests
npm test

# Backend tests
cd src-tauri && cargo test
```

## Usage Examples

### Basic HTTP Request

```typescript
import { prepareRequest } from '@/lib/request-builder';
import { resolveEnvVariables } from '@/lib/getman-store';

// Create a request
const tab = {
  method: 'GET',
  url: 'https://api.example.com/users/{{userId}}',
  params: [{ key: 'limit', value: '10', enabled: true }],
  headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
  // ... other fields
};

// Prepare for sending
const request = prepareRequest(tab, resolveEnvVariables);
// Result: GET https://api.example.com/users/123?limit=10
```

### Running Tests

```typescript
import { executeTestScript } from '@/lib/script-engine';

const testScript = {
  type: 'test',
  code: `
    pm.test("Status is 200", () => {
      pm.expect(pm.response.code).to.equal(200);
    });
    
    pm.test("Response has user data", () => {
      const json = pm.response.json();
      pm.expect(json).to.have.property('id');
      pm.expect(json.name).to.be.a('string');
    });
  `,
  enabled: true
};

const result = await executeTestScript(testScript, request, response, envMap);
console.log(`Tests passed: ${result.tests.filter(t => t.passed).length}`);
```

### Running Collections

```typescript
import { runCollection } from '@/lib/collection-runner';

const result = await runCollection(
  collection,
  {
    collectionId: collection.id,
    environmentId: 'prod-env',
    iterations: 10,
    delay: 1000,
    stopOnFailure: false
  },
  environment,
  sendHttpRequest
);

console.log(`Success rate: ${result.successfulRequests}/${result.totalRequests}`);
console.log(`Tests passed: ${result.passedTests}/${result.totalTests}`);
```

### Generating Documentation

```typescript
import { generateDocumentation } from '@/lib/collaboration';

const docs = generateDocumentation(collection, {
  title: 'My API Documentation',
  description: 'Complete API reference',
  version: '1.0.0',
  baseUrl: 'https://api.example.com',
  collections: [collection.id],
  includeExamples: true
});

// Save HTML documentation
fs.writeFileSync('api-docs.html', docs.html);

// Save OpenAPI spec
fs.writeFileSync('openapi.json', docs.openapi);
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the detailed development plan and milestones.

### Current Phase: v0.1 - v0.3 (Phase 1)
Focus: HTTP core capabilities and usable UI

### Next Phases:
- **Phase 2** (v0.4-0.6): Collections and environment management
- **Phase 3** (v0.7-0.9): Automated testing and batch execution
- **Phase 4** (v1.0): Stabilization and collaboration features

## Contributing

Contributions are welcome! Please ensure:

1. Code follows the existing style
2. All tests pass
3. New features include tests and documentation
4. Commits are descriptive

## Design Principles

1. **Protocol Abstraction** - Clean separation between protocols
2. **Modular Architecture** - Independent, composable layers
3. **Performance First** - Fast response rendering, efficient state management
4. **Security** - Encrypted storage, sandboxed scripts
5. **Interoperability** - Compatible with Postman format

## License

[Add license information]

## Acknowledgments

Inspired by Postman, Insomnia, and other API testing tools.

Built with:
- [Tauri](https://tauri.app/)
- [Next.js](https://nextjs.org/)
- [Radix UI](https://www.radix-ui.com/)
- [Rust](https://www.rust-lang.org/)

---

**Status**: Early development (v0.1.0)  
**Target**: Lightweight Postman alternative for desktop-first workflows
