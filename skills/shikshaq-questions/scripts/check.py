#!/usr/bin/env python3
"""Check Shikshaq question blocks before they are pasted into shikshaq.in/games.

Usage: python3 check.py questions.txt     (or pipe the text in: python3 check.py < questions.txt)

It applies the main rules of the site's checker (src/lib/games/format.ts in the Shikshaq repo) and prints every
problem with its line number. The site has the final say: it also checks the chapter list, which this script can't see.
Plain Python 3, no packages needed.
"""
import re
import sys
import unicodedata

MAX_QUESTION, MAX_ANSWER, MAX_WORDS, MAX_ALSO = 300, 100, 6, 5
MIN_OPTIONS, MAX_OPTIONS, MAX_PER_TOPIC, MAX_PER_CHAPTER = 3, 5, 30, 80
LEVELS = ('easy', 'medium', 'hard')
LABELS = ('q', 'a', 'also', 'fill', 'wrong', 'level')

BLANK = re.compile(r'_{3,}')
NEEDS_MORE = re.compile(r"\b(?:of|among|from) the following\b|\bwhich of these\b|\bthe above\b|\b(?:given|shown|mentioned|stated|listed) (?:above|below)\b", re.I)
NEEDS_PICTURE = re.compile(r"\b(?:in|from|see|refer to|using|use|study|observe|look at|according to) the (?:figure|diagram|picture|image|graph|map|passage|table|chart)\b|\b(?:figure|diagram|picture|image|graph|map|passage|table|chart) (?:given|shown|above|below)\b|\b(?:part|point|region|place) (?:labelled|labeled|marked) [A-Z0-9]\b", re.I)
TRUE_FALSE_ASK = re.compile(r"^(?:state\s+)?(?:whether\s+)?(?:true\s+or\s+false|t\s*/\s*f|true\s*/\s*false)\b|\(\s*(?:true\s*(?:or|/)\s*false|t\s*/\s*f)\s*\)|\btrue\s+or\s+false\s*[:?]", re.I)
POSITIONAL = re.compile(r"^(?:all|none|both|neither)\b.*\b(?:above|these|of them|a and b|options?)\b|^(?:both|neither)\s+\(?[a-d]\)?\s+(?:and|nor)\s+\(?[a-d]\)?$", re.I)
BRACKETED = re.compile(r"\s([(\[][^)\]]*[^\W\d_]{2,}[^)\]]*[)\]])")
DETAIL = re.compile(r"^(board|class|subject)\s*:\s*(.*)$|^(chapter|topic)\s*(\d+)\s*[:.\-]\s*(.+)$", re.I)
LABEL = re.compile(r"^(q|a|also|fill|wrong|level)\s*:\s*(.*)$", re.I)
NEAR = re.compile(r"^(?:question|ques|ans|answer|options?|choices?|distractors?|difficulty|blank|sentence|fill in(?: the blanks?)?)\s*[.):\-]", re.I)
FENCE = re.compile(r"^\s*(```|~~~)")


def is_latin_mark(prev, ch):
    return unicodedata.category(ch).startswith('M') and prev and 'LATIN' in unicodedata.name(prev, '')


def unaccent(s):
    out, prev = [], ''
    for ch in unicodedata.normalize('NFKD', s):
        if not is_latin_mark(prev, ch):
            out.append(ch)
        if not unicodedata.category(ch).startswith('M'):
            prev = ch
    return unicodedata.normalize('NFC', ''.join(out))


def loose(s):
    s = unaccent(s).lower()
    return ' '.join(re.findall(r"[^\W_]+", s))


TOKEN = re.compile(r"-?\d+(?:,\d{2,3})*(?:[.:/]\d+)*|[^\W_]+|[^\s\w.,;:!?'\"`\-()\[\]{}]")


