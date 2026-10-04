import type { SkillBadges } from '@skill-hub/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from './api';

const EMPTY: SkillBadges = { pendingReviews: 0, rejectedDrafts: 0 };

const SkillBadgesContext = createContext<{ badges: SkillBadges; refresh: () => void }>({ badges: EMPTY, refresh: () => undefined });

/**
 * 菜单红点（待审核数、被驳回的草稿数）：切换页面时重新加载（他人的提交、审核也能及时反映），
 * 本人做了审核相关操作后由页面调用 refresh 立即更新。
 */
export function SkillBadgesProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [badges, setBadges] = useState(EMPTY);
  const refresh = useCallback(() => {
    // 红点只是提示，加载失败时保持原值
    api<SkillBadges>('/skills/badges').then(setBadges, () => undefined);
  }, []);
  useEffect(refresh, [refresh, pathname]);
  return <SkillBadgesContext.Provider value={{ badges, refresh }}>{children}</SkillBadgesContext.Provider>;
}

export const useSkillBadges = () => useContext(SkillBadgesContext);
