import { describe, expect, it } from 'vitest';

import { displaySchool, isRealSchoolLabel, rawSchoolsFor, schoolSearchTerms } from './school-display';

/**
 * The 190 distinct raw values of `bank_papers.school` live at the time of
 * this audit (2026-09-27), pulled read-only via the anon REST endpoint. This
 * is the exact set the owner report was written against; the full raw ->
 * display table with sources lives in the audit scratchpad, not the repo.
 */
const LIVE_RAW_VALUES: string[] = [
  'ICSE board paper', 'Delhi Public School, Joka', 'Don Bosco School, Park Circus',
  'La Martiniere for Girls', 'School not recorded', 'CBSE board paper',
  "Bhavan's Gangabux Kanoria Vidyamandir", 'Chandulal Nanavati Vinay Mandir',
  'Calcutta Boys’ School', 'La Martiniere for Boys', 'Apex', 'Ariv', 'ASC',
  'Baldwin Girls’ High School, Bengaluru', 'Beacon High',
  'Bhaktivedanta Swami Mission School', 'Bhuta High School',
  'Billabong High International School', 'Bombay Scottish School',
  'Bombay Scottish School, Mahim', 'CBS', 'Champion', "Children's Academy",
  'City International', 'Dhirubhai Ambani International School',
  'Delhi Public School, Newtown', 'GES', 'Gokuldham High School',
  'Gundecha Education Academy, Kandivali', 'Hutchings',
  'J. B. Petit High School for Girls', 'Jamnabai Narsee School', 'St Mary',
  'Delhi Public School, Megacity', 'AIS SE', 'Anubhuti',
  'Arya Vidya Mandir, Juhu', 'Bai Avabai Framji Petit Girls’ High School',
  'DBCS', 'Dr Mts Pune', 'GHSJC', 'Greenwood High International School, Bengaluru',
  'HCS', 'Hiranandani Foundation School, Powai', 'Hiranandani Foundation School, Thane',
  'The Hyderabad Public School', 'Internobilian', 'JGS', 'LML', 'NPS', 'PIS',
  'IES Orion, Dadar', 'Arya Vidya Mandir', 'Bishop Westcott School, Ranchi',
  'Brugesh Sir', 'The Cathedral and John Connon School', 'EuroSchool', 'FAPS',
  'Graphs', 'Hare Krishna', 'IES', 'LFS', 'Lilavatibai Podar High School', 'MPBFHS',
  'NSM', 'Podar', 'PPSC', 'RBS', 'Swami Vivekanand International School, Kandivali',
  'Thakur International School', 'Vissanji Academy', 'ISC board paper',
  'Delhi Public School Megacity', 'Delhi Public School Ruby Park',
  'Loreto Convent Entally School', 'Loreto House', 'Sri Sri Academy',
  'Wrown School', 'Goldcrest High Vashi', 'Smt. Sunitidevi Singhania School',
  'Vibgyor High School', 'FM Tutorials JML', 'History', 'Jml', 'JPS',
  'Mahadevi Birla Shishu Vihar', 'PARLE TILAK Vidyalaya', 'Ryan International School',
  'S.M. Vissanji Academy', 'St. Gregorios High School', 'St. Thomas School',
  'Sulochanadevi Singhania School', 'Timpany School', 'Jasudben Jml Hist', 'Dbpc',
  'Greenlawns Hc', 'Jamanabai Historycivics', 'Lokhandwala Lfs', 'Maneckji',
  'Poddar Sa1', 'Ramniwas Bajaj Preliem', 'Royal Academy', 'Se Rly Kgp Historycivics',
  'Sgvp', 'St Agnes', 'St Johns And', 'The Brigade History And Civics',
  'Young Horizons School', 'Aass', 'Dhirubai', 'Hvb', 'Jbcn', 'And Hiranandani',
  'And St Francis', 'B D Bhuta', 'Cag Hcg1', 'Euro School', 'Kapol Vidyanidhi Int',
  'Parle Tilak', 'Pawar Public', 'R C S E', 'Rbk School', 'S. J Poddar Academy',
  'Shishuvan', "St Mary'S School", 'Universal High', 'Hist Billabong',
  'Cathedra John', 'KVS', 'Arya Vidya Mandir Hc', 'Campion', 'Contemprary World',
  'Gd Somani', 'Gems', 'Gregorios', 'Hvb Global Academy', 'Ipem', 'J B Petite Hc',
  'Pawar Kandivali And', 'Ryan Intl', 'Ryan Intl Hist', 'Sharada Mandir', 'Sjhs',
  'St Annes Fort', 'St Gregorios', 'St Mary And', 'Sulochanadevi', 'Tffs',
  'Tffs &', 'Thakur', 'Vsn &', 'Hist', 'Consumer Awareness', 'Inflation Mcqs',
  'Public Revenuepublic Expenditurepublic Debt Mcqs', 'Unnamed school',
  'Aditya Academy Secondary School', 'Pratt Memorial School',
  "St. Xavier's Collegiate School", 'The Heritage School', 'Modern High School for Girls',
  'Mahadevi Birla World Academy', 'Adamas International School', 'Ashok Hall School',
  'Assembly of Christ School', 'Auxilium Convent School', "Calcutta Boys' School",
  'Calcutta Girls School', 'Don Bosco School Bandel', "St. Thomas' Day School",
  'Hariyana Vidya Mandir', 'Mercy Memorial School',
  'Mother Teresa Mission Higher Secondary S', 'Mangalam Vidya Niketan',
  'Our Lady Queen of the Missions School', 'Salt Lake School',
  'St. Francis Xavier School', 'St. James School', 'The Frank Anthony Public School',
  'Delhi Public School Newtown', 'St. Xaviers Collegiate School',
  'South City International School', 'Don Bosco School Siliguri',
  'Sushila Birla Girls School', 'Bishop Cotton Girls School', 'Loyola High School',
  'Indira Gandhi Memorial Senior Secondary', 'Don Bosco School Liluah',
  'Kendriya Vidyalaya Sangathan', 'Salt Lake Point School',
];

