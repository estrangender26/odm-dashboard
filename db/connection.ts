// Re-export from api/queries/connection to ensure consistency
import { db as apiDb } from "../api/queries/connection";

export const db = apiDb;
