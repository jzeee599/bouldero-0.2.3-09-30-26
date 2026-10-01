import { createClient } from "@supabase/supabase-js";
import type { Attempt, ClimbingSession, Project } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const cloudEnabled = Boolean(url && key);
const supabase = cloudEnabled ? createClient(url!, key!) : null;
type StoredProject = Project & { photo?: Blob };
type BackupProject = Omit<StoredProject, "photo"> & {
  photo_data: string | null;
};
type BoulderoBackup = {
  kind: "bouldero-backup";
  version: 1;
  exported_at: string;
  projects: BackupProject[];
  sessions: ClimbingSession[];
  attempts: Attempt[];
};
export type ImportSummary = {
  projects: number;
  sessions: number;
  attempts: number;
};

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bouldero-v1", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects"))
        db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("attempts"))
        db.createObjectStore("attempts", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Local storage is unavailable. Check your browser storage settings.",
        ),
      );
  });
}
async function localRequest<T>(
  storeName: "projects" | "sessions" | "attempts",
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    let request: IDBRequest<T>;
    try {
      request = action(transaction.objectStore(storeName));
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    // Report success only when the transaction is durably committed.
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = transaction.onabort = () => {
      db.close();
      reject(
        new Error(
          "Could not save locally. Your browser may be out of storage.",
        ),
      );
    };
  });
}
async function owner() {
  const { data, error } = await supabase!.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session.user.id;
  const result = await supabase!.auth.signInAnonymously();
  if (result.error)
    throw new Error(
      `Could not start your private workspace. Enable anonymous sign-ins in Supabase. ${result.error.message}`,
    );
  return result.data.user!.id;
}
export async function listProjects(): Promise<Project[]> {
  if (!supabase) {
    const rows = await localRequest<StoredProject[]>(
      "projects",
      "readonly",
      (store) => store.getAll(),
    );
    const legacyWarmUps = rows.filter(
      (row) =>
        (row.purpose || "project") === "warm_up" && row.status === "sent",
    );
    if (legacyWarmUps.length) {
      await Promise.all(
        legacyWarmUps.map((row) =>
          localRequest("projects", "readwrite", (store) =>
            store.put({ ...row, status: "active", sent_at: null }),
          ),
        ),
      );
      legacyWarmUps.forEach((row) => {
        row.status = "active";
        row.sent_at = null;
      });
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const photoFor = (row: StoredProject): Blob => {
      if (row.photo) return row.photo;
      const source = row.source_project_id && byId.get(row.source_project_id);
      if (!source) throw new Error(`Photo source missing for ${row.name}.`);
      return photoFor(source);
    };
    return rows
      .map(({ photo: _photo, ...project }) => ({
        ...project,
        status:
          (project.purpose || "project") === "warm_up" &&
          project.status === "sent"
            ? ("active" as const)
            : project.status,
        sent_at:
          (project.purpose || "project") === "warm_up" &&
          project.status === "sent"
            ? null
            : project.sent_at,
        route_mode: project.route_mode || "mapped",
        source_project_id: project.source_project_id || null,
        finish_type: project.finish_type || "hold",
        notes: project.notes || "",
        purpose: project.purpose || "project",
        photo_url: URL.createObjectURL(photoFor(byId.get(project.id)!)),
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  await owner();
  const { data, error } = await supabase
    .from("projects")
    .select("*, holds(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const legacyWarmUpIds = data
    .filter(
      (row) =>
        (row.purpose || "project") === "warm_up" && row.status === "sent",
    )
    .map((row) => row.id);
  if (legacyWarmUpIds.length) {
    const { error: migrationError } = await supabase
      .from("projects")
      .update({ status: "active", sent_at: null })
      .in("id", legacyWarmUpIds);
    if (migrationError) throw migrationError;
    data.forEach((row) => {
      if (legacyWarmUpIds.includes(row.id)) {
        row.status = "active";
        row.sent_at = null;
      }
    });
  }
  return Promise.all(
    data.map(async (row) => {
      const { data: photo, error } = await supabase.storage
        .from("project-photos")
        .createSignedUrl(row.photo_url, 86400);
      if (error) throw error;
      return {
        ...row,
        status:
          (row.purpose || "project") === "warm_up" && row.status === "sent"
            ? "active"
            : row.status,
        sent_at:
          (row.purpose || "project") === "warm_up" && row.status === "sent"
            ? null
            : row.sent_at,
        grade: row.grade || "",
        gym: row.gym || "",
        route_mode: row.route_mode || "mapped",
        source_project_id: row.source_project_id || null,
        finish_type: row.finish_type || "hold",
        notes: row.notes || "",
        purpose: row.purpose || "project",
        photo_url: photo.signedUrl,
        holds: row.holds.sort(
          (a: Project["holds"][number], b: Project["holds"][number]) =>
            a.order_index - b.order_index,
        ),
      } as Project;
    }),
  );
}
export async function saveProject(
  project: Project,
  photo: Blob | null,
): Promise<void> {
  if (!supabase) {
    await localRequest("projects", "readwrite", (store) =>
      store.put({ ...project, photo_url: "", ...(photo ? { photo } : {}) }),
    );
    return;
  }
  const userId = await owner();
  const path = photo ? `${userId}/${project.id}.jpg` : null;
  if (photo) {
    const { error: uploadError } = await supabase.storage
      .from("project-photos")
      .upload(path!, photo, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;
  }
  // The RPC inserts the project and all holds in one database transaction.
  const { error } = await supabase.rpc("create_project_v5", {
    p_id: project.id,
    p_name: project.name,
    p_grade: project.grade,
    p_gym: project.gym,
    p_photo: path,
    p_holds: project.holds,
    p_route_mode: project.route_mode,
    p_source_project_id: project.source_project_id,
    p_finish_type: project.finish_type,
    p_notes: project.notes,
    p_purpose: project.purpose,
  });
  if (error && path) {
    await supabase.storage.from("project-photos").remove([path]);
    throw error;
  }
  if (error) throw error;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("A saved photo could not be included in the backup."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(value: string) {
  const match = /^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/.exec(value);
  if (!match) throw new Error("This backup contains an invalid photo.");
  const bytes = Uint8Array.from(atob(match[2]), (character) =>
    character.charCodeAt(0),
  );
  return new Blob([bytes], { type: match[1] || "application/octet-stream" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function exportLocalData(): Promise<Blob> {
  if (supabase)
    throw new Error(
      "Local backup is available when Bouldero is using device storage.",
    );
  const [projects, sessions, attempts] = await Promise.all([
    localRequest<StoredProject[]>("projects", "readonly", (store) =>
      store.getAll(),
    ),
    localRequest<ClimbingSession[]>("sessions", "readonly", (store) =>
      store.getAll(),
    ),
    localRequest<Attempt[]>("attempts", "readonly", (store) => store.getAll()),
  ]);
  const backupProjects = await Promise.all(
    projects.map(async ({ photo, ...project }) => ({
      ...project,
      notes: project.notes || "",
      purpose: project.purpose || "project",
      photo_data: photo ? await blobToDataUrl(photo) : null,
    })),
  );
  const backup: BoulderoBackup = {
    kind: "bouldero-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    projects: backupProjects,
    sessions,
    attempts,
  };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

export async function updateProjectDetails(
  project: Project,
  replacementPhoto?: Blob | null,
): Promise<void> {
  if (!supabase) {
    await localRequest("projects", "readwrite", (store) => {
      const request = store.get(project.id) as IDBRequest<StoredProject>;
      request.onsuccess = () => {
        if (!request.result) {
          store.transaction.abort();
          return;
        }
        const { photo: savedPhoto, ...savedProject } = request.result;
        store.put({
          ...savedProject,
          ...project,
          photo_url: "",
          ...(replacementPhoto === undefined && savedPhoto
            ? { photo: savedPhoto }
            : replacementPhoto
              ? { photo: replacementPhoto }
              : {}),
        });
      };
      return request;
    });
    return;
  }
  const userId = await owner();
  const replacementPath = replacementPhoto
    ? `${userId}/${project.id}.jpg`
    : null;
  if (replacementPhoto) {
    const { error: uploadError } = await supabase.storage
      .from("project-photos")
      .upload(replacementPath!, replacementPhoto, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) throw uploadError;
  }
  const { error } = await supabase.rpc("update_project_v5", {
    p_id: project.id,
    p_name: project.name,
    p_grade: project.grade,
    p_gym: project.gym,
    p_holds: project.holds,
    p_finish_type: project.finish_type,
    p_notes: project.notes,
    p_purpose: project.purpose,
  });
  if (error) throw error;
  if (replacementPhoto !== undefined) {
    const { error: photoError } = await supabase
      .from("projects")
      .update({
        photo_url: replacementPath,
        source_project_id: project.source_project_id,
      })
      .eq("id", project.id);
    if (photoError) throw photoError;
  }
}

export async function importLocalData(file: File): Promise<ImportSummary> {
  if (supabase)
    throw new Error(
      "Local backup is available when Bouldero is using device storage.",
    );
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("Choose a valid Bouldero backup file.");
  }
  if (
    !isObject(value) ||
    value.kind !== "bouldero-backup" ||
    value.version !== 1 ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.attempts)
  ) {
    throw new Error("This file is not a supported Bouldero backup.");
  }
  const requireId = (item: unknown, label: string) => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id) {
      throw new Error(`This backup contains an invalid ${label}.`);
    }
    return item;
  };
  const projects = value.projects.map((item) => {
    const row = requireId(item, "line");
    if (
      !Array.isArray(row.holds) ||
      typeof row.name !== "string" ||
      (row.photo_data !== null && typeof row.photo_data !== "string")
    ) {
      throw new Error("This backup contains an invalid line.");
    }
    const { photo_data, ...project } = row as unknown as BackupProject;
    return {
      ...project,
      notes: project.notes || "",
      purpose: project.purpose || "project",
      ...(photo_data ? { photo: dataUrlToBlob(photo_data) } : {}),
    } as StoredProject;
  });
  const sessions = value.sessions.map(
    (item) => requireId(item, "session") as unknown as ClimbingSession,
  );
  const attempts = value.attempts.map(
    (item) => requireId(item, "attempt") as unknown as Attempt,
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const sessionIds = new Set(sessions.map((session) => session.id));
  if (
    projects.some(
      (project) =>
        !project.photo &&
        (!project.source_project_id ||
          !projectIds.has(project.source_project_id)),
    )
  ) {
    throw new Error(
      "This backup is missing a photo used by one or more lines.",
    );
  }
  if (
    attempts.some(
      (attempt) =>
        !projectIds.has(attempt.project_id) ||
        !sessionIds.has(attempt.session_id),
    )
  ) {
    throw new Error(
      "This backup contains an attempt whose line or session is missing.",
    );
  }
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      ["projects", "sessions", "attempts"],
      "readwrite",
    );
    projects.forEach((project) =>
      transaction.objectStore("projects").put(project),
    );
    sessions.forEach((session) =>
      transaction.objectStore("sessions").put(session),
    );
    attempts.forEach((attempt) =>
      transaction.objectStore("attempts").put(attempt),
    );
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      db.close();
      reject(
        new Error(
          "The backup could not be imported. Your current data was not changed.",
        ),
      );
    };
  });
  return {
    projects: projects.length,
    sessions: sessions.length,
    attempts: attempts.length,
  };
}

export async function updateProjectStatus(
  project: Project,
  status: Project["status"],
): Promise<Project> {
  const updated: Project = {
    ...project,
    status,
    sent_at:
      status === "sent" ? project.sent_at || new Date().toISOString() : null,
  };
  if (!supabase) {
    await localRequest("projects", "readwrite", (store) => {
      const request = store.get(project.id) as IDBRequest<StoredProject>;
      request.onsuccess = () => {
        if (!request.result) {
          store.transaction.abort();
          return;
        }
        store.put({
          ...request.result,
          status: updated.status,
          sent_at: updated.sent_at,
        });
      };
      return request;
    });
    return updated;
  }
  await owner();
  const { error } = await supabase
    .from("projects")
    .update({ status: updated.status, sent_at: updated.sent_at })
    .eq("id", project.id);
  if (error) throw error;
  return updated;
}

export async function listSessions(): Promise<ClimbingSession[]> {
  if (!supabase) {
    const rows = await localRequest<ClimbingSession[]>(
      "sessions",
      "readonly",
      (store) => store.getAll(),
    );
    return rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  await owner();
  const { data, error } = await supabase
    .from("climbing_sessions")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) throw error;
  return data as ClimbingSession[];
}

export async function startSession(
  gym: string,
  timing?: { startedAt: string; endedAt: string },
): Promise<ClimbingSession> {
  const session: ClimbingSession = {
    id: crypto.randomUUID(),
    gym: gym.trim(),
    started_at: timing?.startedAt || new Date().toISOString(),
    ended_at: timing?.endedAt || null,
  };
  if (!supabase) {
    await localRequest("sessions", "readwrite", (store) => store.put(session));
    return session;
  }
  const userId = await owner();
  const { data, error } = await supabase
    .from("climbing_sessions")
    .insert({ ...session, user_id: userId })
    .select("id,gym,started_at,ended_at")
    .single();
  if (error) throw error;
  return data as ClimbingSession;
}

export async function endSession(
  session: ClimbingSession,
): Promise<ClimbingSession> {
  const ended = { ...session, ended_at: new Date().toISOString() };
  if (!supabase) {
    await localRequest("sessions", "readwrite", (store) => store.put(ended));
    return ended;
  }
  const { data, error } = await supabase
    .from("climbing_sessions")
    .update({ ended_at: ended.ended_at })
    .eq("id", session.id)
    .select("id,gym,started_at,ended_at")
    .single();
  if (error) throw error;
  return data as ClimbingSession;
}

export async function updateSessionDetails(
  session: ClimbingSession,
): Promise<ClimbingSession> {
  const updated = { ...session, gym: session.gym.trim() };
  if (!supabase) {
    await localRequest("sessions", "readwrite", (store) => store.put(updated));
    return updated;
  }
  const { data, error } = await supabase
    .from("climbing_sessions")
    .update({
      gym: updated.gym,
      started_at: updated.started_at,
      ended_at: updated.ended_at,
    })
    .eq("id", updated.id)
    .select("id,gym,started_at,ended_at")
    .single();
  if (error) throw error;
  return data as ClimbingSession;
}

export async function listAttempts(): Promise<Attempt[]> {
  if (!supabase) {
    const rows = await localRequest<Attempt[]>(
      "attempts",
      "readonly",
      (store) => store.getAll(),
    );
    return rows
      .map((attempt) => ({
        ...attempt,
        started_hold_id: attempt.started_hold_id || null,
        ended_hold_id: attempt.ended_hold_id || null,
        topped_out: Boolean(attempt.topped_out),
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  await owner();
  const { data, error } = await supabase
    .from("attempts")
    .select(
      "id,project_id,session_id,result,started_hold_id,ended_hold_id,topped_out,notes,created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Attempt[];
}

export async function saveAttempt(attempt: Attempt): Promise<void> {
  await saveAttempts([attempt]);
}

export async function saveAttempts(attempts: Attempt[]): Promise<void> {
  if (!attempts.length) return;
  if (!supabase) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("attempts", "readwrite");
      const store = transaction.objectStore("attempts");
      attempts.forEach((attempt) => store.put(attempt));
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        db.close();
        reject(new Error("Could not save attempts locally."));
      };
    });
    return;
  }
  const userId = await owner();
  const { error } = await supabase
    .from("attempts")
    .insert(attempts.map((attempt) => ({ ...attempt, user_id: userId })));
  if (error) throw error;
}

export async function updateAttemptNotes(
  attempt: Attempt,
  notes: string,
): Promise<Attempt> {
  const updated = { ...attempt, notes: notes.trim() };
  if (!supabase) {
    await localRequest("attempts", "readwrite", (store) => store.put(updated));
    return updated;
  }
  const { error } = await supabase
    .from("attempts")
    .update({ notes: updated.notes })
    .eq("id", attempt.id);
  if (error) throw error;
  return updated;
}

export async function updateAttemptDetails(attempt: Attempt): Promise<Attempt> {
  const updated = { ...attempt, notes: attempt.notes.trim() };
  if (!supabase) {
    await localRequest("attempts", "readwrite", (store) => store.put(updated));
    return updated;
  }
  const { error } = await supabase
    .from("attempts")
    .update({
      result: updated.result,
      started_hold_id: updated.started_hold_id,
      ended_hold_id: updated.ended_hold_id,
      topped_out: updated.topped_out,
      notes: updated.notes,
      created_at: updated.created_at,
    })
    .eq("id", attempt.id);
  if (error) throw error;
  return updated;
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!supabase) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["sessions", "attempts"], "readwrite");
      transaction.objectStore("sessions").delete(sessionId);
      const attemptsStore = transaction.objectStore("attempts");
      const cursor = attemptsStore.openCursor();
      cursor.onsuccess = () => {
        const result = cursor.result;
        if (!result) return;
        if ((result.value as Attempt).session_id === sessionId) result.delete();
        result.continue();
      };
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        db.close();
        reject(new Error("Could not delete this session."));
      };
    });
    return;
  }
  const { error: attemptsError } = await supabase
    .from("attempts")
    .delete()
    .eq("session_id", sessionId);
  if (attemptsError) throw attemptsError;
  const { error: sessionError } = await supabase
    .from("climbing_sessions")
    .delete()
    .eq("id", sessionId);
  if (sessionError) throw sessionError;
}
