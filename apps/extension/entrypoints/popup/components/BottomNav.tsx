type PopupView = "status" | "queue" | "about";

const navItems: Array<{ id: PopupView; label: string; glyph: string }> = [
  { id: "status", label: "Now", glyph: "N" },
  { id: "queue", label: "Queue", glyph: "Q" },
  { id: "about", label: "How", glyph: "i" }
];

interface BottomNavProps {
  activeView: PopupView;
  onChange: (view: PopupView) => void;
}

export function BottomNav({ activeView, onChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Popup views">
      {navItems.map((item) => {
        const active = item.id === activeView;
        return (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav__item ${active ? "is-active" : ""}`}
            onClick={() => onChange(item.id)}
            aria-pressed={active}
          >
            <span className="bottom-nav__glyph">{item.glyph}</span>
            <span className="bottom-nav__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
