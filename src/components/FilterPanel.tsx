import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet';
import { X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { SUBJECT_DISPLAY_ORDER } from '@/utils/subjectOrder';

const EXPERIENCE_OPTIONS = [
  { value: '1', label: '1+ years' },
  { value: '3', label: '3+ years' },
  { value: '5', label: '5+ years' },
  { value: '10', label: '10+ years' },
  { value: '15', label: '15+ years' },
  { value: '20', label: '20+ years' },
];

interface FilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
}

export interface FilterState {
  subjects: string[];
  classes: string[];
  boards: string[];
  classSize: string[];
  areas: string[];
  modeOfTeaching: string[];
  placeOfTeaching: string[];
  minFees: number | null;
  maxFees: number | null;
  minExperience: string | null;
  /** Papers-mode only (Browse's same-page teachers/papers toggle) — a
   *  teacher has no school or exam-type facet, but Subject/Class/Board are
   *  shared between both. */
  schools: string[];
  examTypes: string[];
}

const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG'];

const BOARDS = ['ICSE', 'CBSE', 'IGCSE', 'IB', 'State'];

const CLASS_SIZE = ['Group', 'Solo'];

// Same 45 areas, now surfaced as named geographic groups instead of one flat,
// alphabetised list (audit finding: the grouping existed in the data shape but
// was invisible in the UI). Each group renders as its own labelled cluster in
// the panel, with a search-within box above all of them for the rest.
const AREA_GROUPS: { label: string; areas: string[] }[] = [
  { label: 'South Kolkata', areas: ['Alipore', 'Ballygunge', 'Behala', 'Bhowanipore', 'Gariahat', 'Garia', 'Jadavpur', 'Kasba', 'New Alipore', 'Southern Avenue', 'Tollygunge', 'Hazra'] },
  { label: 'Salt Lake & New Town', areas: ['Baguihati', 'Belur', 'Howrah', 'Joka', 'Newtown', 'Rajarhat', 'Salt Lake', 'Science City'] },
  { label: 'North Kolkata', areas: ['Dum Dum', 'Entally', 'Girish Park', 'Nagarbazar', 'Sealdah', 'Shyam Bazar', 'Tangra'] },
  { label: 'Central Kolkata', areas: ['Camac Street', 'College Street', 'Elgin', 'Minto Park', 'Park Street', 'Park Circus'] },
  { label: 'East Kolkata', areas: ['Kankurgachi', 'Laketown', 'Phoolbagan', 'Ultadanga'] },
  { label: 'South East Kolkata', areas: ['Anandapur', 'Parnasree', 'Rabindra Nagar'] },
  { label: 'Greater Kolkata', areas: ['Hooghly'] },
];

const MODE_OF_TEACHING = ['Online', 'Offline'];

const PLACE_OF_TEACHING = ["Teacher's place", "Student's Home"];

// Subject list in display order for Browse page (advanced filters)
const SUBJECTS = SUBJECT_DISPLAY_ORDER;

