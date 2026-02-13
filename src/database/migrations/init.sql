-- ============================================================
-- Zynetic Energy Ingestion Engine - Database Schema
-- ============================================================
-- Hot/Cold storage separation with daily partitioning
-- Designed for 14.4M+ records/day write throughput
-- ============================================================

-- ============================================================
-- HOT TABLES: Current status (UPSERT target, ~10K rows each)
-- ============================================================

CREATE TABLE IF NOT EXISTS meter_current_status (
    meter_id        VARCHAR(50) PRIMARY KEY,
    kwh_consumed_ac DOUBLE PRECISION NOT NULL,
    voltage         DOUBLE PRECISION NOT NULL,
    last_updated    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle_current_status (
    vehicle_id       VARCHAR(50) PRIMARY KEY,
    soc              DOUBLE PRECISION NOT NULL,
    kwh_delivered_dc DOUBLE PRECISION NOT NULL,
    battery_temp     DOUBLE PRECISION NOT NULL,
    last_updated     TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- COLD TABLES: Historical telemetry (INSERT-only, partitioned)
-- ============================================================

CREATE TABLE IF NOT EXISTS meter_telemetry (
    id              BIGSERIAL,
    meter_id        VARCHAR(50) NOT NULL,
    kwh_consumed_ac DOUBLE PRECISION NOT NULL,
    voltage         DOUBLE PRECISION NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS vehicle_telemetry (
    id               BIGSERIAL,
    vehicle_id       VARCHAR(50) NOT NULL,
    soc              DOUBLE PRECISION NOT NULL,
    kwh_delivered_dc DOUBLE PRECISION NOT NULL,
    battery_temp     DOUBLE PRECISION NOT NULL,
    recorded_at      TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (recorded_at);

-- ============================================================
-- COMPOSITE INDEXES on cold tables (avoid full table scan)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_meter_telemetry_lookup
    ON meter_telemetry (meter_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_vehicle_telemetry_lookup
    ON vehicle_telemetry (vehicle_id, recorded_at);

-- ============================================================
-- VEHICLE-METER MAPPING (correlates two independent streams)
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_meter_mapping (
    vehicle_id VARCHAR(50) PRIMARY KEY,
    meter_id   VARCHAR(50) UNIQUE NOT NULL
);

-- ============================================================
-- PARTITION MANAGEMENT FUNCTION (called from application layer)
-- Creates a daily partition for a given table and date if missing
-- Partition naming: <table>_YYYY_MM_DD
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_daily_partition(
    parent_table TEXT,
    target_date DATE
) RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    end_date DATE;
BEGIN
    end_date := target_date + INTERVAL '1 day';
    partition_name := parent_table || '_' || TO_CHAR(target_date, 'YYYY_MM_DD');

    -- Skip if partition already exists
    IF EXISTS (
        SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
        RETURN;
    END IF;

    EXECUTE FORMAT(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        parent_table,
        target_date,
        end_date
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED: Create today's and tomorrow's partitions upfront
-- ============================================================

SELECT ensure_daily_partition('meter_telemetry', CURRENT_DATE);
SELECT ensure_daily_partition('meter_telemetry', CURRENT_DATE + 1);
SELECT ensure_daily_partition('vehicle_telemetry', CURRENT_DATE);
SELECT ensure_daily_partition('vehicle_telemetry', CURRENT_DATE + 1);

-- ============================================================
-- SEED: Sample vehicle-meter mappings for testing
-- ============================================================

INSERT INTO vehicle_meter_mapping (vehicle_id, meter_id) VALUES
    ('V1', 'M1'),
    ('V2', 'M2'),
    ('V3', 'M3'),
    ('V4', 'M4'),
    ('V5', 'M5')
ON CONFLICT (vehicle_id) DO NOTHING;