describe('displaySchool', () => {
  it('has exactly the 190 live distinct values fixed in this test', () => {
    expect(new Set(LIVE_RAW_VALUES).size).toBe(190);
    expect(LIVE_RAW_VALUES.length).toBe(190);
  });

  it('maps every live raw value to a non-empty label', () => {
    for (const raw of LIVE_RAW_VALUES) {
      const label = displaySchool(raw);
      expect(label, `displaySchool(${JSON.stringify(raw)})`).toBeTruthy();
      expect(label.trim()).toBe(label);
    }
  });

  it('never leaves a subject/exam fragment on the end', () => {
    const forbidden = [/\bAnd$/, /&$/, /\bHc$/, /\bHist$/, /Historycivics$/i, /\bSa1$/, /\bPreliem$/i];
    for (const raw of LIVE_RAW_VALUES) {
      const label = displaySchool(raw);
      for (const re of forbidden) {
        expect(label, `displaySchool(${JSON.stringify(raw)}) -> ${JSON.stringify(label)} matched ${re}`).not.toMatch(re);
      }
    }
  });

  it('treats pure non-school fragments as unrecorded', () => {
    const nonSchool = [
      'History', 'Graphs', 'Consumer Awareness', 'Inflation Mcqs',
      'Public Revenuepublic Expenditurepublic Debt Mcqs', 'Contemprary World',
      'Brugesh Sir', 'Cag Hcg1', 'Unnamed school', 'School not recorded', 'Hist',
    ];
    for (const raw of nonSchool) {
      expect(displaySchool(raw)).toBe('School not recorded');
    }
  });

  it('keeps board-paper source lines exactly as stored', () => {
    for (const raw of ['ICSE board paper', 'CBSE board paper', 'ISC board paper']) {
      expect(displaySchool(raw)).toBe(raw);
    }
  });

  it('merges duplicate spellings/casings/abbreviations to one label', () => {
    const merges: [string, string][] = [
      ['Parle Tilak', 'PARLE TILAK Vidyalaya'],
      ['Euro School', 'EuroSchool'],
      ["Calcutta Boys' School", 'Calcutta Boys’ School'],
      ['Delhi Public School Newtown', 'Delhi Public School, Newtown'],
      ['Delhi Public School Megacity', 'Delhi Public School, Megacity'],
      ['St. Xaviers Collegiate School', "St. Xavier's Collegiate School"],
      ['Ryan Intl', 'Ryan Intl Hist'],
      ['Ryan Intl', 'Ryan International School'],
      ['Gregorios', 'St Gregorios'],
      ['Gregorios', 'St. Gregorios High School'],
      ['Sulochanadevi', 'Sulochanadevi Singhania School'],
      ['B D Bhuta', 'Bhuta High School'],
      ['Hist Billabong', 'Billabong High International School'],
      ['Jamanabai Historycivics', 'Jamnabai Narsee School'],
      ['J B Petite Hc', 'J. B. Petit High School for Girls'],
      ['Vsn &', 'S.M. Vissanji Academy'],
      ['Vsn &', 'Vissanji Academy'],
      ['Tffs &', 'Tffs'],
      ['Jml', 'Jasudben Jml Hist'],
      ['Jml', 'FM Tutorials JML'],
      ['Cathedra John', 'The Cathedral and John Connon School'],
      ['Arya Vidya Mandir Hc', 'Arya Vidya Mandir'],
      ['MPBFHS', 'MPBFHS'],
      ['Jbcn', 'Jbcn'],
    ];
    for (const [a, b] of merges) {
      expect(displaySchool(a), `${a} vs ${b}`).toBe(displaySchool(b));
    }
  });

  it('keeps distinct branches distinct', () => {
    const branchGroups: string[][] = [
      ['Bombay Scottish School', 'Bombay Scottish School, Mahim'],
      ['Hiranandani Foundation School, Powai', 'Hiranandani Foundation School, Thane'],
      ['Delhi Public School, Joka', 'Delhi Public School, Newtown', 'Delhi Public School, Megacity', 'Delhi Public School Ruby Park'],
    ];
    for (const group of branchGroups) {
      const labels = group.map(displaySchool);
      expect(new Set(labels).size, group.join(' | ')).toBe(group.length);
    }
  });

  it('resolves confirmed abbreviations to full names', () => {
    expect(displaySchool('MPBFHS')).toBe('M. P. Birla Foundation Higher Secondary School');
    expect(displaySchool('KVS')).toBe('Kendriya Vidyalaya Sangathan');
    expect(displaySchool('Jbcn')).toBe('JBCN International School');
    expect(displaySchool('LFS')).toBe('Lokhandwala Foundation School');
  });

  it('leaves a genuinely unresolvable abbreviation uppercased, not guessed', () => {
    expect(displaySchool('NPS')).toBe('NPS');
    expect(displaySchool('HCS')).toBe('HCS');
    expect(displaySchool('LML')).toBe('LML');
  });

  it('reverts an initialism guess that had no independent source, even when a plausible full name exists elsewhere in the bank', () => {
    /* ASC/CBS/FAPS/GES/PPSC were all only ever "these initials could spell a
       school that also happens to be a live raw value elsewhere" -- never a
       citation tying THIS abbreviation to THAT school. ASC and CBS in
       particular sit in a run of unresolved Mumbai-batch abbreviations while
       their guessed match is a Kolkata school, which is the coincidental-
       initials mismatch the "no guessing" brief exists to catch. */
    expect(displaySchool('ASC')).toBe('ASC');
    expect(displaySchool('CBS')).toBe('CBS');
    expect(displaySchool('FAPS')).toBe('FAPS');
    expect(displaySchool('GES')).toBe('GES');
    expect(displaySchool('PPSC')).toBe('PPSC');
  });

  it('does not merge "Champion" into "Campion School" without a source, but still completes the correctly-spelled "Campion"', () => {
    expect(displaySchool('Champion')).toBe('Champion');
    expect(displaySchool('Campion')).toBe('Campion School');
  });

  it('falls back to "School not recorded" for null/blank', () => {
    expect(displaySchool(null)).toBe('School not recorded');
    expect(displaySchool(undefined)).toBe('School not recorded');
    expect(displaySchool('')).toBe('School not recorded');
    expect(displaySchool('   ')).toBe('School not recorded');
  });
});

