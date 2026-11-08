// PNG mínimo (sem dependência): grava RGBA 8 bits e lê PNG 8 bits RGB/RGBA/cinza sem entrelaçamento, todos os filtros.
// Especificação: https://www.w3.org/TR/png-3/
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** codifica RGBA (Uint8Array, linhas de cima para baixo) em PNG */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = width * 4, raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (row + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1); }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** decodifica PNG em { width, height, rgba } */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("não é PNG");
  let p = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || !channels || interlace) throw new Error(`PNG não suportado (profundidade ${depth}, tipo ${ctype}, entrelaçado ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat)), bpp = channels, row = width * bpp;
  const out = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (row + 1)], src = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)), dst = y * row, up = dst - row;
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y > 0 ? out[up + i] : 0, c = i >= bpp && y > 0 ? out[up + i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp;
    if (channels === 4) rgba.set(out.subarray(s, s + 4), i * 4);
    else if (channels === 3) { rgba[i * 4] = out[s]; rgba[i * 4 + 1] = out[s + 1]; rgba[i * 4 + 2] = out[s + 2]; rgba[i * 4 + 3] = 255; }
    else if (channels === 2) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[s]; rgba[i * 4 + 3] = out[s + 1]; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[s]; rgba[i * 4 + 3] = 255; }
  }
  return { width, height, rgba };
}
