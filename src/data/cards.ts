// Hider deck catalog (the official Jet Lag Hide+Seek deck).
// Drawing is done by hand with the physical cards; in the app the hider picks
// which card they drew (addCardToDeck) and later plays it (playCard). Time and
// the enforceable effects (veto / ask-lock / delay) are applied automatically;
// the rest are broadcast to the seekers as a timed notification (honour system).

export type CardType = 'time' | 'powerup' | 'curse'
export type CardEffectKind = 'time' | 'veto' | 'askLock' | 'delay' | 'notify' | 'manual'

export interface Card {
  id: string
  name: string
  type: CardType
  effect: CardEffectKind
  minutes?: number // time bonus value, or duration for askLock / delay / notify timer
  text?: string
}

const time = (m: number): Card => ({ id: `time-${m}`, name: `+${m} min Time Bonus`, type: 'time', effect: 'time', minutes: m })

const curse = (name: string, effect: CardEffectKind = 'notify', minutes = 10): Card => ({
  id: 'curse-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name, type: 'curse', effect, minutes,
  text: 'Apply this curse from the physical card. Seekers are notified for the timer.'
})

export const CARDS: Card[] = [
  // Time bonuses
  time(5), time(10), time(15), time(20), time(30),

  // Powerups (official)
  { id: 'pu-veto', name: 'Veto Question', type: 'powerup', effect: 'veto', text: 'Reject the current pending question; seekers must ask another.' },
  { id: 'pu-randomize', name: 'Randomize Question', type: 'powerup', effect: 'notify', minutes: 0, text: 'Seekers must randomize/replace their current question.' },
  { id: 'pu-move', name: 'Move', type: 'powerup', effect: 'notify', minutes: 0, text: 'The hider may move to a new hiding spot.' },
  { id: 'pu-discard12', name: 'Discard 1, Draw 2', type: 'powerup', effect: 'manual', text: 'Hand management (done with the physical cards).' },
  { id: 'pu-discard23', name: 'Discard 2, Draw 3', type: 'powerup', effect: 'manual', text: 'Hand management (done with the physical cards).' },
  { id: 'pu-expand', name: 'Draw 1, Expand 1', type: 'powerup', effect: 'manual', text: 'Hand management (done with the physical cards).' },
  { id: 'pu-duplicate', name: 'Duplicate Another Card', type: 'powerup', effect: 'manual', text: 'Hand management (done with the physical cards).' },

  // App-enforced "quick effects" (the automatic seeker limiters)
  { id: 'fx-freeze', name: 'Question Freeze (10 min)', type: 'curse', effect: 'askLock', minutes: 10, text: 'Seekers cannot ask any question for 10 minutes.' },
  { id: 'fx-delay', name: 'Slow Down (next question +5 min)', type: 'curse', effect: 'delay', minutes: 5, text: 'Seekers must wait 5 minutes before the next question.' },

  // Curses (official 24) - broadcast + honour system with a timer
  curse('Bridge Troll'), curse('Cairn'), curse('Distant Cuisine'), curse('Drained Brain'),
  curse('Egg Partner'), curse('Endless Tumble'), curse('Gambler\'s Feet'), curse('Hidden Hangman'),
  curse('Impressionable Consumer'), curse('Jammed Door'), curse('Labyrinth'), curse('Lemon Phylactery'),
  curse('Luxury Car'), curse('Mediocre Travel Agent'), curse('Overflowing Chalice'), curse('Ransom Note'),
  curse('Right Turn'), curse('Spotty Memory'), curse('The Bird Guide'), curse('The Unguided Tourist'),
  curse('The U-Turn'), curse('Urban Explorer'), curse('Water Weight'), curse('Zoologist')
]

export const CARD_GROUPS: { label: string; cards: Card[] }[] = [
  { label: 'Time bonuses', cards: CARDS.filter((c) => c.type === 'time') },
  { label: 'Powerups', cards: CARDS.filter((c) => c.type === 'powerup') },
  { label: 'Effects (auto)', cards: CARDS.filter((c) => c.type === 'curse' && c.effect !== 'notify') },
  { label: 'Curses', cards: CARDS.filter((c) => c.type === 'curse' && c.effect === 'notify') }
]
