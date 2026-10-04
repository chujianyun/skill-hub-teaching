import { checkSkillLimits, findSkillRoot, isIgnoredSkillPath, normalizeSkillPath, parseSkillMd, SKILL_ENTRY_FILE, SkillPathError } from '@skill-hub/shared';
import { unzipSync, zipSync } from 'fflate';

export interface PackedSkill {
  name: string;
  description: string;
  fileCount: number;
  sizeBytes: number;
  zip: Blob;
}

type PackResult = PackedSkill | { error: string };

/** 一个待打包的文件：相对路径（a/b/c）、大小、读取内容。三种来源（选择文件夹、拖入文件夹、.zip）都先转成它。 */
interface SourceFile {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

class SourceError extends Error {}

type SourceKind = 'folder' | 'zip';

/** 各来源的提示文案 */
const MESSAGES: Record<SourceKind, { empty: string; noEntry: string }> = {
  folder: { empty: '所选文件夹是空的', noEntry: `所选文件夹的根目录中缺少 ${SKILL_ENTRY_FILE}` },
  zip: { empty: '压缩包是空的', noEntry: `压缩包的根目录（或唯一的顶层文件夹）中缺少 ${SKILL_ENTRY_FILE}` },
};

/** 选择文件夹（webkitdirectory）：webkitRelativePath 形如「所选文件夹/子目录/文件」。 */
export function packSkillFolder(files: File[]): Promise<PackResult> {
  return pack('folder', async () => files.map((file) => fromFile(file.webkitRelativePath || file.name, file)));
}

/** 选择或拖入的 .zip：SKILL.md 须在根目录或唯一的顶层文件夹中。 */
export function packSkillZip(file: File): Promise<PackResult> {
  return pack('zip', () => readZip(file));
}

/** 拖入页面的内容：一个文件夹，或一个 .zip 文件。 */
export function packSkillDrop(dataTransfer: DataTransfer): Promise<PackResult> {
  const entries = [...dataTransfer.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry());
  const [entry] = entries;
  if (entries.length !== 1 || !entry) return Promise.resolve({ error: '请拖入一个文件夹或一个 .zip 文件' });
  if (entry.isDirectory) return pack('folder', () => readDirectory(entry as FileSystemDirectoryEntry, entry.name));
  if (entry.name.toLowerCase().endsWith('.zip')) {
    return pack('zip', async () => readZip(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))));
  }
  return Promise.resolve({ error: '请拖入一个文件夹或一个 .zip 文件' });
}

/**
 * 过滤垃圾文件 → 检查文件数与大小 → 找到 SKILL.md（根目录或唯一的顶层文件夹）并预读 name/description → 打包成 zip 上传。
 * 这里的检查只为及早提示，服务端会再次完整校验。
 */
async function pack(kind: SourceKind, collect: () => Promise<SourceFile[]>): Promise<PackResult> {
  try {
    const files = (await collect()).filter((f) => !isIgnoredSkillPath(f.path));
    if (files.length === 0) return { error: MESSAGES[kind].empty };
    const sizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    const overLimit = checkSkillLimits(files.length, sizeBytes);
    if (overLimit) return { error: `${overLimit}（当前 ${files.length} 个文件、${formatBytes(sizeBytes)}）` };

    const root = findSkillRoot(files.map((f) => f.path));
    const entry = root === null ? undefined : files.find((f) => f.path === `${root}${SKILL_ENTRY_FILE}`);
    if (!entry) return { error: MESSAGES[kind].noEntry };
    const manifest = parseSkillMd(new TextDecoder().decode(await entry.read()));
    if ('error' in manifest) return manifest;

    const data = Object.fromEntries(await Promise.all(files.map(async (f) => [f.path, await f.read()] as const)));
    const zip = new Blob([zipSync(data, { level: 6 })], { type: 'application/zip' });
    return { ...manifest, fileCount: files.length, sizeBytes, zip };
  } catch (err) {
    if (err instanceof SourceError) return { error: err.message };
    throw err;
  }
}

const fromFile = (path: string, file: File): SourceFile => ({ path, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) });

/** 递归读取拖入的文件夹（readEntries 每次最多返回一批，要读到空为止）。 */
async function readDirectory(dir: FileSystemDirectoryEntry, prefix: string): Promise<SourceFile[]> {
  const reader = dir.createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const files: SourceFile[] = [];
  for (const child of children) {
    const path = `${prefix}/${child.name}`;
    if (isIgnoredSkillPath(path)) continue;
    if (child.isDirectory) files.push(...(await readDirectory(child as FileSystemDirectoryEntry, path)));
    else files.push(fromFile(path, await new Promise<File>((resolve, reject) => (child as FileSystemFileEntry).file(resolve, reject))));
  }
  return files;
}

/** 解压 .zip：与服务端一致，按声明大小先检查总量与文件数再解压，拒绝 .. 与绝对路径。 */
async function readZip(file: File): Promise<SourceFile[]> {
  let declared = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        const path = normalizeSkillPath(entry.name);
        if (path === null || isIgnoredSkillPath(path)) return false;
        declared += entry.originalSize;
        const overLimit = checkSkillLimits(++count, declared);
        if (overLimit) throw new SourceError(overLimit);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(err instanceof SkillPathError ? err.message : '无法解析压缩包，请确认是 zip 格式');
  }
  return Object.entries(entries).map(([raw, data]) => ({ path: normalizeSkillPath(raw)!, size: data.length, read: async () => data }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
