// The Midnight Express: rooms, cast and story text for the 50 cases.
// The generator owns the logic; this file only supplies theme and words.

// Rooms: preposition, whether they take "the", and which objects they hold.
export const ROOMS = {
  'Dining Car': { prep: 'in', article: true, stand: ['seat', 'window', 'lamp'], block: ['table'] },
  'Lounge Car': { prep: 'in', article: true, stand: ['seat', 'rug', 'lamp'], block: ['piano', 'table'] },
  'Corridor': { prep: 'in', article: true, stand: ['window', 'rug', 'lamp'], block: ['trunk'] },
  'Platform': { prep: 'on', article: true, stand: ['suitcase', 'lamp'], block: ['trunk', 'crate'] },
  'Sleeper No. 1': { prep: 'in', article: false, stand: ['bunk', 'window'], block: ['trunk'] },
  'Sleeper No. 2': { prep: 'in', article: false, stand: ['bunk', 'seat'], block: ['trunk'] },
  'Sleeper No. 3': { prep: 'in', article: false, stand: ['bunk', 'lamp'], block: ['trunk'] },
  'Washroom': { prep: 'in', article: true, stand: ['rug', 'lamp'], block: ['basin'] },
  "Conductor's Cabin": { prep: 'in', article: true, stand: ['seat', 'window'], block: ['desk'] },
  'Baggage Car': { prep: 'in', article: true, stand: ['suitcase', 'lamp'], block: ['trunk', 'crate'] },
  'Mail Car': { prep: 'in', article: true, stand: ['seat', 'lamp'], block: ['mailsack', 'desk'] },
  'Kitchen Car': { prep: 'in', article: true, stand: ['rug', 'window'], block: ['stove', 'table'] },
  'Staff Quarters': { prep: 'in', article: true, stand: ['bunk', 'seat'], block: ['trunk'] },
  'Pantry': { prep: 'in', article: true, stand: ['rug', 'lamp'], block: ['crate'] },
  'Rose Suite': { prep: 'in', article: true, stand: ['bunk', 'seat', 'rug'], block: ['table'] },
  'Ivory Suite': { prep: 'in', article: true, stand: ['bunk', 'window', 'rug'], block: ['trunk'] },
  'Gold Suite': { prep: 'in', article: true, stand: ['bunk', 'seat', 'lamp'], block: ['piano'] },
  'Observation Car': { prep: 'in', article: true, stand: ['seat', 'window'], block: ['table'] },
  'Customs Office': { prep: 'in', article: true, stand: ['seat', 'lamp'], block: ['desk', 'crate'] },
  'Waiting Room': { prep: 'in', article: true, stand: ['seat', 'rug', 'window'], block: ['table'] },
  'Locomotive': { prep: 'in', article: true, stand: ['window', 'lamp'], block: ['firebox'] },
  'Coal Tender': { prep: 'on', article: true, stand: ['lamp'], block: ['coal'] },
  'Sleeper Car': { prep: 'in', article: true, stand: ['bunk', 'window'], block: ['trunk'] },
};

export const TIERS = [
  {
    id: 'rookie', name: 'Rookie', leg: 'Paris → Vienna', levels: [1, 10],
    rooms: ['Dining Car', 'Lounge Car', 'Corridor', 'Platform'],
  },
  {
    id: 'sergeant', name: 'Sergeant', leg: 'Vienna → Budapest', levels: [11, 20],
    rooms: ['Sleeper No. 1', 'Sleeper No. 2', 'Sleeper No. 3', 'Washroom', "Conductor's Cabin", 'Corridor'],
  },
  {
    id: 'detective', name: 'Detective', leg: 'Budapest → Bucharest', levels: [21, 30],
    rooms: ['Baggage Car', 'Mail Car', 'Kitchen Car', 'Staff Quarters', 'Pantry', 'Corridor'],
  },
  {
    id: 'inspector', name: 'Inspector', leg: 'Bucharest → Varna', levels: [31, 40],
    rooms: ['Rose Suite', 'Ivory Suite', 'Gold Suite', 'Observation Car', 'Customs Office', 'Waiting Room', 'Platform'],
  },
  {
    id: 'mastermind', name: 'Mastermind', leg: 'Varna → Istanbul', levels: [41, 50],
    rooms: ['Locomotive', 'Coal Tender', 'Baggage Car', 'Kitchen Car', 'Dining Car', 'Lounge Car', 'Sleeper Car', 'Observation Car', 'Mail Car'],
  },
];

