import { CheckOutlined, CloseOutlined, DownloadOutlined, HomeOutlined } from '@ant-design/icons';
import {
  type PendingSkillReview,
  SKILL_REJECT_COMMENT_MAX_LENGTH,
  SKILL_REVIEW_ACTION_LABELS,
  SKILL_VERSION_STATUS_LABELS,
  type SkillReviewRecordPage,
  type SkillReviewView,
  skillReviewPath,
} from '@skill-hub/shared';
import { Alert, App, Button, Card, Descriptions, Form, Input, Layout, Modal, Popconfirm, Result, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { useSkillBadges } from '../skillBadges';
import { formatBytes } from '../skillSource';
import { DiffPanel, diffTabLabel, FilesPanel } from './SkillFileViews';
import { formatTime, ReviewRecordsTable, SkillMarkdown, StatusTag } from './SkillParts';
import { VisibilityText } from './SkillVisibility';

/** 审核中心（租户管理员）：待审核列表 + 全租户审核记录。 */
export function SkillReviewCenterPage() {
  const { badges } = useSkillBadges();
  return (
    <Card title="审核">
      <Tabs
        items={[
          { key: 'pending', label: `待审核${badges.pendingReviews ? `（${badges.pendingReviews}）` : ''}`, children: <PendingReviews /> },
          { key: 'records', label: '审核记录', children: <AllReviewRecords /> },
        ]}
      />
    </Card>
  );
}

function PendingReviews() {
  const [items, setItems] = useState<PendingSkillReview[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<PendingSkillReview[]>('/skills/reviews').then(setItems, (err: Error) => setError(err.message));
  }, []);
  return (
    <>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table<PendingSkillReview>
        scroll={{ x: 'max-content' }}
        rowKey={(r) => r.version.id}
        loading={!items && !error}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: '没有待审核的 Skill' }}
        columns={[
          {
            title: 'Skill',
            key: 'skill',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Space size={4}>
                  <strong>{r.skillName}</strong>
                  {r.isNewSkill ? <Tag color="purple">新 Skill</Tag> : <Tag>新版本</Tag>}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.version.description}
                </Typography.Text>
              </Space>
            ),
          },
          { title: '版本', key: 'version', width: 100, render: (_, r) => r.version.version },
          { title: '上传人', key: 'uploader', width: 110, render: (_, r) => r.version.uploaderName },
          { title: '提交时间', dataIndex: 'submittedAt', width: 170, render: formatTime },
          { title: '操作', key: 'actions', fixed: 'right', width: 90, render: (_, r) => <Link to={r.version.id}>审核</Link> },
        ]}
      />
    </>
  );
}

function AllReviewRecords() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SkillReviewRecordPage>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<SkillReviewRecordPage>(`/skills/reviews/records?page=${page}&pageSize=20`).then(setData, (err: Error) => setError(err.message));
  }, [page]);
  return (
    <>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <ReviewRecordsTable
        showSkill
        loading={!data && !error}
        records={data?.items}
        pagination={{ current: page, pageSize: 20, total: data?.total, onChange: setPage, showSizeChanger: false }}
      />
    </>
  );
}

/** 读取审核链接的内容（按身份授权，见 SkillReviewLinksService） */
function useReviewView(versionId: string) {
  const [view, setView] = useState<SkillReviewView>();
  const [error, setError] = useState<ApiError | Error>();
  const reload = useCallback(() => {
    api<SkillReviewView>(`/skills/review-links/${versionId}`).then(
      (v) => {
        setView(v);
        setError(undefined);
      },
      (err: Error) => setError(err),
    );
  }, [versionId]);
  useEffect(reload, [reload]);
  return { view, error, reload };
}

/**
 * 租户控制台内的审核页（/tenant/reviews/:versionId）：可审核时显示通过 / 驳回，已处理的版本只读。
 * 版本不属于当前租户时交给审核链接页切换租户。
 */
