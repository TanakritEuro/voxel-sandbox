import { describe, expect, it } from 'vitest';
import type { Link } from '../src/net/link';
import { Network } from '../src/net/loopback';
import { checkChunk, cleanName, type Message, NAME_LENGTH, packEdits, parseMessage, PROTOCOL, unpackEdits } from '../src/net/protocol';
import { encodeRle } from '../src/save/rle';
import { Block, BLOCKS } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
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

describe('what comes packed', () => {
  it('unpacks edits as they were packed', () => {
    const edits: [number, number, number, number][] = [
      [-1_000_000, 0, 1_000_000, Block.Air],
      [5, 255, -7, BLOCKS.length - 1],
    ];
    expect(unpackEdits(packEdits(edits))).toEqual(edits);
  });

  it('takes a chunk only if it decodes to exactly a chunk of blocks that exist', () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks.fill(Block.Stone, 0, 9000);
    blocks[20000] = Block.Torch;
    const rle = encodeRle(blocks);
    expect(checkChunk(rle)).toEqual(blocks);
    expect(checkChunk(rle.slice(0, rle.length - 2))).toBe(null); // short
    expect(checkChunk(new Uint8Array([...rle, 1, Block.Stone]))).toBe(null); // too long
    const unknown = rle.slice();
    unknown[1] = BLOCKS.length; // a block that doesn't exist
    expect(checkChunk(unknown)).toBe(null);
    expect(checkChunk(new Uint8Array([0x80]))).toBe(null);
    expect(checkChunk(new Uint8Array([0, 1]))).toBe(null); // a run of nothing
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
    { type: 'welcome', you: 2, seed: 20261022, time: 0.25, players, at: [10.5, 70, -3.5], edited: [0, 0, -1, 4], mode: 'survival', kept: { inventory: [null, { item: 1, count: 3 }], health: { health: 12, air: 10 } } },
    { type: 'welcome', you: 2, seed: 20261022, time: 0.25, players, at: [10.5, 70, -3.5], edited: [], mode: 'creative', kept: null },
    { type: 'mode', mode: 'creative' },
    { type: 'kept', survival: { inventory: [], health: { health: 20, air: 10 } } },
    { type: 'reject', reason: 'This world is full.' },
    { type: 'joined', player: { id: 3, name: 'Aroon' } },
    { type: 'left', id: 1, reason: 'Left the game.' },
    { type: 'ping', t: 1.5 },
    { type: 'pong', t: 1.5, at: 7.25 },
    { type: 'bye', reason: 'The host closed the world.' },
    { type: 'ask', cx: -3, cz: 12 },
    { type: 'column', cx: -3, cz: 12, chunks: [{ cy: 2, data: new Uint8Array([0x80, 0x80, 0x02, 1]).buffer }] },
    { type: 'edit', seq: 7, x: -40, y: 64, z: 1000, block: Block.Torch },
    { type: 'edits', from: 2, seq: 7, data: packEdits([[-40, 64, 1000, Block.Torch], [1, 2, 3, Block.Air]]), water: false },
    { type: 'hit', id: 41 },
    { type: 'time', time: 0.75 },
    { type: 'refused', seq: 7, x: -40, y: 64, z: 1000, block: Block.Stone },
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
      { ...welcome, mode: 'hardcore' },
      { ...welcome, kept: [1, 2] },
      { ...welcome, kept: { inventory: 'x'.repeat(9000) } },
      { type: 'mode', mode: 'peaceful' },
      { type: 'kept', survival: null },
      { type: 'kept', survival: { inventory: new Array(3000).fill({ item: 1, count: 64 }) } },
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
      { type: 'ask', cx: 0.5, cz: 0 },
      { type: 'column', cx: 0, cz: 0, chunks: [{ cy: 9, data: new ArrayBuffer(4) }] }, // above the world
      { type: 'column', cx: 0, cz: 0, chunks: [{ cy: 1, data: new ArrayBuffer(4) }, { cy: 1, data: new ArrayBuffer(4) }] },
      { type: 'column', cx: 0, cz: 0, chunks: [{ cy: 1, data: [1, 2] }] },
      { type: 'edit', seq: 0, x: 0, y: 64, z: 0, block: 1 },
      { type: 'edit', seq: 1, x: 0, y: 256, z: 0, block: 1 },
      { type: 'edit', seq: 1, x: 0, y: 64, z: 0, block: BLOCKS.length },
      { type: 'edits', from: 0, seq: 0, data: new ArrayBuffer(12), water: false },
      { type: 'edits', from: 0, seq: 0, data: packEdits([[0, 1, 0, 1]]) }, // no water flag
      { type: 'hit', id: -1 },
      { type: 'time', time: 1 },
      { type: 'mobs', time: 1, data: new ArrayBuffer(50) },
      { type: 'mobsounds', data: new Float32Array([9, 0, 0, 0, 0]).buffer }, // no such voice
      { type: 'edits', from: 0, seq: 0, data: packEdits([[0, -1, 0, 1]]) },
      { type: 'edits', from: 5, seq: 0, data: packEdits([[0, 1, 0, 1]]) },
      { type: 'refused', seq: 1, x: 0, y: 64, z: 0, block: -1 },
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
