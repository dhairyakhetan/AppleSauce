import { APPROVED_PAGE, BATCH_MAX, type GamesApi, type SaveResult, type SendResult } from '@/lib/games/api';
import { chapterId, checkBoard, checkSubject, pad2, topicId } from '@/lib/games/details';
import { format } from '@/lib/games/format';
import type { Bank, BankQuestion, Batch, ListChapter, Person, RoleCheck, Row, SentBack, Status } from '@/lib/games/rows';

/* The games pages in dummy mode (D75): an in-memory stand-in for the `games` schema, with no sign-in. It keeps the
   same rules as the database: who may do what, duplicates skipped, questions numbered within their topic and never
   renumbered, a sent-back question not sent again unchanged, batch IDs by the day. Test builds only, reached solely
   through the PREVIEW_TOOLS-gated lazy import in pages/Games.tsx.

   Every question and name below is made up for the preview; none is copied from a real paper. */

/** The dummy "you". Which role you have is switched from the dummy banner. */
export const DUMMY_ME = { email: 'you@example.com', name: 'You (dummy)' };

interface FakeQuestion extends BankQuestion { teacherEmail: string; reviewedBy: string | null; seenAt: string | null }
interface State { team: Person[]; batches: Batch[]; questions: FakeQuestion[]; catalog: ListChapter[] }

const MODERATOR = { email: 'asha.rao@example.com', name: 'Asha Rao' };
const HOD = { email: 'vikram.singh@example.com', name: 'Vikram Singh' };
const ROHAN = { email: 'rohan.mehta@example.com', name: 'Rohan Mehta' };
const PRIYA = { email: 'priya.das@example.com', name: 'Priya Das' };

/** Approved: what "Try the games" plays with. Every question has each version the games use, as the prompt asks. */
const APPROVED_HEAT = `Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat

Topic 1: Hot and Cold

Q: Device used to measure how hot or cold something is
A: Thermometer
Fill: A ___ is used to measure how hot or cold something is.
Wrong: Barometer; Speedometer; Hygrometer
Level: easy

Q: Scale of temperature on the thermometers we use every day in India
A: Celsius
Fill: The thermometers we use every day measure temperature in degrees ___.
Wrong: Fahrenheit; Kelvin; Rankine
Level: easy

Q: Normal temperature of the human body, in degrees Celsius
A: 37
Fill: The normal temperature of the human body is ___ degrees Celsius.
Wrong: 35; 40; 98.6
Level: medium

Q: Thermometer that a doctor uses to check for fever
A: Clinical thermometer
Fill: A doctor checks for fever with a ___.
Wrong: Laboratory thermometer; Maximum-minimum thermometer; Barometer
Level: medium

Q: Thermometer used to measure the temperature of objects other than the human body
A: Laboratory thermometer
Fill: In an experiment, the temperature of hot water is measured with a ___.
Wrong: Clinical thermometer; Barometer; Anemometer
Level: medium

Q: Range of a clinical thermometer, in degrees Celsius
A: 35 to 42
Also: 35-42
Fill: A clinical thermometer reads temperatures from ___ degrees Celsius.
Wrong: 0 to 100; -10 to 110; 30 to 50
Level: hard

Q: Mercury is used in thermometers because it expands evenly when heated
A: True
Level: easy

Topic 2: Transfer of Heat

Q: Transfer of heat through a solid from its hotter end to its colder end
A: Conduction
Fill: Heat travels along a metal spoon kept in hot tea by ___.
Wrong: Convection; Radiation; Evaporation
Level: medium

Q: Transfer of heat by the movement of a heated liquid or gas
A: Convection
Fill: Water in a pan heats up all through by ___ currents.
Wrong: Conduction; Radiation; Condensation
Level: medium

Q: Transfer of heat that needs no material to travel through
A: Radiation
Fill: Heat from the Sun reaches the Earth by ___.
Wrong: Conduction; Convection; Reflection
Level: medium

Q: Material that lets heat pass through it easily
A: Conductor
Also: Good conductor
Fill: A material such as copper, which lets heat pass through it easily, is called a ___.
Wrong: Insulator; Magnet; Reflector
Level: easy

Q: Material that does not let heat pass through it easily
A: Insulator
Also: Poor conductor
Fill: Pan handles are made of wood or plastic because each is an ___ of heat.
Wrong: Conductor; Magnet; Mirror
Level: easy

Q: Colour of clothes that takes in the most heat from the Sun
A: Black
Also: Dark
Fill: In summer we avoid ___ clothes because they take in the most heat from the Sun.
Wrong: White; Yellow; Light blue
Level: easy

Q: Woollen clothes keep us warm because of what is trapped between their fibres
A: Air
Fill: Woollen clothes keep us warm because the ___ trapped between their fibres is a poor conductor of heat.
Wrong: Water; Dust; Sweat
Level: medium

Q: Heat always flows from a hotter object to a colder one
A: True
Level: easy

Topic 3: Sea and Land Breezes

Q: Cool wind that blows from the sea towards the land during the day
A: Sea breeze
Fill: During the day a ___ blows from the sea towards the land.
Wrong: Land breeze; Monsoon wind; Trade wind
Level: medium

Q: Wind that blows from the land towards the sea at night
A: Land breeze
Fill: At night a ___ blows from the land towards the sea.
Wrong: Sea breeze; Monsoon wind; Cyclone
Level: medium

Q: Moving air caused by the uneven heating of the Earth's surface
A: Wind
Fill: Uneven heating of the Earth's surface causes ___.
Wrong: Rain; Fog; Dew
Level: easy

Q: What warm air does, because it is lighter than the cool air around it
A: Rises
Also: Goes up
Fill: Air becomes lighter when it is heated, so it ___.
Wrong: Sinks; Freezes; Stops
Level: easy

Q: Places near the sea have milder weather than places far from it
A: True
Level: medium`;

