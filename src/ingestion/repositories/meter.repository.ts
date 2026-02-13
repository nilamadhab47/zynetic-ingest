import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { MeterReadingDto } from '../dto/meter-reading.dto.js';

@Injectable()
export class MeterRepository {
  private readonly logger = new Logger(MeterRepository.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * HOT PATH: Upsert current meter status (dashboard-ready, ~10K rows)
   * Uses ON CONFLICT for atomic update -- no row locking on miss
   */
  async upsertCurrentStatus(dto: MeterReadingDto): Promise<void> {
    await this.db.query(
      `INSERT INTO meter_current_status (meter_id, kwh_consumed_ac, voltage, last_updated)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (meter_id) DO UPDATE SET
         kwh_consumed_ac = EXCLUDED.kwh_consumed_ac,
         voltage = EXCLUDED.voltage,
         last_updated = EXCLUDED.last_updated`,
      [dto.meterId, dto.kwhConsumedAc, dto.voltage, dto.timestamp],
    );
  }

  /**
   * COLD PATH: Append-only insert into partitioned telemetry table
   * Auto-creates the daily partition if missing for the record's date.
   * No updates, no locking -- maximum write throughput
   */
  async insertTelemetry(dto: MeterReadingDto): Promise<void> {
    await this.db.ensurePartitionForDate('meter_telemetry', new Date(dto.timestamp));
    await this.db.query(
      `INSERT INTO meter_telemetry (meter_id, kwh_consumed_ac, voltage, recorded_at)
       VALUES ($1, $2, $3, $4)`,
      [dto.meterId, dto.kwhConsumedAc, dto.voltage, dto.timestamp],
    );
  }

  /**
   * BATCH COLD PATH: Multi-row insert for high-throughput scenarios
   * Ensures partitions exist for all distinct dates in the batch before inserting.
   * Reduces round-trips by batching multiple readings in one statement
   */
  async insertTelemetryBatch(readings: MeterReadingDto[]): Promise<void> {
    if (readings.length === 0) return;

    // Ensure partitions for all distinct dates in the batch
    const distinctDates = [...new Set(readings.map((r) => new Date(r.timestamp).toISOString().slice(0, 10)))];
    await Promise.all(
      distinctDates.map((d) => this.db.ensurePartitionForDate('meter_telemetry', new Date(d))),
    );

    const values: any[] = [];
    const placeholders: string[] = [];

    readings.forEach((dto, index) => {
      const offset = index * 4;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`,
      );
      values.push(dto.meterId, dto.kwhConsumedAc, dto.voltage, dto.timestamp);
    });

    await this.db.query(
      `INSERT INTO meter_telemetry (meter_id, kwh_consumed_ac, voltage, recorded_at)
       VALUES ${placeholders.join(', ')}`,
      values,
    );

    this.logger.debug(`Batch inserted ${readings.length} meter telemetry rows`);
  }
}
