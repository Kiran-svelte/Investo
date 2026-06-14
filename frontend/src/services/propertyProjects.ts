import api from './api';

export interface PropertyProject {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  property_count: number;
  draft_count: number;
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface PropertyProjectFile {
  id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

export async function listPropertyProjects(): Promise<{
  projects: PropertyProject[];
  unassigned_property_count: number;
}> {
  const res = await api.get<{ data: PropertyProject[]; unassigned_property_count: number }>(
    '/property-projects',
  );
  return {
    projects: res.data.data ?? [],
    unassigned_property_count: res.data.unassigned_property_count ?? 0,
  };
}

export async function createPropertyProject(input: {
  name: string;
  description?: string | null;
}): Promise<PropertyProject> {
  const res = await api.post<{ data: PropertyProject }>('/property-projects', input);
  return res.data.data;
}

export async function updatePropertyProject(
  id: string,
  input: { name?: string; description?: string | null },
): Promise<PropertyProject> {
  const res = await api.put<{ data: PropertyProject }>(`/property-projects/${id}`, input);
  return res.data.data;
}

export async function deletePropertyProject(id: string): Promise<void> {
  await api.delete(`/property-projects/${id}`);
}

export async function assignPropertyToProject(
  propertyId: string,
  projectId: string | null,
): Promise<void> {
  await api.patch(`/property-projects/assign-property/${propertyId}`, {
    project_id: projectId,
  });
}

export async function listProjectFiles(projectId: string): Promise<PropertyProjectFile[]> {
  const res = await api.get<{ data: PropertyProjectFile[] }>(`/property-projects/${projectId}/files`);
  return res.data.data ?? [];
}

export async function uploadProjectFile(projectId: string, file: File): Promise<PropertyProjectFile> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<{ data: PropertyProjectFile }>(
    `/property-projects/${projectId}/files`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data.data;
}

export async function deletePropertyProjectFile(projectId: string, fileId: string): Promise<void> {
  await api.delete(`/property-projects/${projectId}/files/${fileId}`);
}

export type PropertyMediaRole = 'screenshot' | 'brochure';

export interface AttachPropertyMediaResult {
  public_url: string;
  media_role: PropertyMediaRole;
  knowledge_indexed: boolean;
  knowledge_chunk_count: number;
  property?: {
    images?: string[] | string;
    brochure_url?: string | null;
  };
}

export async function attachPropertyMedia(
  projectId: string,
  propertyId: string,
  file: File,
  mediaRole: PropertyMediaRole,
): Promise<AttachPropertyMediaResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('media_role', mediaRole);
  const res = await api.post<{ data: AttachPropertyMediaResult & { property?: AttachPropertyMediaResult['property'] } }>(
    `/property-projects/${projectId}/properties/${propertyId}/media`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  const body = res.data.data;
  return {
    public_url: body.public_url,
    media_role: body.media_role,
    knowledge_indexed: body.knowledge_indexed,
    knowledge_chunk_count: body.knowledge_chunk_count,
    property: body.property,
  };
}
