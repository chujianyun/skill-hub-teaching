import { strToU8, zipSync } from 'fflate';
import type request from 'supertest';

/** SKILL.md 内容（frontmatter + 正文）。 */
export const skillMd = (name: string, description = `${name} 的说明`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n使用说明。\n`;

/** 按 路径 → 内容 打包为 zip（模拟浏览器选择文件夹后打包的结果）。 */
export function zipOf(files: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]))));
}

/** 顶层文件夹 + SKILL.md + 一个脚本、一个参考文档。 */
export const skillFolderZip = (name: string, folder = name) =>
  zipOf({
    [`${folder}/SKILL.md`]: skillMd(name),
    [`${folder}/scripts/run.sh`]: 'echo hello\n',
    [`${folder}/reference/guide.md`]: '# 参考\n',
  });

/** 某个版本的包：SKILL.md（描述带标记）+ 一个标明版本的文件，便于核对下载内容 */
export const versionZip = (name: string, marker: string, folder = name) =>
  zipOf({ [`${folder}/SKILL.md`]: skillMd(name, `${name} ${marker}`), [`${folder}/VERSION.txt`]: marker });

/** 以二进制接收响应体（下载 zip / 静态文件）。 */
export const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
