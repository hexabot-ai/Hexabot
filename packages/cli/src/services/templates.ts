/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';

import decompress from '@xhmikosr/decompress';
import axios from 'axios';

export const downloadAndExtractTemplate = async (
  templateUrl: string,
  destination: string,
) => {
  try {
    const response = await axios({
      url: templateUrl,
      method: 'GET',
      responseType: 'arraybuffer',
    });
    const zipFilePath = path.join(destination, 'template.zip');
    fs.writeFileSync(zipFilePath, response.data);

    await decompress(zipFilePath, destination, {
      strip: 1,
    });
    fs.unlinkSync(zipFilePath);
  } catch (_error) {
    throw new Error(`Failed to download template from GitHub`);
  }
};
