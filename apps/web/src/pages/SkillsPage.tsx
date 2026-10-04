import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { SkillCategory, SkillDetail, SkillListQuery, SkillReviewStep, SkillSummary, SkillVersionInfo, SkillVisibilityOptions } from '@skill-hub/shared';
import { Alert, App, Button, Card, Descriptions, Popconfirm, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useCurrentEmployee } from '../session';
import { useSkillBadges } from '../skillBadges';
import { formatBytes } from '../skillSource';
import { CategoryFilterBar, CategoryText, SkillCategoryManager, SkillCategoryModal, useSkillCategories } from './SkillCategories';
import { SkillFilters, SkillGovernanceActions, SkillManageTable, toQueryString, UnlistedAlert } from './SkillManage';
import { downloadUrl, formatTime, ReviewLinkText, ReviewRecordsTable, showReviewLink, StatusTag } from './SkillParts';
import { hasNoVisibleDepartments, NoVisibleDepartmentsAlert, VisibilityModal, VisibilityText } from './SkillVisibility';
import { UploadSkillModal, type UploadTarget } from './UploadSkillModal';

/** 上传人筛选的候选：本租户在职员工 */
type Uploaders = SkillVisibilityOptions['employees'];

/** 上传人筛选用的本租户在职员工 */
function useUploaders() {
  const [uploaders, setUploaders] = useState<Uploaders>();
  useEffect(() => {
    api<SkillVisibilityOptions>('/skills/visibility-options').then((o) => setUploaders(o.employees), () => setUploaders([]));
  }, []);
  return uploaders;
}

/**
 * Skill 页：目录（本租户能看到的、有正式版本的 Skill，可搜索与按上传人筛选）；任何员工都可以上传（员工上传须审核）。
 * 租户管理员另有「管理」视图：含草稿、审核中、已下架的 Skill，可按审核状态、可见性、是否下架、分类（含未分类）筛选；
 * 以及「分类」标签页维护本租户的 Skill 分类（#20）。
 */
export function SkillsPage() {
  const navigate = useNavigate();
  const isTenantAdmin = useCurrentEmployee()?.isTenantAdmin ?? false;
  const uploaders = useUploaders();
  const { categories, setCategories } = useSkillCategories();
  const [uploading, setUploading] = useState(false);

  return (
    <Card
      title="Skill"
      extra={
        <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploading(true)}>
          上传 Skill
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        Skill 是以 SKILL.md 为入口的文件夹。下载后解压到本地 AI 客户端（如 Claude Code、WorkBuddy）的 skills 目录即可使用。
      </Typography.Paragraph>
      {isTenantAdmin ? (
        <Tabs
          items={[
            { key: 'catalog', label: '目录', children: <SkillCatalog uploaders={uploaders} categories={categories} /> },
            { key: 'manage', label: '管理', children: <SkillManageTable apiPath="/skills/manage" detailPath={(id) => id} uploaders={uploaders} categories={categories} /> },
            { key: 'categories', label: '分类', children: <SkillCategoryManager categories={categories} onChange={setCategories} /> },
          ]}
        />
      ) : (
        <SkillCatalog uploaders={uploaders} categories={categories} />
      )}
      {uploading && (
        <UploadSkillModal
          target={{ kind: 'new' }}
          onCancel={() => setUploading(false)}
          onUploaded={(skill) => {
            setUploading(false);
            navigate(skill.id);
          }}
          onOpenExisting={(skillId) => {
            setUploading(false);
            navigate(skillId);
          }}
        />
      )}
    </Card>
  );
}

