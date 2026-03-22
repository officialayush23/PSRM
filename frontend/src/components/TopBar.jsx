import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "./ui/badge";

export default function TopBar({ title = "Dashboard", unreadCount = 0 }) {
  const navigate = useNavigate();
  const stored = localStorage.getItem("auth_user");
  const user = stored ? JSON.parse(stored) : null;
  const [searchVal, setSearchVal] = useState("");

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  function handleSearch(e) {
    if (e.key === "Enter" && searchVal.trim()) {
      navigate(`/my-complaints?q=${encodeURIComponent(searchVal.trim())}`);
    }
  }

  return (
    <header className="flex items-center justify-between px-8 h-[60px] sticky top-0 z-40 bg-white/80 backdrop-blur-md shadow-sm">
      <h2 className="text-xl font-bold font-headline text-on-surface">{title}</h2>

      <div className="flex items-center gap-6">
        {/* Search */}
        <div className="relative hidden md:block">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
            search
          </span>
          <input
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            onKeyDown={handleSearch}
            className="pl-10 pr-4 py-1.5 w-[280px] bg-surface-container-low border border-outline-variant/50 rounded-full text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
            placeholder="Search complaints (Enter)…"
            type="text"
          />
        </div>

        <div className="flex items-center gap-4">
          {/* Notification Bell */}
          <button
            onClick={() => navigate("/notifications")}
            className="relative p-2 text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors flex items-center justify-center"
          >
            <span className="material-symbols-outlined">notifications</span>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="absolute -top-1 -right-1 px-1 min-w-[20px] h-5 flex items-center justify-center text-[10px] rounded-full">
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            )}
          </button>

          {/* Avatar */}
          <button
            onClick={() => navigate("/profile")}
            className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center overflow-hidden border-2 border-primary-container text-xs font-bold"
          >
            {initials}
          </button>
        </div>
      </div>
    </header>
  );
}
