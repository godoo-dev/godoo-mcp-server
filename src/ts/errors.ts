export class PublicError extends Error {
  constructor(
    message: string,
    public readonly category = "invalid_arguments",
  ) {
    super(message);
    this.name = "PublicError";
  }
}
