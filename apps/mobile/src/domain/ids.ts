function randomHex(length: number) {
  let output = '';
  while (output.length < length) {
    output += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  }
  return output.slice(0, length);
}

export function uuidv7(now = Date.now()) {
  const timestamp = Math.max(0, Math.floor(now)).toString(16).padStart(12, '0').slice(-12);
  const randA = randomHex(3);
  const randB = randomHex(15);
  const raw = `${timestamp}7${randA}${(8 + Math.floor(Math.random() * 4)).toString(16)}${randB}`;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export function isUuidv7(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
