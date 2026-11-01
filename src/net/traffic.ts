// Counting what goes over the links, for `?stats`: each message's size estimated as it's sent or
// heard (the bytes of its binary parts, and about what its numbers and text take), by wrapping
// the links (and a room's guests' links) the sessions are given. Pure.

import type { Channel, Link, Room } from './link';

/** About how many bytes a message takes on the wire (PeerJS packs it in a binary form close to this). */
export function bytesOf(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'number') return 9;
  if (typeof value === 'string') return value.length + 2;
  if (typeof value === 'boolean' || value === null || value === undefined) return 1;
  if (Array.isArray(value)) return value.reduce((s: number, v) => s + bytesOf(v), 2);
  if (typeof value === 'object') return Object.entries(value).reduce((s, [k, v]) => s + k.length + 1 + bytesOf(v), 2);
  return 0;
}

export class Traffic {
  /** Bytes and messages since the last `rates`. */
  private up = 0;
  private down = 0;
  private messages = 0;
  private since: number;

  constructor(private readonly now: () => number) {
    this.since = now();
  }

  /** Bytes a second out and in, and messages a second either way, since last asked. */
  rates(): { up: number; down: number; messages: number } {
    const t = this.now();
    const s = Math.max(t - this.since, 1e-3);
    const out = { up: this.up / s, down: this.down / s, messages: this.messages / s };
    this.up = this.down = this.messages = 0;
    this.since = t;
    return out;
  }

  link(inner: Link): Link {
    return new CountedLink(inner, this);
  }

  /** The room, its guests' links counted. */
  room(inner: Room): Room {
    const traffic = this;
    return {
      code: inner.code,
      set onGuest(f: (link: Link) => void) {
        inner.onGuest = (link) => f(traffic.link(link));
      },
      get onGuest() {
        return inner.onGuest;
      },
      set onError(f: (reason: string) => void) {
        inner.onError = f;
      },
      get onError() {
        return inner.onError;
      },
      close: () => inner.close(),
    };
  }

  /** @internal */
  count(bytes: number, out: boolean): void {
    if (out) this.up += bytes;
    else this.down += bytes;
    this.messages++;
  }
}

class CountedLink implements Link {
  private handler: (message: unknown) => void = () => {};

  constructor(
    private readonly inner: Link,
    private readonly traffic: Traffic,
  ) {
    inner.onMessage = (m) => {
      traffic.count(bytesOf(m), false);
      this.handler(m);
    };
  }

  get onMessage(): (message: unknown) => void {
    return this.handler;
  }

  set onMessage(f: (message: unknown) => void) {
    this.handler = f;
  }

  get onClose(): (reason: string) => void {
    return this.inner.onClose;
  }

  set onClose(f: (reason: string) => void) {
    this.inner.onClose = f;
  }

  send(message: object, channel?: Channel): void {
    this.traffic.count(bytesOf(message), true);
    this.inner.send(message, channel);
  }

  close(): void {
    this.inner.close();
  }
}