// Recurring passengers and crew. `from` is the first level they are aboard.
export const CAST = [
  { name: 'Countess Adler', role: 'Viennese aristocrat', from: 1 },
  { name: 'Conductor Czerny', role: 'chief conductor', from: 1 },
  { name: 'Dr. Dalca', role: 'physician from Bucharest', from: 31 },
  { name: 'Miss Ellery', role: 'newspaper reporter', from: 1 },
  { name: 'Chef Fournier', role: 'head chef', from: 1 },
  { name: 'General Gorev', role: 'retired cavalry general', from: 1 },
  { name: 'Mr. Hale', role: 'American oilman', from: 1 },
  { name: 'Princess Irina', role: 'exiled princess', from: 21 },
  { name: 'Mr. Jansen', role: 'Dutch banker', from: 1 },
  { name: 'Professor Kovacs', role: 'archaeologist', from: 11 },
  { name: 'Lady Lindqvist', role: 'Swedish widow', from: 1 },
  { name: 'Signor Moretti', role: 'lounge pianist', from: 1 },
  { name: 'Nurse Novak', role: 'travelling nurse', from: 1 },
  { name: 'Mr. Orlov', role: 'émigré bookseller', from: 1 },
  { name: 'Porter Petrescu', role: 'sleeping-car porter', from: 1 },
  { name: 'Madame Roussel', role: 'cabaret singer', from: 1 },
  { name: 'Sir Sterling', role: 'British diplomat', from: 1 },
  { name: 'Miss Tasker', role: 'governess', from: 1 },
  { name: 'Herr Weiss', role: 'watchmaker', from: 1 },
  { name: 'Yusuf Bey', role: 'silk merchant', from: 41 },
  { name: 'Madame Zara', role: 'fortune teller', from: 1 },
];

// Passengers who appear in a few cases and then die or are arrested.
export const PASSENGERS = [
  'Mr. Abernathy', 'Mrs. Ashby', 'Herr Brandt', 'Miss Beaumont', 'Monsieur Bisset', 'Mr. Carlisle',
  'Frau Claussen', 'Dr. Crane', 'Signora Conti', 'Mr. Delacroix', 'Miss Duval', 'Herr Engel',
  'Mrs. Everett', 'Monsieur Faure', 'Miss Fitch', 'Frau Graf', 'Mr. Grantham', 'Madame Girard',
  'Mr. Holloway', 'Herr Hartmann', 'Miss Hennessy', 'Mr. Ingram', 'Signor Iannelli', 'Madame Joubert',
  'Mr. Jessop', 'Frau Keller', 'Captain Kendrick', 'Mr. Lambert', 'Signora Lombardi', 'Miss Lacey',
  'Herr Maier', 'Mrs. Marsh', 'Monsieur Mercier', 'Mr. Nash', 'Frau Neumann', 'Miss Nolan',
  'Mr. Ogilvie', 'Madame Olivier', 'Mr. Pemberton', 'Signor Pellegrini', 'Frau Pohl', 'Mr. Quill',
  'Miss Quinby', 'Mr. Radcliffe', 'Frau Richter', 'Monsieur Renard', 'Mr. Sutton', 'Herr Schaefer',
  'Miss Sinclair', 'Mr. Thorne', 'Madame Toussaint', 'Herr Ulrich', 'Miss Underwood', 'Mr. Vance',
  'Frau Vogel', 'Monsieur Valois', 'Mr. Whitlock', 'Frau Wagner', 'Miss Winslow', 'Mr. Yardley',
  'Signora Zanetti', 'Herr Zimmer', 'Mr. Barlow', 'Colonel Ashworth', 'Father Quintero', 'Sister Ursula',
  'Mr. Kemp', 'Mrs. Doyle', 'Herr Lang', 'Miss Mallory', 'Mr. Fenwick', 'Mrs. Garrick',
  'Monsieur Hugo', 'Mr. Iverson', 'Miss Jardine', 'Herr Kraus', 'Mr. Lowell', 'Mrs. Merriweather',
  'Mr. Norcross', 'Madame Ortolan', 'Mr. Prescott', 'Miss Quayle', 'Herr Rainer', 'Mrs. Stanhope',
  'Mr. Tremaine', 'Miss Upton', 'Monsieur Vidal', 'Mrs. Wexford', 'Fraulein Ziegler', 'Mr. Bellweather',
  'Count Cassel', 'Mr. Danvers', 'Mrs. Ellwood', 'Mr. Fairfax', 'Baron Grimaldi',
];