const APPROVED_LANDFORMS = `Board: ICSE
Class: 6
Subject: Geography
Chapter 2: Landforms of the Earth

Topic 1: Mountains

Q: Landform that rises steeply far above the land around it, with a narrow peak
A: Mountain
Fill: A ___ rises steeply far above the land around it.
Wrong: Plateau; Plain; Valley
Level: easy

Q: Long chain of mountains joined together
A: Mountain range
Also: Range
Fill: The Himalayas are a ___, a long chain of mountains joined together.
Wrong: Plateau; Delta; Valley
Level: easy

Q: Highest mountain range in the world
A: Himalayas
Fill: The ___ are the highest mountain range in the world.
Wrong: Alps; Andes; Rockies
Level: easy

Q: Highest mountain peak in the world
A: Mount Everest
Also: Everest
Fill: ___ is the highest mountain peak in the world.
Wrong: Kanchenjunga; K2; Nanda Devi
Level: easy

Q: Mountains formed when layers of rock are pushed together and folded
A: Fold mountains
Fill: The Himalayas and the Alps are ___, formed when layers of rock were pushed together.
Wrong: Block mountains; Volcanic mountains; Residual mountains
Level: medium

Q: Mountain built up from lava and ash that pour out of an opening in the Earth's crust
A: Volcano
Also: Volcanic mountain
Fill: Mount Fuji in Japan is a ___, built up from lava and ash.
Wrong: Fold mountain; Block mountain; Plateau
Level: medium

Q: The Aravalli range is one of the oldest mountain ranges in the world
A: True
Level: hard

Topic 2: Plateaus and Plains

Q: Raised area of land with a flat top that stands well above the land around it
A: Plateau
Also: Tableland
Fill: A ___ is a raised area of land with a flat top.
Wrong: Plain; Valley; Delta
Level: easy

Q: Large plateau in southern India, between the Western and Eastern Ghats
A: Deccan Plateau
Also: Deccan
Fill: The ___ lies between the Western Ghats and the Eastern Ghats.
Wrong: Chota Nagpur Plateau; Malwa Plateau; Tibetan Plateau
Level: medium

Q: Large stretch of flat, low land
A: Plain
Fill: A ___ is a large stretch of flat, low land.
Wrong: Plateau; Mountain; Hill
Level: easy

Q: Fine soil carried and laid down by rivers that makes plains fertile
A: Silt
Also: Alluvium
Fill: Rivers lay down fine ___ on their plains, making the land fertile.
Wrong: Sand; Lava; Gravel
Level: medium

Q: Landform made where a river splits into many streams before it meets the sea
A: Delta
Fill: The Ganga and the Brahmaputra form the world's largest ___ before they meet the sea.
Wrong: Estuary; Plateau; Gorge
Level: medium

Q: Land along a river that is covered with water when the river floods
A: Floodplain
Fill: Land along a river that is covered with water when the river floods is called its ___.
Wrong: Delta; Plateau; Valley
Level: hard

Q: Most of the world's people live on plains
A: True
Level: medium`;

