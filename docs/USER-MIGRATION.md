# User migration: legacy PostgreSQL → Supabase Auth

Supabase is now the identity provider. Existing users live in the old `users`
table with bcrypt `hashed_password` values. Those hashes are **not** portable
into Supabase via the dashboard, so we migrate by re-establishing credentials,
not by importing hashes.

## Plan (zero-password-leak)

1. **Export** existing users (no hashes):
   ```bash
   cd backend/api_service
   python scripts/export_users_for_supabase.py > users_export.csv
   ```
   Produces `email, name, role, company_id, is_active`.

2. **Create the identities in Supabase** (pick one):
   - **Invite flow (recommended):** for each email, use the Supabase Admin API
     `auth.admin.inviteUserByEmail(email, { data: { full_name, role } })`.
     Supabase emails each user a link to set their password. Clean and secure.
   - **Bulk pre-create + forced reset:** `auth.admin.createUser({ email,
     email_confirm: true, user_metadata: { full_name }, app_metadata: { role } })`
     then have users click "Forgot password" on first login.

   Set elevated roles via `app_metadata.role` (server-controlled) — never trust
   a client-supplied role.

3. **Verify** each migrated user can log in and that the backend `/auth/me`
   provisions their `member_profile` (just-in-time sync) with the correct org/role.

4. **Drop the dead column** once everyone is migrated:
   ```bash
   alembic upgrade head     # applies 0002_drop_hashed_password
   ```

## Notes
- The model already made `hashed_password` nullable so new Supabase-era rows
  don't require it; migration `0002` removes it entirely.
- Map legacy `company_id` → new `organizations.id` during Phase 2 membership
  backfill (the org/membership model supersedes the old `companies` table).
- Keep `users_export.csv` out of git (it's covered by `.gitignore`).
