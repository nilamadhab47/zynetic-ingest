import { Test, TestingModule } from '@nestjs/testing';
import { IngestionService } from './ingestion.service.js';
import { MeterRepository } from '../repositories/meter.repository.js';
import { VehicleRepository } from '../repositories/vehicle.repository.js';
import { MeterReadingDto } from '../dto/meter-reading.dto.js';
import { VehicleReadingDto } from '../dto/vehicle-reading.dto.js';

describe('IngestionService', () => {
  let service: IngestionService;
  let meterRepo: jest.Mocked<MeterRepository>;
  let vehicleRepo: jest.Mocked<VehicleRepository>;

  beforeEach(async () => {
    const mockMeterRepo = {
      upsertCurrentStatus: jest.fn().mockResolvedValue(undefined),
      insertTelemetry: jest.fn().mockResolvedValue(undefined),
      insertTelemetryBatch: jest.fn().mockResolvedValue(undefined),
    };

    const mockVehicleRepo = {
      upsertCurrentStatus: jest.fn().mockResolvedValue(undefined),
      insertTelemetry: jest.fn().mockResolvedValue(undefined),
      insertTelemetryBatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        { provide: MeterRepository, useValue: mockMeterRepo },
        { provide: VehicleRepository, useValue: mockVehicleRepo },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
    meterRepo = module.get(MeterRepository) as jest.Mocked<MeterRepository>;
    vehicleRepo = module.get(
      VehicleRepository,
    ) as jest.Mocked<VehicleRepository>;
  });

  describe('ingestMeterReading', () => {
    const meterDto: MeterReadingDto = {
      meterId: 'M1',
      kwhConsumedAc: 100.5,
      voltage: 230,
      timestamp: '2026-02-12T10:00:00Z',
    };

    it('should write to both hot and cold stores', async () => {
      await service.ingestMeterReading(meterDto);

      expect(meterRepo.upsertCurrentStatus).toHaveBeenCalledWith(meterDto);
      expect(meterRepo.insertTelemetry).toHaveBeenCalledWith(meterDto);
    });

    it('should call hot and cold paths concurrently', async () => {
      const calls: string[] = [];

      meterRepo.upsertCurrentStatus.mockImplementation(async () => {
        calls.push('upsert');
      });
      meterRepo.insertTelemetry.mockImplementation(async () => {
        calls.push('insert');
      });

      await service.ingestMeterReading(meterDto);

      expect(calls).toHaveLength(2);
      expect(calls).toContain('upsert');
      expect(calls).toContain('insert');
    });

    it('should propagate errors from hot store', async () => {
      meterRepo.upsertCurrentStatus.mockRejectedValue(
        new Error('DB write failed'),
      );

      await expect(service.ingestMeterReading(meterDto)).rejects.toThrow(
        'DB write failed',
      );
    });

    it('should propagate errors from cold store', async () => {
      meterRepo.insertTelemetry.mockRejectedValue(
        new Error('Partition missing'),
      );

      await expect(service.ingestMeterReading(meterDto)).rejects.toThrow(
        'Partition missing',
      );
    });
  });

  describe('ingestVehicleReading', () => {
    const vehicleDto: VehicleReadingDto = {
      vehicleId: 'V1',
      soc: 72,
      kwhDeliveredDc: 88.2,
      batteryTemp: 34,
      timestamp: '2026-02-12T10:00:00Z',
    };

    it('should write to both hot and cold stores', async () => {
      await service.ingestVehicleReading(vehicleDto);

      expect(vehicleRepo.upsertCurrentStatus).toHaveBeenCalledWith(vehicleDto);
      expect(vehicleRepo.insertTelemetry).toHaveBeenCalledWith(vehicleDto);
    });

    it('should propagate errors from repositories', async () => {
      vehicleRepo.upsertCurrentStatus.mockRejectedValue(
        new Error('Connection lost'),
      );

      await expect(service.ingestVehicleReading(vehicleDto)).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('ingestMeterBatch', () => {
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

    it('should upsert each reading and batch-insert telemetry', async () => {
      await service.ingestMeterBatch(readings);

      expect(meterRepo.upsertCurrentStatus).toHaveBeenCalledTimes(2);
      expect(meterRepo.upsertCurrentStatus).toHaveBeenCalledWith(readings[0]);
      expect(meterRepo.upsertCurrentStatus).toHaveBeenCalledWith(readings[1]);
      expect(meterRepo.insertTelemetryBatch).toHaveBeenCalledWith(readings);
    });
  });

  describe('ingestVehicleBatch', () => {
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

    it('should upsert each reading and batch-insert telemetry', async () => {
      await service.ingestVehicleBatch(readings);

      expect(vehicleRepo.upsertCurrentStatus).toHaveBeenCalledTimes(2);
      expect(vehicleRepo.insertTelemetryBatch).toHaveBeenCalledWith(readings);
    });
  });
});
