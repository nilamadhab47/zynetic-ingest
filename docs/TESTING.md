# Testing Documentation

This document explains every test suite and every individual test case in the project, what it verifies, and why it matters.

---

## Table of Contents

- [Test Overview](#test-overview)
- [Running Tests](#running-tests)
- [Unit Tests](#unit-tests)
  - [IngestionService (8 tests)](#ingestionservice-8-tests)
  - [AnalyticsService (6 tests)](#analyticsservice-6-tests)
  - [MeterIngestionController (3 tests)](#meteringestioncontroller-3-tests)
  - [VehicleIngestionController (3 tests)](#vehicleingestioncontroller-3-tests)
  - [AnalyticsController (2 tests)](#analyticscontroller-2-tests)
  - [HealthController (2 tests)](#healthcontroller-2-tests)
- [E2E Tests (11 tests)](#e2e-tests-11-tests)
  - [Health Check (1 test)](#health-check-1-test)
  - [Meter Ingestion (5 tests)](#meter-ingestion-5-tests)
  - [Vehicle Ingestion (2 tests)](#vehicle-ingestion-2-tests)
  - [Batch Ingestion (1 test)](#batch-ingestion-1-test)
  - [Analytics (2 tests)](#analytics-2-tests)
- [Testing Strategy](#testing-strategy)
- [Mocking Approach](#mocking-approach)

---

## Test Overview

| Category | File | Tests | Description |
|----------|------|-------|-------------|
| Unit | `ingestion.service.spec.ts` | 8 | IngestionService hot/cold orchestration |
| Unit | `analytics.service.spec.ts` | 6 | AnalyticsService correlation & efficiency |
| Unit | `meter-ingestion.controller.spec.ts` | 3 | MeterIngestionController delegation |
| Unit | `vehicle-ingestion.controller.spec.ts` | 3 | VehicleIngestionController delegation |
| Unit | `analytics.controller.spec.ts` | 2 | AnalyticsController delegation |
| Unit | `health.controller.spec.ts` | 2 | HealthController DB status |
| E2E | `app.e2e-spec.ts` | 11 | Full HTTP flow with validation |
| **Total** | | **35** | |

---

## Running Tests

```bash
# Run all unit tests
npm test

# Run unit tests in watch mode (re-runs on file changes)
npm run test:watch

# Run unit tests with coverage report
npm run test:cov

# Run E2E tests (full HTTP integration)
npm run test:e2e
```

---

## Unit Tests

All unit tests use **mocked dependencies** -- no real database connection is needed. Each test creates a NestJS testing module with mock providers injected via `{ provide: RealClass, useValue: mockObject }`.

---

### IngestionService (8 tests)

**File**: `src/ingestion/services/ingestion.service.spec.ts`

**Dependencies mocked**: `MeterRepository`, `VehicleRepository`

#### `ingestMeterReading` (4 tests)

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 1 | `should write to both hot and cold stores` | Asserts that `meterRepo.upsertCurrentStatus()` AND `meterRepo.insertTelemetry()` are both called with the correct DTO | Ensures every reading goes to both stores. If either call is missing, the dashboard or analytics would have stale/missing data. |
| 2 | `should call hot and cold paths concurrently` | Uses mock implementations that push to a shared array. Asserts both calls complete (array has 2 entries). | Verifies that `Promise.all()` is used (both paths execute). If one path was accidentally awaited before the other, performance would degrade. |
| 3 | `should propagate errors from hot store` | Makes `upsertCurrentStatus` reject with an error. Asserts the service rejects with the same error. | If the hot store write fails, the caller (controller) must know about it to return a 500. Silently swallowing errors would cause data inconsistency. |
| 4 | `should propagate errors from cold store` | Makes `insertTelemetry` reject. Asserts the service rejects. | Same rationale -- cold store failures must propagate. |

#### `ingestVehicleReading` (2 tests)

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 5 | `should write to both hot and cold stores` | Same as meter test #1, but for vehicle data. | Ensures vehicle readings follow the same dual-write pattern. |
| 6 | `should propagate errors from repositories` | Makes vehicle repo reject. Asserts service rejects. | Error propagation for vehicle path. |

#### `ingestMeterBatch` (1 test)

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 7 | `should upsert each reading and batch-insert telemetry` | With 2 readings: asserts `upsertCurrentStatus` called 2 times (once per reading) AND `insertTelemetryBatch` called once with the full array. | Verifies the batch strategy: individual upserts for hot (each device's latest state matters), single batch insert for cold (maximum throughput). |

#### `ingestVehicleBatch` (1 test)

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 8 | `should upsert each reading and batch-insert telemetry` | Same as meter batch test, for vehicles. | Ensures vehicle batch follows the same optimized pattern. |

---

### AnalyticsService (6 tests)

**File**: `src/analytics/services/analytics.service.spec.ts`

**Dependencies mocked**: `AnalyticsRepository`

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 1 | `should throw NotFoundException if no meter mapping exists` | When `findMeterIdByVehicleId` returns `null`, the service throws `NotFoundException` with message `"No meter mapping found for vehicle: V999"`. | If there's no mapping, we can't compute efficiency. The controller needs a 404 to return to the client. |
| 2 | `should return a valid performance summary with correct efficiency` | With 875 DC / 1000 AC: asserts `efficiencyRatio = 0.875`, `efficiencyAlert = false`, all fields populated correctly. | The core business logic test. Verifies the efficiency formula `DC / AC` is correctly implemented and the response shape matches the DTO. |
| 3 | `should flag efficiency alert when ratio is below 85%` | With 800 DC / 1000 AC: asserts `efficiencyRatio = 0.8`, `efficiencyAlert = true`. | The domain requirement: below 85% indicates hardware fault. This test verifies the threshold check works. |
| 4 | `should handle zero AC consumption gracefully (null efficiency)` | With 0 DC / 0 AC: asserts `efficiencyRatio = null`, `efficiencyAlert = false`. | Prevents division by zero. When there's no data, the ratio should be null (unknown), not Infinity or NaN. |
| 5 | `should query both streams concurrently` | Asserts `getVehicleAggregation` and `getMeterAggregation` are each called exactly once. | Verifies that both aggregation queries run (via `Promise.all`). If one was accidentally skipped, the response would have zero values. |
| 6 | `should set the correct 24-hour analysis window` | Captures time before and after the call. Asserts `periodEnd - periodStart = 24 hours` and `periodEnd` is between `before` and `after`. | The 24-hour window is computed at runtime. This test verifies it's exactly 24h wide and ends at the current time (not hardcoded). |

---

### MeterIngestionController (3 tests)

**File**: `src/ingestion/controllers/meter-ingestion.controller.spec.ts`

**Dependencies mocked**: `IngestionService`

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 1 | `should call ingestion service and return accepted status` | Calls `ingestMeter(dto)`, asserts `service.ingestMeterReading` was called with the DTO, and response is `{ status: "accepted" }`. | Verifies the controller is a thin pass-through -- no business logic, just delegation and response shaping. |
| 2 | `should propagate service errors` | Makes the service reject. Asserts the controller rejects. | Ensures errors from the service layer bubble up to the HTTP layer (NestJS will convert them to 500 responses). |
| 3 | `should call batch ingestion and return count` | Calls `ingestMeterBatch` with 2 readings. Asserts response is `{ status: "accepted", count: 2 }`. | Verifies the batch endpoint returns the count of processed readings. |

---

### VehicleIngestionController (3 tests)

**File**: `src/ingestion/controllers/vehicle-ingestion.controller.spec.ts`

**Dependencies mocked**: `IngestionService`

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 1 | `should call ingestion service and return accepted status` | Same pattern as meter controller test #1, for vehicle data. | Thin controller verification. |
| 2 | `should propagate service errors` | Service rejects, controller rejects. | Error propagation. |
| 3 | `should call batch ingestion and return count` | Batch of 2 returns `{ status: "accepted", count: 2 }`. | Batch response shaping. |

---

### AnalyticsController (2 tests)

**File**: `src/analytics/controllers/analytics.controller.spec.ts`

**Dependencies mocked**: `AnalyticsService`

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 1 | `should return performance summary from service` | Service returns a full `PerformanceResponseDto`. Asserts controller returns it unchanged and calls `service.getPerformance('V1')`. | Controller is a thin pass-through. |
| 2 | `should propagate NotFoundException from service` | Service throws `NotFoundException`. Asserts controller propagates it. | NestJS converts `NotFoundException` to HTTP 404 automatically. |

---

### HealthController (2 tests)

**File**: `src/health/health.controller.spec.ts`

**Dependencies mocked**: `DatabaseService`

| # | Test Name | What It Verifies | Why It Matters |
|---|-----------|-----------------|----------------|
| 1 | `should return ok status when database is healthy` | `isHealthy()` returns `true`. Asserts `status = "ok"`, `database = "connected"`, `uptime` is a number, `timestamp` is defined. | Happy path -- system is fully operational. |
| 2 | `should return degraded status when database is unhealthy` | `isHealthy()` returns `false`. Asserts `status = "degraded"`, `database = "disconnected"`. | Degraded path -- app is running but DB is down. Docker health checks use this to detect unhealthy containers. |

---

## E2E Tests (11 tests)

**File**: `test/app.e2e-spec.ts`

**Approach**: Creates a full NestJS application using `Test.createTestingModule`, but overrides `DatabaseService` with a mock that simulates SQL query responses. Uses `supertest` to send real HTTP requests and verify responses.

The mock `DatabaseService`:
- Returns `{ rows: [{ meter_id: 'M1' }] }` for vehicle-meter mapping queries (when `vehicleId = 'V1'`)
- Returns aggregation results for telemetry queries (vehicle: 875 kWh DC, 33.5C avg; meter: 1000 kWh AC)
- Returns `{ rows: [], rowCount: 1 }` for INSERT/UPSERT operations
- Tracks all executed queries in an array for verification

---

### Health Check (1 test)

| # | Test Name | HTTP | What It Verifies |
|---|-----------|------|-----------------|
| 1 | `should return health status` | `GET /health` → 200 | Response has `status: "ok"`, `database: "connected"`, and a `timestamp` field. |

### Meter Ingestion (5 tests)

| # | Test Name | HTTP | What It Verifies |
|---|-----------|------|-----------------|
| 2 | `should accept a valid meter reading` | `POST /v1/ingest/meter` → 202 | Valid payload returns `{ status: "accepted" }`. |
| 3 | `should reject an invalid meter reading (missing fields)` | `POST /v1/ingest/meter` → 400 | Payload with only `meterId` (missing `kwhConsumedAc`, `voltage`, `timestamp`) is rejected by `ValidationPipe`. |
| 4 | `should reject unknown fields` | `POST /v1/ingest/meter` → 400 | Payload with an extra `unknownField` property is rejected (`forbidNonWhitelisted: true`). Prevents data pollution. |
| 5 | `should reject invalid timestamp format` | `POST /v1/ingest/meter` → 400 | Payload with `timestamp: "not-a-date"` is rejected by `@IsDateString()`. |
| 6 | `should write to both hot and cold stores` | `POST /v1/ingest/meter` → 202 | After a successful ingestion, inspects the captured SQL queries array: verifies one query targets `meter_current_status` (hot) and another targets `meter_telemetry` (cold). This is the only E2E test that verifies internal behavior. |

### Vehicle Ingestion (2 tests)

| # | Test Name | HTTP | What It Verifies |
|---|-----------|------|-----------------|
| 7 | `should accept a valid vehicle reading` | `POST /v1/ingest/vehicle` → 202 | Valid vehicle payload returns `{ status: "accepted" }`. |
| 8 | `should reject an invalid vehicle reading` | `POST /v1/ingest/vehicle` → 400 | Payload with `soc: "not-a-number"` is rejected. Verifies type coercion doesn't silently accept strings. |

### Batch Ingestion (1 test)

| # | Test Name | HTTP | What It Verifies |
|---|-----------|------|-----------------|
| 9 | `should accept a batch of meter readings` | `POST /v1/ingest/meter/batch` → 202 | Array of 2 readings returns `{ status: "accepted", count: 2 }`. |

### Analytics (2 tests)

| # | Test Name | HTTP | What It Verifies |
|---|-----------|------|-----------------|
| 10 | `should return performance summary for a mapped vehicle` | `GET /v1/analytics/performance/V1` → 200 | Full response validation: `vehicleId`, `meterId`, `totalKwhConsumedAc = 1000`, `totalKwhDeliveredDc = 875`, `efficiencyRatio = 0.875`, `avgBatteryTemp = 33.5`, `efficiencyAlert = false`, plus `periodStart` and `periodEnd` are defined. |
| 11 | `should return 404 for unmapped vehicle` | `GET /v1/analytics/performance/V999` → 404 | Vehicle "V999" has no mapping in the mock. Verifies the 404 error path end-to-end. |

---

## Testing Strategy

### What We Test

| Layer | What We Verify | How |
|-------|---------------|-----|
| **Controllers** | Correct delegation to services, response shaping, error propagation | Unit tests with mocked services |
| **Services** | Business logic: dual-write orchestration, efficiency calculation, error handling | Unit tests with mocked repositories |
| **Validation** | DTO validation rules (required fields, types, whitelisting, date format) | E2E tests that send invalid payloads and expect 400 |
| **Integration** | Full HTTP request → response flow, all layers working together | E2E tests with mocked database |
| **Data flow** | Both hot and cold stores are written for every ingestion | E2E test that inspects captured SQL queries |

### What We Don't Test (and why)

| Not Tested | Why |
|------------|-----|
| Repository SQL queries | These are raw SQL strings. Testing them requires a real database. They're verified manually and via E2E tests that exercise the full path. |
| Database partitioning | Requires a real PostgreSQL instance with the schema loaded. Verified manually and via Docker integration. |
| `DatabaseService` pool management | Tested implicitly by the E2E tests (mock verifies `query()` is called). Pool lifecycle is a pg library concern. |

---

## Mocking Approach

### Unit Test Mocks

Each mock is a plain JavaScript object with `jest.fn()` methods:

```typescript
const mockMeterRepo = {
  upsertCurrentStatus: jest.fn().mockResolvedValue(undefined),
  insertTelemetry: jest.fn().mockResolvedValue(undefined),
  insertTelemetryBatch: jest.fn().mockResolvedValue(undefined),
};
```

This is injected via NestJS's testing module:

```typescript
const module = await Test.createTestingModule({
  providers: [
    IngestionService,
    { provide: MeterRepository, useValue: mockMeterRepo },
  ],
}).compile();
```

### E2E Test Mock

The E2E mock replaces the entire `DatabaseService` with a smart mock that:
- Pattern-matches SQL query text to return appropriate fake results
- Tracks all queries in an array for post-assertion
- Requires no real database connection

```typescript
const mockDatabaseService = {
  query: jest.fn().mockImplementation(async (text, params) => {
    if (text.includes('vehicle_meter_mapping')) {
      // Return mapping for V1 -> M1
    }
    if (text.includes('vehicle_telemetry') && text.includes('SUM')) {
      // Return aggregation results
    }
    // Default: INSERT/UPSERT success
    return { rows: [], rowCount: 1 };
  }),
};
```

This approach allows full end-to-end testing of the HTTP layer, validation, service logic, and error handling without any external dependencies.
