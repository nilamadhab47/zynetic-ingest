# API Reference

Complete reference for all HTTP endpoints. Interactive Swagger docs are available at `/api/docs` when the app is running.

---

## Table of Contents

- [Base URL](#base-url)
- [Ingestion Endpoints](#ingestion-endpoints)
  - [POST /v1/ingest/meter](#post-v1ingestmeter)
  - [POST /v1/ingest/meter/batch](#post-v1ingestmeterbatch)
  - [POST /v1/ingest/vehicle](#post-v1ingestvehicle)
  - [POST /v1/ingest/vehicle/batch](#post-v1ingestvehiclebatch)
- [Analytics Endpoints](#analytics-endpoints)
  - [GET /v1/analytics/performance/:vehicleId](#get-v1analyticsperformancevehicleid)
- [Health Endpoints](#health-endpoints)
  - [GET /health](#get-health)
- [Error Responses](#error-responses)
- [Example cURL Commands](#example-curl-commands)

---

## Base URL

```
http://localhost:3000
```

---

## Ingestion Endpoints

All ingestion endpoints return `202 Accepted` on success, meaning the data has been persisted to both hot and cold stores.

### POST /v1/ingest/meter

Ingest a single smart meter reading.

**Request Body**:

```json
{
  "meterId": "M1",
  "kwhConsumedAc": 100.5,
  "voltage": 230,
  "timestamp": "2026-02-12T10:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meterId` | `string` | Yes | Unique meter identifier. Must be non-empty. |
| `kwhConsumedAc` | `number` | Yes | AC energy consumed from grid (kWh). |
| `voltage` | `number` | Yes | Grid voltage reading. |
| `timestamp` | `string` (ISO 8601) | Yes | When the reading was taken. |

**Success Response** (`202 Accepted`):

```json
{
  "status": "accepted"
}
```

**Error Response** (`400 Bad Request`):

```json
{
  "statusCode": 400,
  "message": [
    "kwhConsumedAc must be a number",
    "timestamp must be a valid ISO 8601 date string"
  ],
  "error": "Bad Request"
}
```

**What happens internally**:
1. `ValidationPipe` validates the body against `MeterReadingDto`
2. `IngestionService.ingestMeterReading()` is called
3. **Concurrently** (via `Promise.all`):
   - `MeterRepository.upsertCurrentStatus()` -- UPSERT into `meter_current_status`
   - `MeterRepository.insertTelemetry()` -- INSERT into `meter_telemetry` (partitioned)

---

### POST /v1/ingest/meter/batch

Ingest multiple meter readings in a single request for high-throughput bulk ingestion.

**Request Body** (array):

```json
[
  {
    "meterId": "M1",
    "kwhConsumedAc": 100.5,
    "voltage": 230,
    "timestamp": "2026-02-12T10:00:00Z"
  },
  {
    "meterId": "M2",
    "kwhConsumedAc": 95.3,
    "voltage": 231,
    "timestamp": "2026-02-12T10:00:00Z"
  }
]
```

**Success Response** (`202 Accepted`):

```json
{
  "status": "accepted",
  "count": 2
}
```

**What happens internally**:
1. For **each** reading: individual UPSERT to hot store (each device needs its own latest state)
2. For **all** readings: single multi-row INSERT to cold store (`INSERT INTO ... VALUES (...), (...), (...)`)
3. All operations run concurrently via `Promise.all`

---

### POST /v1/ingest/vehicle

Ingest a single vehicle telemetry reading.

**Request Body**:

```json
{
  "vehicleId": "V1",
  "soc": 72,
  "kwhDeliveredDc": 88.2,
  "batteryTemp": 34,
  "timestamp": "2026-02-12T10:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vehicleId` | `string` | Yes | Unique vehicle identifier. Must be non-empty. |
| `soc` | `number` | Yes | State of Charge (battery percentage, 0-100). |
| `kwhDeliveredDc` | `number` | Yes | DC energy delivered to battery (kWh). |
| `batteryTemp` | `number` | Yes | Battery temperature in Celsius. |
| `timestamp` | `string` (ISO 8601) | Yes | When the reading was taken. |

**Success Response** (`202 Accepted`):

```json
{
  "status": "accepted"
}
```

---

### POST /v1/ingest/vehicle/batch

Ingest multiple vehicle readings in a single request.

**Request Body** (array):

```json
[
  {
    "vehicleId": "V1",
    "soc": 72,
    "kwhDeliveredDc": 88.2,
    "batteryTemp": 34,
    "timestamp": "2026-02-12T10:00:00Z"
  },
  {
    "vehicleId": "V2",
    "soc": 65,
    "kwhDeliveredDc": 75.0,
    "batteryTemp": 32,
    "timestamp": "2026-02-12T10:00:00Z"
  }
]
```

**Success Response** (`202 Accepted`):

```json
{
  "status": "accepted",
  "count": 2
}
```

---

## Analytics Endpoints

### GET /v1/analytics/performance/:vehicleId

Returns a 24-hour performance summary for the specified vehicle, correlating data from both the vehicle and meter streams.

**Path Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `vehicleId` | `string` | Vehicle identifier (e.g., `V1`) |

**Success Response** (`200 OK`):

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

| Field | Type | Description |
|-------|------|-------------|
| `vehicleId` | `string` | The queried vehicle |
| `meterId` | `string` | The correlated meter (from `vehicle_meter_mapping`) |
| `totalKwhConsumedAc` | `number` | Sum of AC energy consumed over 24h (from meter telemetry) |
| `totalKwhDeliveredDc` | `number` | Sum of DC energy delivered over 24h (from vehicle telemetry) |
| `efficiencyRatio` | `number \| null` | `totalKwhDeliveredDc / totalKwhConsumedAc`. `null` if no AC data. |
| `avgBatteryTemp` | `number` | Average battery temperature over 24h |
| `periodStart` | `string` | Start of the 24h window (ISO 8601) |
| `periodEnd` | `string` | End of the 24h window (ISO 8601) |
| `vehicleReadingsCount` | `number` | Number of vehicle telemetry readings aggregated |
| `meterReadingsCount` | `number` | Number of meter telemetry readings aggregated |
| `efficiencyAlert` | `boolean` | `true` if `efficiencyRatio < 0.85` (potential hardware fault) |

**Error Response** (`404 Not Found`):

```json
{
  "statusCode": 404,
  "message": "No meter mapping found for vehicle: V999",
  "error": "Not Found"
}
```

**What happens internally**:
1. Look up `meterId` from `vehicle_meter_mapping` table (PK lookup, O(1))
2. If no mapping exists, throw 404
3. Define 24h window: `periodEnd = now`, `periodStart = now - 24h`
4. **Concurrently** run two aggregation queries (via `Promise.all`):
   - `SUM(kwh_delivered_dc), AVG(battery_temp), COUNT(*)` from `vehicle_telemetry`
   - `SUM(kwh_consumed_ac), COUNT(*)` from `meter_telemetry`
5. Both queries use composite indexes `(device_id, recorded_at)` + partition pruning
6. Compute `efficiencyRatio = DC / AC`
7. If ratio < 0.85, set `efficiencyAlert = true`

---

## Health Endpoints

### GET /health

System and database health check.

**Success Response** (`200 OK`):

```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 123.456,
  "timestamp": "2026-02-12T10:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `"ok"` if everything is healthy, `"degraded"` if DB is down |
| `database` | `string` | `"connected"` or `"disconnected"` |
| `uptime` | `number` | Process uptime in seconds |
| `timestamp` | `string` | Current server time (ISO 8601) |

---

## Error Responses

All error responses follow NestJS's standard format:

```json
{
  "statusCode": 400,
  "message": ["field must be a number"],
  "error": "Bad Request"
}
```

| Status | Cause |
|--------|-------|
| `400` | Validation failed (missing/wrong fields, unknown fields, invalid date format) |
| `404` | Vehicle-meter mapping not found (analytics endpoint) |
| `500` | Internal server error (database failure, unexpected exception) |

---

## Example cURL Commands

### Ingest a meter reading

```bash
curl -X POST http://localhost:3000/v1/ingest/meter \
  -H "Content-Type: application/json" \
  -d '{
    "meterId": "M1",
    "kwhConsumedAc": 100.5,
    "voltage": 230,
    "timestamp": "2026-02-12T10:00:00Z"
  }'
```

### Ingest a vehicle reading

```bash
curl -X POST http://localhost:3000/v1/ingest/vehicle \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleId": "V1",
    "soc": 72,
    "kwhDeliveredDc": 88.2,
    "batteryTemp": 34,
    "timestamp": "2026-02-12T10:00:00Z"
  }'
```

### Batch ingest meters

```bash
curl -X POST http://localhost:3000/v1/ingest/meter/batch \
  -H "Content-Type: application/json" \
  -d '[
    {"meterId":"M1","kwhConsumedAc":100,"voltage":230,"timestamp":"2026-02-12T10:00:00Z"},
    {"meterId":"M2","kwhConsumedAc":95,"voltage":231,"timestamp":"2026-02-12T10:00:00Z"}
  ]'
```

### Get analytics

```bash
curl http://localhost:3000/v1/analytics/performance/V1
```

### Health check

```bash
curl http://localhost:3000/health
```
