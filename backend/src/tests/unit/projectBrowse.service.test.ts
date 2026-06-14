import {
  buildProjectSelectListComponent,
  buildProjectPropertyListComponent,
  buildPropertyDetailButtons,
  formatProjectCatalogIntro,
  formatProjectSelectedIntro,
} from '../../services/projectBrowse.service';

describe('projectBrowse.service', () => {
  const sampleProjects = [
    {
      id: 'proj-investo',
      name: 'investo',
      description: null,
      propertyCount: 19,
      propertyTypes: ['apartment'],
      locationLabel: 'Hyderabad',
      priceLabel: '₹81.0L–₹140.0L',
    },
  ];

  it('buildProjectSelectListComponent uses project-select ids not property ids', () => {
    const list = buildProjectSelectListComponent(sampleProjects);
    expect(list.kind).toBe('list');
    if (list.kind !== 'list') throw new Error('expected list');
    expect(list.sections[0].rows[0].id).toBe('project-select-proj-investo');
    expect(list.sections[0].rows[0].title).toBe('investo');
  });

  it('buildProjectPropertyListComponent uses more-info property ids', () => {
    const list = buildProjectPropertyListComponent('proj-investo', 'investo', [
      {
        id: 'prop-lake-801',
        name: 'Lake Vista 801',
        propertyType: 'apartment',
        locationArea: 'Kondapur',
        locationCity: 'Hyderabad',
        priceMin: 13000000,
        priceMax: 14000000,
        bedrooms: 3,
        brochureUrl: null,
        images: [],
      },
    ]);
    if (list.kind !== 'list') throw new Error('expected list');
    expect(list.sections[0].rows[0].id).toBe('more-info-prop-lake-801');
    expect(list.sections[0].rows[0].title).toBe('Lake Vista 801');
  });

  it('buildPropertyDetailButtons includes view listings when projectId set', () => {
    const buttons = buildPropertyDetailButtons('prop-1', 'proj-investo', 'en');
    expect(buttons.kind).toBe('buttons');
    if (buttons.kind !== 'buttons') throw new Error('expected buttons');
    expect(buttons.buttons.map((b) => b.id)).toEqual([
      'book-visit-prop-1',
      'call-me',
      'project-properties-proj-investo',
    ]);
  });

  it('formatProjectCatalogIntro mentions project not individual units', () => {
    const text = formatProjectCatalogIntro(sampleProjects, 'en');
    expect(text).toContain('investo');
    expect(text).toContain('19');
    expect(text).not.toContain('Lake Vista');
  });

  it('formatProjectSelectedIntro includes project name and count', () => {
    const text = formatProjectSelectedIntro('investo', 19, 'en');
    expect(text).toContain('investo');
    expect(text).toContain('19');
  });
});
