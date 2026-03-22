import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../api/authApi";
import { Badge } from "./ui/badge";

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
    <aside className="flex flex-col fixed left-0 top-0 h-full overflow-y-auto w-[240px] bg-white border-r border-outline-variant/30 z-50 shadow-sm">
      <div className="p-6">
        <h1 className="text-xl font-bold text-slate-900 font-headline tracking-tight">
          PS-CRM Delhi
        </h1>
        <p className="text-xs text-on-surface-variant mt-1">Public Service CRM</p>
      </div>

      <div className="px-4 mb-6">
        <div className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl border border-outline-variant/30">
          <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-sm">
            {user?.full_name
              ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
              : "U"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold truncate">{user?.full_name || "User"}</p>
            <Badge variant="outline" className="text-[10px] mt-0.5 capitalize border-primary/20 text-primary bg-primary/5">
              {user?.role || "Citizen"}
            </Badge>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors font-medium text-sm ${
                isActive
                  ? "bg-sky-50 text-sky-700 border-r-4 border-sky-500 font-semibold shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span>{item.label}</span>
            </div>
            {item.badge && (
              <Badge variant="destructive" className="h-5 w-5 flex items-center justify-center p-0 rounded-full text-[10px]">!</Badge>
            )}
          </NavLink>
        ))}

        <div className="pt-4 mt-6 border-t border-slate-200">
          {bottomItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm ${
                  isActive
                    ? "bg-sky-50 text-sky-700 border-r-4 border-sky-500 font-semibold shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors font-medium text-sm mt-2"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span>Logout</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}