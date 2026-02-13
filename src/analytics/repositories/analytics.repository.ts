import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

export interface VehicleAggregation {
  totalKwhDeliveredDc: number;
  avgBatteryTemp: number;
  readingsCount: number;
}

export interface MeterAggregation {
  totalKwhConsumedAc: number;
  readingsCount: number;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lookup the meter_id correlated with a vehicle_id
   */
  async findMeterIdByVehicleId(vehicleId: string): Promise<string | null> {
    const result = await this.db.query<{ meter_id: string }>(
      `SELECT meter_id FROM vehicle_meter_mapping WHERE vehicle_id = $1`,
      [vehicleId],
    );
    return result.rows.length > 0 ? result.rows[0].meter_id : null;
  }

  /**
   * Aggregate vehicle telemetry for the last 24 hours.
   * Uses composite index (vehicle_id, recorded_at) -- hits at most 2 daily partitions.
   * NO full table scan.
   */
  async getVehicleAggregation(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<VehicleAggregation> {
    const result = await this.db.query<{
      total_kwh_delivered_dc: string;
      avg_battery_temp: string;
      readings_count: string;
    }>(
      `SELECT
         COALESCE(SUM(kwh_delivered_dc), 0) AS total_kwh_delivered_dc,
         COALESCE(AVG(battery_temp), 0) AS avg_battery_temp,
         COUNT(*) AS readings_count
       FROM vehicle_telemetry
       WHERE vehicle_id = $1
         AND recorded_at >= $2
         AND recorded_at < $3`,
      [vehicleId, from, to],
    );

    const row = result.rows[0];
    return {
      totalKwhDeliveredDc: parseFloat(row.total_kwh_delivered_dc),
      avgBatteryTemp: parseFloat(row.avg_battery_temp),
      readingsCount: parseInt(row.readings_count, 10),
    };
  }

  /**
   * Aggregate meter telemetry for the last 24 hours.
   * Uses composite index (meter_id, recorded_at) -- hits at most 2 daily partitions.
   * NO full table scan.
   */
  async getMeterAggregation(
    meterId: string,
    from: Date,
    to: Date,
  ): Promise<MeterAggregation> {
    const result = await this.db.query<{
      total_kwh_consumed_ac: string;
      readings_count: string;
    }>(
      `SELECT
         COALESCE(SUM(kwh_consumed_ac), 0) AS total_kwh_consumed_ac,
         COUNT(*) AS readings_count
       FROM meter_telemetry
       WHERE meter_id = $1
         AND recorded_at >= $2
         AND recorded_at < $3`,
      [meterId, from, to],
    );

    const row = result.rows[0];
    return {
      totalKwhConsumedAc: parseFloat(row.total_kwh_consumed_ac),
      readingsCount: parseInt(row.readings_count, 10),
    };
  }
}
