import { type CurrentUser, type EmployeeProfile, type MeResponse } from '@skill-hub/shared';
import { Result, Spin } from 'antd';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { api, ApiError } from './api';

const MeContext = createContext<{ me: MeResponse; setMe: (me: MeResponse) => void } | null>(null);

function useMeContext() {
  const context = useContext(MeContext);
  if (!context) throw new Error('useMe 必须在 RequireSession 内使用');
  return context;
}

export function useMe(): MeResponse {
  return useMeContext().me;
}

/** 用接口返回的最新 MeResponse 更新当前会话信息（如改昵称后顶栏同步刷新）。 */
export function useSetMe(): (me: MeResponse) => void {
  return useMeContext().setMe;
}

export function useCurrentUser(): CurrentUser {
  return useMe().user;
}

/** 会话当前租户下的档案；没有则为 undefined。 */
export function useCurrentEmployee(): EmployeeProfile | undefined {
  const { employees, currentTenantId } = useMe();
  return employees.find((e) => e.tenant.id === currentTenantId);
}

type MeState =
  | { kind: 'loading' }
  | { kind: 'ok'; me: MeResponse }
  | { kind: 'redirect'; to: string }
  | { kind: 'error'; message: string };

/** 路由守卫：未登录去登录页，其余渲染 children 并提供当前用户。 */
export function RequireSession({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ kind: 'loading' });

  useEffect(() => {
    // 开发模式（StrictMode）下 effect 会执行两次；已清理的那次请求晚到的结果必须丢弃，
    // 否则会在用户已离开（如已登录）后又把页面带回登录页。回跳地址在发请求时记下，而不是响应到达时。
    let cancelled = false;
    // 带上当前地址，登录完成后回到原页面（如 Skill 审核链接）
    const here = window.location.pathname + window.location.search;
    const suffix = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
    api<MeResponse>('/auth/me')
      .then((me) => !cancelled && setState({ kind: 'ok', me }))
      .catch((err: Error) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) setState({ kind: 'redirect', to: `/login${suffix}` });
        else setState({ kind: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') return <Spin fullscreen />;
  if (state.kind === 'redirect') return <Navigate to={state.to} replace />;
  if (state.kind === 'error') return <Result status="error" title="加载失败" subTitle={state.message} />;
  return <MeContext.Provider value={{ me: state.me, setMe: (me) => setState({ kind: 'ok', me }) }}>{children}</MeContext.Provider>;
}
