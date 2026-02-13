import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config.js';
import { DatabaseModule } from './database/database.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { StressModule } from './stress/stress.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      envFilePath: '.env',
    }),
    DatabaseModule,
    IngestionModule,
    AnalyticsModule,
    StressModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
