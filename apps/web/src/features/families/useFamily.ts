import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { FamilyDetail, FamilyRole } from '../../api/types';

export interface FamilyContextData {
  family: FamilyDetail;
  myRole: FamilyRole;
}

export function useFamily(fid: string | undefined) {
  return useQuery({
    queryKey: ['family', fid],
    queryFn: () => api.get<FamilyContextData>(`/families/${fid}`),
    enabled: Boolean(fid),
  });
}

export function canManageMembers(role: FamilyRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function canCreateItem(role: FamilyRole | undefined): boolean {
  return role !== undefined && role !== 'viewer';
}

