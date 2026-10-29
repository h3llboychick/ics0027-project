export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { validateFileRuntime } = await import('./lib/files/runtime');
      validateFileRuntime();
    } catch {
      // Next logs rejected instrumentation without necessarily exiting. Fail the
      // process explicitly so an invalid deployment cannot look healthy.
      console.error('Invalid file runtime configuration: check DATABASE_URL, FILE_ENCRYPTION_KEK and FILE_* timeouts');
      process.exit(1);
    }
  }
}
