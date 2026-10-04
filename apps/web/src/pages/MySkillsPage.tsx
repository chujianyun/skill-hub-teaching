import { UploadOutlined } from '@ant-design/icons';
import type { MySkill } from '@skill-hub/shared';
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useSkillBadges } from '../skillBadges';
import { CopyReviewLink, formatTime, StatusTag } from './SkillParts';
import { UploadSkillModal } from './UploadSkillModal';

/** 「我的 Skill」：我是所有者的 Skill 与各版本状态；被驳回的版本标红并显示驳回意见。处理入口在 Skill 详情页。 */
export function MySkillsPage() {
  const navigate = useNavigate();
  const { refresh } = useSkillBadges();
  const [skills, setSkills] = useState<MySkill[]>();
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(() => {
    api<MySkill[]>('/skills/mine').then(
      (list) => {
        setSkills(list);
        setError(undefined);
      },
      (err: Error) => setError(err.message),
    );
    refresh();
  }, [refresh]);

  useEffect(reload, [reload]);

  // 详情页与本页同在控制台下：../skills/<id>
  const detailPath = (id: string) => `../skills/${id}`;

  return (
    <Card
      title="我的 Skill"
      extra={
        <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploading(true)}>
          上传 Skill
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">我是所有者的 Skill。草稿和审核中的版本只有你和租户管理员能看到；在 Skill 详情页可以提交、撤回、重新上传或删除草稿。</Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table<MySkill>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={!skills && !error}
        dataSource={skills}
        pagination={false}
        locale={{ emptyText: '你还没有上传过 Skill' }}
        onRow={(s) => ({ 'data-testid': `my-skill-${s.name}` }) as React.HTMLAttributes<HTMLElement>}
        columns={[
          { title: '名称', dataIndex: 'name', render: (name: string, s) => <Link to={detailPath(s.id)} relative="path">{name}</Link> },
          {
            title: '当前正式版本',
            key: 'current',
            width: 130,
            render: (_, s) => (s.currentVersion ? <Tag color="blue">{s.currentVersion.version}</Tag> : <Typography.Text type="secondary">暂无</Typography.Text>),
          },
          {
            title: '进行中的版本',
            key: 'working',
            width: 200,
            render: (_, s) =>
              s.workingVersion ? (
                <Space size={4}>
                  <span>{s.workingVersion.version}</span>
                  <StatusTag status={s.workingVersion.status} rejected={!!s.workingVersion.rejectComment} />
                </Space>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: '驳回意见',
            key: 'comment',
            render: (_, s) => (s.workingVersion?.rejectComment ? <Typography.Text type="danger">{s.workingVersion.rejectComment}</Typography.Text> : null),
          },
          { title: '最近上传', key: 'uploadedAt', width: 170, render: (_, s) => formatTime((s.workingVersion ?? s.currentVersion)!.uploadedAt) },
          {
            title: '操作',
            key: 'actions', fixed: 'right',
            width: 180,
            render: (_, s) => (
              <Space>
                <Link to={detailPath(s.id)} relative="path">
                  {s.workingVersion ? '处理' : '查看'}
                </Link>
                {s.workingVersion?.status === 'pending' && <CopyReviewLink versionId={s.workingVersion.id} />}
              </Space>
            ),
          },
        ]}
      />
      {uploading && (
        <UploadSkillModal
          target={{ kind: 'new' }}
          onCancel={() => setUploading(false)}
          onUploaded={(skill) => {
            setUploading(false);
            navigate(detailPath(skill.id), { relative: 'path' });
          }}
          onOpenExisting={(skillId) => {
            setUploading(false);
            navigate(detailPath(skillId), { relative: 'path' });
          }}
        />
      )}
    </Card>
  );
}
