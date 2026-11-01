// Room codes, read out between friends: four letters and digits, no 0/O or 1/I. Apart from
// link.ts so tests can use them without loading PeerJS.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

/** A fresh code (not world code: Math.random is fine here). */
export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

/** Tidy up what a player typed: upper case, no spaces; null if it can't be a room code. */
export function cleanRoomCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
