import { BadRequestException } from '@nestjs/common';
import { checkSkillLimits, findSkillRoot, isIgnoredSkillPath, normalizeSkillPath, parseSkillMd, SKILL_ENTRY_FILE, SkillPathError } from '@skill-hub/shared';
import { strFromU8, unzipSync, zipSync } from 'fflate';

/** 校验通过的 Skill 包：files 的路径相对 Skill 根目录（即 SKILL.md 所在目录）。 */
export interface SkillPackage {
  name: string;
  description: string;
  files: Record<string, Uint8Array>;
  sizeBytes: number;
  fileCount: number;
}

/**
 * 解包并校验上传的 zip：忽略垃圾文件后按 zip 目录中声明的大小先检查总量与文件数再解压
 * （fflate 按声明大小截断输出，声明值造假也不会解压出超量数据，防 zip 炸弹）；
 * SKILL.md 必须在根目录或唯一的顶层文件夹中。
 */
export function readSkillPackage(zip: Buffer): SkillPackage {
  let declaredBytes = 0;
  let count = 0;
  // zip 内原始路径 → 规范化路径
  const paths = new Map<string, string>();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (entry) => {
        const path = normalizeSkillPath(entry.name);
        if (path === null || isIgnoredSkillPath(path)) return false;
        paths.set(entry.name, path);
        declaredBytes += entry.originalSize;
        const overLimit = checkSkillLimits(++count, declaredBytes);
        if (overLimit) throw new BadRequestException(overLimit);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    if (err instanceof SkillPathError) throw new BadRequestException(err.message);
    throw new BadRequestException('无法解析上传的压缩包，请确认是 zip 格式');
  }

  const all: Record<string, Uint8Array> = {};
  for (const [raw, data] of Object.entries(entries)) all[paths.get(raw)!] = data;

  const prefix = findSkillRoot(Object.keys(all));
  if (prefix === null) throw new BadRequestException(`根目录（或唯一的顶层文件夹）中缺少 ${SKILL_ENTRY_FILE}`);
  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(all)) {
    if (path.startsWith(prefix)) files[path.slice(prefix.length)] = data;
  }

  const manifest = parseSkillMd(strFromU8(files[SKILL_ENTRY_FILE]));
  if ('error' in manifest) throw new BadRequestException(manifest.error);
  const sizeBytes = Object.values(files).reduce((sum, data) => sum + data.length, 0);
  return { ...manifest, files, sizeBytes, fileCount: Object.keys(files).length };
}

/** 按规范目录重新打包：解压后直接是 <name>/SKILL.md…，可放进本地 skills 目录使用。 */
export function packSkill({ name, files }: SkillPackage): Buffer {
  const entries = Object.fromEntries(Object.entries(files).map(([path, data]) => [`${name}/${path}`, data]));
  return Buffer.from(zipSync(entries, { level: 6 }));
}

/** 解开已存储的包（按规范目录 <name>/… 打包），返回相对 Skill 根目录的路径 → 内容。 */
export function unpackStored(zip: Buffer, name: string): Record<string, Uint8Array> {
  const prefix = `${name}/`;
  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(unzipSync(zip))) {
    if (path.startsWith(prefix) && !path.endsWith('/')) files[path.slice(prefix.length)] = data;
  }
  return files;
}
