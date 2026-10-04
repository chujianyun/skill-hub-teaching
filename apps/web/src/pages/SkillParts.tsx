import {
  SKILL_REVIEW_ACTION_LABELS,
  SKILL_VERSION_STATUS_LABELS,
  type SkillReviewAction,
  type SkillReviewRecordInfo,
  type SkillVersionStatus,
  skillReviewPath,
} from '@skill-hub/shared';
import { Table, type TableProps, Tag, Typography } from 'antd';
import type { HookAPI } from 'antd/es/modal/useModal';
import Markdown from 'react-markdown';

export const formatTime = (iso: string) => new Date(iso).toLocaleString('zh-CN');
export const downloadUrl = (skillId: string, versionId: string) => `/api/skills/${skillId}/versions/${versionId}/download`;

const STATUS_COLORS: Record<SkillVersionStatus, string> = { draft: 'default', pending: 'processing', published: 'success' };

export function StatusTag({ status, rejected }: { status: SkillVersionStatus; rejected?: boolean }) {
  // 驳回是动作而非状态（GLOSSARY）：被驳回退回的仍是草稿，标红提示审核未通过
  if (status === 'draft' && rejected) return <Tag color="error">草稿 · 审核未通过</Tag>;
  return <Tag color={STATUS_COLORS[status]}>{SKILL_VERSION_STATUS_LABELS[status]}</Tag>;
}

/** 针对整个 Skill（而非某个版本）的动作，版本列显示「—」 */
const SKILL_LEVEL_ACTIONS: SkillReviewAction[] = ['change_visibility', 'change_category', 'unlist', 'relist'];

const ACTION_COLORS: Record<SkillReviewAction, string> = {
  publish_direct: 'success',
  submit: 'processing',
  withdraw: 'default',
  approve: 'success',
  reject: 'error',
  reupload: 'default',
  change_visibility: 'purple',
  change_category: 'geekblue',
  unlist: 'warning',
  relist: 'cyan',
};

/** 审核记录表：时间、Skill（可选）、版本、动作、操作人、意见 */
export function ReviewRecordsTable({
  records,
  showSkill = false,
  pagination = false,
  loading,
}: {
  records?: SkillReviewRecordInfo[];
  showSkill?: boolean;
  pagination?: TableProps<SkillReviewRecordInfo>['pagination'];
  loading?: boolean;
}) {
  return (
    <Table<SkillReviewRecordInfo>
        scroll={{ x: 'max-content' }}
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={records}
      pagination={pagination}
      locale={{ emptyText: '暂无审核记录' }}
      columns={[
        { title: '时间', dataIndex: 'createdAt', width: 170, render: formatTime },
        ...(showSkill ? [{ title: 'Skill', dataIndex: 'skillName', width: 160 }] : []),
        {
          title: '版本',
          dataIndex: 'version',
          width: 90,
          // 修改可见性是 Skill 级别的动作，不针对版本；其他动作没有版本说明该版本已被删除
          render: (v: string | null, r) => v ?? <Typography.Text type="secondary">{SKILL_LEVEL_ACTIONS.includes(r.action) ? '—' : '已删除'}</Typography.Text>,
        },
        { title: '动作', dataIndex: 'action', width: 100, render: (a: SkillReviewAction) => <Tag color={ACTION_COLORS[a]}>{SKILL_REVIEW_ACTION_LABELS[a]}</Tag> },
        { title: '操作人', dataIndex: 'actorName', width: 110 },
        { title: '意见', dataIndex: 'comment', render: (c: string) => c || <Typography.Text type="secondary">—</Typography.Text> },
      ]}
    />
  );
}

/**
 * 渲染 SKILL.md（去掉 frontmatter）。react-markdown 不渲染原始 HTML（<script> 等原样丢弃），并过滤 javascript: 等危险链接，
 * 不使用 dangerouslySetInnerHTML，注入的脚本不会执行。
 */
export function SkillMarkdown({ source }: { source: string }) {
  const body = source.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return (
    <div className="skill-markdown" data-testid="skill-markdown" style={{ lineHeight: 1.7 }}>
      <Markdown>{body}</Markdown>
    </div>
  );
}

/** 审核链接的完整地址（发给租户管理员）；链接本身不带任何权限，打开后仍须登录 */
export const reviewLinkUrl = (versionId: string) => `${window.location.origin}${skillReviewPath(versionId)}`;

/** 显示审核链接并可复制（提交审核后的弹窗、进行中的版本卡片） */
export function ReviewLinkText({ versionId }: { versionId: string }) {
  const url = reviewLinkUrl(versionId);
  return (
    <Typography.Text data-testid="review-link" copyable={{ text: url, tooltips: ['复制链接', '已复制'] }} code>
      {url}
    </Typography.Text>
  );
}

/** 只有「复制审核链接」按钮（列表里用） */
export function CopyReviewLink({ versionId }: { versionId: string }) {
  return (
    <Typography.Text data-testid="copy-review-link" copyable={{ text: reviewLinkUrl(versionId), tooltips: ['复制审核链接', '已复制'] }}>
      审核链接
    </Typography.Text>
  );
}

/** 提交审核成功后弹出审核链接，提示发给租户管理员 */
export function showReviewLink(modal: HookAPI, versionId: string) {
  modal.success({
    title: '已提交审核',
    width: 560,
    okText: '知道了',
    content: (
      <div data-testid="review-link-dialog">
        <Typography.Paragraph>把下面的审核链接发给租户管理员，对方打开后即可审核（需登录）。撤回后再次提交，链接不变。</Typography.Paragraph>
        <ReviewLinkText versionId={versionId} />
      </div>
    ),
  });
}
