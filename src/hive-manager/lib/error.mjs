export class HiveManagerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HiveManagerError';
    this.code = code;
  }
}