def keys(s):
    t = unaccent(s).lower().replace('−', '-').replace('–', '-').replace('—', '-')
    toks = [re.sub(r"(\d),(?=\d)", r"\1", x) if x[:1].isdigit() or x[:2].lstrip('-')[:1].isdigit() else x for x in TOKEN.findall(t)]
    if not toks:
        return set()

    def join(ts):
        out = ''
        for i, x in enumerate(ts):
            num = x.lstrip('-')[:1].isdigit()
            prev_num = i and ts[i - 1].lstrip('-')[:1].isdigit()
            out += ('|' + x) if (i and num and prev_num) else x
        return out
    ks = {join(toks)}
    if len(toks) > 1 and toks[0] in ('a', 'an', 'the'):
        ks.add(join(toks[1:]))
    return ks


def same_answer(a, b):
    return bool(keys(a) & keys(b))


def is_true_false(a):
    return a.strip().lower() in ('true', 'false')


def shows(text, answers):
    t = f' {loose(text)} '
    for a in answers:
        la = loose(a)
        if re.search(r'[^\W\d_]', la) and len(la) > 1 and not is_true_false(a) and f' {la} ' in t:
            return a
    return None


def words(s):
    return len(s.split())


def typeable(s):
    for ch in s:
        if ch.isalpha() or unicodedata.category(ch).startswith('M') or ch.isspace():
            continue
        if unicodedata.category(ch) == 'Nd' or (32 <= ord(ch) < 127) or ch in '₹‘’“”–—−':
            continue
        return False
    return True


def clean(v):
    t = re.sub(r'\s+', ' ', v).strip()
    m = re.match(r'^(\*\*|`|"|“)(.+)(\*\*|`|"|”)$', t)
    if m and (('”' if m.group(1) == '“' else m.group(1)) == m.group(3)):
        t = m.group(2).strip()
    return t


