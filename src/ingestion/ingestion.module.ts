import { Module } from '@nestjs/common';
import { MeterIngestionController } from './controllers/meter-ingestion.controller.js';
import { VehicleIngestionController } from './controllers/vehicle-ingestion.controller.js';
import { IngestionService } from './services/ingestion.service.js';
import { MeterRepository } from './repositories/meter.repository.js';
import { VehicleRepository } from './repositories/vehicle.repository.js';

@Module({
  controllers: [MeterIngestionController, VehicleIngestionController],
  providers: [IngestionService, MeterRepository, VehicleRepository],
  exports: [IngestionService],
})
export class IngestionModule {}
