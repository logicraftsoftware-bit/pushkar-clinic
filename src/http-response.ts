export async function readJsonResponse(response: Response) {
  if (response.status === 204) return null;
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(response.ok
      ? "The server returned an unexpected response. Please reload and try again."
      : `The service is temporarily unavailable (HTTP ${response.status}). Please try again shortly.`);
  }
}

export async function loginRequest(url: string, body: unknown) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const result = await readJsonResponse(response);
    return { response, result };
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new Error("Sign in timed out: the login server did not respond within 30 seconds. Account registration and password could not be checked. Please try again. (LOGIN_REQUEST_TIMEOUT)");
    }
    if (error instanceof TypeError) throw new Error("Unable to reach the server. Check your connection and try again.");
    throw error;
  }
}
