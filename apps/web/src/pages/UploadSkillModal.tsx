import { FileZipOutlined, FolderOpenOutlined, InboxOutlined } from '@ant-design/icons';
import {
  nextPatchVersion,
  SKILL_ENTRY_FILE,
  SKILL_IGNORED_NAMES,
  SKILL_MAX_FILES,
  SKILL_MAX_MB,
  SKILL_VERSION_FORMAT_MESSAGE,
  SKILL_VERSION_PATTERN,
  type SkillDetail,
  type SkillNameConflictBody,
  type SkillReviewStep,
  type SkillUploadMode,
  type SkillWorkingVersion,
} from '@skill-hub/shared';
import { Alert, App, Button, Descriptions, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { useCurrentEmployee } from '../session';
import { useSkillBadges } from '../skillBadges';
import { formatBytes, type PackedSkill, packSkillDrop, packSkillFolder, packSkillZip } from '../skillSource';
import { categoryOptions, useSkillCategories } from './SkillCategories';
import { showReviewLink } from './SkillParts';
import { toVisibilityInput, VisibilityFields, type VisibilityFormValues } from './SkillVisibility';

/** 上传框的用途：新建 Skill、为已有 Skill 上传新版本、重新上传草稿（被驳回后修改，版本号不变） */
export type UploadTarget =
  | { kind: 'new' }
  | { kind: 'version'; skill: SkillDetail }
  | { kind: 'replace'; skill: SkillDetail; version: SkillWorkingVersion };

const MODE_LABELS: Record<SkillUploadMode, { upload: string; replace: string }> = {
  draft: { upload: '存草稿', replace: '保存草稿' },
  publish: { upload: '直接发布', replace: '保存并直接发布' },
  submit: { upload: '提交审核', replace: '保存并提交审核' },
};

/**
 * 上传 Skill。来源三选一：选择文件夹、选择 .zip、把文件夹或 .zip 拖进虚线框；预读 SKILL.md 后填版本号。
 * 去向由身份决定（spec 002）：租户管理员可「存草稿」或「直接发布」，其他员工可「存草稿」或「提交审核」。
 */
export function UploadSkillModal({
  target,
  onCancel,
  onUploaded,
  onOpenExisting,
}: {
  target: UploadTarget;
  onCancel: () => void;
  onUploaded: (skill: SkillDetail) => void;
  /** 新建时名称已存在：跳到已有 Skill 的详情页上传新版本 */
  onOpenExisting?: (skillId: string) => void;
}) {
  const { message, modal } = App.useApp();
  const { refresh: refreshBadges } = useSkillBadges();
  const me = useCurrentEmployee();
  const isTenantAdmin = me?.isTenantAdmin ?? false;
  const modes: SkillUploadMode[] = isTenantAdmin ? ['draft', 'publish'] : ['draft', 'submit'];
  const skill = target.kind === 'new' ? undefined : target.skill;
  const [form] = Form.useForm<{ version: string; categoryId?: string } & VisibilityFormValues>();
  const { categories } = useSkillCategories();
  const [picked, setPicked] = useState<PackedSkill>();
  const [error, setError] = useState<string>();
  const [existing, setExisting] = useState<SkillNameConflictBody>();
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState<SkillUploadMode>();

  async function onPick(pack: () => Promise<PackedSkill | { error: string }>) {
    setReading(true);
    setError(undefined);
    setExisting(undefined);
    setPicked(undefined);
    const result = await pack();
    if ('error' in result) setError(result.error);
    else if (skill && result.name !== skill.name) setError(`所选 Skill 的 name「${result.name}」与当前 Skill「${skill.name}」不一致`);
    else setPicked(result);
    setReading(false);
  }

  async function upload(mode: SkillUploadMode) {
    if (!picked) return;
    const values = target.kind === 'replace' ? null : await form.validateFields().catch(() => null);
    const version = target.kind === 'replace' ? target.version.version : values?.version;
    if (!version) return;
    setSubmitting(mode);
    setError(undefined);
    setExisting(undefined);
    const body = new FormData();
    body.append('file', picked.zip, `${picked.name}.zip`);
    try {
      let saved: SkillDetail;
      if (target.kind === 'replace') {
        saved = await api<SkillDetail>(`/skills/${target.skill.id}/versions/${target.version.id}/package`, { method: 'PUT', body });
        if (mode !== 'draft') {
          const step: SkillReviewStep = mode === 'submit' ? 'submit' : 'publish';
          await api(`/skills/${target.skill.id}/versions/${target.version.id}/${step}`, { method: 'POST' });
          saved = await api<SkillDetail>(`/skills/${target.skill.id}`);
        }
      } else {
        body.append('version', version);
        body.append('mode', mode);
        if (target.kind === 'new' && values) {
          const visibility = toVisibilityInput(values);
          body.append('visibility', visibility.visibility);
          for (const id of visibility.departmentIds ?? []) body.append('departmentIds', id);
          for (const id of visibility.employeeIds ?? []) body.append('employeeIds', id);
          if (values.categoryId) body.append('categoryId', values.categoryId);
        }
        saved = await api<SkillDetail>(skill ? `/skills/${skill.id}/versions` : '/skills', { method: 'POST', body });
      }
      message.success(
        mode === 'publish'
          ? `已上传「${saved.name}」${version}，已成为正式版本`
          : mode === 'submit'
            ? `已提交「${saved.name}」${version}，等待租户管理员审核`
            : `已保存「${saved.name}」${version} 为草稿`,
      );
      // 提交审核会改变待审核数，重新提交会消除「被驳回」红点
      refreshBadges();
      onUploaded(saved);
      if (mode === 'submit' && saved.workingVersion) showReviewLink(modal, saved.workingVersion.id);
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409 ? (err.body as Partial<SkillNameConflictBody>) : undefined;
      // 看不到已有 Skill 时服务端不返回 skillId，只提示换名称
      if (conflict?.skillId) setExisting(conflict as SkillNameConflictBody);
      else setError((err as Error).message);
      setSubmitting(undefined);
    }
  }

  const title = target.kind === 'new' ? '上传 Skill' : target.kind === 'version' ? `上传新版本 · ${target.skill.name}` : `重新上传草稿 · ${target.skill.name} ${target.version.version}`;
  const hint =
    target.kind === 'replace'
      ? `重新上传会替换草稿 ${target.version.version} 的文件，版本号不变。`
      : isTenantAdmin
        ? '租户管理员上传的版本可直接发布（无需审核），也可以先存草稿。'
        : '上传后需租户管理员审核通过才会成为正式版本；也可以先存草稿，稍后再提交审核。';

  return (
    <Modal
      open
      title={title}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        ...modes.map((mode) => (
          <Button key={mode} type={mode === 'draft' ? 'default' : 'primary'} disabled={!picked || (!!submitting && submitting !== mode)} loading={submitting === mode} onClick={() => void upload(mode)}>
            {MODE_LABELS[mode][target.kind === 'replace' ? 'replace' : 'upload']}
          </Button>
        )),
      ]}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={hint} />
      <div
        data-testid="skill-drop-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onPick(() => packSkillDrop(e.dataTransfer));
        }}
        style={{
          border: `1px dashed ${dragging ? '#1677ff' : '#d9d9d9'}`,
          background: dragging ? '#e6f4ff' : '#fafafa',
          borderRadius: 8,
          padding: '16px 12px',
          textAlign: 'center',
          marginBottom: 12,
        }}
      >
        <InboxOutlined style={{ fontSize: 32, color: '#1677ff' }} />
        <div style={{ margin: '4px 0 12px' }}>把 Skill 文件夹或 .zip 拖到这里，或</div>
        <Space>
          <Button icon={<FolderOpenOutlined />} loading={reading} onClick={() => document.getElementById('skill-folder-input')?.click()}>
            选择文件夹
          </Button>
          <Button icon={<FileZipOutlined />} loading={reading} onClick={() => document.getElementById('skill-zip-input')?.click()}>
            选择 .zip
          </Button>
        </Space>
      </div>
      <input
        id="skill-folder-input"
        data-testid="skill-folder-input"
        type="file"
        hidden
        multiple
        ref={(el) => el?.setAttribute('webkitdirectory', '')}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void onPick(() => packSkillFolder(files));
        }}
      />
      <input
        id="skill-zip-input"
        data-testid="skill-zip-input"
        type="file"
        hidden
        accept=".zip,application/zip"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onPick(() => packSkillZip(file));
        }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {SKILL_ENTRY_FILE} 须在文件夹根目录（.zip 可在根目录或唯一的顶层文件夹中）；{SKILL_IGNORED_NAMES.join('、')} 会被自动忽略；最多 {SKILL_MAX_FILES} 个文件、
        {SKILL_MAX_MB}MB。
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {existing && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={existing.message}
          action={
            onOpenExisting &&
            existing.skillId && (
              <Button size="small" type="link" onClick={() => onOpenExisting(existing.skillId!)}>
                前往上传新版本
              </Button>
            )
          }
        />
      )}
      {picked && (
        <Descriptions bordered size="small" column={1} labelStyle={{ width: 72, whiteSpace: 'nowrap' }} style={{ marginBottom: 16 }} data-testid="picked-skill">
          <Descriptions.Item label="名称">{picked.name}</Descriptions.Item>
          <Descriptions.Item label="描述">{picked.description}</Descriptions.Item>
          <Descriptions.Item label="文件">
            {picked.fileCount} 个，{formatBytes(picked.sizeBytes)}
          </Descriptions.Item>
        </Descriptions>
      )}
      {target.kind !== 'replace' && (
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ version: skill ? nextPatchVersion(skill.highestVersion) : '1.0.0', visibility: 'tenant' }}>
          <Form.Item
            label="版本号"
            name="version"
            extra={skill && `已有的最高版本 ${skill.highestVersion}，新版本号必须更大`}
            rules={[
              { required: true, whitespace: true, message: '请填写版本号' },
              { pattern: SKILL_VERSION_PATTERN, message: SKILL_VERSION_FORMAT_MESSAGE },
            ]}
          >
            <Input placeholder="x.y.z，如 1.0.0" style={{ width: 200 }} />
          </Form.Item>
          {/* 分类与可见性都设在 Skill 上：只在新建时设置，之后在详情页修改 */}
          {target.kind === 'new' && (
            <Form.Item label="分类" name="categoryId" extra={categories && !categories.length ? '本租户还没有分类，可不选；租户管理员可在 Skill 页的「分类」中添加' : '可不选'}>
              <Select allowClear showSearch optionFilterProp="label" data-testid="upload-category-select" placeholder="未分类" style={{ width: 240 }} loading={!categories} options={categoryOptions(categories)} />
            </Form.Item>
          )}
          {target.kind === 'new' && me && <VisibilityFields form={form} ownerEmployeeId={me.id} />}
        </Form>
      )}
    </Modal>
  );
}
