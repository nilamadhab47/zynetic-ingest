#!/usr/bin/env node

/**
 * Stress Test for Zynetic Energy Ingestion Engine
 *
 * Simulates real-world load:
 *   - 10,000 devices
 *   - 2 streams (meter + vehicle) per device
 *   - 1 reading every 60 seconds
 *   - Target: ~333 requests/second (20,000 per minute)
 *
 * Usage:
 *   node test/stress/stress-test.js                          # Run all tests
 *   node test/stress/stress-test.js --test meter             # Meter ingestion only
 *   node test/stress/stress-test.js --test vehicle           # Vehicle ingestion only
 *   node test/stress/stress-test.js --test batch             # Batch ingestion only
 *   node test/stress/stress-test.js --test analytics         # Analytics only
 *   node test/stress/stress-test.js --duration 30            # Custom duration (seconds)
 *   node test/stress/stress-test.js --connections 100        # Custom concurrency
 */

const autocannon = require('autocannon');

// ─── Configuration ───────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEVICE_COUNT = 10000;
const DEFAULT_DURATION = 20; // seconds
const DEFAULT_CONNECTIONS = 50; // concurrent connections

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};

const testFilter = getArg('test'); // meter | vehicle | batch | analytics | null (all)
const duration = parseInt(getArg('duration') || DEFAULT_DURATION, 10);
const connections = parseInt(getArg('connections') || DEFAULT_CONNECTIONS, 10);

// ─── Payload Generators ──────────────────────────────────────────

function randomMeterId() {
  return `M${Math.floor(Math.random() * DEVICE_COUNT) + 1}`;
}

function randomVehicleId() {
  return `V${Math.floor(Math.random() * DEVICE_COUNT) + 1}`;
}

function meterPayload() {
  return JSON.stringify({
    meterId: randomMeterId(),
    kwhConsumedAc: +(Math.random() * 200 + 50).toFixed(2),
    voltage: +(Math.random() * 10 + 225).toFixed(1),
    timestamp: new Date().toISOString(),
  });
}

function vehiclePayload() {
  return JSON.stringify({
    vehicleId: randomVehicleId(),
    soc: +(Math.random() * 100).toFixed(1),
    kwhDeliveredDc: +(Math.random() * 150 + 30).toFixed(2),
    batteryTemp: +(Math.random() * 20 + 25).toFixed(1),
    timestamp: new Date().toISOString(),
  });
}

