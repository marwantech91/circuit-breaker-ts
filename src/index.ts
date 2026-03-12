type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions<T> {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  fallback?: (error: Error) => Promise<T> | T;
  onStateChange?: (from: State, to: State) => void;
  onFailure?: (error: Error) => void;
  onSuccess?: () => void;
  isFailure?: (error: Error) => boolean;
}

interface Stats {
  failures: number;
  successes: number;
  state: State;
  lastFailureTime: number | null;
}

export class CircuitBreaker<T = unknown> {
  private state: State = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private readonly options: Required<Omit<CircuitBreakerOptions<T>, 'fallback' | 'onStateChange' | 'onFailure' | 'onSuccess' | 'isFailure'>> & CircuitBreakerOptions<T>;

  constructor(options: CircuitBreakerOptions<T> = {}) {
    this.options = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
      ...options,
    };
  }

  async execute(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (this.lastFailureTime && now - this.lastFailureTime >= this.options.timeout) {
        this.transitionTo('HALF_OPEN');
      } else {
        // Circuit is open, use fallback or throw
        if (this.options.fallback) {
          return this.options.fallback(new Error('Circuit is OPEN'));
        }
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);

      // Use fallback if available
      if (this.options.fallback) {
        return this.options.fallback(error as Error);
      }

      throw error;
    }
  }

  private onSuccess(): void {
    this.options.onSuccess?.();

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  private onFailure(error: Error): void {
    // Check if this error should count as a failure
    if (this.options.isFailure && !this.options.isFailure(error)) {
      return;
    }

    this.options.onFailure?.(error);
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Single failure in half-open goes back to open
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED' && this.failures >= this.options.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: State): void {
    const oldState = this.state;
    this.state = newState;

    // Reset counters based on new state
    if (newState === 'CLOSED') {
      this.failures = 0;
      this.successes = 0;
    } else if (newState === 'HALF_OPEN') {
      this.successes = 0;
    }

    this.options.onStateChange?.(oldState, newState);
  }

  getState(): State {
    return this.state;
  }

  getStats(): Stats {
    return {
      failures: this.failures,
      successes: this.successes,
      state: this.state,
      lastFailureTime: this.lastFailureTime,
    };
  }

  reset(): void {
    this.transitionTo('CLOSED');
    this.lastFailureTime = null;
  }

  open(): void {
    this.transitionTo('OPEN');
    this.lastFailureTime = Date.now();
  }
}

export default CircuitBreaker;
export type { State, CircuitBreakerOptions, Stats };

// Get all circuit breakers status
const breakers = new Map<string, CircuitBreaker<any, any>>();

export function getCircuitBreakerStatus(name: string): CircuitState | undefined {
  return breakers.get(name)?.getState();
}

export function getAllCircuitBreakers(): Map<string, CircuitState> {
  const status = new Map<string, CircuitState>();
  breakers.forEach((breaker, name) => {
    status.set(name, breaker.getState());
  });
  return status;
}