const APPROVED_TRADE = `Board: CBSE
Class: 8
Subject: History
Chapter 2: From Trade to Territory

Topic 1: The East India Company Comes East

Q: Year in which the East India Company received a charter from Queen Elizabeth I
A: 1600
Fill: The East India Company received a royal charter in ___.
Wrong: 1498; 1757; 1857
Level: medium

Q: Portuguese sailor who reached India by sea in 1498
A: Vasco da Gama
Fill: In 1498, ___ found the sea route from Europe to India.
Wrong: Christopher Columbus; Ferdinand Magellan; Bartolomeu Dias
Level: easy

Q: River on whose banks the first English factory in Bengal was set up in 1651
A: Hooghly
Also: Hugli
Fill: The first English factory in Bengal was set up on the banks of the river ___ in 1651.
Wrong: Yamuna; Godavari; Narmada
Level: medium

Q: Order of the Mughal emperor in 1717 that let the Company trade in Bengal without paying duty
A: Farman
Also: Firman
Fill: In 1717 the Mughal emperor issued a ___ letting the Company trade without paying duty.
Wrong: Diwani; Subsidy; Treaty
Level: hard

Q: Cotton, silk and spices were among the goods the Company bought in India
A: True
Level: easy

Topic 2: From Trade to Wars

Q: Battle of 1757 in which Robert Clive defeated Sirajuddaula
A: Battle of Plassey
Also: Plassey
Fill: In 1757 Robert Clive defeated Sirajuddaula at the ___.
Wrong: Battle of Buxar; Battle of Panipat; Battle of Haldighati
Level: easy

Q: Nawab of Bengal defeated by the Company in 1757
A: Sirajuddaula
Also: Siraj-ud-daulah
Fill: In 1757 the Company defeated ___, the Nawab of Bengal.
Wrong: Mir Jafar; Murshid Quli Khan; Alivardi Khan
Level: medium

Q: Commander who helped the British win at Plassey and was then made Nawab
A: Mir Jafar
Fill: After Plassey the Company made ___ the Nawab of Bengal.
Wrong: Mir Qasim; Sirajuddaula; Tipu Sultan
Level: medium

Q: English officer who led the Company's army at Plassey
A: Robert Clive
Also: Clive
Fill: The Company's army at Plassey was led by ___.
Wrong: Warren Hastings; Lord Dalhousie; Lord Cornwallis
Level: easy

Q: Battle of 1764 after which the Company was given the Diwani of Bengal
A: Battle of Buxar
Also: Buxar
Fill: The Company's victory at the ___ in 1764 led to the Diwani of Bengal.
Wrong: Battle of Plassey; Battle of Wandiwash; Battle of Seringapatam
Level: medium

Q: Right to collect land revenue that the Mughal emperor granted the Company in 1765
A: Diwani
Fill: In 1765 the Mughal emperor made the Company the Diwan of Bengal, with the ___ of the province.
Wrong: Farman; Subsidy; Nizamat
Level: hard

Topic 3: Company Rule Expands

Q: Policy under which a kingdom passed to the Company if its ruler died without a male heir
A: Doctrine of Lapse
Fill: Under the ___, a kingdom passed to the Company if its ruler died without a male heir.
Wrong: Subsidiary Alliance; Permanent Settlement; Mahalwari system
Level: medium

Q: Governor-General who brought in the Doctrine of Lapse
A: Lord Dalhousie
Also: Dalhousie
Fill: The Doctrine of Lapse was brought in by ___.
Wrong: Lord Wellesley; Lord Cornwallis; Warren Hastings
Level: medium

Q: System under which an Indian ruler had to keep the Company's troops and pay for them
A: Subsidiary Alliance
Fill: Under the ___, Indian rulers had to pay for the British troops kept in their states.
Wrong: Doctrine of Lapse; Permanent Settlement; Ryotwari system
Level: medium

Q: Ruler of Mysore known as the Tiger of Mysore
A: Tipu Sultan
Also: Tipu
Fill: ___ was known as the Tiger of Mysore.
Wrong: Haidar Ali; Ranjit Singh; Shivaji
Level: easy

Q: Kingdom taken over by the Company in 1856, on the ground that it was badly governed
A: Awadh
Also: Oudh
Fill: In 1856 the Company took over ___, saying that it was being misgoverned.
Wrong: Jhansi; Satara; Nagpur
Level: hard

Q: Rani Lakshmibai lost the kingdom of Jhansi under the Doctrine of Lapse
A: True
Level: medium`;

const APPROVED_GEOMETRY = `Board: CBSE
Class: 6
Subject: Mathematics
Chapter 4: Basic Geometrical Ideas

Topic 1: Points, Lines and Rays

Q: Part of a line with two end points
A: Line segment
Also: Segment
Fill: A ___ is a part of a line that has two end points.
Wrong: Ray; Line; Point
Level: easy

Q: Part of a line that starts at a point and goes on endlessly in one direction
A: Ray
Fill: A ___ has one end point and goes on endlessly in one direction.
Wrong: Line segment; Line; Arc
Level: easy

Q: Number of lines that can be drawn through two given points
A: 1
Also: One
Fill: Through two given points, exactly ___ line can be drawn.
Wrong: 0; 2; 3
Level: medium

Q: Lines in a plane that never meet, however far they are extended
A: Parallel lines
Fill: Lines in a plane that never meet are called ___.
Wrong: Intersecting lines; Perpendicular lines; Curved lines
Level: easy

Q: Point where two lines cross each other
A: Point of intersection
Also: Intersection
Fill: Two lines that cross meet at their ___.
Wrong: Midpoint; Centre; End point
Level: medium

Q: Two lines that meet at a point are called intersecting lines
A: True
Level: easy

Topic 2: Polygons

Q: Polygon with three sides
A: Triangle
Fill: A ___ is a polygon with three sides.
Wrong: Quadrilateral; Pentagon; Hexagon
Level: easy

Q: Polygon with four sides
A: Quadrilateral
Fill: A polygon with four sides is called a ___.
Wrong: Triangle; Pentagon; Hexagon
Level: easy

Q: Point where two sides of a polygon meet
A: Vertex
Also: Corner
Fill: The point where two sides of a polygon meet is called a ___.
Wrong: Diagonal; Edge; Centre
Level: easy

Q: Line segment joining two vertices of a polygon that are not next to each other
A: Diagonal
Fill: A ___ joins two vertices of a polygon that are not next to each other.
Wrong: Side; Radius; Ray
Level: medium

Q: Number of diagonals of a quadrilateral
A: 2
Also: Two
Fill: A quadrilateral has ___ diagonals.
Wrong: 1; 3; 4
Level: medium

Q: A triangle has no diagonals
A: True
Level: medium

Topic 3: Circles

Q: Line segment from the centre of a circle to a point on the circle
A: Radius
Fill: A ___ joins the centre of a circle to a point on the circle.
Wrong: Diameter; Chord; Arc
Level: easy

Q: Chord that passes through the centre of a circle
A: Diameter
Fill: The longest chord of a circle, which passes through its centre, is called the ___.
Wrong: Radius; Arc; Tangent
Level: easy

Q: Distance around a circle
A: Circumference
Also: Perimeter
Fill: The distance around a circle is called its ___.
Wrong: Diameter; Area; Radius
Level: easy

Q: Part of a circle between two points on it
A: Arc
Fill: The part of a circle between two points on it is called an ___.
Wrong: Chord; Sector; Radius
Level: medium

Q: Diameter, in cm, of a circle whose radius is 5 cm
A: 10
Fill: A circle with a radius of 5 cm has a diameter of ___ cm.
Wrong: 5; 2.5; 25
Level: medium

Q: Every diameter of a circle is twice as long as its radius
A: True
Level: easy`;

