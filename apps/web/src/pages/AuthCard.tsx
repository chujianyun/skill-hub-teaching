import { Card, Layout, Typography } from 'antd';
import type { ReactNode } from 'react';

/** 登录页面的居中卡片布局。 */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Layout style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          {title}
        </Typography.Title>
        {children}
      </Card>
    </Layout>
  );
}
