import type { CopyDictionary } from "./types";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const haunted = {
  brand: { name: "The Crypt", tagline: "Where hauntings come to be laid to rest" },
  nav: {
    dashboard: "The Crypt",
    incidents: "Hauntings",
    rituals: "Rituals",
    myRituals: "My Rituals",
    settings: "Settings",
    members: "The Coven",
    retroRules: "Binding Rules",
    billing: "Tithes",
    signIn: "Enter the Crypt",
    signOut: "Leave the Crypt",
  },
  incident: {
    singular: "Haunting",
    plural: "Hauntings",
    newIncident: "Report a haunting",
    title: "What is haunting you?",
    summary: "Summary",
    severity: "Dread Level",
    status: "Status",
    services: "Haunted services",
    roles: "Roles",
    timeline: "Séance log",
    addNote: "Add to the log",
    notePlaceholder: "What did the spirits do?",
    number: (n) => `Haunting #${n}`,
  },
  severity: {
    1: "Uneasy",
    2: "Creepy",
    3: "Cursed",
    4: "Possessed",
    5: "Full Poltergeist",
  },
  status: {
    INVESTIGATING: "Lurking",
    IDENTIFIED: "Possessed",
    MITIGATING: "Exorcising",
    RESOLVED: "Laid to Rest",
  },
  incidentRole: {
    COMMANDER: "Exorcist",
    SCRIBE: "Scribe",
    COMMS: "Medium",
  },
  workspaceRole: { OWNER: "Crypt Keeper", ADMIN: "Warden", MEMBER: "Acolyte" },
  postmortem: {
    singular: "Autopsy Report",
    plural: "Autopsy Reports",
    draft: "Draft",
    published: "Published",
    publish: "Publish autopsy",
    statusLabel: { DRAFT: "Still on the slab", PUBLISHED: "Filed in the archive" },
    sections: {
      CAUSE: {
        title: "Cause of Death",
        prompt:
          "What conditions made this failure possible? Blame the system, never the sleepwalker.",
      },
      LAST_SIGHTING: {
        title: "Last Known Sighting",
        prompt:
          "How did we first notice something was wrong, and what were the omens beforehand?",
      },
      WITNESSES: {
        title: "Witnesses",
        prompt:
          "Who and what was present during the response? Describe what they did, not what they did wrong.",
      },
      LEARNED: {
        title: "What We Learned",
        prompt:
          "What would keep this spirit from returning, or make its visit less terrifying?",
      },
    },
    blamelessNote:
      "Autopsies are blameless: the ghost is the system, not the person who found it.",
    missingForRule: (sev) =>
      `A published autopsy is required before a ${sev} haunting can be laid to rest.`,
  },
  ritual: {
    singular: "Ritual",
    plural: "Rituals",
    mine: "My rituals",
    owner: "Keeper",
    dueDate: "Must be performed by",
    overdue: "Overdue",
    overdueBy: (d) => `Overdue by ${d} ${plural(d, "day", "days")}. The spirits grow restless`,
    dueIn: (d) =>
      d === 0 ? "Due at midnight tonight" : `Due in ${d} ${plural(d, "night", "nights")}`,
    statusLabel: { OPEN: "Unperformed", IN_PROGRESS: "Mid-chant", DONE: "Completed" },
    newRitual: "Prepare a ritual",
  },
  revenant: {
    singular: "Revenant",
    plural: "Revenants",
    suggestionHeading: "This ghost looks familiar",
    link: "Bind to the Revenant",
    hauntedNTimes: (n) =>
      `This has haunted you ${n} ${plural(n, "time", "times")} before`,
  },
  empty: {
    incidents: [
      "No hauntings. Suspiciously quiet.",
      "Not a ghost in sight. Don't jinx it.",
    ],
    timeline: [
      "The séance log is empty. Even the ghosts are silent.",
      "Nothing has happened yet. That's what they always say.",
    ],
    postmortems: [
      "No autopsies on file. Nothing has died. Yet.",
      "The morgue is empty. Enjoy it while it lasts.",
    ],
    rituals: [
      "No rituals scheduled. The candles remain unlit.",
      "No rituals. Either you're thorough, or the ghosts are.",
    ],
    myRituals: [
      "Your ritual list is empty. Go home early.",
      "Nothing for you to chant. Rare and beautiful.",
    ],
    revenants: [
      "No revenants. The dead are staying dead.",
      "No ghost has returned. Knock on wood.",
    ],
    members: ["The coven is empty. Summon some help."],
    dashboardOverdue: [
      "No overdue rituals. The spirits are, for once, satisfied.",
      "Every ritual is on time. Unsettling.",
    ],
  },
  dashboard: {
    heading: "The Crypt",
    openIncidents: "Active hauntings",
    overdueRituals: "Overdue rituals",
    revenantCount: "Revenants",
    mttr: "Mean time to rest",
    incidentsPerMonth: "Hauntings per month",
    mttrValue: (m) => {
      if (m === null) return "No data. Nobody has rested yet";
      if (m < 60) return `${Math.round(m)} min`;
      return `${(m / 60).toFixed(1)} h`;
    },
  },
  settings: {
    heading: "Settings",
    workspaceName: "Name of the crypt",
    skin: "Atmosphere",
    skinHaunted: "Haunted",
    skinProfessional: "Professional",
    switchSkinTo: (name) => `Atmosphere: ${name}`,
    severityNames: "Dread Level names",
    severityNamesHelp: "Rename the Dread Levels to suit your crypt.",
    retroRule: "Binding rule",
    retroRuleHelp: (sev) => `Demand an autopsy for hauntings at ${sev} or worse.`,
    plan: "Plan",
    save: "Seal changes",
  },
  actions: {
    create: "Summon",
    cancel: "Retreat",
    delete: "Banish",
    invite: "Send a summons",
    remove: "Cast out",
    confirm: "So it is written",
  },
  errors: {
    generic: "Something stirred in the walls. Please try again.",
    notFound: "Nothing here but dust.",
    forbidden: "The spirits forbid it.",
  },
  validation: {
    required: "This field must not be left empty.",
    tooLong: (max) => `Keep it under ${max} characters.`,
    invalidEmail: "That is not a valid email address.",
  },
  a11y: {
    skipToContent: "Skip to content",
    overdueIcon: "Overdue",
    decorativeFog: "Decorative fog",
  },
} satisfies CopyDictionary;
