import { CODE, type ErrorCode } from "@/lib/stories/log";
import type { Lang } from "@/lib/stories/lang";

export type UiError = ErrorCode | "noclips";

type Copy = {
  app: string;
  phoneOnly: string;
  kids: string;
  kidsMode: string;
  kidsShelf: string;
  kidsHint: string;
  newStory: string;
  openingShelf: string;
  privateShelf: string;
  passphrase: string;
  opening: string;
  open: string;
  play: string;
  paused: string;
  playing: string;
  tapForButtons: string;
  shelf: string;
  leaveFull: string;
  fullScreen: string;
  pause: string;
  scrub: string;
  shelfClear: string;
  nothingYet: string;
  addPresent: string;
  nothingTitle: string;
  shorterHere: string;
  stories: string;
  present: string;
  editPresent: string;
  deletePresent: string;
  deleteAsk: string;
  deleteHint: string;
  keep: string;
  delete: string;
  wrap: string;
  language: string;
  back: string;
  editStory: string;
  title: string;
  defaultTitle: string;
  camera: string;
  gallery: string;
  reading: string;
  addClips: string;
  together: string;
  saveChanges: string;
  saveStory: string;
  saved: string;
  savedOpen: string;
  savedWrapped: string;
  leaveAsk: string;
  leaveHint: string;
  keepEditing: string;
  leave: string;
  chooseClip: string;
  currentCover: string;
  coverHelp: string;
  noClips: string;
  saving: string;
  savingPrepare: string;
  savingCover: string;
  savingShelf: string;
  crash: string;
  upTo: (n: number) => string;
  minutes: (n: number) => string;
  editNamed: (title: string) => string;
  deleteNamed: (title: string) => string;
  wrapNamed: (title: string) => string;
  moveUp: (n: number) => string;
  moveDown: (n: number) => string;
  removeClip: (n: number) => string;
  clip: (n: number) => string;
  seek: (name: string) => string;
  savingClip: (n: number, total: number) => string;
  err: Record<ErrorCode, string>;
};

const en: Copy = {
  app: "Stories",
  phoneOnly: "On this phone only.",
  kids: "Kids",
  kidsMode: "Kids mode",
  kidsShelf: "Kids shelf",
  kidsHint: "Longer stories stay hidden in Kids mode.",
  newStory: "New story",
  openingShelf: "Opening the shelf",
  privateShelf: "This shelf is private.",
  passphrase: "Family passphrase",
  opening: "Opening",
  open: "Open",
  play: "Play",
  paused: "Paused.",
  playing: "Playing.",
  tapForButtons: "Tap the picture to show the buttons.",
  shelf: "Shelf",
  leaveFull: "Leave full screen",
  fullScreen: "Full screen",
  pause: "Pause",
  scrub: "Move through the story",
  shelfClear: "The shelf is clear",
  nothingYet: "Nothing to watch yet.",
  addPresent: "Add a story and it shows up here.",
  nothingTitle: "Nothing to watch yet",
  shorterHere: "Shorter stories will show up here.",
  stories: "Stories",
  present: "Present",
  editPresent: "Edit present",
  deletePresent: "Delete present",
  deleteAsk: "Delete this story?",
  deleteHint: "It leaves the shelf.",
  keep: "Keep",
  delete: "Delete",
  wrap: "Wrap",
  language: "Language",
  back: "Back to shelf",
  editStory: "Edit story",
  title: "Title",
  defaultTitle: "Story from Oma",
  camera: "Camera",
  gallery: "Gallery",
  reading: "Reading clips",
  addClips: "Add one or more clips. They play in the order you set.",
  together: "Together",
  saveChanges: "Save changes",
  saveStory: "Save story",
  saved: "Saved",
  savedOpen: "It's on the shelf.",
  savedWrapped: "It's on the shelf, wrapped up.",
  leaveAsk: "Leave without saving?",
  leaveHint: "These clips stay where you picked them.",
  keepEditing: "Keep editing",
  leave: "Leave",
  chooseClip: "Choose a clip for the cover",
  currentCover: "Current cover",
  coverHelp: "Cover. Drag to move the picture. Pinch or scroll to zoom.",
  noClips: "This story has no clips.",
  saving: "Saving…",
  savingPrepare: "Getting ready…",
  savingCover: "Saving the cover…",
  savingShelf: "Saving the shelf…",
  crash: "Something went wrong",
  upTo: (n) => `Up to ${n} min`,
  minutes: (n) => `${n} minutes`,
  editNamed: (title) => `Edit ${title}`,
  deleteNamed: (title) => `Delete ${title}`,
  wrapNamed: (title) => `Wrap ${title}`,
  moveUp: (n) => `Move clip ${n} up`,
  moveDown: (n) => `Move clip ${n} down`,
  removeClip: (n) => `Remove clip ${n}`,
  clip: (n) => `Clip ${n}`,
  seek: (name) => `Seek ${name}`,
  savingClip: (n, total) => `Saving clip ${n} of ${total}…`,
  err: {
    [CODE.shelf]: "The shelf didn't open.",
    [CODE.save]: "That didn't save.",
    [CODE.open]: "That didn't open.",
    [CODE.play]: "That didn't play.",
    [CODE.remove]: "That didn't delete.",
    [CODE.passphrase]: "Wrong passphrase.",
    [CODE.full]: "This phone is full.",
    [CODE.video]: "Choose a video.",
    [CODE.read]: "That couldn't be read.",
    [CODE.setup]: "This isn't ready yet.",
    [CODE.generic]: "Something went wrong.",
  },
};

