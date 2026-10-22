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
    signUp: string;
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
    general: string;
    saved: string;
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
    unauthenticated: string;
    somethingWrong: string;
    tryAgain: string;
  };
  validation: {
    required: string;
    tooLong: (max: number) => string;
    invalidEmail: string;
  };
  auth: {
    signInHeading: string;
    signInHelp: string;
    signUpHeading: string;
    signUpHelp: string;
    emailLabel: string;
    emailPlaceholder: string;
    sendLinkSignIn: string;
    sendLinkSignUp: string;
    sending: string;
    checkEmailHeading: string;
    checkEmailBody: (email: string) => string;
    noAccount: string;
    hasAccount: string;
    linkFailed: string;
  };
  onboarding: {
    heading: string;
    help: string;
    workspaceNameLabel: string;
    workspaceNamePlaceholder: string;
    slugLabel: string;
    slugHelp: string;
    slugInvalid: string;
    slugReserved: string;
    slugTaken: string;
    create: string;
    creating: string;
    created: (name: string) => string;
  };
  members: {
    heading: string;
    tableName: string;
    tableEmail: string;
    tableRole: string;
    tableJoined: string;
    tableActions: string;
    inviteHeading: string;
    emailLabel: string;
    roleLabel: string;
    sendInvite: string;
    sendingInvite: string;
    pendingInvites: string;
    pendingEmpty: string;
    expires: (date: string) => string;
    expired: string;
    revoke: string;
    resend: string;
    changeRole: string;
    you: string;
    readOnlyNote: string;
    removeMember: string;
    leave: string;
    removeConfirmTitle: (name: string) => string;
    removeConfirmBody: string;
    leaveConfirmTitle: string;
    leaveConfirmBody: string;
    revokeConfirmTitle: (email: string) => string;
    revokeConfirmBody: string;
    inviteSent: (email: string) => string;
    inviteResent: (email: string) => string;
    inviteRevoked: string;
    roleChanged: string;
    memberRemoved: string;
    left: string;
    alreadyMember: string;
    lastOwner: string;
    hasRituals: string;
    roleNotAllowed: string;
    loadFailed: string;
    retry: string;
  };
  invite: {
    heading: (workspaceName: string) => string;
    asRole: (role: string) => string;
    accept: string;
    accepting: string;
    signInToAccept: string;
    mismatchHeading: string;
    mismatchBody: (invited: string, current: string) => string;
    switchAccount: string;
    expired: string;
    revoked: string;
    used: string;
    notFound: string;
    backHome: string;
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
    switchWorkspace: string;
    signedInAs: string;
  };
  a11y: {
    skipToContent: string;
    overdueIcon: string;
    decorativeFog: string;
    loading: string;
    toastRegion: string;
    openMenu: string;
    closeMenu: string;
  };
}
