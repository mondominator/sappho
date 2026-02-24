# Admin Collection Deletion + Web App Delete Button

## Problem

1. Admins cannot delete collections created by other users — the server enforces owner-only deletion
2. The web app's collection detail/edit screen has no delete button at all
3. The Android app's bulk delete button silently fails when trying to delete non-owned collections (server returns 404, error is swallowed)

## Design

### Server: `DELETE /api/collections/:id`

Change the permission model from owner-only to owner OR admin-for-public:

- **Owner**: can always delete their own collection (existing behavior)
- **Admin**: can delete public collections owned by other users
- **Everyone else**: 404 as before

Implementation: replace the single `DELETE WHERE id = ? AND user_id = ?` with a two-step check — first verify the collection exists and the user has permission, then delete.

### Web App: `CollectionDetail.jsx`

Add a "Delete Collection" button in the edit/settings section:

- Red danger-style button at the bottom of the edit panel
- Visible when: user is owner OR user is admin and collection is public
- Confirmation dialog before deletion
- On success: redirect to `/collections`

### Android App

No code changes required. The existing bulk delete calls `api.deleteCollection()` which hits the same server endpoint. Once the server allows admin deletes of public collections, the Android app works automatically.

Optional polish: surface error feedback in the delete callback instead of `{ _, _ -> }`.
