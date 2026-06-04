import api from './api';

export async function deleteLead(id: string): Promise<void> {
  await api.delete(`/leads/${id}`);
}

export async function deleteConversation(id: string): Promise<void> {
  await api.delete(`/conversations/${id}`);
}

export async function deleteVisit(id: string): Promise<void> {
  await api.delete(`/visits/${id}`);
}

export async function deleteNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

export async function deleteAllNotifications(): Promise<number> {
  const { data } = await api.delete<{ deleted?: number }>('/notifications/all');
  return data.deleted ?? 0;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}

export async function deleteCompany(id: string): Promise<void> {
  await api.delete(`/companies/${id}`);
}

export async function deletePropertyProjectFile(projectId: string, fileId: string): Promise<void> {
  await api.delete(`/property-projects/${projectId}/files/${fileId}`);
}
