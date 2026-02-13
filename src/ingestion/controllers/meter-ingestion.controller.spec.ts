import { Test, TestingModule } from '@nestjs/testing';
import { MeterIngestionController } from './meter-ingestion.controller.js';
import { IngestionService } from '../services/ingestion.service.js';
import { MeterReadingDto } from '../dto/meter-reading.dto.js';

describe('MeterIngestionController', () => {
  let controller: MeterIngestionController;
  let service: jest.Mocked<IngestionService>;

  beforeEach(async () => {
    const mockService = {
      ingestMeterReading: jest.fn().mockResolvedValue(undefined),
      ingestMeterBatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeterIngestionController],
      providers: [{ provide: IngestionService, useValue: mockService }],
    }).compile();

    controller = module.get<MeterIngestionController>(MeterIngestionController);
    service = module.get(IngestionService) as jest.Mocked<IngestionService>;
  });

  describe('ingestMeter', () => {
    it('should call ingestion service and return accepted status', async () => {
      const dto: MeterReadingDto = {
        meterId: 'M1',
        kwhConsumedAc: 100.5,
        voltage: 230,
        timestamp: '2026-02-12T10:00:00Z',
      };

      const result = await controller.ingestMeter(dto);

      expect(service.ingestMeterReading).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ status: 'accepted' });
    });

    it('should propagate service errors', async () => {
      service.ingestMeterReading.mockRejectedValue(new Error('DB error'));

      const dto: MeterReadingDto = {
        meterId: 'M1',
        kwhConsumedAc: 100.5,
        voltage: 230,
        timestamp: '2026-02-12T10:00:00Z',
      };

      await expect(controller.ingestMeter(dto)).rejects.toThrow('DB error');
    });
  });

  describe('ingestMeterBatch', () => {
    it('should call batch ingestion and return count', async () => {
      const readings: MeterReadingDto[] = [
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
      ];

      const result = await controller.ingestMeterBatch(readings);

      expect(service.ingestMeterBatch).toHaveBeenCalledWith(readings);
      expect(result).toEqual({ status: 'accepted', count: 2 });
    });
  });
});
