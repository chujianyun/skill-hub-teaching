import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  SKILL_CATEGORIES_MAX,
  SKILL_CATEGORY_NAME_MAX_LENGTH,
  SKILL_CATEGORY_PRESETS,
  SKILL_UNCATEGORIZED,
  type SkillCategory,
  type SkillCategoryItem,
  type SkillDetail,
} from '@skill-hub/shared';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/** Skill 分类（#20）：分类数据、租户管理员的分类管理、目录的分类筛选、修改分类弹窗。 */

/** 本租户的分类；租户管理员拿到的每项带 Skill 数。reload 后返回最新列表。 */
export function useSkillCategories() {
  const [categories, setCategories] = useState<SkillCategoryItem[]>();
  const reload = useCallback(() => api<SkillCategoryItem[]>('/skills/categories').then(setCategories, () => setCategories([])), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { categories, setCategories, reload };
}

/** 分类名；未分类时显示灰色占位 */
export function CategoryText({ category }: { category: SkillCategory | null }) {
  return category ? <Tag color="geekblue">{category.name}</Tag> : <Typography.Text type="secondary">未分类</Typography.Text>;
}

/** 下拉选项；withUncategorized 时首项为「未分类」（管理视图筛选用） */
export const categoryOptions = (categories: SkillCategory[] | undefined, withUncategorized = false) => [
  ...(withUncategorized ? [{ value: SKILL_UNCATEGORIZED, label: '未分类' }] : []),
  ...(categories ?? []).map((c) => ({ value: c.id, label: c.name })),
];

/** 目录顶部的分类筛选条：全部 + 各分类；没有分类时不显示 */
export function CategoryFilterBar({ categories, value, onChange }: { categories?: SkillCategory[]; value?: string; onChange: (categoryId: string | undefined) => void }) {
  if (!categories?.length) return null;
  return (
    <Space wrap size={[4, 8]} style={{ marginBottom: 12 }} data-testid="category-filter">
      <Typography.Text type="secondary">分类：</Typography.Text>
      <Tag.CheckableTag checked={!value} onChange={() => onChange(undefined)}>
        全部
      </Tag.CheckableTag>
      {categories.map((c) => (
        <Tag.CheckableTag key={c.id} checked={value === c.id} onChange={() => onChange(value === c.id ? undefined : c.id)}>
          {c.name}
        </Tag.CheckableTag>
      ))}
    </Space>
  );
}

/** 租户管理员的分类管理：新增、改名、删除（使用中的 Skill 变为未分类）、一键添加常用分类 */
export function SkillCategoryManager({ categories, onChange }: { categories?: SkillCategoryItem[]; onChange: (list: SkillCategoryItem[]) => void }) {
  const { message } = App.useApp();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<SkillCategoryItem>();
  const missingPresets = SKILL_CATEGORY_PRESETS.filter((name) => !categories?.some((c) => c.name === name));

  // onConfirm 不返回 Promise，避免失败后「确定」停在加载态
  async function run(request: Promise<SkillCategoryItem[] | unknown>, done: string, reloadAfter = false) {
    try {
      const result = await request;
      message.success(done);
      onChange(reloadAfter ? await api<SkillCategoryItem[]>('/skills/categories') : (result as SkillCategoryItem[]));
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)} disabled={(categories?.length ?? 0) >= SKILL_CATEGORIES_MAX}>
          新增分类
        </Button>
        <Popconfirm
          title="一键添加常用分类"
          description={`将添加：${missingPresets.join('、')}`}
          disabled={!missingPresets.length}
          onConfirm={() => void run(api('/skills/categories/presets', { method: 'POST' }), `已添加 ${missingPresets.length} 个常用分类`)}
        >
          <Button icon={<ThunderboltOutlined />} disabled={!missingPresets.length}>
            一键添加常用分类
          </Button>
        </Popconfirm>
        <Typography.Text type="secondary">员工上传 Skill 时可选一个分类（也可不选）；所有者和管理员可随时在详情页修改。</Typography.Text>
      </Space>
      <Table<SkillCategoryItem>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={!categories}
        dataSource={categories}
        pagination={false}
        data-testid="category-table"
        locale={{ emptyText: '还没有分类，点击「新增分类」或「一键添加常用分类」' }}
        columns={[
          { title: '分类名称', dataIndex: 'name' },
          { title: 'Skill 数', dataIndex: 'skillCount', width: 120 },
          {
            title: '操作',
            key: 'actions', fixed: 'right',
            width: 140,
            render: (_, c) => (
              <Space>
                <a onClick={() => setRenaming(c)}>改名</a>
                <Popconfirm
                  title={`删除分类「${c.name}」？`}
                  description={c.skillCount ? `有 ${c.skillCount} 个 Skill 使用该分类，删除后将变为未分类` : '没有 Skill 使用该分类'}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void run(api(`/skills/categories/${c.id}`, { method: 'DELETE' }), `已删除分类「${c.name}」`, true)}
                >
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {(adding || renaming) && (
        <CategoryNameModal
          category={renaming}
          onCancel={() => {
            setAdding(false);
            setRenaming(undefined);
          }}
          onSaved={(list, name) => {
            message.success(renaming ? `已改名为「${name}」` : `已新增分类「${name}」`);
            setAdding(false);
            setRenaming(undefined);
            onChange(list);
          }}
        />
      )}
    </>
  );
}

function CategoryNameModal({ category, onCancel, onSaved }: { category?: SkillCategoryItem; onCancel: () => void; onSaved: (list: SkillCategoryItem[], name: string) => void }) {
  const [form] = Form.useForm<{ name: string }>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save({ name }: { name: string }) {
    setSaving(true);
    setError(undefined);
    try {
      const body = { name: name.trim() };
      const list = await api<SkillCategoryItem[]>(category ? `/skills/categories/${category.id}` : '/skills/categories', { method: category ? 'PATCH' : 'POST', body });
      onSaved(list, body.name);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal open title={category ? `分类改名 · ${category.name}` : '新增分类'} onCancel={onCancel} onOk={() => form.submit()} okText="保存" confirmLoading={saving} destroyOnHidden>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ name: category?.name }} onFinish={save}>
        <Form.Item
          label="分类名称"
          name="name"
          rules={[
            { required: true, whitespace: true, message: '请填写分类名称' },
            { max: SKILL_CATEGORY_NAME_MAX_LENGTH, message: `分类名称不能超过 ${SKILL_CATEGORY_NAME_MAX_LENGTH} 个字` },
          ]}
        >
          <Input placeholder="如 研发、办公、电商" maxLength={SKILL_CATEGORY_NAME_MAX_LENGTH} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 修改 Skill 的分类（所有者、租户管理员）：可清空为未分类；立即生效，不需要审核 */
export function SkillCategoryModal({ skill, onCancel, onSaved }: { skill: SkillDetail; onCancel: () => void; onSaved: (skill: SkillDetail) => void }) {
  const { message } = App.useApp();
  const { categories } = useSkillCategories();
  const [value, setValue] = useState<string | undefined>(skill.category?.id);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api<SkillDetail>(`/skills/${skill.id}/category`, { method: 'PATCH', body: { categoryId: value ?? null } });
      message.success(updated.category ? `分类已改为「${updated.category.name}」` : '已设为未分类');
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal open title={`修改分类 · ${skill.name}`} onCancel={onCancel} onOk={() => void save()} okText="保存" confirmLoading={saving}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Typography.Paragraph type="secondary">分类只用于归档和筛选，不影响可见性；修改立即生效，不需要审核。</Typography.Paragraph>
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        data-testid="skill-category-select"
        placeholder={categories?.length ? '未分类' : '本租户还没有分类，请联系租户管理员添加'}
        style={{ width: '100%' }}
        loading={!categories}
        value={value}
        onChange={setValue}
        options={categoryOptions(categories)}
      />
    </Modal>
  );
}
