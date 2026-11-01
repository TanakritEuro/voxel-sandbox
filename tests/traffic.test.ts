import { describe, expect, it } from 'vitest';
import { Network } from '../src/net/loopback';
import { bytesOf, Traffic } from '../src/net/traffic';

describe('counting what goes over the links', () => {
  it('sizes a message by its binary parts, numbers and text', () => {
    expect(bytesOf(new ArrayBuffer(80))).toBe(80);
    expect(bytesOf(new Int32Array(4))).toBe(16);
    expect(bytesOf({ type: 'state', id: 1, data: new ArrayBuffer(80) })).toBe(2 + (4 + 1 + 7) + (2 + 1 + 9) + (4 + 1 + 80));
  });

  it("counts both ways on every guest of a room, per second, and passes on what's heard", () => {
    const net = new Network();
    let t = 0;
    const traffic = new Traffic(() => t);
    const inner = net.room('X');
    const room = traffic.room(inner);
    const got: unknown[] = [];
    room.onGuest = (link) => {
      link.onMessage = (m) => got.push(m);
      link.send({ data: new ArrayBuffer(1000) });
    };
    // Two guests join; each says something.
    const g1 = inner.join().guest;
    const g2 = inner.join().guest;
    g1.send({ data: new ArrayBuffer(500) });
    g2.send({ data: new ArrayBuffer(500) });
    net.advance(1);
    t = 2;
    const r = traffic.rates();
    expect(got.length).toBe(2);
    // 2 × ~1000 bytes out and 2 × ~500 in, over 2 s.
    expect(r.up).toBeGreaterThan(1000);
    expect(r.up).toBeLessThan(1100);
    expect(r.down).toBeGreaterThan(500);
    expect(r.down).toBeLessThan(550);
    expect(r.messages).toBe(2);
    // Asked again: nothing since.
    t = 3;
    expect(traffic.rates().up).toBe(0);
  });
});
