import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { IngestionService } from '../services/ingestion.service.js';
import { VehicleReadingDto } from '../dto/vehicle-reading.dto.js';

@ApiTags('Ingestion')
@Controller('v1/ingest/vehicle')
export class VehicleIngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest a single vehicle telemetry reading',
    description:
      'Receives a vehicle telemetry heartbeat (SoC, DC energy, battery temp). Writes to both hot and cold stores concurrently.',
  })
  @ApiResponse({
    status: 202,
    description: 'Reading accepted and persisted',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload (validation failed)',
  })
  async ingestVehicle(
    @Body() dto: VehicleReadingDto,
  ): Promise<{ status: string }> {
    await this.ingestionService.ingestVehicleReading(dto);
    return { status: 'accepted' };
  }

  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest a batch of vehicle telemetry readings',
    description:
      'Accepts an array of vehicle readings for high-throughput bulk ingestion. Uses multi-row INSERT for cold path.',
  })
  @ApiBody({ type: [VehicleReadingDto] })
  @ApiResponse({
    status: 202,
    description: 'Batch accepted and persisted',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload (validation failed)',
  })
  async ingestVehicleBatch(
    @Body() readings: VehicleReadingDto[],
  ): Promise<{ status: string; count: number }> {
    await this.ingestionService.ingestVehicleBatch(readings);
    return { status: 'accepted', count: readings.length };
  }
}
