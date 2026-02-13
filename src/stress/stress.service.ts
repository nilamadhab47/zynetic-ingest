import { Injectable, Logger } from '@nestjs/common';
import autocannon from 'autocannon';
import { StressTestRequestDto } from './dto/stress-test-request.dto.js';
import {
  StressTestResponseDto,
  ScenarioResult,
  ScaleProjection,
} from './dto/stress-test-response.dto.js';

const DEVICE_COUNT = 10000;
const REQUIRED_DAILY = 14_400_000;

@Injectable()
export class StressService {
  private readonly logger = new Logger(StressService.name);
  private running = false;

  // ─── Payload Generators ───────────────────────────────────────

  private meterPayload(): string {
    return JSON.stringify({
      meterId: `M${Math.floor(Math.random() * DEVICE_COUNT) + 1}`,
      kwhConsumedAc: +(Math.random() * 200 + 50).toFixed(2),
      voltage: +(Math.random() * 10 + 225).toFixed(1),
      timestamp: new Date().toISOString(),
    });
  }

  private vehiclePayload(): string {
    return JSON.stringify({
      vehicleId: `V${Math.floor(Math.random() * DEVICE_COUNT) + 1}`,
      soc: +(Math.random() * 100).toFixed(1),
      kwhDeliveredDc: +(Math.random() * 150 + 30).toFixed(2),
      batteryTemp: +(Math.random() * 20 + 25).toFixed(1),
      timestamp: new Date().toISOString(),
    });
  }

  private meterBatchPayload(batchSize: number): string {
    const readings: any[] = [];
    for (let i = 0; i < batchSize; i++) {
      readings.push({
        meterId: `M${Math.floor(Math.random() * DEVICE_COUNT) + 1}`,
        kwhConsumedAc: +(Math.random() * 200 + 50).toFixed(2),
        voltage: +(Math.random() * 10 + 225).toFixed(1),
        timestamp: new Date().toISOString(),
      });
    }
    return JSON.stringify(readings);
  }

  // ─── Scenario Definitions ─────────────────────────────────────

  private getScenarios(
    baseUrl: string,
    duration: number,
    connections: number,
    batchSize: number,
  ) {
    return {
      meter: {
        name: 'Single Meter Ingestion',
        endpoint: 'POST /v1/ingest/meter',
        config: {
          url: `${baseUrl}/v1/ingest/meter`,
          method: 'POST' as const,
          headers: { 'Content-Type': 'application/json' },
          requests: [
            {
              setupRequest: (req: any) => ({
                ...req,
                body: this.meterPayload(),
              }),
            },
          ],
          duration,
          connections,
        },
      },
      vehicle: {
        name: 'Single Vehicle Ingestion',
        endpoint: 'POST /v1/ingest/vehicle',
        config: {
          url: `${baseUrl}/v1/ingest/vehicle`,
          method: 'POST' as const,
          headers: { 'Content-Type': 'application/json' },
          requests: [
            {
              setupRequest: (req: any) => ({
                ...req,
                body: this.vehiclePayload(),
              }),
            },
          ],
          duration,
          connections,
        },
      },
      batch: {
        name: `Batch Meter Ingestion (${batchSize} per request)`,
        endpoint: 'POST /v1/ingest/meter/batch',
        config: {
          url: `${baseUrl}/v1/ingest/meter/batch`,
          method: 'POST' as const,
          headers: { 'Content-Type': 'application/json' },
          requests: [
            {
              setupRequest: (req: any) => ({
                ...req,
                body: this.meterBatchPayload(batchSize),
              }),
            },
          ],
          duration,
          connections: Math.min(connections, 20),
        },
      },
      analytics: {
        name: 'Analytics Query',
        endpoint: 'GET /v1/analytics/performance/V1',
        config: {
          url: `${baseUrl}/v1/analytics/performance/V1`,
          method: 'GET' as const,
          duration,
          connections: Math.min(connections, 20),
        },
      },
    };
  }

  // ─── Run a Single Scenario ────────────────────────────────────

