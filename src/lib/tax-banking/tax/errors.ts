/** A tax provider (or the built-in engine) couldn't answer. The engine never substitutes a guessed rate. */
export class ProviderUnavailable extends Error {
  constructor(public provider: string, public status?: number) { super(`${provider}_unavailable${status ? `_${status}` : ""}`); }
}