/** 目录：本租户能看到的、有正式版本的 Skill，可按名称 / 描述搜索、按上传人与分类筛选 */
function SkillCatalog({ uploaders, categories }: { uploaders?: Uploaders; categories?: SkillCategory[] }) {
  const [query, setQuery] = useState<SkillListQuery>({});
  const [skills, setSkills] = useState<SkillSummary[]>();
  const [error, setError] = useState<string>();

  // 分类被删除时清掉对应的筛选条件
  useEffect(() => {
    if (categories && query.categoryId && !categories.some((c) => c.id === query.categoryId)) setQuery((q) => ({ ...q, categoryId: undefined }));
  }, [categories, query.categoryId]);

  // 分类有变化（改名、删除）时也重新加载
  useEffect(() => {
    api<SkillSummary[]>(`/skills${toQueryString(query)}`).then(
      (list) => {
        setSkills(list);
        setError(undefined);
      },
      (err: Error) => setError(err.message),
    );
  }, [query, categories]);

  return (
    <>
      <CategoryFilterBar categories={categories} value={query.categoryId} onChange={(categoryId) => setQuery({ ...query, categoryId })} />
      <SkillFilters value={query} onChange={setQuery} manage={false} uploaders={uploaders} />
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table<SkillSummary>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={!skills && !error}
        dataSource={skills}
        pagination={false}
        locale={{ emptyText: query.keyword || query.uploaderId || query.categoryId ? '没有符合条件的 Skill' : '暂无可用的 Skill，点击右上角「上传 Skill」' }}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            render: (name: string, s) => (
              <Space direction="vertical" size={0}>
                <Link to={s.id}>{name}</Link>
                <Typography.Text type="secondary" ellipsis={{ tooltip: s.currentVersion.description }} style={{ maxWidth: 480, fontSize: 12 }}>
                  {s.currentVersion.description}
                </Typography.Text>
              </Space>
            ),
          },
          { title: '分类', key: 'category', width: 110, render: (_, s) => <CategoryText category={s.category} /> },
          { title: '当前版本', key: 'version', width: 110, render: (_, s) => <Tag color="blue">{s.currentVersion.version}</Tag> },
          { title: '上传人', key: 'uploader', width: 120, render: (_, s) => s.currentVersion.uploaderName },
          { title: '上传时间', key: 'uploadedAt', width: 180, render: (_, s) => formatTime(s.currentVersion.uploadedAt) },
          {
            title: '操作',
            key: 'actions', fixed: 'right',
            width: 90,
            render: (_, s) => (
              <a href={downloadUrl(s.id, s.currentVersion.id)} download>
                下载
              </a>
            ),
          },
        ]}
      />
    </>
  );
}

/**
 * Skill 详情：当前版本、版本历史（任一正式版本可下载）。
 * 所有者与租户管理员另可看到进行中的版本（草稿 / 审核中）及其操作、该 Skill 的审核记录，并可上传新版本。
 */
