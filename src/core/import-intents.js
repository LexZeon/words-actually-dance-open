/** Selection ownership is reserved before I/O, independently for music and text. */
export class ImportIntents {
  constructor({ isAlive = () => true } = {}) {
    this.isAlive = isAlive;
    this.current = new Map();
  }

  reserve(channel) {
    if (!['script', 'music'].includes(channel)) throw new TypeError('Unknown import channel.');
    this.invalidate(channel);
    const controller = new AbortController();
    const token = Object.freeze({
      signal: controller.signal,
      isCurrent: () => this.isCurrent(channel, token),
      cancel: () => {
        if (this.current.get(channel)?.token === token) this.invalidate(channel);
      },
    });
    this.current.set(channel, { token, controller });
    return token;
  }

  isCurrent(channel, token) {
    return (
      Boolean(token) && this.isAlive() && this.current.get(channel)?.token === token && !token.signal.aborted
    );
  }

  invalidate(channel) {
    const previous = this.current.get(channel);
    this.current.delete(channel);
    previous?.controller.abort();
  }

  destroy() {
    for (const channel of [...this.current.keys()]) this.invalidate(channel);
  }
}
