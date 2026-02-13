import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  ConflictException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { StressService } from './stress.service.js';
import { StressTestRequestDto } from './dto/stress-test-request.dto.js';
import { StressTestResponseDto } from './dto/stress-test-response.dto.js';

@ApiTags('Stress Testing')
@Controller('v1/stress')
export class StressController {
  constructor(private readonly stressService: StressService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run stress test against the ingestion engine',
    description:
      'Executes load tests using autocannon against the ingestion and analytics endpoints. ' +
      'Returns detailed latency percentiles, throughput, status code distribution, and a ' +
      'scale projection showing how the system handles the 14.4M records/day requirement. ' +
      'Only one stress test can run at a time.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stress test completed successfully with detailed results',
    type: StressTestResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'A stress test is already running',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid parameters',
  })
  async runStressTest(
    @Body() dto: StressTestRequestDto,
  ): Promise<StressTestResponseDto> {
    if (this.stressService.isRunning()) {
      throw new ConflictException(
        'A stress test is already running. Please wait for it to finish.',
      );
    }
    return this.stressService.runStressTest(dto);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Check if a stress test is currently running',
    description: 'Returns whether a stress test is currently in progress.',
  })
  @ApiResponse({ status: 200, description: 'Current stress test status' })
  getStatus(): { running: boolean } {
    return { running: this.stressService.isRunning() };
  }
}