function meterBatchPayload(batchSize = 100) {
  const readings = [];
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

function vehicleBatchPayload(batchSize = 100) {
  const readings = [];
  for (let i = 0; i < batchSize; i++) {
    readings.push({
      vehicleId: `V${Math.floor(Math.random() * DEVICE_COUNT) + 1}`,
      soc: +(Math.random() * 100).toFixed(1),
      kwhDeliveredDc: +(Math.random() * 150 + 30).toFixed(2),
      batteryTemp: +(Math.random() * 20 + 25).toFixed(1),
      timestamp: new Date().toISOString(),
    });
  }
  return JSON.stringify(readings);
}

// ─── Test Definitions ────────────────────────────────────────────

const tests = {
  meter: {
    name: 'Single Meter Ingestion',
    description: 'POST /v1/ingest/meter - one meter reading per request',
    config: {
      url: `${BASE_URL}/v1/ingest/meter`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // setupRequest generates a fresh payload per request
      requests: [{ setupRequest: (req) => ({ ...req, body: meterPayload() }) }],
      duration,
      connections,
    },
  },

  vehicle: {
    name: 'Single Vehicle Ingestion',
    description: 'POST /v1/ingest/vehicle - one vehicle reading per request',
    config: {
      url: `${BASE_URL}/v1/ingest/vehicle`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      requests: [{ setupRequest: (req) => ({ ...req, body: vehiclePayload() }) }],
      duration,
      connections,
    },
  },

  batch: {
    name: 'Batch Meter Ingestion (100 per request)',
    description: 'POST /v1/ingest/meter/batch - 100 meter readings per request',
    config: {
      url: `${BASE_URL}/v1/ingest/meter/batch`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      requests: [{ setupRequest: (req) => ({ ...req, body: meterBatchPayload(100) }) }],
      duration,
      connections: Math.min(connections, 20), // fewer connections for batch (each does 100x work)
    },
  },

  analytics: {
    name: 'Analytics Query',
    description: 'GET /v1/analytics/performance/:vehicleId - 24h aggregation',
    config: {
      url: `${BASE_URL}/v1/analytics/performance/V1`,
      method: 'GET',
      duration,
      connections: Math.min(connections, 20),
    },
  },
};

// ─── Runner ──────────────────────────────────────────────────────

function formatNumber(n) {
  return n.toLocaleString();
}

function printResult(name, result) {
  const divider = '═'.repeat(60);
  console.log(`\n${divider}`);
  console.log(`  ${name}`);
  console.log(divider);
  console.log(`  Duration:        ${result.duration}s`);
  console.log(`  Connections:     ${result.connections}`);
  console.log(`  Total Requests:  ${formatNumber(result.requests.total)}`);
  console.log(`  Throughput:      ${formatNumber(Math.round(result.requests.total / result.duration))} req/s`);
  console.log(`  Bytes:           ${formatNumber(result.throughput.total)} bytes`);
  console.log('');
  console.log('  Latency (ms):');
  console.log(`    Average:       ${result.latency.average.toFixed(2)}`);
  console.log(`    p50:           ${result.latency.p50}`);
  console.log(`    p90:           ${result.latency.p90}`);
  console.log(`    p99:           ${result.latency.p99}`);
  console.log(`    Max:           ${result.latency.max}`);
  console.log('');
  console.log('  Status Codes:');
  if (result['2xx']) console.log(`    2xx:           ${formatNumber(result['2xx'])}`);
  if (result['4xx']) console.log(`    4xx:           ${formatNumber(result['4xx'])}`);
  if (result['5xx']) console.log(`    5xx:           ${formatNumber(result['5xx'])}`);
  if (result.errors) console.log(`    Errors:        ${formatNumber(result.errors)}`);
  if (result.timeouts) console.log(`    Timeouts:      ${formatNumber(result.timeouts)}`);
  console.log(divider);
}

async function runTest(key) {
  const test = tests[key];
  console.log(`\nStarting: ${test.name}`);
  console.log(`  ${test.description}`);
  console.log(`  Duration: ${test.config.duration}s | Connections: ${test.config.connections}`);

  return new Promise((resolve, reject) => {
    const instance = autocannon(test.config, (err, result) => {
      if (err) return reject(err);
      printResult(test.name, result);
      resolve(result);
    });

    // Progress bar
    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Zynetic Energy Ingestion Engine - Stress Test           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Target:      ${BASE_URL.padEnd(44)}║`);
  console.log(`║  Devices:     ${String(DEVICE_COUNT).padEnd(44)}║`);
  console.log(`║  Duration:    ${(duration + 's per test').padEnd(44)}║`);
  console.log(`║  Connections: ${String(connections).padEnd(44)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const testsToRun = testFilter ? [testFilter] : Object.keys(tests);
  const results = {};

  for (const key of testsToRun) {
    if (!tests[key]) {
      console.error(`Unknown test: ${key}. Available: ${Object.keys(tests).join(', ')}`);
      process.exit(1);
    }
    results[key] = await runTest(key);
  }

  // Summary
  if (testsToRun.length > 1) {
    console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                       SUMMARY                               ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    for (const key of testsToRun) {
      const r = results[key];
      const rps = Math.round(r.requests.total / r.duration);
      const errRate = r['5xx'] ? ((r['5xx'] / r.requests.total) * 100).toFixed(2) + '%' : '0%';
      console.log(`║  ${tests[key].name.padEnd(40)} ${String(rps).padStart(6)} req/s  err: ${errRate.padStart(6)} ║`);
    }
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Scale projection
    const meterRps = results.meter ? Math.round(results.meter.requests.total / results.meter.duration) : 0;
    const vehicleRps = results.vehicle ? Math.round(results.vehicle.requests.total / results.vehicle.duration) : 0;
    const totalRps = meterRps + vehicleRps;
    const dailyCapacity = totalRps * 60 * 60 * 24;
    const required = 14_400_000;

    console.log('\n  Scale Projection:');
    console.log(`    Single-request throughput: ${formatNumber(totalRps)} req/s`);
    console.log(`    Daily capacity:            ${formatNumber(dailyCapacity)} records/day`);
    console.log(`    Required:                  ${formatNumber(required)} records/day`);
    console.log(`    Headroom:                  ${(dailyCapacity / required).toFixed(1)}x`);

    if (results.batch) {
      const batchRps = Math.round(results.batch.requests.total / results.batch.duration);
      const batchDailyCapacity = batchRps * 100 * 60 * 60 * 24; // 100 readings per request
      console.log(`\n    With batch (100/req):       ${formatNumber(batchRps * 100)} effective records/s`);
      console.log(`    Batch daily capacity:       ${formatNumber(batchDailyCapacity)} records/day`);
      console.log(`    Batch headroom:             ${(batchDailyCapacity / required).toFixed(1)}x`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
