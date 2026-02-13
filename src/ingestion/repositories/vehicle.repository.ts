import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { VehicleReadingDto } from '../dto/vehicle-reading.dto.js';

@Injectable()
export class VehicleRepository {
  private readonly logger = new Logger(VehicleRepository.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * HOT PATH: Upsert current vehicle status (dashboard-ready, ~10K rows)
   * Uses ON CONFLICT for atomic update -- no row locking on miss
   */
  async upsertCurrentStatus(dto: VehicleReadingDto): Promise<void> {
    await this.db.query(
      `INSERT INTO vehicle_current_status (vehicle_id, soc, kwh_delivered_dc, battery_temp, last_updated)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (vehicle_id) DO UPDATE SET
         soc = EXCLUDED.soc,
         kwh_delivered_dc = EXCLUDED.kwh_delivered_dc,
         battery_temp = EXCLUDED.battery_temp,
         last_updated = EXCLUDED.last_updated`,
      [
        dto.vehicleId,
        dto.soc,
        dto.kwhDeliveredDc,
        dto.batteryTemp,
        dto.timestamp,
      ],
    );
  }

  /**
   * COLD PATH: Append-only insert into partitioned telemetry table
   * Auto-creates the daily partition if missing for the record's date.
   * No updates, no locking -- maximum write throughput
   */
  async insertTelemetry(dto: VehicleReadingDto): Promise<void> {
    await this.db.ensurePartitionForDate('vehicle_telemetry', new Date(dto.timestamp));
    await this.db.query(
      `INSERT INTO vehicle_telemetry (vehicle_id, soc, kwh_delivered_dc, battery_temp, recorded_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        dto.vehicleId,
        dto.soc,
        dto.kwhDeliveredDc,
        dto.batteryTemp,
        dto.timestamp,
      ],
    );
  }

  /**
   * BATCH COLD PATH: Multi-row insert for high-throughput scenarios
   * Ensures partitions exist for all distinct dates in the batch before inserting.
   * Reduces round-trips by batching multiple readings in one statement
   */
  async insertTelemetryBatch(readings: VehicleReadingDto[]): Promise<void> {
    if (readings.length === 0) return;

    // Ensure partitions for all distinct dates in the batch
    const distinctDates = [...new Set(readings.map((r) => new Date(r.timestamp).toISOString().slice(0, 10)))];
    await Promise.all(
      distinctDates.map((d) => this.db.ensurePartitionForDate('vehicle_telemetry', new Date(d))),
    );

    const values: any[] = [];
    const placeholders: string[] = [];

    readings.forEach((dto, index) => {
      const offset = index * 5;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
      );
      values.push(
        dto.vehicleId,
        dto.soc,
        dto.kwhDeliveredDc,
        dto.batteryTemp,
        dto.timestamp,
      );
    });

    await this.db.query(
      `INSERT INTO vehicle_telemetry (vehicle_id, soc, kwh_delivered_dc, battery_temp, recorded_at)
       VALUES ${placeholders.join(', ')}`,
      values,
    );

    this.logger.debug(
      `Batch inserted ${readings.length} vehicle telemetry rows`,
    );
  }
}
