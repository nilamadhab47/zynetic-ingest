import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Global validation pipe: transforms payloads to DTO instances and validates
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger / OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('Zynetic Energy Ingestion Engine')
    .setDescription(
      'High-scale ingestion layer for Smart Meter and EV Fleet telemetry streams. ' +
        'Handles 14.4M+ records/day with hot/cold storage separation, ' +
        'partitioned tables, and indexed analytical queries.',
    )
    .setVersion('1.0.0')
    .addTag('Ingestion', 'Telemetry data ingestion endpoints')
    .addTag('Analytics', 'Performance analytics and efficiency reporting')
    .addTag('Health', 'System health checks')
    .addTag('Stress Testing', 'Load testing and performance benchmarking')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');  // Bind to all interfaces (required by Railway/cloud)
  logger.log(`Application running on http://0.0.0.0:${port}`);
  logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
