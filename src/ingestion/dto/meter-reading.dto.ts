import { IsString, IsNumber, IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MeterReadingDto {
  @ApiProperty({
    description: 'Unique meter identifier',
    example: 'M1',
  })
  @IsString()
  @IsNotEmpty()
  meterId: string;

  @ApiProperty({
    description: 'AC energy consumed from grid (kWh)',
    example: 100.5,
  })
  @IsNumber()
  kwhConsumedAc: number;

  @ApiProperty({
    description: 'Grid voltage reading',
    example: 230,
  })
  @IsNumber()
  voltage: number;

  @ApiProperty({
    description: 'Timestamp of the reading (ISO 8601)',
    example: new Date().toISOString(),
  })
  @IsDateString()
  timestamp: string;
}
