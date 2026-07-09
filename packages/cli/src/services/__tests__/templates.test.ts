/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { jest } from '@jest/globals';

const decompress = jest.fn<() => Promise<unknown[]>>();
const axios = jest.fn<() => Promise<{ data: Buffer }>>();

jest.unstable_mockModule('@xhmikosr/decompress', () => ({
  default: decompress,
}));

jest.unstable_mockModule('axios', () => ({
  default: axios,
}));

let downloadAndExtractTemplate: (
  templateUrl: string,
  destination: string,
) => Promise<void>;

beforeAll(async () => {
  ({ downloadAndExtractTemplate } = await import('../templates.js'));
});

describe('downloadAndExtractTemplate', () => {
  let destination: string;

  beforeEach(() => {
    jest.resetAllMocks();
    destination = fs.mkdtempSync(path.join(os.tmpdir(), 'hexabot-template-'));
  });

  afterEach(() => {
    fs.rmSync(destination, { recursive: true, force: true });
  });

  it('downloads the archive, extracts it and removes the zip file', async () => {
    axios.mockResolvedValue({ data: Buffer.from('zip-content') });
    decompress.mockResolvedValue([]);

    await downloadAndExtractTemplate(
      'https://example.com/template.zip',
      destination,
    );

    expect(axios).toHaveBeenCalledWith({
      url: 'https://example.com/template.zip',
      method: 'GET',
      responseType: 'arraybuffer',
    });
    expect(decompress).toHaveBeenCalledWith(
      path.join(destination, 'template.zip'),
      destination,
      { strip: 1 },
    );
    expect(fs.existsSync(path.join(destination, 'template.zip'))).toBe(false);
  });

  it('throws a friendly error when the download fails', async () => {
    axios.mockRejectedValue(new Error('network error'));

    await expect(
      downloadAndExtractTemplate(
        'https://example.com/template.zip',
        destination,
      ),
    ).rejects.toThrow('Failed to download template from GitHub');
    expect(decompress).not.toHaveBeenCalled();
  });
});