/** Waiting for an HoD. */
const WAITING_CELL = `Board: CBSE
Class: 9
Subject: Science
Chapter 5: The Fundamental Unit of Life

Topic 1: The Cell

Q: Basic unit of structure and function of all living things
A: Cell
Fill: The ___ is the basic unit of structure and function of all living things.
Wrong: Tissue; Organ; Atom
Level: easy

Q: Scientist who first saw cells, in a thin slice of cork, in 1665
A: Robert Hooke
Also: Hooke
Fill: In 1665 ___ saw cells in a thin slice of cork.
Wrong: Robert Brown; Anton van Leeuwenhoek; Rudolf Virchow
Level: medium

Q: Jelly-like substance that fills the cell inside its membrane
A: Cytoplasm
Fill: The ___ is the jelly-like substance inside the cell membrane.
Wrong: Nucleus; Cell sap; Chlorophyll
Level: easy

Q: Part of the cell that controls all its activities
A: Nucleus
Fill: The ___ controls all the activities of the cell.
Wrong: Cytoplasm; Cell wall; Vacuole
Level: easy

Q: Movement of water through a selectively permeable membrane from a dilute solution to a concentrated one
A: Osmosis
Fill: A raisin kept in water swells up as water enters it by ___.
Wrong: Diffusion; Evaporation; Transpiration
Level: medium

Topic 2: Cell Organelles

Q: Organelles known as the powerhouses of the cell
A: Mitochondria
Also: Mitochondrion
Fill: The ___ release energy for the cell, which is why they are called its powerhouses.
Wrong: Ribosomes; Golgi apparatus; Lysosomes
Level: easy

Q: Organelles in plant cells where food is made using sunlight
A: Chloroplasts
Also: Chloroplast
Fill: Plants make food in their ___, which contain chlorophyll.
Wrong: Mitochondria; Vacuoles; Ribosomes
Level: medium

Q: Organelles that hold digestive enzymes and are called the suicide bags of the cell
A: Lysosomes
Also: Lysosome
Fill: ___ are called the suicide bags of the cell.
Wrong: Ribosomes; Plastids; Centrosomes
Level: hard

Q: Plant cells have a cell wall but animal cells do not
A: True
Level: easy`;

const WAITING_FLAME = `Board: CBSE
Class: 8
Subject: Science
Chapter 6: Combustion and Flame

Topic 1: Combustion

Q: Chemical process in which a substance reacts with oxygen and gives off heat
A: Combustion
Also: Burning
Fill: Wood reacting with oxygen and giving off heat and light is an example of ___.
Wrong: Condensation; Corrosion; Evaporation
Level: easy

Q: Lowest temperature at which a substance catches fire
A: Ignition temperature
Fill: A substance does not catch fire until it reaches its ___.
Wrong: Boiling point; Melting point; Freezing point
Level: medium

Q: Substance that is burnt to give heat
A: Fuel
Fill: Wood, coal and LPG are each a ___.
Wrong: Oxidant; Ash; Smoke
Level: easy

Q: Gas from the air that is needed for burning
A: Oxygen
Also: O2
Fill: A burning candle goes out when it is covered by a jar because the ___ inside runs out.
Wrong: Nitrogen; Carbon dioxide; Hydrogen
Level: easy

Q: Water is used to put out fires in electrical equipment
A: False
Level: medium

Topic 2: Flame

Q: Hottest zone of a candle flame
A: Outermost zone
Also: Non-luminous zone
Also: Outer zone
Fill: The ___ of a candle flame is the hottest part of it.
Wrong: Innermost zone; Middle zone; Luminous zone
Level: hard

Q: Colour of the outermost zone of a candle flame
A: Blue
Fill: The outermost zone of a candle flame is ___.
Wrong: Yellow; Black; Red
Level: medium

Q: Amount of heat a fuel gives when one kilogram of it burns completely
A: Calorific value
Fill: The heat given when 1 kg of a fuel burns completely is called its ___.
Wrong: Ignition temperature; Boiling point; Density
Level: hard`;

