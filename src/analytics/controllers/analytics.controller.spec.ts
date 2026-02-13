import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { PerformanceResponseDto } from '../dto/performance-response.dto.js';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: jest.Mocked<AnalyticsService>;

  beforeEach(async () => {
    const mockService = {
      getPerformance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: mockService }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    service = module.get(AnalyticsService) as jest.Mocked<AnalyticsService>;
  });

  describe('getPerformance', () => {
    it('should return performance summary from service', async () => {
      const mockResponse: PerformanceResponseDto = {
        vehicleId: 'V1',
        meterId: 'M1',
        totalKwhConsumedAc: 1000,
        totalKwhDeliveredDc: 875,
        efficiencyRatio: 0.875,
        avgBatteryTemp: 33.5,
        periodStart: '2026-02-11T10:00:00.000Z',
        periodEnd: '2026-02-12T10:00:00.000Z',
        vehicleReadingsCount: 1440,
        meterReadingsCount: 1440,
        efficiencyAlert: false,
      };

      service.getPerformance.mockResolvedValue(mockResponse);

      const result = await controller.getPerformance('V1');

      expect(service.getPerformance).toHaveBeenCalledWith('V1');
      expect(result).toEqual(mockResponse);
    });

    it('should propagate NotFoundException from service', async () => {
      service.getPerformance.mockRejectedValue(
        new NotFoundException('No meter mapping found for vehicle: V999'),
      );

      await expect(controller.getPerformance('V999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
