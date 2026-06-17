import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function loadTest() {
  const health = http.get(`${BASE_URL}/api/health/live`);
  check(health, {
    'health live 200': (r) => r.status === 200,
    'health p95 under 500ms': (r) => r.timings.duration < 500,
  });

  const ready = http.get(`${BASE_URL}/api/health/ready`);
  check(ready, {
    'health ready responds': (r) => r.status === 200 || r.status === 503,
  });

  sleep(0.5);
}
