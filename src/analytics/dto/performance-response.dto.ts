import { ApiProperty } from '@nestjs/swagger';

export class PerformanceResponseDto {
  @ApiProperty({ description: 'Vehicle identifier', example: 'V1' })
  vehicleId: string;

  @ApiProperty({
    description: 'Correlated meter identifier',
    example: 'M1',
  })
  meterId: string;

  @ApiProperty({
    description: 'Total AC energy consumed from grid (kWh) in the period',
    example: 1200.5,
  })
  totalKwhConsumedAc: number;

  @ApiProperty({
    description: 'Total DC energy delivered to battery (kWh) in the period',
    example: 1050.3,
  })
  totalKwhDeliveredDc: number;

  @ApiProperty({
    description:
      'Efficiency ratio (DC Delivered / AC Consumed). Below 0.85 indicates hardware issue.',
    example: 0.875,
  })
  efficiencyRatio: number | null;

  @ApiProperty({
    description: 'Average battery temperature in Celsius over the period',
    example: 33.2,
  })
  avgBatteryTemp: number;

  @ApiProperty({
    description: 'Start of the 24-hour analysis window (ISO 8601)',
    example: '2026-02-11T10:00:00.000Z',
  })
  periodStart: string;

  @ApiProperty({
    description: 'End of the 24-hour analysis window (ISO 8601)',
    example: '2026-02-12T10:00:00.000Z',
  })
  periodEnd: string;

  @ApiProperty({
    description: 'Number of vehicle telemetry readings in the period',
    example: 1440,
  })
  vehicleReadingsCount: number;

  @ApiProperty({
    description: 'Number of meter telemetry readings in the period',
    example: 1440,
  })
  meterReadingsCount: number;

  @ApiProperty({
    description:
      'Warning flag if efficiency is below 85% threshold',
    example: false,
  })
  efficiencyAlert: boolean;
}
