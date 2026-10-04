import { DeleteOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import {
  SKILL_VERSION_STATUS_LABELS,
  SKILL_UNCATEGORIZED,
  SKILL_VISIBILITY_LABELS,
  type SkillCategory,
  type SkillDetail,
  type SkillManageQuery,
  type SkillManageRow,
  skillReviewPath,
  type SkillVersionStatus,
  type SkillVisibility,
  type SkillVisibilityOptions,
  type Tenant,
} from '@skill-hub/shared';
import { Alert, App, Button, Card, Descriptions, Input, Popconfirm, Result, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { formatBytes } from '../skillSource';
import { categoryOptions, CategoryText } from './SkillCategories';
import { formatTime, ReviewRecordsTable, StatusTag } from './SkillParts';
import { VisibilityText } from './SkillVisibility';

/** Skill 治理：管理视图（租户管理员、超管共用）、超管的 Skill 页与详情页、下架提示与操作。 */

export const toQueryString = (q: object) => {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '') as [string, string][]);
  return params.size ? `?${params}` : '';
};

/** 搜索与筛选条：员工只有名称 / 描述与上传人（分类在目录顶部的筛选条）；管理视图另有审核状态、可见性、是否下架、分类（含未分类） */
export function SkillFilters<Q extends SkillManageQuery>({
  value,
  onChange,
  manage,
  uploaders,
  categories,
}: {
  value: Q;
  onChange: (q: Q) => void;
  manage: boolean;
  uploaders?: SkillVisibilityOptions['employees'];
  /** 管理视图的分类筛选候选；不传则不显示分类筛选（如超管视图） */
  categories?: SkillCategory[];
}) {
  return (
    <Space wrap style={{ marginBottom: 16 }} data-testid="skill-filters">
      <Input.Search allowClear placeholder="搜索名称或描述" style={{ width: 220 }} defaultValue={value.keyword} onSearch={(keyword) => onChange({ ...value, keyword: keyword.trim() || undefined })} />
      {uploaders && (
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="上传人"
          data-testid="filter-uploader"
          style={{ width: 160 }}
          value={value.uploaderId}
          onChange={(uploaderId) => onChange({ ...value, uploaderId })}
          options={uploaders.map((u) => ({ value: u.id, label: u.name }))}
        />
      )}
      {manage && (
        <>
          <Select
            allowClear
            placeholder="审核状态"
            data-testid="filter-status"
            style={{ width: 130 }}
            value={value.status}
            onChange={(status: SkillVersionStatus | undefined) => onChange({ ...value, status })}
            options={(['published', 'pending', 'draft'] as SkillVersionStatus[]).map((s) => ({ value: s, label: `有${SKILL_VERSION_STATUS_LABELS[s]}版本` }))}
          />
          <Select
            allowClear
            placeholder="可见性"
            data-testid="filter-visibility"
            style={{ width: 150 }}
            value={value.visibility}
            onChange={(visibility: SkillVisibility | undefined) => onChange({ ...value, visibility })}
            options={(Object.keys(SKILL_VISIBILITY_LABELS) as SkillVisibility[]).map((v) => ({ value: v, label: SKILL_VISIBILITY_LABELS[v] }))}
          />
          {categories && (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="分类"
              data-testid="filter-category"
              style={{ width: 130 }}
              value={value.categoryId}
              onChange={(categoryId: string | undefined) => onChange({ ...value, categoryId })}
              options={categoryOptions(categories, true)}
            />
          )}
          <Select
            allowClear
            placeholder="上架状态"
            data-testid="filter-unlisted"
            style={{ width: 130 }}
            value={value.unlisted}
            onChange={(unlisted: 'true' | 'false' | undefined) => onChange({ ...value, unlisted })}
            options={[
              { value: 'false', label: '上架中' },
              { value: 'true', label: '已下架' },
            ]}
          />
        </>
      )}
    </Space>
  );
}

