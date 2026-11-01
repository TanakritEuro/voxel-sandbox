import { describe, expect, it } from 'vitest';
import type { Link } from '../src/net/link';
import { Network } from '../src/net/loopback';
import { cleanName, type Message, NAME_LENGTH, parseMessage, PROTOCOL } from '../src/net/protocol';
import { cleanRoomCode, newRoomCode } from '../src/net/roomCode';

/** Everything a link receives, and why it closed. */
function listen(link: Link): { got: unknown[]; closed: string[] } {
  const out = { got: [] as unknown[], closed: [] as string[] };
  link.onMessage = (m) => out.got.push(m);
  link.onClose = (r) => out.closed.push(r);
  return out;
}

describe('the test network', () => {
  it('delivers after the delay, as copies, the reliable channel in order however it jitters', () => {
    const net = new Network({ delay: 0.05, jitter: 0.04, seed: 3 });
    const { a, b } = net.pair();
    const heard = listen(b);
    const sent = { type: 'n', n: 0, list: [1, 2] };
    a.send(sent);
    sent.list.push(3); // changed after sending: the copy on its way isn't
    for (let n = 1; n < 50; n++) a.send({ type: 'n', n });
    net.advance(0.005);
    expect(heard.got.length).toBe(0); // nothing before the shortest delay
    net.advance(1);
    expect(heard.got.map((m) => (m as { n: number }).n)).toEqual(Array.from({ length: 50 }, (_, n) => n));
    expect((heard.got[0] as { list: number[] }).list).toEqual([1, 2]);
  });

  it('may reorder the unordered channel', () => {
    const net = new Network({ delay: 0.05, jitter: 0.04, seed: 5 });
    const { a, b } = net.pair();
    const heard = listen(b);
    for (let n = 0; n < 50; n++) a.send({ type: 'n', n }, 'frames');
    net.advance(1);
    const order = heard.got.map((m) => (m as { n: number }).n);
    expect([...order].sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, n) => n));
    expect(order).not.toEqual([...order].sort((x, y) => x - y));
  });

  it('gives each guest of a room its own line, and closing the room hangs up on all of them', () => {
    const net = new Network({ delay: 0.02 });
    const room = net.room();
    const hostEnds: Link[] = [];
    room.onGuest = (link) => hostEnds.push(link);
    const guests = [room.join(), room.join(), room.join()];
    expect(hostEnds.length).toBe(3);
    const heard = guests.map((g) => listen(g.guest));
    hostEnds[1].send({ type: 'only', to: 1 });
    net.advance(0.1);
    expect(heard.map((h) => h.got.length)).toEqual([0, 1, 0]);
    // Guests are heard by the host apart too.
    const atHost = hostEnds.map(listen);
    guests[2].guest.send({ type: 'from', who: 2 });
    net.advance(0.2);
    expect(atHost.map((h) => h.got.length)).toEqual([0, 0, 1]);
    room.close();
    net.advance(0.3);
    expect(heard.every((h) => h.closed.length === 1)).toBe(true);
  });

  it('closes both ends of a cut line after the silence, and only that line', () => {
    const net = new Network({ delay: 0.02, silence: 6 });
    const room = net.room();
    const hostEnds: Link[] = [];
    room.onGuest = (link) => hostEnds.push(link);
    const first = room.join();
    const second = room.join();
    const [h0, h1] = hostEnds.map(listen);
    const g0 = listen(first.guest);
    const g1 = listen(second.guest);
    net.advance(1);
    first.cut();
    first.guest.send({ type: 'lost' }); // goes nowhere
    net.advance(6.5);
    expect(h0.closed).toEqual([]);
    net.advance(7.1);
    expect(h0.closed.length).toBe(1);
    expect(g0.closed.length).toBe(1);
    expect(h0.got).toEqual([]);
    // The other guest is still connected.
    second.guest.send({ type: 'still here' });
    net.advance(8);
    expect(h1.got.length).toBe(1);
    expect(g1.closed).toEqual([]);
  });

  it("tells the other end when one hangs up, but not the one that did", () => {
    const net = new Network({ delay: 0.03 });
    const { a, b } = net.pair();
    const heardA = listen(a);
    const heardB = listen(b);
    a.close();
    net.advance(0.1);
    expect(heardB.closed.length).toBe(1);
    expect(heardA.closed).toEqual([]);
  });
});

