import { ApiProperty } from '@nestjs/swagger';

export class LatencyStats {
  @ApiProperty({ example: 5.65 })
  average: number;

  @ApiProperty({ example: 5 })
  p50: number;

  @ApiProperty({ example: 6 })
  p90: number;

  @ApiProperty({ example: 14 })
  p99: number;

  @ApiProperty({ example: 61 })
  max: number;

  @ApiProperty({ example: 5 })
  min: number;
}

export class StatusCodes {
  @ApiProperty({ example: 162715, description: 'Successful responses (2xx)' })
  '2xx': number;

  @ApiProperty({ example: 0, description: 'Client errors (4xx)' })
  '4xx': number;

  @ApiProperty({ example: 0, description: 'Server errors (5xx)' })
  '5xx': number;
}

export class ScenarioResult {
  @ApiProperty({ example: 'Single Meter Ingestion' })
  name: string;

  @ApiProperty({ example: 'POST /v1/ingest/meter' })
  endpoint: string;

  @ApiProperty({ example: 10 })
  durationSeconds: number;

  @ApiProperty({ example: 50 })
  connections: number;

  @ApiProperty({ example: 162715 })
  totalRequests: number;

  @ApiProperty({ example: 8132 })
  requestsPerSecond: number;

  @ApiProperty({ example: 42631330 })
  totalBytes: number;

  @ApiProperty({ type: LatencyStats })
  latency: LatencyStats;

  @ApiProperty({ type: StatusCodes })
  statusCodes: StatusCodes;

  @ApiProperty({ example: 0 })
  errors: number;

  @ApiProperty({ example: 0 })
  timeouts: number;

  @ApiProperty({ example: '0%' })
  errorRate: string;
}

export class ScaleProjection {
  @ApiProperty({
    example: 16443,
    description: 'Combined single-request throughput (meter + vehicle)',
  })
  combinedRequestsPerSecond: number;

  @ApiProperty({
    example: 1420675200,
    description: 'Projected daily capacity in records',
  })
  dailyCapacity: number;

  @ApiProperty({ example: 14400000, description: 'Required daily records' })
  requiredDaily: number;

  @ApiProperty({
    example: 98.7,
    description: 'How many times over the requirement we can handle',
  })
  headroom: number;

  @ApiProperty({
    example: 38300,
    description: 'Effective records/s using batch endpoint',
    required: false,
  })
  batchEffectiveRecordsPerSecond?: number;

  @ApiProperty({
    example: 3309120000,
    description: 'Projected daily capacity using batch endpoint',
    required: false,
  })
  batchDailyCapacity?: number;

  @ApiProperty({
    example: 229.8,
    description: 'Headroom using batch endpoint',
    required: false,
  })
  batchHeadroom?: number;
}

export class StressTestResponseDto {
  @ApiProperty({
    description: 'Individual scenario results',
    type: [ScenarioResult],
  })
  scenarios: ScenarioResult[];

  @ApiProperty({
    description: 'Scale projection based on results',
    type: ScaleProjection,
    required: false,
  })
  scaleProjection?: ScaleProjection;

  @ApiProperty({ example: '2026-02-12T10:00:00.000Z' })
  startedAt: string;

  @ApiProperty({ example: '2026-02-12T10:01:30.000Z' })
  completedAt: string;

  @ApiProperty({ example: 80.5, description: 'Total test runtime in seconds' })
  totalDurationSeconds: number;
}
