// Serializable DTOs passed from server components to client components.
// (Prisma Date objects are converted to ISO strings so they cross the boundary.)

export type UserDTO = {
  id: string;
  name: string;
  email: string;
  color: string;
  avatarUrl: string | null;
  title: string | null;
};

export type LabelDTO = { id: string; name: string; color: string };

export type StatusDTO = {
  id: string;
  name: string;
  category: string;
  color: string;
  order: number;
};

export type IssueDTO = {
  id: string;
  key: string;
  number: number;
  projectId: string;
  projectKey: string;
  projectName: string;
  type: string;
  title: string;
  descMd: string;
  expected: string;
  actual: string;
  steps: string;
  url: string;
  priority: string;
  severity: string;
  impact: string;
  environment: string;
  status: StatusDTO;
  reporter: UserDTO;
  assignees: UserDTO[];
  labels: LabelDTO[];
  componentName: string | null;
  releaseVersion: string | null;
  sprintName: string | null;
  storyPoints: number | null;
  estimateMin: number | null;
  dueDate: string | null;
  boardOrder: number;
  commentCount: number;
  attachmentCount: number;
  watcherCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type ProjectDTO = {
  id: string;
  key: string;
  name: string;
  color: string;
  icon: string;
};

export type ProjectConfigDTO = ProjectDTO & {
  statuses: StatusDTO[];
  labels: LabelDTO[];
  components: { id: string; name: string }[];
  releases: { id: string; version: string }[];
};

export type WorkspaceData = {
  orgName: string;
  orgColor: string;
  currentUser: UserDTO | null;
  /** organization role of the signed-in user: owner | admin | member | guest */
  orgRole: string;
  /** capabilities granted at org level — used to gate UI controls */
  capabilities: string[];
  members: UserDTO[];
  projects: ProjectConfigDTO[];
  counts: Record<string, number>; // issues open, keyed by module group
  unread: number;
};

export type CommentDTO = {
  id: string;
  author: UserDTO;
  bodyMd: string;
  isPinned: boolean;
  isPrivate: boolean;
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
};

export type AttachmentDTO = {
  id: string;
  name: string;
  kind: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
};

export type ActivityDTO = {
  id: string;
  actor: UserDTO | null;
  verb: string;
  field: string | null;
  fromVal: string | null;
  toVal: string | null;
  createdAt: string;
};

export type TimeLogDTO = {
  id: string;
  user: UserDTO | null;
  minutes: number;
  note: string;
  spentAt: string;
};

export type IssueDetailDTO = IssueDTO & {
  comments: CommentDTO[];
  attachments: AttachmentDTO[];
  activities: ActivityDTO[];
  timeLogs: TimeLogDTO[];
  reporterId: string;
  contextJson: string;
  browser: string;
  os: string;
  device: string;
  appVersion: string;
  gitCommit: string;
  watching: boolean;
};
