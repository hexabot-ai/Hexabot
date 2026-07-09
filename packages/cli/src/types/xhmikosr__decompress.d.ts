/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

declare module '@xhmikosr/decompress' {
  interface File {
    data: Buffer;
    mode: number;
    mtime: string;
    path: string;
    type: string;
  }

  interface DecompressOptions {
    /**
     * Filter out files before extracting
     */
    filter?(file: File): boolean;
    /**
     * Map files before extracting
     */
    map?(file: File): File;
    /**
     * Array of plugins to use (defaults to tar, tar.bz2, tar.gz and zip)
     */
    plugins?: unknown[];
    /**
     * Remove leading directory components from extracted files
     */
    strip?: number;
  }

  function decompress(
    input: string | Buffer,
    output?: string | DecompressOptions,
    opts?: DecompressOptions,
  ): Promise<File[]>;

  export default decompress;
}