export function FilterPanel({ open, onOpenChange, filters, onFilterChange, onClearFilters }: FilterPanelProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const lastScrollY = useRef(0);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  // Search-within-areas (audit finding: ~45 chips in one flat unsearchable list).
  // Filters the visible groups client-side; doesn't touch onFilterChange/filter state.
  const [areaQuery, setAreaQuery] = useState('');
  const filteredAreaGroups = areaQuery.trim()
    ? AREA_GROUPS.map((g) => ({
        label: g.label,
        areas: g.areas.filter((a) => a.toLowerCase().includes(areaQuery.trim().toLowerCase())),
      })).filter((g) => g.areas.length > 0)
    : AREA_GROUPS;

  // Handle scroll detection for sticky header - similar to navbar behavior
  useEffect(() => {
    if (!open) {
      // Reset scroll state when panel closes
      setIsScrolled(false);
      lastScrollY.current = 0;
      return;
    }

    let cleanup: (() => void) | null = null;

    // Small delay to ensure ref is available
    const timeoutId = setTimeout(() => {
      const sheetContent = sheetContentRef.current;
      if (!sheetContent) return;

      const handleScroll = () => {
        const scrollPosition = Math.max(0, sheetContent.scrollTop);
        const previousScrollY = lastScrollY.current;
        
        // Use hysteresis with different thresholds to prevent jumping
        // Scrolling down: trigger at 50px (higher threshold)
        // Scrolling up: return to original when at top (0px)
        if (scrollPosition > previousScrollY) {
          // Scrolling down - make sticky when past 50px
          setIsScrolled(scrollPosition > 50);
        } else if (scrollPosition < previousScrollY) {
          // Scrolling up - return to original position when at top
          setIsScrolled(scrollPosition > 0);
        } else {
          // Same position - maintain current state based on scroll position
          setIsScrolled(scrollPosition > 50);
        }
        
        lastScrollY.current = scrollPosition;
      };

      // Check initial scroll position
      lastScrollY.current = Math.max(0, sheetContent.scrollTop);
      handleScroll();
      
      sheetContent.addEventListener('scroll', handleScroll, { passive: true });
      
      cleanup = () => {
        sheetContent.removeEventListener('scroll', handleScroll);
      };
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if (cleanup) cleanup();
    };
  }, [open]);

  type ArrayFilterKey = 'subjects' | 'classes' | 'boards' | 'classSize' | 'areas' | 'modeOfTeaching' | 'placeOfTeaching';
  const toggleFilter = (category: ArrayFilterKey, value: string) => {
    const currentValues = filters[category];
    const newValues = currentValues.includes(value)
      ? currentValues.filter(v => v !== value)
      : [...currentValues, value];
    
    onFilterChange({
      ...filters,
      [category]: newValues,
    });
  };

  const hasActiveFilters = 
    filters.subjects.length > 0 ||
    filters.classes.length > 0 ||
    filters.boards.length > 0 ||
    filters.classSize.length > 0 ||
    filters.areas.length > 0 ||
    filters.modeOfTeaching.length > 0 ||
    filters.placeOfTeaching.length > 0 ||
    filters.minFees != null ||
    filters.maxFees != null ||
    filters.minExperience != null;

  const handleApplyFilters = () => {
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={sheetContentRef}
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto [&>button:last-child]:hidden"
      >
        {/* Sticky header with Advanced Filters title and X button - sticky when scrolling down, returns to original position when at top.
            Padding stays static; the shrink-on-scroll effect is achieved by translating the inner wrapper via transform
            (translateY) instead of animating padding-top, which avoids forcing layout reflow on every frame. */}
        <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50 -mx-6 px-6 pb-4 pt-6 mb-6 overflow-hidden">
          <div
            className="flex items-center justify-between transition-transform duration-300 ease-in-out will-change-transform"
            style={{ transform: isScrolled ? 'translateY(-17px)' : 'translateY(0)' }}
          >
            <SheetHeader className="flex-1">
              <SheetTitle className="text-2xl font-sans font-normal tracking-tight">Advanced Filters</SheetTitle>
            </SheetHeader>
            <SheetClose
              aria-label="Close filters"
              className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="h-6 w-6 stroke-[2.5]" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </div>

        <div className="mt-6 space-y-8">
          {/* Subjects taught */}
          <div>
            <h3 className="text-lg font-medium mb-4">Subjects taught</h3>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((subject) => (
                <button
                  key={subject}
                  onClick={() => toggleFilter('subjects', subject)}
                  className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${
                    filters.subjects.includes(subject)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>

          {/* Classes taught */}
          <div>
            <h3 className="text-lg font-medium mb-4">Classes taught</h3>
            <div className="flex flex-wrap gap-2">
              {CLASSES.map((cls) => (
                <button
                  key={cls}
                  onClick={() => toggleFilter('classes', cls)}
                  className={`w-12 h-12 rounded-full text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 flex items-center justify-center ${
                    filters.classes.includes(cls)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>

          {/* Boards taught */}
          <div>
            <h3 className="text-lg font-medium mb-4">Boards taught</h3>
            <div className="flex flex-wrap gap-2">
              {BOARDS.map((board) => (
                <button
                  key={board}
                  onClick={() => toggleFilter('boards', board)}
                  className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${
                    filters.boards.includes(board)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {board}
                </button>
              ))}
            </div>
          </div>

          {/* Structure of classes */}
          <div>
            <h3 className="text-lg font-medium mb-4">Structure of classes</h3>
            <div className="flex flex-wrap gap-2">
              {CLASS_SIZE.map((size) => (
                <button
                  key={size}
                  onClick={() => toggleFilter('classSize', size)}
                  className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${
                    filters.classSize.includes(size)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {size === 'Solo' ? 'One-on-one' : size}
                </button>
              ))}
            </div>
          </div>

          {/* Areas — grouped by geography (was one flat 45-chip list with the
              grouping invisible), plus a search-within box for narrowing fast. */}
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-medium">Areas</h3>
              {filters.areas.length > 0 && (
                <span className="rounded-full bg-brand px-2.5 py-0.5 text-label font-bold tabular-nums text-foreground">
                  {filters.areas.length}
                </span>
              )}
            </div>
            <Input
              type="search"
              value={areaQuery}
              onChange={(e) => setAreaQuery(e.target.value)}
              placeholder="Search areas…"
              aria-label="Search areas"
              className="mb-4 h-11"
            />
            {filteredAreaGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No areas match &ldquo;{areaQuery}&rdquo;.</p>
            ) : (
              <div className="space-y-5">
                {filteredAreaGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-2 text-label font-medium uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.areas.map((area) => (
                        <button
                          key={area}
                          onClick={() => toggleFilter('areas', area)}
                          aria-pressed={filters.areas.includes(area)}
                          className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${
                            filters.areas.includes(area)
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground hover:bg-muted/80'
                          }`}
                        >
                          {area}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mode of teaching */}
          <div>
            <h3 className="text-lg font-medium mb-4">Mode of teaching</h3>
            <div className="flex flex-wrap gap-2">
              {MODE_OF_TEACHING.map((mode) => (
                <button
                  key={mode}
                  onClick={() => toggleFilter('modeOfTeaching', mode)}
                  className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${
                    filters.modeOfTeaching.includes(mode)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Place of teaching */}
          <div>
            <h3 className="text-lg font-medium mb-4">Place of teaching</h3>
            <div className="flex flex-wrap gap-2">
              {PLACE_OF_TEACHING.map((place) => (
                <button
                  key={place}
                  onClick={() => toggleFilter('placeOfTeaching', place)}
                  className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${
                    filters.placeOfTeaching.includes(place)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {place}
                </button>
              ))}
            </div>
          </div>

          {/* Experience */}
          <div>
            <h3 className="text-lg font-medium mb-4">Experience</h3>
            <Select
              value={filters.minExperience || ''}
              onValueChange={(value) => {
                onFilterChange({
                  ...filters,
                  minExperience: value === 'all' ? null : value,
                });
              }}
            >
              <SelectTrigger className="w-full h-11 text-sm">
                <SelectValue placeholder="Any experience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any experience</SelectItem>
                {EXPERIENCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              Filter by minimum years of teaching experience.
            </p>
          </div>

          {/* Fees per month */}
          <div>
            <h3 className="text-lg font-medium mb-4">Fees per month (₹)</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minFees">Minimum</Label>
                  <Input
                    id="minFees"
                    type="tel"
                    placeholder="e.g., 2000"
                    value={filters.minFees?.toString() || ''}
                    onChange={(e) => {
                      // Only allow digits, limit to 6 digits
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                      onFilterChange({
                        ...filters,
                        minFees: digits ? parseInt(digits) : null,
                      });
                    }}
                    maxLength={6}
                    inputMode="numeric"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxFees">Maximum</Label>
                  <Input
                    id="maxFees"
                    type="tel"
                    placeholder="e.g., 5000"
                    value={filters.maxFees?.toString() || ''}
                    onChange={(e) => {
                      // Only allow digits, limit to 6 digits
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                      onFilterChange({
                        ...filters,
                        maxFees: digits ? parseInt(digits) : null,
                      });
                    }}
                    maxLength={6}
                    inputMode="numeric"
                    className="w-full"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Filter teachers by their monthly fee range. Leave empty to show all.
              </p>
            </div>
          </div>
        </div>

        {/* Filter action buttons */}
        <div className="mt-8 pt-6 border-t space-y-3 sticky bottom-0 bg-background pb-4">
          <div className="flex gap-3">
            {hasActiveFilters && (
              <Button
                variant="outline"
                onClick={onClearFilters}
                className="flex-1"
              >
                Clear filters
              </Button>
            )}
            <Button
              onClick={handleApplyFilters}
              className={`flex-1 bg-brand text-foreground hover:brightness-95 ${!hasActiveFilters ? 'w-full' : ''}`}
            >
              Apply filters
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

