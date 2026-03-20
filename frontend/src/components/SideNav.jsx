import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../api/authApi";

const navItems = [
  { to: "/dashboard",      icon: "dashboard",     label: "Dashboard" },
  { to: "/my-complaints",  icon: "assignment",     label: "My Complaints" },
  { to: "/submit",         icon: "add_circle",     label: "Report Issue" },
  { to: "/notifications",  icon: "notifications",  label: "Notifications", badge: true },
];

const bottomItems = [
  { to: "/profile", icon: "settings", label: "Settings" },
];

export default function SideNav() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");

  const handleLogout = async () => {
    await logout();          // signs out from Firebase + clears localStorage
    navigate("/login");
  };

  return (
    <aside className="flex flex-col fixed left-0 top-0 h-full overflow-y-auto w-[240px] bg-white border-r border-outline-variant/30 z-50">
      <div className="p-6">
        <h1 className="text-xl font-bold text-slate-900 font-headline tracking-tight">
          PS-CRM Delhi
        </h1>
        <p className="text-xs text-on-surface-variant mt-1">Public Service CRM</p>
      </div>

      <div className="px-4 mb-6">
        <div className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl">
          <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm">
            {user?.full_name
              ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
              : "U"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold truncate">{user?.full_name || "User"}</p>
            <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary font-bold rounded-full capitalize">
              {user?.role || "Citizen"}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm relative ${
                isActive
                  ? "bg-sky-50 text-sky-600 border-r-4 border-sky-500"
                  : "text-on-surface-variant hover:bg-surface-container-low"
              }`
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge && (
              <span className="absolute right-3 w-2 h-2 bg-error rounded-full" />
            )}
          </NavLink>
        ))}

        <div className="pt-4 mt-4 border-t border-outline-variant/10">
          {bottomItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm ${
                  isActive
                    ? "bg-sky-50 text-sky-600 border-r-4 border-sky-500"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`
              }
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-error hover:bg-error-container/20 transition-colors font-medium text-sm mt-4"
          >
            <span className="material-symbols-outlined">logout</span>
            <span>Logout</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}