/** Sent back to you: what the notifications show. Both read well; what is wrong is the science, which only an HoD sees. */
const SENT_BACK_HEAT = `Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat

Topic 2: Transfer of Heat

Q: Process by which heat flows from a colder object to a hotter one
A: Conduction
Fill: Heat flows from a colder object to a hotter one by ___.
Wrong: Convection; Radiation; Evaporation
Level: medium

Topic 3: Sea and Land Breezes

Q: Wind that blows from the land towards the sea during the day
A: Land breeze
Fill: During the day a ___ blows from the land towards the sea.
Wrong: Sea breeze; Monsoon wind; Trade wind
Level: medium`;

/** Every made-up text, for the test that each one passes the checker. */
export const DUMMY_TEXTS = { APPROVED_HEAT, APPROVED_LANDFORMS, APPROVED_TRADE, APPROVED_GEOMETRY, WAITING_CELL, WAITING_FLAME, SENT_BACK_HEAT };

const NOTE_WRONG_WAY = 'Heat flows from a hotter object to a colder one, never the other way. Please rewrite the question.';
const NOTE_LAND_BREEZE = 'A land breeze blows at night. During the day the breeze comes from the sea.';

/** A chapter on the made-up list, with its topics numbered from 1. */
function listed(board: string, cls: number, subject: string, no: number, name: string, topics: string[]): ListChapter {
  const id = chapterId(checkBoard(board).code, cls, checkSubject(subject).code, no)!;
  return { chapter_id: id, board, class: cls, subject, chapter_no: no, name, topics: topics.map((t, i) => ({ topic_id: topicId(id, i + 1)!, topic_no: i + 1, name: t })) };
}
/** The made-up list of chapters and topics: the ones the made-up questions use, the formatter's example, one with no
 * questions yet, and one with no topics (its questions go without a Topic line). The real list comes from the database. */
export const DUMMY_LIST: ListChapter[] = [
  listed('ICSE', 6, 'Geography', 2, 'Landforms of the Earth', ['Mountains', 'Plateaus and Plains']),
  listed('CBSE', 6, 'Mathematics', 4, 'Basic Geometrical Ideas', ['Points, Lines and Rays', 'Polygons', 'Circles']),
  listed('CBSE', 8, 'History', 2, 'From Trade to Territory', ['The East India Company Comes East', 'From Trade to Wars', 'Company Rule Expands']),
  listed('CBSE', 7, 'Science', 4, 'Heat', ['Hot and Cold', 'Transfer of Heat', 'Sea and Land Breezes']),
  listed('CBSE', 7, 'Science', 5, 'Acids, Bases and Salts', ['Acids and Bases', 'Indicators', 'Neutralisation']),
  listed('CBSE', 8, 'Science', 6, 'Combustion and Flame', ['Combustion', 'Flame']),
  listed('CBSE', 7, 'Science', 2, 'Nutrition in Animals', []),
  listed('CBSE', 9, 'Science', 5, 'The Fundamental Unit of Life', ['The Cell', 'Cell Organelles']),
  listed('CBSE', 10, 'Science', 1, 'Chemical Reactions and Equations', ['Chemical Equations', 'Types of Chemical Reactions', 'Effects of Oxidation in Everyday Life']),
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
/** How the database compares two questions: case, extra spaces and punctuation at the end don't matter. */
const norm = (t: string) => t.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();
const indiaDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)).replace(/-/g, '');

function seed(): State {
  const s: State = {
    team: [
      { ...MODERATOR, role: 'admin', moderator: true, added_at: hoursAgo(24 * 30), last_seen_at: hoursAgo(5), name: MODERATOR.name },
      { ...HOD, role: 'hod', moderator: false, added_at: hoursAgo(24 * 20), last_seen_at: hoursAgo(2), name: HOD.name },
      { ...ROHAN, role: 'member', moderator: false, added_at: hoursAgo(24 * 10), last_seen_at: hoursAgo(26), name: ROHAN.name },
      { ...PRIYA, role: 'member', moderator: false, added_at: hoursAgo(24 * 3), last_seen_at: null, name: PRIYA.name },
      { ...DUMMY_ME, role: 'admin', moderator: false, added_at: hoursAgo(24 * 15), last_seen_at: hoursAgo(0.1) },
    ],
    batches: [],
    questions: [],
    catalog: structuredClone(DUMMY_LIST),
  };
  const put = (text: string, who: { email: string; name: string }, sentAt: string, status: Status, reviewedAt: string | null, note = '') => {
    const ids = add(s, format(text).rows, who, sentAt).ids;
    for (const q of s.questions) {
      if (!ids.includes(q.id)) continue;
      q.status = status;
      q.reviewedAt = reviewedAt;
      q.reviewedBy = status === 'pending' ? null : HOD.email;
      q.note = status === 'rejected' ? note : '';
    }
  };
  put(APPROVED_HEAT, ROHAN, hoursAgo(24 * 9), 'approved', hoursAgo(24 * 8));
  put(APPROVED_LANDFORMS, PRIYA, hoursAgo(24 * 7), 'approved', hoursAgo(24 * 6));
  put(APPROVED_TRADE, ROHAN, hoursAgo(24 * 5), 'approved', hoursAgo(24 * 4));
  put(APPROVED_GEOMETRY, PRIYA, hoursAgo(24 * 4), 'approved', hoursAgo(24 * 3));
  put(SENT_BACK_HEAT, DUMMY_ME, hoursAgo(30), 'rejected', hoursAgo(20));
  const [wrongWay, landBreeze] = s.questions.filter((q) => q.status === 'rejected');
  wrongWay.note = NOTE_WRONG_WAY;
  landBreeze.note = NOTE_LAND_BREEZE;
  put(WAITING_CELL, ROHAN, hoursAgo(3), 'pending', null);
  put(WAITING_FLAME, PRIYA, hoursAgo(1), 'pending', null);
  return s;
}

