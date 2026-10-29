import type { OperationRepository } from './repository';
import { LeaseLostError, type Operation } from './model';

/** A timeout stops new stages. Generations and CAS also fence I/O finishing late. */
export class OperationLease {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly deadline: ReturnType<typeof setTimeout>;
  private heartbeatRunning = false;
  readonly signal: AbortSignal;
  constructor(private readonly repository: OperationRepository, readonly operation: Operation, shutdown?: AbortSignal) {
    this.signal = shutdown ? AbortSignal.any([this.controller.signal, shutdown]) : this.controller.signal;
    this.timer = setInterval(() => { void this.beat(); }, repository.config.heartbeatMs);
    this.deadline = setTimeout(() => this.controller.abort(new Error('ATTEMPT_TIMEOUT')), repository.config.attemptTimeoutMs);
    this.timer.unref();
    this.deadline.unref();
  }
  private async beat() {
    if (this.heartbeatRunning || this.signal.aborted) return;
    this.heartbeatRunning = true;
    try { await this.repository.heartbeat(this.operation); }
    catch { this.controller.abort(new LeaseLostError()); }
    finally { this.heartbeatRunning = false; }
  }
  async check() {
    this.signal.throwIfAborted();
    await this.repository.assertOwned(this.operation);
    this.signal.throwIfAborted();
  }
  async io<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(this.repository.config.ioTimeoutMs)]);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // Some filesystem steps cannot be canceled. Never compensate them based
      // solely on this rejection: their registered generation remains recoverable.
      return await Promise.race([action(signal), aborted]);
    } finally { signal.removeEventListener('abort', onAbort); }
  }
  stop() { clearInterval(this.timer); clearTimeout(this.deadline); }
}
