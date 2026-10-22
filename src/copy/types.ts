export type SkinKey = "haunted" | "professional";

export type SeverityLevel = 1 | 2 | 3 | 4 | 5;
export type IncidentStatusKey =
  | "INVESTIGATING"
  | "IDENTIFIED"
  | "MITIGATING"
  | "RESOLVED";
export type IncidentRoleKey = "COMMANDER" | "SCRIBE" | "COMMS";
export type WorkspaceRoleKey = "OWNER" | "ADMIN" | "MEMBER";
export type ActionStatusKey = "OPEN" | "IN_PROGRESS" | "DONE";
export type PostmortemStatusKey = "DRAFT" | "PUBLISHED";
export type PostmortemSectionKey =
  | "CAUSE"
  | "LAST_SIGHTING"
  | "WITNESSES"
  | "LEARNED";

export const EMPTY_KEYS = [
  "incidents",
  "timeline",
  "postmortems",
  "rituals",
  "myRituals",
  "revenants",
  "members",
  "dashboardOverdue",
] as const;
export type EmptyKey = (typeof EMPTY_KEYS)[number];

/**
 * Single source of truth for every user-facing string. Both skins must
 * `satisfies CopyDictionary`, so a missing key fails the typecheck.
 * Parameterised strings are functions; never concatenate in components.
 */
export interface CopyDictionary {
  brand: { name: string; tagline: string };
  nav: {
    dashboard: string;
    incidents: string;
    rituals: string;
    myRituals: string;
    settings: string;
    members: string;
    retroRules: string;
    billing: string;
    signIn: string;
    signOut: string;
  };
  incident: {
    singular: string;
    plural: string;
    newIncident: string;
    title: string;
    summary: string;
    severity: string;
    status: string;
    services: string;
    roles: string;
    timeline: string;
    addNote: string;
    notePlaceholder: string;
    number: (n: number) => string;
  };
  severity: Record<SeverityLevel, string>;
  status: Record<IncidentStatusKey, string>;
  incidentRole: Record<IncidentRoleKey, string>;
  workspaceRole: Record<WorkspaceRoleKey, string>;
  postmortem: {
    singular: string;
    plural: string;
    draft: string;
    published: string;
    publish: string;
    statusLabel: Record<PostmortemStatusKey, string>;
    sections: Record<PostmortemSectionKey, { title: string; prompt: string }>;
    blamelessNote: string;
    missingForRule: (severityName: string) => string;
  };
  ritual: {
    singular: string;
    plural: string;
    mine: string;
    owner: string;
    dueDate: string;
    overdue: string;
    overdueBy: (days: number) => string;
    dueIn: (days: number) => string;
    statusLabel: Record<ActionStatusKey, string>;
    newRitual: string;
  };
  revenant: {
    singular: string;
    plural: string;
    suggestionHeading: string;
    link: string;
    hauntedNTimes: (n: number) => string;
  };
  empty: Record<EmptyKey, readonly [string, ...string[]]>;
  dashboard: {
    heading: string;
    openIncidents: string;
    overdueRituals: string;
    revenantCount: string;
    mttr: string;
    incidentsPerMonth: string;
    mttrValue: (minutes: number | null) => string;
  };
  settings: {
    heading: string;
    workspaceName: string;
    skin: string;
    skinHaunted: string;
    skinProfessional: string;
    switchSkinTo: (skinName: string) => string;
    severityNames: string;
    severityNamesHelp: string;
    retroRule: string;
    retroRuleHelp: (severityName: string) => string;
    plan: string;
    planName: Record<"FREE" | "TEAM" | "BUSINESS", string>;
    planLine: (planName: string) => string;
    save: string;
  };
  actions: {
    create: string;
    cancel: string;
    delete: string;
    invite: string;
    remove: string;
    confirm: string;
  };
  errors: {
    generic: string;
    notFound: string;
    forbidden: string;
  };
  validation: {
    required: string;
    tooLong: (max: number) => string;
    invalidEmail: string;
  };
  auth: {
    signInHeading: string;
    signInHelp: string;
    emailLabel: string;
    emailPlaceholder: string;
    sendLink: string;
    sending: string;
    checkEmailHeading: string;
    checkEmailBody: (email: string) => string;
    linkFailed: string;
  };
  onboarding: {
    heading: string;
    help: string;
    workspaceNameLabel: string;
    workspaceNamePlaceholder: string;
    create: string;
  };
  members: {
    heading: string;
    inviteHeading: string;
    emailLabel: string;
    roleLabel: string;
    pendingInvites: string;
    expires: (date: string) => string;
    revoke: string;
    changeRole: string;
    you: string;
    inviteSent: (email: string) => string;
    alreadyMember: string;
    lastOwner: string;
    hasRituals: string;
    roleNotAllowed: string;
    updated: string;
  };
  invite: {
    heading: (workspaceName: string) => string;
    asRole: (role: string) => string;
    accept: string;
    signInToAccept: string;
    wrongAccount: (invited: string) => string;
    expired: string;
    used: string;
    notFound: string;
  };
  email: {
    magicLinkSubject: string;
    magicLinkBody: string;
    magicLinkButton: string;
    inviteSubject: (workspaceName: string) => string;
    inviteBody: (workspaceName: string, role: string) => string;
    inviteButton: string;
    ignoreIfNotYou: string;
  };
  userMenu: {
    account: string;
    workspaces: string;
    newWorkspace: string;
  };
  a11y: {
    skipToContent: string;
    overdueIcon: string;
    decorativeFog: string;
  };
}
