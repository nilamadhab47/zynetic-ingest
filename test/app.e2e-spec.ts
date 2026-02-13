import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

/**
 * E2E tests for the Energy Ingestion Engine.
 * Uses a mocked DatabaseService to avoid needing a real PostgreSQL instance.
 */
describe('Energy Ingestion Engine (e2e)', () => {
  let app: INestApplication<App>;

  // Track all queries executed
  const executedQueries: { text: string; params: any[] }[] = [];

  const mockDatabaseService = {
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockResolvedValue(true),
    query: jest.fn().mockImplementation(async (text: string, params?: any[]) => {
      executedQueries.push({ text, params: params || [] });

      // Mock vehicle_meter_mapping lookup
      if (text.includes('vehicle_meter_mapping')) {
        if (params && params[0] === 'V1') {
          return { rows: [{ meter_id: 'M1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Mock vehicle aggregation
      if (
        text.includes('vehicle_telemetry') &&
        text.includes('SUM')
      ) {
        return {
          rows: [
            {
              total_kwh_delivered_dc: '875.00',
              avg_battery_temp: '33.50',
              readings_count: '1440',
            },
          ],
          rowCount: 1,
        };
      }

      // Mock meter aggregation
      if (
        text.includes('meter_telemetry') &&
        text.includes('SUM')
      ) {
        return {
          rows: [
            {
              total_kwh_consumed_ac: '1000.00',
              readings_count: '1440',
            },
          ],
          rowCount: 1,
        };
      }

      // Default: INSERT/UPSERT returns rowCount 1
      return { rows: [], rowCount: 1 };
    }),
    getClient: jest.fn(),
    transaction: jest.fn(),
    ensurePartitionForDate: jest.fn().mockResolvedValue(undefined),
    ensurePartitions: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(mockDatabaseService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    executedQueries.length = 0;
    jest.clearAllMocks();
  });

  // ==========================================
  // Health Check
  // ==========================================

  describe('GET /health', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.database).toBe('connected');
          expect(res.body.timestamp).toBeDefined();
        });
    });
  });

  // ==========================================
  // Meter Ingestion
  // ==========================================

  describe('POST /v1/ingest/meter', () => {
    it('should accept a valid meter reading', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/meter')
        .send({
          meterId: 'M1',
          kwhConsumedAc: 100.5,
          voltage: 230,
          timestamp: '2026-02-12T10:00:00Z',
        })
        .expect(202)
        .expect((res) => {
          expect(res.body.status).toBe('accepted');
        });
    });

    it('should reject an invalid meter reading (missing fields)', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/meter')
        .send({
          meterId: 'M1',
          // missing kwhConsumedAc, voltage, timestamp
        })
        .expect(400);
    });

    it('should reject unknown fields', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/meter')
        .send({
          meterId: 'M1',
          kwhConsumedAc: 100.5,
          voltage: 230,
          timestamp: '2026-02-12T10:00:00Z',
          unknownField: 'should be rejected',
        })
        .expect(400);
    });

    it('should reject invalid timestamp format', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/meter')
        .send({
          meterId: 'M1',
          kwhConsumedAc: 100.5,
          voltage: 230,
          timestamp: 'not-a-date',
        })
        .expect(400);
    });

    it('should write to both hot and cold stores', async () => {
      await request(app.getHttpServer())
        .post('/v1/ingest/meter')
        .send({
          meterId: 'M1',
          kwhConsumedAc: 100.5,
          voltage: 230,
          timestamp: '2026-02-12T10:00:00Z',
        })
        .expect(202);

      // Verify UPSERT (hot) and INSERT (cold) were both called
      const upsertQuery = executedQueries.find((q) =>
        q.text.includes('meter_current_status'),
      );
      const insertQuery = executedQueries.find((q) =>
        q.text.includes('meter_telemetry'),
      );

      expect(upsertQuery).toBeDefined();
      expect(insertQuery).toBeDefined();
    });
  });

  // ==========================================
  // Vehicle Ingestion
  // ==========================================

  describe('POST /v1/ingest/vehicle', () => {
    it('should accept a valid vehicle reading', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/vehicle')
        .send({
          vehicleId: 'V1',
          soc: 72,
          kwhDeliveredDc: 88.2,
          batteryTemp: 34,
          timestamp: '2026-02-12T10:00:00Z',
        })
        .expect(202)
        .expect((res) => {
          expect(res.body.status).toBe('accepted');
        });
    });

    it('should reject an invalid vehicle reading', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/vehicle')
        .send({
          vehicleId: 'V1',
          soc: 'not-a-number', // should be number
          kwhDeliveredDc: 88.2,
          batteryTemp: 34,
          timestamp: '2026-02-12T10:00:00Z',
        })
        .expect(400);
    });
  });

  // ==========================================
  // Batch Ingestion
  // ==========================================

  describe('POST /v1/ingest/meter/batch', () => {
    it('should accept a batch of meter readings', () => {
      return request(app.getHttpServer())
        .post('/v1/ingest/meter/batch')
        .send([
          {
            meterId: 'M1',
            kwhConsumedAc: 100,
            voltage: 230,
            timestamp: '2026-02-12T10:00:00Z',
          },
          {
            meterId: 'M2',
            kwhConsumedAc: 200,
            voltage: 231,
            timestamp: '2026-02-12T10:00:00Z',
          },
        ])
        .expect(202)
        .expect((res) => {
          expect(res.body.status).toBe('accepted');
          expect(res.body.count).toBe(2);
        });
    });
  });

  // ==========================================
  // Analytics
  // ==========================================

  describe('GET /v1/analytics/performance/:vehicleId', () => {
    it('should return performance summary for a mapped vehicle', () => {
      return request(app.getHttpServer())
        .get('/v1/analytics/performance/V1')
        .expect(200)
        .expect((res) => {
          expect(res.body.vehicleId).toBe('V1');
          expect(res.body.meterId).toBe('M1');
          expect(res.body.totalKwhConsumedAc).toBe(1000);
          expect(res.body.totalKwhDeliveredDc).toBe(875);
          expect(res.body.efficiencyRatio).toBe(0.875);
          expect(res.body.avgBatteryTemp).toBe(33.5);
          expect(res.body.efficiencyAlert).toBe(false);
          expect(res.body.periodStart).toBeDefined();
          expect(res.body.periodEnd).toBeDefined();
        });
    });

    it('should return 404 for unmapped vehicle', () => {
      return request(app.getHttpServer())
        .get('/v1/analytics/performance/V999')
        .expect(404);
    });
  });
});