export const ROLES = [
  'travelling salesman', 'schoolteacher', 'wine merchant', 'opera critic', 'honeymooner',
  'stamp collector', 'retired actor', 'typist', 'mining engineer', 'chess master', 'milliner',
  'novelist', 'ship broker', 'botanist', 'photographer', 'lawyer', 'art dealer', 'cartographer',
  'tea importer', 'missionary', 'tobacco merchant', 'racing driver', 'violinist', 'tailor',
  'accountant', 'dancer', 'perfumer', 'bookbinder', 'insurance agent', 'radio engineer',
];

// Chapter finales: the culprit is one of the Nightjar's accomplices, and the
// victim someone from the recurring cast.
export const FIXED = {
  10: { murderer: 'Signor Moretti' },
  20: { murderer: 'Nurse Novak', victim: 'Mr. Jansen' },
  30: { murderer: 'Porter Petrescu', victim: 'Professor Kovacs' },
  40: { murderer: 'General Gorev', victim: 'Mr. Orlov' },
  50: { murderer: 'Lady Lindqvist', victim: 'Sir Sterling' },
};

// One entry per level: title and intro ({victim} is filled in), and for
// chapter finales a closing that moves the story on ({murderer} is filled in).
export const CASES = [
  // Chapter 1 — Paris → Vienna
  { title: 'Departure from Paris', intro: "The Midnight Express has barely left the Gare de l'Est when a scream rings out. {victim} lies still, and you are the only detective aboard. Sir Sterling, the British diplomat, keeps one hand on a locked dispatch box." },
  { title: 'The Marne at Midnight', intro: 'Somewhere along the Marne, the lights flicker for three seconds. When they come back, {victim} has slumped over in the dark.' },
  { title: 'A Cold Cup of Tea', intro: "The steward finds {victim} beside an untouched cup of tea. Whoever did this knew the steward's rounds to the minute." },
  { title: 'The Strasbourg Signal', intro: 'A lantern swings twice on the Strasbourg platform, and someone aboard answers it. Minutes later, {victim} is found dead.' },
  { title: 'Crossing the Rhine', intro: 'The train rattles over the Rhine bridge, loud enough to cover any cry. {victim} will not see Germany.' },
  { title: 'Stuttgart, Platform Four', intro: 'A brief stop in Stuttgart. Passengers stretch their legs, the whistle blows, and {victim} never makes it back to the compartment.' },
  { title: 'The Munich Stop', intro: 'Snow begins to fall over Munich. Miss Ellery, the reporter, asks if you have heard of a thief called the Nightjar. An hour later, {victim} is dead.' },
  { title: 'Salzburg Snow', intro: 'The train is stuck in a snowdrift outside Salzburg, and nobody can leave. Nobody, that is, except {victim}, who has left for good.' },
  { title: 'The Unsent Telegram', intro: '{victim} had written a telegram to Scotland Yard but never sent it. The message is gone, and so is its author.' },
  {
    title: 'Arrival in Vienna',
    intro: 'The lights of Vienna are in sight, and the piano in the lounge car has played the same four notes all evening. {victim} worked out what they meant, and paid for it.',
    outro: '{murderer} confesses on the Vienna platform: the four notes were a code, played for someone called the Nightjar. The target is the Star of the Bosphorus, a sapphire hidden in Sir Sterling\'s dispatch box. The Nightjar is still aboard.',
  },
  // Chapter 2 — Vienna → Budapest
  { title: 'Waltz of the Sleepers', intro: 'Vienna fades behind you and the sleeping cars go quiet. Too quiet: {victim} never answered the morning knock.' },
  { title: 'The Danube Fog', intro: 'Fog rolls up from the Danube and fills the corridors. When it clears, {victim} is lying on the floor.' },
  { title: 'Lights Out in Sleeper Three', intro: 'A fuse blows in Sleeper No. 3. In the dark, someone found {victim} exactly where they wanted.' },
  { title: "The Conductor's Ledger", intro: "Conductor Czerny's ledger shows a ticket sold to a passenger nobody has seen. {victim} went looking for them." },
  { title: 'A Missing Key', intro: 'The master key to the sleeping cars has gone missing. So, it turns out, has the life of {victim}.' },
  { title: 'The Hegyeshalom Border', intro: 'Border guards stamp passports at Hegyeshalom. One passport will never be stamped again: the one belonging to {victim}.' },
  { title: 'The Second Whistle', intro: 'The train whistles twice where it should whistle once. By the second blast, {victim} had stopped breathing.' },
  { title: 'Steam and Mirrors', intro: 'The washroom mirror is fogged with steam, and someone has written a single word in it: NIGHTJAR. Beneath it lies {victim}.' },
  { title: 'Győr by Night', intro: 'A quiet stop at Győr. Professor Kovacs swears he saw a woman in black step off and back on. Then {victim} is found dead.' },
  {
    title: 'The Pearl of the Danube',
    intro: 'Budapest glitters on both banks of the river. Mr. Jansen, the banker, had agreed to tell you who was paying the Nightjar. He never got the chance.',
    outro: '{murderer} is led away in Budapest. A doctored medicine case holds a scrap of paper: a bank draft signed with a bird sketched in ink. Someone aboard is paying for every death.',
  },
  // Chapter 3 — Budapest → Bucharest
  { title: 'The Mail Must Go Through', intro: 'A new mail car is coupled in Budapest. By the first bend, {victim} is lying among the sacks.' },
  { title: 'Paprika and Poison', intro: "Chef Fournier's goulash is famous on this line. Tonight, {victim} will not be writing any reviews." },
  { title: 'Unclaimed Luggage', intro: 'A trunk with no name tag sits in the baggage car. {victim} tried to open it and got no further.' },
  { title: 'Crossing the Tisza', intro: 'The Tisza river glints under a full moon. Princess Irina, who boarded in Budapest, is the first to find {victim}.' },
  { title: 'The Dead Letter Office', intro: 'A letter addressed to "The Bird" sits in the dead-letter sack. {victim} read it, which was a mistake.' },
  { title: 'The Arad Exchange', intro: 'At Arad, two identical suitcases swap hands on the platform. Inside the train, {victim} is found dead.' },
  { title: 'Kitchen Knives', intro: "One of the chef's knives is missing from the rack. {victim} has been found, and the knife has not." },
  { title: 'Through the Carpathians', intro: 'The track climbs through the Carpathians, tunnel after tunnel. In one of them, {victim} drew a last breath.' },
  { title: 'Brașov in the Rain', intro: 'Rain hammers the roof at Brașov, and the staff quarters leak. Under the drip lies {victim}.' },
  {
    title: 'The Bucharest Ledger',
    intro: "Professor Kovacs had spent the whole trip comparing the luggage labels with the porter's ledger. As the train reaches Bucharest, he is found dead.",
    outro: "{murderer} is arrested in Bucharest. The porter's ledger lists every trunk the Nightjar used: each one was booked to the same suite. The Nightjar travels first class.",
  },
  // Chapter 4 — Bucharest → Varna
  { title: 'First-Class Trouble', intro: 'You move into the first-class suites to watch them closely. On the first night, {victim} is found dead in the corridor outside.' },
  { title: 'The Observation Car', intro: 'Dr. Dalca, who boarded in Bucharest, recommends the observation car for its view. {victim} enjoyed it for the last time.' },
  { title: 'Across the Danube Again', intro: 'The train crosses into Bulgaria over the Danube. Halfway across, {victim} falls silent forever.' },
  { title: 'Customs at Ruse', intro: 'Customs officers at Ruse search every bag. They find nothing, but someone finds {victim}.' },
  { title: 'The Locked Suite', intro: 'The Gold Suite is locked from the inside, yet {victim} lies dead within. Someone has a key they should not have.' },
  { title: 'A View of Nothing', intro: 'Night falls over the plains and the observation car looks out on black glass. Reflected in it: {victim}, quite dead.' },
  { title: 'Stamps and Passports', intro: '{victim} noticed that two passengers carried passports with the same photograph. That was one detail too many.' },
  { title: 'The Black Sea Breeze', intro: 'The air smells of salt: the sea is near. {victim} opened a window for the breeze and did not close it.' },
  { title: 'Waiting Room Blues', intro: 'A delay strands everyone in the station waiting room. When the train is ready to leave, {victim} is not.' },
  {
    title: 'Last Stop Before the Sea',
    intro: 'Varna at dawn. Mr. Orlov, the bookseller, had found the Nightjar\'s cipher hidden in a novel. He was killed before he could hand it to you.',
    outro: "{murderer} is taken off the train at Varna. The general's cigarette case holds the last piece of the cipher: the Nightjar will make the switch in Istanbul, at Sirkeci Station.",
  },
  // Chapter 5 — Varna → Istanbul
  { title: 'Full Steam from Varna', intro: 'The Midnight Express runs south along the coast at full steam. Yusuf Bey, the silk merchant, joins the train, just in time to see {victim} carried out.' },
  { title: 'The Coal Tender', intro: '{victim} climbed onto the coal tender to escape someone. It did not work.' },
  { title: 'Burgas Bound', intro: 'Burgas is an hour away and the engine is short of water. So is {victim}, of time.' },
  { title: "The Fireman's Shovel", intro: "The fireman's shovel turns up in the dining car, which is odd. Odder still is {victim}, lying beside it." },
  { title: 'Every Car at Once', intro: 'The Nightjar is getting desperate. Tonight there is chaos in every car, and in the middle of it, {victim} dies.' },
  { title: "The Nightjar's Song", intro: 'Someone whistles a bird call down the corridor at midnight. When it stops, {victim} is dead.' },
  { title: 'Edirne Lights', intro: 'The minarets of Edirne slide past in the dark. {victim} was counting them when someone stepped up behind.' },
  { title: 'The Last Dining Service', intro: 'Chef Fournier serves the final dinner of the journey. {victim} does not make it to dessert.' },
  { title: 'Domes on the Horizon', intro: 'At first light the domes of Istanbul rise over the Golden Horn. One more death stands between you and the Nightjar: {victim}.' },
  {
    title: 'Istanbul, Sirkeci Station',
    intro: 'The train pulls into Sirkeci Station. Sir Sterling, keeper of the dispatch box, lies dead, and the box is open. The Nightjar is one of the people around you.',
    outro: 'The Nightjar is {murderer}, sapphire in hand, the grieving widow who never grieved. The Star of the Bosphorus goes home, and the Midnight Express finally sleeps. Case closed, Detective.',
  },
];

// Closing lines for ordinary cases, used in rotation.
export const OUTROS = [
  '{murderer} is locked in the baggage car until the next station.',
  '{murderer} breaks down and confesses before the next stop.',
  'Conductor Czerny escorts {murderer} away in handcuffs.',
  '{murderer} insists it was an accident. Nobody believes it.',
  'At the next station, the police are waiting for {murderer}.',
  '{murderer} says nothing, but the evidence says plenty.',
  'Miss Ellery is already writing the headline about {murderer}.',
  '{murderer} mutters something about a bird before being taken away.',
];
