/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosPutMock } = vi.hoisted(() => ({
  axiosPutMock: vi.fn(),
}));

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('axios', () => {
  const axiosMock = {
    put: axiosPutMock,
    isAxiosError: (error: unknown) => Boolean(error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError),
  };

  return {
    default: axiosMock,
  };
});

import { uploadPropertyImportFile } from './propertyImport';

function createPdfFile() {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'brochure.pdf', {
    type: 'application/pdf',
  });
}

describe('uploadPropertyImportFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    axiosPutMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries transient browser network errors before failing the upload', async () => {
    axiosPutMock
      .mockRejectedValueOnce({
        isAxiosError: true,
        code: 'ERR_NETWORK',
        message: 'Network Error',
      })
      .mockResolvedValueOnce({ status: 200 });

    const promise = uploadPropertyImportFile('https://example.test/upload-token', createPdfFile(), 'application/pdf');

    await vi.advanceTimersByTimeAsync(750);
    await promise;

    expect(axiosPutMock).toHaveBeenCalledTimes(2);
  });

  it('accepts already-completed upload tokens so confirmation can recover the pipeline', async () => {
    axiosPutMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          error: 'Upload has already been completed',
        },
      },
    });

    await expect(
      uploadPropertyImportFile('https://example.test/upload-token', createPdfFile(), 'application/pdf'),
    ).resolves.toBeUndefined();

    expect(axiosPutMock).toHaveBeenCalledTimes(1);
  });
});