describe('room codes', () => {
  it('are four letters and digits that are easy to read, tidied from what was typed', () => {
    for (let i = 0; i < 50; i++) expect(cleanRoomCode(newRoomCode())).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(cleanRoomCode(' ab c-d ')).toBe('ABCD');
    expect(cleanRoomCode('AB0D')).toBe(null); // no 0 (or O, 1, I)
    expect(cleanRoomCode('ABC')).toBe(null);
    expect(cleanRoomCode('ABCDE')).toBe(null);
  });
});

describe('messages', () => {
  const players = [
    { id: 0, name: 'Host' },
    { id: 2, name: 'Pim' },
  ];
  const good: Message[] = [
    { type: 'hello', version: PROTOCOL, name: 'Pim' },
    { type: 'welcome', you: 2, seed: 20261022, time: 0.25, players, at: [10.5, 70, -3.5], edited: [0, 0, -1, 4] },
    { type: 'reject', reason: 'This world is full.' },
    { type: 'joined', player: { id: 3, name: 'Aroon' } },
    { type: 'left', id: 1, reason: 'Left the game.' },
    { type: 'ping', t: 1.5 },
    { type: 'pong', t: 1.5, at: 7.25 },
    { type: 'bye', reason: 'The host closed the world.' },
  ];

  it('come through the network as they were sent', () => {
    for (const m of good) expect(parseMessage(structuredClone(m))).toEqual(m);
  });

  it('turn away anything this version does not understand', () => {
    const welcome = good[1] as Extract<Message, { type: 'welcome' }>;
    const bad: unknown[] = [
      null,
      42,
      'hello',
      { type: 'nope' },
      { type: 'hello', version: '1', name: 'Pim' },
      { type: 'hello', version: 1, name: '   ' },
      { ...welcome, you: 0 }, // the host isn't a guest
      { ...welcome, you: 4 },
      { ...welcome, you: 3 }, // not among the players
      { ...welcome, time: 1 },
      { ...welcome, seed: 1.5 },
      { ...welcome, players: [...players, { id: 2, name: 'Twin' }] },
      { ...welcome, players: [...players, { id: 1, name: 'A' }, { id: 3, name: 'B' }, { id: 1, name: 'C' }] },
      { ...welcome, players: [players[0], { id: 2, name: 'x'.repeat(NAME_LENGTH + 1) }] },
      { ...welcome, at: [1, 2] },
      { ...welcome, at: [1, Number.NaN, 2] },
      { ...welcome, edited: [0, 0, 1] },
      { ...welcome, edited: [0, 0.5] },
      { ...welcome, edited: [0, 0x10000] },
      { type: 'joined', player: { id: 7, name: 'Zed' } },
      { type: 'left', id: -1, reason: '' },
      { type: 'ping', t: Number.POSITIVE_INFINITY },
      { type: 'pong', t: 1 },
      { type: 'bye', reason: 'x'.repeat(201) },
    ];
    for (const m of bad) expect(parseMessage(m), JSON.stringify(m)).toBe(null);
  });

  it("tidy a player's name: printable, single spaces, sixteen characters at most", () => {
    expect(cleanName('  Pim   the\tbuilder ')).toBe('Pim the builder');
    expect(cleanName('a\u0000b​c')).toBe('abc');
    expect(cleanName('x'.repeat(20))).toBe('x'.repeat(16));
    expect([...cleanName('🐸'.repeat(20))!].length).toBe(16); // by character, not by code unit
    expect(cleanName('')).toBe(null);
    expect(cleanName(' ​ ')).toBe(null);
    expect(cleanName(5)).toBe(null);
    // A hello's name is tidied as it arrives.
    expect(parseMessage({ type: 'hello', version: PROTOCOL, name: '  Pim  ' })).toEqual({ type: 'hello', version: PROTOCOL, name: 'Pim' });
  });
});
