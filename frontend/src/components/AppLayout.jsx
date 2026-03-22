import { useState } from "react";
import SideNav from "./SideNav";
import TopBar from "./TopBar";
import { Sheet, SheetContent } from "./ui/sheet";

export default function AppLayout({ title, children, unreadCount = 0 }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen flex flex-col md:flex-row">
      <div className="hidden md:block">
        <SideNav />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-[240px]">
          <SideNav isMobile onClose={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="md:ml-[240px] flex-1 min-h-screen w-full overflow-x-hidden flex flex-col">
        <TopBar title={title} unreadCount={unreadCount} onMenuClick={() => setMobileOpen(true)} />
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
