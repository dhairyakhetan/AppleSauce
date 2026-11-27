import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Field, FieldInput, FieldSelect } from '@/components/ui/field';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  EMPTY_GUARDIAN_FORM,
  GRADE_OPTIONS,
  GUARDIAN_NAME_MAX,
  guardianFormFromRow,
  guardianProblems,
  saveGuardianProfile,
  type GuardianForm,
} from '@/lib/guardian-profile';

/* The Edit profile sheet for a guardian (parent): their name, phone, their child's class and the subjects the child needs.
   Site-wide audit B7 (27 Nov 2026): the Account page offered Edit profile to students only, so a guardian could not
   correct a wrong class. A guardian's class is `student_grade` and their subjects are `guardian_student_subjects`, so this is
   its own sheet instead of the student form (see src/lib/guardian-profile.ts). */

export function GuardianProfileSheet({ userId, open, onOpenChange }: { userId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();

  const formQuery = useQuery({
    queryKey: ['guardianEditForm', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('full_name, phone, student_grade').eq('id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });
  // Shares a cache key with the student sheet's identical global lookup.
  const subjectsQuery = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });
  const chosenQuery = useQuery({
    queryKey: ['guardianSubjectIds', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('guardian_student_subjects').select('subject_id').eq('guardian_id', userId);
      if (error) throw error;
      return (data ?? []).map((s) => s.subject_id as string);
    },
    enabled: open,
  });

  const loading = open && (formQuery.isPending || subjectsQuery.isPending || chosenQuery.isPending);
  const loadFailed = formQuery.isError || subjectsQuery.isError || chosenQuery.isError;
  useEffect(() => {
    if (loadFailed) toast.error('Could not load your profile');
  }, [loadFailed]);

  const [form, setForm] = useState<GuardianForm>(EMPTY_GUARDIAN_FORM);
  const [loadedName, setLoadedName] = useState('');
  useEffect(() => {
    if (!formQuery.data) return;
    const next = guardianFormFromRow(formQuery.data);
    setForm(next);
    setLoadedName(next.full_name);
  }, [formQuery.data]);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (chosenQuery.data) setChosen(chosenQuery.data);
  }, [chosenQuery.data]);
  const [touched, setTouched] = useState(false);

  const problems = guardianProblems(form);
  const shown = touched ? problems : {};

  const save = useMutation({
    mutationFn: () => saveGuardianProfile(supabase, userId, form, chosen, { nameChanged: form.full_name.trim() !== loadedName.trim() }),
    onSuccess: (result) => {
      toast.success(result.nameSyncFailed ? 'Profile updated. Your name may take a moment to show everywhere.' : 'Profile updated');
      onOpenChange(false);
      // The header's "Guardian · Class 9" line reads this cache: patch it so it changes at once.
      queryClient.setQueryData(['accountProfile', userId], (prev: Record<string, unknown> | null | undefined) =>
        prev ? { ...prev, full_name: form.full_name.trim(), student_grade: form.student_grade.trim() || null } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['guardianEditForm', userId] });
      void queryClient.invalidateQueries({ queryKey: ['guardianSubjectIds', userId] });
    },
    onError: () => {
      toast.error('Failed to save your profile');
    },
  });

  function handleSave() {
    setTouched(true);
    if (Object.keys(problems).length > 0) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate();
  }

  const toggle = (id: string) => setChosen((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  const subjects = subjectsQuery.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col rounded-t-[28px] border-0 pb-6 pt-6" data-testid="guardian-profile-sheet">
        <SheetHeader className="items-start text-left">
          <SheetTitle className="font-display text-xl font-bold tracking-tight text-foreground">Edit profile</SheetTitle>
          <SheetDescription className="sr-only">Update your name, phone number, your child's class and the subjects your child needs.</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-warm-label" aria-hidden="true" />
          </div>
        ) : loadFailed ? (
          <p role="alert" className="mt-4 text-[14px] text-destructive">
            Your details did not load, so saving now could overwrite them. Close this and open it again.
          </p>
        ) : (
          <div className="mt-4 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-[14px] pb-2">
              <Field label="Your name" error={shown.full_name} required>
                {(cp) => (
                  <FieldInput
                    {...cp}
                    autoComplete="name"
                    maxLength={GUARDIAN_NAME_MAX}
                    placeholder="Your full name"
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  />
                )}
              </Field>

              <Field label="Phone number (optional)" error={shown.phone}>
                {(cp) => (
                  <FieldInput
                    {...cp}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                    placeholder="10-digit phone number"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                  />
                )}
              </Field>

              <Field label="Your child's class" error={shown.student_grade} required>
                {(cp) => (
                  <FieldSelect {...cp} value={form.student_grade} onChange={(e) => setForm((f) => ({ ...f, student_grade: e.target.value }))}>
                    <option value="">Select class</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        {/^\d+$/.test(g) ? `Class ${g}` : g}
                      </option>
                    ))}
                  </FieldSelect>
                )}
              </Field>

              <div className="flex flex-col gap-2">
                <Eyebrow className="whitespace-normal">Subjects your child needs (optional)</Eyebrow>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Subjects">
                  {subjects.map((s) => (
                    <Chip key={s.id} tone={chosen.includes(s.id) ? 'facet-on' : 'facet'} size={44} aria-pressed={chosen.includes(s.id)} onClick={() => toggle(s.id)}>
                      {s.name}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !loadFailed ? (
          <Button variant="primary" size={52} className="mt-4 w-full flex-none" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Save profile'}
          </Button>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
