import type { ChangeEvent } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AREAS,
  BOARDS,
  CLASSES,
  CLASS_SIZE,
  LOCATION_OPTIONS,
  MODE_OF_TEACHING,
  SIR_MAAM,
  SUBJECTS,
  listHas,
  listToggle,
} from '@/lib/teacher-options';
import type { DetailsValue } from '@/components/teacher-review/details-value';

/* The one details form for the teacher review page: the same fields whether a
   reviewer is fixing a pending application or a listed teacher. Choices come
   from teacher-options.ts, the same lists the browse filters use, so a value
   picked here is a value the filters can find. Contacts and the photo are
   deliberately not here (only the application's own phone and WhatsApp link
   can be fixed, because a wrong number stops a teacher being reached). */

const FIELD = 'h-auto border border-warm-hairline bg-card focus-visible:ring-1 focus-visible:ring-ring';
const OPTION = 'cursor-pointer text-[13px] text-warm-prose';

type ListKey =
  | 'subjects'
  | 'classes_taught_for_backend'
  | 'school_boards_catered'
  | 'mode_of_teaching'
  | 'class_size'
  | 'students_home_areas'
  | 'tutors_home_areas';

function CheckGroup({
  idPrefix,
  legend,
  options,
  list,
  onToggle,
  scroll,
  display,
}: {
  idPrefix: string;
  legend: string;
  options: string[];
  list: string | null;
  onToggle: (value: string, on: boolean) => void;
  scroll?: boolean;
  display?: (v: string) => string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-2 ${scroll ? 'max-h-44 overflow-y-auto' : ''}`}>
        {options.map((o) => (
          <div key={o} className="flex items-center gap-2">
            <Checkbox id={`${idPrefix}-${o}`} checked={listHas(list, o)} onCheckedChange={(c) => onToggle(o, c === true)} />
            <Label htmlFor={`${idPrefix}-${o}`} className={OPTION}>
              {display ? display(o) : o}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function DetailsForm({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: DetailsValue;
  onChange: (next: DetailsValue) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof DetailsValue>(k: K, v: DetailsValue[K]) => onChange({ ...value, [k]: v });
  const toggle = (k: ListKey) => (item: string, on: boolean) => set(k, listToggle(value[k], item, on));
  const fee = (k: 'min_fees' | 'max_fees') => (e: ChangeEvent<HTMLInputElement>) =>
    set(k, e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))));

  return (
    <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} value={value.name} onChange={(e) => set('name', e.target.value)} className={FIELD} />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-sir`}>Sir or Ma'am</Label>
        <Select value={value.sir_maam ?? 'none'} onValueChange={(v) => set('sir_maam', v === 'none' ? null : v)}>
          <SelectTrigger id={`${idPrefix}-sir`} className={FIELD}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {SIR_MAAM.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.phone_number !== undefined ? (
        <>
          <div>
            <Label htmlFor={`${idPrefix}-phone`}>Phone (10 digits)</Label>
            <Input id={`${idPrefix}-phone`} inputMode="numeric" value={value.phone_number} onChange={(e) => set('phone_number', e.target.value)} className={FIELD} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-wa`}>WhatsApp link</Label>
            <Input id={`${idPrefix}-wa`} value={value.whatsapp_link ?? ''} onChange={(e) => set('whatsapp_link', e.target.value || null)} placeholder="Leave empty to use the phone number" className={FIELD} />
          </div>
        </>
      ) : null}

      <div className="md:col-span-2">
        <CheckGroup idPrefix={`${idPrefix}-subject`} legend="Subjects" options={SUBJECTS} list={value.subjects} onToggle={toggle('subjects')} scroll />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-featured`}>Featured subject</Label>
        <Select value={value.featured_subject ?? 'none'} onValueChange={(v) => set('featured_subject', v === 'none' ? null : v)}>
          <SelectTrigger id={`${idPrefix}-featured`} className={FIELD}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {SUBJECTS.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-years`}>Year they started teaching</Label>
        <Input id={`${idPrefix}-years`} value={value.years_started_teaching ?? ''} onChange={(e) => set('years_started_teaching', e.target.value || null)} className={FIELD} />
      </div>

      <CheckGroup idPrefix={`${idPrefix}-class`} legend="Classes taught" options={CLASSES} list={value.classes_taught_for_backend} onToggle={toggle('classes_taught_for_backend')} />
      <CheckGroup idPrefix={`${idPrefix}-board`} legend="School boards" options={BOARDS} list={value.school_boards_catered} onToggle={toggle('school_boards_catered')} />
      <CheckGroup idPrefix={`${idPrefix}-mode`} legend="Mode of teaching" options={MODE_OF_TEACHING} list={value.mode_of_teaching} onToggle={toggle('mode_of_teaching')} />
      <CheckGroup idPrefix={`${idPrefix}-size`} legend="Structure of classes" options={CLASS_SIZE} list={value.class_size} onToggle={toggle('class_size')} display={(v) => (v === 'Solo' ? 'One-on-one' : v)} />

      <div className="md:col-span-2">
        <Label htmlFor={`${idPrefix}-location`}>Where they teach</Label>
        <Select value={value.location_v2 ?? 'none'} onValueChange={(v) => set('location_v2', v === 'none' ? null : v)}>
          <SelectTrigger id={`${idPrefix}-location`} className={FIELD}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not said</SelectItem>
            {LOCATION_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="md:col-span-2">
        <CheckGroup idPrefix={`${idPrefix}-sh`} legend="Student's home, in these areas" options={AREAS} list={value.students_home_areas} onToggle={toggle('students_home_areas')} scroll />
      </div>
      <div className="md:col-span-2">
        <CheckGroup idPrefix={`${idPrefix}-th`} legend="Teacher's home, in these areas" options={AREAS} list={value.tutors_home_areas} onToggle={toggle('tutors_home_areas')} scroll />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-min`}>Lowest fee per month (Rs)</Label>
        <Input id={`${idPrefix}-min`} type="number" min={0} value={value.min_fees ?? ''} onChange={fee('min_fees')} className={FIELD} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-max`}>Highest fee per month (Rs)</Label>
        <Input id={`${idPrefix}-max`} type="number" min={0} value={value.max_fees ?? ''} onChange={fee('max_fees')} className={FIELD} />
      </div>

      <div className="md:col-span-2">
        <Label htmlFor={`${idPrefix}-desc`}>About them</Label>
        <Textarea id={`${idPrefix}-desc`} value={value.description ?? ''} onChange={(e) => set('description', e.target.value || null)} className={`${FIELD} min-h-[120px]`} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor={`${idPrefix}-qual`}>Qualifications</Label>
        <Textarea id={`${idPrefix}-qual`} value={value.qualifications_etc ?? ''} onChange={(e) => set('qualifications_etc', e.target.value || null)} className={`${FIELD} min-h-[80px]`} />
      </div>
    </fieldset>
  );
}
