import { describe, expect, test, vi } from 'vitest';

import { validateLearningUnit, validateLearningUnitDraft } from './validation.js';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

function makeFormData(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    if (Array.isArray(val)) {
      for (const v of val) {
        fd.append(key, v);
      }
    } else {
      fd.set(key, val);
    }
  }
  return fd;
}

const BASE_DRAFT = {
  title: 'Test Unit',
  summary: 'A summary',
  objectives: 'Learn stuff',
  createdBy: 'Author',
  collectionId: 'some-collection-id',
};

const BASE_PUBLISH = {
  ...BASE_DRAFT,
  tags: 'tag-id-1',
  sources: JSON.stringify([{ title: 'Src', sourceURL: 'https://example.com', tagId: 'tag-1' }]),
  questionAnswers: JSON.stringify([]),
};

describe('validateLearningUnitDraft - contents', () => {
  test('accepts VIDEO item with valid URL', () => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      contents: JSON.stringify([{ type: 'VIDEO', url: 'https://example.com/video/123' }]),
    });
    const result = validateLearningUnitDraft(fd);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contents[0].type).toBe('VIDEO');
      expect(result.data.contents[0].url).toBe('https://example.com/video/123');
    }
  });

  test('accepts PODCAST item with valid URL', () => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      contents: JSON.stringify([{ type: 'PODCAST', url: 'https://example.com/audio.mp3' }]),
    });
    expect(validateLearningUnitDraft(fd).success).toBe(true);
  });

  test('accepts empty contents in draft', () => {
    const fd = makeFormData({ ...BASE_DRAFT, contents: JSON.stringify([]) });
    expect(validateLearningUnitDraft(fd).success).toBe(true);
  });

  test('rejects VIDEO item with empty URL', () => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      contents: JSON.stringify([{ type: 'VIDEO', url: '' }]),
    });
    expect(validateLearningUnitDraft(fd).success).toBe(false);
  });

  test('rejects invalid content type', () => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      contents: JSON.stringify([{ type: 'PDF', url: 'https://example.com/file.pdf' }]),
    });
    expect(validateLearningUnitDraft(fd).success).toBe(false);
  });
});

describe('validateLearningUnit - contents', () => {
  test('requires at least one content item for publish', () => {
    const fd = makeFormData({ ...BASE_PUBLISH, contents: JSON.stringify([]) });
    const result = validateLearningUnit(fd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.contents).toBeDefined();
    }
  });

  test('accepts VIDEO content item for publish', () => {
    const fd = makeFormData({
      ...BASE_PUBLISH,
      contents: JSON.stringify([{ type: 'VIDEO', url: 'https://example.com/video/987654321' }]),
    });
    expect(validateLearningUnit(fd).success).toBe(true);
  });

  test('rejects PODCAST item with invalid URL for publish', () => {
    const fd = makeFormData({
      ...BASE_PUBLISH,
      contents: JSON.stringify([{ type: 'PODCAST', url: 'not-a-url' }]),
    });
    expect(validateLearningUnit(fd).success).toBe(false);
  });

  test('accepts multiple content items', () => {
    const fd = makeFormData({
      ...BASE_PUBLISH,
      contents: JSON.stringify([
        { type: 'VIDEO', url: 'https://example.com/video/123' },
        { type: 'PODCAST', url: 'https://example.com/audio.mp3' },
      ]),
    });
    expect(validateLearningUnit(fd).success).toBe(true);
  });
});

const UNSAFE_URLS = [
  'javascript:alert(document.cookie)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

describe('URL scheme validation', () => {
  test.each(UNSAFE_URLS)('draft rejects content URL with scheme: %s', (url) => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      contents: JSON.stringify([{ type: 'VIDEO', url }]),
    });
    const result = validateLearningUnitDraft(fd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.contents?.items?.[0].url).toBeDefined();
    }
  });

  test.each(UNSAFE_URLS)('draft rejects source URL with scheme: %s', (url) => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      sources: JSON.stringify([{ title: 'Read more', sourceURL: url, tagId: 'tag-1' }]),
    });
    const result = validateLearningUnitDraft(fd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.sources?.items?.[0].sourceURL).toBeDefined();
    }
  });

  test.each(UNSAFE_URLS)('publish rejects content URL with scheme: %s', (url) => {
    const fd = makeFormData({
      ...BASE_PUBLISH,
      contents: JSON.stringify([{ type: 'VIDEO', url }]),
    });
    expect(validateLearningUnit(fd).success).toBe(false);
  });

  test.each(UNSAFE_URLS)('publish rejects source URL with scheme: %s', (url) => {
    const fd = makeFormData({
      ...BASE_PUBLISH,
      contents: JSON.stringify([{ type: 'VIDEO', url: 'https://example.com/video/123' }]),
      sources: JSON.stringify([{ title: 'Read more', sourceURL: url, tagId: 'tag-1' }]),
    });
    const result = validateLearningUnit(fd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.sources?.items?.[0].sourceURL).toBeDefined();
    }
  });

  test('draft accepts an http source URL', () => {
    const fd = makeFormData({
      ...BASE_DRAFT,
      sources: JSON.stringify([
        { title: 'Read more', sourceURL: 'http://example.com/a', tagId: 'tag-1' },
      ]),
    });
    expect(validateLearningUnitDraft(fd).success).toBe(true);
  });

  test('publish accepts an https source URL', () => {
    const fd = makeFormData({
      ...BASE_PUBLISH,
      contents: JSON.stringify([{ type: 'VIDEO', url: 'https://example.com/video/123' }]),
      sources: JSON.stringify([
        { title: 'Read more', sourceURL: 'https://example.com/a', tagId: 'tag-1' },
      ]),
    });
    expect(validateLearningUnit(fd).success).toBe(true);
  });
});
