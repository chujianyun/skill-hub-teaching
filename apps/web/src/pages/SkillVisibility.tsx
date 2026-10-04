import {
  describeSkillVisibility,
  SKILL_VISIBILITY_LABELS,
  type SkillDetail,
  type SkillVisibility,
  type SkillVisibilityInfo,
  type SkillVisibilityInput,
  type SkillVisibilityOptions,
} from '@skill-hub/shared';
import { Alert, App, Form, type FormInstance, Modal, Radio, Select, Space, TreeSelect, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/** 可见性的显示与设置：四种方式只能选一种；特定部门包含下级部门；特定员工默认包含自己（所有者）。 */

const VISIBILITY_HINTS: Record<SkillVisibility, string> = {
  tenant: '本租户所有员工',
  departments: '所选部门及其下级部门的员工',
  employees: '名单中的员工（所有者始终在内）',
  private: '只有所有者自己',
};

/** 可见性的文字说明（与审核记录同一格式），如「特定部门可见：研发部、运营部（含下级部门）」 */
export function VisibilityText({ info }: { info: SkillVisibilityInfo }) {
  return <span>{describeSkillVisibility(info)}</span>;
}

/** 所选部门都已被删除：除所有者与租户管理员外没有人能看到 */
export const hasNoVisibleDepartments = (info: SkillVisibilityInfo) => info.visibility === 'departments' && info.departments.length === 0;

export function NoVisibleDepartmentsAlert() {
  return <Alert type="warning" showIcon data-testid="no-visible-departments" message="当前没有可见范围" description="所选的部门都已被删除，除所有者与租户管理员外没有人能看到这个 Skill，请修改可见性。" />;
}

export interface VisibilityFormValues {
  visibility: SkillVisibility;
  departmentIds?: string[];
  employeeIds?: string[];
}

export const toVisibilityInput = (v: VisibilityFormValues): SkillVisibilityInput => ({
  visibility: v.visibility,
  departmentIds: v.visibility === 'departments' ? v.departmentIds : undefined,
  employeeIds: v.visibility === 'employees' ? v.employeeIds : undefined,
});

export const visibilityFormValues = (info?: SkillVisibilityInfo): VisibilityFormValues => ({
  visibility: info?.visibility ?? 'tenant',
  departmentIds: info?.departments.map((d) => d.id) ?? [],
  employeeIds: info?.employees.map((e) => e.id) ?? [],
});

/**
 * 可见性表单项（放在 antd Form 内）。ownerEmployeeId 为所有者：特定员工名单默认包含且不可移除（服务端也会补上）。
 * current 为当前已设置的可见性：名单里已停用（不在选项中）的员工仍按姓名显示。
 */
export function VisibilityFields({ form, ownerEmployeeId, current }: { form: FormInstance; ownerEmployeeId: string; current?: SkillVisibilityInfo }) {
  const [options, setOptions] = useState<SkillVisibilityOptions>();
  const [error, setError] = useState<string>();
  const visibility = Form.useWatch('visibility', form) as SkillVisibility | undefined;

  useEffect(() => {
    api<SkillVisibilityOptions>('/skills/visibility-options').then(setOptions, (err: Error) => setError(err.message));
  }, []);

  // 特定员工可见：默认包含所有者自己
  useEffect(() => {
    if (visibility !== 'employees') return;
    const current: string[] = form.getFieldValue('employeeIds') ?? [];
    if (!current.includes(ownerEmployeeId)) form.setFieldValue('employeeIds', [ownerEmployeeId, ...current]);
  }, [visibility, form, ownerEmployeeId]);

  const treeData = useMemo(() => {
    type Node = { title: string; value: string; children: Node[] };
    const nodes = new Map((options?.departments ?? []).map((d) => [d.id, { title: d.name, value: d.id, children: [] as Node[] }]));
    const roots: Node[] = [];
    for (const d of options?.departments ?? []) (d.parentId && nodes.get(d.parentId) ? nodes.get(d.parentId)!.children : roots).push(nodes.get(d.id)!);
    return roots;
  }, [options]);

  return (
    <>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Form.Item label="可见性" name="visibility" extra={visibility && `谁能看到并下载正式版本：${VISIBILITY_HINTS[visibility]}；所有者与租户管理员始终可见`}>
        <Radio.Group data-testid="visibility-radio">
          {(Object.keys(SKILL_VISIBILITY_LABELS) as SkillVisibility[]).map((v) => (
            <Radio.Button key={v} value={v}>
              {SKILL_VISIBILITY_LABELS[v]}
            </Radio.Button>
          ))}
        </Radio.Group>
      </Form.Item>
      {visibility === 'departments' && (
        <Form.Item label="可见的部门" name="departmentIds" rules={[{ required: true, type: 'array', min: 1, message: '请选择可见的部门' }]} extra="包含所选部门的下级部门">
          <TreeSelect placement="topLeft" showSearch treeNodeFilterProp="title" data-testid="visibility-departments" multiple treeDefaultExpandAll treeData={treeData} loading={!options && !error} placeholder="选择部门（可多选）" allowClear />
        </Form.Item>
      )}
      {visibility === 'employees' && (
        <Form.Item label="可见的员工" name="employeeIds">
          <Select
            data-testid="visibility-employees"
            placement="topLeft"
            mode="multiple"
            loading={!options && !error}
            placeholder="选择员工（可多选）"
            optionFilterProp="label"
            options={[
              ...(options?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name}（${e.departmentName}）`, disabled: e.id === ownerEmployeeId })),
              ...(current?.employees ?? [])
                .filter((e) => options && !options.employees.some((o) => o.id === e.id))
                .map((e) => ({ value: e.id, label: `${e.name}（已停用）`, disabled: e.id === ownerEmployeeId })),
            ]}
          />
        </Form.Item>
      )}
    </>
  );
}

/** 修改可见性（所有者、租户管理员）：不需要审核，立即生效 */
export function VisibilityModal({ skill, onCancel, onSaved }: { skill: SkillDetail; onCancel: () => void; onSaved: (skill: SkillDetail) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<VisibilityFormValues>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function onFinish(values: VisibilityFormValues) {
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api<SkillDetail>(`/skills/${skill.id}/visibility`, { method: 'PATCH', body: toVisibilityInput(values) });
      message.success(`可见性已改为「${SKILL_VISIBILITY_LABELS[saved.visibility.visibility]}」，立即生效`);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal open title={`修改可见性 · ${skill.name}`} onCancel={onCancel} onOk={() => form.submit()} okText="保存" confirmLoading={saving} width={600}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">修改可见性不需要审核，保存后立即生效，并记入审核记录。</Typography.Text>
        {error && <Alert type="error" showIcon message={error} />}
        <Form form={form} layout="vertical" requiredMark={false} initialValues={visibilityFormValues(skill.visibility)} onFinish={onFinish}>
          <VisibilityFields form={form} ownerEmployeeId={skill.ownerEmployeeId} current={skill.visibility} />
        </Form>
      </Space>
    </Modal>
  );
}
