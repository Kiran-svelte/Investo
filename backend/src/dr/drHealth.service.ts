export interface DrHealthSnapshot {
  backup_age_hours: number | null;
  backup_last_success_at: string | null;
  read_only_mode: boolean;
  primary_region: string;
}

export class DrHealthService {
  getBackupLastSuccessAt(): Date | null {
    const raw = process.env.BACKUP_LAST_SUCCESS_AT || process.env.DR_BACKUP_LAST_SUCCESS_AT;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  getBackupAgeHours(): number | null {
    const last = this.getBackupLastSuccessAt();
    if (!last) return null;
    return Math.round((Date.now() - last.getTime()) / 3_600_000);
  }

  getPrimaryRegion(): string {
    return process.env.DR_PRIMARY_REGION || process.env.AWS_REGION || 'ap-south-1';
  }

  buildSnapshot(readOnlyMode: boolean): DrHealthSnapshot {
    const last = this.getBackupLastSuccessAt();
    return {
      backup_age_hours: this.getBackupAgeHours(),
      backup_last_success_at: last ? last.toISOString() : null,
      read_only_mode: readOnlyMode,
      primary_region: this.getPrimaryRegion(),
    };
  }
}

export const drHealthService = new DrHealthService();
