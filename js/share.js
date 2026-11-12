// Web Share API with a Clipboard API fallback.
// Resolves to "shared", "copied", "cancelled" or "failed"; never throws.

export async function shareTrip({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") {
        return "cancelled"; // The user closed the share sheet.
      }
      // Anything else (e.g. NotAllowedError): fall through to the clipboard.
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}
