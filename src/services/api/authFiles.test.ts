import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    getRaw: vi.fn(),
    postForm: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    getRaw: mocks.getRaw,
    postForm: mocks.postForm,
  },
}));

import { authFilesApi } from './authFiles';

beforeEach(() => {
  mocks.get.mockReset();
  mocks.getRaw.mockReset();
  mocks.postForm.mockReset();
});

describe('authFilesApi list normalization', () => {
  it('preserves same-name auth file rows when authIndex differs', async () => {
    mocks.get.mockResolvedValue({
      files: [
        {
          name: 'sub2api-codex-accounts.codex.json',
          type: 'codex',
          authIndex: 1,
          account: 'second@example.com',
        },
        {
          name: 'sub2api-codex-accounts.codex.json',
          type: 'codex',
          authIndex: 0,
          account: 'first@example.com',
        },
      ],
    });

    const result = await authFilesApi.list();

    expect(mocks.get).toHaveBeenCalledWith('/auth-files');
    expect(result.files).toEqual([
      expect.objectContaining({
        name: 'sub2api-codex-accounts.codex.json',
        authIndex: 0,
        account: 'first@example.com',
      }),
      expect.objectContaining({
        name: 'sub2api-codex-accounts.codex.json',
        authIndex: 1,
        account: 'second@example.com',
      }),
    ]);
    expect(result.total).toBe(2);
  });

  it('still merges duplicate same-name rows when authIndex is absent', async () => {
    mocks.get.mockResolvedValue({
      files: [
        {
          name: 'single-codex.json',
          type: 'codex',
          source: 'runtime',
          status: 'ok',
        },
        {
          name: 'single-codex.json',
          type: 'codex',
          source: 'file',
          path: '/auth/single-codex.json',
          size: 123,
        },
      ],
    });

    const result = await authFilesApi.list();

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        name: 'single-codex.json',
        source: 'file',
        path: '/auth/single-codex.json',
        size: 123,
        status: 'ok',
      })
    );
    expect(result.total).toBe(1);
  });
});

