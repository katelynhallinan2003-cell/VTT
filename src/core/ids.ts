const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random lowercase-alphanumeric id (used for table ids: unguessable, URL friendly). */
export function randomId(len = 16): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS[bytes[i] % CHARS.length];
  return s;
}

let lastTime = 0;
let counter = 0;
/** Time-sortable key, like Firebase push ids: later keys sort after earlier ones. */
export function pushKey(now = Date.now()): string {
  if (now === lastTime) counter++;
  else { lastTime = now; counter = 0; }
  const rand = new Uint8Array(3);
  crypto.getRandomValues(rand);
  return (
    '-' +
    now.toString(36).padStart(9, '0') +
    counter.toString(36).padStart(3, '0') +
    Array.from(rand, (b) => CHARS[b % CHARS.length]).join('')
  );
}

/** Firebase keys can't contain '.', so emails are stored with ',' instead. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}