export function SkillReviewPage() {
  const { versionId = '' } = useParams();
  const { message } = App.useApp();
  const { refresh } = useSkillBadges();
  const { view, error, reload } = useReviewView(versionId);
  const [rejecting, setRejecting] = useState(false);

  if (view?.needsTenantSwitch) return <Navigate to={skillReviewPath(versionId)} replace />;

  async function act(action: 'approve' | 'reject', body?: object) {
    await api(`/skills/${view!.skillId}/versions/${versionId}/${action}`, { method: 'POST', body });
    message.success(action === 'approve' ? `已通过，${view!.skillName} ${view!.version} 成为正式版本` : '已驳回，版本退回草稿');
    refresh();
    reload();
  }

  // onConfirm 不返回 Promise，避免失败后「确定」停在加载态
  async function approve() {
    try {
      await act('approve');
    } catch (err) {
      message.error((err as Error).message);
      reload();
    }
  }

  const actions = view?.canReview && (
    <Space>
      <Button danger icon={<CloseOutlined />} onClick={() => setRejecting(true)}>
        驳回
      </Button>
      <Popconfirm title={`通过 ${view.skillName} ${view.version}？`} description="通过后成为当前版本，本租户员工都能下载" onConfirm={() => void approve()}>
        <Button type="primary" icon={<CheckOutlined />}>
          通过
        </Button>
      </Popconfirm>
    </Space>
  );

  return (
    <>
      <ReviewContent view={view} error={error} breadcrumb={<Link to="/tenant/reviews">审核</Link>} actions={actions} />
      {rejecting && view && (
        <RejectModal
          onCancel={() => setRejecting(false)}
          onSubmit={async (comment) => {
            await act('reject', { comment });
            setRejecting(false);
          }}
          onFailed={reload}
        />
      )}
    </>
  );
}

/**
 * 审核链接（/skills/review/:versionId，员工提交后转发给租户管理员）。未登录时由 RequireSession 先登录再回到这里。
 * 租户管理员：进入控制台内的审核页；所有者、超管：只读查看；其他人：无权限。
 */
export function ReviewLinkPage() {
  const { versionId = '' } = useParams();
  const navigate = useNavigate();
  const { view, error } = useReviewView(versionId);
  const [switchError, setSwitchError] = useState<string>();

  useEffect(() => {
    if (view?.viewerRole !== 'tenant_admin') return;
    const target = `/tenant/reviews/${versionId}`;
    if (!view.needsTenantSwitch) {
      navigate(target, { replace: true });
      return;
    }
    setSwitchError('演示账号只能访问其固定团队');
  }, [view, versionId, navigate]);

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return (
      <Result
        status={error.status === 403 ? '403' : '404'}
        title={error.status === 403 ? '无权查看' : '链接无效'}
        subTitle={error.message}
        extra={<Link to="/"><Button type="primary">返回首页</Button></Link>}
      />
    );
  }
  if (switchError) return <Result status="error" title="无法进入该团队" subTitle={switchError} extra={<Link to="/"><Button>返回首页</Button></Link>} />;
  if (!view || view.viewerRole === 'tenant_admin') {
    return error ? <Result status="error" title="加载失败" subTitle={error.message} /> : <Spin fullscreen tip={view ? `正在进入「${view.tenantName}」…` : undefined} />;
  }

  const notice = view.viewerRole === 'owner' ? '你是这个 Skill 的所有者，这里只读显示审核进度。' : '超管只读查看，审核由该租户的租户管理员进行。';
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 24 }}>
        <strong>Skill 审核 · {view.tenantName}</strong>
        <Link to="/">
          <Button icon={<HomeOutlined />}>返回首页</Button>
        </Link>
      </Layout.Header>
      <Layout.Content style={{ margin: 24 }}>
        <Alert type="info" showIcon message={notice} style={{ marginBottom: 16 }} data-testid="readonly-notice" />
        <ReviewContent view={view} breadcrumb={<span>审核链接</span>} />
      </Layout.Content>
    </Layout>
  );
}

