# Zynetic Energy Ingestion Engine

High-scale ingestion layer for Smart Meter and EV Fleet telemetry streams. Built with NestJS, raw PostgreSQL (no ORM), and Docker. Handles **14.4M+ records/day** with hot/cold storage separation, daily-partitioned tables, and indexed analytical queries.

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development)

### With Docker (Recommended)

```bash
# Start PostgreSQL and the app
docker-compose up --build

# App:     http://localhost:3000
# Swagger: http://localhost:3000/api/docs
```
### Railway-link - [Zynetic-Ingest](https://zynetic-ingest-production.up.railway.app/api/docs)

### Local Development

```bash
# 1. Start PostgreSQL only
docker-compose up postgres

# 2. Copy environment file
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Initialize the database (if not using Docker)
psql -U <your_user> -d template1 -c "CREATE USER zynetic WITH PASSWORD 'zynetic_secret';"
psql -U <your_user> -d template1 -c "CREATE DATABASE zynetic_energy OWNER zynetic;"
psql -U zynetic -d zynetic_energy -f src/database/migrations/init.sql

# 5. Start in dev mode
npm run start:dev
```

---

## Architecture Overview

```
Devices (10K+, every 60s)
        |
        +-- POST /v1/ingest/meter -------+
        |                                |
        +-- POST /v1/ingest/vehicle -----+
                                         |
                                    ValidationPipe
                                   (class-validator)
                                         |
                                   IngestionService
                                    +----+----+
                                    |         |
                               Hot Store   Cold Store
                               (UPSERT)   (INSERT)
                                    |         |
                            current_status  telemetry
                            (~10K rows)   (partitioned)
                                    |         |
                                    +----+----+
                                         |
                                    PostgreSQL
                                         |
                       GET /v1/analytics/performance/:vehicleId
                                         |
                                   AnalyticsService
                                 (indexed aggregation,
                              stream correlation, efficiency)
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No ORM** | Raw SQL via `pg` for full control over partitioning, batch inserts, and query plans |
| **Hot/Cold separation** | Dashboard reads hit 10K-row tables (sub-ms). Analytics run on indexed partitions. |
| **INSERT-only cold path** | No locking, no write amplification, no VACUUM pressure. Max throughput. |
| **UPSERT hot path** | One row per device. PK lookup is O(1). |
| **Daily partitioning** | 24h queries touch at most 2 partitions. Old data drops instantly. |
| **Composite indexes** | `(device_id, recorded_at)` -- B-tree seek + range scan = O(log n). No full table scan. |
| **Concurrent writes** | `Promise.all()` for hot+cold paths. Halves ingestion latency. |
| **Batch inserts** | Multi-row `VALUES` in one `INSERT`. Up to 10x fewer network round-trips. |

---

## API Endpoints

| Method | Endpoint | Status | Description |
|--------|----------|--------|-------------|
| POST | `/v1/ingest/meter` | 202 | Ingest single meter reading |
| POST | `/v1/ingest/meter/batch` | 202 | Ingest batch of meter readings |
| POST | `/v1/ingest/vehicle` | 202 | Ingest single vehicle reading |
| POST | `/v1/ingest/vehicle/batch` | 202 | Ingest batch of vehicle readings |
| GET | `/v1/analytics/performance/:vehicleId` | 200 | 24-hour performance summary |
| GET | `/health` | 200 | System health check |

### Example Requests

```bash
# Meter reading
curl -X POST http://localhost:3000/v1/ingest/meter \
  -H "Content-Type: application/json" \
  -d '{"meterId":"M1","kwhConsumedAc":100.5,"voltage":230,"timestamp":"2026-02-12T10:00:00Z"}'

# Vehicle reading
curl -X POST http://localhost:3000/v1/ingest/vehicle \
  -H "Content-Type: application/json" \
  -d '{"vehicleId":"V1","soc":72,"kwhDeliveredDc":88.2,"batteryTemp":34,"timestamp":"2026-02-12T10:00:00Z"}'

