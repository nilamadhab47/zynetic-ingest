import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { DatabaseService } from '../database/database.service.js';

describe('HealthController', () => {
  let controller: HealthController;
  let dbService: jest.Mocked<DatabaseService>;

  beforeEach(async () => {
    const mockDb = {
      isHealthy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: mockDb }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    dbService = module.get(DatabaseService) as jest.Mocked<DatabaseService>;
  });

  it('should return ok status when database is healthy', async () => {
    dbService.isHealthy.mockResolvedValue(true);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(typeof result.uptime).toBe('number');
    expect(result.timestamp).toBeDefined();
  });

  it('should return degraded status when database is unhealthy', async () => {
    dbService.isHealthy.mockResolvedValue(false);

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
  });
});
