import * as Keychain from 'react-native-keychain';
import Blob from 'react-native-blob-util';
import { Platform } from 'react-native';
import {
  pick,
  keepLocalCopy,
  types,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import { PatientClient } from './client';
const service = 'com.jiboncare.patient.refresh';
export const api = new PatientClient({
  async read() {
    await clearDocuments();
    const entry = await Keychain.getGenericPassword({ service });
    return entry ? entry.password : null;
  },
  async write(token) {
    await Keychain.setGenericPassword('patient', token, {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear() {
    await Keychain.resetGenericPassword({ service });
    await clearDocuments();
  },
});
let files: string[] = [];
export async function clearDocuments() {
  const cached = await Blob.fs
    .ls(Blob.fs.dirs.CacheDir)
    .catch(() => [] as string[]);
  const previous = [
    ...files,
    ...cached
      .filter(name => /^patient-\d+\.(pdf|jpg|png|webp)$/.test(name))
      .map(name => `${Blob.fs.dirs.CacheDir}/${name}`),
  ];
  files = [];
  await Promise.all(previous.map(path => Blob.fs.unlink(path).catch(() => {})));
}
export async function downloadDocument(path: string) {
  await api.authorizedDownload(path, async (url, token) => {
    const target = `${Blob.fs.dirs.CacheDir}/patient-${Date.now()}.pdf`;
    files.push(target);
    const result = await Blob.config({ path: target }).fetch('GET', url, {
      Authorization: `Bearer ${token}`,
      Accept: 'application/pdf,image/jpeg,image/png,image/webp',
    });
    if (result.info().status !== 200) {
      await Blob.fs.unlink(target).catch(() => {});
      throw Error(
        'This document is not available. Refresh the screen and try again.',
      );
    }
    const headers = result.info().headers;
    const mime = String(
      headers['Content-Type'] ?? headers['content-type'] ?? 'application/pdf',
    )
      .split(';')[0]
      .toLowerCase();
    const extension: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    if (!extension[mime]) {
      await Blob.fs.unlink(target).catch(() => {});
      throw Error('Unsupported document format.');
    }
    const finalPath = target.replace(/\.pdf$/, '.' + extension[mime]);
    if (finalPath !== target) {
      await Blob.fs.mv(target, finalPath);
      files.push(finalPath);
    }
    if (Platform.OS === 'android')
      await Blob.android.actionViewIntent(finalPath, mime);
    else Blob.ios.openDocument(finalPath);
  });
}
export async function chooseFile() {
  try {
    const [file] = await pick({
      type: [types.pdf, types.images],
      allowMultiSelection: false,
    });
    if (!file.size || file.size > 3 * 1024 * 1024)
      throw Error('Choose a PDF or image no larger than 3 MB.');
    if (
      !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
        file.type ?? '',
      )
    )
      throw Error('Choose PDF, JPEG, PNG or WebP.');
    const [copy] = await keepLocalCopy({
      files: [{ uri: file.uri, fileName: file.name ?? 'patient-document' }],
      destination: 'cachesDirectory',
    });
    if (copy.status !== 'success')
      throw Error('Could not read the selected file.');
    const path = decodeURIComponent(copy.localUri.replace('file://', ''));
    files.push(path);
    const content_base64 = await Blob.fs.readFile(path, 'base64');
    await Blob.fs.unlink(path).catch(() => {});
    return {
      filename: file.name ?? 'document',
      mime: file.type,
      content_base64,
    };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
      return null;
    throw error;
  }
}
