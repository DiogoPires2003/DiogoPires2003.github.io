// Turns formal constraints into clue sentences. Each constraint maps to exactly
// one predicate phrase, so the text never adds or drops information.
import { ROOMS } from './story.mjs';

export const OBJECT_NAMES = {
  seat: 'seat', bunk: 'bunk', rug: 'rug', window: 'window', lamp: 'lamp', suitcase: 'suitcase',
  table: 'table', piano: 'piano', stove: 'stove', trunk: 'trunk', mailsack: 'mail sack',
  crate: 'crate', coal: 'coal heap', basin: 'washbasin', desk: 'desk', firebox: 'firebox',
};

const ON_OBJECT = {
  seat: 'was sitting in a seat',
  bunk: 'was lying on a bunk',
  rug: 'was standing on a rug',
  window: 'was standing at a window',
  lamp: 'was standing under a lamp',
  suitcase: 'was sitting on a suitcase',
};

// "in the Dining Car", "on the Platform", "in Sleeper No. 1".
export function roomPhrase(name) {
  const info = ROOMS[name];
  if (!info) throw new Error('Unknown room ' + name);
  return info.prep + ' ' + (info.article ? 'the ' : '') + name;
}

export function predicate(con, roomNames, nameOf) {
  switch (con.type) {
    case 'inRoom': return 'was ' + roomPhrase(roomNames[con.room]);
    case 'notInRoom': return 'was not ' + roomPhrase(roomNames[con.room]);
    case 'onObject': return ON_OBJECT[con.object];
    case 'nextTo': return con.person
      ? 'was diagonally next to ' + nameOf(con.person)
      : 'was beside a ' + OBJECT_NAMES[con.object];
    case 'notNextTo': return con.person
      ? 'was not diagonally next to ' + nameOf(con.person)
      : 'was not beside any ' + OBJECT_NAMES[con.object];
    case 'sameRoom': return 'was in the same room as ' + nameOf(con.person);
    case 'inRow': return 'was in row ' + (con.row + 1);
    case 'inCol': return 'was in column ' + (con.col + 1);
    case 'notInRow': return 'was not in row ' + (con.row + 1);
    case 'notInCol': return 'was not in column ' + (con.col + 1);
    case 'leftOf': return 'was somewhere left of ' + nameOf(con.person);
    case 'above': return 'was somewhere above ' + nameOf(con.person);
  }
  throw new Error('No phrase for ' + con.type);
}

function joinList(parts) {
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

export function clueText(ch, roomNames, nameOf) {
  const subject = ch.victim ? 'The victim, ' + ch.name + ',' : ch.name;
  return subject + ' ' + joinList(ch.constraints.map((c) => predicate(c, roomNames, nameOf))) + '.';
}
