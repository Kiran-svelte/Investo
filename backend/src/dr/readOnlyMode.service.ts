import config from '../config';

export class ReadOnlyModeService {
  isEnabled(): boolean {
    return config.features.readOnlyMode === true;
  }

  getReason(): string {
    return process.env.READ_ONLY_MODE_REASON || 'Disaster recovery maintenance';
  }
}

export const readOnlyModeService = new ReadOnlyModeService();
