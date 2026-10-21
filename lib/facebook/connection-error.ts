// Dependency-free so lib/facebook/manage-pages.ts stays testable without the
// auth stack that the route handler pulls in.
export class ConnectionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "ConnectionError";
  }
}
