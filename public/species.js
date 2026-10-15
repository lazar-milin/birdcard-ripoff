// User-supplied pixel bird illustrations, mapped to their card species.
export const SPECIES = [
  {
    id: "flamingo",
    name: "Flamingo",
    short: "FLAM", // shown on cards squeezed into a long wire
    count: 7,
    small: 2,
    big: 3,
    color: "#f2b8c4",
    image: "/art/flamingo.png",
  },
  {
    id: "owl",
    name: "Owl",
    short: "OWL", // shown on cards squeezed into a long wire
    count: 10,
    small: 3,
    big: 4,
    color: "#c7b7db",
    image: "/art/owl.png",
  },
  {
    id: "toucan",
    name: "Toucan",
    short: "TOUC", // shown on cards squeezed into a long wire
    count: 10,
    small: 3,
    big: 4,
    color: "#efc479",
    image: "/art/toucan.png",
  },
  {
    id: "duck",
    name: "Duck",
    short: "DUCK", // shown on cards squeezed into a long wire
    count: 13,
    small: 4,
    big: 6,
    color: "#9ac7ae",
    image: "/art/duck.png",
  },
  {
    id: "parrot",
    name: "Parrot",
    short: "PARR", // shown on cards squeezed into a long wire
    count: 13,
    small: 4,
    big: 6,
    color: "#b9cf86",
    image: "/art/parrot.png",
  },
  {
    id: "magpie",
    name: "Magpie",
    short: "MAG", // shown on cards squeezed into a long wire
    count: 17,
    small: 5,
    big: 7,
    color: "#b9c6d8",
    image: "/art/magpie.png",
  },
  {
    id: "warbler",
    name: "Reed Warbler",
    short: "WARB", // shown on cards squeezed into a long wire
    count: 20,
    small: 6,
    big: 9,
    color: "#d7c59d",
    image: "/art/warbler.png",
  },
  {
    id: "robin",
    name: "Robin",
    short: "ROB", // shown on cards squeezed into a long wire
    count: 20,
    small: 6,
    big: 9,
    color: "#e9a58c",
    image: "/art/robin.png",
  },
];

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

// Card ids are the species id, a dash, and a copy number, for example "duck-3".
export const speciesOf = (card) => card.slice(0, card.lastIndexOf("-"));
