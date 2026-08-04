# Share Token Storage and Exposure Policy — ODM Primavera Lite

## What is stored where

| Asset | Location | Reason |
|-------|----------|--------|
| Display name | `localStorage` (`gantt_display_name`) | Convenience across visits to the same browser |
| Access token | React component state only | Required for API calls, copy/share link, and polling |
| Token hash | Database only | Authorization check never exposes the plaintext token |
| Raw token in URL | Removed from address bar after first capture | Reduces accidental leakage via screenshots, address-bar sharing, or referrer headers |

## Address-bar behavior

`SharedGanttProjectPage.tsx` reads the `?access=` query parameter once when the page mounts, stores it in component state, and immediately calls `history.replaceState` to strip the parameter from the visible URL. The token is not appended to outbound links.

## Referrer policy

The shared workspace renders `<meta name="referrer" content="no-referrer" />` so the token is not sent as a referrer when navigating away or clicking external links.

## Copy/share link

An explicit **Copy link** button reconstructs the full share URL (`/gantt/p/{slug}?access={token}`) from the token held in memory. This preserves intentional sharing while keeping the token out of the address bar.

## Risk disclosure

- `localStorage` persists until cleared by the user and is scoped to the origin. It does not contain the access token.
- The in-memory token is lost on full page reload. Users must re-open the original share link to reconnect.
- Anyone who obtains the plaintext token gains the corresponding role (editor or viewer) for that project. Treat share links like passwords.