export function SkillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isTenantAdmin = useCurrentEmployee()?.isTenantAdmin ?? false;
  const [skill, setSkill] = useState<SkillDetail>();
  const [error, setError] = useState<string>();
  const [upload, setUpload] = useState<UploadTarget>();
  const [editingVisibility, setEditingVisibility] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);

  const reload = useCallback(() => {
    api<SkillDetail>(`/skills/${id}`).then(
      (s) => {
        setSkill(s);
        setError(undefined);
      },
      (err: Error) => setError(err.message),
    );
  }, [id]);

  useEffect(() => {
    setSkill(undefined);
    reload();
  }, [reload]);

  const canManage = !!skill && (skill.isOwner || isTenantAdmin);
  const version = skill?.currentVersion;
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        loading={!skill && !error}
        title={
          <Space>
            <Link to=".." relative="path">
              Skill
            </Link>
            <span>/</span>
            <span>{skill?.name}</span>
          </Space>
        }
        extra={
          skill && (
            <Space>
              {canManage && (
                <Tooltip title={skill.workingVersion ? `已有未成为正式的版本 ${skill.workingVersion.version}，请先处理` : undefined}>
                  <Button icon={<UploadOutlined />} disabled={!!skill.workingVersion} onClick={() => setUpload({ kind: 'version', skill })}>
                    上传新版本
                  </Button>
                </Tooltip>
              )}
              {version && (
                <Button type="primary" icon={<DownloadOutlined />} href={downloadUrl(skill.id, version.id)} download>
                  下载 {version.version}
                </Button>
              )}
              <SkillGovernanceActions
                skill={skill}
                basePath="/skills"
                canUnlist={isTenantAdmin}
                canDelete={canManage}
                onChanged={reload}
                onDeleted={() => navigate('..', { relative: 'path' })}
              />
            </Space>
          )
        }
      >
        {error && <Alert type="error" showIcon message={error} />}
        {skill?.unlisted && canManage && (
          <div style={{ marginBottom: 16 }}>
            <UnlistedAlert />
          </div>
        )}
        {skill && (
          <Descriptions bordered column={1} data-testid="skill-detail">
            <Descriptions.Item label="名称">{skill.name}</Descriptions.Item>
            <Descriptions.Item label="描述">{(version ?? skill.workingVersion)?.description}</Descriptions.Item>
            <Descriptions.Item label="当前版本">{version ? <Tag color="blue">{version.version}</Tag> : <Typography.Text type="secondary">暂无正式版本</Typography.Text>}</Descriptions.Item>
            {version && <Descriptions.Item label="上传人">{version.uploaderName}</Descriptions.Item>}
            {version && <Descriptions.Item label="上传时间">{formatTime(version.uploadedAt)}</Descriptions.Item>}
            {version && (
              <Descriptions.Item label="文件">
                {version.fileCount} 个，{formatBytes(version.sizeBytes)}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="所有者">{skill.ownerName}</Descriptions.Item>
            <Descriptions.Item label="分类">
              <Space>
                <span data-testid="skill-category">
                  <CategoryText category={skill.category} />
                </span>
                {canManage && (
                  <Button size="small" onClick={() => setEditingCategory(true)}>
                    修改分类
                  </Button>
                )}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="可见性">
              <Space>
                <span data-testid="skill-visibility">
                  <VisibilityText info={skill.visibility} />
                </span>
                {canManage && (
                  <Button size="small" onClick={() => setEditingVisibility(true)}>
                    修改可见性
                  </Button>
                )}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}
        {skill && canManage && hasNoVisibleDepartments(skill.visibility) && (
          <div style={{ marginTop: 16 }}>
            <NoVisibleDepartmentsAlert />
          </div>
        )}
      </Card>
      {skill && canManage && skill.workingVersion && (
        <WorkingVersionCard
          skill={skill}
          onChanged={reload}
          // 删掉的是唯一的版本时 Skill 也一并删除，回到「我的 Skill」
          onDeleted={() => (skill.currentVersion ? reload() : navigate('../../my-skills', { relative: 'path' }))}
          onReupload={() => setUpload({ kind: 'replace', skill, version: skill.workingVersion! })}
        />
      )}
      {skill && skill.versions.length > 0 && (
        <VersionHistoryCard skill={skill} canDelete={isTenantAdmin} onDeleted={() => (skill.versions.length + (skill.workingVersion ? 1 : 0) > 1 ? reload() : navigate('..', { relative: 'path' }))} />
      )}
      {skill && canManage && (
        <Card title="审核记录" data-testid="review-records">
          <ReviewRecordsTable records={skill.reviewRecords} />
        </Card>
      )}
      {editingVisibility && skill && (
        <VisibilityModal
          skill={skill}
          onCancel={() => setEditingVisibility(false)}
          onSaved={(updated) => {
            setEditingVisibility(false);
            setSkill(updated);
          }}
        />
      )}
      {editingCategory && skill && (
        <SkillCategoryModal
          skill={skill}
          onCancel={() => setEditingCategory(false)}
          onSaved={(updated) => {
            setEditingCategory(false);
            setSkill(updated);
          }}
        />
      )}
      {upload && (
        <UploadSkillModal
          target={upload}
          onCancel={() => setUpload(undefined)}
          onUploaded={(updated) => {
            setUpload(undefined);
            setSkill(updated);
          }}
        />
      )}
    </Space>
  );
}

/** 进行中的版本（草稿或审核中）：状态、驳回意见与可用操作（按所有者 / 上传人 / 租户管理员身份） */
function WorkingVersionCard({
  skill,
  onChanged,
  onDeleted,
  onReupload,
}: {
  skill: SkillDetail;
  onChanged: () => void;
  onDeleted: () => void;
  onReupload: () => void;
}) {
  const { message, modal } = App.useApp();
  const { refresh } = useSkillBadges();
  const isTenantAdmin = useCurrentEmployee()?.isTenantAdmin ?? false;
  const v = skill.workingVersion!;
  const canEdit = skill.isOwner || v.uploadedByMe;

  // onConfirm 不返回 Promise，避免失败后「确定」停在加载态
  async function run(request: Promise<unknown>, done: string, after = onChanged) {
    try {
      await request;
      message.success(done);
      refresh();
      after();
    } catch (err) {
      message.error((err as Error).message);
      refresh();
      onChanged();
    }
  }
  const step = (s: SkillReviewStep) => api(`/skills/${skill.id}/versions/${v.id}/${s}`, { method: 'POST' });

  const actions =
    v.status === 'draft'
      ? [
          skill.isOwner && !isTenantAdmin && (
            <Button
              key="submit"
              type="primary"
              onClick={() => void run(step('submit'), `已提交 ${v.version}，等待租户管理员审核`, () => {
                onChanged();
                showReviewLink(modal, v.id);
              })}
            >
              提交审核
            </Button>
          ),
          isTenantAdmin && v.uploadedByMe && (
            <Popconfirm key="publish" title={`直接发布 ${v.version}？`} description="发布后成为当前版本，本租户员工都能下载" onConfirm={() => void run(step('publish'), `已直接发布 ${v.version}，已成为正式版本`)}>
              <Button type="primary">直接发布</Button>
            </Popconfirm>
          ),
          canEdit && (
            <Button key="reupload" onClick={onReupload}>
              重新上传
            </Button>
          ),
          canEdit && (
            <Popconfirm
              key="delete"
              title={`删除草稿 ${v.version}？`}
              description={skill.currentVersion ? '删除后不可恢复' : '这是该 Skill 唯一的版本，删除后 Skill 也一并删除'}
              onConfirm={() => void run(api(`/skills/${skill.id}/versions/${v.id}`, { method: 'DELETE' }), `已删除草稿 ${v.version}`, onDeleted)}
            >
              <Button danger>删除草稿</Button>
            </Popconfirm>
          ),
        ]
      : [
          skill.isOwner && (
            <Popconfirm key="withdraw" title={`撤回 ${v.version} 的审核？`} description="撤回后回到草稿，可修改后再提交" onConfirm={() => void run(step('withdraw'), `已撤回 ${v.version}`)}>
              <Button>撤回</Button>
            </Popconfirm>
          ),
          isTenantAdmin && (
            <Link key="review" to={`/tenant/reviews/${v.id}`}>
              <Button type="primary">去审核</Button>
            </Link>
          ),
        ];

  return (
    <Card title="进行中的版本" data-testid="working-version" extra={<Space>{actions.filter(Boolean)}</Space>}>
      {v.rejectComment && <Alert type="error" showIcon style={{ marginBottom: 16 }} message="审核未通过，已退回草稿" description={`驳回意见：${v.rejectComment}`} />}
      <Descriptions column={2} size="small">
        <Descriptions.Item label="版本号">{v.version}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <StatusTag status={v.status} rejected={!!v.rejectComment} />
        </Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>
          {v.description}
        </Descriptions.Item>
        <Descriptions.Item label="上传人">{v.uploaderName}</Descriptions.Item>
        <Descriptions.Item label="上传时间">{formatTime(v.uploadedAt)}</Descriptions.Item>
        <Descriptions.Item label="文件">
          {v.fileCount} 个，{formatBytes(v.sizeBytes)}
          <a href={downloadUrl(skill.id, v.id)} download style={{ marginLeft: 12 }}>
            下载审阅
          </a>
        </Descriptions.Item>
        {v.status === 'pending' && (
          <Descriptions.Item label="审核链接" span={2}>
            <ReviewLinkText versionId={v.id} />
          </Descriptions.Item>
        )}
      </Descriptions>
    </Card>
  );
}

/** 版本历史；租户管理员可删除单个版本（删除最后一个版本时 Skill 一并删除） */
function VersionHistoryCard({ skill, canDelete, onDeleted }: { skill: SkillDetail; canDelete: boolean; onDeleted: () => void }) {
  const { message } = App.useApp();
  async function remove(v: SkillVersionInfo) {
    try {
      await api(`/skills/${skill.id}/versions/${v.id}`, { method: 'DELETE' });
      message.success(`已删除版本 ${v.version}`);
      onDeleted();
    } catch (err) {
      message.error((err as Error).message);
    }
  }
  return (
    <Card title="版本历史" data-testid="version-history">
      <Table<SkillVersionInfo>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        dataSource={skill.versions}
        pagination={false}
        columns={[
          {
            title: '版本号',
            dataIndex: 'version',
            width: 150,
            render: (v: string, row) => (
              <Space size={4}>
                <Tag color={row.id === skill.currentVersion?.id ? 'blue' : undefined}>{v}</Tag>
                {row.id === skill.currentVersion?.id && <Typography.Text type="secondary">当前</Typography.Text>}
              </Space>
            ),
          },
          { title: '描述', dataIndex: 'description', ellipsis: true },
          { title: '上传人', dataIndex: 'uploaderName', width: 110 },
          { title: '上传时间', dataIndex: 'uploadedAt', width: 180, render: formatTime },
          { title: '下载次数', dataIndex: 'downloadCount', width: 90 },
          {
            title: '操作',
            key: 'actions', fixed: 'right',
            width: canDelete ? 120 : 80,
            render: (_, row) => (
              <Space>
                <a href={downloadUrl(skill.id, row.id)} download>
                  下载
                </a>
                {canDelete && (
                  <Popconfirm title={`删除版本 ${row.version}？`} description="删除后文件不可恢复，审核记录保留" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => void remove(row)}>
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
