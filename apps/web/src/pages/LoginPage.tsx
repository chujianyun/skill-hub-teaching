import type { LoginRequest } from '@skill-hub/shared';
import { Alert, Button, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, safeNext } from '../api';
import { AuthCard } from './AuthCard';
const accounts = [
  { role: '超管', phone: 'root', password: 'admin' },
  { role: '租户管理员', phone: '15168466666', password: 'test' },
  { role: '普通用户', phone: '15168488888', password: 'test' },
];
export function LoginPage() {
  const navigate = useNavigate();
  const next = safeNext(useSearchParams()[0].get('next'));
  const [form] = Form.useForm<LoginRequest>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  async function onFinish(values: LoginRequest) {
    setSubmitting(true); setError(undefined);
    try {
      await api('/auth/login', { method: 'POST', body: values });
      navigate(next ?? '/', { replace: true });
    } catch (err) { setError((err as Error).message); }
    finally { setSubmitting(false); }
  }
  return <AuthCard title="Skill Hub 演示">
    <Typography.Paragraph type="secondary">选择演示账号，体验上传、审核与分发。</Typography.Paragraph>
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 24 }}>
      {accounts.map((account) => <Button key={account.phone} block style={{ height: 'auto', padding: '10px 12px', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => { form.setFieldsValue({ phone: account.phone, password: account.password }); setError(undefined); }}>
        <span><strong>{account.role}</strong><br />{account.phone} / {account.password}</span>
      </Button>)}
    </Space>
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
      <Form.Item label="用户名" name="phone" rules={[{ required: true, message: '请输入用户名' }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={submitting}>登录</Button>
    </Form>
  </AuthCard>;
}
