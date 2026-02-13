import { Test, TestingModule } from '@nestjs/testing';
import { VehicleIngestionController } from './vehicle-ingestion.controller.js';
import { IngestionService } from '../services/ingestion.service.js';
import { VehicleReadingDto } from '../dto/vehicle-reading.dto.js';

describe('VehicleIngestionController', () => {
  let controller: VehicleIngestionController;
  let service: jest.Mocked<IngestionService>;

  beforeEach(async () => {
    const mockService = {
      ingestVehicleReading: jest.fn().mockResolvedValue(undefined),
      ingestVehicleBatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VehicleIngestionController],
      providers: [{ provide: IngestionService, useValue: mockService }],
    }).compile();

    controller = module.get<VehicleIngestionController>(
      VehicleIngestionController,
    );
    service = module.get(IngestionService) as jest.Mocked<IngestionService>;
  });

  describe('ingestVehicle', () => {
    it('should call ingestion service and return accepted status', async () => {
      const dto: VehicleReadingDto = {
        vehicleId: 'V1',
        soc: 72,
        kwhDeliveredDc: 88.2,
        batteryTemp: 34,
        timestamp: '2026-02-12T10:00:00Z',
      };

      const result = await controller.ingestVehicle(dto);

      expect(service.ingestVehicleReading).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ status: 'accepted' });
    });

    it('should propagate service errors', async () => {
      service.ingestVehicleReading.mockRejectedValue(new Error('DB error'));

      const dto: VehicleReadingDto = {
        vehicleId: 'V1',
        soc: 72,
        kwhDeliveredDc: 88.2,
        batteryTemp: 34,
        timestamp: '2026-02-12T10:00:00Z',
      };

      await expect(controller.ingestVehicle(dto)).rejects.toThrow('DB error');
    });
  });

  describe('ingestVehicleBatch', () => {
    it('should call batch ingestion and return count', async () => {
      const readings: VehicleReadingDto[] = [
        {
          vehicleId: 'V1',
          soc: 72,
          kwhDeliveredDc: 88,
          batteryTemp: 34,
          timestamp: '2026-02-12T10:00:00Z',
        },
        {
          vehicleId: 'V2',
          soc: 65,
          kwhDeliveredDc: 75,
          batteryTemp: 32,
          timestamp: '2026-02-12T10:00:00Z',
        },
      ];

      const result = await controller.ingestVehicleBatch(readings);

      expect(service.ingestVehicleBatch).toHaveBeenCalledWith(readings);
      expect(result).toEqual({ status: 'accepted', count: 2 });
    });
  });
});
