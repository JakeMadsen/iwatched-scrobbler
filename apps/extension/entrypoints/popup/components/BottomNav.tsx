type PopupView = "status" | "queue" | "about";

const navItems: Array<{ id: PopupView; label: string; glyph: string }> = [
  { id: "status", label: "Now", glyph: "N" },
  { id: "queue", label: "Queue", glyph: "Q" },
  { id: "about", label: "How", glyph: "i" }
];

interface BottomNavProps {
  activeView: PopupView;
  onChange: (view: PopupView) => void;
  queueCount?: number;
}

function formatQueueCount(queueCount: number): string {
  return queueCount > 9 ? "9+" : String(queueCount);
}

export function BottomNav({ activeView, onChange, queueCount = 0 }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Popup views">
      {navItems.map((item) => {
        const active = item.id === activeView;
        const badgeCount = item.id === "queue" && queueCount > 0
          ? formatQueueCount(queueCount)
          : null;
        const ariaLabel = item.id === "queue" && queueCount > 0
          ? `${item.label}, ${queueCount} title${queueCount === 1 ? "" : "s"} waiting for a rating or review`
          : item.label;
        return (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav__item ${active ? "is-active" : ""}`}
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            aria-label={ariaLabel}
          >
            <span className="bottom-nav__glyph-wrap">
              <span className="bottom-nav__glyph">{item.glyph}</span>
              {badgeCount && <span className="bottom-nav__count">{badgeCount}</span>}
            </span>
            <span className="bottom-nav__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
