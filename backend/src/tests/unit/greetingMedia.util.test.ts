/// <reference types="jest" />

import {
  buildGreetingMediaComponents,
  mergeGreetingMediaComponents,
  parseGreetingMediaItems,
  shouldAttachGreetingMedia,
} from '../../utils/greetingMedia.util';

describe('greetingMedia.util', () => {
  test('parseGreetingMediaItems accepts image and brochure entries', () => {
    const items = parseGreetingMediaItems([
      {
        id: 'img-1',
        kind: 'image',
        url: 'https://cdn.example.com/hero.jpg',
        mimeType: 'image/jpeg',
      },
      {
        id: 'pdf-1',
        kind: 'document',
        url: 'https://cdn.example.com/brochure.pdf',
        mimeType: 'application/pdf',
        fileName: 'brochure.pdf',
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe('image');
    expect(items[1].fileName).toBe('brochure.pdf');
  });

  test('buildGreetingMediaComponents prioritizes brochure before image', () => {
    const components = buildGreetingMediaComponents([
      { id: '1', kind: 'image', url: 'https://cdn.example.com/a.jpg', mimeType: 'image/jpeg' },
      { id: '2', kind: 'document', url: 'https://cdn.example.com/b.pdf', mimeType: 'application/pdf' },
    ]);

    expect(components).toHaveLength(2);
    expect(components[0].kind).toBe('media');
    if (components[0].kind === 'media') {
      expect(components[0].mime).toBe('application/pdf');
    }
  });

  test('shouldAttachGreetingMedia only on first contact without active visit', () => {
    const media = [{ id: '1', kind: 'image', url: 'https://cdn.example.com/a.jpg', mimeType: 'image/jpeg' }];

    expect(shouldAttachGreetingMedia({ isReturning: false, hasActiveVisit: false, greetingMedia: media })).toBe(true);
    expect(shouldAttachGreetingMedia({ isReturning: true, hasActiveVisit: false, greetingMedia: media })).toBe(false);
    expect(shouldAttachGreetingMedia({ isReturning: false, hasActiveVisit: true, greetingMedia: media })).toBe(false);
  });

  test('mergeGreetingMediaComponents prepends media to buttons', () => {
    const merged = mergeGreetingMediaComponents(
      [{ id: '1', kind: 'image', url: 'https://cdn.example.com/a.jpg', mimeType: 'image/jpeg' }],
      [{ kind: 'buttons', buttons: [{ id: 'browse', title: 'Browse' }] }],
      { isReturning: false, hasActiveVisit: false },
    );

    expect(merged[0].kind).toBe('media');
    expect(merged[1].kind).toBe('buttons');
  });
});
