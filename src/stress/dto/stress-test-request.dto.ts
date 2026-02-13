import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsIn, Min, Max } from 'class-validator';

export class StressTestRequestDto {
  @ApiProperty({
    description: 'Which test scenario to run',
    enum: ['meter', 'vehicle', 'batch', 'analytics', 'all'],
    example: 'all',
    default: 'all',
  })
  @IsOptional()
  @IsIn(['meter', 'vehicle', 'batch', 'analytics', 'all'])
  test?: string = 'all';

  @ApiPropertyOptional({
    description: 'Test duration in seconds',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 60,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(60)
  duration?: number = 10;

  @ApiPropertyOptional({
    description: 'Number of concurrent connections',
    example: 50,
    default: 50,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  connections?: number = 50;

  @ApiPropertyOptional({
    description: 'Batch size (only for batch test)',
    example: 100,
    default: 100,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  batchSize?: number = 100;
}
