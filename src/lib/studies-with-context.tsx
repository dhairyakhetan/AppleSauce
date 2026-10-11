import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToggleRelation } from '@/lib/use-toggle-relation';

interface StudiesWithContextType {
  isStudyingWith: (teacherId: string) => boolean;
  toggleStudiesWith: (teacherId: string) => Promise<boolean>;
  loading: boolean;
  studiesWithCount: number;
  studiesWithTeacherIds: Set<string>;
}

const StudiesWithContext = createContext<StudiesWithContextType | undefined>(undefined);

export function StudiesWithProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();

  // Role check reads the cached role from auth-context (not a fresh `profiles`
  // query per toggle — that used to be a round trip on every single tap).
  // This is a UI guard only; the same rule must be enforced by RLS on
  // `student_teachers`, or a non-student could insert directly.
  const guard = useCallback(() => {
    if (profile?.role !== 'student') {
      return 'Only students can indicate they study with a teacher';
    }
    return null;
  }, [profile]);

  const { ids, loading, isRelated, toggle } = useToggleRelation({
    table: 'student_teachers',
    ownerColumn: 'student_id',
    targetColumn: 'teacher_id',
    userId: user?.id ?? null,
    cacheKeyPrefix: 'studies_with',
    guard,
    messages: {
      signInRequired: 'Please sign in to indicate you study with this teacher',
      addSuccess: 'Added to your teachers',
      removeSuccess: 'Removed from your teachers',
      genericError: 'Failed to update. Please try again.',
    },
  });

  const value = useMemo<StudiesWithContextType>(
    () => ({
      isStudyingWith: isRelated,
      toggleStudiesWith: toggle,
      loading,
      studiesWithCount: ids.size,
      studiesWithTeacherIds: ids,
    }),
    [isRelated, toggle, loading, ids]
  );

  return <StudiesWithContext.Provider value={value}>{children}</StudiesWithContext.Provider>;
}

export function useStudiesWith() {
  const context = useContext(StudiesWithContext);
  if (context === undefined) {
    throw new Error('useStudiesWith must be used within a StudiesWithProvider');
  }
  return context;
}
