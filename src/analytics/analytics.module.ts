import { Module } from '@nestjs/common';
import { AnalyticsController } from './controllers/analytics.controller.js';
import { AnalyticsService } from './services/analytics.service.js';
import { AnalyticsRepository } from './repositories/analytics.repository.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRepository],
})
export class AnalyticsModule {}