/** 管理视图表格：含还没有正式版本、已下架的 Skill；apiPath 为租户管理员的 /skills/manage 或超管的 /admin/tenants/:id/skills */
export function SkillManageTable({
  apiPath,
  detailPath,
  uploaders,
  categories,
}: {
  apiPath: string;
  detailPath: (id: string) => string;
  uploaders?: SkillVisibilityOptions['employees'];
  categories?: SkillCategory[];
}) {
  const [query, setQuery] = useState<SkillManageQuery>({});
  const [rows, setRows] = useState<SkillManageRow[]>();
  const [error, setError] = useState<string>();

  // 分类被删除时清掉对应的筛选条件
  useEffect(() => {
    if (categories && query.categoryId && query.categoryId !== SKILL_UNCATEGORIZED && !categories.some((c) => c.id === query.categoryId)) {
      setQuery((q) => ({ ...q, categoryId: undefined }));
    }
  }, [categories, query.categoryId]);

  // 分类有变化（改名、删除）时也重新加载，各行的分类随之更新
  useEffect(() => {
    setRows(undefined);
    api<SkillManageRow[]>(`${apiPath}${toQueryString(query)}`).then(
      (r) => {
        setRows(r);
        setError(undefined);
      },
      (err: Error) => setError(err.message),
    );
  }, [apiPath, query, categories]);

  return (
    <>
      <SkillFilters value={query} onChange={setQuery} manage uploaders={uploaders} categories={categories} />
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table<SkillManageRow>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={!rows && !error}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '没有符合条件的 Skill' }}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            render: (name: string, r) => (
              <Space direction="vertical" size={0}>
                <Space size={4}>
                  <Link to={detailPath(r.id)}>{name}</Link>
                  {r.unlisted && <Tag color="default" icon={<EyeInvisibleOutlined />}>已下架</Tag>}
                </Space>
                <Typography.Text type="secondary" ellipsis style={{ maxWidth: 360, fontSize: 12 }}>
                  {r.currentVersion?.description}
                </Typography.Text>
              </Space>
            ),
          },
          { title: '分类', key: 'category', width: 100, render: (_, r) => <CategoryText category={r.category} /> },
          { title: '当前版本', key: 'current', width: 100, render: (_, r) => (r.currentVersion ? <Tag color="blue">{r.currentVersion.version}</Tag> : <Typography.Text type="secondary">暂无</Typography.Text>) },
          { title: '进行中', key: 'working', width: 100, render: (_, r) => (r.workingStatus ? <StatusTag status={r.workingStatus} /> : <Typography.Text type="secondary">—</Typography.Text>) },
          { title: '可见性', dataIndex: 'visibility', width: 120, render: (v: SkillVisibility) => SKILL_VISIBILITY_LABELS[v] },
          { title: '所有者', dataIndex: 'ownerName', width: 100 },
          { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: formatTime },
        ]}
      />
    </>
  );
}

/** 已下架提示（所有者、管理员看得到） */
export function UnlistedAlert() {
  return <Alert type="warning" showIcon data-testid="unlisted-alert" message="已下架" description="除所有者与管理员外，其他员工看不到也下载不了；版本和文件都保留，可以重新上架。" />;
}

