# Circuit Breaker TS

![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square)
![Pattern](https://img.shields.io/badge/Pattern-Circuit_Breaker-orange?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

Circuit breaker pattern implementation for resilient microservices. Prevents cascade failures with automatic recovery, fallbacks, and health monitoring.

## Why Circuit Breaker?

When Service A depends on Service B, and B fails:
- **Without CB**: A keeps calling B → timeouts → A becomes slow → cascade failure
- **With CB**: A detects B is down → fails fast → uses fallback → auto-recovers when B is back

## States

```
     ┌──────────────────────────────────────────────────┐
     │                                                  │
     ▼                                                  │
  ┌──────┐   failure threshold   ┌──────┐   timeout   ┌──────────┐
  │CLOSED│ ──────────────────► │ OPEN │ ──────────► │HALF-OPEN │
  └──────┘                      └──────┘             └──────────┘
     ▲                              │                     │
     │                              │                     │
     │     success                  │ fail                │ success
     └──────────────────────────────┴─────────────────────┘
```

## Installation

```bash
npm install @marwantech/circuit-breaker-ts
```

## Quick Start

```typescript
import { CircuitBreaker } from '@marwantech/circuit-breaker-ts';

const breaker = new CircuitBreaker({
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 3,      // Close after 3 successes in half-open
  timeout: 30000,           // Try again after 30s
  fallback: () => ({ cached: true, data: [] }),
});

// Wrap your service calls
const result = await breaker.execute(async () => {
  return await fetch('http://service-b/api/data');
});
```

## Advanced Usage

### With Fallback

```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 3,
  timeout: 10000,
  fallback: async (error) => {
    // Return cached data when circuit is open
    return await cache.get('last-known-good-data');
  },
});
```

### Health Monitoring

```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  timeout: 30000,
  onStateChange: (from, to) => {
    metrics.gauge('circuit_breaker_state', to === 'OPEN' ? 1 : 0);
    alerting.send(`Circuit changed: ${from} → ${to}`);
  },
  onFailure: (error) => {
    logger.error('Circuit breaker recorded failure', error);
  },
});
```

### Per-Service Breakers

```typescript
const breakers = {
  userService: new CircuitBreaker({ failureThreshold: 5, timeout: 30000 }),
  paymentService: new CircuitBreaker({ failureThreshold: 3, timeout: 60000 }),
  inventoryService: new CircuitBreaker({ failureThreshold: 10, timeout: 15000 }),
};

// Usage
const user = await breakers.userService.execute(() => userApi.getUser(id));
```

## Configuration

```typescript
interface CircuitBreakerOptions {
  failureThreshold: number;    // Failures before opening (default: 5)
  successThreshold: number;    // Successes to close from half-open (default: 2)
  timeout: number;             // ms before trying half-open (default: 30000)
  fallback?: (error: Error) => Promise<T> | T;  // Fallback when open
  onStateChange?: (from: State, to: State) => void;
  onFailure?: (error: Error) => void;
  onSuccess?: () => void;
  isFailure?: (error: Error) => boolean;  // Custom failure detection
}
```

## API

```typescript
breaker.execute<T>(fn: () => Promise<T>): Promise<T>
breaker.getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN'
breaker.getStats(): { failures: number, successes: number, state: State }
breaker.reset(): void  // Force reset to CLOSED
breaker.open(): void   // Force OPEN (for maintenance)
```

## Express Middleware

```typescript
import { circuitBreakerMiddleware } from '@marwantech/circuit-breaker-ts';

app.use('/api/external', circuitBreakerMiddleware(breaker));
```

## License

MIT
