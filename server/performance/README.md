# Access synchronization performance checks

Run `npm run test:access-load` from `server/`. The harness creates its own loopback HTTP listener and in-memory PostgreSQL database. It does not accept a remote target and cannot send load to production. It exercises the actual account middleware against 1,000 staff fixtures, including disabled-account write rejection, role revocation, and recovery.

Verified on the development machine on 9 October 2026:

| Phase | Concurrent requests | Requests | Unexpected failures | p95 latency |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 10 | 300 | 0 | 117 ms |
| Scalability | 50 | 1,500 | 0 | 375 ms |
| Spike | 150 | 2,000 | 0 | 1,085 ms |
| Sustained stress | 200 | 5,000 | 0 | 1,135 ms |
| Recovery | 10 | 300 | 0 | 52 ms |
| Revoked role | 50 | 500 | 0 | 284 ms |
| Restored role | 10 | 300 | 0 | 73 ms |

There were 9,902 HTTP requests including the write safety checks. These measurements cover the account guard, not production hospital capacity. They use PGlite, rather than the deployed PostgreSQL connection pool, and do not measure external AI services, printer integration, or full clinical joins.

Before confirming a hospital capacity target, use a staging deployment with the same database size, server resources, reverse proxy, and connection pool as production. Seed synthetic patients, appointments, invoices, and sample/result records. Exercise realistic mixed registration, appointment, lab, payment, cancellation, and refund workflows, including the concurrency rules already covered by regression tests. Measure p95/p99 response time, HTTP failures, CPU, memory, database locks, pool waits, and ledger consistency. Ramp concurrency to the expected peak, spike beyond that peak, hold sustained load, and verify recovery. Agree on acceptable latency and error thresholds before the run. Do not point write or stress workloads at the live hospital.
