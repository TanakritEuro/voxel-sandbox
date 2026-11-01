// Ported from ../racing-game/src/online/link.ts (itself from five-a-side and penalty-shootout).
// Changed: a room takes several guests (the host holds a link to each, and a guest's link closing
// doesn't close the room), and the room prefix.
import Peer, { type DataConnection, type PeerError } from 'peerjs';
import { newRoomCode } from './roomCode';

export { cleanRoomCode } from './roomCode';

/**
 * A connection to one other browser. `events` is reliable and ordered (joining, edits, chunks);
 * `frames` doesn't wait for order, since only the newest state matters (players, mobs).
 */
export type Channel = 'events' | 'frames';

export interface Link {
  send(message: object, channel?: Channel): void;
  /** Everything the other browser sends (heartbeats aside). */
  onMessage: (message: unknown) => void;
  /** The other browser left or went quiet; `reason` says which, for the player. */
  onClose: (reason: string) => void;
  /** Hang up (without calling `onClose`). */
  close(): void;
}

/** Room ids on the PeerJS server: the prefix keeps them apart from other apps (and versions). */
const PREFIX = 'voxel-sandbox-1-';
const CONNECT_TIMEOUT = 15000;
/** Each side says something at least this often (ms)... */
const HEARTBEAT = 1000;
/** ...and gives up on the other after hearing nothing for this long. */
const SILENCE_LIMIT = 6000;
/** Links a room holds at most: the session turns away any past its own limit, politely; this stops a flood. */
const MOST_LINKS = 8;

/** An open room: guests join it with its code, each getting a link of its own. */
export interface Room {
  code: string;
  /** Called with each guest's link once it's connected. */
  onGuest: (link: Link) => void;
  /** The room itself failed (lost the PeerJS server); its guests' links may go on. */
  onError: (reason: string) => void;
  /** Close the room and every guest's link. */
  close(): void;
}

/** Open a room on the PeerJS server under a fresh code. */
export async function openRoom(): Promise<Room> {
  for (let attempt = 0; ; attempt++) {
    const code = newRoomCode();
    const peer = new Peer(PREFIX + code, { debug: 0 });
    try {
      await opened(peer);
    } catch (e) {
      peer.destroy();
      // Someone else has that code: try another.
      if ((e as PeerError<string>).type === 'unavailable-id' && attempt < 4) continue;
      throw new Error(explain(e));
    }
    return new PeerRoom(code, peer);
  }
}

class PeerRoom implements Room {
  onGuest: (link: Link) => void = () => {};
  onError: (reason: string) => void = () => {};
  private readonly links = new Set<PeerLink>();
  private closed = false;

  constructor(
    readonly code: string,
    private readonly peer: Peer,
  ) {
    // A guest opens two connections (events, frames): a link once both are open.
    const pending = new Map<string, DataConnection>();
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (this.closed || this.links.size >= MOST_LINKS) {
          conn.close();
          return;
        }
        pending.set(`${conn.peer}/${conn.label}`, conn);
        const events = pending.get(`${conn.peer}/events`);
        const frames = pending.get(`${conn.peer}/frames`);
        if (!events || !frames) return;
        pending.delete(`${conn.peer}/events`);
        pending.delete(`${conn.peer}/frames`);
        const link = new PeerLink(events, frames, () => this.links.delete(link));
        this.links.add(link);
        this.onGuest(link);
      });
    });
    peer.on('error', (e) => {
      // A guest that couldn't be reached is that guest's problem, not the room's.
      if ((e as PeerError<string>).type === 'peer-unavailable' || this.closed) return;
      this.onError(explain(e));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const link of [...this.links]) link.close();
    this.peer.destroy();
  }
}

/** Join the room with this code. */
export async function joinRoom(code: string): Promise<Link> {
  const peer = new Peer({ debug: 0 });
  try {
    await opened(peer);
    const id = PREFIX + code;
    const events = peer.connect(id, { label: 'events', reliable: true });
    const frames = peer.connect(id, { label: 'frames', reliable: false });
    await Promise.race([
      Promise.all([connOpened(events), connOpened(frames)]),
      new Promise((_, reject) => peer.on('error', reject)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT)),
    ]);
    // The guest's peer is its link's alone: it goes when the link does.
    return new PeerLink(events, frames, () => peer.destroy());
  } catch (e) {
    peer.destroy();
    throw new Error(explain(e));
  }
}

function opened(peer: Peer): Promise<void> {
  return new Promise((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', reject);
    setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT);
  });
}

function connOpened(conn: DataConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.once('open', () => resolve());
    conn.once('error', reject);
  });
}

/** A message for the player from whatever went wrong. */
function explain(e: unknown): string {
  const type = (e as PeerError<string> | undefined)?.type;
  if (type === 'peer-unavailable') return 'No world open with that code. Check it and try again.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')
    return "Couldn't reach the matchmaking server. Check your connection and try again.";
  if (type === 'browser-incompatible') return "This browser can't play online.";
  if ((e as Error | undefined)?.message === 'timeout') return "Couldn't connect in time. Try again, or try another network.";
  return "Couldn't connect. Try again.";
}

/** Two PeerJS data connections to one other browser, with a heartbeat to notice it going quiet. */
class PeerLink implements Link {
  onMessage: (message: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private lastHeard = performance.now();
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly events: DataConnection,
    private readonly frames: DataConnection,
    /** Called once when the link is shut, either way. */
    private readonly gone: () => void,
  ) {
    for (const conn of [events, frames]) {
      conn.on('data', (data) => {
        this.lastHeard = performance.now();
        if (!(typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'heartbeat')) this.onMessage(data);
      });
      conn.on('close', () => this.end('The other player left.'));
      conn.on('error', () => this.end('The connection failed.'));
    }
    this.timer = setInterval(() => {
      if (performance.now() - this.lastHeard > SILENCE_LIMIT) this.end('Lost touch with the other player.');
      else this.send({ type: 'heartbeat' });
    }, HEARTBEAT);
  }

  send(message: object, channel: Channel = 'events'): void {
    if (this.closed) return;
    const conn = channel === 'frames' ? this.frames : this.events;
    if (conn.open) void conn.send(message);
  }

  close(): void {
    this.shutdown();
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.shutdown();
    this.onClose(reason);
  }

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.events.close();
    this.frames.close();
    this.gone();
  }
}
