import { LogoutOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Layout, Menu, Space } from 'antd';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { logout } from '../api';
import { useCurrentUser } from '../session';

export interface ConsoleMenuItem {
  path: string;
  icon: ReactNode;
  label: string;
  /** 菜单红点数，0 或缺省时不显示 */
  badge?: number;
}

/** 控制台外壳（超管 / 租户管理员 / 员工共用）：侧栏导航 + 顶栏（当前用户、退出）。 */
export function ConsoleLayout({ brand, menu, headerExtra }: { brand: ReactNode; menu: ConsoleMenuItem[]; headerExtra?: ReactNode }) {
  const user = useCurrentUser();
  const [error, setError] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();


  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider breakpoint="lg" collapsedWidth={0} collapsed={collapsed} onCollapse={setCollapsed} theme="light">
        {!collapsed && <>
        <div style={{ padding: '16px 24px', fontWeight: 600, whiteSpace: 'nowrap' }}>{brand}</div>
        <Menu
          mode="inline"
          selectedKeys={menu.filter((m) => pathname.startsWith(m.path)).map((m) => m.path)}
          items={menu.map((m) => ({
            key: m.path,
            icon: m.icon,
            label: (
              <NavLink to={m.path}>
                <Space size={6}>
                  {m.label}
                  <Badge count={m.badge} size="small" data-testid={`menu-badge-${m.label}`} />
                </Space>
              </NavLink>
            ),
          }))}
        />
        </>}
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', display: 'flex', justifyContent: 'flex-end', paddingInline: 24 }}>
          <Space>
            {headerExtra}
            <span data-testid="current-user">{user.nickname}</span>
            <Button icon={<LogoutOutlined />} onClick={async () => { try { await logout(); navigate('/login', { replace: true }); } catch (err) { setError((err as Error).message); } }}>
              退出登录
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ margin: collapsed ? 12 : 24, minWidth: 0 }}>
          {error && <Alert type="error" title={error} closable onClose={() => setError(undefined)} />}
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
