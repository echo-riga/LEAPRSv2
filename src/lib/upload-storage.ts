import type { UploadJob, UploadPersistence } from './background-upload-queue';

const DATABASE = 'leaprs-attachment-uploads';
const STORE = 'jobs';

export function createUploadStorage(userId: string): UploadPersistence {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () => connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Unable to save uploads on this device. Check browser storage and retry.'));
    request.onblocked = () => reject(new Error('Close older LEAPRS tabs and retry.'));
  }).catch(error => { connection = undefined; throw error; });
  const key = (id: string) => `${userId}:${id}`;
  const save = async (job: UploadJob, onlyIfMissing = false) => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const value = { ...job, key: key(job.uploadId), userId };
      if (onlyIfMissing) {
        const exists = store.get(value.key);
        exists.onsuccess = () => { if (!exists.result) store.put(value); };
      } else store.put(value);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('Unable to save uploads on this device. Check browser storage and retry.'));
    });
  };
  const load = async () => {
    const db = await open();
    return new Promise<UploadJob[]>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.filter(row => row.userId === userId).map(row => ({
        ...row, file: new File([row.file], row.file.name, { type: row.file.type }),
      })));
      request.onerror = () => reject(new Error('Unable to restore uploads on this device.'));
    });
  };
  return { save, load, exclusive: async run => {
    // Only one tab for this account may restore or process its saved jobs.
    if (!navigator.locks) throw new Error('This browser cannot safely resume uploads. Use a current browser.');
    await navigator.locks.request(`leaprs-uploads:${userId}`, run);
  } };
}
