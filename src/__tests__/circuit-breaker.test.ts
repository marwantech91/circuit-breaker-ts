import {
  CircuitBreaker,
  registerCircuitBreaker,
  getCircuitBreaker,
  removeCircuitBreaker,
  getAllCircuitBreakerStats,
} from '../index';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker<string>;

  beforeEach(() => {
    breaker = new CircuitBreaker<string>({ failureThreshold: 3, timeout: 1000 });
  });

  // ── State basics ──────────────────────────────────────────────

  it('starts in CLOSED state', () => {
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('stays CLOSED after a successful call', async () => {
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  // ── Transition to OPEN ────────────────────────────────────────

  it('transitions to OPEN after reaching the failure threshold', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    expect(breaker.getState()).toBe('OPEN');
  });

  it('throws when circuit is OPEN and no fallback is provided', async () => {
    breaker.open();
    await expect(breaker.execute(async () => 'ok')).rejects.toThrow(
      'Circuit breaker is OPEN',
    );
  });

  // ── Successful call resets failure count ──────────────────────

  it('resets failure count on a successful call in CLOSED state', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    // Accumulate 2 failures (threshold is 3)
    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getStats().failures).toBe(2);

    // A success should reset the count
    await breaker.execute(async () => 'ok');
    expect(breaker.getStats().failures).toBe(0);
    expect(breaker.getState()).toBe('CLOSED');

    // Two more failures should NOT trip the breaker (count was reset)
    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getState()).toBe('CLOSED');
  });

  // ── HALF_OPEN state after timeout ─────────────────────────────

  it('transitions to HALF_OPEN after the timeout elapses', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('OPEN');

    // Fast-forward past the timeout
    jest.useFakeTimers();
    jest.advanceTimersByTime(1500);

    // The next execute call should move to HALF_OPEN and try the function
    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    // After one success the breaker is still HALF_OPEN (successThreshold default is 2)
    expect(breaker.getState()).toBe('HALF_OPEN');

    jest.useRealTimers();
  });

  it('transitions from HALF_OPEN back to CLOSED after enough successes', async () => {
    const cb = new CircuitBreaker<string>({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 500,
    });

    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    // Trip the breaker
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    // Wait for timeout
    jest.useFakeTimers();
    jest.advanceTimersByTime(600);

    // Two successes should close the circuit
    await cb.execute(async () => 'a');
    await cb.execute(async () => 'b');
    expect(cb.getState()).toBe('CLOSED');

    jest.useRealTimers();
  });

  it('transitions from HALF_OPEN back to OPEN on a single failure', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow();
    }

    jest.useFakeTimers();
    jest.advanceTimersByTime(1500);

    // Fail during HALF_OPEN
    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    jest.useRealTimers();
  });

  // ── Fallback ──────────────────────────────────────────────────

  it('calls the fallback when the circuit is OPEN', async () => {
    const fallbackBreaker = new CircuitBreaker<string>({
      failureThreshold: 2,
      timeout: 5000,
      fallback: (_err) => 'fallback-value',
    });

    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    // Trip the breaker (fallback is also called on each failure)
    const r1 = await fallbackBreaker.execute(failing);
    expect(r1).toBe('fallback-value');
    const r2 = await fallbackBreaker.execute(failing);
    expect(r2).toBe('fallback-value');

    expect(fallbackBreaker.getState()).toBe('OPEN');

    // Now the circuit is open; execute should use fallback directly
    const result = await fallbackBreaker.execute(async () => 'should-not-run');
    expect(result).toBe('fallback-value');
  });

  // ── Callbacks ─────────────────────────────────────────────────

  it('invokes onStateChange when transitioning', async () => {
    const changes: Array<{ from: string; to: string }> = [];

    const cb = new CircuitBreaker<string>({
      failureThreshold: 1,
      timeout: 1000,
      onStateChange: (from, to) => changes.push({ from, to }),
    });

    await expect(
      cb.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();

    expect(changes).toEqual([{ from: 'CLOSED', to: 'OPEN' }]);
  });

  it('invokes onFailure and onSuccess callbacks', async () => {
    const failures: Error[] = [];
    let successCount = 0;

    const cb = new CircuitBreaker<string>({
      failureThreshold: 5,
      onFailure: (err) => failures.push(err),
      onSuccess: () => successCount++,
    });

    await cb.execute(async () => 'ok');
    expect(successCount).toBe(1);

    await expect(
      cb.execute(async () => {
        throw new Error('oops');
      }),
    ).rejects.toThrow();
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toBe('oops');
  });

  // ── isFailure filter ──────────────────────────────────────────

  it('does not count errors filtered out by isFailure', async () => {
    const cb = new CircuitBreaker<string>({
      failureThreshold: 2,
      isFailure: (err) => err.message !== 'ignore-me',
    });

    await expect(
      cb.execute(async () => {
        throw new Error('ignore-me');
      }),
    ).rejects.toThrow();

    // The failure should not have been counted
    expect(cb.getStats().failures).toBe(0);
    expect(cb.getState()).toBe('CLOSED');
  });

  // ── Manual reset / open ───────────────────────────────────────

  it('reset() returns the breaker to CLOSED state', () => {
    breaker.open();
    expect(breaker.getState()).toBe('OPEN');
    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getStats().failures).toBe(0);
  });

  // ── getStats ──────────────────────────────────────────────────

  it('getStats returns accurate counters', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('fail');
    };

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();

    const stats = breaker.getStats();
    expect(stats.failures).toBe(2);
    expect(stats.state).toBe('CLOSED');
    expect(stats.lastFailureTime).toBeGreaterThan(0);
  });
});

// ── Registry ──────────────────────────────────────────────────────

describe('CircuitBreaker Registry', () => {
  beforeEach(() => {
    // Clean up any previously registered breakers
    removeCircuitBreaker('test-service');
    removeCircuitBreaker('service-a');
    removeCircuitBreaker('service-b');
  });

  it('registers and retrieves a circuit breaker by name', () => {
    const cb = new CircuitBreaker();
    registerCircuitBreaker('test-service', cb);
    expect(getCircuitBreaker('test-service')).toBe(cb);
  });

  it('returns undefined for an unregistered name', () => {
    expect(getCircuitBreaker('nonexistent')).toBeUndefined();
  });

  it('removes a circuit breaker by name', () => {
    const cb = new CircuitBreaker();
    registerCircuitBreaker('test-service', cb);
    expect(removeCircuitBreaker('test-service')).toBe(true);
    expect(getCircuitBreaker('test-service')).toBeUndefined();
  });

  it('remove returns false for a non-existent name', () => {
    expect(removeCircuitBreaker('nonexistent')).toBe(false);
  });

  it('getAllCircuitBreakerStats returns stats for all registered breakers', () => {
    const a = new CircuitBreaker({ failureThreshold: 3 });
    const b = new CircuitBreaker({ failureThreshold: 5 });
    registerCircuitBreaker('service-a', a);
    registerCircuitBreaker('service-b', b);

    const allStats = getAllCircuitBreakerStats();
    expect(allStats.size).toBe(2);
    expect(allStats.get('service-a')).toEqual({
      failures: 0,
      successes: 0,
      state: 'CLOSED',
      lastFailureTime: null,
    });
    expect(allStats.get('service-b')).toEqual({
      failures: 0,
      successes: 0,
      state: 'CLOSED',
      lastFailureTime: null,
    });
  });
});
