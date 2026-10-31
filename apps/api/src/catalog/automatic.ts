/** Successful freshness lives in the database; only failures and active jobs live here. */
export const FRESH_MS = 5 * 60 * 1000;
export function fresh(at: Date | null | undefined) {
  return !!at && Date.now() - at.getTime() <= FRESH_MS;
}
export class AutomaticRefresh {
  private readonly flights = new Map<string, Promise<any>>();
  private readonly failures = new Map<
    string,
    { at: number; message: string }
  >();
  run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.flights.get(key);
    if (current) return current;
    const flight = Promise.resolve()
      .then(load)
      .finally(() => this.flights.delete(key));
    this.flights.set(key, flight);
    return flight;
  }
  async stage(
    key: string,
    force: boolean,
    message: string,
    load: () => Promise<unknown>,
  ): Promise<string | undefined> {
    const failed = this.failures.get(key);
    if (!force && failed && Date.now() - failed.at < 30000)
      return failed.message;
    try {
      await load();
      this.failures.delete(key);
      return undefined;
    } catch {
      this.failures.set(key, { at: Date.now(), message });
      return message;
    }
  }
}
