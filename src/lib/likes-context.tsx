import { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToggleRelation } from '@/lib/use-toggle-relation';

interface LikesContextType {
  isLiked: (teacherId: string) => boolean;
  toggleLike: (teacherId: string) => Promise<boolean>;
  loading: boolean;
  likedCount: number;
  likedTeacherIds: Set<string>;
}

const LikesContext = createContext<LikesContextType | undefined>(undefined);

export function LikesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const { ids, loading, isRelated, toggle } = useToggleRelation({
    table: 'liked_teachers',
    ownerColumn: 'user_id',
    targetColumn: 'teacher_id',
    userId: user?.id ?? null,
    cacheKeyPrefix: 'likes',
    handlePermissionDenied: true,
    messages: {
      signInRequired: 'Please sign in to favourite teachers',
      addSuccess: 'Added to favourite teachers',
      removeSuccess: 'Removed from favourite teachers',
      tableMissing: 'Table not found. Check if liked_teachers table exists in Supabase.',
      permissionDenied: 'Permission denied. Check RLS policies in Supabase.',
      genericError: 'Failed to update like',
    },
  });

  const value = useMemo<LikesContextType>(
    () => ({
      isLiked: isRelated,
      toggleLike: toggle,
      loading,
      likedCount: ids.size,
      likedTeacherIds: ids,
    }),
    [isRelated, toggle, loading, ids]
  );

  return <LikesContext.Provider value={value}>{children}</LikesContext.Provider>;
}

export function useLikes() {
  const context = useContext(LikesContext);
  if (context === undefined) {
    throw new Error('useLikes must be used within a LikesProvider');
  }
  return context;
}
