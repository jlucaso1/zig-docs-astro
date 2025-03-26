import fs from 'fs/promises';
import path from 'path';
import {extract} from 'tar';

export async function extractTarball(tarballPath: string, outputDir: string) {
  await extract({
    file: tarballPath,
    cwd: outputDir
  });
}

export async function getAllSourceFiles() {
  // Extract source files from your tarball at build time
  // and return info about all the files
  return [/* array of file objects */];
}

export async function getSourceContent(filePath: string) {
  // Return the content of a specific source file
  return '/* source code */';
}