/** Adds rows as one batch, by the database's rules. */
function add(s: State, rows: Row[], who: { email: string; name: string }, at = new Date().toISOString()) {
  const day = indiaDay(at);
  const seq = s.batches.filter((b) => b.id.startsWith(`B${day}-`)).length + 1;
  const batch: Batch = { id: `B${day}-${pad2(seq)}`, by: who.name, email: who.email, at };
  const out = { ids: [] as string[], already: 0, sentBack: 0, sentBackIds: [] as string[] };
  const seen = new Set<string>();
  for (const r0 of rows) {
    const { problem, row: r } = onTheList(s.catalog, r0);
    if (problem) throw new Error(problem);
    const cid = r.chapter_id!;
    const key = `${cid}|${norm(r.question)}`;
    if (seen.has(key) || s.questions.some((x) => x.chapter_id === cid && norm(x.question) === norm(r.question) && x.status !== 'rejected')) {
      out.already++;
      continue;
    }
    seen.add(key);
    const back = s.questions.filter((x) => x.chapter_id === cid && x.status === 'rejected' && x.teacherEmail === who.email
      && norm(x.question) === norm(r.question) && norm(x.answer) === norm(r.answer)
      && JSON.stringify(x.also) === JSON.stringify(r.also.map((o) => o.trim())) && (x.fill ?? '') === (r.fill ?? '').trim()
      && JSON.stringify(x.wrong_options ?? []) === JSON.stringify((r.wrong_options ?? []).map((o) => o.trim())));
    if (back.length) {
      out.sentBack++;
      out.sentBackIds.push(...back.map((x) => x.id));
      continue;
    }
    const tno = r.topic_no ?? 0;
    const n = Math.max(0, ...s.questions.filter((x) => x.chapter_id === cid && (x.topic_no ?? 0) === tno).map((x) => x.question_no)) + 1;
    if (n > 999) {
      throw new Error(`${r.topic_no === null ? `Chapter ${r.chapter_no} ("${r.chapter}")` : `Topic ${r.topic_no} ("${r.topic}") of chapter ${r.chapter_no}`} already has 999 questions, the most it can hold. Nothing was sent.`);
    }
    const id = `${cid}T${pad2(tno)}Q${String(n).padStart(3, '0')}`;
    s.questions.push({
      ...r, line: 0, end: undefined, under: undefined, question: r.question.trim(), answer: r.answer.trim(), also: r.also.map((o) => o.trim()), fill: r.fill?.trim() || null,
      wrong_options: (r.wrong_options ?? []).map((o) => o.trim()), topic_id: r.topic_no === null ? null : `${cid}T${pad2(tno)}`, question_no: n,
      id, batch: batch.id, status: 'pending', note: '', reviewedAt: null, teacherEmail: who.email, reviewedBy: null, seenAt: null,
    });
    out.ids.push(id);
  }
  if (out.ids.length) s.batches.push(batch);
  return { batchId: out.ids.length ? batch.id : null, ...out };
}

/** The chapter and topic must be on the list (under its names, which are the ones kept), as in the database. */
function onTheList(catalog: ListChapter[], r: Row): { problem?: string; row: Row } {
  const ch = catalog.find((c) => c.chapter_id === r.chapter_id);
  if (!ch) return { problem: `Chapter ${r.chapter_no} (${r.board}, class ${r.class}, ${r.subject}) isn't on the list of chapters.`, row: r };
  if (norm(ch.name) !== norm(r.chapter)) return { problem: `Chapter ${ch.chapter_no} is called "${ch.name}" on the list, not "${r.chapter}".`, row: r };
  if (!ch.topics.length) {
    if (r.topic_no !== null) return { problem: `Chapter ${ch.chapter_no} ("${ch.name}") has no topics on the list, so its questions go without a topic line.`, row: r };
    return { row: { ...r, chapter: ch.name, topic: '' } };
  }
  if (r.topic_no === null) return { problem: `A question in chapter ${ch.chapter_no} ("${ch.name}") has no topic. Put it under one of the chapter's topics.`, row: r };
  const tp = ch.topics.find((t) => t.topic_no === r.topic_no);
  if (!tp) return { problem: `Chapter ${ch.chapter_no} ("${ch.name}") has no topic ${r.topic_no} on the list.`, row: r };
  if (norm(tp.name) !== norm(r.topic)) return { problem: `Topic ${r.topic_no} of chapter ${ch.chapter_no} is called "${tp.name}" on the list, not "${r.topic}".`, row: r };
  return { row: { ...r, chapter: ch.name, topic: tp.name } };
}

