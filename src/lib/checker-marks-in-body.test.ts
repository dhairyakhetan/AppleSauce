import { describe, expect, it } from 'vitest';

import { findMarksInBody, hasMarksInBody, moveMarksOut, MARKS_INSIDE_HINT, MARKS_MOVE_BUTTON } from './checker-body';

/* Owner, 11 Oct 2026: "the marks is right there in the square bracket ... these
   are patterns that you need to fix". Moving the marks out cuts exactly the
   marks token and nothing else, so every case below also puts the token back
   and expects the original text. */

function roundTrips(body: string) {
  const hit = findMarksInBody(body)!;
  expect(hit).not.toBeNull();
  const moved = moveMarksOut(body)!;
  expect(moved.body + '').toBe(body.slice(0, hit.start) + body.slice(hit.end));
  // Putting the token back where it was gives the original, byte for byte.
  expect(moved.body.slice(0, hit.start) + moved.token + moved.body.slice(hit.start)).toBe(body);
  return moved;
}

describe('findMarksInBody', () => {
  it('finds a plain [3] at the end', () => {
    const moved = roundTrips('Find the value of x. [3]');
    expect(moved.marks).toBe(3);
    expect(moved.token).toBe('[3]');
    expect(moved.body).toBe('Find the value of x. ');
  });

  it('finds spaced and worded brackets', () => {
    expect(findMarksInBody('Name the planet. [ 1 ]')?.marks).toBe(1);
    expect(findMarksInBody('Name the planet. [2 marks]')?.marks).toBe(2);
    expect(findMarksInBody('Name the planet. [1 mark]')?.marks).toBe(1);
    expect(findMarksInBody('Name the planet. (2 marks)')?.marks).toBe(2);
    expect(findMarksInBody('Name the planet. [1.5]')?.marks).toBe(1.5);
  });

  it('finds the multiplication form and takes the total after the equals sign', () => {
    for (const body of [
      'Answer all ten. [1 x 10 = 10]',
      'Answer all ten. [1 × 10 = 10]',
      'Answer all ten. [1 \\times 10 = 10]',
    ]) {
      expect(findMarksInBody(body)?.marks).toBe(10);
      roundTrips(body);
    }
  });

  it('removes the dollar signs with a maths-wrapped token, and only those', () => {
    const body = 'Answer all ten. $[1 \\times 10 = 10]$';
    const moved = roundTrips(body);
    expect(moved.token).toBe('$[1 \\times 10 = 10]$');
    expect(moved.marks).toBe(10);
    expect(moved.body).toBe('Answer all ten. ');
    const paren = roundTrips('Find x. \\([3]\\)');
    expect(paren.marks).toBe(3);
    expect(roundTrips('Find x. $[3]$').body).toBe('Find x. ');
  });

  it('keeps every other character, trailing space and newlines included', () => {
    const body = 'Line one\nLine two with $x^2$ and a  double  space.  [4]\n';
    const moved = roundTrips(body);
    expect(moved.body).toBe('Line one\nLine two with $x^2$ and a  double  space.  \n');
    expect(moved.marks).toBe(4);
  });

  it('works when the body is only the token', () => {
    const moved = roundTrips('[2]');
    expect(moved.body).toBe('');
    expect(moved.marks).toBe(2);
  });

  it('leaves a body alone when there is more than one marks token (marks for each part)', () => {
    const body = '(i) Draw a bar graph. [2]\n(ii) Which class planted the fewest? [1]';
    expect(findMarksInBody(body)).toBeNull();
    expect(moveMarksOut(body)).toBeNull();
  });

  it('leaves a body alone when the token is not the last thing in the text', () => {
    expect(findMarksInBody('[3] Find the value of x.')).toBeNull();
    expect(findMarksInBody('Find x [3] and then y.')).toBeNull();
  });

  it('is not fooled by code, arrays, lists or intervals', () => {
    expect(findMarksInBody('Declare the array: int marks[5]')).toBeNull();
    expect(findMarksInBody('Evaluate f(x)[2]')).toBeNull();
    expect(findMarksInBody('Solve for x in [1, 3]')).toBeNull();
    expect(findMarksInBody('Name the element [Cu]')).toBeNull();
  });

  it('ignores numbers that cannot be marks', () => {
    expect(findMarksInBody('Find x. [0]')).toBeNull();
    expect(findMarksInBody('Find x. [1000]')).toBeNull();
    expect(findMarksInBody('Find x. [250]')).toBeNull();
  });

  it('handles empty and missing bodies', () => {
    for (const b of ['', null, undefined, '   ']) {
      expect(findMarksInBody(b)).toBeNull();
      expect(hasMarksInBody(b)).toBe(false);
    }
    expect(moveMarksOut('')).toBeNull();
  });

  it('never throws on odd input', () => {
    for (const b of ['$', '[', '[]', '$[$', '\\(', '[1 x = 3]', '$$[3]$$']) {
      expect(() => findMarksInBody(b)).not.toThrow();
    }
  });
});

describe('marks hint copy', () => {
  it('is plain, names the Marks box and has no em or en dashes', () => {
    expect(MARKS_INSIDE_HINT).toBe('The marks are inside the text. Move them to the Marks box.');
    expect(MARKS_MOVE_BUTTON).toBe('Move marks out');
    expect(MARKS_INSIDE_HINT + MARKS_MOVE_BUTTON).not.toMatch(/[–—]/);
  });
});