describe('authFilesApi save auth file upload contracts', () => {
  const getUploadedFile = () => {
    const formData = mocks.postForm.mock.calls[0]?.[1];
    expect(formData).toBeInstanceOf(FormData);
    const file = (formData as FormData).get('file');
    expect(file).toBeInstanceOf(File);
    return file as File;
  };

  it('saveText resolves when upload reports one uploaded file', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 1,
      files: ['direct-auth.json'],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveText('direct-auth.json', '{"type":"codex","access_token":"token"}')
    ).resolves.toBeUndefined();
    expect(mocks.postForm).toHaveBeenCalledWith('/auth-files', expect.any(FormData));
    const file = getUploadedFile();
    expect(file.name).toBe('direct-auth.json');
    await expect(file.text()).resolves.toBe('{"type":"codex","access_token":"token"}');
  });

  it('saveJsonObject resolves when upload succeeds', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 1,
      files: ['converted-auth.json'],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).resolves.toBeUndefined();
    expect(mocks.postForm).toHaveBeenCalledWith('/auth-files', expect.any(FormData));
    const file = getUploadedFile();
    expect(file.name).toBe('converted-auth.json');
    await expect(file.text()).resolves.toBe('{"type":"codex","access_token":"token"}');
  });

  it('saveJsonObject serializes auth file arrays without wrapping them', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 1,
      files: ['converted-auth-array.json'],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth-array.json', [
        {
          type: 'codex',
          access_token: 'first-token',
        },
        {
          type: 'codex',
          access_token: 'second-token',
        },
      ])
    ).resolves.toBeUndefined();
    expect(mocks.postForm).toHaveBeenCalledWith('/auth-files', expect.any(FormData));
    const file = getUploadedFile();
    expect(file.name).toBe('converted-auth-array.json');
    await expect(file.text()).resolves.toBe(
      '[{"type":"codex","access_token":"first-token"},{"type":"codex","access_token":"second-token"}]'
    );
  });

  it('uploadFiles sends multi-file selections as separate requests', async () => {
    // Arrange
    mocks.postForm
      .mockResolvedValueOnce({
        status: 'ok',
        uploaded: 1,
        files: ['first-auth.json'],
        failed: [],
      })
      .mockResolvedValueOnce({
        status: 'ok',
        uploaded: 1,
        files: ['second-auth.json'],
        failed: [],
      });

    const firstFile = new File(['{"type":"codex"}'], 'first-auth.json', {
      type: 'application/json',
    });
    const secondFile = new File(['{"type":"claude"}'], 'second-auth.json', {
      type: 'application/json',
    });

    // Act
    const result = await authFilesApi.uploadFiles([firstFile, secondFile]);

    // Assert
    expect(result).toEqual({
      status: 'ok',
      uploaded: 2,
      files: ['first-auth.json', 'second-auth.json'],
      failed: [],
    });
    expect(mocks.postForm).toHaveBeenCalledTimes(2);

    const firstFormData = mocks.postForm.mock.calls[0]?.[1] as FormData;
    const secondFormData = mocks.postForm.mock.calls[1]?.[1] as FormData;
    expect(Array.from(firstFormData.getAll('file'))).toHaveLength(1);
    expect(Array.from(secondFormData.getAll('file'))).toHaveLength(1);
    expect((firstFormData.get('file') as File).name).toBe('first-auth.json');
    expect((secondFormData.get('file') as File).name).toBe('second-auth.json');
  });

  it('uploadFiles aggregates per-file upload failures after successful uploads', async () => {
    // Arrange
    mocks.postForm
      .mockResolvedValueOnce({
        status: 'ok',
        uploaded: 1,
        files: ['first-auth.json'],
        failed: [],
      })
      .mockRejectedValueOnce(new Error('request body too large'));

    const firstFile = new File(['{"type":"codex"}'], 'first-auth.json', {
      type: 'application/json',
    });
    const secondFile = new File(['{"type":"claude"}'], 'second-auth.json', {
      type: 'application/json',
    });

    // Act
    const result = await authFilesApi.uploadFiles([firstFile, secondFile]);

    // Assert
    expect(result).toEqual({
      status: 'partial',
      uploaded: 1,
      files: ['first-auth.json'],
      failed: [{ name: 'second-auth.json', error: 'request body too large' }],
    });
    expect(mocks.postForm).toHaveBeenCalledTimes(2);
  });

  it('saveJsonObject throws Upload failed when backend reports zero uploaded files without explicit failures', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 0,
      files: [],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('failed-converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Upload failed');
  });

  it('saveText throws Upload failed when backend reports zero uploaded files without explicit failures', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 0,
      files: [],
      failed: [],
    });

    // Act / Assert
    await expect(authFilesApi.saveText('failed-auth.json', '{"type":"codex"}')).rejects.toThrow(
      'Upload failed'
    );
  });

  it('saveJsonObject surfaces backend failure error text', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'partial',
      uploaded: 0,
      files: [],
      failed: [{ name: 'converted-auth.json', error: 'Storage quota exceeded' }],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Storage quota exceeded');
  });

  it('saveJsonObject throws when backend reports partial failure despite uploaded files', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'partial',
      uploaded: 1,
      files: ['converted-auth.json'],
      failed: [{ name: 'secondary-auth.json', error: 'Invalid auth payload' }],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Invalid auth payload');
  });

  it('saveJsonObject throws when backend reports explicit error status without upload counters', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'error',
      files: [],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('failed-status-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Upload failed');
  });
});

describe('authFilesApi patchFieldsForAuthIndexes', () => {
  const getUploadedFile = () => {
    const formData = mocks.postForm.mock.calls[0]?.[1];
    expect(formData).toBeInstanceOf(FormData);
    const file = (formData as FormData).get('file');
    expect(file).toBeInstanceOf(File);
    return file as File;
  };

  it('updates only matching auth records in an auth array', async () => {
    mocks.getRaw.mockResolvedValue({
      data: new Blob([
        JSON.stringify([
          { type: 'codex', authIndex: 0, priority: 1, websocket: true },
          { type: 'codex', auth_index: 'auth-2', priority: 2 },
          { type: 'codex', authIndex: 'auth-3', priority: 3, websocket: true },
        ]),
      ]),
    });
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 1,
      files: ['shared-codex.json'],
      failed: [],
    });

    await authFilesApi.patchFieldsForAuthIndexes('shared-codex.json', [0, 'auth-2'], {
      priority: 10,
      websockets: false,
    });

    expect(mocks.getRaw).toHaveBeenCalledWith('/auth-files/download?name=shared-codex.json', {
      responseType: 'blob',
    });
    expect(mocks.postForm).toHaveBeenCalledWith('/auth-files', expect.any(FormData));
    const file = getUploadedFile();
    expect(file.name).toBe('shared-codex.json');
    await expect(file.text()).resolves.toBe(
      JSON.stringify([
        { type: 'codex', authIndex: 0, priority: 10, websockets: false },
        { type: 'codex', auth_index: 'auth-2', priority: 10, websockets: false },
        { type: 'codex', authIndex: 'auth-3', priority: 3, websocket: true },
      ])
    );
  });
});