const de: Copy = {
  app: "Geschichten",
  phoneOnly: "Nur auf diesem Handy.",
  kids: "Kinder",
  kidsMode: "Kindermodus",
  kidsShelf: "Kinderregal",
  kidsHint: "Längere Geschichten bleiben im Kindermodus versteckt.",
  newStory: "Neue Geschichte",
  openingShelf: "Das Regal wird geöffnet",
  privateShelf: "Dieses Regal ist privat.",
  passphrase: "Familienpasswort",
  opening: "Wird geöffnet",
  open: "Öffnen",
  play: "Abspielen",
  paused: "Pausiert.",
  playing: "Es läuft.",
  tapForButtons: "Tippe auf das Bild, um die Knöpfe zu sehen.",
  shelf: "Regal",
  leaveFull: "Vollbild verlassen",
  fullScreen: "Vollbild",
  pause: "Pause",
  scrub: "Durch die Geschichte springen",
  shelfClear: "Das Regal ist leer",
  nothingYet: "Noch nichts zum Anschauen.",
  addPresent: "Füge eine Geschichte hinzu. Sie erscheint hier.",
  nothingTitle: "Noch nichts zum Anschauen",
  shorterHere: "Kürzere Geschichten erscheinen hier.",
  stories: "Geschichten",
  present: "Geschenk",
  editPresent: "Geschenk bearbeiten",
  deletePresent: "Geschenk löschen",
  deleteAsk: "Diese Geschichte löschen?",
  deleteHint: "Sie verschwindet vom Regal.",
  keep: "Behalten",
  delete: "Löschen",
  wrap: "Einpacken",
  language: "Sprache",
  back: "Zurück zum Regal",
  editStory: "Geschichte bearbeiten",
  title: "Titel",
  defaultTitle: "Geschichte von Oma",
  camera: "Kamera",
  gallery: "Galerie",
  reading: "Clips werden gelesen",
  addClips: "Füge einen oder mehrere Clips hinzu. Sie spielen in der Reihenfolge, die du einstellst.",
  together: "Zusammen",
  saveChanges: "Änderungen speichern",
  saveStory: "Geschichte speichern",
  saved: "Gespeichert",
  savedOpen: "Sie liegt auf dem Regal.",
  savedWrapped: "Sie liegt eingepackt auf dem Regal.",
  leaveAsk: "Ohne Speichern verlassen?",
  leaveHint: "Die Clips bleiben dort, wo du sie ausgewählt hast.",
  keepEditing: "Weiter bearbeiten",
  leave: "Verlassen",
  chooseClip: "Clip für das Titelbild wählen",
  currentCover: "Aktuelles Titelbild",
  coverHelp: "Titelbild. Ziehe das Bild zum Verschieben. Mit zwei Fingern oder Scrollen vergrößern.",
  noClips: "Diese Geschichte hat keine Clips.",
  saving: "Wird gespeichert…",
  savingPrepare: "Einen Moment…",
  savingCover: "Titelbild wird gespeichert…",
  savingShelf: "Das Regal wird gespeichert…",
  crash: "Etwas ist schiefgelaufen",
  upTo: (n) => `Bis ${n} Min.`,
  minutes: (n) => `${n} Minuten`,
  editNamed: (title) => `${title} bearbeiten`,
  deleteNamed: (title) => `${title} löschen`,
  wrapNamed: (title) => `${title} einpacken`,
  moveUp: (n) => `Clip ${n} nach oben`,
  moveDown: (n) => `Clip ${n} nach unten`,
  removeClip: (n) => `Clip ${n} entfernen`,
  clip: (n) => `Clip ${n}`,
  seek: (name) => `Stelle in ${name}`,
  savingClip: (n, total) => `Clip ${n} von ${total} wird gespeichert…`,
  err: {
    [CODE.shelf]: "Das Regal ging nicht auf.",
    [CODE.save]: "Das wurde nicht gespeichert.",
    [CODE.open]: "Das ging nicht auf.",
    [CODE.play]: "Das lief nicht.",
    [CODE.remove]: "Das wurde nicht gelöscht.",
    [CODE.passphrase]: "Falsches Passwort.",
    [CODE.full]: "Das Handy ist voll.",
    [CODE.video]: "Wähle ein Video.",
    [CODE.read]: "Das ließ sich nicht lesen.",
    [CODE.setup]: "Das ist noch nicht bereit.",
    [CODE.generic]: "Das hat nicht geklappt.",
  },
};

const copy: Record<Lang, Copy> = { en, de };

export function t(lang: Lang): Copy {
  return copy[lang];
}

export function uiError(lang: Lang, error: UiError): string {
  if (error === "noclips") return copy[lang].noClips;
  return copy[lang].err[error];
}
