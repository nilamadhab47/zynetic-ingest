# Database Design & Strategy

This document explains the PostgreSQL schema, partitioning strategy, indexing, and how the system handles 14.4M+ records per day.

---

## Table of Contents

- [Schema Overview](#schema-overview)
- [Hot Tables (Operational Store)](#hot-tables-operational-store)
- [Cold Tables (Historical Store)](#cold-tables-historical-store)
- [Partitioning Strategy](#partitioning-strategy)
- [Indexing Strategy](#indexing-strategy)
- [Insert vs Upsert Decision Matrix](#insert-vs-upsert-decision-matrix)
- [Vehicle-Meter Correlation](#vehicle-meter-correlation)
- [Scale Analysis: 14.4M Records/Day](#scale-analysis-144m-recordsday)
- [Query Performance Analysis](#query-performance-analysis)
- [VACUUM & Maintenance Considerations](#vacuum--maintenance-considerations)
- [Future Improvements](#future-improvements)

---

## Schema Overview

```
┌───────────────────────────────────────────────────────────────┐
│                     PostgreSQL Database                        │
│                                                               │
│  ┌─────────────────────┐    ┌──────────────────────────────┐  │
│  │   HOT TABLES        │    │   COLD TABLES                │  │
│  │   (UPSERT target)   │    │   (INSERT-only, partitioned) │  │
│  │                     │    │                              │  │
│  │  meter_current_     │    │  meter_telemetry             │  │
│  │    status           │    │    ├── _2026_02_11           │  │
│  │  (10K rows max)     │    │    ├── _2026_02_12           │  │
│  │                     │    │    └── _2026_02_13           │  │
│  │  vehicle_current_   │    │                              │  │
│  │    status           │    │  vehicle_telemetry           │  │
│  │  (10K rows max)     │    │    ├── _2026_02_11           │  │
│  │                     │    │    ├── _2026_02_12           │  │
│  └─────────────────────┘    │    └── _2026_02_13           │  │
│                             └──────────────────────────────┘  │
│  ┌─────────────────────┐                                      │
│  │  LOOKUP TABLE       │                                      │
│  │  vehicle_meter_     │                                      │
│  │    mapping          │                                      │
│  │  (10K rows max)     │                                      │
│  └─────────────────────┘                                      │
└───────────────────────────────────────────────────────────────┘
```

---

## Hot Tables (Operational Store)

### `meter_current_status`

```sql
CREATE TABLE meter_current_status (
    meter_id        VARCHAR(50) PRIMARY KEY,  -- Natural key, one row per device
    kwh_consumed_ac DOUBLE PRECISION NOT NULL,
    voltage         DOUBLE PRECISION NOT NULL,
    last_updated    TIMESTAMPTZ NOT NULL       -- When was this reading received
);
```

**Purpose**: Stores the **latest** reading for each meter. The dashboard queries this table to show "current voltage" or "last known kWh consumed" without scanning the telemetry table.

**Size**: Exactly 1 row per device. With 10,000 meters, this table has 10,000 rows permanently. Lookups by `meter_id` (PK) are O(1) via the primary key index.

**Write pattern**: `INSERT ... ON CONFLICT (meter_id) DO UPDATE SET ...` (UPSERT). First reading creates the row; every subsequent reading updates it in place.

### `vehicle_current_status`

```sql
CREATE TABLE vehicle_current_status (
    vehicle_id       VARCHAR(50) PRIMARY KEY,
    soc              DOUBLE PRECISION NOT NULL,  -- Battery percentage
    kwh_delivered_dc DOUBLE PRECISION NOT NULL,
    battery_temp     DOUBLE PRECISION NOT NULL,
    last_updated     TIMESTAMPTZ NOT NULL
);
```

**Purpose**: Same pattern as meter. The dashboard queries this to show "current battery %" or "battery temperature" for any vehicle.

---

## Cold Tables (Historical Store)

### `meter_telemetry`

```sql
CREATE TABLE meter_telemetry (
    id              BIGSERIAL,                   -- Auto-incrementing ID
    meter_id        VARCHAR(50) NOT NULL,
    kwh_consumed_ac DOUBLE PRECISION NOT NULL,
    voltage         DOUBLE PRECISION NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL          -- Partition key
) PARTITION BY RANGE (recorded_at);
```

**Purpose**: Every meter reading is appended here as an immutable row. This creates a complete audit trail for analytics, billing disputes, and long-term reporting.

**Write pattern**: `INSERT` only. No updates, no deletes. This means:
- No row-level locking during writes
- No write amplification (no need to update indexes for changed values)
- No VACUUM pressure from dead tuples (no tuples ever die)
- Maximum write throughput

### `vehicle_telemetry`

```sql
CREATE TABLE vehicle_telemetry (
    id               BIGSERIAL,
    vehicle_id       VARCHAR(50) NOT NULL,
    soc              DOUBLE PRECISION NOT NULL,
    kwh_delivered_dc DOUBLE PRECISION NOT NULL,
    battery_temp     DOUBLE PRECISION NOT NULL,
    recorded_at      TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (recorded_at);
```

**Purpose**: Same pattern as meter telemetry, for vehicle data.

---

## Partitioning Strategy

### Why Partition?

At 14.4M+ rows per day, a single table would grow to billions of rows within months. Without partitioning:
- Indexes become huge and slow to update
- VACUUM takes longer and longer
- The analytics query (24h window) would scan the entire table
- Dropping old data requires `DELETE` (slow) instead of `DROP TABLE` (instant)

### Daily Partitions

Each telemetry table is partitioned by `RANGE` on `recorded_at` with **daily granularity**:

```
meter_telemetry (parent -- no data stored here)
  ├── meter_telemetry_2026_02_10  (Feb 10, 00:00 to Feb 11, 00:00)
  ├── meter_telemetry_2026_02_11  (Feb 11, 00:00 to Feb 12, 00:00)
  ├── meter_telemetry_2026_02_12  (Feb 12, 00:00 to Feb 13, 00:00)
  └── meter_telemetry_2026_02_13  (Feb 13, 00:00 to Feb 14, 00:00)
```

### How Partitions Are Created

The `ensure_daily_partition(parent_table, target_date)` SQL function creates a partition if it doesn't exist:

```sql
CREATE OR REPLACE FUNCTION ensure_daily_partition(
    parent_table TEXT,
    target_date DATE
) RETURNS VOID AS $$
...
$$;
```

This function is:
- **Idempotent**: Safe to call multiple times (checks `pg_class` first)
- **Called at app startup**: `DatabaseService.ensurePartitions()` creates today's and tomorrow's partitions
- **Called by `init.sql`**: Seed partitions for Docker first-start

### Why Application-Layer Partition Management (Not Triggers)

Initially, a `BEFORE INSERT` trigger was used. However, PostgreSQL routes inserts to child partitions **before** the trigger fires, meaning `TG_TABLE_NAME` contains the partition name (e.g., `meter_telemetry_2026_02_12`), not the parent name. This caused the trigger to try to create partitions of partitions.

The application-layer approach is:
- More predictable (no trigger-in-trigger confusion)
- More performant (no trigger overhead per row -- saves CPU at 14.4M rows/day)
- Easier to test and debug

---

## Indexing Strategy

### Composite Indexes

```sql
CREATE INDEX idx_meter_telemetry_lookup
    ON meter_telemetry (meter_id, recorded_at);

CREATE INDEX idx_vehicle_telemetry_lookup
    ON vehicle_telemetry (vehicle_id, recorded_at);
```

**Why composite, in this order?**

The analytics query filters by `device_id = $1 AND recorded_at >= $2 AND recorded_at < $3`. A composite index `(device_id, recorded_at)`:

1. First narrows to all rows for that specific device (equality on `meter_id`)
2. Then range-scans the `recorded_at` portion (the B-tree is already sorted)

This is the optimal index for this query pattern. Reversing the order (`recorded_at, meter_id`) would be less efficient because the first column would range-scan all devices' data before filtering.

### Index on Hot Tables

Hot tables have `PRIMARY KEY` on `meter_id`/`vehicle_id`. This implicitly creates a unique B-tree index. UPSERT uses this index for conflict detection, making the operation O(log n) -- but with only 10K rows, it's effectively instant.

---

## Insert vs Upsert Decision Matrix

| Path | Operation | Table | Why |
|------|-----------|-------|-----|
| **Hot** | UPSERT | `*_current_status` | Dashboard needs O(1) access to latest state. Only 1 row per device. |
| **Cold** | INSERT | `*_telemetry` | Immutable audit trail. No row locking. Maximum write throughput. |

### Why Not UPSERT for History?

UPSERT (`INSERT ... ON CONFLICT DO UPDATE`) would:
- Require a unique constraint (which column? `(device_id, recorded_at)` has duplicates if a device sends twice per minute)
- Lose the previous reading (we need the full history for analytics)
- Incur write amplification (updating row = write old + write new in MVCC)
- Cause row-level lock contention under high concurrency

### Why Not INSERT for Live Status?

INSERT would grow the hot table to millions of rows. Finding a device's current status would require:
```sql
SELECT * FROM meter_current_status
WHERE meter_id = 'M1'
ORDER BY last_updated DESC
LIMIT 1;
```
Even with an index, this is slower than a PK lookup on a 10K-row table. The UPSERT approach guarantees exactly 1 row per device.

---

## Vehicle-Meter Correlation

### The Problem

The meter stream and vehicle stream are completely independent. They share no common key. A meter reading `{ meterId: "M1", ... }` and a vehicle reading `{ vehicleId: "V1", ... }` arrive on separate endpoints.

To compute efficiency (`DC / AC`), we need to join data from both tables.

### The Solution

A `vehicle_meter_mapping` table provides the 1:1 relationship:

```sql
CREATE TABLE vehicle_meter_mapping (
    vehicle_id VARCHAR(50) PRIMARY KEY,
    meter_id   VARCHAR(50) UNIQUE NOT NULL
);
```

- `PRIMARY KEY (vehicle_id)` -- each vehicle maps to exactly one meter
- `UNIQUE (meter_id)` -- each meter maps to exactly one vehicle
- Lookup is O(1) via PK index

### Analytics Query Flow

```
1. vehicleId = "V1"
2. SELECT meter_id FROM vehicle_meter_mapping WHERE vehicle_id = 'V1'
   → "M1"
3. PARALLEL:
   a. SELECT SUM(kwh_delivered_dc), AVG(battery_temp), COUNT(*)
      FROM vehicle_telemetry WHERE vehicle_id = 'V1' AND recorded_at >= ... AND recorded_at < ...
   b. SELECT SUM(kwh_consumed_ac), COUNT(*)
      FROM meter_telemetry WHERE meter_id = 'M1' AND recorded_at >= ... AND recorded_at < ...
4. efficiencyRatio = totalKwhDeliveredDc / totalKwhConsumedAc
```

---

## Scale Analysis: 14.4M Records/Day

### Write Volume

```
10,000 devices × 2 streams × 1 reading/minute × 60 min × 24 hours
= 28,800,000 rows/day (both tables combined)
= 14,400,000 rows/day per table
= 10,000 rows/minute per table
= ~167 rows/second per table
```

### Storage Estimate per Partition

Each row in `vehicle_telemetry` is approximately:
- `id` (BIGINT): 8 bytes
- `vehicle_id` (VARCHAR 50): ~10 bytes typical
- `soc`, `kwh_delivered_dc`, `battery_temp` (DOUBLE PRECISION × 3): 24 bytes
- `recorded_at` (TIMESTAMPTZ): 8 bytes
- Row overhead: ~23 bytes

**~73 bytes per row × 14.4M rows = ~1 GB per partition per day**

### Why This Works

| Concern | How It's Addressed |
|---------|-------------------|
| Write contention | INSERT-only, no row locks, no MVCC dead tuples |
| Index maintenance | Daily partition indexes are small (~14.4M rows). B-tree insert is O(log 14.4M) ≈ 24 comparisons |
| Query speed | Partition pruning eliminates all but 1-2 partitions. Composite index gives O(log n) within partition |
| Old data cleanup | `DROP TABLE meter_telemetry_2026_01_15` is instant. No `DELETE` + `VACUUM` needed |
| Connection exhaustion | `pg.Pool` with 20 connections handles 167 writes/sec easily |
| Batch efficiency | Multi-row INSERT reduces network round-trips by N× |

---

## Query Performance Analysis

### The 24-Hour Analytics Query

```sql
SELECT SUM(kwh_delivered_dc), AVG(battery_temp), COUNT(*)
FROM vehicle_telemetry
WHERE vehicle_id = 'V1'
  AND recorded_at >= '2026-02-11T10:00:00Z'
  AND recorded_at < '2026-02-12T10:00:00Z';
```

**Query plan** (expected):

1. **Partition Pruning**: PostgreSQL identifies that only partitions `_2026_02_11` and `_2026_02_12` could contain rows in this range. All other partitions are excluded entirely.
2. **Index Scan**: Within the relevant partition(s), the composite index `(vehicle_id, recorded_at)` is used. PostgreSQL seeks to `vehicle_id = 'V1'` and then range-scans `recorded_at` within the B-tree.
3. **Aggregate**: `SUM`, `AVG`, and `COUNT` are computed as rows are scanned. No temporary table needed.

**Rows scanned**: ~1,440 (one reading per minute × 24 hours) out of ~14.4M in the partition. That's 0.01% of the partition.

**NO full table scan**.

---

## VACUUM & Maintenance Considerations

### Hot Tables

- UPSERT causes dead tuples (the old version of the updated row)
- With 10K devices updating every 60 seconds, that's 10K dead tuples/minute
- Default autovacuum handles this easily
- Consider lowering `autovacuum_vacuum_threshold` for these tables in production

### Cold Tables

- INSERT-only means **zero dead tuples**
- VACUUM is almost free (nothing to clean up)
- Can set aggressive `autovacuum_vacuum_scale_factor = 0` since there's nothing to vacuum
- The main maintenance task is creating new partitions (handled by the app) and dropping old ones

---

## Future Improvements

| Improvement | Benefit |
|-------------|---------|
| **TimescaleDB** | Automatic partitioning (hypertables), built-in compression (10× storage savings), continuous aggregates |
| **Materialized Views** | Pre-aggregate hourly/daily summaries. Analytics queries hit small summary tables instead of raw telemetry |
| **Kafka** | Decouple ingestion from DB writes. Devices → Kafka → Consumer workers → DB. Handles traffic spikes without backpressure on the DB |
| **BRIN Indexes** | For time-series data where rows are inserted in order, BRIN indexes are tiny (~1000× smaller than B-tree) and nearly as fast for range queries |
| **Read Replicas** | Offload analytics queries to replicas. Keep the primary optimized for writes |
| **Partition Archival** | Move old daily partitions to cheaper storage (e.g., S3 via `pg_partman` + external tables) |