  private runScenario(
    name: string,
    endpoint: string,
    config: any,
  ): Promise<ScenarioResult> {
    return new Promise((resolve, reject) => {
      autocannon(config, (err: any, result: any) => {
        if (err) return reject(err);

        const rps = Math.round(result.requests.total / result.duration);
        const errCount = (result['5xx'] || 0) + (result.errors || 0);
        const errRate =
          result.requests.total > 0
            ? ((errCount / result.requests.total) * 100).toFixed(2) + '%'
            : '0%';

        resolve({
          name,
          endpoint,
          durationSeconds: result.duration,
          connections: result.connections,
          totalRequests: result.requests.total,
          requestsPerSecond: rps,
          totalBytes: result.throughput.total,
          latency: {
            average: +result.latency.average.toFixed(2),
            p50: result.latency.p50,
            p90: result.latency.p90,
            p99: result.latency.p99,
            max: result.latency.max,
            min: result.latency.min,
          },
          statusCodes: {
            '2xx': result['2xx'] || 0,
            '4xx': result['4xx'] || 0,
            '5xx': result['5xx'] || 0,
          },
          errors: result.errors || 0,
          timeouts: result.timeouts || 0,
          errorRate: errRate,
        });
      });
    });
  }

  // ─── Public API ───────────────────────────────────────────────

  isRunning(): boolean {
    return this.running;
  }

  async runStressTest(
    dto: StressTestRequestDto,
  ): Promise<StressTestResponseDto> {
    if (this.running) {
      throw new Error(
        'A stress test is already running. Please wait for it to finish.',
      );
    }

    this.running = true;
    const startedAt = new Date();

    try {
      const port = process.env.PORT ?? 3000;
      const baseUrl = `http://localhost:${port}`;
      const duration = dto.duration ?? 10;
      const connections = dto.connections ?? 50;
      const batchSize = dto.batchSize ?? 100;

      const allScenarios = this.getScenarios(
        baseUrl,
        duration,
        connections,
        batchSize,
      );

      // Determine which scenarios to run
      const testKey = dto.test ?? 'all';
      const keysToRun: string[] =
        testKey === 'all'
          ? Object.keys(allScenarios)
          : [testKey];

      this.logger.log(
        `Starting stress test: scenarios=${keysToRun.join(',')} duration=${duration}s connections=${connections}`,
      );

      const scenarios: ScenarioResult[] = [];

      for (const key of keysToRun) {
        const scenario = allScenarios[key as keyof typeof allScenarios];
        if (!scenario) continue;

        this.logger.log(`Running scenario: ${scenario.name}`);
        const result = await this.runScenario(
          scenario.name,
          scenario.endpoint,
          scenario.config,
        );
        scenarios.push(result);
        this.logger.log(
          `Completed: ${scenario.name} -- ${result.requestsPerSecond} req/s, ${result.errorRate} errors`,
        );
      }

      // Build scale projection if we have meter + vehicle results
      let scaleProjection: ScaleProjection | undefined;
      const meterResult = scenarios.find((s) =>
        s.name.includes('Single Meter'),
      );
      const vehicleResult = scenarios.find((s) =>
        s.name.includes('Single Vehicle'),
      );
      const batchResult = scenarios.find((s) => s.name.includes('Batch'));

      if (meterResult || vehicleResult) {
        const meterRps = meterResult?.requestsPerSecond ?? 0;
        const vehicleRps = vehicleResult?.requestsPerSecond ?? 0;
        const combinedRps = meterRps + vehicleRps;
        const dailyCapacity = combinedRps * 60 * 60 * 24;

        scaleProjection = {
          combinedRequestsPerSecond: combinedRps,
          dailyCapacity,
          requiredDaily: REQUIRED_DAILY,
          headroom: +(dailyCapacity / REQUIRED_DAILY).toFixed(1),
        };

        if (batchResult) {
          const batchEffective = batchResult.requestsPerSecond * batchSize;
          const batchDaily = batchEffective * 60 * 60 * 24;
          scaleProjection.batchEffectiveRecordsPerSecond = batchEffective;
          scaleProjection.batchDailyCapacity = batchDaily;
          scaleProjection.batchHeadroom = +(
            batchDaily / REQUIRED_DAILY
          ).toFixed(1);
        }
      }

      const completedAt = new Date();

      return {
        scenarios,
        scaleProjection,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        totalDurationSeconds: +(
          (completedAt.getTime() - startedAt.getTime()) /
          1000
        ).toFixed(1),
      };
    } finally {
      this.running = false;
    }
  }
}
