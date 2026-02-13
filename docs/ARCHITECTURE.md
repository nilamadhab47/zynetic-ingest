# Architecture & File-by-File Reference

This document explains every file in the project, its purpose, and how it fits into the overall architecture.

---

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Root Configuration Files](#root-configuration-files)
- [Source Code (`src/`)](#source-code-src)
  - [Bootstrap & App Module](#bootstrap--app-module)
  - [Config Module](#config-module)
  - [Database Module](#database-module)
  - [Ingestion Module](#ingestion-module)
  - [Analytics Module](#analytics-module)
  - [Health Module](#health-module)
- [SOLID Principles Applied](#solid-principles-applied)

---

## High-Level Architecture

```
                    ┌──────────────────────────────────────┐
                    │          10,000+ Devices              │
                    │     (heartbeat every 60 seconds)      │
                    └───────────┬──────────┬───────────────┘
                                │          │
                    ┌───────────▼──┐  ┌────▼──────────────┐
                    │ Smart Meter  │  │  EV / Charger      │
                    │ (Grid Side)  │  │  (Vehicle Side)    │
                    └──────┬───────┘  └────┬──────────────┘
                           │               │
           ┌───────────────▼───────────────▼───────────────┐
           │              NestJS API Layer                  │
           │                                               │
           │  ┌─────────────────┐  ┌─────────────────────┐ │
           │  │ MeterIngestion  │  │ VehicleIngestion     │ │
           │  │ Controller      │  │ Controller           │ │
           │  └────────┬────────┘  └────────┬────────────┘ │
           │           │                    │              │
           │           ▼                    ▼              │
           │  ┌────────────────────────────────────────┐   │
           │  │       Global ValidationPipe            │   │
           │  │  (class-validator + class-transformer)  │   │
           │  └───────────────────┬────────────────────┘   │
           │                      │                        │
           │           ┌──────────▼──────────┐             │
           │           │  IngestionService   │             │
           │           │  (orchestrator)     │             │
           │           └──┬──────────────┬───┘             │
           │              │              │                 │
           │    ┌─────────▼───┐  ┌───────▼─────────┐      │
           │    │ MeterRepo   │  │ VehicleRepo      │      │
           │    └──┬──────┬───┘  └──┬──────┬───────┘      │
           │       │      │         │      │              │
           └───────┼──────┼─────────┼──────┼──────────────┘
                   │      │         │      │
          ┌────────▼──┐ ┌─▼─────────▼──┐ ┌─▼────────┐
          │ Hot Store │ │  Cold Store   │ │ Hot Store│
          │  UPSERT   │ │  INSERT-only  │ │  UPSERT  │
          │ (10K rows) │ │ (partitioned) │ │(10K rows)│
          └────────┬──┘ └──────┬───────┘ └──┬───────┘
                   │           │            │
                   └───────────▼────────────┘
                          PostgreSQL
                              │
              ┌───────────────▼───────────────────┐
              │      AnalyticsController          │
              │  GET /v1/analytics/performance/   │
              │         :vehicleId                │
              └───────────────┬───────────────────┘
                              │
              ┌───────────────▼───────────────────┐
              │        AnalyticsService           │
              │  (correlate + compute efficiency) │
              └───────────────┬───────────────────┘
                              │
              ┌───────────────▼───────────────────┐
              │       AnalyticsRepository         │
              │  (indexed aggregation queries)    │
              └───────────────────────────────────┘
```

---

## Root Configuration Files

### `package.json`

**Purpose**: Node.js project manifest. Defines dependencies, scripts, and Jest configuration.

| Section | Details |
|---------|---------|
| **Runtime deps** | `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` (framework), `@nestjs/config` (env management), `@nestjs/swagger` (OpenAPI docs), `pg` (raw PostgreSQL driver), `class-validator` + `class-transformer` (DTO validation), `rxjs`, `reflect-metadata` |
| **Dev deps** | `@nestjs/testing` (test utilities), `jest` + `ts-jest` (test runner), `supertest` (HTTP assertions for E2E), `typescript`, `eslint`, `prettier` |
| **Scripts** | `start:dev` (watch mode), `build` (compile), `test` (unit), `test:e2e` (integration), `test:cov` (coverage) |
| **Jest config** | `rootDir: src`, transform via `ts-jest`, `moduleNameMapper` strips `.js` extensions for ESM compatibility |

### `tsconfig.json`

**Purpose**: TypeScript compiler configuration.

Key settings:
- `module: "nodenext"` + `moduleResolution: "nodenext"` -- Node.js ESM-compatible module resolution
- `emitDecoratorMetadata: true` + `experimentalDecorators: true` -- required for NestJS decorators
- `target: "ES2023"` -- modern JavaScript output
- `strictNullChecks: true` -- catches null reference bugs at compile time
- `outDir: "./dist"` -- compiled output goes to `dist/`

### `tsconfig.build.json`

**Purpose**: Extends `tsconfig.json` for production builds only. Excludes `node_modules`, `test/`, `dist/`, and `*.spec.ts` files from compilation.

### `nest-cli.json`

**Purpose**: NestJS CLI configuration. Sets `sourceRoot: "src"` and `deleteOutDir: true` (cleans `dist/` before each build).

### `.prettierrc`

**Purpose**: Code formatting rules. Single quotes, trailing commas on all multiline structures.

### `eslint.config.mjs`

**Purpose**: ESLint flat config for TypeScript + Prettier integration. Lints all `.ts` files in `src/`, `test/`, etc.

### `.gitignore`

**Purpose**: Excludes `dist/`, `node_modules/`, `.env`, coverage reports, IDE files, and OS artifacts from version control.

### `.env.example`

**Purpose**: Template for required environment variables. Developers copy this to `.env` for local development. Contains database connection params, app port, and pool size.

### `Dockerfile`

**Purpose**: Multi-stage Docker build for the NestJS application.

- **Stage 1 (builder)**: Installs all dependencies, runs `npm run build` to compile TypeScript to JavaScript in `dist/`.
- **Stage 2 (production)**: Installs only production dependencies (`npm ci --omit=dev`), copies the compiled `dist/` folder, and runs `node dist/main`. This produces a minimal image size.

### `docker-compose.yml`

**Purpose**: Orchestrates the full stack (PostgreSQL + NestJS app) with a single command.

| Service | Details |
|---------|---------|
| **postgres** | PostgreSQL 16 Alpine. Mounts `init.sql` into `/docker-entrypoint-initdb.d/` so the schema is automatically created on first start. Exposes port 5432. Has a health check (`pg_isready`) to ensure DB is ready before the app starts. |
| **app** | Built from the `Dockerfile`. Depends on `postgres` with `condition: service_healthy` so it only starts after DB is fully ready. Passes all env vars for database connection. Exposes port 3000. |

---

## Source Code (`src/`)

### Bootstrap & App Module

#### `src/main.ts` -- Application Entry Point

**What it does**:
1. Creates the NestJS application from `AppModule`
2. Registers a **global `ValidationPipe`** with three critical settings:
   - `transform: true` -- automatically converts plain JSON bodies into typed DTO class instances
   - `whitelist: true` -- strips any properties not defined in the DTO
   - `forbidNonWhitelisted: true` -- returns 400 if unknown properties are sent (security)
3. Configures **Swagger/OpenAPI** documentation at `/api/docs` with title, description, version, and tags
4. Starts listening on the configured `PORT` (default 3000)

**Why it matters**: The global ValidationPipe is the first line of defense against malformed payloads. Every request body is validated before it reaches any controller. Swagger provides interactive documentation for API consumers.

#### `src/app.module.ts` -- Root Module

**What it does**: Wires together all feature modules into the application.

| Import | Purpose |
|--------|---------|
| `ConfigModule.forRoot()` | Loads `.env` file and registered config namespaces. `isGlobal: true` makes it available everywhere without re-importing. |
| `DatabaseModule` | Provides the `DatabaseService` (pg.Pool wrapper) globally to all modules. |
| `IngestionModule` | Registers ingestion controllers, service, and repositories. |
| `AnalyticsModule` | Registers analytics controller, service, and repository. |
| `HealthController` | Registered directly in AppModule (simple enough to not need its own module). |

---

### Config Module

#### `src/config/database.config.ts` -- Database Configuration

**What it does**: Uses `@nestjs/config`'s `registerAs()` to create a typed, namespaced configuration object under the key `'database'`.

**How it works**: Reads environment variables (`POSTGRES_HOST`, `POSTGRES_PORT`, etc.) with sensible defaults. The `DatabaseService` accesses these via `configService.get<string>('database.host')`.

**Why a separate config file**: Follows the **Single Responsibility Principle** -- configuration parsing is isolated from database connection logic. Makes it easy to add new config namespaces (e.g., `redis.config.ts`) without touching existing code.

---

### Database Module

#### `src/database/database.module.ts` -- Global Database Provider

**What it does**: Declares `DatabaseService` as a provider and exports it. The `@Global()` decorator means any module can inject `DatabaseService` without importing `DatabaseModule` explicitly.

**Why global**: The database connection pool is a cross-cutting concern. Every repository needs it. Making it global avoids redundant imports in every feature module.

#### `src/database/database.service.ts` -- PostgreSQL Connection Pool Wrapper

**What it does**: Manages the entire lifecycle of the `pg.Pool` connection pool.

| Method | Purpose |
|--------|---------|
| `onModuleInit()` | Creates the pool from config, tests the connection, and calls `ensurePartitions()` to create today's + tomorrow's partitions. Runs automatically when NestJS boots. |
| `onModuleDestroy()` | Gracefully closes all pool connections on shutdown. Prevents connection leaks. |
| `query(text, params)` | Executes a parameterized SQL query. Logs execution time and row count at DEBUG level. Uses `$1, $2, ...` placeholders to prevent SQL injection. |
| `getClient()` | Checks out a single client from the pool for manual transaction control. Caller must release it. |
| `transaction(callback)` | Wraps a callback in `BEGIN`/`COMMIT`/`ROLLBACK`. Ensures atomicity and always releases the client (via `finally`). |
| `ensurePartitions()` | Calls the `ensure_daily_partition()` SQL function for both telemetry tables for today and tomorrow. Idempotent -- safe to call multiple times. |
| `isHealthy()` | Runs `SELECT 1` to verify the pool can connect. Used by the health check endpoint. |

**Why this design**: Wrapping `pg.Pool` in a NestJS injectable service allows:
- Lifecycle management tied to the app lifecycle
- Centralized query logging
- Easy mocking in tests (no real DB needed)
- Connection pooling with configurable pool size (default 20 connections)

#### `src/database/migrations/init.sql` -- Database Schema

**What it does**: The complete DDL (Data Definition Language) that creates all tables, indexes, and functions. Mounted into PostgreSQL's `/docker-entrypoint-initdb.d/` by Docker, so it runs automatically on first start.

**Tables created**:

| Table | Type | Purpose |
|-------|------|---------|
| `meter_current_status` | Hot (UPSERT) | Latest meter reading per device. PK on `meter_id`. Max ~10K rows. Sub-millisecond dashboard lookups. |
| `vehicle_current_status` | Hot (UPSERT) | Latest vehicle reading per device. PK on `vehicle_id`. Max ~10K rows. |
| `meter_telemetry` | Cold (INSERT) | Historical meter readings. Partitioned by day on `recorded_at`. Append-only, immutable audit trail. |
| `vehicle_telemetry` | Cold (INSERT) | Historical vehicle readings. Partitioned by day on `recorded_at`. Append-only. |
| `vehicle_meter_mapping` | Lookup | 1:1 mapping between vehicle IDs and meter IDs. Allows correlating the two independent streams for analytics. |

**Indexes**:
- `idx_meter_telemetry_lookup (meter_id, recorded_at)` -- composite index for the analytics query
- `idx_vehicle_telemetry_lookup (vehicle_id, recorded_at)` -- composite index for the analytics query

**Function**:
- `ensure_daily_partition(parent_table, target_date)` -- idempotent function that creates a daily partition if it doesn't exist. Called from the application layer at startup. Naming convention: `<table>_YYYY_MM_DD`.

**Seed data**: 5 sample vehicle-meter mappings (V1->M1, V2->M2, ..., V5->M5) for testing.

---

### Ingestion Module

#### `src/ingestion/ingestion.module.ts` -- Module Declaration

**What it does**: Registers the two ingestion controllers, the orchestrating service, and both repositories. Exports `IngestionService` so other modules can use it if needed.

#### `src/ingestion/dto/meter-reading.dto.ts` -- Meter Reading DTO

**What it does**: Defines the shape and validation rules for incoming meter telemetry payloads.

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `meterId` | `string` | `@IsString()`, `@IsNotEmpty()` | Unique meter identifier (e.g., "M1") |
| `kwhConsumedAc` | `number` | `@IsNumber()` | AC energy consumed from grid in kWh |
| `voltage` | `number` | `@IsNumber()` | Grid voltage reading |
| `timestamp` | `string` | `@IsDateString()` | ISO 8601 timestamp of the reading |

Each field is also decorated with `@ApiProperty()` for Swagger documentation with descriptions and examples.

**Why DTOs**: DTOs enforce a strict contract between the API consumer and the server. The `ValidationPipe` rejects any request that doesn't match. This prevents:
- Missing fields from corrupting the database
- Extra fields from being silently stored (security)
- Wrong types (e.g., string where number is expected)

#### `src/ingestion/dto/vehicle-reading.dto.ts` -- Vehicle Reading DTO

**What it does**: Same pattern as meter DTO but for vehicle telemetry.

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `vehicleId` | `string` | `@IsString()`, `@IsNotEmpty()` | Unique vehicle identifier |
| `soc` | `number` | `@IsNumber()` | State of Charge (battery %) |
| `kwhDeliveredDc` | `number` | `@IsNumber()` | DC energy delivered to battery in kWh |
| `batteryTemp` | `number` | `@IsNumber()` | Battery temperature in Celsius |
| `timestamp` | `string` | `@IsDateString()` | ISO 8601 timestamp |

#### `src/ingestion/repositories/meter.repository.ts` -- Meter Data Access

**What it does**: Contains all raw SQL operations for meter data. Three methods:

1. **`upsertCurrentStatus(dto)`** -- HOT PATH
   - SQL: `INSERT ... ON CONFLICT (meter_id) DO UPDATE SET ...`
   - Inserts a new row or updates the existing one atomically
   - Target table: `meter_current_status` (~10K rows max)
   - No row locking on miss (INSERT path), minimal locking on hit (UPDATE path)

2. **`insertTelemetry(dto)`** -- COLD PATH
   - SQL: `INSERT INTO meter_telemetry ...`
   - Append-only, no updates ever
   - Target table: `meter_telemetry` (partitioned, auto-routes to daily partition)
   - Maximum write throughput (no locking, no MVCC overhead)

3. **`insertTelemetryBatch(readings)`** -- BATCH COLD PATH
   - Dynamically builds a multi-row `INSERT` statement: `VALUES ($1,$2,$3,$4), ($5,$6,$7,$8), ...`
   - Single round-trip to the database for N readings
   - Dramatically reduces overhead for bulk ingestion (up to 10x fewer network calls)
   - Early returns if the array is empty (defensive)

#### `src/ingestion/repositories/vehicle.repository.ts` -- Vehicle Data Access

**What it does**: Identical pattern to `MeterRepository` but for vehicle data.

Same three methods (`upsertCurrentStatus`, `insertTelemetry`, `insertTelemetryBatch`) targeting `vehicle_current_status` and `vehicle_telemetry` tables. The vehicle DTO has 5 fields (vs 4 for meter), so the placeholder offsets differ.

#### `src/ingestion/services/ingestion.service.ts` -- Ingestion Orchestrator

**What it does**: The central service that coordinates writing to both hot and cold stores. This is the business logic layer between controllers and repositories.

| Method | What it does |
|--------|-------------|
| `ingestMeterReading(dto)` | Runs `upsertCurrentStatus` and `insertTelemetry` **concurrently** via `Promise.all()`. Both writes happen in parallel for maximum throughput. |
| `ingestVehicleReading(dto)` | Same pattern for vehicle data. |
| `ingestMeterBatch(readings)` | For each reading: upserts hot store. For all readings: single batch insert to cold store. All run concurrently via `Promise.all()`. |
| `ingestVehicleBatch(readings)` | Same pattern for vehicle batch. |

**Why `Promise.all()`**: The hot write and cold write are independent operations targeting different tables. Running them concurrently cuts the ingestion latency roughly in half compared to sequential execution. If either fails, the `Promise.all()` rejects immediately, propagating the error to the controller.

#### `src/ingestion/controllers/meter-ingestion.controller.ts` -- Meter HTTP Endpoint

**What it does**: Exposes two HTTP endpoints under `/v1/ingest/meter`:

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/v1/ingest/meter` | POST | 202 Accepted | Ingest a single meter reading |
| `/v1/ingest/meter/batch` | POST | 202 Accepted | Ingest an array of meter readings |

Returns `202 Accepted` (not 201 Created) because the semantics are "we received your data" -- appropriate for an ingestion pipeline.

Decorated with `@ApiTags('Ingestion')`, `@ApiOperation()`, and `@ApiResponse()` for full Swagger documentation.

The controller is **thin** -- it delegates immediately to `IngestionService` and returns a simple status response. No business logic lives here.

#### `src/ingestion/controllers/vehicle-ingestion.controller.ts` -- Vehicle HTTP Endpoint

**What it does**: Same pattern as meter controller but for vehicle data:

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/v1/ingest/vehicle` | POST | 202 Accepted | Ingest a single vehicle reading |
| `/v1/ingest/vehicle/batch` | POST | 202 Accepted | Ingest an array of vehicle readings |

**Why separate controllers** (not a single polymorphic endpoint):
- Cleaner DTO validation (each stream has its own shape)
- Easier to scale independently (can rate-limit one stream without affecting the other)
- No runtime type discrimination needed (no `if payload.type === "meter"`)
- Follows Open/Closed Principle: adding a third stream type means a new controller, no changes to existing ones

---

### Analytics Module

#### `src/analytics/analytics.module.ts` -- Module Declaration

**What it does**: Registers the analytics controller, service, and repository. Self-contained module with no exports (analytics is a leaf in the dependency graph).

#### `src/analytics/dto/performance-response.dto.ts` -- Response DTO

**What it does**: Defines the shape of the analytics response. Each field has `@ApiProperty()` for Swagger.

| Field | Type | Description |
|-------|------|-------------|
| `vehicleId` | `string` | The queried vehicle |
| `meterId` | `string` | The correlated meter (from mapping table) |
| `totalKwhConsumedAc` | `number` | Sum of AC energy from meter telemetry over 24h |
| `totalKwhDeliveredDc` | `number` | Sum of DC energy from vehicle telemetry over 24h |
| `efficiencyRatio` | `number \| null` | DC/AC ratio. `null` if no AC consumption (avoid division by zero) |
| `avgBatteryTemp` | `number` | Average battery temperature over 24h |
| `periodStart` | `string` | Start of the analysis window (ISO 8601) |
| `periodEnd` | `string` | End of the analysis window (ISO 8601) |
| `vehicleReadingsCount` | `number` | How many vehicle readings were aggregated |
| `meterReadingsCount` | `number` | How many meter readings were aggregated |
| `efficiencyAlert` | `boolean` | `true` if `efficiencyRatio < 0.85` (hardware fault indicator) |

#### `src/analytics/repositories/analytics.repository.ts` -- Analytics Data Access

**What it does**: Contains three query methods, all using parameterized SQL and hitting indexed columns.

1. **`findMeterIdByVehicleId(vehicleId)`**
   - Queries: `vehicle_meter_mapping`
   - Returns the correlated `meter_id` or `null` if no mapping exists
   - PK lookup: O(1) time

2. **`getVehicleAggregation(vehicleId, from, to)`**
   - Queries: `vehicle_telemetry`
   - SQL: `SELECT SUM(kwh_delivered_dc), AVG(battery_temp), COUNT(*) WHERE vehicle_id = $1 AND recorded_at >= $2 AND recorded_at < $3`
   - Uses composite index `(vehicle_id, recorded_at)` -- index scan, not table scan
   - PostgreSQL partition pruning eliminates all partitions outside `[from, to)`
   - Returns typed interface `VehicleAggregation`

3. **`getMeterAggregation(meterId, from, to)`**
   - Queries: `meter_telemetry`
   - Same pattern: `SUM(kwh_consumed_ac)`, `COUNT(*)` with composite index
   - Returns typed interface `MeterAggregation`

**Why `COALESCE()`**: If there are zero readings in the period, `SUM()` returns `NULL`. `COALESCE(..., 0)` ensures we always return a number, avoiding `null` propagation in the service layer.

**Why `parseFloat()` / `parseInt()`**: PostgreSQL returns `BIGINT` and `NUMERIC` aggregates as strings in the `pg` driver to avoid JavaScript number precision loss. We parse them back to numbers in the repository.

#### `src/analytics/services/analytics.service.ts` -- Analytics Business Logic

**What it does**: Orchestrates the correlation of two independent streams and computes efficiency.

**Flow** (when `getPerformance(vehicleId)` is called):

1. **Resolve mapping**: Looks up `meterId` from `vehicle_meter_mapping`. Throws `NotFoundException` (HTTP 404) if no mapping exists.
2. **Define time window**: Creates a 24-hour window ending at `new Date()` (current time).
3. **Parallel aggregation**: Runs `getVehicleAggregation` and `getMeterAggregation` concurrently via `Promise.all()`. Two independent queries, no reason to wait sequentially.
4. **Compute efficiency**: `efficiencyRatio = totalKwhDeliveredDc / totalKwhConsumedAc`. If AC is zero, returns `null` (avoid division by zero).
5. **Alert check**: If `efficiencyRatio < 0.85`, sets `efficiencyAlert = true` and logs a warning. Below 85% indicates hardware fault or energy leakage.
6. **Round numbers**: All floating-point results are rounded to avoid excessive decimal places.

**Why `EFFICIENCY_THRESHOLD = 0.85`**: As specified in the domain context -- AC consumed is always greater than DC delivered due to conversion loss. A drop below 85% is the threshold for flagging a hardware issue.

#### `src/analytics/controllers/analytics.controller.ts` -- Analytics HTTP Endpoint

**What it does**: Exposes a single GET endpoint:

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/v1/analytics/performance/:vehicleId` | GET | 200 | 24-hour performance summary |

Returns 404 if no vehicle-meter mapping exists for the given `vehicleId`.

Decorated with `@ApiParam()` for Swagger to document the path parameter with an example.

---

### Health Module

#### `src/health/health.controller.ts` -- Health Check Endpoint

**What it does**: Exposes `GET /health` for Docker health checks and monitoring.

**Response**:
```json
{
  "status": "ok",           // or "degraded" if DB is down
  "database": "connected",  // or "disconnected"
  "uptime": 123.456,        // process uptime in seconds
  "timestamp": "2026-02-12T10:00:00.000Z"
}
```

Calls `databaseService.isHealthy()` which runs `SELECT 1` against the pool. If the query fails, the status is `"degraded"` but the endpoint still returns 200 (the app itself is running, just the DB is down).

**Why a health endpoint**: Docker's `healthcheck` directive can poll this endpoint to determine if the container is healthy. Load balancers use it to route traffic away from unhealthy instances.

---

## SOLID Principles Applied

### Single Responsibility (S)

| Component | Single Responsibility |
|-----------|----------------------|
| Controllers | Accept HTTP requests, delegate to services, return responses |
| DTOs | Define and validate payload shapes |
| Services | Orchestrate business logic (which stores to write, how to correlate) |
| Repositories | Execute raw SQL against specific tables |
| DatabaseService | Manage the connection pool lifecycle |
| Config | Parse and provide environment variables |

### Open/Closed (O)

Adding a third telemetry stream (e.g., charger diagnostics) requires:
- A new DTO, repository, and controller
- Registering them in a new module
- **Zero changes** to existing ingestion or analytics code

### Liskov Substitution (L)

All repositories follow the same interface pattern (`upsert`, `insert`, `insertBatch`). A mock repository in tests is a perfect substitute for the real one.

### Interface Segregation (I)

Controllers only depend on the service methods they use. The analytics controller doesn't know about ingestion. The ingestion controllers don't know about analytics.

### Dependency Inversion (D)

- Controllers depend on service abstractions (injected via constructor)
- Services depend on repository abstractions (injected via constructor)
- Repositories depend on `DatabaseService` (injected via constructor)
- Nothing depends on concrete implementations directly -- NestJS DI handles resolution
