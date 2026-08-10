const DATABASE_NAME = "naia-meeting-capture";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";
const CHUNK_STORE = "chunks";

type RecordingRecoveryStatus = "processed" | "recording" | "recoverable";

type RecordingRecoverySession = {
  chunkCount: number;
  durationSeconds?: number;
  id: string;
  meetingId: string;
  mimeType: string;
  originalFileName: string;
  startedAt: string;
  status: RecordingRecoveryStatus;
  updatedAt: string;
};

type RecordingRecoveryChunk = {
  blob: Blob;
  id: string;
  index: number;
  sessionId: string;
};

export type RecoveredMeetingRecording = RecordingRecoverySession & {
  audio: Blob;
};

export async function startMeetingRecordingRecovery(input: {
  id: string;
  meetingId: string;
  mimeType: string;
  originalFileName: string;
  startedAt: string;
}) {
  const database = await openRecoveryDatabase();
  if (!database) return;

  const now = new Date().toISOString();
  const transaction = database.transaction(SESSION_STORE, "readwrite");
  transaction.objectStore(SESSION_STORE).put({
    ...input,
    chunkCount: 0,
    status: "recording",
    updatedAt: now,
  } satisfies RecordingRecoverySession);
  await transactionComplete(transaction);
  database.close();
}

export async function appendMeetingRecordingChunk(
  sessionId: string,
  index: number,
  blob: Blob,
) {
  const database = await openRecoveryDatabase();
  if (!database) return;

  const transaction = database.transaction(
    [SESSION_STORE, CHUNK_STORE],
    "readwrite",
  );
  const sessions = transaction.objectStore(SESSION_STORE);
  const session = await requestResult<RecordingRecoverySession | undefined>(
    sessions.get(sessionId),
  );
  if (!session) {
    transaction.abort();
    database.close();
    throw new Error("Session locale de reprise introuvable.");
  }

  transaction.objectStore(CHUNK_STORE).put({
    blob,
    id: `${sessionId}:${String(index).padStart(6, "0")}`,
    index,
    sessionId,
  } satisfies RecordingRecoveryChunk);
  sessions.put({
    ...session,
    chunkCount: Math.max(session.chunkCount, index + 1),
    updatedAt: new Date().toISOString(),
  } satisfies RecordingRecoverySession);
  await transactionComplete(transaction);
  database.close();
}

export async function finalizeMeetingRecordingRecovery(
  sessionId: string,
  durationSeconds: number,
) {
  await updateRecoverySession(sessionId, (session) => ({
    ...session,
    durationSeconds,
    status: "recoverable",
    updatedAt: new Date().toISOString(),
  }));
}

export async function markMeetingRecordingProcessed(sessionId: string) {
  await updateRecoverySession(sessionId, (session) => ({
    ...session,
    status: "processed",
    updatedAt: new Date().toISOString(),
  }));
}

export async function loadLatestMeetingRecording(
  meetingId: string,
): Promise<RecoveredMeetingRecording | undefined> {
  const database = await openRecoveryDatabase();
  if (!database) return undefined;

  const transaction = database.transaction(
    [SESSION_STORE, CHUNK_STORE],
    "readonly",
  );
  const sessions = await requestResult<RecordingRecoverySession[]>(
    transaction
      .objectStore(SESSION_STORE)
      .index("meetingId")
      .getAll(IDBKeyRange.only(meetingId)),
  );
  const session = sessions
    .filter(
      (candidate) =>
        candidate.status === "recording" || candidate.status === "recoverable",
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (!session) {
    await transactionComplete(transaction);
    database.close();
    return undefined;
  }

  const chunks = await requestResult<RecordingRecoveryChunk[]>(
    transaction
      .objectStore(CHUNK_STORE)
      .index("sessionId")
      .getAll(IDBKeyRange.only(session.id)),
  );
  await transactionComplete(transaction);
  database.close();

  const orderedChunks = chunks
    .sort((left, right) => left.index - right.index)
    .map((chunk) => chunk.blob);
  if (!orderedChunks.length) return undefined;

  return {
    ...session,
    audio: new Blob(orderedChunks, { type: session.mimeType }),
    status: "recoverable",
  };
}

async function updateRecoverySession(
  sessionId: string,
  update: (session: RecordingRecoverySession) => RecordingRecoverySession,
) {
  const database = await openRecoveryDatabase();
  if (!database) return;

  const transaction = database.transaction(SESSION_STORE, "readwrite");
  const store = transaction.objectStore(SESSION_STORE);
  const session = await requestResult<RecordingRecoverySession | undefined>(
    store.get(sessionId),
  );
  if (session) store.put(update(session));
  await transactionComplete(transaction);
  database.close();
}

function openRecoveryDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = database.createObjectStore(SESSION_STORE, {
          keyPath: "id",
        });
        sessions.createIndex("meetingId", "meetingId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, {
          keyPath: "id",
        });
        chunks.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}
