import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AnalyticsService } from '../services/analytics.service.js';
import { PerformanceResponseDto } from '../dto/performance-response.dto.js';

@ApiTags('Analytics')
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('performance/:vehicleId')
  @ApiOperation({
    summary: 'Get 24-hour performance summary for a vehicle',
    description:
      'Returns total AC consumed, DC delivered, efficiency ratio, and average battery temperature for the last 24 hours. ' +
      'Correlates vehicle and meter streams using the mapping table. ' +
      'Queries use composite indexes on partitioned tables -- no full table scan.',
  })
  @ApiParam({
    name: 'vehicleId',
    description: 'Vehicle identifier (e.g. V1)',
    example: 'V1',
  })
  @ApiResponse({
    status: 200,
    description: '24-hour performance summary',
    type: PerformanceResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No meter mapping found for the given vehicle',
  })
  async getPerformance(
    @Param('vehicleId') vehicleId: string,
  ): Promise<PerformanceResponseDto> {
    return this.analyticsService.getPerformance(vehicleId);
  }
}
