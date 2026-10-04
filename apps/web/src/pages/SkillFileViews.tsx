import { FileOutlined } from '@ant-design/icons';
import type { SkillFileChange, SkillFileDiff, SkillFileEntry, SkillFilePreview, SkillReviewView } from '@skill-hub/shared';
import { Alert, Card, Col, Empty, List, Row, Space, Spin, Tag, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatBytes } from '../skillSource';

/** 审核页的文件树、文件预览与文件级差异 */

type DiffKind = Exclude<SkillFileChange, 'unchanged'> | 'removed';

/** 变化的文案与颜色：文件树标签和差异列表共用 */
const CHANGE_META: Record<DiffKind, { label: string; color: string }> = {
  added: { label: '新增', color: 'success' },
  modified: { label: '修改', color: 'warning' },
  removed: { label: '删除', color: 'error' },
};

export const diffTabLabel = (diff: SkillFileDiff) =>
  diff.baseVersion ? `与 ${diff.baseVersion} 的差异（${diff.added.length + diff.modified.length + diff.removed.length}）` : '差异（首个版本）';

/** 由路径列表构造目录树：目录在前，按名称排序 */
function buildTree(files: SkillFileEntry[]): DataNode[] {
  type Dir = { dirs: Map<string, Dir>; files: SkillFileEntry[] };
  const root: Dir = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), files: [] });
      dir = dir.dirs.get(part)!;
    }
    dir.files.push(f);
  }
  const toNodes = (dir: Dir, prefix: string): DataNode[] => [
    ...[...dir.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => ({ key: `dir:${prefix}${name}`, title: name, selectable: false, children: toNodes(child, `${prefix}${name}/`) })),
    ...dir.files.map((f) => ({
      key: f.path,
      isLeaf: true,
      icon: <FileOutlined />,
      title: (
        <Space size={4}>
          <span>{f.path.split('/').pop()}</span>
          {f.change !== 'unchanged' && <Tag color={CHANGE_META[f.change].color}>{CHANGE_META[f.change].label}</Tag>}
        </Space>
      ),
    })),
  ];
  return toNodes(root, '');
}

/** 文件树 + 预览：文本文件显示内容，二进制文件只显示文件名和大小 */
export function FilesPanel({ view }: { view: SkillReviewView }) {
  const [selected, setSelected] = useState('SKILL.md');
  const [preview, setPreview] = useState<SkillFilePreview>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setPreview(undefined);
    setError(undefined);
    api<SkillFilePreview>(`/skills/review-links/${view.id}/file?path=${encodeURIComponent(selected)}`).then(setPreview, (err: Error) => setError(err.message));
  }, [view.id, selected]);

  return (
    <Row gutter={16}>
      <Col xs={24} md={9}>
        <Tree
          data-testid="file-tree"
          showIcon
          defaultExpandAll
          selectedKeys={[selected]}
          treeData={buildTree(view.files)}
          onSelect={(keys) => keys[0] && setSelected(String(keys[0]))}
        />
      </Col>
      <Col xs={24} md={15}>
        <Card size="small" title={selected} data-testid="file-preview" extra={preview && formatBytes(preview.size)}>
          {error && <Alert type="error" showIcon message={error} />}
          {!preview && !error && <Spin />}
          {preview?.binary && <Empty description={`二进制文件，无法预览（${formatBytes(preview.size)}）`} />}
          {preview && !preview.binary && (
            <>
              {preview.truncated && <Alert type="warning" showIcon message="文件较大，只显示开头部分" style={{ marginBottom: 8 }} />}
              <pre style={{ margin: 0, maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 }}>{preview.content}</pre>
            </>
          )}
        </Card>
      </Col>
    </Row>
  );
}

/** 与上一个正式版本的文件级差异（按 sha256 判断）；首个版本全部为新增 */
export function DiffPanel({ diff }: { diff: SkillFileDiff }) {
  const groups: { kind: DiffKind; items: string[] }[] = [
    { kind: 'added', items: diff.added },
    { kind: 'modified', items: diff.modified },
    { kind: 'removed', items: diff.removed },
  ];
  return (
    <div data-testid="file-diff">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          diff.baseVersion
            ? `与上一个正式版本 ${diff.baseVersion} 相比：新增 ${diff.added.length} 个、修改 ${diff.modified.length} 个、删除 ${diff.removed.length} 个文件`
            : '这是首个版本，没有可比较的正式版本：全部为新增'
        }
      />
      <Row gutter={16}>
        {groups.map(({ kind, items }) => (
          <Col xs={24} md={8} key={kind}>
            <List
              size="small"
              bordered
              header={
                <Space>
                  <Tag color={CHANGE_META[kind].color}>{CHANGE_META[kind].label}</Tag>
                  <span>{items.length} 个</span>
                </Space>
              }
              dataSource={items}
              locale={{ emptyText: '无' }}
              renderItem={(path) => <List.Item data-testid={`diff-${CHANGE_META[kind].label}`}>{path}</List.Item>}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
}