/** 下架 / 上架、删除 Skill 的操作按钮；basePath 为 /skills（租户管理员、所有者）或 /admin/skills（超管） */
export function SkillGovernanceActions({
  skill,
  basePath,
  canUnlist,
  canDelete,
  onChanged,
  onDeleted,
}: {
  skill: SkillDetail;
  basePath: string;
  canUnlist: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { message } = App.useApp();
  // onConfirm 不返回 Promise，避免失败后「确定」停在加载态
  async function run(path: string, method: string, done: string, after: () => void) {
    try {
      await api(path, { method });
      message.success(done);
      after();
    } catch (err) {
      message.error((err as Error).message);
      onChanged();
    }
  }
  return (
    <>
      {canUnlist &&
        (skill.unlisted ? (
          <Popconfirm title={`重新上架「${skill.name}」？`} description="按可见性对员工重新可见" onConfirm={() => void run(`${basePath}/${skill.id}/relist`, 'POST', `已重新上架「${skill.name}」`, onChanged)}>
            <Button icon={<EyeOutlined />}>上架</Button>
          </Popconfirm>
        ) : (
          <Popconfirm title={`下架「${skill.name}」？`} description="除所有者与管理员外的员工将看不到也下载不了，版本和文件保留" onConfirm={() => void run(`${basePath}/${skill.id}/unlist`, 'POST', `已下架「${skill.name}」`, onChanged)}>
            <Button icon={<EyeInvisibleOutlined />}>下架</Button>
          </Popconfirm>
        ))}
      {canDelete && (
        <Popconfirm
          title={`删除「${skill.name}」？`}
          description="将永久删除所有版本、文件与审核记录，无法恢复"
          okText="删除"
          okButtonProps={{ danger: true }}
          onConfirm={() => void run(`${basePath}/${skill.id}`, 'DELETE', `已删除「${skill.name}」`, onDeleted)}
        >
          <Button danger icon={<DeleteOutlined />}>
            删除 Skill
          </Button>
        </Popconfirm>
      )}
    </>
  );
}

/** 超管的 Skill 页：先选租户，再看该租户的全部 Skill */
export function AdminSkillsPage() {
  const [tenants, setTenants] = useState<Tenant[]>();
  const [tenantId, setTenantId] = useState<string>();
  useEffect(() => {
    api<Tenant[]>('/admin/tenants').then(setTenants, () => setTenants([]));
  }, []);
  return (
    <Card title="Skill">
      <Typography.Paragraph type="secondary">超管可查看各租户的 Skill（含草稿、审核中、已下架），并对违规内容下架或删除；上传与审核由各租户自行进行。</Typography.Paragraph>
      <Select
        data-testid="admin-tenant-select"
        showSearch
        optionFilterProp="label"
        placeholder="选择租户"
        style={{ width: 280, marginBottom: 16 }}
        loading={!tenants}
        value={tenantId}
        onChange={setTenantId}
        options={tenants?.map((t) => ({ value: t.id, label: t.name }))}
      />
      {tenantId ? <SkillManageTable apiPath={`/admin/tenants/${tenantId}/skills`} detailPath={(id) => `/admin/skills/${id}`} /> : <Result status="info" title="请先选择租户" />}
    </Card>
  );
}

/** 超管的 Skill 详情（只读）：版本（下载、查看文件）、进行中的版本、审核记录；可下架 / 上架、删除 */
export function AdminSkillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [skill, setSkill] = useState<SkillDetail>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    api<SkillDetail>(`/admin/skills/${id}`).then(
      (s) => {
        setSkill(s);
        setError(undefined);
      },
      (err: Error) => setError(err.message),
    );
  }, [id]);
  useEffect(reload, [reload]);
  const adminDownload = (versionId: string) => `/api/admin/skills/${id}/versions/${versionId}/download`;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        loading={!skill && !error}
        title={
          <Space>
            <Link to="/admin/skills">Skill</Link>
            <span>/</span>
            <span>{skill?.name}</span>
          </Space>
        }
        extra={
          skill && (
            <Space>
              <SkillGovernanceActions skill={skill} basePath="/admin/skills" canUnlist canDelete onChanged={reload} onDeleted={() => navigate('/admin/skills')} />
            </Space>
          )
        }
      >
        {error && <Alert type="error" showIcon message={error} />}
        {skill?.unlisted && (
          <div style={{ marginBottom: 16 }}>
            <UnlistedAlert />
          </div>
        )}
        {skill && (
          <Descriptions bordered column={1} data-testid="admin-skill-detail">
            <Descriptions.Item label="名称">{skill.name}</Descriptions.Item>
            <Descriptions.Item label="描述">{(skill.currentVersion ?? skill.workingVersion)?.description}</Descriptions.Item>
            <Descriptions.Item label="当前版本">{skill.currentVersion ? <Tag color="blue">{skill.currentVersion.version}</Tag> : '暂无正式版本'}</Descriptions.Item>
            <Descriptions.Item label="所有者">{skill.ownerName}</Descriptions.Item>
            <Descriptions.Item label="分类">
              <CategoryText category={skill.category} />
            </Descriptions.Item>
            <Descriptions.Item label="可见性">
              <VisibilityText info={skill.visibility} />
            </Descriptions.Item>
            {skill.workingVersion && (
              <Descriptions.Item label="进行中的版本">
                <Space>
                  <span>{skill.workingVersion.version}</span>
                  <StatusTag status={skill.workingVersion.status} rejected={!!skill.workingVersion.rejectComment} />
                  <Link to={skillReviewPath(skill.workingVersion.id)}>查看文件</Link>
                  <a href={adminDownload(skill.workingVersion.id)} download>
                    下载
                  </a>
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Card>
      {skill && (
        <Card title="版本历史" data-testid="admin-version-history">
          <Table
            rowKey="id"
            dataSource={skill.versions}
            pagination={false}
            locale={{ emptyText: '暂无正式版本' }}
            columns={[
              { title: '版本号', dataIndex: 'version', width: 110, render: (v: string) => <Tag>{v}</Tag> },
              { title: '描述', dataIndex: 'description', ellipsis: true },
              { title: '上传人', dataIndex: 'uploaderName', width: 100 },
              { title: '上传时间', dataIndex: 'uploadedAt', width: 170, render: formatTime },
              { title: '文件', key: 'files', width: 110, render: (_, v) => `${v.fileCount} 个，${formatBytes(v.sizeBytes)}` },
              { title: '下载次数', dataIndex: 'downloadCount', width: 90 },
              {
                title: '操作',
                key: 'actions', fixed: 'right',
                width: 140,
                render: (_, v) => (
                  <Space>
                    <Link to={skillReviewPath(v.id)}>查看文件</Link>
                    <a href={adminDownload(v.id)} download>
                      下载
                    </a>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}
      {skill && (
        <Card title="审核记录">
          <ReviewRecordsTable records={skill.reviewRecords} />
        </Card>
      )}
    </Space>
  );
}