/** The board and subject must be on the site's lists and match the chapter ID's codes; other answers, the fill-in
 * sentence and wrong options as the database checks them. */
function codesProblem(r: Row): string | null {
  const board = checkBoard(r.board).code;
  const subject = checkSubject(r.subject).code;
  if (!board) return `The board "${r.board}" isn't on the site's list.`;
  if (!subject) return `The subject "${r.subject}" isn't on the site's list.`;
  if (!r.chapter_id?.startsWith(`${board}${pad2(r.class ?? 0)}${subject}`)) return 'A chapter ID doesn\'t match its board, class and subject.';
  const wrong = (r.wrong_options ?? []).map((o) => o.trim());
  if (wrong.length > 5) return `A question has more than 5 wrong options: "${r.question}".`;
  if (wrong.some((o) => !o || o.length > 100)) return `A wrong option is empty or longer than 100 characters: "${r.question}".`;
  if (wrong.some((o) => norm(o) === norm(r.answer))) return `A wrong option is the same as the answer: "${r.question}".`;
  if (new Set(wrong.map(norm)).size < wrong.length) return `A question has the same wrong option twice: "${r.question}".`;
  const also = r.also.map((o) => o.trim());
  if (also.length > 5) return `A question has more than 5 other answers: "${r.question}".`;
  if (also.some((o) => !o || o.length > 100)) return `Another answer is empty or longer than 100 characters: "${r.question}".`;
  if (also.some((o) => norm(o) === norm(r.answer)) || new Set(also.map(norm)).size < also.length) return `Another answer repeats the answer or another one: "${r.question}".`;
  const fill = r.fill?.trim() ?? '';
  if (fill && ((fill.match(/_{3,}/g) ?? []).length !== 1 || fill.length > 300)) return `The fill-in sentence needs exactly one ___ and at most 300 characters: "${r.question}".`;
  return null;
}

const strip = ({ teacherEmail: _t, reviewedBy: _r, seenAt: _s, ...q }: FakeQuestion): BankQuestion => q;
const byChapterOrder = (a: BankQuestion, b: BankQuestion) =>
  (a.class ?? 0) - (b.class ?? 0) || a.subject.localeCompare(b.subject) || (a.chapter_no ?? 0) - (b.chapter_no ?? 0)
  || (a.topic_no ?? 0) - (b.topic_no ?? 0) || a.question_no - b.question_no || a.id.localeCompare(b.id);

export type FakeGamesApi = GamesApi & {
  /** Puts the made-up questions and team back as they started. */
  reset(): void;
  /** Which role the dummy "you" has; null takes you off the team; 'reauth' is signed in with a password. */
  setRole(role: RoleCheck): void;
  role(): RoleCheck;
};

