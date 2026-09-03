/** Read our JSON API without exposing HTML error pages from a server or proxy. */
export async function readApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const invalidResponse = () => new Error(
    `Serwer panelu zwrócił nieprawidłową odpowiedź (HTTP ${response.status}). Sprawdź, czy aplikacja i tunel działają, a następnie odśwież panel.`,
  );
  if (contentType !== "application/json") throw invalidResponse();
  let data: unknown;
  try { data = await response.json(); }
  catch { throw invalidResponse(); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw invalidResponse();
  if (!response.ok) {
    const message = "error" in data && typeof data.error === "string" ? data.error : undefined;
    throw new Error(message || `Nie udało się wykonać operacji (HTTP ${response.status}). Spróbuj ponownie później.`);
  }
  return data as T;
}
