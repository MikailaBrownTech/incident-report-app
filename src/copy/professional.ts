import type { CopyDictionary } from "./types";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const professional = {
  brand: { name: "The Crypt", tagline: "Incident and postmortem tracking" },
  nav: {
    dashboard: "Dashboard",
    incidents: "Incidents",
    rituals: "Action Items",
    myRituals: "My Action Items",
    settings: "Settings",
    members: "Members",
    retroRules: "Retro Rules",
    billing: "Billing",
    signIn: "Sign in",
    signOut: "Sign out",
  },
  incident: {
    singular: "Incident",
    plural: "Incidents",
    newIncident: "New incident",
    title: "Title",
    summary: "Summary",
    severity: "Severity",
    status: "Status",
    services: "Services affected",
    roles: "Roles",
    timeline: "Timeline",
    addNote: "Add note",
    notePlaceholder: "What just happened?",
    number: (n) => `Incident #${n}`,
  },
  severity: {
    1: "SEV 5 – Minor",
    2: "SEV 4 – Low",
    3: "SEV 3 – Moderate",
    4: "SEV 2 – High",
    5: "SEV 1 – Critical",
  },
  status: {
    INVESTIGATING: "Investigating",
    IDENTIFIED: "Identified",
    MITIGATING: "Mitigating",
    RESOLVED: "Resolved",
  },
  incidentRole: {
    COMMANDER: "Incident Commander",
    SCRIBE: "Scribe",
    COMMS: "Communications Lead",
  },
  workspaceRole: { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" },
  postmortem: {
    singular: "Postmortem",
    plural: "Postmortems",
    draft: "Draft",
    published: "Published",
    publish: "Publish postmortem",
    statusLabel: { DRAFT: "Draft", PUBLISHED: "Published" },
    sections: {
      CAUSE: {
        title: "Root Cause",
        prompt:
          "What conditions made this failure possible? Focus on systems and processes, not individuals.",
      },
      LAST_SIGHTING: {
        title: "Detection and Timeline",
        prompt:
          "How was the problem detected, and what did the signals look like before it was noticed?",
      },
      WITNESSES: {
        title: "People and Systems Involved",
        prompt:
          "Which teams, systems, and on-call roles took part in the response? Describe their actions, not their mistakes.",
      },
      LEARNED: {
        title: "Lessons Learned",
        prompt:
          "What would make this class of failure less likely or less severe next time?",
      },
    },
    blamelessNote:
      "This postmortem is blameless: describe what happened and why the system allowed it.",
    missingForRule: (sev) =>
      `A published postmortem is required for ${sev} incidents before they can be resolved.`,
  },
  ritual: {
    singular: "Action Item",
    plural: "Action Items",
    mine: "My action items",
    owner: "Owner",
    dueDate: "Due date",
    overdue: "Overdue",
    overdueBy: (d) => `Overdue by ${d} ${plural(d, "day", "days")}`,
    dueIn: (d) => (d === 0 ? "Due today" : `Due in ${d} ${plural(d, "day", "days")}`),
    statusLabel: { OPEN: "Open", IN_PROGRESS: "In progress", DONE: "Done" },
    newRitual: "New action item",
  },
  revenant: {
    singular: "Recurring incident",
    plural: "Recurring incidents",
    suggestionHeading: "This looks like a previous incident",
    link: "Link as recurrence",
    hauntedNTimes: (n) => `This has occurred ${n} ${plural(n, "time", "times")} before`,
  },
  empty: {
    incidents: ["No incidents yet."],
    timeline: ["No events yet."],
    postmortems: ["No postmortems yet."],
    rituals: ["No action items."],
    myRituals: ["Nothing assigned to you."],
    revenants: ["No recurring incidents found."],
    members: ["No members yet."],
    dashboardOverdue: ["No overdue action items."],
  },
  dashboard: {
    heading: "Dashboard",
    openIncidents: "Open incidents",
    overdueRituals: "Overdue action items",
    revenantCount: "Recurring incidents",
    mttr: "Mean time to resolve",
    incidentsPerMonth: "Incidents per month",
    mttrValue: (m) => {
      if (m === null) return "No data";
      if (m < 60) return `${Math.round(m)} min`;
      return `${(m / 60).toFixed(1)} h`;
    },
  },
  settings: {
    heading: "Settings",
    workspaceName: "Workspace name",
    skin: "Appearance",
    skinHaunted: "Haunted",
    skinProfessional: "Professional",
    switchSkinTo: (name) => `Appearance: ${name}`,
    severityNames: "Severity names",
    severityNamesHelp: "Override the default severity names for this workspace.",
    retroRule: "Retro rule",
    retroRuleHelp: (sev) => `Require a postmortem for incidents at ${sev} or above.`,
    plan: "Plan",
    save: "Save changes",
  },
  actions: {
    create: "Create",
    cancel: "Cancel",
    delete: "Delete",
    invite: "Send invite",
    remove: "Remove",
    confirm: "Confirm",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    notFound: "Not found.",
    forbidden: "You don't have permission to do that.",
  },
  validation: {
    required: "This field is required.",
    tooLong: (max) => `Must be ${max} characters or fewer.`,
    invalidEmail: "Enter a valid email address.",
  },
  a11y: {
    skipToContent: "Skip to content",
    overdueIcon: "Overdue",
    decorativeFog: "Decorative background",
  },
} satisfies CopyDictionary;
