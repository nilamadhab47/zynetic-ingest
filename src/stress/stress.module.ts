import { Module } from '@nestjs/common';
import { StressController } from './stress.controller.js';
import { StressService } from './stress.service.js';

@Module({
  controllers: [StressController],
  providers: [StressService],
})
export class StressModule {}