# Analytics
curl http://localhost:3000/v1/analytics/performance/V1
```

### Analytics Response

```json
{
  "vehicleId": "V1",
  "meterId": "M1",
  "totalKwhConsumedAc": 1200.5,
  "totalKwhDeliveredDc": 1050.3,
  "efficiencyRatio": 0.875,
  "avgBatteryTemp": 33.2,
  "periodStart": "2026-02-11T10:00:00.000Z",
  "periodEnd": "2026-02-12T10:00:00.000Z",
  "vehicleReadingsCount": 1440,
  "meterReadingsCount": 1440,
  "efficiencyAlert": false
}
```

Interactive Swagger documentation: **`/api/docs`**

---

## Data Correlation Strategy

The meter and vehicle streams are **independent** -- they share no common key. Correlation is achieved via the `vehicle_meter_mapping` table:

1. Each vehicle maps to exactly one meter (1:1)
2. Analytics looks up the mapping, then runs **parallel** aggregation queries on both telemetry tables
3. Efficiency = `DC Delivered / AC Consumed`
4. Below 85% triggers an efficiency alert (potential hardware fault)

---

## Handling 14.4M+ Records Daily

### Scale Math

```
10,000 devices x 2 streams x 1 reading/min x 60 min x 24 hours = 28.8M rows/day
Per table: ~14.4M rows/day = ~167 inserts/second
```

### How Each Technique Helps

| Technique | Impact |
|-----------|--------|
| **Daily partitioning** | Each partition holds ~14.4M rows. 24h queries hit at most 2 partitions. Old partitions drop instantly (`DROP TABLE`). |
| **INSERT-only writes** | No row locking. No MVCC dead tuples. No VACUUM overhead. Pure append throughput. |
| **Composite indexes** | `(device_id, recorded_at)` gives O(log n) within a partition. Analytics scans ~1,440 rows out of ~14.4M (0.01%). |
| **Batch inserts** | Multi-row `VALUES` reduces network round-trips and transaction overhead by N times. |
| **Connection pooling** | `pg.Pool` (default 20 connections) prevents connection exhaustion under sustained load. |
| **Concurrent dual-write** | Hot and cold writes run in parallel via `Promise.all()`, halving per-request latency. |
| **Application-layer partitioning** | Partitions created at startup (not per-row triggers). Zero overhead per INSERT. |

### Storage Estimate

~73 bytes/row x 14.4M rows = **~1 GB per partition per day**. Monthly: ~30 GB per table.

---

## Testing

```bash
# Unit tests (24 tests across 6 suites)
npm test

# E2E tests (11 tests)
npm run test:e2e

# Coverage report
npm run test:cov
```

### Test Summary

| Suite | Tests | What's Covered |
|-------|-------|----------------|
| IngestionService | 8 | Dual-write to hot+cold, concurrent execution, error propagation, batch strategy |
| AnalyticsService | 6 | Stream correlation, efficiency calculation, 85% threshold alert, zero-data edge case, 24h window |
| MeterIngestionController | 3 | Service delegation, response shaping, error propagation |
| VehicleIngestionController | 3 | Same as meter controller |
| AnalyticsController | 2 | Service delegation, 404 propagation |
| HealthController | 2 | Healthy/degraded status based on DB connection |
| **E2E** | **11** | Full HTTP flow: valid ingestion, validation rejection (missing fields, unknown fields, bad types, bad dates), batch, analytics correlation, 404 for unmapped vehicle, health check |

---

## Project Structure

```
src/
  main.ts                                # Bootstrap, Swagger, ValidationPipe
  app.module.ts                          # Root module wiring
  config/
    database.config.ts                   # PG pool config from env vars
  database/
    database.module.ts                   # Global DB module
    database.service.ts                  # pg.Pool wrapper + partition management
    migrations/
      init.sql                           # Full DDL: tables, indexes, partitions, mappings
  ingestion/
    ingestion.module.ts                  # Module declaration
    controllers/
      meter-ingestion.controller.ts      # POST /v1/ingest/meter (+batch)
      vehicle-ingestion.controller.ts    # POST /v1/ingest/vehicle (+batch)
    dto/
      meter-reading.dto.ts              # Validated meter payload
      vehicle-reading.dto.ts            # Validated vehicle payload
    services/
      ingestion.service.ts              # Orchestrates concurrent hot+cold writes
    repositories/
      meter.repository.ts              # Raw SQL: UPSERT + INSERT + batch
      vehicle.repository.ts            # Raw SQL: UPSERT + INSERT + batch
  analytics/
    analytics.module.ts                 # Module declaration
    controllers/
      analytics.controller.ts          # GET /v1/analytics/performance/:vehicleId
    dto/
      performance-response.dto.ts      # Response shape with Swagger
    services/
      analytics.service.ts            # Correlation + efficiency computation
    repositories/
      analytics.repository.ts         # Indexed aggregation queries
  health/
    health.controller.ts              # GET /health
```

---

## Detailed Documentation

For in-depth explanations of every file, every SQL query, every test case, and every design decision:

| Document | Contents |
|----------|----------|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | File-by-file breakdown of every source file, what it does, why it exists, and how SOLID principles are applied |
| **[docs/DATABASE.md](docs/DATABASE.md)** | Schema design, partitioning strategy, indexing rationale, insert vs upsert tradeoffs, scale analysis, VACUUM considerations |
| **[docs/API.md](docs/API.md)** | Complete API reference with request/response examples, field descriptions, error formats, and cURL commands |
| **[docs/TESTING.md](docs/TESTING.md)** | Every test case explained: what it verifies, why it matters, mocking approach, and testing strategy |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `zynetic` | Database user |
| `POSTGRES_PASSWORD` | `zynetic_secret` | Database password |
| `POSTGRES_DB` | `zynetic_energy` | Database name |
| `PORT` | `3000` | Application port |
| `PG_POOL_MAX` | `20` | Max connections in pool |

---

## Future Improvements

- **Kafka**: Decouple ingestion from DB writes for traffic spike resilience
- **TimescaleDB**: Automatic partitioning, compression, continuous aggregates
- **Materialized Views**: Pre-aggregate hourly summaries for faster analytics
- **Read Replicas**: Offload analytics queries to keep the primary write-optimized
- **BRIN Indexes**: 1000x smaller than B-tree for time-series range queries
