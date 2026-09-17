// Load test POST /api/requests with JSON only. Each successful call may create a record.
// Example (PowerShell):
// $env:REQUEST_URL = 'https://leaprs-v2.vercel.app/api/requests'
// $env:REQUEST_BODY_JSON = '{"aipCode":"1111-111-1-1-11-111-111","setting":"internal","description":"Load test","requestedBudget":"1.00","dynamicFields":{"field:13":"CAS","field:14":"Load test","field:15":"Test participants","field:16":"Test duration","field:17":"Load test objectives","field:18":"Load test learning objectives"},"userConfirmed":true}'
// $env:REQUEST_COOKIE = 'your-session-cookie'
// node scripts/load-test-requests.mjs

import { performance } from 'node:perf_hooks';

const url = new URL(process.env.REQUEST_URL ?? 'http://localhost:3000/api/requests');
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 10);
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS ?? 10000);
const maxRequestsPerLevel = Number(process.env.LOAD_MAX_REQUESTS_PER_LEVEL ?? 100);
const levels = (process.env.LOAD_USERS ?? '5,10,20').split(',').map(Number);

if (!process.env.REQUEST_BODY_JSON) {
  throw new Error('Set REQUEST_BODY_JSON to a valid request payload before running the test.');
}
const payload = JSON.stringify(JSON.parse(process.env.REQUEST_BODY_JSON));
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
    !Number.isInteger(maxRequestsPerLevel) || maxRequestsPerLevel <= 0 ||
    levels.some((level) => !Number.isInteger(level) || level <= 0)) {
  throw new Error('LOAD_DURATION_SECONDS, LOAD_TIMEOUT_MS, and LOAD_USERS must be positive numbers.');
}

const headers = { 'content-type': 'application/json' };
if (process.env.REQUEST_COOKIE) headers.cookie = process.env.REQUEST_COOKIE;
if (process.env.REQUEST_BEARER_TOKEN) headers.authorization = `Bearer ${process.env.REQUEST_BEARER_TOKEN}`;

async function runLevel(users) {
  const latencies = [];
  const statuses = new Map();
  let errors = 0;
  let sent = 0;
  const started = performance.now();
  const deadline = started + durationSeconds * 1000;

  await Promise.all(Array.from({ length: users }, async () => {
    while (performance.now() < deadline && sent < maxRequestsPerLevel) {
      sent++;
      const requestStart = performance.now();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Consume the body so the connection is available for the next request.
        await response.arrayBuffer();
        latencies.push(performance.now() - requestStart);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        if (!response.ok) errors++;
      } catch {
        latencies.push(performance.now() - requestStart);
        errors++;
        statuses.set('network/timeout', (statuses.get('network/timeout') ?? 0) + 1);
      }
    }
  }));

  const elapsedSeconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const count = latencies.length;
  return {
    users,
    average: count ? latencies.reduce((sum, value) => sum + value, 0) / count : 0,
    p95: count ? latencies[Math.ceil(count * 0.95) - 1] : 0,
    rate: count / elapsedSeconds,
    errorRate: count ? errors / count * 100 : 0,
    count,
    elapsedSeconds,
    statuses,
  };
}

console.log(`POST ${url} — up to ${durationSeconds}s and ${maxRequestsPerLevel} requests per level; JSON body, no file uploads`);
console.log('| Concurrent Users | Avg Response Time | p95 Response Time | Requests/sec | Error Rate |');
console.log('|---:|---:|---:|---:|---:|');
for (const users of levels) {
  const result = await runLevel(users);
  console.log(`| ${users} | ${result.average.toFixed(1)} ms | ${result.p95.toFixed(1)} ms | ${result.rate.toFixed(1)} | ${result.errorRate.toFixed(1)}% |`);
  console.error(`Users ${users}: n=${result.count}, elapsed=${result.elapsedSeconds.toFixed(2)}s, ${[...result.statuses].map(([status, count]) => `${status}=${count}`).join(', ')}`);
}
