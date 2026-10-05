import type { FamilyRole, Visibility, ItemStatus } from './enums';

export const ACTIONS = [
  'family:read',
  'family:update',
  'family:delete',
  'family:export',
  'member:read',
  'member:manage',
  'invite:manage',
  'person:read',
  'person:write',
  'person:delete',
  'item:create',
  'item:updateOwn',
  'item:updateAny',
  'item:deleteOwn',
  'item:deleteAny',
  'item:purge',
  'media:write',
  'note:create',
  'note:moderate',
  'note:deleteAny',
  'audit:read',
  'share:manage',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * 家庭角色 → 动作 的能力矩阵。
 * 这是全项目唯一的权限判定来源：路由与前端都用它，禁止在别处硬编码角色判断。
 */
const M: Record<Action, readonly FamilyRole[]> = {
  'family:read': ['owner', 'admin', 'editor', 'contributor', 'viewer'],
  'family:update': ['owner', 'admin'],
  'family:delete': ['owner'],
  'family:export': ['owner', 'admin'],
  'member:read': ['owner', 'admin', 'editor', 'contributor', 'viewer'],
  'member:manage': ['owner', 'admin'],
  'invite:manage': ['owner', 'admin'],
  'person:read': ['owner', 'admin', 'editor', 'contributor', 'viewer'],
  'person:write': ['owner', 'admin', 'editor'],
  'person:delete': ['owner', 'admin'],
  'item:create': ['owner', 'admin', 'editor', 'contributor'],
  'item:updateOwn': ['owner', 'admin', 'editor', 'contributor'],
  'item:updateAny': ['owner', 'admin'],
  'item:deleteOwn': ['owner', 'admin', 'editor', 'contributor'],
  'item:deleteAny': ['owner', 'admin'],
  'item:purge': ['owner', 'admin'],
  'media:write': ['owner', 'admin', 'editor', 'contributor'],
  'note:create': ['owner', 'admin', 'editor', 'contributor'],
  'note:moderate': ['owner', 'admin', 'editor'],
  'note:deleteAny': ['owner', 'admin'],
  'audit:read': ['owner', 'admin'],
  'share:manage': ['owner', 'admin', 'editor'],
};

export function roleCan(role: FamilyRole, action: Action): boolean {
  return M[action].includes(role);
}

/** 邀请与改角色时可授予的目标角色：admin 不能造出与自己同级或更高的人。 */
export function assignableRoles(actorRole: FamilyRole): FamilyRole[] {
  if (actorRole === 'owner') return ['admin', 'editor', 'contributor', 'viewer'];
  if (actorRole === 'admin') return ['editor', 'contributor', 'viewer'];
  return [];
}

export function canAssignRole(actorRole: FamilyRole, targetRole: FamilyRole): boolean {
  return assignableRoles(actorRole).includes(targetRole);
}

/** 能否管理某个成员（改角色/移除）。管理员不能动 owner 与其他 admin。 */
export function canManageMember(actorRole: FamilyRole, targetRole: FamilyRole): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner';
  if (actorRole === 'admin') return targetRole !== 'owner' && targetRole !== 'admin';
  return false;
}

export interface ItemAccessInput {
  role: FamilyRole;
  userId: string;
  createdBy: string;
  status: ItemStatus;
  visibility: Visibility;
  sharedWithMe?: { canEdit: boolean } | null;
}

export interface ItemAccess {
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  canManageMedia: boolean;
}

/**
 * 条目级权限判定，对应项目文档 4.4 的判定顺序。
 * 注意：非法访问一律返回 canRead=false，调用方应统一映射为 404，避免暴露资源是否存在。
 */
export function itemAccess(input: ItemAccessInput): ItemAccess {
  const { role, userId, createdBy, status, visibility, sharedWithMe } = input;
  const isCreator = userId === createdBy;
  const isPrivileged = role === 'owner' || role === 'admin';
  const shared = Boolean(sharedWithMe);

  let canRead: boolean;
  if (status === 'trashed') {
    canRead = isPrivileged || isCreator;
  } else if (status === 'draft') {
    canRead = isPrivileged || isCreator;
  } else if (isPrivileged || isCreator) {
    canRead = true;
  } else if (visibility === 'family' || visibility === 'link') {
    canRead = true;
  } else {
    canRead = shared;
  }

  if (!canRead) {
    return { canRead: false, canEdit: false, canDelete: false, canComment: false, canManageMedia: false };
  }

  // 回收站是特例：内容只读，但创建者/管理员必须能把它恢复或彻底删除。
  if (status === 'trashed') {
    const canRestore = isPrivileged || (isCreator && roleCan(role, 'item:deleteOwn'));
    return {
      canRead: true,
      canEdit: false,
      canDelete: canRestore,
      canComment: false,
      canManageMedia: false,
    };
  }

  const editable = status === 'published' || status === 'draft' || status === 'archived';
  const canEditAny = roleCan(role, 'item:updateAny');
  const canEditOwn = roleCan(role, 'item:updateOwn') && isCreator;
  const canEditShared = Boolean(sharedWithMe?.canEdit) && roleCan(role, 'item:updateOwn');
  const canEdit = editable && (canEditAny || canEditOwn || canEditShared);

  const canDelete = editable && (roleCan(role, 'item:deleteAny') || (isCreator && roleCan(role, 'item:deleteOwn')));

  const canComment = status === 'published' && roleCan(role, 'note:create');

  return {
    canRead: true,
    canEdit,
    canDelete,
    canComment,
    canManageMedia: canEdit,
  };
}
