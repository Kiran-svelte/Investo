import { sanitizeImportRow, sanitizeImportRows } from '../../utils/sanitizeImportRow.util';
import { bulkImportRawRowsSchema } from '../../utils/bulkImportValidation.util';
import { csvImportService } from '../../services/csv-import.service';
import fs from 'fs';
import path from 'path';

describe('sanitizeImportRow', () => {
  it('strips PapaParse __parsed_extra and coerces cells to strings', () => {
    const row = sanitizeImportRow({
      project_name: 'Commercial Hub',
      description: 'Ground floor retail',
      __parsed_extra: [''],
    });

    expect(row).toEqual({
      project_name: 'Commercial Hub',
      description: 'Ground floor retail',
    });
    expect(row.__parsed_extra).toBeUndefined();
  });

  it('joins array cell values with commas', () => {
    const row = sanitizeImportRow({
      amenities: ['Pool', 'Gym'],
    });

    expect(row.amenities).toBe('Pool, Gym');
  });
});

describe('bulkImportRawRowsSchema', () => {
  it('accepts rows with __parsed_extra after transform', () => {
    const parsed = bulkImportRawRowsSchema().parse([
      {
        project_name: 'Sunset Heights',
        __parsed_extra: [''],
      },
    ]);

    expect(parsed[0]).toEqual({ project_name: 'Sunset Heights' });
  });
});

describe('csvImportService.parseFile', () => {
  it('parses investo-property-master.csv without __parsed_extra in rows', async () => {
    const csvPath = path.join(__dirname, '../../../../docs/investo-property-master.csv');
    const buffer = fs.readFileSync(csvPath);
    const result = await csvImportService.parseFile(buffer, 'text/csv');

    expect(result.rowCount).toBeGreaterThan(0);
    for (const row of result.rows) {
      for (const value of Object.values(row)) {
        expect(typeof value).toBe('string');
      }
      expect(row.__parsed_extra).toBeUndefined();
    }
  });
});