/** `slow`: each call takes a moment, like the real database, so loading states show (tests pass false). */
export function createFakeGamesApi(slow = true): FakeGamesApi {
  const wait = (ms = 250) => (slow ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve());
  let s = seed();
  /** Signed in with a password: on the team or not, nothing counts until they sign in with Google or a link. */
  let password = false;
  const me = () => s.team.find((p) => p.email === DUMMY_ME.email) ?? null;
  const roleOf = (): RoleCheck => (password ? 'reauth' : me()?.role ?? null);
  const need = (what: 'team' | 'hod' | 'admin') => {
    const r = roleOf();
    if (!r || r === 'reauth') throw new Error('Only people on the games team can do this. Sign in with Google, using the email on the team\'s list.');
    if (what === 'hod' && r === 'member') throw new Error('Only HoDs can see the HoD desk.');
    if (what === 'admin' && r !== 'admin') throw new Error('Only an admin can do this.');
  };
  const nameOf = (email: string | null) => s.team.find((p) => p.email === email)?.name ?? 'Your HoD';
  const bankOf = (qs: FakeQuestion[]): Bank => ({
    batches: s.batches.filter((b) => qs.some((q) => q.batch === b.id)),
    questions: qs.map(strip),
  });
  const approved = () => s.questions.filter((q) => q.status === 'approved');
  const waiting = () => s.questions.filter((q) => q.status === 'pending').length;

  return {
    reset() { s = seed(); password = false; },
    setRole(role) {
      password = role === 'reauth';
      if (role === 'reauth') return;
      const p = me();
      if (!role) s.team = s.team.filter((x) => x !== p);
      else if (p) p.role = role;
      else s.team.push({ ...DUMMY_ME, role, moderator: false, added_at: new Date().toISOString(), last_seen_at: null });
    },
    role: roleOf,

    async myRole() {
      await wait(150);
      if (password) return 'reauth';
      const p = me();
      if (p) p.last_seen_at = new Date().toISOString();
      return p?.role ?? null;
    },

    async loadCatalog() {
      await wait(150);
      need('team');
      return structuredClone(s.catalog);
    },

    async sendBatch(rows) {
      await wait(500);
      need('team');
      const ready = rows.filter((r) => r.chapter_id && r.chapter);
      const out: SendResult = { batchIds: [], sent: 0, already: 0, sentBack: 0, sentBackIds: [] };
      for (let i = 0; i < ready.length; i += BATCH_MAX) {
        const part = ready.slice(i, i + BATCH_MAX);
        // like the database, a batch with one bad question is refused whole, before anything is kept
        for (const r of part) {
          const why = codesProblem(r) ?? onTheList(s.catalog, r).problem;
          if (why) throw new Error(why);
        }
        // and if one can't be numbered, nothing in the batch is kept
        const kept = { questions: s.questions.length, batches: s.batches.length };
        let r: ReturnType<typeof add>;
        try {
          r = add(s, part, DUMMY_ME);
        } catch (e) {
          s.questions.length = kept.questions;
          s.batches.length = kept.batches;
          throw e;
        }
        if (r.batchId) out.batchIds.push(r.batchId);
        out.sent += r.ids.length;
        out.already += r.already;
        out.sentBack += r.sentBack;
        out.sentBackIds.push(...r.sentBackIds);
      }
      return out;
    },

    async loadForHod() {
      await wait();
      need('hod');
      return bankOf(s.questions.filter((q) => q.status !== 'approved'));
    },

    async loadApproved(after) {
      await wait();
      need('hod');
      const newest = approved().sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || b.id.localeCompare(a.id));
      const from = after ? newest.findIndex((q) => q.id === after.id) + 1 : 0;
      return bankOf(newest.slice(from, from + APPROVED_PAGE));
    },

    async approvedCount() {
      await wait(100);
      need('team');
      return approved().length;
    },

    async saveStatus(ids, status, reason = '') {
      await wait(300);
      need('hod');
      const why = reason.trim();
      if (status === 'rejected' && !why) throw new Error('Say why the question is going back.');
      const pick = s.questions.filter((q) => ids.includes(q.id));
      // a sent-back question stays sent back while the same question (sent again) is waiting or approved
      const skipped = status === 'rejected' ? [] : pick.filter((t) => t.status === 'rejected' && (
        s.questions.some((x) => x.chapter_id === t.chapter_id && norm(x.question) === norm(t.question) && x.status !== 'rejected')
        || pick.some((u) => u.status === 'rejected' && u.id < t.id && u.chapter_id === t.chapter_id && norm(u.question) === norm(t.question))
      )).map((t) => t.id);
      const changed: string[] = [];
      const now = new Date().toISOString();
      for (const q of pick) {
        if (skipped.includes(q.id)) continue;
        // nothing to do when it already has this status (and this reason): its time and "seen" stay as they are
        if (q.status === status && (status !== 'rejected' || q.note === why)) continue;
        q.status = status;
        q.note = status === 'rejected' ? why : '';
        q.reviewedAt = status === 'pending' ? null : now;
        q.reviewedBy = status === 'pending' ? null : DUMMY_ME.email;
        q.seenAt = null;
        changed.push(q.id);
      }
      const out: SaveResult = { changed, skipped, waiting: waiting(), approved: approved().length };
      return out;
    },

    async waitingCount() {
      await wait(100);
      need('hod');
      return waiting();
    },

    async loadQuestionBank() {
      await wait(400);
      need('team');
      return approved().map(strip).sort(byChapterOrder);
    },

    async mySentBack() {
      await wait();
      need('team');
      return s.questions
        .filter((q) => q.status === 'rejected' && q.teacherEmail === DUMMY_ME.email)
        .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || a.id.localeCompare(b.id))
        .map((q): SentBack => {
          const later = s.questions.filter((x) => x.chapter_id === q.chapter_id && norm(x.question) === norm(q.question) && x.status !== 'rejected');
          const now = later.some((x) => x.status === 'approved') ? 'approved' : later.length ? 'pending' : null;
          return { ...strip(q), reviewer: nameOf(q.reviewedBy), seen: q.seenAt !== null, now };
        });
    },

    async markSentBackSeen(ids) {
      await wait(100);
      need('team');
      const at = new Date().toISOString();
      for (const q of s.questions) {
        if (q.status === 'rejected' && q.teacherEmail === DUMMY_ME.email && !q.seenAt && ids.includes(q.id)) q.seenAt = at;
      }
    },

    async loadPeople() {
      await wait();
      need('admin');
      const rank = { admin: 0, hod: 1, member: 2 };
      return [...s.team].sort((a, b) => Number(b.moderator) - Number(a.moderator) || rank[a.role] - rank[b.role] || (a.name ?? a.email).localeCompare(b.name ?? b.email));
    },

    async setPersonRole(email, role) {
      await wait();
      need('admin');
      const mail = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error("That doesn't look like an email address.");
      if (mail === DUMMY_ME.email && role !== 'admin') throw new Error("You can't take away your own admin role.");
      const p = s.team.find((x) => x.email === mail);
      if (p?.moderator && role !== 'admin') throw new Error('The moderator stays an admin.');
      if (p) p.role = role;
      else s.team.push({ email: mail, name: null, role, moderator: false, added_at: new Date().toISOString(), last_seen_at: null });
    },

    async removePerson(email) {
      await wait();
      need('admin');
      const mail = email.trim().toLowerCase();
      if (mail === DUMMY_ME.email) throw new Error("You can't remove yourself.");
      if (s.team.find((x) => x.email === mail)?.moderator) throw new Error("The moderator can't be removed.");
      s.team = s.team.filter((x) => x.email !== mail);
    },
  };
}
