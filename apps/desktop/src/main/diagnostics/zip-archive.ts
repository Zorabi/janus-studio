import { deflateRawSync, inflateRawSync } from "node:zlib";

export type ZipArchiveEntry = {
  name: string;
  content: string | Uint8Array;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function localHeader(name: Buffer, crc: number, compressedSize: number, size: number, timestamp: { date: number; time: number }): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name: Buffer, crc: number, compressedSize: number, size: number, offset: number, timestamp: { date: number; time: number }): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(timestamp.time, 12);
  header.writeUInt16LE(timestamp.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

export function createZipArchive(entries: ZipArchiveEntry[], modifiedAt = new Date()): Buffer {
  if (entries.length === 0) throw new Error("ZIP archive requires at least one entry");
  const names = new Set<string>();
  const timestamp = dosDateTime(modifiedAt);
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.includes("..") || entry.name.includes("\\")) {
      throw new Error(`Unsafe ZIP entry name: ${entry.name}`);
    }
    if (names.has(entry.name)) throw new Error(`Duplicate ZIP entry name: ${entry.name}`);
    names.add(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const content = typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : Buffer.from(entry.content);
    const compressed = deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    const local = localHeader(name, checksum, compressed.length, content.length, timestamp);
    body.push(local, name, compressed);
    const central = centralHeader(name, checksum, compressed.length, content.length, offset, timestamp);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const directorySize = directory.reduce((total, chunk) => total + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, ...directory, end]);
}

export function readZipArchive(
  archive: Uint8Array,
  limits: { maxEntries?: number; maxEntryBytes?: number; maxTotalBytes?: number } = {},
): ZipArchiveEntry[] {
  const bytes = Buffer.from(archive);
  const maxEntries = limits.maxEntries ?? 20;
  const maxEntryBytes = limits.maxEntryBytes ?? 8 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 24 * 1024 * 1024;
  const entries: ZipArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  let total = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    if (entries.length >= maxEntries) throw new Error("诊断包文件数量超出安全限制");
    if (offset + 30 > bytes.length) throw new Error("诊断包 ZIP 头不完整");
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const size = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    if ((flags & 0x0008) !== 0) throw new Error("诊断包不支持数据描述符 ZIP");
    if (size > maxEntryBytes || total + size > maxTotalBytes) throw new Error("诊断包解压体积超出安全限制");
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;
    if (contentEnd > bytes.length) throw new Error("诊断包 ZIP 内容不完整");
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (!name || name.startsWith("/") || name.includes("..") || name.includes("\\")) throw new Error("诊断包包含不安全路径");
    if (names.has(name)) throw new Error("诊断包包含重复文件名");
    names.add(name);
    const compressed = bytes.subarray(contentStart, contentEnd);
    const content = method === 8 ? inflateRawSync(compressed) : method === 0 ? compressed : null;
    if (!content || content.length !== size) throw new Error("诊断包包含不支持或损坏的 ZIP 项");
    total += content.length;
    entries.push({ name, content });
    offset = contentEnd;
  }
  if (entries.length === 0) throw new Error("选择的文件不是有效诊断 ZIP");
  return entries;
}
