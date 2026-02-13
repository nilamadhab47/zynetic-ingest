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
import { MeterReadingDto } from '../dto/meter-reading.dto.js';

@ApiTags('Ingestion')
@Controller('v1/ingest/meter')
export class MeterIngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest a single smart meter reading',
    description:
      'Receives a meter telemetry heartbeat. Writes to both hot (current status) and cold (historical) stores concurrently.',
  })
  @ApiResponse({
    status: 202,
    description: 'Reading accepted and persisted',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload (validation failed)',
  })
  async ingestMeter(
    @Body() dto: MeterReadingDto,
  ): Promise<{ status: string }> {
    await this.ingestionService.ingestMeterReading(dto);
    return { status: 'accepted' };
  }

  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest a batch of smart meter readings',
    description:
      'Accepts an array of meter readings for high-throughput bulk ingestion. Uses multi-row INSERT for cold path.',
  })
  @ApiBody({ type: [MeterReadingDto] })
  @ApiResponse({
    status: 202,
    description: 'Batch accepted and persisted',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload (validation failed)',
  })
  async ingestMeterBatch(
    @Body() readings: MeterReadingDto[],
  ): Promise<{ status: string; count: number }> {
    await this.ingestionService.ingestMeterBatch(readings);
    return { status: 'accepted', count: readings.length };
  }
}
