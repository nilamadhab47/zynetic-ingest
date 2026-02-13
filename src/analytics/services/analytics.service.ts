import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { AnalyticsRepository } from '../repositories/analytics.repository.js';
import { PerformanceResponseDto } from '../dto/performance-response.dto.js';

const EFFICIENCY_THRESHOLD = 0.85;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly analyticsRepository: AnalyticsRepository) {}

  /**
   * Get 24-hour performance summary for a vehicle.
   *
   * Correlates two independent streams (vehicle + meter) using the
   * vehicle_meter_mapping table. Queries use composite indexes and
   * partition pruning -- no full table scan.
   */
  async getPerformance(vehicleId: string): Promise<PerformanceResponseDto> {
    // Step 1: Resolve vehicle -> meter mapping
    const meterId =
      await this.analyticsRepository.findMeterIdByVehicleId(vehicleId);

    if (!meterId) {
      throw new NotFoundException(
        `No meter mapping found for vehicle: ${vehicleId}`,
      );
    }

    // Step 2: Define 24-hour analysis window
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

    // Step 3: Run both aggregations concurrently (maximum throughput)
    const [vehicleAgg, meterAgg] = await Promise.all([
      this.analyticsRepository.getVehicleAggregation(
        vehicleId,
        periodStart,
        periodEnd,
      ),
      this.analyticsRepository.getMeterAggregation(
        meterId,
        periodStart,
        periodEnd,
      ),
    ]);

    // Step 4: Compute efficiency ratio
    const efficiencyRatio =
      meterAgg.totalKwhConsumedAc > 0
        ? vehicleAgg.totalKwhDeliveredDc / meterAgg.totalKwhConsumedAc
        : null;

    const efficiencyAlert =
      efficiencyRatio !== null && efficiencyRatio < EFFICIENCY_THRESHOLD;

    if (efficiencyAlert) {
      this.logger.warn(
        `Efficiency alert for vehicle ${vehicleId}: ${(efficiencyRatio! * 100).toFixed(1)}% (below ${EFFICIENCY_THRESHOLD * 100}% threshold)`,
      );
    }

    return {
      vehicleId,
      meterId,
      totalKwhConsumedAc: Math.round(meterAgg.totalKwhConsumedAc * 100) / 100,
      totalKwhDeliveredDc:
        Math.round(vehicleAgg.totalKwhDeliveredDc * 100) / 100,
      efficiencyRatio:
        efficiencyRatio !== null
          ? Math.round(efficiencyRatio * 10000) / 10000
          : null,
      avgBatteryTemp:
        Math.round(vehicleAgg.avgBatteryTemp * 100) / 100,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      vehicleReadingsCount: vehicleAgg.readingsCount,
      meterReadingsCount: meterAgg.readingsCount,
      efficiencyAlert,
    };
  }
}
