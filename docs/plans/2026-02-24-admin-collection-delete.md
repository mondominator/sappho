# Admin Collection Deletion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to delete public collections owned by other users, and add a delete button to the web app's collection detail edit screen.

**Architecture:** Two-step change — update the server DELETE endpoint permission check, then add client-side UI. The Android app needs no code changes since it already calls the same API.

**Tech Stack:** Node.js/Express (server), React (web client)

---

### Task 1: Update server DELETE endpoint for admin permission

**Files:**
- Modify: `server/routes/collections.js:231-248`

**Step 1: Replace the DELETE handler**

Replace lines 231-248 in `server/routes/collections.js` with:

```javascript
  /**
   * DELETE /api/collections/:id
   * Delete a collection (owner, or admin for public collections)
   */
  router.delete('/:id', collectionWriteLimiter, authenticateToken, async (req, res) => {
    try {
      const collection = await dbGet(
        'SELECT id, user_id, is_public FROM user_collections WHERE id = ?',
        [req.params.id]
      );

      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      const isOwner = collection.user_id === req.user.id;
      const isAdminDeletingPublic = req.user.is_admin === 1 && collection.is_public === 1;

      if (!isOwner && !isAdminDeletingPublic) {
        return res.status(404).json({ error: 'Collection not found or not owned by you' });
      }

      await dbRun('DELETE FROM user_collections WHERE id = ?', [collection.id]);
      res.json({ success: true });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
```

Key changes from old code:
- Two-step: SELECT first to check permissions, then DELETE
- `isOwner` — same as before (owner can always delete)
- `isAdminDeletingPublic` — admin can delete public collections from other users
- Non-owners/non-admins still see 404 (no information leak)

**Step 2: Verify manually**

Test with curl as an admin user against a public collection owned by another user:
```bash
curl -X DELETE -H "Authorization: Bearer <admin-token>" https://sappho.bitstorm.ca/api/collections/<id>
```
Expected: `{ "success": true }`

**Step 3: Commit**

```bash
git add server/routes/collections.js
git commit -m "Allow admins to delete public collections from other users"
```

---

### Task 2: Update web app Collections list page for admin delete

**Files:**
- Modify: `client/src/pages/Collections.jsx:1-3` (imports)
- Modify: `client/src/pages/Collections.jsx:48-56` (state)
- Modify: `client/src/pages/Collections.jsx:95-100` (handleDelete)
- Modify: `client/src/pages/Collections.jsx:147-155` (delete button visibility)

**Step 1: Add admin state and fetch**

At the top of the `Collections` component (line 51, after the `creating` state), add:

```javascript
  const [isAdmin, setIsAdmin] = useState(false);
```

Add the import for `getProfile` to line 3:
```javascript
import { getCollections, createCollection, deleteCollection, getCoverUrl, getProfile } from '../api';
```

Add a `useEffect` after the existing one (after line 60):
```javascript
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const response = await getProfile();
        setIsAdmin(!!response.data.is_admin);
      } catch (_) {}
    };
    checkAdmin();
  }, []);
```

**Step 2: Update handleDelete permission check**

Replace lines 95-100 (the owner check in `handleDelete`) with:

```javascript
  const handleDelete = async (e, collection) => {
    e.stopPropagation();
    const canDelete = collection.is_owner === 1 || (isAdmin && collection.is_public === 1);
    if (!canDelete) {
      alert("You can only delete collections you created.");
      return;
    }
```

**Step 3: Update delete button visibility**

Replace line 147 (`{collection.is_owner === 1 && (`) with:

```javascript
              {(collection.is_owner === 1 || (isAdmin && collection.is_public === 1)) && (
```

**Step 4: Commit**

```bash
git add client/src/pages/Collections.jsx
git commit -m "Show delete button for admins on public collections in list"
```

---

### Task 3: Add delete button to web app CollectionDetail edit screen

**Files:**
- Modify: `client/src/pages/CollectionDetail.jsx:1-5` (imports)
- Modify: `client/src/pages/CollectionDetail.jsx:7-17` (state)
- Modify: `client/src/pages/CollectionDetail.jsx:119-165` (edit form JSX)
- Modify: `client/src/pages/CollectionDetail.css` (styles)

**Step 1: Add imports and state**

Update line 3 to add `deleteCollection` and `getProfile`:
```javascript
import { getCollection, updateCollection, removeFromCollection, reorderCollection, getCoverUrl, deleteCollection, getProfile } from '../api';
```

Add new state variables after line 17 (`const [draggedIndex, setDraggedIndex] = useState(null);`):
```javascript
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
```

**Step 2: Add admin check effect**

Add after the existing `useEffect` (after line 21):
```javascript
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const response = await getProfile();
        setIsAdmin(!!response.data.is_admin);
      } catch (_) {}
    };
    checkAdmin();
  }, []);
```

**Step 3: Add handleDelete function**

Add after `handleDragEnd` (after line 102):
```javascript
  const handleDelete = async () => {
    if (!confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;

    setDeleting(true);
    try {
      await deleteCollection(id);
      navigate('/collections');
    } catch (error) {
      console.error('Error deleting collection:', error);
      alert('Failed to delete collection');
      setDeleting(false);
    }
  };
```

**Step 4: Add delete button in the edit form**

Inside the edit form's `edit-actions` div (line 159-164), add the delete button before the Cancel/Save buttons. Replace lines 159-164 with:

```jsx
            {(collection.is_owner === 1 || (isAdmin && collection.is_public === 1)) && (
              <button
                className="btn btn-danger delete-collection-btn"
                onClick={handleDelete}
                disabled={deleting}
                type="button"
              >
                {deleting ? 'Deleting...' : 'Delete Collection'}
              </button>
            )}
            <div className="edit-actions-right">
              <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!editName.trim() || saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
```

Also wrap these in a new container by replacing the parent `<div className="edit-actions">` (line 159) with `<div className="edit-actions">` (same class, the CSS change below handles the layout).

**Step 5: Add CSS for the delete button layout**

Add to `client/src/pages/CollectionDetail.css`:

```css
.edit-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
}

.edit-actions-right {
  display: flex;
  gap: 0.5rem;
}

.delete-collection-btn {
  margin-right: auto;
}
```

Check existing CSS to avoid duplicating the `.edit-actions` selector — if it already exists, merge the styles.

**Step 6: Commit**

```bash
git add client/src/pages/CollectionDetail.jsx client/src/pages/CollectionDetail.css
git commit -m "Add delete button to collection detail edit screen"
```

---

### Task 4: Final commit and deploy

**Step 1: Verify all changes work together**

- Log in as admin on the web app
- Navigate to a public collection created by another user
- Click "Edit" — verify the "Delete Collection" button appears
- Click it — verify confirmation dialog, then deletion and redirect
- Check the collections list — verify the delete X button shows on public collections from other users
- Log in as a non-admin — verify delete buttons only appear on owned collections

**Step 2: Commit any remaining changes and push**

```bash
git push origin main
```

The server auto-deploys via Docker on push to main.
