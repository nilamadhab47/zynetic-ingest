import { IsString, IsNumber, IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VehicleReadingDto {
  @ApiProperty({
    description: 'Unique vehicle identifier',
    example: 'V1',
  })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiProperty({
    description: 'State of Charge (battery percentage)',
    example: 72,
  })
  @IsNumber()
  soc: number;

  @ApiProperty({
    description: 'DC energy delivered to battery (kWh)',
    example: 88.2,
  })
  @IsNumber()
  kwhDeliveredDc: number;

  @ApiProperty({
    description: 'Battery temperature in Celsius',
    example: 34,
  })
  @IsNumber()
  batteryTemp: number;

  @ApiProperty({
    description: 'Timestamp of the reading (ISO 8601)',
    example: new Date().toISOString(),
  })
  @IsDateString()
  timestamp: string;
}
