// Links in one process, for tests (after the racing game's, itself after five-a-side's), as many
// as wanted on one network: a room that guests join as they would over PeerJS, each getting a
// pair of linked ends. Each message arrives at the other end as a structured clone (nothing
// shared, as over a network), after a delay with jitter, on a virtual clock that the test moves
// on with `advance(now)`. The unordered channel may reorder (as a real one can); the reliable one
// keeps its order. A cut line is noticed as a real link notices it, by the heartbeats stopping:
// both ends close after `silence` seconds.

import { createRng } from '../math';
import type { Channel, Link, Room } from './link';

export interface LoopbackOptions {
  /** One-way delay (s), give or take `jitter` (s). */
  delay?: number;
  jitter?: number;
  seed?: number;
  /** How long after a cut each end gives up (s), as link.ts does on missing heartbeats. */
  silence?: number;
}

interface Item {
  to: LoopLink;
  at: number;
  order: number;
  message?: unknown;
  close?: true;
}

/** Two linked ends, and their line. */
export interface Pair {
  a: Link;
  b: Link;
  /** Cut the line without either end hanging up (a network failure). */
  cut(): void;
}

export class Network {
  private readonly rng: () => number;
  private queue: Item[] = [];
  private now = 0;
  private order = 0;
  /** Lines cut, and when their ends give up. */
  private readonly lost: { ends: LoopLink[]; at: number }[] = [];
  /** The reliable channel never overtakes itself: each message no earlier than the last to that end. */
  private readonly lastReliable = new Map<LoopLink, number>();
  private readonly options: Required<LoopbackOptions>;

  constructor({ delay = 0, jitter = 0, seed = 1, silence = 6 }: LoopbackOptions = {}) {
    this.options = { delay, jitter, seed, silence };
    this.rng = createRng(seed);
  }

  /** Messages on their way. */
  get inFlight(): number {
    return this.queue.length;
  }

  /** Two linked ends. */
  pair(): Pair {
    let cut = false;
    const post = (to: LoopLink, item: Omit<Item, 'to' | 'at' | 'order'>, channel: Channel) => {
      if (cut) return;
      const { delay, jitter } = this.options;
      let at = this.now + Math.max(0, delay + (this.rng() * 2 - 1) * jitter);
      if (channel === 'events') {
        at = Math.max(at, this.lastReliable.get(to) ?? 0);
        this.lastReliable.set(to, at);
      }
      this.queue.push({ ...item, to, at, order: this.order++ });
    };
    const a: LoopLink = new LoopLink((item, channel) => post(b, item, channel));
    const b: LoopLink = new LoopLink((item, channel) => post(a, item, channel));
    return {
      a,
      b,
      cut: () => {
        if (cut) return;
        cut = true;
        this.queue = this.queue.filter((i) => i.to !== a && i.to !== b);
        this.lost.push({ ends: [a, b], at: this.now + this.options.silence });
      },
    };
  }

  /** A room on this network: `join` connects a guest to it. */
  room(code = 'TEST'): LoopRoom {
    return new LoopRoom(code, this);
  }

  /** Deliver everything due by virtual time `now` (s); returns how many were delivered. */
  advance(now: number): number {
    this.now = now;
    const due = this.queue.filter((i) => i.at <= now).sort((x, y) => x.at - y.at || x.order - y.order);
    this.queue = this.queue.filter((i) => i.at > now);
    for (const item of due) {
      if (item.close) item.to.remoteClosed();
      else if (!item.to.closed) item.to.onMessage(item.message);
    }
    for (let i = this.lost.length - 1; i >= 0; i--) {
      if (now < this.lost[i].at) continue;
      for (const end of this.lost[i].ends) end.remoteClosed('Lost touch with the other player.');
      this.lost.splice(i, 1);
    }
    return due.length;
  }
}

/** A room in a test network: like a PeerJS one, its guests' links come to `onGuest`. */
export class LoopRoom implements Room {
  onGuest: (link: Link) => void = () => {};
  onError: (reason: string) => void = () => {};
  private readonly links: Link[] = [];
  private closed = false;

  constructor(
    readonly code: string,
    private readonly network: Network,
  ) {}

  /** A guest joins: the room's end goes to `onGuest` (at once, as the connection is made), the guest's is returned. */
  join(): Pair & { guest: Link } {
    const pair = this.network.pair();
    if (this.closed) {
      pair.a.close();
      return { ...pair, guest: pair.b };
    }
    this.links.push(pair.a);
    this.onGuest(pair.a);
    return { ...pair, guest: pair.b };
  }

  close(): void {
    this.closed = true;
    for (const link of this.links) link.close();
  }
}

class LoopLink implements Link {
  onMessage: (message: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};
  closed = false;

  constructor(private readonly post: (item: { message?: unknown; close?: true }, channel: Channel) => void) {}

  send(message: object, channel: Channel = 'events'): void {
    if (!this.closed) this.post({ message: structuredClone(message) }, channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.post({ close: true }, 'events');
  }

  /** The other end hung up, or the line was lost. */
  remoteClosed(reason = 'The other player left.'): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(reason);
  }
}
