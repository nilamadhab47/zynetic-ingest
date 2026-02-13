import { Injectable, Logger } from '@nestjs/common';
import { MeterRepository } from '../repositories/meter.repository.js';
import { VehicleRepository } from '../repositories/vehicle.repository.js';
import { MeterReadingDto } from '../dto/meter-reading.dto.js';
import { VehicleReadingDto } from '../dto/vehicle-reading.dto.js';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly meterRepository: MeterRepository,
    private readonly vehicleRepository: VehicleRepository,
  ) {}

  /**
   * Ingest a single meter reading:
   * 1. UPSERT into hot store (current status for dashboard)
   * 2. INSERT into cold store (historical telemetry for analytics)
   *
   * Both writes run concurrently for maximum throughput.
   */
  async ingestMeterReading(dto: MeterReadingDto): Promise<void> {
    this.logger.debug(`Ingesting meter reading: ${dto.meterId}`);

    await Promise.all([
      this.meterRepository.upsertCurrentStatus(dto),
      this.meterRepository.insertTelemetry(dto),
    ]);
  }

  /**
   * Ingest a single vehicle reading:
   * 1. UPSERT into hot store (current status for dashboard)
   * 2. INSERT into cold store (historical telemetry for analytics)
   *
   * Both writes run concurrently for maximum throughput.
   */
  async ingestVehicleReading(dto: VehicleReadingDto): Promise<void> {
    this.logger.debug(`Ingesting vehicle reading: ${dto.vehicleId}`);

    await Promise.all([
      this.vehicleRepository.upsertCurrentStatus(dto),
      this.vehicleRepository.insertTelemetry(dto),
    ]);
  }

  /**
   * Batch ingest meter readings for high-throughput scenarios
   * Hot path: individual upserts (each device needs latest state)
   * Cold path: single batch insert (maximum write throughput)
   */
  async ingestMeterBatch(readings: MeterReadingDto[]): Promise<void> {
    this.logger.debug(`Batch ingesting ${readings.length} meter readings`);

    await Promise.all([
      // Hot: upsert each (order matters per device)
      ...readings.map((dto) => this.meterRepository.upsertCurrentStatus(dto)),
      // Cold: single batch insert
      this.meterRepository.insertTelemetryBatch(readings),
    ]);
  }

  /**
   * Batch ingest vehicle readings for high-throughput scenarios
   */
  async ingestVehicleBatch(readings: VehicleReadingDto[]): Promise<void> {
    this.logger.debug(`Batch ingesting ${readings.length} vehicle readings`);

    await Promise.all([
      ...readings.map((dto) =>
        this.vehicleRepository.upsertCurrentStatus(dto),
      ),
      this.vehicleRepository.insertTelemetryBatch(readings),
    ]);
  }
}
