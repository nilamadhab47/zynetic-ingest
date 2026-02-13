import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsRepository } from '../repositories/analytics.repository.js';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let repo: jest.Mocked<AnalyticsRepository>;

  beforeEach(async () => {
    const mockRepo = {
      findMeterIdByVehicleId: jest.fn(),
      getVehicleAggregation: jest.fn(),
      getMeterAggregation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: AnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    repo = module.get(AnalyticsRepository) as jest.Mocked<AnalyticsRepository>;
  });

  describe('getPerformance', () => {
    it('should throw NotFoundException if no meter mapping exists', async () => {
      repo.findMeterIdByVehicleId.mockResolvedValue(null);

      await expect(service.getPerformance('V999')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getPerformance('V999')).rejects.toThrow(
        'No meter mapping found for vehicle: V999',
      );
    });

    it('should return a valid performance summary with correct efficiency', async () => {
      repo.findMeterIdByVehicleId.mockResolvedValue('M1');
      repo.getVehicleAggregation.mockResolvedValue({
        totalKwhDeliveredDc: 875,
        avgBatteryTemp: 33.5,
        readingsCount: 1440,
      });
      repo.getMeterAggregation.mockResolvedValue({
        totalKwhConsumedAc: 1000,
        readingsCount: 1440,
      });

      const result = await service.getPerformance('V1');

      expect(result.vehicleId).toBe('V1');
      expect(result.meterId).toBe('M1');
      expect(result.totalKwhConsumedAc).toBe(1000);
      expect(result.totalKwhDeliveredDc).toBe(875);
      expect(result.efficiencyRatio).toBe(0.875);
      expect(result.avgBatteryTemp).toBe(33.5);
      expect(result.vehicleReadingsCount).toBe(1440);
      expect(result.meterReadingsCount).toBe(1440);
      expect(result.efficiencyAlert).toBe(false);
    });

    it('should flag efficiency alert when ratio is below 85%', async () => {
      repo.findMeterIdByVehicleId.mockResolvedValue('M1');
      repo.getVehicleAggregation.mockResolvedValue({
        totalKwhDeliveredDc: 800,
        avgBatteryTemp: 40,
        readingsCount: 1440,
      });
      repo.getMeterAggregation.mockResolvedValue({
        totalKwhConsumedAc: 1000,
        readingsCount: 1440,
      });

      const result = await service.getPerformance('V1');

      expect(result.efficiencyRatio).toBe(0.8);
      expect(result.efficiencyAlert).toBe(true);
    });

    it('should handle zero AC consumption gracefully (null efficiency)', async () => {
      repo.findMeterIdByVehicleId.mockResolvedValue('M1');
      repo.getVehicleAggregation.mockResolvedValue({
        totalKwhDeliveredDc: 0,
        avgBatteryTemp: 0,
        readingsCount: 0,
      });
      repo.getMeterAggregation.mockResolvedValue({
        totalKwhConsumedAc: 0,
        readingsCount: 0,
      });

      const result = await service.getPerformance('V1');

      expect(result.efficiencyRatio).toBeNull();
      expect(result.efficiencyAlert).toBe(false);
    });

    it('should query both streams concurrently', async () => {
      repo.findMeterIdByVehicleId.mockResolvedValue('M1');

      const callOrder: string[] = [];
      repo.getVehicleAggregation.mockImplementation(async () => {
        callOrder.push('vehicle');
        return { totalKwhDeliveredDc: 100, avgBatteryTemp: 30, readingsCount: 10 };
      });
      repo.getMeterAggregation.mockImplementation(async () => {
        callOrder.push('meter');
        return { totalKwhConsumedAc: 120, readingsCount: 10 };
      });

      await service.getPerformance('V1');

      expect(repo.getVehicleAggregation).toHaveBeenCalledTimes(1);
      expect(repo.getMeterAggregation).toHaveBeenCalledTimes(1);
    });

    it('should set the correct 24-hour analysis window', async () => {
      repo.findMeterIdByVehicleId.mockResolvedValue('M1');
      repo.getVehicleAggregation.mockResolvedValue({
        totalKwhDeliveredDc: 100,
        avgBatteryTemp: 30,
        readingsCount: 10,
      });
      repo.getMeterAggregation.mockResolvedValue({
        totalKwhConsumedAc: 120,
        readingsCount: 10,
      });

      const before = new Date();
      const result = await service.getPerformance('V1');
      const after = new Date();

      const periodEnd = new Date(result.periodEnd);
      const periodStart = new Date(result.periodStart);

      // Period should be ~24 hours
      const diff = periodEnd.getTime() - periodStart.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);

      // Period end should be roughly "now"
      expect(periodEnd.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(periodEnd.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
