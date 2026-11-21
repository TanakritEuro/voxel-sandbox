import { describe, expect, it } from 'vitest';
import { THUMB_MAX, thumbOf } from '../src/save/store';
import { KEY_LINES, keysFor } from '../src/ui/keys';
import { PICTURE_H, PICTURE_W, seedScene } from '../src/ui/worldPicture';

/** Every source file's text (bundled by Vite at test time). */
const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

describe('the menus', () => {
  it("list every key the game listens for, and none it doesn't", () => {
    // The codes the game reads: compared with e.code, or asked of the input (held, taken, an axis).
    const used = new Set<string>();
    // (Not the table itself.)
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file.endsWith('/ui/keys.ts')) continue;
      for (const m of text.matchAll(/(?:e\.code\s*[!=]==\s*|\.(?:isHeld|take|axis)\()'([A-Za-z0-9]+)'/g)) used.add(m[1]);
      for (const m of text.matchAll(/\['(Key[A-Z]'(?:,\s*'[A-Za-z]+')+)\]/g)) for (const code of m[1].split(/',\s*'/)) used.add(code.replace(/'/g, ''));
    }
    const listed = new Set(KEY_LINES.flatMap((l) => l.codes));
    expect(used.size).toBeGreaterThan(10);
    for (const code of used) expect(listed, `${code} is read but not in the keys table`).toContain(code);
    for (const code of listed) expect(used, `${code} is in the keys table but nothing reads it`).toContain(code);
    // Each mode gets its own E, and only creative flies, only survival throws.
    const what = (mode: 'creative' | 'survival') => [...keysFor(mode).values()].flat().map((l) => l.what);
    expect(what('creative')).toContain('blocks');
    expect(what('creative')).not.toContain('inventory');
    expect(what('survival')).toContain('inventory');
    expect(what('survival').some((w) => w.startsWith('fly'))).toBe(false);
    expect(what('creative').some((w) => w.startsWith('throw'))).toBe(false);
  });

  it("keep a world's picture only when it's a small JPEG or PNG", () => {
    const jpeg = `data:image/jpeg;base64,${'A'.repeat(8000)}`;
    expect(thumbOf(jpeg)).toBe(jpeg);
    expect(thumbOf('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(thumbOf(`data:image/jpeg;base64,${'A'.repeat(THUMB_MAX)}`)).toBeUndefined();
    expect(thumbOf('data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined();
    expect(thumbOf('javascript:alert(1)')).toBeUndefined();
    expect(thumbOf('data:image/jpeg;base64,"><img onerror=x>')).toBeUndefined();
    expect(thumbOf(42)).toBeUndefined();
    expect(thumbOf(undefined)).toBeUndefined();
  });

  it("draw a world never quit from as its seed's landscape: sky over land, the same for a seed, different for another", () => {
    const a = seedScene(20261022);
    expect(a.length).toBe(PICTURE_W * PICTURE_H * 4);
    expect([...seedScene(20261022)]).toEqual([...a]);
    expect([...seedScene(7)]).not.toEqual([...a]);
    // The top row sky (blue over red), the bottom row land (not blue-ish).
    const px = (x: number, y: number) => [...a.slice((y * PICTURE_W + x) * 4, (y * PICTURE_W + x) * 4 + 3)];
    for (const x of [0, 40, 95]) {
      const [r, , b] = px(x, 0);
      expect(b).toBeGreaterThan(r);
      const [br, bg, bb] = px(x, PICTURE_H - 1);
      expect(bb).toBeLessThan(Math.max(br, bg));
    }
  });
});
