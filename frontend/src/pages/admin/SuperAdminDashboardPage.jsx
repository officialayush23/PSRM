// src/pages/admin/SuperAdminDashboardPage.jsx
// Super Admin (Commissioner) — city-wide command center
// Uses AdminDashboardPage as its component — super_admin has city-wide scope server-side.
// This is an alias that just renders AdminDashboardPage with super_admin context.
// The actual scoping is done server-side by _get_user_context in admin_router.py.

export { default } from "./AdminDashboardPage";