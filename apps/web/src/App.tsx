import { AppstoreOutlined, AuditOutlined, FolderOutlined } from '@ant-design/icons';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Result } from 'antd';
import { ConsoleLayout, type ConsoleMenuItem } from './pages/ConsoleLayout';
import { LoginPage } from './pages/LoginPage';
import { MySkillsPage } from './pages/MySkillsPage';
import { ReviewLinkPage, SkillReviewCenterPage, SkillReviewPage } from './pages/SkillReviewPages';
import { AdminSkillDetailPage, AdminSkillsPage } from './pages/SkillManage';
import { SkillDetailPage, SkillsPage } from './pages/SkillsPage';
import { RequireSession, useCurrentEmployee, useCurrentUser } from './session';
import { SkillBadgesProvider, useSkillBadges } from './skillBadges';

function HomeRedirect() {
  const user = useCurrentUser();
  const employee = useCurrentEmployee();
  if (user.isSuperAdmin) return <Navigate to="/admin/skills" replace />;
  if (!employee || employee.status !== 'active' || employee.tenant.status !== 'active') return <Result status="403" title="暂无可用的演示团队" />;
  return <Navigate to={employee.isTenantAdmin ? '/tenant/skills' : '/workspace/skills'} replace />;
}
function SuperAdminConsole() {
  const user = useCurrentUser();
  return user.isSuperAdmin ? <ConsoleLayout brand="Skill Hub · 超管" menu={[{ path: '/admin/skills', icon: <AppstoreOutlined />, label: 'Skill' }]} /> : <Navigate to="/" replace />;
}
function TenantConsole({ admin }: { admin: boolean }) {
  const employee = useCurrentEmployee();
  if (!employee || employee.status !== 'active' || employee.tenant.status !== 'active' || (admin && !employee.isTenantAdmin)) return <Navigate to="/" replace />;
  return <SkillBadgesProvider><TenantLayout admin={admin} /></SkillBadgesProvider>;
}
function TenantLayout({ admin }: { admin: boolean }) {
  const { badges } = useSkillBadges();
  const prefix = admin ? '/tenant' : '/workspace';
  const menu: ConsoleMenuItem[] = [
    { path: `${prefix}/skills`, icon: <AppstoreOutlined />, label: 'Skill' },
    { path: `${prefix}/my-skills`, icon: <FolderOutlined />, label: '我的 Skill', badge: badges.rejectedDrafts },
  ];
  if (admin) menu.push({ path: '/tenant/reviews', icon: <AuditOutlined />, label: '审核', badge: badges.pendingReviews });
  return <ConsoleLayout brand={admin ? 'Skill Hub · 管理员' : 'Skill Hub · 工作台'} menu={menu} />;
}
export function App() {
  return <BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<RequireSession><HomeRedirect /></RequireSession>} />
    <Route path="/skills/review/:versionId" element={<RequireSession><ReviewLinkPage /></RequireSession>} />
    <Route path="/admin" element={<RequireSession><SuperAdminConsole /></RequireSession>}>
      <Route index element={<Navigate to="skills" replace />} />
      <Route path="skills" element={<AdminSkillsPage />} />
      <Route path="skills/:id" element={<AdminSkillDetailPage />} />
    </Route>
    <Route path="/tenant" element={<RequireSession><TenantConsole admin /></RequireSession>}>
      <Route index element={<Navigate to="skills" replace />} />
      <Route path="skills" element={<SkillsPage />} />
      <Route path="skills/:id" element={<SkillDetailPage />} />
      <Route path="my-skills" element={<MySkillsPage />} />
      <Route path="reviews" element={<SkillReviewCenterPage />} />
      <Route path="reviews/:versionId" element={<SkillReviewPage />} />
    </Route>
    <Route path="/workspace" element={<RequireSession><TenantConsole admin={false} /></RequireSession>}>
      <Route index element={<Navigate to="skills" replace />} />
      <Route path="skills" element={<SkillsPage />} />
      <Route path="skills/:id" element={<SkillDetailPage />} />
      <Route path="my-skills" element={<MySkillsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></BrowserRouter>;
}
