/**
 * Convert a number to its Roman numeral representation
 * @param num - The number to convert (1-12 for class numbers)
 * @returns The Roman numeral string (I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII)
 */
export function numberToRoman(num: number): string {
  const romanMap: Record<number, string> = {
    1: 'I',
    2: 'II',
    3: 'III',
    4: 'IV',
    5: 'V',
    6: 'VI',
    7: 'VII',
    8: 'VIII',
    9: 'IX',
    10: 'X',
    11: 'XI',
    12: 'XII',
  };

  return romanMap[num] || num.toString();
}

const ROMAN_TO_NUMBER: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
};

/**
 * The reverse of numberToRoman: bank_papers.cls stores class as a Roman
 * numeral ("IX", "X", ...) for numeric classes, so any facet that needs to
 * sort or range-display bank classes numerically (SchoolPage's "Classes IX
 * to XII" summary line) needs this to get a number back out. Returns NaN for
 * anything outside I-XII (including non-numeric values like "UG"), same
 * failure signal Number() gives its callers.
 */
export function romanToNumber(roman: string): number {
  return ROMAN_TO_NUMBER[roman.trim().toLowerCase()] ?? NaN;
}

/**
 * Whether an Arabic-numeral class filter value (e.g. "10", "UG", from the
 * filter_classes chips in FilterGroups.tsx) matches a bank_papers.cls value.
 *
 * bank_papers.cls stores class as a ROMAN numeral for numeric classes ("X",
 * "XII", ...) but keeps non-numeric values (like "UG") as-is. The filter UI
 * only ever offers Arabic numerals, so a numeric filter value is converted to
 * its Roman form before comparing; anything else falls back to a plain
 * case-insensitive match. This does NOT apply to the `papers` (18-row) table,
 * whose `class` column is already Arabic-numeral native.
 */
export function bankClassMatches(filterValue: string, bankClass: string): boolean {
  const num = parseInt(filterValue, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= 12 && String(num) === filterValue.trim()) {
    return bankClass.trim().toLowerCase() === numberToRoman(num).toLowerCase();
  }
  return filterValue.trim().toLowerCase() === bankClass.trim().toLowerCase();
}

/**
 * Convert a comma-separated string of numbers to Roman numerals with ranges
 * Example: "5,6,7" -> "V - VII"
 * Example: "11,12,UG" -> "XI - XII, UG"
 * @param numbersStr - Comma-separated string of numbers and other values (like UG)
 * @returns Formatted string with ranges and Roman numerals
 */
export function convertClassesToRoman(numbersStr: string | null): string | null {
  if (!numbersStr || numbersStr.trim() === '') {
    return null;
  }

  const parts = numbersStr.split(',').map((n) => n.trim()).filter((n) => n !== '');
  const numbers: number[] = [];
  const nonNumbers: string[] = [];

  // Separate numbers and non-numbers (like UG)
  parts.forEach((part) => {
    const num = parseInt(part, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) {
      numbers.push(num);
    } else {
      nonNumbers.push(part);
    }
  });

  // Sort numbers
  numbers.sort((a, b) => a - b);

  const result: string[] = [];

  // Convert consecutive numbers to ranges
  if (numbers.length > 0) {
    let rangeStart = numbers[0];
    let rangeEnd = numbers[0];

    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] === rangeEnd + 1) {
        // Consecutive number, extend range
        rangeEnd = numbers[i];
      } else {
        // Gap found, output current range and start new one
        if (rangeStart === rangeEnd) {
          result.push(numberToRoman(rangeStart));
        } else {
          result.push(`${numberToRoman(rangeStart)} - ${numberToRoman(rangeEnd)}`);
        }
        rangeStart = numbers[i];
        rangeEnd = numbers[i];
      }
    }

    // Output final range
    if (rangeStart === rangeEnd) {
      result.push(numberToRoman(rangeStart));
    } else {
      result.push(`${numberToRoman(rangeStart)} - ${numberToRoman(rangeEnd)}`);
    }
  }

  // Add non-numeric values (like UG)
  result.push(...nonNumbers);

  const joined = result.length > 0 ? result.join(', ') : null;
  // Prefix with "Class " so display reads e.g. "Class I - V, UG"
  return joined ? `Class ${joined}` : null;
}