def check(text):
    problems = []
    say = lambda line, msg: problems.append((line, msg))
    lines = text.splitlines()
    fenced = any(FENCE.match(l) for l in lines)
    in_fence = False
    ctx = {'board': None, 'class': None, 'subject': None, 'chapter': None, 'topic': None}
    blocks, block = [], None

    def close():
        nonlocal block
        if block:
            blocks.append(block)
        block = None

    for i, raw in enumerate(lines, 1):
        t = raw.strip()
        if not t:
            continue
        if FENCE.match(t):
            in_fence = not in_fence
            continue
        t2 = re.sub(r'^(?:[-*•▪◦·]\s+|\d{1,3}[.)]\s+)', '', t)
        t2 = re.sub(r'^\*\*([^*]{1,8}?)\*\*', r'\1', t2)
        m = LABEL.match(t2)
        if m:
            key, val = m.group(1).lower(), clean(m.group(2))
            if key == 'q':
                close()
                block = {'line': i, 'q': val, 'also': [], 'ctx': dict(ctx)}
                continue
            if not block:
                say(i, f'This {key.capitalize()}: line has no Q: line above it.')
                continue
            if key == 'also':
                block['also'].append((val, i))
            elif key in block:
                say(i, f'This question already has a {key.capitalize()}: line. Keep one.')
            else:
                block[key] = (val, i)
            continue
        d = DETAIL.match(t)
        if d:
            close()
            if d.group(1):
                k = d.group(1).lower()
                ctx[k] = d.group(2).strip() or None
                if not ctx[k]:
                    say(i, f'The {k.capitalize()} line is empty.')
            else:
                k = d.group(3).lower()
                ctx[k] = (int(d.group(4)), d.group(5).strip())
                if k == 'chapter':
                    ctx['topic'] = None
            continue
        if fenced and not in_fence and not NEAR.match(t2):
            close()  # a chatbot's own sentence around its code block: the page leaves it out
            continue
        if re.match(r'^\(?[a-dA-D][.)]\s+\S', t):
            say(i, 'Don\'t list options as a), b), c). Put the wrong options on one Wrong: line, separated by ";".')
        elif NEAR.match(t2):
            say(i, 'Write the label as Q:, A:, Also:, Fill:, Wrong: or Level: (with a colon).')
        elif re.match(r'^[^\s:]{1,15}\s*:', t) and not re.match(r'^[A-Za-z\d\s*_#-]+:', t):
            say(i, 'Write the labels in English: Q:, A:, Also:, Fill:, Wrong:, Level:.')
        elif re.match(r'^#{1,6}\s', t):
            say(i, 'Headings aren\'t read. Write "Topic 2: Name", or leave it out.')
        elif block:
            say(i, 'This line isn\'t part of the question. A question or answer must fit on one line.')
        else:
            say(i, 'Start each question with Q:, and its answer on the next line with A:.')
    close()

    seen, per_topic, per_chapter = {}, {}, {}
    for b in blocks:
        n, q, c = b['line'], b['q'], b['ctx']
        a, a_line = b.get('a', ('', n))
        also = [v for v, _ in b['also']]
        tf = is_true_false(a)
        for k in ('board', 'class', 'subject', 'chapter'):
            if not c[k]:
                say(n, f'No {k.capitalize()} line above this question.')
        if not c['topic']:
            say(n, 'No "Topic N: Name" line above this question.')
        if not q:
            say(n, 'The question is empty.')
        if len(q) > MAX_QUESTION:
            say(n, f'The question is longer than {MAX_QUESTION} characters.')
        for text, line, what in ((q, n, 'question'), (b.get('fill', ('', 0))[0], b.get('fill', ('', 0))[1], 'Fill sentence')):
            if text and NEEDS_MORE.search(text):
                say(line, f'The {what} must make sense on its own: no "of the following", "which of these", "the above", "given below".')
            if text and NEEDS_PICTURE.search(text):
                say(line, f'The {what} can\'t use a figure, diagram, map, table or passage.')
        if TRUE_FALSE_ASK.search(q):
            say(n, 'Write only the statement after Q:; "A: True" or "A: False" says the rest.')
        if len(BLANK.findall(q)) > 1:
            say(n, 'Only one ___ in a question.')
        yes_no = bool(re.match(r'^(yes|no)[.!]?$', a, re.I))
        if 'a' not in b:
            say(n, 'No A: line.')
        elif not a:
            say(a_line, 'The answer is empty.')
        else:
            if re.match(r'^(true|false)[.!]$', a, re.I):
                say(a_line, f'Write the answer as {a[:-1]}, with nothing after it.')
            if len(a) > MAX_ANSWER:
                say(a_line, f'The answer is longer than {MAX_ANSWER} characters.')
            elif words(a) > MAX_WORDS:
                say(a_line, f'The answer has {words(a)} words: at most {MAX_WORDS}. Put the rest in the question.')
            if yes_no:
                say(a_line, 'Yes or No can\'t be an answer. Write a statement after Q: and A: True or A: False.')
            if re.search(r'\s/\s', a):
                say(a_line, 'One answer after A:; put each other answer on its own Also: line.')
            if BRACKETED.search(a):
                say(a_line, 'No brackets in the answer: move another answer to an Also: line, or drop the note.')
            if BLANK.search(a):
                say(a_line, 'No ___ in the answer.')
            if not typeable(a) and not any(typeable(x) for x in also):
                say(a_line, 'Students can\'t type a symbol in the answer: put a unit in the question, or add an Also: line typed with ordinary keys (x^2, sqrt 3).')
            hit = shows(q, [a] + also)
            if q and hit:
                say(n, f'The question shows the answer ("{hit}"). Rewrite it without it.')
        for k, (v, line) in enumerate(b['also']):
            if k == MAX_ALSO:
                say(line, f'At most {MAX_ALSO} Also: lines.')
            if not v:
                say(line, 'This Also: line is empty.')
            elif ';' in v:
                say(line, 'One answer per Also: line.')
            elif len(v) > MAX_ANSWER or words(v) > MAX_WORDS:
                say(line, f'This Also answer is too long: at most {MAX_WORDS} words.')
            elif a and same_answer(v, a):
                say(line, 'This is the same as the answer (case, spaces, punctuation and "the" don\'t matter). Leave it out.')
            elif any(same_answer(v, y) for y in also[:k]):
                say(line, 'This Also answer is written twice.')
        if 'fill' in b:
            f, line = b['fill']
            nb = len(BLANK.findall(f))
            if tf:
                say(line, 'A True/False question has no Fill: line.')
            elif nb == 0:
                say(line, 'The Fill sentence needs ___ (three underscores) where the answer goes.')
            elif nb > 1:
                say(line, 'Only one ___ in the Fill sentence.')
            elif words(BLANK.sub(' ', f)) < 3:
                say(line, 'Write the whole Fill sentence: at least 3 other words around the ___.')
            elif a and shows(BLANK.sub(' ', f), [a] + also):
                say(line, 'The Fill sentence shows the answer: the ___ must stand for the whole answer.')
            if len(f) > MAX_QUESTION:
                say(line, f'The Fill sentence is longer than {MAX_QUESTION} characters.')
        elif q and 'a' in b and not tf and not yes_no and len(BLANK.findall(q)) != 1:
            say(n, 'No Fill: line. Add the same fact as a sentence with ___ where the answer goes.')
        if 'wrong' in b:
            raw_w, line = b['wrong']
            ws = [clean(x) for x in raw_w.split(';') if clean(x)]
            kind = lambda s: 'words' if re.search(r'[^\W\d_]', s) else 'number'
            if tf:
                say(line, 'A True/False question has no Wrong: line.')
            elif len(ws) < MIN_OPTIONS and len(ws) == 1 and ',' in ws[0]:
                say(line, 'Separate the wrong options with ";", not commas.')
            elif len(ws) < MIN_OPTIONS:
                say(line, f'Write at least {MIN_OPTIONS} wrong options, separated by ";".')
            elif len(ws) > MAX_OPTIONS:
                say(line, f'At most {MAX_OPTIONS} wrong options.')
            elif any(len(o) > MAX_ANSWER or words(o) > MAX_WORDS for o in ws):
                say(line, f'A wrong option is too long: at most {MAX_WORDS} words.')
            elif any(same_answer(o, p) for k, o in enumerate(ws) for p in ws[:k]):
                say(line, 'The same wrong option is written twice.')
            elif any(a and same_answer(o, x) for o in ws for x in [a] + also if x):
                say(line, 'A wrong option counts as the answer.')
            elif any(POSITIONAL.search(o) for o in ws):
                say(line, 'No "All of the above" or "Both A and B": the options are shuffled.')
            elif a and any(all(kind(x) != kind(o) for x in [a] + also) for o in ws):
                say(line, 'The wrong options must be the same kind as the answer (numbers for a number, words for words).')
        elif q and 'a' in b and not tf and not yes_no:
            say(n, 'No Wrong: line (3 to 5 wrong options, separated by ";"). The page lets it through, but the question then has no multiple choice.')
        if 'level' in b:
            if b['level'][0].lower() not in LEVELS:
                say(b['level'][1], 'The level must be easy, medium or hard.')
        else:
            say(n, 'No Level: line (easy, medium or hard). The page lets it through, but every question should have one.')
        chap = (c['board'], c['class'], c['subject'], c['chapter'])
        key = (chap, re.sub(r'\s+', ' ', re.sub(r'[\s?.!:;,।]+$', '', q.lower())))
        if q and key in seen:
            say(n, f'Same question as line {seen[key]}. Leave one of them out.')
        elif q:
            seen[key] = n
        tk = (chap, c['topic'])
        per_topic[tk] = per_topic.get(tk, 0) + 1
        per_chapter[chap] = per_chapter.get(chap, 0) + 1
        if c['topic'] and per_topic[tk] == MAX_PER_TOPIC + 1:
            say(n, f'More than {MAX_PER_TOPIC} questions in this topic from here on.')
        if per_chapter[chap] == MAX_PER_CHAPTER + 1:
            say(n, f'More than {MAX_PER_CHAPTER} questions in this chapter from here on.')
    return blocks, sorted(problems)


def main():
    text = open(sys.argv[1], encoding='utf-8').read() if len(sys.argv) > 1 else sys.stdin.read()
    blocks, problems = check(text)
    for line, msg in problems:
        print(f'Line {line}: {msg}')
    if problems:
        print(f'\n{len(problems)} problem(s) in {len(blocks)} question(s). Fix them and run this again.')
        sys.exit(1)
    print(f'No problems: {len(blocks)} question(s).')


if __name__ == '__main__':
    main()