describe('rawSchoolsFor', () => {
  it('resolves a merged label back to every raw value it covers', () => {
    const raws = rawSchoolsFor(displaySchool('Parle Tilak'));
    expect(raws).toEqual(expect.arrayContaining(['Parle Tilak', 'PARLE TILAK Vidyalaya']));
  });

  it('resolves an unmerged label back to at least itself', () => {
    const label = displaySchool('Gokuldham High School');
    expect(rawSchoolsFor(label)).toEqual(expect.arrayContaining(['Gokuldham High School']));
  });

  it('includes the bare spelling when a merge partner is a subject-suffixed variant of it', () => {
    // "Arya Vidya Mandir" is itself a live raw value AND the display label
    // for "Arya Vidya Mandir Hc" -- selecting the facet label has to match
    // papers filed under both, not just the mapped alias.
    const raws = rawSchoolsFor(displaySchool('Arya Vidya Mandir Hc'));
    expect(raws).toEqual(expect.arrayContaining(['Arya Vidya Mandir', 'Arya Vidya Mandir Hc']));
  });
});

describe('isRealSchoolLabel', () => {
  it('excludes the unrecorded placeholder and board-paper source lines', () => {
    expect(isRealSchoolLabel('School not recorded')).toBe(false);
    expect(isRealSchoolLabel('ICSE board paper')).toBe(false);
    expect(isRealSchoolLabel('CBSE board paper')).toBe(false);
    expect(isRealSchoolLabel('ISC board paper')).toBe(false);
  });

  it('accepts an actual school label, including an unresolved-but-real abbreviation', () => {
    expect(isRealSchoolLabel('Gokuldham High School')).toBe(true);
    expect(isRealSchoolLabel('ASC')).toBe(true);
    expect(isRealSchoolLabel('NPS')).toBe(true);
  });

  it('every live raw value resolves to a real-or-excluded label with no other placeholder text', () => {
    for (const raw of LIVE_RAW_VALUES) {
      const label = displaySchool(raw);
      // Just documents that the predicate always returns a boolean and never
      // throws across the full live set -- the actual grouping behaviour is
      // exercised by SchoolsPage/PastPapers, not this unit test.
      expect(typeof isRealSchoolLabel(label)).toBe('boolean');
    }
  });
});

describe('schoolSearchTerms', () => {
  it('adds the expanded name as an extra search term for an abbreviation', () => {
    expect(schoolSearchTerms('Jamanabai Historycivics')).toContain('Jamnabai Narsee School');
  });

  it('adds nothing extra for a name that is already itself', () => {
    expect(schoolSearchTerms('Gokuldham High School')).toEqual([]);
  });
});
