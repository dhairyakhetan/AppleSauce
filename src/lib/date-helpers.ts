// Shared date helpers for the student/guardian profile forms, which both store dates of birth as
// yyyy-mm-dd in the database but edit them as dd-mm-yyyy text inputs. Extracted from
// StudentDashboard.tsx/GuardianDashboard.tsx, where these four functions used to be duplicated
// verbatim.

/** Convert yyyy-mm-dd (or already-dd-mm-yyyy) to dd-mm-yyyy for display in the form. */
export function formatDateForDisplay(dateStr: string | null): string {
  if (!dateStr) return '';
  // If already in dd-mm-yyyy format, return as is
  if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) return dateStr;
  // If in yyyy-mm-dd format, convert to dd-mm-yyyy
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  }
  return dateStr;
}

/** Convert dd-mm-yyyy (or already-yyyy-mm-dd) to yyyy-mm-dd for saving to the database. */
export function formatDateForDatabase(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  // If in dd-mm-yyyy format, convert to yyyy-mm-dd
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
  // If already in yyyy-mm-dd format, return as is
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
  return null;
}

/** Validate a dd-mm-yyyy date string, including calendar validity (e.g. rejects 31 Feb). */
export function isValidDateFormat(dateStr: string): boolean {
  if (!dateStr) return false;
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return false;

  const [, day, month, year] = match;
  const dayNum = parseInt(day, 10);
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  // Basic validation
  if (monthNum < 1 || monthNum > 12) return false;
  if (dayNum < 1 || dayNum > 31) return false;
  if (yearNum < 1900 || yearNum > 2100) return false;

  // Check if date is valid (e.g., not 31 Feb)
  const date = new Date(yearNum, monthNum - 1, dayNum);
  return (
    date.getFullYear() === yearNum &&
    date.getMonth() === monthNum - 1 &&
    date.getDate() === dayNum
  );
}

/** Format raw keystrokes into a dd-mm-yyyy mask as the user types. */
export function formatDateInput(value: string): string {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');

  // Limit to 8 digits (ddmmyyyy)
  const limitedDigits = digits.slice(0, 8);

  // Format as dd-mm-yyyy
  if (limitedDigits.length === 0) return '';
  if (limitedDigits.length <= 2) return limitedDigits;
  if (limitedDigits.length <= 4) return `${limitedDigits.slice(0, 2)}-${limitedDigits.slice(2)}`;
  return `${limitedDigits.slice(0, 2)}-${limitedDigits.slice(2, 4)}-${limitedDigits.slice(4)}`;
}