/** 审核页内容：版本信息、处理结果、SKILL.md / 文件 / 差异、审核记录 */
function ReviewContent({ view, error, breadcrumb, actions }: { view?: SkillReviewView; error?: Error; breadcrumb: ReactNode; actions?: ReactNode }) {
  const lastDecision = view?.records.find((r) => r.action === 'approve' || r.action === 'reject' || r.action === 'withdraw');
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        loading={!view && !error}
        title={
          <Space>
            {breadcrumb}
            <span>/</span>
            <span>
              {view?.skillName} {view?.version}
            </span>
          </Space>
        }
        extra={actions}
      >
        {error && <Alert type="error" showIcon message={error.message} />}
        {view && view.status !== 'pending' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            data-testid="review-handled"
            message={`该版本当前状态：${SKILL_VERSION_STATUS_LABELS[view.status]}，已不在审核中`}
            description={
              lastDecision &&
              `已由 ${lastDecision.actorName} 于 ${formatTime(lastDecision.createdAt)} ${SKILL_REVIEW_ACTION_LABELS[lastDecision.action]}${lastDecision.comment ? `（${lastDecision.comment}）` : ''}`
            }
          />
        )}
        {view && (
          <Descriptions bordered column={2} size="small" data-testid="review-version">
            <Descriptions.Item label="Skill">{view.skillName}</Descriptions.Item>
            <Descriptions.Item label="版本号">{view.version}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <StatusTag status={view.status} rejected={!!view.rejectComment} />
            </Descriptions.Item>
            <Descriptions.Item label="租户">{view.tenantName}</Descriptions.Item>
            <Descriptions.Item label="上传人">{view.uploaderName}</Descriptions.Item>
            <Descriptions.Item label="上传时间">{formatTime(view.uploadedAt)}</Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>
              {view.description}
            </Descriptions.Item>
            <Descriptions.Item label="文件" span={2}>
              {view.fileCount} 个，{formatBytes(view.sizeBytes)}
              <a href={`/api/skills/review-links/${view.id}/download`} download style={{ marginLeft: 12 }}>
                <DownloadOutlined /> 下载审阅
              </a>
            </Descriptions.Item>
            <Descriptions.Item label="可见性" span={2}>
              <VisibilityText info={view.visibility} />
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>
      {view && (
        <Card>
          <Tabs
            items={[
              { key: 'md', label: 'SKILL.md', children: <SkillMarkdown source={view.skillMd} /> },
              { key: 'files', label: `文件（${view.files.length}）`, children: <FilesPanel view={view} /> },
              { key: 'diff', label: diffTabLabel(view.diff), children: <DiffPanel diff={view.diff} /> },
            ]}
          />
        </Card>
      )}
      {view && (
        <Card title="审核记录">
          <ReviewRecordsTable records={view.records} />
        </Card>
      )}
    </Space>
  );
}

function RejectModal({ onCancel, onSubmit, onFailed }: { onCancel: () => void; onSubmit: (comment: string) => Promise<void>; onFailed: () => void }) {
  const [form] = Form.useForm<{ comment: string }>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onFinish({ comment }: { comment: string }) {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit(comment);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
      onFailed();
    }
  }

  return (
    <Modal open title="驳回" onCancel={onCancel} onOk={() => form.submit()} okText="驳回" okButtonProps={{ danger: true }} confirmLoading={submitting}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={onFinish}>
        <Form.Item
          label="驳回意见"
          name="comment"
          extra="意见会展示给上传人，版本退回草稿，修改后可再次提交"
          rules={[
            { required: true, whitespace: true, message: '请填写驳回意见' },
            { max: SKILL_REJECT_COMMENT_MAX_LENGTH, message: `驳回意见不能超过 ${SKILL_REJECT_COMMENT_MAX_LENGTH} 字` },
          ]}
        >
          <Input.TextArea rows={4} placeholder="例如：缺少使用示例，请补充后再提交" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
