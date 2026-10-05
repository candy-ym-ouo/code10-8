import { describe, expect, it } from 'vitest';
import { ACTIONS, FAMILY_ROLES } from './index';
import { canAssignRole, canManageMember, itemAccess, roleCan } from './permissions';
import type { FamilyRole } from './enums';

const ROLES: FamilyRole[] = ['owner', 'admin', 'editor', 'contributor', 'viewer'];

describe('角色能力矩阵', () => {
  it('每个动作都显式声明了允许的角色（防止新增动作时漏配）', () => {
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        expect(typeof roleCan(role, action)).toBe('boolean');
      }
    }
    expect(FAMILY_ROLES).toHaveLength(5);
  });

  it('只有 owner 能删除家庭、只有 owner/admin 能导出与看审计', () => {
    expect(roleCan('admin', 'family:delete')).toBe(false);
    expect(roleCan('owner', 'family:delete')).toBe(true);
    expect(roleCan('editor', 'family:export')).toBe(false);
    expect(roleCan('admin', 'family:export')).toBe(true);
    expect(roleCan('editor', 'audit:read')).toBe(false);
  });

  it('viewer 没有任何写权限', () => {
    const writeActions = ACTIONS.filter((a) => /:(create|write|update|delete|manage|moderate|purge)/.test(a.replace('item:updateOwn', 'item:update').replace('item:deleteOwn', 'item:delete')));
    for (const action of writeActions) {
      if (action === 'note:create') continue; // viewer 评论由家庭开关单独控制，路由层再判
      expect(roleCan('viewer', action), `${action} 不应允许 viewer`).toBe(false);
    }
  });
});

describe('角色授予与管理边界', () => {
  it('admin 不能授予 admin/owner', () => {
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'editor')).toBe(true);
    expect(canAssignRole('owner', 'admin')).toBe(true);
  });

  it('admin 不能改动 owner 或其他 admin', () => {
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('admin', 'contributor')).toBe(true);
    expect(canManageMember('owner', 'admin')).toBe(true);
    expect(canManageMember('editor', 'viewer')).toBe(false);
  });
});

const base = { userId: 'u1', createdBy: 'u1', status: 'published' as const };

describe('itemAccess 可见性与可写性', () => {
  it('family 公开：所有成员可读，viewer 不可写', () => {
    const viewer = itemAccess({ ...base, role: 'viewer', visibility: 'family' });
    expect(viewer.canRead).toBe(true);
    expect(viewer.canEdit).toBe(false);
    expect(viewer.canDelete).toBe(false);
  });

  it('private 条目：非创建者且无授权时不可读（路由会映射成 404）', () => {
    const other = itemAccess({ ...base, userId: 'u2', role: 'contributor', visibility: 'private' });
    expect(other.canRead).toBe(false);
    const owner = itemAccess({ ...base, userId: 'u9', role: 'owner', visibility: 'private' });
    expect(owner.canRead).toBe(true);
  });

  it('selected 条目：被授权成员可读，只有 canEdit 时才能改', () => {
    const readOnly = itemAccess({
      ...base,
      userId: 'u2',
      role: 'contributor',
      visibility: 'selected',
      sharedWithMe: { canEdit: false },
    });
    expect(readOnly.canRead).toBe(true);
    expect(readOnly.canEdit).toBe(false);

    const editable = itemAccess({
      ...base,
      userId: 'u2',
      role: 'contributor',
      visibility: 'selected',
      sharedWithMe: { canEdit: true },
    });
    expect(editable.canEdit).toBe(true);
  });

  it('editor 能改自己创建的条目，但不能改别人创建的家庭公开条目', () => {
    expect(itemAccess({ ...base, role: 'editor', visibility: 'family' }).canEdit).toBe(true);
    expect(itemAccess({ ...base, userId: 'u2', role: 'editor', visibility: 'family' }).canEdit).toBe(false);
  });

  it('admin 可强制编辑他人条目', () => {
    expect(itemAccess({ ...base, userId: 'u2', role: 'admin', visibility: 'family' }).canEdit).toBe(true);
  });

  it('草稿与回收站只有创建者和管理员可见', () => {
    expect(itemAccess({ ...base, userId: 'u2', role: 'contributor', visibility: 'family', status: 'draft' }).canRead).toBe(false);
    expect(itemAccess({ ...base, userId: 'u2', role: 'contributor', visibility: 'family', status: 'trashed' }).canRead).toBe(false);
    expect(itemAccess({ ...base, userId: 'u2', role: 'admin', visibility: 'private', status: 'trashed' }).canRead).toBe(true);
  });

  it('回收站里的条目：创建者能恢复，别人不能，且都不能直接编辑', () => {
    const creator = itemAccess({ ...base, role: 'contributor', visibility: 'family', status: 'trashed' });
    expect(creator.canRead).toBe(true);
    expect(creator.canDelete).toBe(true); // 恢复/彻底删除依赖该位
    expect(creator.canEdit).toBe(false);

    const other = itemAccess({ ...base, userId: 'u2', role: 'editor', visibility: 'family', status: 'trashed' });
    expect(other.canRead).toBe(false);
    expect(other.canDelete).toBe(false);

    const admin = itemAccess({ ...base, userId: 'u9', role: 'admin', visibility: 'family', status: 'trashed' });
    expect(admin.canRead).toBe(true);
    expect(admin.canDelete).toBe(true);

    const viewer = itemAccess({ ...base, role: 'viewer', visibility: 'family', status: 'trashed' });
    expect(viewer.canRead).toBe(true); // 自己的条目仍可见
    expect(viewer.canDelete).toBe(false);
  });
});
